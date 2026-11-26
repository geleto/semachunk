import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';

const json = { inputFormat: 'json' };

test('JSON keeps original record spellings, offsets and duplicate pointer occurrences', async () => {
    const source = '\uFEFF [ {"a/b~":{"k":0,"\\u006b":1}}, [], {}, 9007199254740993 ]';
    const run = options => chunkText(source, { ...json, ...options });
    const whole = await run({ maxChunkSize: Infinity });
    assert.deepEqual(whole.map(c => c.jsonPointer), ['/0', '/1', '/2', '/3']);
    assert.equal(whole[0].text, '{"a/b~":{"k":0,"\\u006b":1}}');
    const leaves = await run({ maxChunkSize: 0 });
    assert.deepEqual(leaves.map(c => [c.jsonPointer, c.text]), [
        ['/0/a~1b~0/k', '"k":0'], ['/0/a~1b~0/k', '"\\u006b":1'],
        ['/1', '[]'], ['/2', '{}'], ['/3', '9007199254740993']
    ]);
    for (const chunk of [...whole, ...leaves]) {
        const [{ start, end, outputStart }] = chunk.sourceRanges;
        assert.equal(outputStart, 0);
        assert.equal(source.slice(start, end), chunk.text);
    }
    for (const value of ['[]', '{}', 'false', 'null', '"text"', '{"a":[1]}']) {
        const [chunk] = await chunkText(value, json);
        assert.equal(chunk.jsonPointer, '');
        assert.equal(chunk.text, value);
    }
    const nested = '['.repeat(64) + '7' + ']'.repeat(64);
    assert.equal((await chunkText(nested, { ...json, maxChunkSize: 0 }))[0].jsonPointer, '/0'.repeat(64));
});

test('JSON descends into oversized containers and preserves uncapped long scalars', async () => {
    const body = 'word '.repeat(250);
    const text = JSON.stringify([{ name: 'Example', body }, { ok: true }]);
    const blocks = await chunkText(text, json);
    assert.deepEqual(blocks.map(c => c.jsonPointer), ['/0/name', '/0/body', '/1']);
    assert.equal(blocks[1].text, '"body":' + JSON.stringify(body));
    for (const combineChunks of [true, false]) {
        assert.deepEqual(await chunkText(text, () => { throw new Error('unexpected embedding'); },
            { ...json, combineChunks, returnEmbedding: false }), blocks);
    }
    for (const options of [{ chunkingStrategy: 'semantic' }, { chunkingStrategy: 'pack' },
        { chunkOverlap: 1 }, { excludeNonLetterSentences: true }]) {
        await assert.rejects(chunkText(text, { ...json, ...options }), /JSON|overlap/i);
    }
});

test('JSON checks syntax before embedding and reports offsets in the original source', async () => {
    const embed = () => { throw new Error('unexpected embedding'); };
    assert.deepEqual(await chunkText('\uFEFF \r\n\t', embed, json), []);
    for (const [s, offset] of [['\uFEFF{"a":}', 6], ['\uFEFF\uFEFF[]', 1], ['\u00a0', 0]]) {
        await assert.rejects(chunkText(s, embed, json), new RegExp('offset ' + offset));
    }
    for (const value of ['[1,]', '/* hi */1', '{}\n{}', '{"x":"\\q"}', '1 true']) {
        await assert.rejects(chunkText(value, embed, json), SyntaxError);
    }
    const deep = '['.repeat(30000) + '0' + ']'.repeat(30000);
    await assert.rejects(chunkText(deep, embed, json), e => e instanceof SyntaxError && e.cause instanceof RangeError);
});

test('JSON packs only whole siblings of the same record and maps their exact source slice', async () => {
    const source = '\uFEFF[{"a":1, "b":2, "c":3},{"a":4, "b":5}]';
    const chunks = await chunkText(source, { ...json, maxChunkSize: 12 });
    assert.deepEqual(chunks.map(c => [c.jsonPointer, c.text]), [
        ['/0', '"a":1, "b":2'], ['/0/c', '"c":3'], ['/1', '"a":4, "b":5']
    ]);
    for (const { text, sourceRanges: [{ start, end }] } of chunks) assert.equal(source.slice(start, end), text);

    const duplicate = await chunkText('{"a":[1,2],"a":[3,4]}', { ...json, maxChunkSize: 3 });
    assert.deepEqual(duplicate.map(c => [c.jsonPointer, c.text]), [['/a', '1,2'], ['/a', '3,4']]);
    const capped = await chunkText('{"a":1,"b":2,"c":3}', { ...json, maxChunkSize: 13, maxChunkTokens: 1,
        countTokens: s => s === '"b":2' ? 2 : 1 });
    assert.deepEqual([...new Set(capped.map(c => c.jsonPointer))], ['/a', '/b', '/c']);
    assert.ok(capped.filter(c => c.jsonPointer === '/b').length > 1);
});

