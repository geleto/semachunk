import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';
import { cachedVectors, dimension, embeddingBatches, model, openReplay, openTokenizer, sendEmbeddingBatch } from './encoder.mjs';
import { retrieval } from './quality.mjs';
import { prepare } from './rag.mjs';
import { chunkText } from '../src/index.js';

test('embedding batches respect per-input and total token limits and balance the tail', () => {
    const short = Array(257).fill(1);
    assert.deepEqual(embeddingBatches(short, n => n), [{ start: 0, end: 129 }, { start: 129, end: 257 }]);
    const long = Array(75).fill(8192);
    const batches = embeddingBatches(long, n => n);
    assert.equal(batches.at(-1).end, long.length);
    assert.ok(batches.every(({ start, end }) => (end - start) * 8192 <= 300_000));
    for (const n of [0, 8193]) assert.throws(() => embeddingBatches([1, n], n => n), RangeError);
});

test('a provider aggregate limit splits requests without splitting texts or reordering vectors', async () => {
    const limit = new OpenAI.BadRequestError(400, {message:'Maximum tokens per request exceeded'}, '', new Headers());
    const inputs = ['aaa','bb','c','dddd','ee'];
    const send = async batch => {
        if (batch.length>2) throw limit;
        return {model,usage:{prompt_tokens:batch.reduce((n,s)=>n+s.length,0)},
            data:batch.map((s,index)=>({index,embedding:s})).reverse()};
    };
    const result = await sendEmbeddingBatch(send,inputs);
    assert.equal(result.batchRequests,3);
    assert.equal(result.usage.prompt_tokens,12);
    assert.deepEqual(result.data.toSorted((a,b)=>a.index-b.index).map(r=>r.embedding),inputs);
    await assert.rejects(sendEmbeddingBatch(async()=>{throw limit;},['a']), e=>e===limit);
});

test('a retry uses completed batches and restores provider row order, then replays offline', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-embedding-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const texts = Array.from({ length: 257 }, (_, i) => String(i));
    const requests = [];
    function request(input) {
        requests.push(input.length);
        if (requests.length === 2) throw new Error('interrupted');
        return { model, usage: { prompt_tokens: input.length }, data: input.map((s, index) => {
            const bytes = Buffer.alloc(dimension * 4);
            bytes.writeFloatLE(Number(s));
            return { index, embedding: bytes.toString('base64') };
        }).reverse() };
    }
    await assert.rejects(cachedVectors(texts, () => 1, request, dir), /interrupted/);
    const restored = await cachedVectors(texts, () => 1, request, dir);
    assert.deepEqual(requests, [129, 128, 128]);
    assert.deepEqual(restored.precomputation, { apiRequests: 1, apiInputs: 128, apiInputTokens: 128, cachedBatches: 1 });
    assert.deepEqual(texts.map((_, i) => restored.matrix[i * dimension]), texts.map(Number));
    const offline = await cachedVectors(texts, () => 1, assert.fail, dir);
    assert.equal(offline.vectorsSHA256, restored.vectorsSHA256);
    assert.equal(offline.precomputation.apiRequests, 0);
    await writeFile(join(dir, (await readdir(dir))[0]), Buffer.from('incomplete'));
    await assert.rejects(cachedVectors(texts, () => 1, assert.fail, dir), /Damaged embedding cache/);
});

test('malformed API rows are rejected before cache publication', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-embedding-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const row = { index: 0, embedding: Buffer.alloc(dimension * 4).toString('base64') };
    const run = data => cachedVectors(['A', 'B'], () => 1, () => ({ data, model, usage: { prompt_tokens: 2 } }), dir);
    await assert.rejects(run([row, row]), /row index/);
    await assert.rejects(run([row, { index: 1, embedding: 'AA==' }]), /dimension/);
    assert.deepEqual(await readdir(dir), []);
});

test('exact-string replay reorders rows across batches and reuses simultaneous requests', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-replay-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    for (const input of [['a', 'b'], ['c']]) {
        await cachedVectors(input, () => 1, texts => ({ model, usage: { prompt_tokens: texts.length },
            data: texts.map((text, index) => {
                const bytes = Buffer.alloc(dimension * 4);
                bytes.writeFloatLE(text.charCodeAt(0));
                return { index, embedding: bytes.toString('base64') };
            }) }), dir, true);
    }
    const replay = await openReplay(undefined, dir);
    t.after(replay.close);
    const output = await Promise.all([replay.embed(['c', 'a']), replay.embed(['b', 'c'])]);
    assert.deepEqual(output.map(rows => rows.map(v => v[0])), [[99, 97], [98, 99]]);
    assert.equal(replay.stats.diskTexts, 3);
    assert.equal(replay.stats.apiRequests, 0);
});

test('oversized native chunks pool exact token slices and replay as a single unit vector', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-long-input-'));
    t.after(async () => {
        for (const name of await readdir(dir)) await rm(join(dir, name));
        await rmdir(dir);
    });
    const replay = await openReplay(undefined, dir, { lengthSafe: true });
    t.after(replay.close);
    const text = ' word'.repeat(9000), ids = replay.tokenIds(text);
    const parts = [Array.from(ids.subarray(0, 8191)), Array.from(ids.subarray(8191))];
    await cachedVectors(parts, p => p.length, () => ({ model, usage: { prompt_tokens: ids.length },
        data: parts.map((p, index) => {
            const bytes = Buffer.alloc(dimension * 4);
            bytes.writeFloatLE(1, 4 * index);
            return { index, embedding: bytes.toString('base64') };
        }) }), dir);
    const [v] = await replay.embed([text]);
    const magnitude = Math.hypot(parts[0].length, parts[1].length);
    assert.deepEqual([...v.subarray(0, 2)], parts.map(p => Math.fround(p.length / magnitude)));
    assert.equal(replay.stats.apiRequests, 0);
});

test('a budget ending inside a UTF-8 character cannot recover that character as an answer', t => {
    const encoder = openTokenizer();
    t.after(encoder.close);
    const text = 'A 🌐.', tokens = encoder.offsets(text);
    assert.equal(encoder.countTokens('hello world'), 2);
    assert.equal(tokens.length, encoder.countTokens(text));
    const partial = tokens.findIndex(([, end, visible]) => end > visible);
    assert.ok(partial >= 0);
    const gold = text.indexOf('🌐'), ends = tokens.map(([, , visible]) => visible);
    const score = budget => retrieval([{ questions: [['question', [[gold, gold + 2]]]] }],
        [{ doc: 0, start: 0, index: 0 }], { texts: [text], id: () => 1 }, () => [0], new Map([[0, ends]]), budget);
    assert.equal(score(partial + 1).hits, 0);
    assert.equal(score(ends.findIndex(end => end >= gold + 2) + 1).hits, 1);
});

test('token windows contain whole Unicode characters at both ends', async t => {
    const encoder = openTokenizer();
    t.after(encoder.close);
    const text = 'a '.repeat(127) + '🌐' + ' z'.repeat(140);
    const { windows, sources: [source], vocab } = await prepare([{ title: 'sample', text }], [], chunkText, encoder, {});
    assert.ok(windows.length > 1);
    for (const { start, end, index } of windows) {
        assert.ok(start === 0 || source.ends[start - 1] <= source.starts[start]);
        assert.ok(end === source.starts.length || source.ends[end - 1] <= source.starts[end]);
        assert.equal(vocab.texts[index], text.slice(source.starts[start], source.ends[end - 1]));
        assert.ok(end - start <= 128);
    }
});
