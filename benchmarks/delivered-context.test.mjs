import assert from 'node:assert/strict';
import test from 'node:test';
import { openTokenizer } from './encoder.mjs';
import { alignPlain, deliver, evidenceScore, goldReference } from './delivered-context.mjs';
import { packSentences } from '../src/packing.js';
import { combineMarkdown } from './markdown-merging.mjs';
import { boundaryFractions, indexDocument } from './markdown-index.mjs';
import { scoreAtBudget } from './markdown-rules.mjs';
import { contrast, paired, summarizeSemantic } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { parseMarkdown } from '../src/markdown.js';
import { mergeOriginalBoundaries } from '../src/markdown-merge.js';
import { locateChunks, reciprocalRankFusion, summarizeRetrieval } from './retrieval-baselines.mjs';
import { bm25Ranker, wordCounts } from './rag.mjs';
import { flattenCorpus } from './semantic-corpora.mjs';

test('cached retrieval distinguishes indexing text on identical displayed passages', async () => {
    const query = { id: 'q', text: 'Beta?', pool: [0], references: [[[0, 8, 13]]] };
    const dataset = { docs: [{ title: 'Study', source: 'Alpha.\n\nBeta.' }], questions: [query] };
    const encoder = { stats: {}, countTokens: text => text.length, offsets: text => Array.from(text, (_, i) => [i, i + 1, i + 1]),
        embed: texts => texts.map(text => ['Study: Alpha.', 'Beta.', 'Beta?'].includes(text) ? [1, 0] : [0, 1]) };
    await prepareDataset(dataset, encoder);
    const run = options => evaluate('cuad', dataset, { method: 'pack', chars: 6, ...options }, encoder, 'rules');
    const plain = await run({}), options = { context: 'title', contextCap: 40 };
    const titled = await run(options), repeated = await run(options);
    assert.equal(query.scores.size, 2);
    assert.equal(titled.bodyHash, plain.bodyHash);
    assert.notDeepEqual(titled.examples.document.first, plain.examples.document.first);
    assert.deepEqual(repeated.retrieval, titled.retrieval);
    assert.equal(repeated.embeddedTokens, titled.embeddedTokens);
});

test('pooled comparisons keep independent search pools with the same local index distinct', () => {
    const row = bit => ({ hotpotqa: { complete512: { 'pooled/dense': bit } } });
    const sample = bit => ({ samples: { hotpotqa: { groups: [0] } }, runs: { scored: row(bit), packed: row('0') } });
    assert.deepEqual(contrast([sample('1'), sample('0')], ['hotpotqa'], [['scored', 1], ['packed', -1]]),
        { deltaPoints: 50, ci95: [0, 100] });
});

test('top-k retrieval delivers whole ranked chunks and charges their separators', async () => {
    const parts = ['One', 'Two', 'Tri', 'Four', 'Gold'], source = parts.join('\n\n');
    const dataset = { docs: [{ source }], questions: [{ id: 'q', text: 'Which?', pool: [0],
        references: [[[0, source.indexOf('Gold'), source.length]]] }] };
    const encoder = { stats: {}, countTokens: s => s.length, offsets: s => Array.from(s, (_, i) => [i, i + 1, i + 1]),
        embed: texts => texts.map(() => [1]) };
    await prepareDataset(dataset, encoder);
    const result = await evaluate('cuad', dataset, { method: 'pack', chars: 4 }, encoder, 'baselines');
    const { top3, top5 } = result.retrieval['document/dense'];
    assert.equal(top3.complete, 0);
    assert.equal(top3.deliveredTokens, parts.slice(0, 3).join('\n\n').length);
    assert.equal(top5.complete, 1);
    assert.equal(top5.deliveredTokens, source.length);
    const options = { deliveries: [['clipped', 5, 17], ['whole', 4, Infinity], ['all', 5, source.length]] };
    const measured = await evaluate('cuad', dataset, { method: 'pack', chars: 4 }, encoder, 'semantic', options);
    assert.deepEqual(measured.hits['document/dense'], { clipped: '0', whole: '0', all: '1' });
    assert.equal(measured.retrieval['document/dense'].clipped.deliveredTokens, 17);
    const changed = await evaluate('cuad', dataset, { method: 'pack', chars: 4 }, encoder, 'semantic',
        { deliveries: [['clipped', 5, source.length]] });
    assert.deepEqual(changed.hits['document/dense'], { clipped: '1' });
});

test('a soft packing target preserves fitting paragraphs while a hard cap splits them', async () => {
    const source = 'Alpha. Beta.\n\nX\n\nY', doc = { source, parsed: new Map() };
    const encoder = { countTokens: s => s.length, embed: async texts => texts.map(() => [1]) };
    async function texts(policy) {
        const costs = { calls: 0, texts: 0, singletons: 0, indexTexts: 0, indexTokens: 0, embeddedTokens: 0 };
        return (await indexDocument(doc, policy, costs, [], {}, encoder)).map(c => c.text);
    }
    assert.deepEqual(await texts({ method: 'pack', tokens: 20, packTarget: 7 }), ['Alpha. Beta.', 'X\n\nY']);
    assert.deepEqual(await texts({ method: 'public-markdown', tokens: 7 }), ['Alpha. ', 'Beta.', 'X\n\nY']);
    assert.deepEqual(await texts({ method: 'plain-priority', chunkingStrategy: 'blocks', tokens: 20 }), ['Alpha. Beta.', 'X', 'Y']);
    assert.deepEqual(await texts({ method: 'plain-priority', chunkingStrategy: 'blocks', tokens: 7 }), ['Alpha.', 'Beta.', 'X', 'Y']);
});