test('JSON hard cuts include the prefix and preserve escapes in keys and values', async () => {
    const text = '{"\\u00e9":"a\\\\b\\n \\ud83d\\ude00 🙂 end"}';
    const options = { ...json, countTokens: value => value.length, chunkPrefix: 'X', excludeChunkPrefixInResults: true };
    const chunks = await chunkText(text, { ...options, maxChunkTokens: 15 });
    assert.equal(chunks.map(c => c.text).join(''), text.slice(1, -1));
    for (const chunk of chunks) {
        assert.equal(chunk.jsonPointer, '/é');
        assert.equal(chunk.text.isWellFormed(), true);
        assert.equal(chunk.embeddingText, 'X: ' + chunk.text);
        assert.ok(chunk.embeddingText.length <= 15);
    }
    for (const spelling of ['\\u00e9', '\\\\', '\\n', '\\ud83d\\ude00', '🙂']) {
        assert.ok(chunks.some(c => c.text.includes(spelling)));
    }
    const over = await chunkText(text, { ...options, maxChunkTokens: 14 });
    assert.deepEqual(over.filter(c => c.tokenLimitExceeded).map(c => c.text), [String.raw`\ud83d\ude00`]);
    const emoji = await chunkText('"🙂"', { ...options, maxChunkTokens: 4 });
    assert.deepEqual(emoji.filter(c => c.tokenLimitExceeded).map(c => c.text), ['🙂']);
});

test('JSON embeds duplicate inputs once and maps visible prefixes to each occurrence', async () => {
    const batches = [];
    const chunks = await chunkText('[42, 42]', async texts => {
        batches.push(texts);
        return texts.map(() => [1, 2]);
    }, { ...json, chunkPrefix: 'id', excludeChunkPrefixInResults: false });
    assert.deepEqual(batches, [['id: 42']]);
    assert.deepEqual(chunks.map(c => [c.text, c.sourceRanges]), [
        ['id: 42', [{ start: 1, end: 3, outputStart: 4 }]],
        ['id: 42', [{ start: 5, end: 7, outputStart: 4 }]]
    ]);
    assert.notEqual(chunks[0].embedding, chunks[1].embedding);
});

test('JSON cuts long strings at decoded line and sentence ends, preserving their raw spelling', async () => {
    const values = [['"First sentence. Second sentence."', true], ['"aaa\\nbbb\\u000accc"', true],
        ['"aaa\\\\nbbb"', false], ['"第一句。第二句。第三句。"', true],
        ['"https://example.org/api?x=' + 'ab'.repeat(50) + '!next"', false]];
    for (const [spelling, splits] of values) {
        const text = '\uFEFF[{"a/b":' + spelling + '}]';
        const rows = await chunkText(text, { ...json, maxChunkSize: 6, locale: 'en' });
        assert.equal(rows.map(c => c.text).join(''), '"a/b":' + spelling);
        assert.ok(rows.every(c => c.jsonPointer === '/0/a~1b' && c.text === text.slice(c.sourceRanges[0].start, c.sourceRanges[0].end)));
        assert.equal(rows.length > 1, splits);
    }
    for (const input of ['"first\\nsecond"', '["first\\nsecond"]']) {
        assert.deepEqual((await chunkText(input, { ...json, maxChunkSize: 5 })).map(c => c.text), ['"first\\n', 'second"']);
    }
    await assert.rejects(chunkText('[]', { ...json, locale: '@@' }), RangeError);
});

