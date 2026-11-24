import assert from 'node:assert/strict';
import test from 'node:test';
import { createBatchEmbedder } from '../src/embeddings.js';
import { parseMarkdown } from '../src/markdown.js';
import { tokenBudget } from '../src/token-limit.js';
import { deliver, repeatedSourceFraction } from './delivered-context.mjs';
import { contrast, selectExpansion } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { indexDocument } from './markdown-index.mjs';
import { growMarkdown } from './markdown-overlap.mjs';
import { auditBoundaries } from './overlap-boundaries.mjs';

function fixture(words) {
    const source = words.join(' ');
    let start = 0;
    const originals = words.map(word => {
        const unit = { kind: 'prose', start, end: start + word.length, run: 0, sectionId: null };
        start = unit.end + 1;
        return unit;
    });
    return { source, originals };
}

async function grow({ source, originals }, ranges, vectors = {}, options = {}) {
    const cores = ranges.map(([first, last]) => ({ ...originals[first], end: originals[last].end, first, last }));
    const snapshot = structuredClone({ originals, cores }), batches = [], stats = { grewPerRound: [] };
    const spans = await growMarkdown(source, originals, cores, createBatchEmbedder(texts => {
        batches.push(texts);
        return texts.map(text => vectors[text] ?? [1, 0]);
    }), { cutoff: 0.5, maxChunkSize: Infinity, countTokens: s => s.length, ...options }, stats);
    assert.deepEqual({ originals, cores }, snapshot);
    for (const span of spans) {
        assert.equal(span.start, originals[span.first].start);
        assert.equal(span.end, originals[span.last].end);
    }
    return { ranges: spans.map(s => [s.first, s.last]), batches, rounds: stats.grewPerRound, guard: stats.guard };
}

test('both outer cores can take the same original unit in a single batch', async () => {
    const data = fixture(['A', 'B', 'C', 'D', 'E']);
    const out = await grow(data, [[0, 1], [2, 2], [3, 4]], { B: [0, 1], D: [0, 1] }, { fits: text => text.length <= 5 });
    assert.deepEqual(out.ranges, [[0, 2], [2, 2], [2, 4]]);
    assert.deepEqual(out.rounds, [2]);
    assert.equal(out.batches.length, 1);
    assert.equal(out.batches[0].filter(text => text === 'C').length, 1);
});

test('each core grows once per round, ties go left and finished wings stay capped', async () => {
    const data = fixture(['A', 'B', 'C', 'D', 'E']);
    const out = await grow(data, data.originals.map((_, i) => [i, i]), {}, { sideUnits: 1, scoreFromCore: false });
    assert.deepEqual(out.ranges, [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]]);
    assert.deepEqual(out.rounds, [5, 3]);
    assert.equal(out.batches.length, 2);
    assert.deepEqual(out.batches[1].toSorted(), ['A B', 'B C', 'C D']);
});

test('a refreshed span can admit a previously weak side and the frozen-core test can reject it', async () => {
    const data = fixture(['L', 'C', 'R', 'S']);
    const vectors = { L: [0, 1], S: [-1, 0], 'C R': [0, 1], 'L C R': [0, 1] };
    const local = await grow(data, [[1, 1]], vectors, { scoreFromCore: false });
    assert.deepEqual(local.ranges, [[0, 2]]);
    assert.deepEqual(local.batches.slice(1), [['S', 'C R'], ['L C R']]);
    const anchored = await grow(data, [[1, 1]], vectors, { scoreFromCore: false, anchor: true });
    assert.deepEqual(anchored.ranges, [[1, 2]]);
    const frozen = await grow(data, [[1, 1]], vectors);
    assert.deepEqual(frozen.ranges, [[1, 2]]);
    assert.ok(!frozen.batches.flat().includes('C R'));
});

