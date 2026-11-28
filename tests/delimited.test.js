import assert from 'node:assert/strict';
import test from 'node:test';
import {splitPassages} from '../src/passages.js';

const blocks = { chunkingStrategy: 'blocks' }, pack = { chunkingStrategy: 'pack' };

test('literal separators respect Unicode code points, newline spellings and exact source ranges', async () => {
    for (const [source, separator, expected] of [
        ['\r\n 001\r\n \n 002\n', '\n', ['001', '002']], ['a\nb\r\nc', '\r\n', ['a', 'b', 'c']],
        ['a\r\nb\rc', '\r', ['a\r\nb', 'c']], ['a\r\r\nb\r\nc', '\r\n\r\n', ['a\r\r\nb\r\nc']],
        ['|||', '||', ['|']], [' 1 .* 2 .* ', '.*', ['1', '2']], ['x🌍y🌍z', '🌍', ['x', 'y', 'z']],
        ['a🌍b\uD83Cc', '\uD83C', ['a🌍b', 'c']], ['|a||b|', '|', ['a', 'b']]
    ]) {
        const rows = await splitPassages(source, undefined, { ...blocks, separator });
        assert.deepEqual(rows.map(r => r.text), expected);
        assert.deepEqual(await splitPassages(source, undefined, { separator }), rows);
        for (const { text, sourceRanges: [r] } of rows) assert.equal(source.slice(r.start, r.end), text);
    }
});

test('delimiter packing counts actual gaps, overlaps whole records and isolates hard splits', async () => {
    const source = '|a||b | c | d | e|', options = { ...pack, separator: '|' };
    const texts = async args => (await splitPassages(source, undefined, { ...options, ...args })).map(c => c.text);
    assert.deepEqual(await texts({ maxChunkSize: 7, chunkOverlap: 3 }), ['a||b', 'b | c', 'c | d', 'd | e']);
    assert.deepEqual(await texts({ maxChunkSize: 0 }), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(await texts({ maxChunkSize: Infinity }), [source.slice(1, -1)]);
    const run = await splitPassages('A|😀|B', undefined, { ...options, chunkOverlap: 1, maxChunkSize: Infinity, maxChunkTokens: 1,
        countTokens: s => s.includes('|') ? 1 : s.length });
    assert.deepEqual(run.map(c => [c.text, !!c.tokenLimitExceeded]), [['A', false], ['😀', true], ['B', false]]);
    const ranged = await splitPassages('|a||b|', undefined, { ...options, chunkPrefix: 'P', excludeChunkPrefixInResults: true });
    assert.deepEqual(ranged, [{ text: 'a||b', sourceRanges: [{ start: 1, end: 5, outputStart: 0 }], embeddingText: 'P: a||b' }]);
});

test('delimiter validation also applies to empty input', async () => {
    for (const options of [{ chunkingStrategy: 'semantic' }, { chunkingStrategy: 'auto' }, { ...pack, inputFormat: 'html' },
        { ...blocks, inputFormat: 'markdown' }, { ...blocks, inputFormat: 'json' }, { ...pack, excludeNonLetterSentences: true },
        { ...blocks, chunkOverlap: 1 }, { ...blocks, locale: '@@' }]) {
        await assert.rejects(splitPassages('', undefined, { separator: '|', ...options }));
    }
    for (const separator of [null, false, '', 1, {}]) await assert.rejects(splitPassages('', undefined, { ...pack, separator }), /separator/);
    assert.deepEqual(await splitPassages('', undefined, { separator: undefined }), []);
});

test('long literal separators work both when absent and with different newline spellings', async () => {
    const separator = '.*'.repeat(16384) + '\r\n🌍';
    const one = { text: 'one', sourceRanges: [{ start: 0, end: 3, outputStart: 0 }] };
    assert.deepEqual(await splitPassages('one', undefined, { ...pack, separator }), [one]);
    const source = 'one' + separator.replace('\r\n', '\n') + 'two' + separator + 'end';
    const rows = await splitPassages(source, undefined, { ...blocks, separator });
    assert.deepEqual(rows.map(c => c.text), ['one', 'two', 'end']);
    for (const { text, sourceRanges: [r] } of rows) assert.equal(source.slice(r.start, r.end), text);
    assert.deepEqual(await splitPassages(source, undefined, { ...pack, separator, maxChunkSize: Infinity }),
        [{ text: source, sourceRanges: [{ start: 0, end: source.length, outputStart: 0 }] }]);
});

test('a delimiter with an unpaired surrogate at either end matches only complete code points', async () => {
    const emoji = '🌍', run = emoji.repeat(256);
    for (const separator of [emoji[1] + run, run + emoji[0], emoji[1] + run + emoji[0]]) {
        const left = run.repeat(4) + 'x' + emoji[1] + 'x' + emoji[0] + 'x', right = 'y' + run.repeat(4);
        const rows = await splitPassages(left + separator + right, undefined, { ...blocks, separator });
        assert.deepEqual(rows, [
            { text: left, sourceRanges: [{ start: 0, end: left.length, outputStart: 0 }] },
            { text: right, sourceRanges: [{ start: left.length + separator.length, end: left.length + separator.length + right.length, outputStart: 0 }] }
        ]);
    }
    const low = emoji[1], left = low.repeat(256), separator = low.repeat(16) + 'x' + low.repeat(16);
    const rows = await splitPassages(left + separator + 'y', undefined, { ...blocks, separator });
    assert.deepEqual(rows.map(c => c.text), [left, 'y']);
});
