import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';
import { denseRanker, indexedChunks } from './chunking.mjs';
import { alignDocument, answerSpan, compact, joinParts } from './corpora.mjs';
import { retrieval, segmentation, windowDiff } from './quality.mjs';
import { bm25Ranker, evaluateRag, evidenceAtBudget, prepare, scoreMethod, tokenSpan, wordCounts } from './rag.mjs';
import { dimension } from './encoder.mjs';

const passage = (doc, start, end, index = 0) => ({ doc, start, end, index });
const wordOffsets = text => Array.from(text.matchAll(/\S+/gu), m => [m.index, m.index + m[0].length]);

test('inserted sentence separators move annotations and omissions fail coverage checks', () => {
    const doc = alignDocument({ title: 'example', text: 'Alpha!Beta.', questions: [['which?', [[6, 10]]]], cuts: [6] }, ['Alpha!', 'Beta.']);
    assert.equal(doc.text, 'Alpha! Beta.');
    assert.deepEqual(doc.questions[0][1], [[7, 11]]);
    assert.deepEqual(doc.cuts, [7]);
    assert.throws(() => indexedChunks([doc], [{ ids: [0] }], ['Alpha!']), /Incomplete/);
});

test('SQuAD hits require visible text at the right source position even for identical passages', () => {
    const text = 'one two three', vocab = { texts: [text, 'query'], id: () => 1 };
    const ends = new Map([[0, [3, 7, 13]]]);
    const chunks = [passage(0, 0, 13), passage(1, 0, 13)];
    const rank = denseRanker(Float32Array.of(1, 0, 1, 0), 2);
    for (const [budget, span, expected] of [[3, [0, 3], 0], [4, [0, 3], 1], [5, [8, 13], 0], [6, [8, 13], 1]]) {
        const score = retrieval([{}, { questions: [['query', [span]]] }], chunks, vocab, rank, ends, budget);
        assert.deepEqual([score.hits, score.top1Hits], [expected, 0]);
    }
});

test('exact section matches and WindowDiff give different credit for a nearby boundary', () => {
    const words = [0, 2, 4, 6, 8, 10, 12, 14];
    assert.equal(windowDiff(words, [8], [8]), 0);
    assert.equal(windowDiff(words, [8], [10]), 2 / 6);
    const score = segmentation([{ text: 'a b c d e f g h', cuts: [8] }], [0, 4, 8].map(start => ({ doc: 0, start })));
    assert.deepEqual([score.matched, score.gold, score.predicted, score.f1], [1, 1, 2, 2 / 3]);
});

test('structured, flat and token-limited plans use the same annotated source coordinates', async () => {
    const raw = 'Terms\n\n- First item\n- Second item', text = compact(raw), ref = text.indexOf('Second');
    const data = await prepare([{ title: 'list', text, raw }], [
        { id: 'q', text: 'Which item?', pool: [0], references: [[[0, ref, ref + 11]]] },
    ], chunkText, { offsets: wordOffsets, countTokens: s => wordOffsets(s).length + 2 }, {
        flat: { flatInput: true }, limited: { maxChunkTokens: 256 }, hierarchy: { chunkingStrategy: 'semantic-blocks' },
    });
    for (const value of ['Terms', '- Second item', text]) assert.ok(data.vocab.texts.includes(value));
    assert.ok(data.vocab.texts.includes('Terms\n\n- First item'));
    assert.deepEqual(data.gold, [[new Set([5, 6])]]);
});