test('a rejected side locks and the other side can win the next round', async () => {
    const data = fixture(['L', 'C', 'R', 'S']);
    const vectors = { R: [0.8, 0.6], S: [-1, 0], 'L C': [0, 1] };
    const out = await grow(data, [[1, 1]], vectors, { coreFloor: 1 });
    assert.deepEqual(out.ranges, [[1, 2]]);
    assert.deepEqual(out.rounds, [0, 1, 0]);
    assert.deepEqual(out.guard, { tried: 2, rejected: 1, reopened: 0 });
    assert.deepEqual(out.batches.slice(1), [['L C'], ['C R'], ['S']]);
    const reopened = await grow(data, [[1, 1]], vectors, { coreFloor: 1, reopen: true });
    assert.deepEqual(reopened.ranges, [[0, 2]]);
    assert.deepEqual(reopened.rounds, [0, 1, 1, 0]);
    assert.deepEqual(reopened.guard, { tried: 3, rejected: 1, reopened: 1 });
    assert.deepEqual(reopened.batches.at(-1), ['L C R']);
    const bothFail = await grow(data, [[1, 1]], { ...vectors, 'C R': [0, 1] }, { coreFloor: 1, reopen: true });
    assert.deepEqual(bothFail.rounds, [0, 0]);
    assert.deepEqual(bothFail.guard, { tried: 2, rejected: 2, reopened: 0 });
    assert.deepEqual(bothFail.ranges, [[1, 1]]);
});

test('two eligible sides are ranked by the chosen reference after the first expansion', async () => {
    const data = fixture(['A', 'L', 'C', 'R']);
    const vectors = { A: [0.95, -0.31], R: [0.8, 0.6], 'L C': [0.93, 0.37] };
    const options = { coreFloor: 0.9, fits: text => text.length <= 5 };
    const frozen = await grow(data, [[2, 2]], vectors, options);
    const live = await grow(data, [[2, 2]], vectors, { ...options, scoreFromCore: false });
    assert.deepEqual(frozen.ranges, [[0, 2]]);
    assert.deepEqual(live.ranges, [[1, 3]]);
    assert.deepEqual(frozen.rounds, [1, 1]);
    assert.deepEqual(live.rounds, [1, 1]);
});

test('rejections defer only their own core and all selected proposals share one batch per round', async () => {
    const data = fixture(['L', 'C', 'R', 'A', 'B', 'D']);
    data.originals.slice(3).forEach(u => u.sectionId = 1);
    const out = await grow(data, [[1, 1], [4, 4]], { 'L C': [0, 1], A: [0.6, 0.8] }, { coreFloor: 1, sideUnits: 1 });
    assert.deepEqual(out.ranges, [[1, 2], [3, 5]]);
    assert.deepEqual(out.rounds, [1, 2]);
    assert.deepEqual(out.batches.slice(1), [['L C', 'B D'], ['C R', 'A B D']]);
});

test('each whole proposed body must clear the floor against the same starting core', async () => {
    const data = fixture(['C', 'X', 'Y', 'Z']);
    const vectors = { 'C X': [0.9, 0.4], Y: [0.8, 0.6], 'C X Y': [0.6, 0.8], Z: [0.6, 0.8] };
    assert.deepEqual((await grow(data, [[0, 0]], vectors)).ranges, [[0, 3]]);
    const guarded = await grow(data, [[0, 0]], vectors, { coreFloor: 0.8 });
    assert.deepEqual(guarded.ranges, [[0, 1]]);
    assert.deepEqual(guarded.guard, { tried: 2, rejected: 1, reopened: 0 });
    assert.equal(guarded.batches.flat().filter(text => text === 'C X').length, 1);
    assert.ok(!guarded.batches.flat().includes('C X Y Z'));
});

