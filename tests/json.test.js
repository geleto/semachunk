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
    await assert.rejects(chunkText(text, { ...options, maxChunkTokens: 14 }), /indivisible escape/);
    await assert.rejects(chunkText('"🙂"', { ...options, maxChunkTokens: 4 }), /code point/);
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
