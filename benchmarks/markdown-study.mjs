import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { chunkText } from '../src/index.js';
import { createBatchEmbedder } from '../src/embeddings.js';
import { markdownResult, parseMarkdown } from '../src/markdown.js';
import { tokenBudget } from '../src/token-limit.js';
import { denseRanker, packSentences, split as splitPlain, vocabulary } from './chunking.mjs';
import { sha256 } from './corpora.mjs';
import { alignPlain, deliver, evidenceScore, goldReference, tokenWindows } from './delivered-context.mjs';
import { dimension, encodingName, model, modelInputTokens, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { combineMarkdown } from './markdown-merging.mjs';
import { bm25Ranker, budgets, wordCounts } from './rag.mjs';

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const [experiment, output, previous] = process.argv.slice(2);
const split = experiment === 'final' ? 'final' : 'calibration';
if (!['size', 'compare', 'context', 'final'].includes(experiment) || !output) {
    throw new Error('Use markdown-study.mjs size|compare|context|final NEW-OUTPUT.json [PREVIOUS-REPORT.json]');
}
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

// Only the indexing input changes across context arms. Drop the outermost
// heading first, then the title. An existing caller prefix is always required.
function contextualize(chunk, doc, policy, counts) {
    const base = chunk.embeddingText ?? chunk.text, required = doc.prefix ?? '';
    assert.ok(base.startsWith(required));
    const body = base.slice(required.length);
    const path = policy.context === 'headings' ? [...(chunk.headingPath ?? [])] : [];
    let title = doc.title;
    if (title && path[0] === title) path.shift();
    if (title || path.length) {
        const leading = /^ {0,3}#|^[^\r\n]+\r?\n[=-]+\s*(?:\r?\n|$)/.test(body) ? fromMarkdown(body).children : [];
        const visible = n => n.children ? n.children.map(visible).join('') : n.alt ?? (n.type === 'html' ? '' : n.value ?? '');
        for (const head of leading) {
            if (head.type !== 'heading') break;
            const name = visible(head).trim();
            if (title === name) title = '';
            const i = path.indexOf(name);
            if (i >= 0) path.splice(i, 1);
        }
    }
    const available = Boolean(title || path.length);
    let shortened = false;
    while (title || path.length) {
        const index = required + [title, ...path].filter(Boolean).join(' > ') + ': ' + body;
        if (countTokens(index) <= policy.contextCap) {
            counts[shortened ? 'shortened' : 'retained']++;
            return index;
        }
        if (path.length) path.shift();
        else title = '';
        shortened = true;
    }
    counts[available ? 'omitted' : 'alreadyPresentOrUnavailable']++;
    return base;
}

async function prepare() {
    for (const dataset of Object.values(data)) {
        const { docs, questions } = dataset;
        for (const doc of docs) {
            doc.offsets = encoder.offsets(doc.source);
            doc.ends = doc.offsets.map(o => o[1]);
            doc.parts = await splitPlain(chunkText, doc.source);
            doc.parsed = new Map();
        }
        for (const q of questions) q.gold = q.references.map(ref => goldReference(ref, docs));
        await encoder.embed(questions.map(q => q.text));
    }
}

async function index(doc, policy, costs, initial, context) {
    const maxChunkSize = policy.chars ?? Infinity, maxChunkTokens = policy.tokens ?? Infinity;
    const fits = tokenBudget(maxChunkTokens, countTokens, doc.prefix ?? '');
    function record(texts) {
        costs.calls++;
        costs.texts += texts.length;
        costs.singletons += Number(texts.length === 1);
        for (const text of texts) {
            costs.embeddedTokens += countTokens(text);
            if (countTokens(text) > (policy.contextCap ?? maxChunkTokens)) throw new Error('Index input exceeds cap');
        }
        return encoder.embed(texts);
    }
    const embed = createBatchEmbedder(record, 256);
    let chunks;
    if (policy.method === 'plain-priority') {
        const output = await chunkText(doc.source, record, { maxChunkSize, maxChunkTokens, countTokens, maxEmbeddingBatchSize: 256 });
        chunks = alignPlain(doc.source, output.map(c => c.text));
    } else if (policy.method === 'plain-pack') {
        chunks = alignPlain(doc.source, packSentences(doc.parts, maxChunkSize, maxChunkTokens, countTokens));
    } else if (policy.method === 'window') {
        chunks = tokenWindows(doc, doc.offsets, policy.tokens, policy.tokens / 4);
    } else {
        const key = [maxChunkSize, maxChunkTokens, Boolean(policy.sentences)].join('/');
        if (!doc.parsed.has(key)) doc.parsed.set(key, parseMarkdown(doc.source,
            { maxChunkSize, fits, sentenceUnits: policy.sentences }));
        const units = await combineMarkdown(doc.source, doc.parsed.get(key), embed, { ...policy, maxChunkSize, fits }, initial);
        chunks = units.map(u => markdownResult(doc.source, u));
    }
    if (policy.context) {
        for (const c of chunks) c.embeddingText = contextualize(c, doc, policy, context);
    }
    const inputs = chunks.map(c => c.embeddingText ?? c.text);
    costs.indexTexts += chunks.length;
    costs.indexTokens += inputs.reduce((n, s) => n + countTokens(s), 0);
    if (policy.method !== 'plain-priority') await embed(inputs);
    return chunks;
}

async function evaluate(task, policy) {
    const { docs, questions } = data[task];
    const start = performance.now(), paid = { ...encoder.stats };
    const costs = { calls: 0, texts: 0, singletons: 0, embeddedTokens: 0, indexTexts: 0, indexTokens: 0 };
    const initial = [], context = { retained: 0, shortened: 0, omitted: 0, alreadyPresentOrUnavailable: 0 };
    const byDoc = await Promise.all(docs.map((doc, d) => index(doc, policy, costs, initial, context)
        .then(rows => rows.map(row => ({ ...row, doc: d })))));
    const bodyHash = sha256(JSON.stringify(byDoc.map(rows => rows.map(c => [c.text, c.sourceRanges]))));
    const vocab = vocabulary();
    for (const c of byDoc.flat()) c.index = vocab.intern(c.embeddingText ?? c.text);
    for (const q of questions) vocab.intern(q.text);
    const vectors = await encoder.embed(vocab.texts), matrix = new Float32Array(vectors.length * dimension);
    vectors.forEach((v, i) => matrix.set(v, i * dimension));
    const dense = denseRanker(matrix), pools = new Map(), retrieval = {}, complete512 = {}, examples = {};
    const all = docs.map((_, d) => d);
    for (const [i, q] of questions.entries()) {
        for (const [name, pool] of task === 'hotpotqa' ? [['shortlist', q.pool], ['pooled', all]] : [['document', q.pool]]) {
            const key = name + pool.join(',');
            if (!pools.has(key)) {
                const passages = pool.flatMap(d => byDoc[d]);
                pools.set(key, { passages, indices: passages.map(p => p.index), bm25: bm25Ranker(passages.map(p => wordCounts(p.text))) });
            }
            const { passages, indices, bm25 } = pools.get(key);
            for (const [ranker, order] of [['dense', dense(vocab.id(q.text), indices)], ['bm25', bm25(wordCounts(q.text))]]) {
                const arm = name + '/' + ranker, ranked = order.map(j => passages[j]);
                const scores = retrieval[arm] ??= {};
                for (const budget of budgets) {
                    const { projected, text } = deliver(ranked, budget, encoder);
                    const metrics = evidenceScore(projected, q.gold);
                    const total = scores[budget] ??= { complete: 0, recall: 0, precision: 0, deliveredTokens: 0 };
                    total.complete += metrics.complete;
                    for (const k of ['recall', 'precision']) total[k] += metrics[k] / questions.length;
                    total.deliveredTokens += projected.length / questions.length;
                    if (budget === 512 && ranker === 'dense') {
                        complete512[arm] = (complete512[arm] ?? '') + metrics.complete;
                        if (i === 0) examples[name] = { id: q.id, first: ranked[0].sourceRanges, doc: ranked[0].doc,
                            deliveredSHA256: sha256(text), ...metrics };
                    }
                }
            }
        }
    }
    return { questions: questions.length, bodyHash, chunkTokens: distribution(byDoc.flat().map(c => countTokens(c.text))),
        ...costs, ...(policy.context && { context }), ...(initial.length && { eligibleCosines: distribution(initial) }),
        retrieval, complete512, examples, milliseconds: performance.now() - start, peakRSSKiB: process.resourceUsage().maxRSS,
        encoder: Object.fromEntries(Object.entries(encoder.stats).map(([k, n]) => [k, n - paid[k]])) };
}

function primary(task) { return task === 'hotpotqa' ? 'pooled/dense' : 'document/dense'; }
function macro(row) {
    return tasks.reduce((sum, t) => sum + row.tasks[t].retrieval[primary(t)][512].complete / row.tasks[t].questions, 0) / tasks.length;
}

// Resample whole contracts, papers, reports or independent question pools,
// paired within task. Each of the four tasks gets the same weight.
function paired(a, b) {
    let seed = 20261123;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const groups = [], perTask = {};
    for (const t of tasks) {
        const x = a.tasks[t].complete512[primary(t)], y = b.tasks[t].complete512[primary(t)];
        const byGroup = new Map(), wins = [], losses = [];
        data[t].questions.forEach(({ group, id }, i) => {
            if (!byGroup.has(group)) byGroup.set(group, [0, 0]);
            const delta = Number(x[i]) - Number(y[i]), pair = byGroup.get(group);
            pair[0] += delta;
            pair[1]++;
            if (delta) (delta > 0 ? wins : losses).push(id);
        });
        perTask[t] = { winsPer100: 100 * wins.length / x.length, lossesPer100: 100 * losses.length / x.length, wins, losses };
        groups.push([...byGroup.values()]);
    }
    const draws = [];
    for (let i = 0; i < 2000; i++) {
        let sum = 0;
        for (const group of groups) {
            let diff = 0, n = 0;
            for (let j = 0; j < group.length; j++) {
                const [d, k] = group[Math.floor(random() * group.length)];
                diff += d; n += k;
            }
            sum += diff / n;
        }
        draws.push(100 * sum / groups.length);
    }
    draws.sort((a, b) => a - b);
    return { deltaPer100: 100 * (macro(a) - macro(b)), ci95: [draws[50], draws[1949]], perTask };
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
    let tokens = prior.tokens;
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
        let winner = 'pack';
        report.comparisons = {};
        for (const method of ['fixed', 'rescore']) {
            const names = [];
            for (const cutoff of [0.3, 0.5, 0.7, 'document']) {
                const name = method + '-' + cutoff;
                await run(name, { method, tokens, ...(cutoff === 'document' ? { adaptive: true } : { cutoff }) });
                names.push(name);
            }
            const best = names.sort((a, b) => macro(report.policies[b]) - macro(report.policies[a]))[0];
            report[method] = best;
            const test = paired(report.policies[best], report.policies[winner]);
            report.comparisons[best + ' vs ' + winner] = test;
            if (test.ci95[0] > 0) winner = best;
        }
        for (const name of ['pack', report.fixed, report.rescore]) {
            await run(name + '-lead', { ...report.policies[name].policy, leadIn: true });
        }
        const test = paired(report.policies[winner + '-lead'], report.policies[winner]);
        report.comparisons['lead vs protected'] = test;
        if (test.ci95[0] > 0) winner += '-lead';
        report.winner = report.policies[winner].policy;
        report.shortlist = Object.fromEntries([...new Set(['pack', report.fixed, report.rescore, winner])].map(k => [k, report.policies[k].policy]));
        await run('sentence-units', { ...report.winner, sentences: true }, ['qasper']);
        return;
    }
    assert.ok(prior.winner && prior.shortlist, 'Previous report is missing the calibration shortlist');
    report.winner = prior.winner;
    report.shortlist = prior.shortlist;
    if (experiment === 'context') {
        const base = await run('baseline', report.winner);
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
                const test = paired(row, control);
                report.comparisons[name] = test;
                if (cap === tokens && test.ci95[0] > 0 && paired(row, base).ci95[0] > 0) report.shortlist[name] = row.policy;
                control = row;
            }
        }
        if (report.winner.method === 'rescore') {
            const reverse = await run('reversed', { ...report.winner, reverse: true });
            report.comparisons.reversed = paired(reverse, base);
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
        report.comparisons[name + ' vs pack'] = paired(report.policies[name], report.policies.pack);
    }
}

try {
    await main();
    report.encoder = encoder.stats;
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { encoder.close(); }
