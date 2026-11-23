import assert from 'node:assert/strict';
import test from 'node:test';
import { openTokenizer } from './encoder.mjs';
import { alignPlain, deliver, evidenceScore, goldReference } from './delivered-context.mjs';
import { packSentences } from './chunking.mjs';
import { combineMarkdown } from './markdown-merging.mjs';
import { boundaryFractions, indexDocument } from './markdown-index.mjs';
import { scoreAtBudget } from './markdown-rules.mjs';
import { paired } from './markdown-decisions.mjs';
import { parseMarkdown } from '../src/markdown.js';
import { mergeOriginalBoundaries } from '../src/markdown-merge.js';
import { locateChunks, reciprocalRankFusion, summarizeRetrieval } from './retrieval-baselines.mjs';
import { bm25Ranker, wordCounts } from './rag.mjs';

test('reference chunks map repeated occurrences, trimmed gaps and a repeated suffix uniquely', () => {
    const body = 'ab cd cd\n\nnext';
    const offsets = (...args) => locateChunks(...args).map(c => c.sourceRanges[0].start);
    assert.deepEqual(offsets(body, ['ab cd', 'cd cd', 'cd', 'next'], 2), [0, 3, 6, 10]);
    assert.deepEqual(offsets('x x', ['x', 'x'], 0), [0, 2]);
    assert.throws(() => offsets('x missing y', ['x', 'y'], 0), /Unmapped/);
    assert.deepEqual(offsets('aaaab', ['aaa', 'aa', 'b'], 2), [0, 2, 4]);
    assert.throws(() => offsets('aaaaaX', ['aaa', 'aa', 'aaX'], 2), /Ambiguous/);
});

test('fusion uses positive lexical matches, one-based ranks and source order for ties', () => {
    const bm25 = bm25Ranker(['other', 'word', 'absent'].map(wordCounts));
    assert.deepEqual(bm25(wordCounts('word'), true), [1]);
    assert.deepEqual(reciprocalRankFusion([2, 0, 1], []), [2, 0, 1]);
    assert.deepEqual(reciprocalRankFusion([1, 0, 2], [0, 1]), [0, 1, 2]);
    assert.deepEqual(reciprocalRankFusion([0, 1, 2], [2]), [2, 0, 1]);
});

test('paired retrieval comparisons keep questions from the same search pool together', () => {
    const outcomes = { 'pooled/dense': '10', 'pooled/bm25': '01', 'pooled/hybrid': '11' };
    const retrieval = Object.fromEntries(Object.entries(outcomes).map(([arm, bits]) =>
        [arm, { 512: { complete: [...bits].filter(x => x === '1').length } }]));
    const row = { tasks: { hotpotqa: { questions: 2, complete512: outcomes, retrieval } } };
    const report = { policies: { 'shipped/t256': row } };
    summarizeRetrieval(report, { hotpotqa: { questions: ['a', 'b'].map(id => ({ id, group: id, pooled: [0, 1] })) } });
    assert.equal(report.bootstrapGroups.hotpotqa, 1);
    const diff = report.comparisons['shipped/t256/hybrid vs dense'];
    assert.equal(diff.deltaPer100, 50);
    assert.deepEqual(diff.ci95, [50, 50]);
    assert.deepEqual(diff.perTask.hotpotqa.wins, ['b']);
});

test('sentence packing budgets an oversized first sentence and the serialized join', () => {
    const parts = ['abcdefghij', 'abc', 'def'];
    const packed = packSentences(parts, Infinity, 4, s => s.length);
    assert.equal(packed.join(''), parts.join(''));
    assert.ok(packed.every(s => s.length <= 4));
    assert.deepEqual(packSentences(['a', 'b', 'c'], Infinity, 2, s => s === 'a b' ? 3 : s.split(' ').length), ['a', 'b c']);
});

