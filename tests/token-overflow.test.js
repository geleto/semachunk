import assert from 'node:assert/strict';
import test from 'node:test';
import {splitPassages} from '../src/passages.js';
import { get_encoding } from 'tiktoken';

const countTokens = s => s.includes('🌍') ? 100 : s.length;
const options = { countTokens, maxChunkTokens: 20, chunkPrefix: 'P', excludeChunkPrefixInResults: true };
const sentences = ['One.', 'Two.', 'Three.', 'Four.'];
const plain = { scoring: sentences, bodies: ['One. Two.', '🌍', '!', 'Three. Four.'] };
const formats = [
    { inputFormat: 'text', source: 'One. Two.\n\n🌍!\n\nThree. Four.', ...plain },
    { inputFormat: 'html', source: '<p>One. Two.</p><p>🌍!</p><p>Three. Four.</p>', ...plain },
    { inputFormat: 'markdown', source: 'One.\n\nTwo.\n\n🌍!\n\nThree.\n\nFour.', scoring: sentences,
        bodies: ['One.\n\nTwo.', '🌍', '!', 'Three.\n\nFour.'] },
    { inputFormat: 'json', source: '["One.","Two.","🌍!","Three.","Four."]', scoring: [],
        bodies: ['"One."', '"Two."', '"', '🌍', '!"', '"Three."', '"Four."'] }
];

test('mixed overflow sends exactly the eligible boundary and final indexing inputs', async () => {
    for (const { inputFormat, source, scoring, bodies } of formats) {
        for (const maxCachedEmbeddings of [0, 2, Infinity]) for (const returnEmbedding of [false, true]) {
            const called = [];
            const rows = await splitPassages(source, inputs => {
                called.push([...inputs]);
                return inputs.map(() => [1]);
            }, { ...options, inputFormat, chunkingStrategy: inputFormat === 'json' ? 'blocks' : 'semantic',
                combineChunksSimilarityThreshold: 0.5, returnEmbedding, maxCachedEmbeddings });
            const finalBatch = returnEmbedding ? bodies.filter(s => s !== '🌍').map(s => 'P: ' + s) : [];
            assert.deepEqual(called, [scoring, finalBatch].filter(batch => batch.length));
            assert.deepEqual(rows.map(c => c.text), bodies);
            assert.deepEqual(rows.filter(c => c.tokenLimitExceeded).map(c => c.text), ['🌍']);
            assert.ok(rows.every(c => !!c.embedding === (returnEmbedding && !c.tokenLimitExceeded)));
        }
    }
});

test('callback-free and embedded structural layouts agree on text, overflow and citation metadata', async () => {
    for (const { inputFormat, source } of formats) {
        for (const chunkingStrategy of inputFormat === 'json' ? ['blocks'] : ['blocks', 'pack']) {
            const opts = { ...options, inputFormat, chunkingStrategy };
            const layout = await splitPassages(source, undefined, opts);
            assert.deepEqual(await splitPassages(source, assert.fail, { ...opts, returnEmbedding: false }), layout);
            const calls = [];
            const rows = await splitPassages(source, inputs => { calls.push(...inputs); return inputs.map(() => [1]); }, opts);
            assert.deepEqual(rows.map(({ embedding, ...chunk }) => chunk), layout);
            const fitting = layout.filter(c => !c.tokenLimitExceeded).map(c => 'P: ' + c.text);
            assert.deepEqual(calls, [...new Set(fitting)]);
        }
    }
});

test('each format checks both the raw body and the exact prefixed input', async () => {
    const prefix = 'P: ';
    for (const [inputFormat, source] of [
        ['text', '11\n\n222'], ['html', '<p>11</p><p>222</p>'],
        ['markdown', '11\n\n222'], ['json', '[11,222]']
    ]) {
        const opts = { inputFormat, chunkingStrategy: 'blocks', maxChunkTokens: 2,
            chunkPrefix: 'P', excludeChunkPrefixInResults: true };
        const blocked = await splitPassages(source, assert.fail, { ...opts, countTokens: s => s.length });
        assert.deepEqual(blocked.map(c => [c.text, c.tokenLimitExceeded, c.embedding]),
            [['11', true, undefined], ['222', true, undefined]], inputFormat);

        // Adding the prefix reduces the count to one. The raw body "222" still needs a cut.
        const calls = [];
        const rows = await splitPassages(source, inputs => {
            calls.push(...inputs);
            return inputs.map(() => [1]);
        }, { ...opts, countTokens: s => s.startsWith(prefix) && s !== prefix ? 1 : s.length });
        assert.equal(rows[0].text, '11');
        assert.equal(rows.slice(1).map(c => c.text).join(''), '222');
        assert.ok(rows.every(c => c.text.length <= 2 && !c.tokenLimitExceeded && c.embedding));
        assert.deepEqual(calls, [...new Set(rows.map(c => prefix + c.text))]);
    }
});