test('RAG scores intact paragraphs against the same source when sentence splitting inserts a space', async () => {
    const raw = 'Title.\n\nAlpha!Beta. Gamma.', text = compact(raw), start = text.indexOf('Beta');
    const sample = { docs: [{ title: 'sample', text, raw }], questions: [
        { id: 'q', text: 'Beta?', pool: [0], references: [[[0, start, start + 4]]] }
    ] };
    const encoder = { countTokens: s => wordOffsets(s).length, offsets: wordOffsets,
        vectors: texts => ({ matrix: new Float32Array(texts.length * dimension).fill(1) }) };
    const report = await evaluateRag('cuad', chunkText, encoder, {
        blocks: { chunkingStrategy: 'blocks', maxChunkSize: 'Alpha!Beta. Gamma.'.length }
    }, { sample });
    assert.equal(report.scores.blocks.chunks, 2);
    assert.equal(report.scores.blocks.retrieval.dense[256].complete, 1);
});

test('RAG skips rejected rows while preserving the positions of later evidence', async () => {
    const raw = 'A\n\n😀\n\nB';
    const sample = { docs: [{ title: 'mixed', text: compact(raw), raw }, { title: 'empty', text: '😀' }], questions: [
        { id: 'middle', text: 'q', pool: [0], references: [[[0, 2, 4]]] },
        { id: 'last', text: 'q', pool: [0], references: [[[0, 5, 6]]] },
        { id: 'empty', text: 'q', pool: [1], references: [[[1, 0, 2]]] }
    ] };
    const encoder = { countTokens: s => s.includes('😀') ? 2 : wordOffsets(s).length, offsets: wordOffsets,
        vectors: texts => ({ matrix: new Float32Array(texts.length * dimension).fill(1) }) };
    const limit = { maxChunkSize: 0, maxChunkTokens: 1 };
    const plans = { public: { ...limit, chunkingStrategy: 'pack' }, blocks: { ...limit, chunkingStrategy: 'blocks' },
        reference: { ...limit, pack: true } };
    const report = await evaluateRag('cuad', chunkText, encoder, plans, { sample, paired: true });
    for (const name of Object.keys(plans)) {
        const result = report.scores[name];
        assert.equal(result.chunks, 2, name);
        assert.equal(result.providerTexts, 2, name);
        assert.deepEqual(result.retrieval.dense[256].completeIndices, [1], name);
        assert.equal(result.retrieval.bm25[256].complete, 1, name);
    }
});

test('RAG prepares the distinct pieces needed by every token cap in either plan order', async () => {
    const text = 'abcdefghij';
    const sample = { docs: [{ title: 'sample', text }], questions: [
        { id: 'q', text: 'q', pool: [0], references: [[[0, 8, 10]]] }
    ] };
    const encoder = { countTokens: s => s.length, offsets: s => Array.from(s, (_, i) => [i, i + 1]),
        vectors: texts => ({ matrix: new Float32Array(texts.length * dimension).fill(1) }) };
    for (const limits of [[2, 3], [3, 2]]) {
        const plans = Object.fromEntries(limits.map(limit => ['cap' + limit, { maxChunkTokens: limit }]));
        const { scores } = await evaluateRag('cuad', chunkText, encoder, plans, { sample });
        for (const limit of limits) {
            const rows = await chunkText(text, { maxChunkTokens: limit, countTokens: encoder.countTokens });
            assert.equal(scores['cap' + limit].chunks, rows.length);
            assert.equal(scores['cap' + limit].retrieval.dense[256].complete, 1);
        }
    }
});

test('multi-document evidence must occur in the delivered prefix of each source', () => {
    const sources = [{ base: 0 }, { base: 8 }], ranked = [passage(0, 0, 4), passage(1, 0, 4)];
    const gold = [new Set([1, 2, 8, 9])];
    for (const [budget, recall, complete] of [[4, 0.5, 0], [5, 0.75, 0], [6, 1, 1]]) {
        const score = evidenceAtBudget(ranked, sources, gold, budget);
        assert.deepEqual([score.evidenceRecall, score.complete], [recall, complete]);
    }
    assert.equal(evidenceAtBudget(ranked.slice(0, 1), sources, [new Set([8, 9])], 4).contextPrecision, 0);
});

