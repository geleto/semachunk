import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { chunkText } from '../src/index.js';
import { denseRanker, split as splitPlain, vocabulary } from './chunking.mjs';
import { sha256 } from './corpora.mjs';
import { deliver, evidenceScore, goldReference } from './delivered-context.mjs';
import { dimension, encodingName, model, modelInputTokens, openReplay } from './encoder.mjs';
import { documentRule, indexDocument } from './markdown-index.mjs';
import { studyRules } from './markdown-rules.mjs';
import { macro, paired, selectCombination } from './markdown-decisions.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { bm25Ranker, budgets, wordCounts } from './rag.mjs';
import { compareRetrieval, reciprocalRankFusion } from './retrieval-baselines.mjs';

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const [experiment, output, previous, candidate] = process.argv.slice(2);
const ruleStudy = ['rules', 'validate-rules', 'replicate-rules'].includes(experiment);
const baselines = experiment === 'baselines';
const split = ({ 'validate-rules': 'rules-test', 'replicate-rules': 'replication', baselines: 'replication', confirm: 'confirmation', final: 'final' })[experiment] ?? 'calibration';
if (!output || (!ruleStudy && !baselines && !['size', 'compare', 'context', 'final', 'confirm'].includes(experiment))) {
    throw new Error('Supply a Markdown study experiment and a new JSON output path.');
}
if (existsSync(output)) throw new Error('Result already exists: ' + output);
const prior = previous ? await read(previous) : {};
const data = await markdownCorpora(split), samples = manifest(data);
const frozen = await read(new URL('./results/2026-11-23-markdown-samples.json', import.meta.url));
assert.deepEqual(samples, frozen[split]);
const encoder = await openReplay(), { countTokens } = encoder;
const report = { experiment, split, samplesSHA256: sha256(JSON.stringify(samples)), metric: 'literal-context-v1',
    model, dimension, encodingName, budgets, node: process.version, startedUTC: new Date().toISOString(), policies: {} };
const tasks = Object.keys(data);

function distribution(values) {
    const v = values.toSorted((a, b) => a - b);
    if (!v.length) return { count: 0 };
    return { count: v.length, min: v[0], p10: v[Math.floor(v.length * 0.1)], median: v[Math.floor(v.length / 2)],
        p90: v[Math.floor(v.length * 0.9)], max: v.at(-1) };
}

async function prepare() {
    for (const dataset of Object.values(data)) {
        const { docs, questions } = dataset;
        for (const doc of docs) {
            doc.offsets = encoder.offsets(doc.source);
            doc.ends = doc.offsets.map(o => o[1]);
            if (baselines || experiment === 'size' || experiment === 'final') doc.parts = await splitPlain(chunkText, doc.source);
            doc.parsed = new Map();
        }
        for (const q of questions) q.gold = q.references.map(ref => goldReference(ref, docs));
        await encoder.embed(questions.map(q => q.text));
    }
}

