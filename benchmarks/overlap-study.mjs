import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { here, sha256 } from './corpora.mjs';
import { dimension, encodingName, model, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { summarizeOverlap } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { meetings } from './semantic-corpora.mjs';

const [output, study = 'passages', sample] = process.argv.slice(2);
if (!output || existsSync(output)) throw new Error('Supply a new JSON output path.');
if (!['passages', 'embedding-context'].includes(study)) throw new Error('Choose passages or embedding-context.');
const embeddingContext = study === 'embedding-context';
if (sample !== undefined && (!embeddingContext || sample !== 'confirmation')) throw new Error('The optional embedding context sample is confirmation.');
const confirmation = sample === 'confirmation';
const coreTokens = 256;
const core256 = { method: 'public-markdown', tokens: coreTokens };
function growth(tokens, options = {}) {
    return { method: 'fixed', adaptive: true, tokens, coreTokens, growth: { cutoff: 0.5, returnCore: embeddingContext, ...options } };
}
const candidates = embeddingContext ? {
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
const policies = confirmation ? { core256, guard384: candidates.guard384, guard512: candidates.guard512 } : candidates;
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

const samplesToRun = confirmation ? [['confirmation', 16]] : [['final', 0], ['rules-test', 8]];
for (const [split, meetingStart] of samplesToRun) {
    const data = await markdownCorpora(split);
    assert.deepEqual(manifest(data), samples[split]);
    data.qmsum = meetingSample(meetingStart);
    const results = report.splits[split] = { samples: {}, runs: {} };
    for (const [task, dataset] of Object.entries(data)) {
        const encoder = await openReplay();
        try {
            const { questions } = dataset;
            const groups = questions.map(q => task === 'hotpotqa' ? (q.pooled?.[0] ?? 0) : q.group);
            results.samples[task] = { ...manifest({ [task]: dataset })[task], groups };
            await prepareDataset(dataset, encoder);
            const frozen = new Map();
            for (const [name, policy] of Object.entries(policies)) {
                function checkCores(doc, chunks) {
                    const hash = sha256(JSON.stringify(chunks.map(c => [c.text, c.sourceRanges])));
                    if (name === 'core256') frozen.set(doc, hash);
                    else assert.equal(hash, frozen.get(doc));
                }
                const row = await evaluate(task, dataset, { ...policy, checkCores: name === 'core320' ? undefined : checkCores }, encoder, 'overlap');
                assert.equal(row.overTarget, 0);
                assert.equal(row.overEmbeddingLimit, 0);
                assert.ok(row.indexChunkTokens.max <= policy.tokens);
                if (policy.growth) {
                    assert.equal(row.indexTexts, results.runs.core256[task].indexTexts);
                    assert.equal(row.growth.oneAddition.count + row.growth.multipleAdditions.count, row.growth.grewPerRound[0] ?? 0);
                    if (policy.growth.coreFloor && row.growth.cosines.count) assert.ok(row.growth.cosines.min >= policy.growth.coreFloor);
                    if (policy.growth.returnCore) assert.equal(row.bodyHash, results.runs.core256[task].bodyHash);
                    if (row.growth.guard) {
                        const { preferred, fallback } = row.growth.guard;
                        assert.equal(preferred.tried - preferred.rejected + fallback.tried - fallback.rejected,
                            row.growth.grewPerRound.reduce((a, b) => a + b, 0));
                    }
                }
                if (name === 'deliverWindow') {
                    const fixed = results.runs.guard512[task];
                    for (const key of ['indexHash', 'indexChunkTokens', 'embeddedTokens', 'calls', 'growth']) assert.deepEqual(row[key], fixed[key]);
                }
                (results.runs[name] ??= {})[task] = row;
                const arm = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
                console.log(split, task, name, row.retrieval[arm][512].complete, '/', questions.length, row.encoder.apiInputTokens, 'new tokens');
            }
            results.samples[task].encoder = { ...encoder.stats };
        } finally { encoder.close(); }
    }
}
summarizeOverlap(report);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