test('soft JSON sentence cuts keep a run of decoded line breaks with the preceding sentence', async () => {
    for (const breaks of ['\\n\\n', '\\r\\n\\r\\n', '\\u2028\\u2029', '\u2028\u2029', '\\n\u2028\\u000d']) {
        const expected = ['"First. ', 'Alpha beta gamma delta.' + breaks, 'Next"'];
        const source = expected.join('');
        const rows = await chunkText(source, { ...json, maxChunkSize: 24 });
        assert.deepEqual(rows.map(c => c.text), expected);
        for (const { text, jsonPointer, sourceRanges: [r] } of rows) {
            assert.equal(jsonPointer, '');
            assert.equal(source.slice(r.start, r.end), text);
        }
    }
});

test('all four literal and escaped surrogate pairs survive token cuts with or without a prefix', async () => {
    for (const high of ['\\ud83d', '\uD83D']) for (const low of ['\\ude00', '\uDE00']) {
        const atom = high + low, source = '["x' + atom + 'y"]';
        for (const prefix of ['', 'P']) for (const delta of [-1, 0]) {
            const budget = atom.length + (prefix ? 3 : 0) + delta;
            const rows = await chunkText(source, { ...json, maxChunkTokens: budget, countTokens: s => s.length,
                chunkPrefix: prefix, excludeChunkPrefixInResults: true });
            assert.equal(rows.map(c => c.text).join(''), source.slice(1, -1));
            const part = rows.find(c => c.text.includes(atom));
            assert.ok(part);
            assert.equal(!!part.tokenLimitExceeded, delta < 0);
        }
    }
    const key = 'a'.repeat(200), source = '{"' + key + '":0}';
    const parts = await chunkText(source, { ...json, maxChunkTokens: 10, countTokens: s => s.length });
    assert.equal(parts.map(c => c.text).join(''), source.slice(1, -1));
    assert.ok(parts.every(c => c.jsonPointer === '/' + key));
});

test('JSON coalesces overflow across soft cuts of one scalar and keeps a fitting neighbor', async () => {
    const source = '"A\\nB\\nC"';
    const opts = { ...json, maxChunkSize: 4, maxChunkTokens: 1, countTokens: s => s.length, chunkPrefix: 'p' };
    for (const hide of [false, true]) {
        const rows = await chunkText(source, assert.fail, { ...opts, excludeChunkPrefixInResults: hide });
        assert.deepEqual(rows, [{ text: hide ? source : 'p: ' + source, jsonPointer: '', tokenLimitExceeded: true,
            sourceRanges: [{ start: 0, end: source.length, outputStart: hide ? 0 : 3 }], ...(hide && { embeddingText: 'p: ' + source }) }]);
    }
    const calls = [];
    const rows = await chunkText(source, texts => { calls.push(...texts); return texts.map(() => [1]); }, {
        ...opts, excludeChunkPrefixInResults: true, countTokens: s => s === 'B' || s === 'p: B' ? 1 : 99
    });
    assert.deepEqual(calls, ['p: B']);
    assert.deepEqual(rows.map(c => [c.text, !!c.tokenLimitExceeded]), [['"A\\n', true], ['B', false], ['\\nC"', true]]);
    const duplicate = await chunkText('{"x":' + source + ',"\\u0078":' + source + '}', assert.fail, opts);
    assert.deepEqual(duplicate.map(c => [c.jsonPointer, c.text]), [['/x', 'p: "x":' + source], ['/x', 'p: "\\u0078":' + source]]);

    // The hard split in the last span must preserve the soft cut between the two fitting spans.
    const separate = await chunkText(source, { ...json, maxChunkSize: 4, maxChunkTokens: 1,
        countTokens: s => s.includes('C') ? 2 : 1 });
    assert.deepEqual(separate.map(c => [c.text, !!c.tokenLimitExceeded]), [['"A\\n', false], ['B\\n', false], ['C', true], ['"', false]]);
});

test('padded JSON sentences retain abbreviations, escaped whitespace and exact source offsets', async () => {
    const pad = ' \\t\\u00a0'.repeat(4096);
    const parts = ['"body":"Dr.' + pad + 'Jones arrived.' + pad, '\\u00dfeta.' + pad, 'Last."'];
    const source = '\uFEFF{' + parts.join('') + '}';
    const rows = await chunkText(source, { ...json, maxChunkSize: 12 });
    assert.deepEqual(rows.map(c => c.text), parts);
    for (const { text, jsonPointer, sourceRanges: [r] } of rows) {
        assert.equal(jsonPointer, '/body');
        assert.equal(r.outputStart, 0);
        assert.equal(source.slice(r.start, r.end), text);
    }
});
