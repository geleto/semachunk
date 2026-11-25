import { alignDocument, compact, cuad, hotpotqa, lowerBound, qasper } from './corpora.mjs';
import { costs, denseRanker, internCandidates, measure, qualityPlans, split, vocabulary } from './chunking.mjs';
import { alignPlain } from './delivered-context.mjs';
import { packSentences } from '../src/packing.js';
import { tokenBudget } from '../src/token-limit.js';
import { modelInputTokens } from './encoder.mjs';

export const budgets = [256, 512, 1024];
export const ragTasks = { cuad, qasper, hotpotqa };
export const windowName = 'window-128-overlap-32';
export const windowPlan = { tokens: 128, overlap: 32 };

export function ragPlans() {
    const grid = qualityPlans();
    const selected = ['sentences', 'blocks-500', 'pack-500', 'semantic-500', 'merge-250-0.5', 'merge-500-0.3', 'merge-500-0.5', 'merge-500-0.7'];
    const base = grid['merge-500-0.5'];
    return { 'priority-default': {}, ...Object.fromEntries(selected.map(name => [name, grid[name]])),
        'flat-merge-500-0.5': { ...base, flatInput: true }, 'merge-500-document': grid['merge-500-document'],
        'merge-500-token-256': { ...base, maxChunkTokens: 256 }, 'merge-500-two-passes': { ...base, maxPasses: 2 } };
}

export function tokenSpan(source, a, b) {
    return [lowerBound(source.ends, a, true), lowerBound(source.starts, b)];
}

export async function prepare(docs, questions, chunkText, encoder, plans) {
    const vocab = vocabulary(), sources = [], windows = [], aligned = [];
    const needFlat = Object.values(plans).some(plan => plan.flatInput);
    const tokenLimit = Object.values(plans).find(plan => plan.maxChunkTokens)?.maxChunkTokens;
    let base = 0;
    for (const [d, original] of docs.entries()) {
        const raw = original.raw ?? original.text, flat = original.text;
        if (compact(raw) !== flat) throw new Error('Raw layout disagrees with annotations in ' + original.title);
        const parts = await split(chunkText, raw);
        const doc = { ...alignDocument(original, parts), raw, flat, parts };
        aligned.push(doc);
        internCandidates(parts, 500, vocab);
        for (const plan of Object.values(plans)) {
            if (plan.chunkingStrategy === 'blocks') {
                (await split(chunkText, raw, plan)).forEach(vocab.intern);
            }
            if (plan.pack && plan.maxChunkTokens) {
                packSentences(parts, plan.maxChunkSize, tokenBudget(plan.maxChunkTokens, encoder.countTokens, '')).forEach(vocab.intern);
            }
        }
        if (needFlat) {
            const flatParts = await split(chunkText, flat);
            if (flatParts.join(' ') !== doc.text) throw new Error('Flat control source positions differ in ' + doc.title);
            internCandidates(flatParts, 500, vocab);
        }
        if (tokenLimit) {
            const pieces = await split(chunkText, raw, { maxChunkTokens: tokenLimit, countTokens: encoder.countTokens });
            pieces.forEach(vocab.intern);
        }
        const offsets = await encoder.offsets(doc.text);
        if (!offsets.length) throw new Error('Empty source ' + doc.title);
        const starts = offsets.map(([a]) => a), ends = offsets.map(([, b]) => b);
        sources.push({ starts, ends, base });
        base += offsets.length;
        for (let start = 0; start < starts.length;) {
            let end = Math.min(start + windowPlan.tokens, starts.length);
            // Some code points occupy multiple BPE tokens. Window edges must
            // also be character boundaries so their text matches their token ranges.
            while (end < starts.length && ends[end - 1] > starts[end]) end--;
            const index = vocab.intern(doc.text.slice(starts[start], ends[end - 1]));
            windows.push({ doc: d, start, end, index });
            if (end === starts.length) break;
            start = end - windowPlan.overlap;
            while (start > 0 && ends[start - 1] > starts[start]) start--;
        }
    }
    const gold = questions.map(query => {
        vocab.intern(query.text);
        const alternatives = new Map();
        for (const ref of query.references) {
            const tokens = new Set();
            for (const [d, a, b] of ref) {
                if (!query.pool.includes(d)) throw new Error('Evidence outside search pool for ' + query.id);
                const translate = aligned[d].translate;
                const [start, end] = tokenSpan(sources[d], translate(a), translate(b - 1) + 1);
                if (end <= start) throw new Error('Empty evidence span for ' + query.id);
                for (let i = start; i < end; i++) tokens.add(sources[d].base + i);
            }
            if (!tokens.size) throw new Error('Empty reference for ' + query.id);
            alternatives.set([...tokens].sort((a, b) => a - b).join(','), tokens);
        }
        if (!alternatives.size) throw new Error('No reference for ' + query.id);
        return [...alternatives.values()];
    });
    return { vocab, sources, windows, gold, docs: aligned };
}

export function wordCounts(text) {
    const terms = new Map();
    for (const term of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
        terms.set(term, (terms.get(term) ?? 0) + 1);
    }
    return terms;
}

