import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenBudget } from '../src/token-limit.js';
import { repeatedSourceFraction } from './delivered-context.mjs';
import { contrast } from './markdown-decisions.mjs';
import { growMarkdown } from './markdown-overlap.mjs';

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
    const spans = await growMarkdown(source, originals, cores, async texts => {
        batches.push(texts);
        return texts.map(text => vectors[text] ?? [1, 0]);
    }, { cutoff: 0.5, maxChunkSize: Infinity, countTokens: s => s.length, ...options }, stats);
    assert.deepEqual({ originals, cores }, snapshot);
    for (const span of spans) {
        assert.equal(span.start, originals[span.first].start);
        assert.equal(span.end, originals[span.last].end);
    }
    return { ranges: spans.map(s => [s.first, s.last]), batches, rounds: stats.grewPerRound };
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
    const out = await grow(data, data.originals.map((_, i) => [i, i]), {}, { sideUnits: 1 });
    assert.deepEqual(out.ranges, [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4]]);
    assert.deepEqual(out.rounds, [5, 3]);
    assert.equal(out.batches.length, 2);
    assert.deepEqual(out.batches[1].toSorted(), ['A B', 'B C', 'C D']);
});

test('a refreshed span can admit a previously weak side and the frozen-core test can reject it', async () => {
    const data = fixture(['L', 'C', 'R', 'S']);
    const vectors = { L: [0, 1], S: [-1, 0], 'C R': [0, 1], 'L C R': [0, 1] };
    const local = await grow(data, [[1, 1]], vectors);
    assert.deepEqual(local.ranges, [[0, 2]]);
    assert.deepEqual(local.batches.slice(1), [['S', 'C R'], ['L C R']]);
    const anchored = await grow(data, [[1, 1]], vectors, { anchor: true });
    assert.deepEqual(anchored.ranges, [[1, 2]]);
});

test('the proposed-body floor tries the other side when the preferred expansion moves too far', async () => {
    const data = fixture(['L', 'C', 'R', 'S']);
    const vectors = { R: [0.8, 0.6], S: [-1, 0], 'L C': [0, 1], 'C R': [1, 0], 'L C R': [0, 1] };
    const out = await grow(data, [[1, 1]], vectors, { coreFloor: 1 });
    assert.deepEqual(out.ranges, [[1, 2]]);
    assert.deepEqual(out.rounds, [1, 0]);
    assert.deepEqual(out.batches.slice(1), [['L C'], ['C R'], ['S'], ['L C R']]);
});

test('each whole proposed body must clear the floor against the same starting core', async () => {
    const data = fixture(['C', 'X', 'Y', 'Z']);
    const vectors = { 'C X': [0.9, 0.4], Y: [0.8, 0.6], 'C X Y': [0.6, 0.8], Z: [0.6, 0.8] };
    assert.deepEqual((await grow(data, [[0, 0]], vectors)).ranges, [[0, 3]]);
    const guarded = await grow(data, [[0, 0]], vectors, { coreFloor: 0.8 });
    assert.deepEqual(guarded.ranges, [[0, 1]]);
    assert.equal(guarded.batches.flat().filter(text => text === 'C X').length, 1);
    assert.ok(!guarded.batches.flat().includes('C X Y Z'));
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
