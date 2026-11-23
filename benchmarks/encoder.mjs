import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { endianness } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import OpenAI from 'openai';
import { get_encoding } from 'tiktoken';
import { cache, sha256 } from './corpora.mjs';

export const model = 'text-embedding-3-small';
export const dimension = 1536;
export const encodingName = 'cl100k_base';
export const modelInputTokens = 8192;
const rowBytes = dimension * Float32Array.BYTES_PER_ELEMENT;
const replaySuffix = '.' + model + '-' + dimension + '.inputs';
const vectorDirectory = join(cache, 'openai-embeddings');

export function openTokenizer() {
    const bpe = get_encoding(encodingName);
    const counts = new Map(), tokenByteLengths = new Map();
    function countTokens(text) {
        if (!counts.has(text)) counts.set(text, bpe.encode_ordinary(text).length);
        return counts.get(text);
    }
    // Byte-pair tokens can end inside a Unicode character. The first two
    // offsets cover every character touched. The third ends at the last fully
    // visible character when the retrieval budget clips a prefix.
    function offsets(text) {
        const bytes = Buffer.from(text);
        const units = new Uint32Array(bytes.length + 1);
        let char = 0;
        for (let i = 0; i < bytes.length;) {
            const width = bytes[i] < 0x80 ? 1 : bytes[i] < 0xe0 ? 2 : bytes[i] < 0xf0 ? 3 : 4;
            units.fill(char, i, i + width);
            i += width;
            char += width === 4 ? 2 : 1;
        }
        units[bytes.length] = char;
        const spans = [];
        let cursor = 0;
        for (const token of bpe.encode_ordinary(text)) {
            if (!tokenByteLengths.has(token)) tokenByteLengths.set(token, bpe.decode_single_token_bytes(token).length);
            const start = units[cursor];
            cursor += tokenByteLengths.get(token);
            const visibleEnd = units[cursor];
            const partial = cursor < bytes.length && (bytes[cursor] & 0xc0) === 0x80;
            const end = partial ? visibleEnd + (text.codePointAt(visibleEnd) > 0xffff ? 2 : 1) : visibleEnd;
            spans.push([start, end, visibleEnd]);
        }
        return spans;
    }
    return { countTokens, offsets, tokenIds: text => bpe.encode_ordinary(text), close: () => bpe.free() };
}

async function apiKey(envFile) {
    if (!envFile && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    try {
        const key = parseEnv(await readFile(envFile ?? new URL('../.env', import.meta.url), 'utf8')).OPENAI_API_KEY;
        if (key) return key;
    } catch (error) {
        if (envFile || error.code !== 'ENOENT') throw error;
    }
    throw new Error('Set OPENAI_API_KEY or supply --env-file with a file containing OPENAI_API_KEY.');
}

// Plan all requests before spending any tokens. Balance the input count and
// enforce the API's separate per-input and aggregate token ceilings.
export function embeddingBatches(texts, countTokens) {
    const lengths = texts.map(countTokens);
    if (lengths.some(n => n < 1 || n > modelInputTokens)) throw new RangeError('Embedding inputs must contain 1 to 8192 tokens.');
    const batches = [];
    for (let start = 0; start < texts.length;) {
        const left = texts.length - start;
        const size = Math.ceil(left / Math.ceil(left / 256));
        let end = start, tokens = 0;
        while (end < start + size && tokens + lengths[end] <= 300_000) tokens += lengths[end++];
        batches.push({ start, end });
        start = end;
    }
    return batches;
}

function responseBytes(response, count) {
    if (response.model !== model || response.data?.length !== count || !Number.isSafeInteger(response.usage?.prompt_tokens)) {
        throw new Error('Unexpected model, row count or token usage in embeddings response.');
    }
    const bytes = Buffer.alloc(count * rowBytes), seen = new Set();
    for (const { index, embedding } of response.data) {
        if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index) || typeof embedding !== 'string') {
            throw new Error('Invalid row index or encoding in embeddings response.');
        }
        const vector = Buffer.from(embedding, 'base64');
        if (vector.length !== rowBytes) throw new Error('Unexpected OpenAI embedding dimension.');
        vector.copy(bytes, index * rowBytes);
        seen.add(index);
    }
    return bytes;
}

async function readBatch(path, expectedLength) {
    const data = await readFile(path);
    const bytes = data.subarray(64);
    if (data.length !== 64 + expectedLength || sha256(bytes) !== data.toString('ascii', 0, 64)) {
        throw new Error('Damaged embedding cache file: ' + path);
    }
    return bytes;
}

// A completed request is reusable even if a later request fails. The first
// writer publishes the cache entry atomically and concurrent readers reuse it.
export async function cachedVectors(texts, countTokens, request, directory, recordInputs = false) {
    const batches = embeddingBatches(texts, countTokens);
    const matrixBytes = Buffer.alloc(texts.length * rowBytes);
    const precomputation = { apiRequests: 0, apiInputs: 0, apiInputTokens: 0, cachedBatches: 0 };
    await mkdir(directory, { recursive: true });
    for (const { start, end } of batches) {
        const input = texts.slice(start, end), length = input.length * rowBytes;
        const path = join(directory, sha256(JSON.stringify([model, dimension, input])) + '.f32');
        let bytes;
        try { bytes = await readBatch(path, length); precomputation.cachedBatches++; }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const response = await request(input);
            bytes = responseBytes(response, input.length);
            precomputation.apiRequests++;
            precomputation.apiInputs += input.length;
            precomputation.apiInputTokens += response.usage.prompt_tokens;
            const tmp = path + '.' + randomUUID();
            try {
                await writeFile(tmp, Buffer.concat([Buffer.from(sha256(bytes)), bytes]), { flag: 'wx' });
                try { await link(tmp, path); }
                catch (error) {
                    if (error.code !== 'EEXIST') throw error;
                    bytes = await readBatch(path, length);
                }
            } finally { await rm(tmp, { force: true }); }
        }
        if (recordInputs) {
            const temp = path + '.' + randomUUID();
            try {
                await writeFile(temp, JSON.stringify(input), { flag: 'wx' });
                try { await link(temp, path + replaySuffix); } catch (error) { if (error.code !== 'EEXIST') throw error; }
            } finally { await rm(temp, { force: true }); }
        }
        bytes.copy(matrixBytes, start * rowBytes);
    }
    const vectorsSHA256 = sha256(matrixBytes);
    if (endianness() === 'BE') matrixBytes.swap32();
    const matrix = new Float32Array(matrixBytes.buffer, matrixBytes.byteOffset, texts.length * dimension);
    return { matrix, textsSHA256: sha256(JSON.stringify(texts)), vectorsSHA256, precomputation };
}