export function bm25Ranker(passages) {
    const postings = new Map(), lengths = [];
    for (const [i, terms] of passages.entries()) {
        let length = 0;
        for (const [word, count] of terms) {
            length += count;
            if (!postings.has(word)) postings.set(word, []);
            postings.get(word).push([i, count]);
        }
        lengths.push(length);
    }
    const n = passages.length, mean = lengths.reduce((a, b) => a + b, 0) / n || 1;
    const norms = lengths.map(length => 1.2 * (0.25 + 0.75 * length / mean));
    return (query, matchingOnly = false) => {
        const scores = new Float64Array(n);
        for (const word of query.keys()) {
            const matches = postings.get(word);
            if (!matches) continue;
            const idf = Math.log1p((n - matches.length + 0.5) / (matches.length + 0.5));
            for (const [i, count] of matches) scores[i] += idf * count * 2.2 / (count + norms[i]);
        }
        const order = lengths.map((_, i) => i);
        return (matchingOnly ? order.filter(i => scores[i] > 0) : order).sort((a, b) => scores[b] - scores[a]);
    };
}

export function evidenceAtBudget(ranked, sources, references, budget, trace) {
    const visible = new Set();
    let spent = 0;
    for (const p of ranked) {
        const take = Math.min(p.end - p.start, budget - spent), base = sources[p.doc].base + p.start;
        for (let j = 0; j < take; j++) visible.add(base + j);
        spent += take;
        if (trace) trace.push([p.doc, p.start, p.start + take]);
        if (spent === budget) break;
    }
    if (!spent) throw new Error('Ranked passages contain no tokens');
    let correct = 0, recall = 0;
    for (const ref of references) {
        let hits = 0;
        for (const token of ref) if (visible.has(token)) hits++;
        const fraction = hits / ref.size;
        if (fraction > recall || (fraction === recall && hits > correct)) { correct = hits; recall = fraction; }
    }
    return { evidenceRecall: recall, contextPrecision: correct / spent, complete: Number(recall === 1),
        budgetFeasible: Number(references.some(ref => ref.size <= budget)), tokensDelivered: spent };
}

export function scoreMethod(questions, pools, byDoc, sources, gold, vocab, dense, terms, examples = new Map(), paired = false) {
    const result = {};
    for (const [pool, members] of pools) {
        const passages = pool.flatMap(d => byDoc[d]), indices = passages.map(p => p.index);
        const bm25 = bm25Ranker(indices.map(terms));
        for (const i of members) {
            const q = vocab.id(questions[i].text);
            for (const [ranker, order] of [['dense', dense(q, indices)], ['bm25', bm25(terms(q))]]) {
                const ranked = order.map(j => passages[j]);
                const scores = result[ranker] ??= {};
                for (const budget of budgets) {
                    const trace = examples.has(i) && ranker === 'dense' && budget === 256 ? [] : undefined;
                    const score = evidenceAtBudget(ranked, sources, gold[i], budget, trace);
                    const total = scores[budget] ??= { questions: 0, complete: 0, budgetFeasible: 0, evidenceRecall: 0,
                        contextPrecision: 0, meanTokensDelivered: 0 };
                    total.questions++;
                    total.complete += score.complete;
                    if (paired && ranker === 'dense' && score.complete) (total.completeIndices ??= []).push(i);
                    total.budgetFeasible += score.budgetFeasible;
                    total.evidenceRecall += score.evidenceRecall;
                    total.contextPrecision += score.contextPrecision;
                    total.meanTokensDelivered += score.tokensDelivered;
                    if (trace) Object.assign(examples.get(i), { score, retrievedSourceTokenRanges: trace });
                }
            }
        }
    }
    for (const ranker of Object.values(result)) for (const total of Object.values(ranker)) {
        for (const key of ['evidenceRecall', 'contextPrecision', 'meanTokensDelivered']) total[key] /= total.questions;
    }
    return result;
}