test('literal context charges its separators and generated text, maps normalization, and credits repetitions once', t => {
    const enc = openTokenizer();
    t.after(enc.close);
    const source = 'head\r\n\r\nalpha\nbeta\nalpha';
    const offsets = enc.offsets(source), sources = [{ offsets, ends: offsets.map(r => r[1]) }];
    const chunks = alignPlain(source, ['head alpha', 'beta', 'alpha']).map(c => ({ ...c, doc: 0 }));
    const ref = span => [goldReference([[0, ...span]], sources)];
    const repeated = { ...chunks[1], text: 'head\nbeta', sourceRanges: [
        { start: 0, end: 4, outputStart: 0 }, { start: 14, end: 18, outputStart: 5 }] };
    const context = deliver([repeated, chunks[0]], 256, enc);
    assert.equal(context.text, 'head\nbeta\n\nhead alpha');
    const header = evidenceScore(context.projected, ref([0, 4]));
    assert.equal(header.complete, 1);
    assert.equal(header.precision, 1 / enc.countTokens(context.text));
    assert.equal(evidenceScore(deliver(chunks.slice(-1), 256, enc).projected, ref([8, 13])).complete, 0);
    assert.equal(evidenceScore(deliver([chunks[0]], 256, enc).projected, ref([0, 13])).complete, 1);
    const joined = alignPlain('hello', ['hel', 'lo']).map(c => ({ ...c, doc: 0 }));
    const hello = enc.offsets('hello'), word = [goldReference([[0, 1, 5]], [{ offsets: hello, ends: [5] }])];
    for (const pair of [joined, joined.toReversed()]) {
        const got = deliver(pair, 10, enc);
        assert.equal(evidenceScore(got.projected, word).complete, 1);
        assert.equal(got.projected.length, enc.countTokens(pair.map(c => c.text).join('\n\n')));
    }
});

test('a clipped partial Unicode character earns no evidence', t => {
    const enc = openTokenizer();
    t.after(enc.close);
    const text = 'a 🌐 end', offsets = enc.offsets(text);
    const budget = offsets.findIndex(([, end, visible]) => end !== visible) + 1;
    const got = deliver([{ doc: 0, text, sourceRanges: [{ start: 0, end: text.length, outputStart: 0 }] }], budget, enc);
    assert.ok(got.text.isWellFormed() && !got.text.includes('🌐') && got.projected.length <= budget);
});

test('both priority experiments batch eligible endpoints across sections and merge disjoint pairs with stable ties', async () => {
    const s = 'A\n\nB\n\nC\n\nD\n\n# More\nX\n\nY', units = parseMarkdown(s, { maxChunkSize: 100 });
    for (const method of ['fixed', 'rescore']) {
        const calls = [];
        const embed = texts => { calls.push(texts); return texts.map(() => [1]); };
        const options = { method, maxChunkSize: 100, maxPasses: 1 };
        const once = await combineMarkdown(s, units, embed, options);
        assert.deepEqual(once.map(u => s.slice(u.start, u.end)), ['A\n\nB', 'C\n\nD', '# More\nX\n\nY']);
        assert.deepEqual(calls, [['A', 'B', 'C', 'D', '# More\nX', 'Y']]);
        assert.deepEqual(await combineMarkdown(s, units, assert.fail, { ...options, maxPasses: 0 }).then(out => out.map(u => u.start)),
            units.map(u => u.start));
        calls.length = 0;
        await combineMarkdown(s, units, embed, { ...options, maxPasses: 5 });
        assert.equal(calls.length, method === 'fixed' ? 1 : 2);
        if (method === 'rescore') assert.deepEqual(calls[1], ['A\n\nB', 'C\n\nD']);
    }
});

test('original-boundary scoring can discover a newly token-eligible gap without scoring a merged body', async () => {
    const source = 'A\n\nB\n\nC', units = parseMarkdown(source, { maxChunkSize: Infinity });
    const batches = [], initial = [];
    const result = await combineMarkdown(source, units, texts => {
        batches.push(texts);
        return texts.map(() => [1]);
    }, { method: 'fixed', maxChunkSize: Infinity, fits: s => s !== 'A\n\nB', adaptive: true }, initial);
    assert.deepEqual(initial, [1]);
    assert.deepEqual(batches, [['B', 'C'], ['A']]);
    assert.equal(result.length, 1);
    assert.equal(source.slice(result[0].start, result[0].end), source);
});

test('fixed-body context preserves a hidden required prefix and omits optional headings at the deployment cap', async () => {
    const doc = { source: '# A long heading\nsame', title: 'Book', chunkPrefix: 'P', parsed: new Map() };
    const calls = [];
    const encoder = { countTokens: s => s.length, embed: texts => { calls.push(texts); return texts.map(() => [1]); } };
    function run(extra) {
        return indexDocument(doc, { method: 'pack', tokens: 7, ...extra }, {}, [], {}, encoder);
    }
    const [baseline] = await run({});
    const [tight] = await run({ context: 'headings', contextCap: 7 });
    const [wide] = await run({ context: 'headings', contextCap: 100 });
    for (const c of [baseline, tight, wide]) {
        assert.deepEqual(c.sourceRanges, [{ start: doc.source.indexOf('same'), end: doc.source.length, outputStart: 0 }]);
        assert.equal(c.text, 'same');
    }
    assert.deepEqual(calls, [['P: same'], ['P: same'], ['P: Book > A long heading: same']]);
});