test('a document rule reranks the pool using each document’s selected layout', async () => {
    const docs = [{ source: 'Noise\n\nOther' }, { source: 'Gold\n\nPale' }];
    const dataset = { docs, questions: [{ id: 'q', text: 'Which?', pool: [0, 1], pooled: [0, 1], references: [[[1, 0, 4]]] }] };
    const encoder = { stats: {}, countTokens: s => s.length, offsets: s => Array.from(s, (_, i) => [i, i + 1, i + 1]),
        embed: texts => texts.map(s => ['Which?', 'Noise'].includes(s) ? [1, 0] : s === 'Gold' ? [0.8, 0.6] : [0, 1]) };
    await prepareDataset(dataset, encoder);
    const units = { method: 'public-markdown', tokens: 20, combineChunks: false }, pack = { method: 'pack', tokens: 20 };
    async function hit(select) {
        const row = await evaluate('hotpotqa', dataset, pack, encoder, 'semantic', { deliveries: [['one', 1, 20]], select });
        return row.hits['pooled/dense'].one;
    }
    assert.equal(await hit(() => units), '0');
    assert.equal(await hit(() => pack), '0');
    assert.equal(await hit(doc => doc === docs[0] ? pack : units), '1');
});

test('flattened evidence preserves the annotated occurrence across headings, CRLF and Unicode', () => {
    const source = '# Repeated\r\n\r\n## Section 🙂\r\nRepeated  words\tend.';
    const start = source.lastIndexOf('Repeated');
    const flat = flattenCorpus({ docs: [{ source }], questions: [{ references: [[[0, start, source.length]]] }] });
    assert.equal(flat.docs[0].source, 'Repeated Section 🙂 Repeated words end.');
    const [[[, a, b]]] = flat.questions[0].references;
    assert.equal(a, flat.docs[0].source.lastIndexOf('Repeated'));
    assert.equal(flat.docs[0].source.slice(a, b), 'Repeated words end.');
});

test('a capped semantic layout preserves source occurrences and charges native boundary work', async () => {
    const source = 'One.\n\nTwo three four.', native = ['One. Two three four.'];
    const doc = { source, breakpoints: { windows: 3, windowTokens: 28, layouts: [native, native] } };
    const costs = { calls: 0, texts: 0, singletons: 0, indexTexts: 0, indexTokens: 0, embeddedTokens: 0 };
    const encoder = { countTokens: s => s.length, embed: async texts => texts.map(() => [1]) };
    const chunks = await indexDocument(doc, { method: 'semantic-reference', tokens: 8, cap: true, chunkCount: true }, costs, [], {}, encoder);
    assert.ok(chunks.length > 1 && chunks.every(c => c.text.length <= 8));
    assert.equal(chunks.map(c => c.text).join(''), native[0]);
    assert.equal(costs.embeddedTokens, costs.indexTokens + 28);
    assert.equal(costs.texts, costs.indexTexts + 3);
    assert.equal(chunks.flatMap(c => c.sourceRanges).at(-1).end, source.length);
    const [, next] = alignPlain('one\n\ntwo', ['one', ' two']);
    assert.deepEqual(next.sourceRanges[0], { start: 3, end: 5, outputStart: 0, outputLength: 1 });
});

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

test('the paired formatting effect uses complete document hits and continuous meeting recall', () => {
    const report = { samples: { cuad: { groups: ['c', 'c'] }, qmsum: { groups: ['m', 'm'] } }, runs: {}, comparisons: {} };
    for (const view of ['original', 'flat']) {
        for (const method of ['markdown', 'text', 'recursive', 'recursive-zero', 'semantic-default', 'semantic-count', 'semantic-capped']) {
            const changed = view === 'flat' && method === 'semantic-capped';
            report.runs[view + '/' + method] = {
                cuad: { complete512: { 'document/dense': changed ? '10' : '00' } },
                qmsum: { recall512: { 'document/dense': changed ? [0.5, 0.5] : [0.25, 0.5] } },
            };
        }
    }
    summarizeSemantic(report);
    assert.deepEqual(report.comparisons.documents['change in semantic-capped lead'], { deltaPoints: 50, ci95: [50, 50] });
    assert.deepEqual(report.comparisons.meetings['change in semantic-capped lead'], { deltaPoints: 12.5, ci95: [12.5, 12.5] });
});

test('sentence packing budgets an oversized first sentence and the serialized join', () => {
    const parts = ['abcdefghij', 'abc', 'def'];
    const packed = packSentences(parts, Infinity, s => s.length <= 4);
    assert.equal(packed.join(''), parts.join(''));
    assert.ok(packed.every(s => s.length <= 4));
    assert.deepEqual(packSentences(['a', 'b', 'c'], Infinity, s => s !== 'a b' && s.split(' ').length <= 2), ['a', 'b c']);
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
    const batches = [], scores = [];
    const vectors = { A: [0.55, Math.sqrt(1 - 0.55 ** 2)], B: [1, 0], C: [0.6, 0.8] };
    const result = await combineMarkdown(source, units, texts => {
        batches.push(texts);
        return texts.map(text => vectors[text]);
    }, { method: 'fixed', maxChunkSize: Infinity, fits: s => s !== 'A\n\nB', adaptive: true }, scores);
    assert.deepEqual(scores, [0.6]);
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