function distribution(values) {
    const sorted = values.toSorted((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return { min: sorted[0], median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) };
}

const multipleSpans = ref => new Set(ref.map(span => span.join(','))).size > 1;

function examineExamples(task, questions, sources, gold) {
    let indices;
    if (task === 'cuad') {
        const governing = questions.map((_, i) => i).filter(i => questions[i].id.endsWith('__Governing Law'));
        indices = [governing.sort((a, b) => sources[questions[b].pool[0]].starts.length - sources[questions[a].pool[0]].starts.length)[0]];
    } else if (task === 'qasper') indices = [questions.findIndex(q => q.references.every(multipleSpans))];
    else indices = ['bridge', 'comparison'].map(kind => questions.findIndex(q => q.kind === kind));
    return new Map(indices.map(i => {
        const q = questions[i];
        const referenceSourceTokenRanges = gold[i].map(ref => {
            const spans = [];
            for (const d of q.pool) {
                const { base, starts } = sources[d];
                const tokens = [...ref].filter(t => t >= base && t < base + starts.length).sort((a, b) => a - b);
                for (const t of tokens) {
                    const pos = t - base, last = spans.at(-1);
                    if (last && last[0] === d && last[2] === pos) last[2]++;
                    else spans.push([d, pos, pos + 1]);
                }
            }
            return spans;
        });
        return [i, { questionId: q.id, question: q.text, candidateDocumentIndices: q.pool, referenceSourceTokenRanges }];
    }));
}

export async function evaluateRag(task, chunkText, encoder, plans, { sample, paired = false } = {}) {
    const data = sample ?? await ragTasks[task](), { questions, exclusions } = data;
    const { vocab, sources, windows, gold, docs } = await prepare(data.docs, questions, chunkText, encoder, plans);
    const { matrix, textsSHA256, vectorsSHA256, precomputation } = await encoder.vectors(vocab.texts);
    const dense = denseRanker(matrix), lexicon = new Map(), pools = new Map();
    function terms(id) {
        if (!lexicon.has(id)) lexicon.set(id, wordCounts(vocab.texts[id]));
        return lexicon.get(id);
    }
    questions.forEach((q, i) => {
        const key = q.pool.join(',');
        if (!pools.has(key)) pools.set(key, [q.pool, []]);
        pools.get(key)[1].push(i);
    });
    const all = task === 'hotpotqa' && [[docs.map((_, d) => d), questions.map((_, i) => i)]];
    const exampleName = plans['priority-default'] ? 'priority-default' : 'merge-500-0.5';
    const examples = plans[exampleName] ? examineExamples(task, questions, sources, gold) : new Map();
    const pooled = new Map([...examples.keys()].map(i => [i, {}]));
    const scores = {};
    for (const [name, plan] of Object.entries({ ...plans, [windowName]: windowPlan })) {
        const byDoc = docs.map(() => []);
        let rows;
        if (name === windowName) {
            for (const p of windows) byDoc[p.doc].push(p);
            rows = byDoc.map(group => {
                const inputs = new Set(group.map(p => p.index)).size;
                return { inputs, calls: 1, singletons: Number(inputs === 1) };
            });
        } else {
            rows = [];
            for (const doc of docs) rows.push(await measure(chunkText, doc, plan, vocab, matrix, encoder.countTokens));
            for (const [doc, original] of docs.entries()) {
                const ids = rows[doc].ids, source = sources[doc];
                const chunks = alignPlain(original.flat, ids.map(i => vocab.texts[i]));
                for (const [i, { sourceRanges }] of chunks.entries()) {
                    // Count the same source tokens even when a layout inserts a space at a sentence break.
                    const start = original.translate(sourceRanges[0].start);
                    const end = original.translate(sourceRanges.at(-1).end - 1) + 1;
                    const a = byDoc[doc].at(-1)?.end ?? 0, b = lowerBound(source.starts, end);
                    if (a && source.ends[a - 1] > start) throw new Error('A source token crosses a chunk boundary in ' + original.title);
                    if (a < b) byDoc[doc].push({ doc, start: a, end: b, index: ids[i] });
                }
            }
            byDoc.forEach((group, d) => {
                if (group[0]?.start !== 0 || group.at(-1)?.end !== sources[d].starts.length ||
                    group.some((p, i) => i > 0 && group[i - 1].end !== p.start)) {
                    throw new Error('Chunks do not partition the source tokens in ' + docs[d].title);
                }
            });
        }
        const passages = byDoc.flat();
        const row = scores[name] = { chunks: passages.length, ...costs(rows), chunkTokens: distribution(passages.map(p => p.end - p.start)),
            chunksOverModelInput: passages.filter(p => encoder.countTokens(vocab.texts[p.index]) > modelInputTokens).length,
            chunksOver256Tokens: passages.filter(p => encoder.countTokens(vocab.texts[p.index]) > 256).length,
            retrieval: scoreMethod(questions, pools.values(), byDoc, sources, gold, vocab, dense, terms, name === exampleName ? examples : undefined, paired) };
        if (name !== windowName) row.providerTokens = rows.reduce((sum, r) => sum + r.providerTokens, 0);
        if (all) row.pooledRetrieval = scoreMethod(questions, all, byDoc, sources, gold, vocab, dense, terms, name === exampleName ? pooled : undefined, paired);
    }
    if (all) for (const [i, trace] of pooled) examples.get(i).pooledAt256 = trace;
    const lengths = sources.map(source => source.starts.length);
    return { documents: docs.map(d => d.title), questionIds: questions.map(q => q.id), exclusions,
        corpusTokens: lengths.reduce((a, b) => a + b, 0), documentTokens: distribution(lengths),
        candidatePoolTokensPerQuestion: distribution(questions.map(q => q.pool.reduce((sum, d) => sum + lengths[d], 0))),
        candidateDocumentsPerQuestion: distribution(questions.map(q => q.pool.length)),
        shortestReferenceTokens: distribution(gold.map(alts => Math.min(...alts.map(ref => ref.size)))),
        requiresMultipleSources: questions.filter(q => q.references.every(ref => new Set(ref.map(span => span[0])).size > 1)).length,
        requiresMultipleSpans: questions.filter(q => q.references.every(multipleSpans)).length,
        distinctTexts: vocab.texts.length, textsSHA256, vectorsSHA256, precomputation, scores, defaultExamplesAt256: [...examples.values()] };
}