test('capacity rules count both real limits, section barriers and competing original joins', () => {
    const s = 'A\n\nB\n\nC\n\n---\n\nD\n\nE', units = parseMarkdown(s, { maxChunkSize: 100 });
    assert.deepEqual(boundaryFractions(s, units, 100), { eligible: 3 / 4, competing: 1 / 3 });
    assert.deepEqual(boundaryFractions(s, units, 1), { eligible: 0, competing: 0 });
    assert.deepEqual(boundaryFractions('A', units.slice(0, 1), Infinity), { eligible: 0, competing: 0 });
    assert.equal(scoreAtBudget('medium-budget', { chars: 1024 }), true);
    assert.equal(scoreAtBudget('medium-budget', { tokens: 256 }), true);
    assert.equal(scoreAtBudget('medium-budget', { chars: 500, tokens: 256 }), false);
    assert.equal(scoreAtBudget('medium-budget', { chars: 1024, tokens: 128 }), false);
});

test('pass-dependent cutoffs change later joins while reusing original vectors', async () => {
    const s = 'A\n\nB\n\nC\n\nD\n\nE', units = parseMarkdown(s, { maxChunkSize: Infinity });
    const x = 0.62, y = Math.sqrt(1 - x * x), vectors = { A: [1, 0], B: [1, 0], C: [x, y], D: [x, y], E: [-y, x] };
    for (const [variant, bodies] of [[{}, ['A\n\nB\n\nC\n\nD', 'E']], [{ schedule: 'live' }, ['A\n\nB\n\nC\n\nD', 'E']],
        [{ density: 'relax' }, ['A\n\nB\n\nC\n\nD', 'E']], [{ density: 'tighten' }, ['A\n\nB', 'C\n\nD', 'E']],
        [{ schedule: 'tighten' }, ['A\n\nB', 'C\n\nD', 'E']], [{ maxPasses: 1 }, ['A\n\nB', 'C\n\nD', 'E']]]) {
        const calls = [];
        const output = await combineMarkdown(s, units, texts => { calls.push(texts); return texts.map(t => vectors[t]); },
            { method: 'fixed', adaptive: true, maxChunkSize: Infinity, ...variant });
        assert.deepEqual(output.map(u => s.slice(u.start, u.end)), bodies);
        assert.deepEqual(calls, [['A', 'B', 'C', 'D', 'E']]);
    }
});

test('paired resampling keeps all sizes of a question together', () => {
    function repeated(hits) {
        return { measurements: 6, tasks: { cuad: { questions: 2, complete512: { 'document/dense': hits },
            retrieval: { 'document/dense': { 512: { complete: (hits[0] + hits[1]) / 6 } } } } } };
    }
    const data = { cuad: { questions: [{ id: 'a', group: 'contract' }, { id: 'b', group: 'contract' }] } };
    const result = paired(repeated([2, 0]), repeated([0, 0]), data);
    assert.deepEqual(result.ci95, [result.deltaPer100, result.deltaPer100]);
    assert.ok(Math.abs(result.deltaPer100 - 100 / 6) < 1e-12);
});

test('the direct original-boundary implementation matches the measured candidate and its actual scoring inputs', async () => {
    const source = 'A\n\nB\n\nC\n\nD\n\n---\n\nA\n\nB\n\n# Other\nA\n\nB\n\nC';
    const units = parseMarkdown(source, { maxChunkSize: Infinity });
    for (const maxPasses of [0, 1, 5]) for (const calibrate of [false, true]) for (const cap of [1, 500]) {
        const options = { maxPasses, maxMergesPerPass: cap, maxUncappedPasses: 3, candidateMergesPercentageCap: 40,
            uncappedCandidateMerges: 12, maxChunkSize: 20, fits: s => s !== 'A\n\nB', cutoff: 0.5 };
        const batches = [];
        const embed = texts => { batches.push(texts); return texts.map(s => [1, s.length % 3]); };
        const expected = await combineMarkdown(source, units, embed, { ...options, method: 'fixed', adaptive: calibrate });
        const expectedCalls = batches.splice(0);
        const actual = await mergeOriginalBoundaries(source, units, embed, { ...options, combineChunksSimilarityThreshold: options.cutoff, calibrate });
        assert.deepEqual(actual.map(u => [u.start, u.end]), expected.map(u => [u.start, u.end]));
        assert.deepEqual(batches, expectedCalls);
    }
    const blocked = await mergeOriginalBoundaries(source, units, assert.fail, { maxPasses: 10, maxUncappedPasses: 10,
        maxMergesPerPass: 2, candidateMergesPercentageCap: 10, uncappedCandidateMerges: 0, maxChunkSize: 5, combineChunksSimilarityThreshold: 0.5 });
    assert.deepEqual(blocked.map(u => [u.start, u.end]), units.map(u => [u.start, u.end]));
});