export function openEncoder(envFile, directory = vectorDirectory) {
    const tokenizer = openTokenizer();
    let client;
    async function request(input) {
        client ??= new OpenAI({ apiKey: await apiKey(envFile), baseURL: 'https://api.openai.com/v1', logLevel: 'off', maxRetries: 5 });
        try {
            return await client.embeddings.create({ input, model, dimensions: dimension, encoding_format: 'base64' });
        } catch (error) {
            // Authentication errors can echo part of a credential in the server's message.
            if (error instanceof OpenAI.APIError) throw new Error('OpenAI embeddings request failed (HTTP ' + (error.status ?? 'connection error') + ').');
            throw error;
        }
    }
    return { ...tokenizer, vectors: (texts, recordInputs) =>
        cachedVectors(texts, input => Array.isArray(input) ? input.length : tokenizer.countTokens(input), request, directory, recordInputs) };
}

// Index recorded provider batches by exact input. A new candidate order or
// batch size can reuse their vectors. Coalesce misses from concurrent documents.
export async function openReplay(envFile, directory = vectorDirectory, { lengthSafe = false } = {}) {
    const encoder = openEncoder(envFile, directory);
    await mkdir(directory, { recursive: true });
    const disk = new Map(), memory = new Map();
    for (const name of await readdir(directory)) {
        if (!name.endsWith('.f32' + replaySuffix)) continue;
        const input = JSON.parse(await readFile(join(directory, name), 'utf8'));
        const file = sha256(JSON.stringify([model, dimension, input])) + '.f32';
        if (file + replaySuffix !== name) throw new Error('Damaged embedding input record: ' + name);
        input.forEach((text, row) => disk.set(text, { file, row, count: input.length }));
    }
    const stats = { apiRequests: 0, apiInputs: 0, apiInputTokens: 0, diskTexts: 0, memoryTexts: 0, replayMs: 0 };
    async function vectors(inputs, recordInputs) {
        const { matrix, precomputation } = await encoder.vectors(inputs, recordInputs);
        for (const key of ['apiRequests', 'apiInputs', 'apiInputTokens']) stats[key] += precomputation[key];
        return matrix;
    }
    // OpenAIEmbeddings pools oversized inputs by token count, then normalizes.
    async function longVector(text) {
        const ids = encoder.tokenIds(text), parts = [];
        for (let i = 0; i < ids.length; i += 8191) parts.push(Array.from(ids.subarray(i, i + 8191)));
        const matrix = await vectors(parts, false), sum = new Float64Array(dimension);
        parts.forEach((p, i) => {
            for (let j = 0; j < dimension; j++) sum[j] += p.length * matrix[i * dimension + j];
        });
        const norm = Math.hypot(...sum);
        if (!Number.isFinite(norm) || !norm) throw new Error('Invalid pooled embedding');
        return Float32Array.from(sum, x => x / norm);
    }
    let pending = [], flushing = false;
    async function flush() {
        flushing = true;
        while (pending.length) {
            const requests = pending;
            pending = [];
            try {
                const started = performance.now(), files = new Map(), missing = [], long = [];
                const unique = new Set(requests.flatMap(r => r.texts));
                for (const text of unique) {
                    if (memory.has(text)) { stats.memoryTexts++; continue; }
                    const hit = disk.get(text);
                    if (lengthSafe && encoder.countTokens(text) > 8191) { long.push(text); continue; }
                    if (!hit) { missing.push(text); continue; }
                    if (!files.has(hit.file)) files.set(hit.file, []);
                    files.get(hit.file).push({ text, ...hit });
                }
                for (const [file, hits] of files) {
                    const bytes = await readBatch(join(directory, file), hits[0].count * rowBytes);
                    if (endianness() === 'BE') bytes.swap32();
                    for (const { text, row } of hits) {
                        memory.set(text, new Float32Array(bytes.buffer, bytes.byteOffset + row * rowBytes, dimension));
                        stats.diskTexts++;
                    }
                }
                stats.replayMs += performance.now() - started;
                for (const text of long) memory.set(text, await longVector(text));
                if (missing.length) {
                    const matrix = await vectors(missing, true);
                    missing.forEach((text, i) => memory.set(text, matrix.subarray(i * dimension, (i + 1) * dimension)));
                }
                for (const r of requests) r.resolve(r.texts.map(t => memory.get(t)));
            } catch (error) { for (const r of requests) r.reject(error); }
        }
        flushing = false;
    }
    function embed(texts) {
        return new Promise((resolve, reject) => {
            pending.push({ texts, resolve, reject });
            if (pending.length === 1 && !flushing) setImmediate(flush);
        });
    }
    return { ...encoder, embed, stats };
}
