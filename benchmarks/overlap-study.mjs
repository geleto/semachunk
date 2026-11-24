import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { here, sha256 } from './corpora.mjs';
import { dimension, encodingName, model, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { summarizeOverlap } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { flattenCorpus, meetings } from './semantic-corpora.mjs';

const [output, study = 'passages', sample] = process.argv.slice(2);
if (!output || existsSync(output)) throw new Error('Supply a new JSON output path.');
if (!['passages', 'embedding-context', 'side-locks'].includes(study)) throw new Error('Choose passages, embedding-context or side-locks.');
const sideLocks = study === 'side-locks';
if (sample !== undefined && (study !== 'embedding-context' || sample !== 'confirmation')) throw new Error('The optional embedding context sample is confirmation.');
const confirmation = sideLocks || sample === 'confirmation';
const coreTokens = 256;
const core256 = { method: 'public-markdown', tokens: coreTokens };
function growth(tokens, options = {}) {
    return { method: 'fixed', adaptive: true, tokens, coreTokens,
        growth: { cutoff: 0.5, returnCore: study !== 'passages', scoreFromCore: sideLocks, ...options } };
}
const candidates = sideLocks ? {
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
const policies = sample === 'confirmation' ? { core256, guard384: candidates.guard384, guard512: candidates.guard512 } : candidates;
const report = { model, dimension, encodingName, study, policies, budgets: [256, 512, 1024], node: process.version,
    metric: 'literal-context-v1', startedUTC: new Date().toISOString(), splits: {} };
const samples = JSON.parse(await readFile(join(here, 'results', '2026-11-23-markdown-samples.json'), 'utf8'));
const meetingData = await meetings();
// Select whole meetings without consulting questions or retrieval outcomes.
const order = meetingData.docs.map((d, i) => [sha256(d.id), i]).sort(([a], [b]) => a.localeCompare(b)).map(v => v[1]);
function meetingSample(start) {
    const ids = order.slice(start, start + 8), docs = ids.map(d => meetingData.docs[d]);
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
    if (sideLocks) {
        assert.equal(growth.boundaries.expandedWindows, growth.cosines.count);
        assert.equal(growth.boundaries.addedUnits, added);
        if (policy.turnBoundaries) assert.equal(growth.boundaries.windowsCrossingNewTurns, 0);
    }
}

async function measureView(split, task, dataset, runs, prefix = '') {
    const encoder = await openReplay(), frozen = new Map();
    try {
        await prepareDataset(dataset, encoder);
        for (const [name, policy] of Object.entries(policies)) {
            if (policy.turnBoundaries && (task !== 'qmsum' || prefix)) continue;
            function checkCores(doc, chunks) {
                const hash = sha256(JSON.stringify(chunks.map(c => [c.text, c.sourceRanges])));
                if (name === 'core256') frozen.set(doc, hash);
                else assert.equal(hash, frozen.get(doc));
            }
            const row = await evaluate(task, dataset, { ...policy, checkCores: name === 'core320' ? undefined : checkCores,
                auditBoundaries: sideLocks, countTurns: task === 'qmsum' && !prefix }, encoder, 'overlap');
            assert.equal(row.overTarget, 0);
            assert.equal(row.overEmbeddingLimit, 0);
            assert.ok(row.indexChunkTokens.max <= policy.tokens);
            if (policy.growth) checkGrowth(row, runs[prefix + 'core256'][task], policy);
            if (name === 'deliverWindow') {
                const fixed = runs.guard512[task];
                for (const key of ['indexHash', 'indexChunkTokens', 'embeddedTokens', 'calls', 'growth']) assert.deepEqual(row[key], fixed[key]);
            }
            (runs[prefix + name] ??= {})[task] = row;
            const arm = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
            console.log(split, task, prefix + name, row.retrieval[arm][512].complete, '/', row.questions, row.encoder.apiInputTokens, 'new tokens');
        }
        return { ...encoder.stats };
    } finally { encoder.close(); }
}

const samplesToRun = confirmation ? [['confirmation', 16]] : [['final', 0], ['rules-test', 8]];
for (const [split, meetingStart] of samplesToRun) {
    const data = await markdownCorpora(split);
    assert.deepEqual(manifest(data), samples[split]);
    data.qmsum = meetingSample(meetingStart);
    const results = report.splits[split] = { samples: {}, runs: {} };
    for (const [task, dataset] of Object.entries(data)) {
        const groups = dataset.questions.map(q => task === 'hotpotqa' ? (q.pooled?.[0] ?? 0) : q.group);
        const metadata = results.samples[task] = { ...manifest({ [task]: dataset })[task], groups };
        const flat = sideLocks && flattenCorpus(dataset);
        metadata.encoder = await measureView(split, task, dataset, results.runs);
        if (flat) {
            metadata.flat = manifest({ [task]: flat })[task];
            metadata.flat.encoder = await measureView(split, task, flat, results.runs, 'flat/');
        }
    }
}
summarizeOverlap(report);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