for (const title of ['', 'Study']) test('the drift check uses the indexed window and evidence uses the core, with ' +
    (title ? 'a prefix and title' : 'a prefix'), async () => {
    const doc = { source: 'Alpha.\n\nBeta.\n\nGamma.', chunkPrefix: 'Doc', title, parsed: new Map() };
    const prefix = title ? 'Doc: Study: ' : 'Doc: ';
    const bad = prefix + 'Alpha.\n\nBeta.', good = prefix + 'Beta.\n\nGamma.', batches = [];
    const encoder = {
        countTokens: text => text.length,
        offsets: text => Array.from(text, (_, i) => [i, i + 1, i + 1]),
        embed(texts) {
            batches.push(texts);
            // Only the actual prefixed proposal has drifted.
            return texts.map(text => text === bad ? [0, 1] : [1, 0]);
        },
    };
    const context = { retained: 0 };
    const chunks = await indexDocument(doc, { method: 'fixed', coreTokens: 11, tokens: 20, ...(title && { context: 'title', contextCap: 30 }),
        growth: { cutoff: 0.5, coreFloor: 0.9, returnCore: true } }, {}, [], context, encoder);
    assert.deepEqual(chunks.map(c => [c.text, c.embeddingText]), [['Alpha.', prefix + 'Alpha.'], ['Beta.', good], ['Gamma.', good]]);
    assert.deepEqual(chunks.map(c => c.sourceRanges), [[{ start: 0, end: 6, outputStart: 0 }],
        [{ start: 8, end: 13, outputStart: 0 }], [{ start: 15, end: 21, outputStart: 0 }]]);
    assert.deepEqual(context.growth.guard, { tried: 4, rejected: 2, reopened: 0 });
    assert.deepEqual(batches, [[prefix + 'Beta.', prefix + 'Alpha.', prefix + 'Gamma.'], [bad, good]]);
    assert.equal(context.retained, title ? 3 : 0);
    const delivered = deliver([{ ...chunks[1], doc: 0 }], 20, encoder);
    assert.equal(delivered.text, 'Beta.');
    assert.deepEqual(delivered.projected.flat(), Array.from({ length: 5 }, (_, i) => [0, 8 + i, 9 + i]));
});

test('proposed-body embeddings are shared across a round while identical passages keep their source indices', async () => {
    const data = fixture(['A', 'A', 'A', 'B', 'C']);
    const out = await grow(data, [[0, 0], [2, 2], [4, 4]], {}, { fits: text => text.length <= 3, coreFloor: 1 });
    assert.deepEqual(out.ranges, [[0, 1], [1, 2], [3, 4]]);
    assert.deepEqual(out.batches, [['A', 'B', 'C'], ['A A', 'B C']]);
});

test('limits count complete original units, exact wings and the prefixed final body', async () => {
    const data = fixture(['aa', 'bb', 'zzzzzzzzzz']);
    const vectors = { aa: [0.8, 0.6] };
    assert.deepEqual((await grow(data, [[1, 1]], vectors, { sideUnits: 1 })).ranges, [[0, 2]]);
    assert.deepEqual((await grow(data, [[1, 1]], vectors, { sideTokens: 3 })).ranges, [[0, 1]]);
    assert.deepEqual((await grow(data, [[1, 1]], vectors, { sideTokens: 2 })).ranges, [[1, 1]]);
    assert.deepEqual((await grow(data, [[1, 1]], vectors, { limitToCore: true })).ranges, [[1, 1]]);
    const fits = tokenBudget(9, s => s.length, 'P: ');
    assert.deepEqual((await grow(data, [[1, 1]], vectors, { fits })).ranges, [[0, 1]]);
});

test('sections, runs, omitted text, protected blocks and generated fragments stop both sides before embedding', async () => {
    for (const right of [{ sectionId: 2 }, { run: 1 }, { kind: 'code' }, { kind: 'table' }, { parts: [[2, 3]] }, { start: 4, end: 5 }]) {
        const data = fixture(['A', 'B']);
        Object.assign(data.originals[1], right);
        if (right.start) data.source = 'A | B';
        const out = await grow(data, [[0, 0], [1, 1]]);
        assert.deepEqual(out.ranges, [[0, 0], [1, 1]]);
        assert.deepEqual(out.batches, []);
    }
});

