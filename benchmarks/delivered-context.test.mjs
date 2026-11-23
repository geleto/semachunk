import assert from 'node:assert/strict';
import test from 'node:test';
import { openTokenizer } from './encoder.mjs';
import { alignPlain, deliver, evidenceScore, goldReference } from './delivered-context.mjs';
import { packSentences } from './chunking.mjs';
import { combineMarkdown } from './markdown-merging.mjs';
import { parseMarkdown } from '../src/markdown.js';

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
