import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { here } from './corpora.mjs';
import { model, openEncoder, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { evaluateQuality } from './quality.mjs';
import { friendsDialogue, meetings } from './semantic-corpora.mjs';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new result path.');
const checkpoint = output + '.partial';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const candidates = ['0.05', '0', '0.15', '0.3', '0.5', 'document'];
const methods = [...candidates, 'blocks', 'semantic'];
const deliveries = [['five512', 5, 512], ['five1024', 5, 1024]];
const formats = { cuad: 'text', qasper: 'markdown', finqa: 'markdown', hotpotqa: 'markdown', qmsum: 'text', friendsqa: 'text' };
const tasks = [...Object.keys(formats), 'squad'];
const protocol = { model, candidates, controls: ['blocks', 'semantic'], formats, chunkTokens: 256, deliveries,
    qualityCharacters: [250, 500, 1000], qualitySelectionCharacters: 500, squadDeliveryTokens: 256,
    documentSplits: ['calibration', 'replication'], meetingSplits: ['val', 'test'], dialogueSplits: ['dev', 'test'],
    selection: 'Highest equal-dataset mean on calibration. Use complete evidence at five512, average both HotpotQA pools, use QMSum evidence recall and SQuAD answer hits. Exact ties follow candidate order. Report WikiSection F1 separately.' };
const report = existsSync(checkpoint) ? read(checkpoint) : { protocol, quality: {}, retrieval: {}, summary: {} };
assert.deepEqual(report.protocol, protocol);
function save() {
    writeFileSync(checkpoint + '.tmp', JSON.stringify(report, null, 2) + '\n');
    renameSync(checkpoint + '.tmp', checkpoint);
}
function options(name) {
    if (name === 'semantic' || name === 'blocks') return { chunkingStrategy: name };
    return name === 'document' ? { chunkingStrategy: 'semantic-blocks', mergeThresholdMode: 'document' }
        : { chunkingStrategy: 'semantic-blocks', combineChunksSimilarityThreshold: Number(name) };
}
const mean = numbers => numbers.reduce((a, b) => a + b, 0) / numbers.length;

for (const task of ['squad', 'wikisection']) {
    if (report.quality[task]) continue;
    const encoder = openEncoder();
    try {
        const plans = {};
        for (const size of protocol.qualityCharacters) for (const name of methods) {
            plans[size + '/' + name] = { ...options(name), maxChunkSize: size };
        }
        report.quality[task] = await evaluateQuality(task, chunkText, encoder, plans);
        save();
        console.log('Finished', task, 'calibration and held-out');
    } finally { encoder.close(); }
}

const documentManifest = read(join(here, 'results/2026-11-23-markdown-samples.json'));
async function measure(task, dataset, phase, budget = { tokens: protocol.chunkTokens }) {
    const sample = manifest({ [task]: dataset })[task];
    if (task === 'friendsqa' && phase === 'heldout') {
        assert.deepEqual(JSON.parse(JSON.stringify(sample)), read(join(here, 'results/2026-11-24-auto-dialogue-large.json')).sample);
    }
    if (phase === 'heldout') {
        const previous = report.retrieval.calibration[task].sample;
        for (const field of ['documents', 'questions']) {
            const seen = new Set(previous[field]);
            assert.ok(sample[field].every(id => !seen.has(id)), 'Split overlap in ' + task + ' ' + field);
        }
    }
    const encoder = await openReplay(undefined, undefined, { concurrency: 4 });
    try {
        await prepareDataset(dataset, encoder);
        const rows = {};
        for (const name of methods) {
            const policy = { method: formats[task] === 'markdown' ? 'public-markdown' : 'plain-priority',
                ...budget, ...options(name) };
            const row = await evaluate(task, dataset, policy, encoder, 'semantic', { deliveries });
            if (budget.tokens) assert.equal(row.overTarget, 0);
            rows[name] = { retrieval: row.retrieval, hits: row.hits, ...(row.recalls && { recalls: row.recalls }),
                bodyHash: row.bodyHash, chunks: row.indexTexts, indexingTokens: row.embeddedTokens,
                ...(budget.chars && { overCharacterTarget: row.overTarget }) };
        }
        return { sample, groups: dataset.questions.map(q => q.group), rows, newEmbeddingTokens: encoder.stats.apiInputTokens };
    } finally { encoder.close(); }
}

function summarize(phase, delivery) {
    return Object.fromEntries(methods.map(name => {
        const perDataset = {};
        for (const task of tasks) {
            if (task === 'squad') {
                perDataset[task] = report.quality.squad.scores[protocol.qualitySelectionCharacters + '/' + name][phase].hitRate;
                continue;
            }
            const { sample, rows } = report.retrieval[phase][task];
            perDataset[task] = mean(Object.values(rows[name].retrieval).map(arm => task === 'qmsum'
                ? arm[delivery].recall : arm[delivery].complete / sample.questions.length));
        }
        return [name, { perDataset, mean: mean(Object.values(perDataset)) }];
    }));
}

for (const phase of ['calibration', 'heldout']) {
    const heldout = phase === 'heldout', split = protocol.documentSplits[Number(heldout)];
    const data = await markdownCorpora(split);
    assert.deepEqual(manifest(data), documentManifest[split]);
    const results = report.retrieval[phase] ??= {};
    for (const task of Object.keys(formats)) {
        if (results[task]) continue;
        let dataset = data[task];
        if (task === 'qmsum') dataset = await meetings(protocol.meetingSplits[Number(heldout)]);
        if (task === 'friendsqa') dataset = (await friendsDialogue(protocol.dialogueSplits[Number(heldout)])).dataset;
        console.log('Running', phase, task, 'with', dataset.questions.length, 'questions');
        results[task] = await measure(task, dataset, phase);
        save();
        delete data[task];
        console.log('Finished', phase, task, 'new embedding tokens', results[task].newEmbeddingTokens);
    }
    report.summary[phase] = Object.fromEntries(deliveries.map(([key]) => [key, summarize(phase, key)]));
    if (!heldout) {
        const scores = report.summary.calibration.five512;
        report.selectedCutoff = candidates.reduce((best, name) => scores[name].mean > scores[best].mean ? name : best);
        console.log('Calibration selected', report.selectedCutoff);
    }
    save();
}

// Check the released character targets on a third sample after selecting on token-limited retrieval.
const characterCheck = report.publicCharacterSizes ??= { split: 'confirmation', characters: { markdown: 1024, text: 500 }, tasks: {} };
const characterData = await markdownCorpora(characterCheck.split);
assert.deepEqual(manifest(characterData), documentManifest[characterCheck.split]);
for (const [task, dataset] of Object.entries(characterData)) {
    if (characterCheck.tasks[task]) continue;
    const chars = characterCheck.characters[formats[task]];
    console.log('Checking', task, 'at', chars, 'characters');
    characterCheck.tasks[task] = await measure(task, dataset, 'public-character-sizes', { chars });
    save();
}
renameSync(checkpoint, output);
console.log('Saved', output);
