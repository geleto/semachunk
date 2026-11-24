import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { here, sha256 } from './corpora.mjs';
import { dimension, encodingName, model, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { selectExpansion, summarizeExpansion, summarizeOverlap } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { flattenCorpus, meetings } from './semantic-corpora.mjs';

const [output, study = 'passages', sample] = process.argv.slice(2);
if (!output || existsSync(output)) throw new Error('Supply a new JSON output path.');
if (!['passages', 'embedding-context', 'side-locks', 'expansion-settings'].includes(study)) throw new Error('Unknown overlap study: ' + study);
const sideLocks = study === 'side-locks';
const settings = study === 'expansion-settings';
const meetingCheck = settings && sample !== undefined;
if (sample !== undefined && !meetingCheck && (study !== 'embedding-context' || sample !== 'confirmation')) throw new Error('Unexpected study argument.');
const confirmation = sideLocks || sample === 'confirmation';
const coreTokens = 256;
const core256 = { method: 'public-markdown', tokens: coreTokens };
function growth(tokens, options = {}) {
    return { method: 'fixed', adaptive: true, tokens, coreTokens,
        growth: { cutoff: 0.5, returnCore: study !== 'passages', scoreFromCore: sideLocks || settings, ...options } };
}
function expansionGrid() {
    const grid = { core256 };
    for (const tokens of [256, 320, 384, 512]) for (const cutoff of [0.35, 0.5, 0.65]) {
        for (const coreFloor of [undefined, 0.8, 0.9, 0.95]) {
            grid[[tokens, cutoff, coreFloor ?? 'off'].join('/')] = growth(tokens, coreFloor === undefined ? { cutoff } : { cutoff, coreFloor });
        }
    }
    for (const [name, limit] of Object.entries({ wing64: { sideTokens: 64 }, oneUnit: { sideUnits: 1 }, doubleCore: { limitToCore: true } })) {
        grid['384/0.5/0.9/' + name] = growth(384, { coreFloor: 0.9, ...limit });
    }
    grid['384/all/0.9'] = growth(384, { cutoff: -1, coreFloor: 0.9 });
    grid['384/merge/0.9'] = growth(384, { cutoff: 'merge', coreFloor: 0.9 });
    return grid;
}
const candidates = settings ? expansionGrid() : sideLocks ? {
    core256,
    frozenLock: growth(512, { coreFloor: 0.9 }),
    frozenLockTurns: { ...growth(512, { coreFloor: 0.9 }), turnBoundaries: true },
    frozenReopen: growth(512, { coreFloor: 0.9, reopen: true }),
    liveLock: growth(512, { coreFloor: 0.9, scoreFromCore: false }),
    liveReopen: growth(512, { coreFloor: 0.9, scoreFromCore: false, reopen: true }),
} : study === 'embedding-context' ? {
    core256,
    live320: growth(320), guard320: growth(320, { coreFloor: 0.9 }),
    live384: growth(384), guard384: growth(384, { coreFloor: 0.9 }),
    live512: growth(512), guard512: growth(512, { coreFloor: 0.9 }), guard80: growth(512, { coreFloor: 0.8 }),
    wing64: growth(512, { sideTokens: 64 }), deliverWindow: growth(512, { coreFloor: 0.9, returnCore: false }),
} : {
    core256, core320: { method: 'public-markdown', tokens: 320 },
    live256: growth(256), live320: growth(320), live384: growth(384), lowerCutoff: growth(320, { cutoff: 0.35 }),
    twoUnits: growth(320, { sideUnits: 2 }), wing64: growth(320, { sideTokens: 64 }),
    anchor: growth(320, { anchor: true }), doubleCore: growth(320, { limitToCore: true }),
    floor80: growth(320, { coreFloor: 0.8 }), floor90: growth(320, { coreFloor: 0.9 }),
    floor90wide: growth(384, { coreFloor: 0.9 }), floor90lowerCutoff: growth(320, { cutoff: 0.35, coreFloor: 0.9 }),
};
const policies = study === 'embedding-context' && confirmation ? { core256, guard384: candidates.guard384, guard512: candidates.guard512 } : candidates;
const report = { model, dimension, encodingName, study, policies, budgets: [256, 512, 1024], node: process.version,
    metric: 'literal-context-v1', startedUTC: new Date().toISOString(), splits: {} };
const samples = JSON.parse(await readFile(join(here, 'results', '2026-11-23-markdown-samples.json'), 'utf8'));
const meetingData = await meetings();
// Select whole meetings without consulting questions or retrieval outcomes.
const order = meetingData.docs.map((d, i) => [sha256(d.id), i]).sort(([a], [b]) => a.localeCompare(b)).map(v => v[1]);
function meetingSample(start, count = 8) {
    const ids = order.slice(start, start + count), docs = ids.map(d => meetingData.docs[d]);
    const questions = meetingData.questions.filter(q => ids.includes(q.pool[0])).map(q => {
        const d = ids.indexOf(q.pool[0]);
        return { ...q, pool: [d], references: q.references.map(ref => ref.map(([, a, b]) => [d, a, b])) };
    });
    return { docs, questions };
}

function checkGrowth(row, control, policy) {
    const { growth } = row;
    const added = growth.grewPerRound.reduce((a, b) => a + b, 0);
    assert.equal(row.indexTexts, control.indexTexts);
    assert.equal(growth.oneAddition.count + growth.multipleAdditions.count, growth.cosines.count);
    if (growth.guard) {
        assert.equal(growth.guard.tried - growth.guard.rejected, added);
        if (!policy.growth.reopen) assert.equal(growth.guard.reopened, 0);
        if (growth.cosines.count) assert.ok(growth.cosines.min >= policy.growth.coreFloor);
    }
    if (policy.growth.returnCore) assert.equal(row.bodyHash, control.bodyHash);
    if (sideLocks || settings) {
        assert.equal(growth.boundaries.expandedWindows, growth.cosines.count);
        assert.equal(growth.boundaries.addedUnits, added);
        if (policy.turnBoundaries) assert.equal(growth.boundaries.windowsCrossingNewTurns, 0);
    }
}

async function measureView(split, task, dataset, runs, names, prefix = '') {
    const encoder = await openReplay(), frozen = new Map();
    try {
        await prepareDataset(dataset, encoder);
        for (const name of names) {
            const policy = policies[name];
            if (policy.turnBoundaries && (task !== 'qmsum' || prefix)) continue;
            function checkCores(doc, chunks) {
                const hash = sha256(JSON.stringify(chunks.map(c => [c.text, c.sourceRanges])));
                if (name === 'core256') frozen.set(doc, hash);
                else assert.equal(hash, frozen.get(doc));
            }
            const selected = { ...policy, turnBoundaries: policy.turnBoundaries || (settings && task === 'qmsum'),
                checkCores: name === 'core320' ? undefined : checkCores, auditBoundaries: sideLocks || settings, countTurns: task === 'qmsum' && !prefix };
            const row = await evaluate(task, dataset, selected, encoder, 'overlap');
            assert.equal(row.overTarget, 0);
            assert.equal(row.overEmbeddingLimit, 0);
            assert.ok(row.indexChunkTokens.max <= policy.tokens);
            if (policy.growth) checkGrowth(row, runs[prefix + 'core256'][task], selected);
            if (name === 'deliverWindow') {
                const fixed = runs.guard512[task];
                for (const key of ['indexHash', 'indexChunkTokens', 'embeddedTokens', 'calls', 'growth']) assert.deepEqual(row[key], fixed[key]);
            }
            (runs[prefix + name] ??= {})[task] = row;
            const arm = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
            const metric = task === 'qmsum' ? (100 * row.retrieval[arm][512].recall).toFixed(2) + '% recall' :
                row.retrieval[arm][512].complete + '/' + row.questions;
            console.log(split, task, prefix + name, metric, row.encoder.apiInputTokens, 'new tokens');
        }
        return { ...encoder.stats };
    } finally { encoder.close(); }
}

async function measureSplit(split, data, names) {
    const results = report.splits[split] = { samples: {}, runs: {} };
    for (const [task, dataset] of Object.entries(data)) {
        const groups = dataset.questions.map(q => task === 'hotpotqa' ? (q.pooled?.[0] ?? 0) : q.group);
        const metadata = results.samples[task] = { ...manifest({ [task]: dataset })[task], groups };
        if (settings && split === 'replication') {
            const calibration = report.splits.calibration.samples[task];
            for (const field of ['documents', 'questions']) assert.ok(!metadata[field].some(id => calibration[field].includes(id)));
            if (task !== 'hotpotqa') assert.ok(!groups.some(id => calibration.groups.includes(id)));
        }
        const flat = sideLocks && flattenCorpus(dataset);
        metadata.encoder = await measureView(split, task, dataset, results.runs, names);
        if (flat) {
            metadata.flat = manifest({ [task]: flat })[task];
            metadata.flat.encoder = await measureView(split, task, flat, results.runs, names, 'flat/');
        }
    }
    if (settings) results.outcomes = summarizeExpansion(results);
    return results;
}

if (meetingCheck) {
    const raw = await readFile(sample, 'utf8'), prior = JSON.parse(raw);
    assert.equal(prior.study, study);
    const rows = prior.splits.calibration.outcomes.meetings;
    const best = Object.keys(rows).filter(k => k !== 'core256')
        .sort((a, b) => rows[b].percent - rows[a].percent || rows[a].embeddedTokens - rows[b].embeddedTokens)[0];
    const names = [...new Set(['core256', prior.nominees.meetings, best, '384/0.5/0.9', '384/0.35/0.9'])];
    report.calibrationReportSHA256 = sha256(raw);
    report.nominees = { meetings: prior.nominees.meetings, highestCalibrationRecall: best };
    report.policies = Object.fromEntries(names.map(name => [name, policies[name]]));
    for (const name of names) assert.deepEqual(policies[name], prior.policies[name]);
    const qmsum = await meetings('val');
    const seen = new Set(meetingData.docs.map(doc => sha256(doc.source)));
    for (const doc of qmsum.docs) {
        const hash = sha256(doc.source);
        assert.ok(!seen.has(hash));
        seen.add(hash);
    }
    await measureSplit('meeting-validation', { qmsum }, names);
} else {
    const splits = settings ? [['calibration', 0, 24], ['replication', 24, order.length - 24]] :
        confirmation ? [['confirmation', 16]] : [['final', 0], ['rules-test', 8]];
    let names = Object.keys(policies);
    for (const [split, start, count] of splits) {
        const data = await markdownCorpora(split);
        assert.deepEqual(manifest(data), samples[split]);
        data.qmsum = meetingSample(start, count);
        const results = await measureSplit(split, data, names);
        if (settings && split === 'calibration') {
            report.nominees = Object.fromEntries(Object.entries(results.outcomes).map(([group, rows]) => [group, selectExpansion(rows, policies)]));
            // Vary exactly one factor around the reference, plus each nominated setting.
            names = [...new Set(['core256', '256/0.5/0.9', '320/0.5/0.9', '384/0.5/0.9', '512/0.5/0.9',
                '384/0.35/0.9', '384/0.65/0.9', '384/merge/0.9', '384/0.5/off', '384/0.5/0.8', '384/0.5/0.95',
                ...Object.values(report.nominees)])];
            console.log('Frozen expansion nominees', report.nominees);
        }
    }
    if (!settings) summarizeOverlap(report);
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