test('real Markdown growth stays on its side of each structural block or skipped range', async () => {
    const blocks = ['# Topic', 'Topic\n=====', '---', '[ref]: /target', '123.', '~~~js\nlet n = 1\n~~~',
        '    indented code', '| Header |\n| --- |\n| Cell |', '- item\n- another', '> ## Nested\n> quote', '<div>raw</div>'];
    for (const block of blocks) {
        const source = '\uFEFF---\nkey: value\n---\n\n# Topic\n\nLeft one.\n\nLeft two.\n\n' + block + '\n\nRight one.\n\nRight two.';
        const originals = parseMarkdown(source, { excludeNonLetterSentences: true });
        const out = await grow({ source, originals }, originals.map((_, i) => [i, i]));
        const windows = out.ranges.map(([a, b]) => source.slice(originals[a].start, originals[b].end));
        assert.equal(windows.filter(s => s.includes('Left one.') && s.includes('Left two.')).length, 2, block);
        assert.equal(windows.filter(s => s.includes('Right one.') && s.includes('Right two.')).length, 2, block);
        assert.ok(windows.every(s => !(s.includes('Left two.') && s.includes('Right one.'))), block);
        if (originals.length === 5) {
            assert.deepEqual(out.ranges[2], [2, 2], block);
            assert.deepEqual(out.ranges[1], [0, 1], block);
            assert.deepEqual(out.ranges[3], [3, 4], block);
            const mixedCore = await grow({ source, originals }, [[1, 3]]);
            assert.deepEqual(mixedCore.ranges, [[1, 3]], block);
        }
    }
});

test('overlap adds a complete paragraph or detected sentence and stops on both sides of a hard split', async () => {
    const source = 'Two sentences. In one unit.\n\nReady.\n\nAn exceptionally long sentence with many words that must be cut.\n\nAfter. End.';
    const originals = parseMarkdown(source, { maxChunkSize: Infinity, fits: s => s.length <= 28 });
    const texts = originals.map(u => source.slice(u.start, u.end));
    assert.deepEqual(texts.slice(0, 2), ['Two sentences. In one unit.', 'Ready.']);
    assert.ok(originals.slice(2, -1).length >= 2);
    assert.ok(originals.slice(2, -1).every(u => u.overlapBarrier));
    const ranges = originals.map((_, i) => [i, i]);
    const out = await grow({ source, originals }, ranges);
    assert.deepEqual(out.ranges, [[0, 1], [0, 1], ...ranges.slice(2)]);
    const segmented = 'Alpha begins. Bravo ends. Charlie waits.';
    const units = parseMarkdown(segmented, { maxChunkSize: 20 });
    assert.deepEqual(units.map(u => segmented.slice(u.start, u.end).trim()), ['Alpha begins.', 'Bravo ends.', 'Charlie waits.']);
    const full = await grow({ source: segmented, originals: units }, [[1, 1]]);
    assert.deepEqual(full.ranges, [[0, 2]]);
});

test('the source audit distinguishes new turn crossings and detects invalid sentence or block endpoints', () => {
    const source = 'A: Alpha.\nB: Bravo.\nC: Charlie.\n\n---\n\nDelta.';
    const units = parseMarkdown(source, { sentenceUnits: true });
    const core = { ...units[0], first: 0, last: 1, end: units[1].end };
    const span = { ...core, last: 2, end: units[2].end };
    const stats = {};
    auditBoundaries({ source }, units, [core], [span], stats, true);
    assert.deepEqual(stats.boundaries, { expandedWindows: 1, addedUnits: 1, windowsCrossingNewTurns: 1 });
    const partial = units.map((u, i) => i === 2 ? { ...u, end: u.end - 2 } : u);
    assert.throws(() => auditBoundaries({ source }, partial, [core], [{ ...span, end: partial[2].end }], {}, false), assert.AssertionError);
    assert.throws(() => auditBoundaries({ source }, units, [core], [{ ...span, last: 3, end: units[3].end }], {}, false), assert.AssertionError);
});

test('explicit turn starts allow growth within either outer turn of a core', async () => {
    const data = fixture(['A', 'B', 'C', 'D', 'E', 'F']);
    // Turns contain A, B+C, D+E, and F respectively. The middle core spans two turns.
    const boundaries = [1, 3, 5].map(i => data.originals[i].start);
    const out = await grow(data, [[2, 3], [1, 1], [5, 5]], {}, { boundaries, coreFloor: 1 });
    assert.deepEqual(out.ranges, [[1, 4], [1, 2], [5, 5]]);
    assert.ok(!out.batches.flat().some(s => s.includes('A') || s.includes('F')));
});