test('a long prefix keeps each source unit once and tokenizer exceptions propagate', async () => {
    const source = 'a'.repeat(8192);
    const options = { separator: '|', chunkingStrategy: 'pack', chunkPrefix: 'large', maxChunkTokens: 1, countTokens: s => s.length };
    const [over] = await splitPassages(source, assert.fail, options);
    assert.equal(over.text, 'large: ' + source);
    assert.equal(over.tokenLimitExceeded, true);
    assert.deepEqual(over.sourceRanges, [{ start: 0, end: source.length, outputStart: 7 }]);
    const [ok] = await splitPassages('x', undefined, { ...options, countTokens: s => ['x', 'large: x'].includes(s) ? 1 : 5 });
    assert.equal(ok.tokenLimitExceeded, undefined);
    const error = new RangeError('caller counter');
    await assert.rejects(splitPassages('x', undefined, { ...options, countTokens: () => { throw error; } }), e => e === error);
});

test('a space can make a stranded emoji fit a real model token', async () => {
    const tok = get_encoding('cl100k_base');
    try {
        const source = '"Wednesday 😀"';
        const opts = { maxChunkTokens: 1, countTokens: s => tok.encode_ordinary(s).length };
        const rows = await splitPassages(source, undefined, { inputFormat: 'json', ...opts });
        assert.ok(rows.every(c => !c.tokenLimitExceeded && opts.countTokens(c.text) <= 1));
        assert.ok(rows.some(c => c.text === ' 😀'));
        assert.equal(rows.map(c => c.text).join(''), source);
        for (const [inputFormat, text] of [['text', 'Wednesday 😀'], ['html', '<p>Wednesday 😀</p>']]) {
            for (const chunkingStrategy of ['pack', 'blocks', 'semantic']) {
                const calls = [];
                const pieces = await splitPassages(text, inputs => { calls.push(...inputs); return inputs.map(() => [1]); },
                    { ...opts, inputFormat, chunkingStrategy });
                assert.deepEqual(calls, ['Wednesday', ' 😀']);
                assert.deepEqual(pieces, calls.map(text => ({ text, embedding: [1] })));
            }
        }
    } finally { tok.free(); }
});

test('a discarded space can rescue the left fragment and belongs to only one piece', async () => {
    const pieces = await splitPassages('😀 😀', undefined, { chunkingStrategy: 'blocks', maxChunkTokens: 1,
        countTokens: s => ['😀 ', ' 😀'].includes(s) ? 1 : 2 });
    assert.deepEqual(pieces, [{ text: '😀 ' }, { text: '😀', tokenLimitExceeded: true }]);
});

test('a fitting JSON piece can rescue its over-limit neighbor across a soft cut', async t => {
    const tok = get_encoding('cl100k_base');
    t.after(() => tok.free());
    const source = '"? ⇒"', countTokens = s => tok.encode_ordinary(s).length;
    const calls = [];
    const rows = await splitPassages(source, inputs => { calls.push(...inputs); return inputs.map(() => [1]); }, {
        inputFormat: 'json', maxChunkSize: 3, maxChunkTokens: 2, countTokens
    });
    assert.deepEqual(calls, ['"? ⇒', '"']);
    assert.deepEqual(rows, [
        { text: '"? ⇒', jsonPointer: '', embedding: [1], sourceRanges: [{ start: 0, end: 4, outputStart: 0 }] },
        { text: '"', jsonPointer: '', embedding: [1], sourceRanges: [{ start: 4, end: 5, outputStart: 0 }] }
    ]);
});

test('two individually over-limit neighbors get a join attempt before a longer overflow run is emitted', async () => {
    const calls = [];
    const rows = await splitPassages('ABC', texts => { calls.push(...texts); return texts.map(() => [1]); }, {
        chunkingStrategy: 'blocks', separator: '|', maxChunkTokens: 1, countTokens: text => text === 'AB' ? 1 : 2
    });
    assert.deepEqual(calls, ['AB']);
    assert.deepEqual(rows.map(c => [c.text, !!c.tokenLimitExceeded]), [['AB', false], ['C', true]]);
});

test('a stranded piece is indexed when its completed neighbor makes one model token', async t => {
    const tok = get_encoding('cl100k_base');
    t.after(() => tok.free());
    const source = '"합니다"', countTokens = s => tok.encode_ordinary(s).length;
    assert.ok(countTokens('합') > 1);
    assert.equal(countTokens('합니다'), 1);
    const calls = [];
    const rows = await splitPassages(source, inputs => {
        calls.push(...inputs);
        return inputs.map(() => [1]);
    }, { inputFormat: 'json', maxChunkTokens: 1, countTokens });
    assert.deepEqual(calls, ['"', '합니다']);
    assert.deepEqual(rows.map(c => c.text), ['"', '합니다', '"']);
    assert.ok(rows.every(c => c.embedding && !c.tokenLimitExceeded && c.jsonPointer === ''));
    for (const { text, sourceRanges: [r] } of rows) assert.equal(source.slice(r.start, r.end), text);
});

test('a grouped overflow can fit with its left neighbor while two fitting soft spans stay separate', async () => {
    const options = { inputFormat: 'json', maxChunkTokens: 1,
        countTokens: s => ['"', '"abc'].includes(s) ? 1 : 2 };
    assert.deepEqual((await splitPassages('"abc"', undefined, options)).map(c => c.text), ['"abc', '"']);
    const source = '"One. Two."';
    const soft = await splitPassages(source, undefined, { inputFormat: 'json', maxChunkSize: 5 });
    assert.equal(soft.length, 2);
    assert.deepEqual(await splitPassages(source, undefined, { ...options, maxChunkSize: 5, countTokens: () => 1 }), soft);
});
