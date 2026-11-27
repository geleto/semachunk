import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { model, openReplay } from './encoder.mjs';
import { markdownCorpora } from './markdown-corpora.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { groupInterval } from './markdown-decisions.mjs';

const { values } = parseArgs({ options: {
    task: { type: 'string', default: 'qasper' }, format: { type: 'string', default: 'markdown' },
    split: { type: 'string', default: 'confirmation' }, chars: { type: 'string' }, tokens: { type: 'string' },
    'new-tokens': { type: 'string', default: '0' }, cutoffs: { type: 'string' }, output: { type: 'string' }
} });
if (values.output && existsSync(values.output)) throw new Error('Result already exists: ' + values.output);
if (!['qasper', 'cuad', 'finqa'].includes(values.task) || !['markdown', 'text'].includes(values.format)) {
    throw new Error('Choose qasper, cuad or finqa and markdown or text.');
}
if (values.chars !== undefined && values.tokens !== undefined) throw new Error('Choose one size unit for this comparison.');
const size = Number(values.chars ?? values.tokens ?? 256), maxNewTokens = Number(values['new-tokens']);
if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(maxNewTokens) || maxNewTokens < 0) {
    throw new Error('Supply a positive chunk size and a nonnegative new-token budget.');
}
const budget = values.chars === undefined ? { tokens: size } : { chars: size };
const variants = [{ name: 'semantic', chunkingStrategy: 'semantic' }, { name: 'semantic-blocks', chunkingStrategy: 'semantic-blocks' },
    { name: 'blocks', chunkingStrategy: 'blocks' }];
for (const value of values.cutoffs?.split(',') ?? []) {
    const cutoff = Number(value);
    if (!value.trim() || !Number.isFinite(cutoff)) throw new Error('Supply finite comma-separated cutoffs.');
    variants.push({ name: 'semantic-blocks/' + cutoff, chunkingStrategy: 'semantic-blocks', combineChunksSimilarityThreshold: cutoff });
}
const method = values.format === 'markdown' ? 'public-markdown' : 'plain-priority';
const deliveries = [['five512', 5, 512], ['five1024', 5, 1024]];
const [corpora, encoder] = await Promise.all([markdownCorpora(values.split), openReplay(undefined, undefined, { maxNewTokens })]);
try {
    const data = corpora[values.task];
    await prepareDataset(data, encoder);
    const report = { model, task: values.task, format: values.format, split: values.split, budget, deliveries,
        documents: data.docs.length, questions: data.questions.length, rows: {}, paired: {} };
    for (const { name, ...variant } of variants) {
        const row = await evaluate(values.task, data, { method, ...variant, ...budget }, encoder, 'semantic', { deliveries });
        report.rows[name] = { bodyHash: row.bodyHash, chunks: row.indexTexts, indexingTokens: row.embeddedTokens,
            indexingCalls: row.calls, overTarget: row.overTarget, hits: row.hits['document/dense'] };
    }
    function paired(candidateName, key) {
        const original = report.rows.semantic.hits[key], candidate = report.rows[candidateName].hits[key];
        const groups = new Map();
        let gains = 0, losses = 0;
        data.questions.forEach((q, i) => {
            const delta = Number(candidate[i]) - Number(original[i]);
            const group = groups.get(q.group) ?? [0, 0];
            group[0] += delta; group[1]++;
            groups.set(q.group, group);
            if (delta > 0) gains++;
            if (delta < 0) losses++;
        });
        return { gains, losses, deltaPoints: 100 * (gains - losses) / original.length,
            ci95: groupInterval([[...groups.values()]]) };
    }
    for (const [key] of deliveries) report.paired[key] = paired('semantic-blocks', key);
    if (values.cutoffs) {
        report.cutoffComparisons = Object.fromEntries(variants.slice(3).map(({ name }) =>
            [name, Object.fromEntries(deliveries.map(([key]) => [key, paired(name, key)]))]));
    }
    report.newEmbeddingTokens = encoder.stats.apiInputTokens;
    const json = JSON.stringify(report, null, 2);
    if (values.output) await writeFile(values.output, json + '\n', { flag: 'wx' });
    console.log(json);
} finally {
    encoder.close();
}