test('an expansion can reuse the actual ordinary cutoff while preserving the same cores', async () => {
    const doc = { source: 'A.\n\nB.\n\nC.', parsed: new Map() };
    const first = 'A.\n\nB.';
    const encoder = { countTokens: s => s.length, embed: texts => texts.map(t => t === first ? [0.6, 0.8] : [1, 0]) };
    const policy = { method: 'fixed', adaptive: true, coreTokens: 6, tokens: 10 };
    const run = (cutoff, stats) => indexDocument(doc, { ...policy, growth: { cutoff, returnCore: true } }, {}, [], stats, encoder);
    const stats = {}, shared = await run('merge', stats), fixed = await run(0.5, {});
    assert.deepEqual(stats.growth.mergeCutoffs, [1]);
    assert.deepEqual(shared.map(c => [c.text, c.sourceRanges]), fixed.map(c => [c.text, c.sourceRanges]));
    assert.equal(shared[0].embeddingText, first);
    assert.equal(fixed[0].embeddingText, doc.source);
});

test('expansion nomination keeps the control independent and uses cost and complexity inside the score tolerance', () => {
    const rows = { core256: { percent: 90, embeddedTokens: 1 }, top: { percent: 60, embeddedTokens: 25 },
        wing: { percent: 59.9, embeddedTokens: 5 }, cheaper: { percent: 59.5, embeddedTokens: 10 }, low: { percent: 59.49, embeddedTokens: 2 } };
    const policies = Object.fromEntries(Object.keys(rows).map(name => [name, { growth: name === 'wing' ? { sideTokens: 64 } : {} }]));
    assert.equal(selectExpansion(rows, policies), 'cheaper');
    rows.wing.percent = 61;
    assert.equal(selectExpansion(rows, policies), 'wing');
});

test('cached retrieval distinguishes changed index text on identical cores and still measures cold work', async () => {
    const source = 'Alpha.\n\nBeta.', query = { id: 'q', group: 'd', text: 'Beta?', pool: [0], references: [[[0, 8, 13]]] };
    const dataset = { docs: [{ source }], questions: [query] };
    const encoder = { stats: {}, countTokens: text => text.length, offsets: text => Array.from(text, (_, i) => [i, i + 1, i + 1]),
        embed: texts => texts.map(t => t === 'Beta.' || t === 'Beta?' ? [1, 0] : [0, 1]) };
    await prepareDataset(dataset, encoder);
    const control = await evaluate('cuad', dataset, { method: 'public-markdown', tokens: 6 }, encoder, 'overlap');
    const run = cutoff => evaluate('cuad', dataset, { method: 'fixed', coreTokens: 6, tokens: 13,
        growth: { cutoff, returnCore: true } }, encoder, 'overlap');
    await run(1);
    assert.equal(query.scores.size, 1);
    const expanded = await run(0), repeated = await run(0);
    assert.equal(query.scores.size, 2);
    assert.equal(expanded.bodyHash, control.bodyHash);
    assert.notEqual(expanded.indexHash, control.indexHash);
    assert.notDeepEqual(expanded.examples.document.first, control.examples.document.first);
    assert.deepEqual(repeated.retrieval, expanded.retrieval);
    assert.equal(repeated.embeddedTokens, expanded.embeddedTokens);
});

test('delivered redundancy counts repeated source positions within a document including nested and partial ranges', () => {
    const ranges = [[0, 3, 8], [1, 0, 5], [0, 0, 5], [0, 4, 5], [0, 8, 10]].map(([doc, from, to]) => ({ doc, from, to }));
    assert.equal(repeatedSourceFraction(ranges), 3 / 18);
    assert.equal(repeatedSourceFraction([]), 0);
});

test('pooled comparisons keep independent search pools with the same local index distinct', () => {
    const row = bit => ({ hotpotqa: { complete512: { 'pooled/dense': bit } } });
    const sample = bit => ({ samples: { hotpotqa: { groups: [0] } }, runs: { growth: row(bit), core: row('0') } });
    assert.deepEqual(contrast([sample('1'), sample('0')], ['hotpotqa'], [['growth', 1], ['core', -1]]),
        { deltaPoints: 50, ci95: [0, 100] });
});