async function evaluate(task, policy) {
    const { docs, questions } = data[task];
    const start = performance.now(), paid = { ...encoder.stats };
    const costs = { calls: 0, texts: 0, singletons: 0, embeddedTokens: 0, indexTexts: 0, indexTokens: 0 };
    const initial = [], context = { retained: 0, shortened: 0, omitted: 0, alreadyPresentOrUnavailable: 0 };
    let semanticDocuments = 0;
    const byDoc = await Promise.all(docs.map(async (doc, d) => {
        const selected = documentRule(doc, policy, countTokens);
        if (selected.method === 'fixed') semanticDocuments++;
        const key = JSON.stringify(selected, Object.keys(selected).sort());
        if (ruleStudy) doc.layouts ??= new Map();
        let layout = doc.layouts?.get(key);
        if (!layout) {
            const work = Object.fromEntries(Object.keys(costs).map(k => [k, 0])), scores = [];
            const rows = await indexDocument(doc, selected, work, scores, context, encoder);
            layout = { work, scores, rows: rows.map(row => ({ ...row, doc: d })) };
            doc.layouts?.set(key, layout);
        }
        for (const k of Object.keys(costs)) costs[k] += layout.work[k];
        for (const score of layout.scores) initial.push(score);
        return layout.rows;
    }));
    const bodyHash = sha256(JSON.stringify(byDoc.map(rows => rows.map(c => [c.text, c.sourceRanges]))));
    const layouts = ruleStudy && byDoc.map(rows => sha256(JSON.stringify(rows.map(c => [c.text, c.sourceRanges, c.embeddingText]))));
    const vocab = vocabulary();
    for (const c of byDoc.flat()) c.index = vocab.intern(c.embeddingText ?? c.text);
    for (const q of questions) vocab.intern(q.text);
    const vectors = await encoder.embed(vocab.texts), matrix = new Float32Array(vectors.length * dimension);
    vectors.forEach((v, i) => matrix.set(v, i * dimension));
    const dense = denseRanker(matrix), pools = new Map(), retrieval = {}, complete512 = {}, examples = {};
    const all = docs.map((_, d) => d);
    for (const [i, q] of questions.entries()) {
        for (const [name, pool] of task === 'hotpotqa' ? [['shortlist', q.pool], ['pooled', q.pooled ?? all]] : [['document', q.pool]]) {
            const key = name + pool.join(',');
            if (!pools.has(key)) {
                const passages = pool.flatMap(d => byDoc[d]);
                pools.set(key, { passages, indices: passages.map(p => p.index), bm25: bm25Ranker(passages.map(p => wordCounts(p.text))),
                    layout: ruleStudy && sha256(pool.map(d => d + '/' + layouts[d]).join(',')) });
            }
            const { passages, indices, bm25, layout } = pools.get(key);
            if (ruleStudy) q.scores ??= new Map();
            let measured = q.scores?.get(layout);
            if (!measured) {
                measured = [];
                const semantic = dense(vocab.id(q.text), indices), terms = wordCounts(q.text);
                const rankings = [['dense', semantic], ['bm25', bm25(terms)]];
                if (baselines) rankings.push(['hybrid', reciprocalRankFusion(semantic, bm25(terms, true))]);
                for (const [ranker, order] of rankings) {
                    const ranked = order.map(j => passages[j]);
                    for (const budget of budgets) {
                        const { projected, text } = deliver(ranked, budget, encoder);
                        const metrics = evidenceScore(projected, q.gold);
                        const trace = i === 0 && budget === 512 && ranker === 'dense' && { id: q.id, first: ranked[0].sourceRanges,
                            doc: ranked[0].doc, deliveredSHA256: sha256(text), ...metrics };
                        measured.push({ ranker, budget, metrics, spent: projected.length, trace });
                    }
                }
                q.scores?.set(layout, measured);
            }
            for (const { ranker, budget, metrics, spent, trace } of measured) {
                const arm = name + '/' + ranker;
                const scores = retrieval[arm] ??= {};
                const total = scores[budget] ??= { complete: 0, recall: 0, precision: 0, deliveredTokens: 0 };
                total.complete += metrics.complete;
                for (const k of ['recall', 'precision']) total[k] += metrics[k] / questions.length;
                total.deliveredTokens += spent / questions.length;
                if (budget === 512 && (ranker === 'dense' || baselines)) {
                    complete512[arm] = (complete512[arm] ?? '') + metrics.complete;
                    if (trace) examples[name] = trace;
                }
            }
        }
    }
    return { questions: questions.length, bodyHash, chunkTokens: distribution(byDoc.flat().map(c => countTokens(c.text))),
        ...costs, ...(ruleStudy && { semanticDocuments }),
        ...(baselines && { overTarget: byDoc.flat().filter(c => policy.tokens ? countTokens(c.text) > policy.tokens : c.text.length > policy.chars).length }),
        ...(policy.context && { context }), ...(initial.length && { eligibleCosines: distribution(initial) }),
        retrieval, complete512, examples, milliseconds: performance.now() - start, peakRSSKiB: process.resourceUsage().maxRSS,
        encoder: Object.fromEntries(Object.entries(encoder.stats).map(([k, n]) => [k, n - paid[k]])) };
}

async function run(name, policy, subset = tasks) {
    const row = { policy, tasks: {} };
    for (const task of subset) row.tasks[task] = await evaluate(task, policy);
    if (subset.length === tasks.length) row.macroComplete512 = macro(row);
    report.policies[name] = row;
    console.log(name, row.macroComplete512 ?? subset, encoder.stats.apiRequests, 'paid requests so far');
    return row;
}