test('overlapping windows spend budget twice and earn credit once per gold token', () => {
    const trace = [], ranked = [passage(0, 0, 4), passage(0, 2, 6, 1)];
    const score = evidenceAtBudget(ranked, [{ base: 0 }], [new Set([2, 3, 4, 5])], 6, trace);
    assert.deepEqual(trace, [[0, 0, 4], [0, 2, 4]]);
    assert.deepEqual([score.evidenceRecall, score.contextPrecision, score.budgetFeasible], [0.5, 2 / 6, 1]);
});

test('different annotators cannot be combined into one complete reference', () => {
    const sources = [{ base: 0 }], gold = [new Set([0, 3]), new Set([1, 4])];
    const mixed = evidenceAtBudget([passage(0, 0, 2)], sources, gold, 2);
    assert.deepEqual([mixed.complete, mixed.evidenceRecall], [0, 0.5]);
    const full = evidenceAtBudget([passage(0, 0, 1), passage(0, 3, 4)], sources, gold, 2);
    assert.deepEqual([full.complete, full.evidenceRecall], [1, 1]);
    assert.equal(evidenceAtBudget([passage(0, 1, 3)], sources, gold, 1).budgetFeasible, 0);
});

test('astral characters, whitespace and repeated answers preserve the annotated occurrence', () => {
    const raw = '🌐 Alpha!Beta.\n\n  Beta.', flat = compact(raw);
    const cp = [...raw.slice(0, raw.lastIndexOf('Beta'))].length;
    const [a, b] = answerSpan(raw, flat, { answer_start: cp, text: 'Beta' });
    const doc = alignDocument({ title: 'sample', text: flat }, ['🌐 Alpha!', 'Beta.', 'Beta.']);
    assert.equal(doc.text.slice(doc.translate(a), doc.translate(b - 1) + 1), 'Beta');
    assert.equal(doc.translate(a), doc.text.lastIndexOf('Beta'));
    assert.deepEqual(joinParts(['Title.', '', ' Fact. ']), { text: 'Title. Fact.', spans: [[0, 6], null, [7, 12]] });
    assert.deepEqual(tokenSpan({ starts: [0, 4, 6], ends: [3, 6, 9] }, 4, 6), [1, 2]);
});

test('BM25 scores query terms and resolves ties in source order', () => {
    const rank = bm25Ranker(['fruit', 'quorum', 'fruit'].map(wordCounts));
    assert.deepEqual(rank(wordCounts('QUORUM')), [1, 0, 2]);
    assert.deepEqual(rank(wordCounts('absent')), [0, 1, 2]);
});

test('pooled search can rank a distractor outside the shortlist first', () => {
    const docs = [[passage(0, 0, 300)], [passage(1, 0, 300)]], sources = [{ base: 0 }, { base: 300 }];
    for (const [pool, expected] of [[[1], 1], [[0, 1], 0]]) {
        const score = scoreMethod([{ text: 'query' }], [[pool, [0]]], docs, sources, [[new Set([300])]],
            { id: () => 0 }, denseRanker(Float32Array.of(1, 0), 2), () => wordCounts('same'));
        for (const ranker of ['dense', 'bm25']) {
            assert.equal(score[ranker][256].complete, expected);
            assert.equal(score[ranker][512].complete, 1);
        }
    }
});

test('paired dense outcomes identify the original questions at each delivered budget', () => {
    const byDoc = [[passage(0, 0, 700)]], gold = [600, 300, 10].map(token => [new Set([token])]);
    const questions = gold.map(() => ({ text: 'query' }));
    const scores = scoreMethod(questions, [[[0], [2, 0, 1]]], byDoc, [{ base: 0 }], gold,
        { id: () => 0 }, () => [0], () => wordCounts('query'), undefined, true);
    assert.deepEqual(scores.dense[256].completeIndices, [2]);
    assert.deepEqual(scores.dense[512].completeIndices, [2, 1]);
    assert.deepEqual(scores.dense[1024].completeIndices, [2, 0, 1]);
});
