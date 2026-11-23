import { chunkText } from '../src/index.js';
import { denseRanker, split as splitPlain, vocabulary } from './chunking.mjs';
import { sha256 } from './corpora.mjs';
import { deliver, evidenceScore, goldReference } from './delivered-context.mjs';
import { documentRule, indexDocument } from './markdown-index.mjs';
import { bm25Ranker, budgets, wordCounts } from './rag.mjs';
import { dimension } from './encoder.mjs';
import { reciprocalRankFusion } from './retrieval-baselines.mjs';

function distribution(values) {
    const v = values.toSorted((a, b) => a - b);
    if (!v.length) return { count: 0 };
    return { count: v.length, min: v[0], p10: v[Math.floor(v.length * 0.1)], median: v[Math.floor(v.length / 2)],
        p90: v[Math.floor(v.length * 0.9)], max: v.at(-1) };
}

export async function prepareDataset(dataset, encoder, plainParts = false) {
    const { docs, questions } = dataset;
    for (const doc of docs) {
        doc.offsets = encoder.offsets(doc.source);
        doc.ends = doc.offsets.map(o => o[1]);
        if (plainParts) doc.parts = await splitPlain(chunkText, doc.source);
        doc.parsed = new Map();
    }
    for (const q of questions) q.gold = q.references.map(ref => goldReference(ref, docs));
    await encoder.embed(questions.map(q => q.text));
}

export async function evaluate(task, { docs, questions }, policy, encoder, mode) {
    const { countTokens } = encoder;
    const ruleStudy = mode === 'rules', baselines = mode === 'baselines', denseOnly = mode === 'semantic';
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
    const dense = denseRanker(matrix), pools = new Map(), retrieval = {}, complete512 = {}, recall512 = {}, examples = {};
    const all = docs.map((_, d) => d);
    for (const [i, q] of questions.entries()) {
        for (const [name, pool] of task === 'hotpotqa' ? [['shortlist', q.pool], ['pooled', q.pooled ?? all]] : [['document', q.pool]]) {
            const key = name + pool.join(',');
            if (!pools.has(key)) {
                const passages = pool.flatMap(d => byDoc[d]);
                pools.set(key, { passages, indices: passages.map(p => p.index), bm25: !denseOnly && bm25Ranker(passages.map(p => wordCounts(p.text))),
                    layout: ruleStudy && sha256(pool.map(d => d + '/' + layouts[d]).join(',')) });
            }
            const { passages, indices, bm25, layout } = pools.get(key);
            if (ruleStudy) q.scores ??= new Map();
            let measured = q.scores?.get(layout);
            if (!measured) {
                measured = [];
                const semantic = dense(vocab.id(q.text), indices), terms = !denseOnly && wordCounts(q.text);
                const rankings = [['dense', semantic]];
                if (!denseOnly) rankings.push(['bm25', bm25(terms)]);
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
                    if (denseOnly && task === 'qmsum') (recall512[arm] ??= []).push(metrics.recall);
                    if (trace) examples[name] = trace;
                }
            }
        }
    }
    return { questions: questions.length, bodyHash, chunkTokens: distribution(byDoc.flat().map(c => countTokens(c.text))),
        ...costs, ...(ruleStudy && { semanticDocuments }),
        ...((baselines || denseOnly) && { overTarget: byDoc.flat().filter(c => policy.tokens ? countTokens(c.text) > policy.tokens : c.text.length > policy.chars).length }),
        ...(denseOnly && { overEmbeddingLimit: byDoc.flat().filter(c => countTokens(c.text) > 8191).length }),
        ...(denseOnly && task === 'qmsum' && { recall512 }),
        ...(policy.context && { context }), ...(initial.length && { eligibleCosines: distribution(initial) }),
        retrieval, complete512, examples, milliseconds: performance.now() - start, peakRSSKiB: process.resourceUsage().maxRSS,
        encoder: Object.fromEntries(Object.entries(encoder.stats).map(([k, n]) => [k, n - paid[k]])) };
}