async function main() {
    await prepare();
    if (baselines) return compareRetrieval(report, data, run);
    if (ruleStudy) return studyRules({ report, prior, data, run, validation: experiment !== 'rules' });
    const tokens = prior.tokens;
    if (experiment === 'size') {
        for (const size of [128, 256, 512]) await run('plain-' + size, { method: 'plain-pack', tokens: size });
        const best = Object.values(report.policies).sort((a, b) => macro(b) - macro(a) || b.policy.tokens - a.policy.tokens)[0];
        report.tokens = best.policy.tokens;
        return;
    }
    if (![128, 256, 512].includes(tokens)) throw new Error('Previous report is missing the selected token budget');
    report.tokens = tokens;
    const pack = { method: 'pack', tokens };
    if (experiment === 'compare') {
        await run('pack', pack);
        for (const method of ['fixed', 'rescore']) {
            const names = [];
            for (const cutoff of [0.3, 0.5, 0.7, 'document']) {
                const name = method + '-' + cutoff;
                await run(name, { method, tokens, ...(cutoff === 'document' ? { adaptive: true } : { cutoff }) });
                names.push(name);
            }
            const best = names.sort((a, b) => macro(report.policies[b]) - macro(report.policies[a]))[0];
            report[method] = best;
        }
        for (const name of ['pack', report.fixed, report.rescore]) {
            await run(name + '-lead', { ...report.policies[name].policy, leadIn: true });
        }
        selectCombination(report, data);
        await run('sentence-units', { ...report.winner, sentences: true }, ['qasper']);
        return;
    }
    assert.ok(prior.winner && prior.shortlist, 'Previous report is missing the calibration shortlist');
    report.winner = candidate ? prior.shortlist[candidate] : prior.winner;
    assert.ok(report.winner, 'Select a candidate from the frozen shortlist');
    report.shortlist = { ...prior.shortlist };
    if (experiment === 'confirm') {
        assert.ok(candidate && report.winner.method === 'fixed');
        for (const size of [{ chars: 500 }, { tokens }]) {
            const suffix = size.chars ? '-chars' : '-tokens';
            const base = await run('pack' + suffix, { method: 'pack', ...size });
            const adaptive = await run('fixed-document' + suffix, { method: 'fixed', adaptive: true, ...size });
            report.comparisons ??= {};
            report.comparisons['adaptive' + suffix] = paired(adaptive, base, data);
            if (size.chars) {
                const fixed = await run('fixed-0.5-chars', { method: 'fixed', cutoff: 0.5, ...size });
                report.comparisons['fixed-0.5-chars'] = paired(fixed, base, data);
            }
        }
        return;
    }
    if (experiment === 'context') {
        const base = await run('baseline', report.winner);
        const frozenWinner = Object.values(prior.policies).find(r => JSON.stringify(r.policy) === JSON.stringify(report.winner));
        for (const t of tasks) assert.equal(base.tasks[t].bodyHash, frozenWinner.tasks[t].bodyHash);
        report.comparisons = {};
        for (const cap of [tokens, modelInputTokens]) {
            let control = base;
            for (const context of ['title', 'headings']) {
                const name = context + '-' + cap;
                const row = await run(name, { ...report.winner, context, contextCap: cap });
                for (const t of tasks) {
                    assert.equal(row.tasks[t].bodyHash, base.tasks[t].bodyHash);
                    for (const key of Object.keys(base.tasks[t].retrieval).filter(s => s.endsWith('bm25'))) {
                        assert.deepEqual(row.tasks[t].retrieval[key], base.tasks[t].retrieval[key]);
                    }
                }
                const test = paired(row, control, data);
                report.comparisons[name] = test;
                if (cap === tokens && test.ci95[0] > 0 && paired(row, base, data).ci95[0] > 0) report.shortlist[name] = row.policy;
                control = row;
            }
        }
        return;
    }
    for (const [name, policy] of Object.entries(report.shortlist)) await run(name, policy);
    const controls = { 'plain-default': { method: 'plain-priority', chars: 500 }, 'markdown-default': { method: 'pack', chars: 500 },
        'plain-pack': { method: 'plain-pack', tokens }, 'plain-priority': { method: 'plain-priority', tokens },
        'window-128': { method: 'window', tokens: 128 } };
    if (tokens !== 128) controls['window-' + tokens] = { method: 'window', tokens };
    for (const [name, policy] of Object.entries(controls)) await run(name, policy);
    report.comparisons = {};
    for (const name of Object.keys(report.policies).filter(n => n !== 'pack')) {
        report.comparisons[name + ' vs pack'] = paired(report.policies[name], report.policies.pack, data);
    }
    const original = Object.keys(report.shortlist).find(k => report.shortlist[k].method === 'fixed' && !report.shortlist[k].leadIn);
    for (const [name, policy] of Object.entries(report.shortlist)) {
        if (original && (policy.method === 'rescore' || (policy.method === 'fixed' && policy.leadIn))) {
            report.comparisons[name + ' vs ' + original] = paired(report.policies[name], report.policies[original], data);
        }
    }
}

try {
    await main();
    report.encoder = encoder.stats;
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { encoder.close(); }
