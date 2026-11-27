import { dimension } from './encoder.mjs';
import { tokenBudget } from '../src/token-limit.js';
import { packSentences } from '../src/packing.js';

export const sentencePlan = { chunkingStrategy: 'pack', maxChunkSize: 0 };

export function qualityPlans() {
    const plans = { default: {}, sentences: sentencePlan };
    for (const size of [250, 500, 1000]) {
        plans['blocks-' + size] = { chunkingStrategy: 'blocks', maxChunkSize: size };
        plans['semantic-' + size] = { chunkingStrategy: 'semantic', maxChunkSize: size };
        plans['semantic-blocks-' + size] = { chunkingStrategy: 'semantic-blocks', maxChunkSize: size };
        plans['pack-' + size] = { pack: true, maxChunkSize: size };
        for (const cutoff of [0.3, 0.4, 0.5, 0.6, 0.7]) {
            plans['merge-' + size + '-' + cutoff] = { chunkingStrategy: 'semantic', maxChunkSize: size, similarityThreshold: cutoff };
        }
        plans['merge-' + size + '-document'] = { chunkingStrategy: 'semantic', maxChunkSize: size, mergeThresholdMode: 'document' };
    }
    return plans;
}

export function vocabulary() {
    const ids = new Map(), texts = [];
    function intern(text) {
        if (!ids.has(text)) { ids.set(text, texts.length); texts.push(text); }
        return ids.get(text);
    }
    function id(text) {
        if (!ids.has(text)) throw new Error('Text missing from frozen candidate set: ' + text.slice(0, 80));
        return ids.get(text);
    }
    return { texts, intern, id };
}

export function internCandidates(parts, maxSize, vocab) {
    for (let i = 0; i < parts.length; i++) {
        let span = parts[i];
        vocab.intern(span);
        for (let j = i + 1; j < parts.length && span.length + 1 + parts[j].length <= maxSize; j++) {
            span += ' ' + parts[j];
            vocab.intern(span);
        }
    }
}

export async function split(chunkText, text, options = sentencePlan) {
    const unexpected = () => { throw new Error('Splitting requested embeddings'); };
    const chunks = await chunkText(text, unexpected, { ...options, returnEmbedding: false });
    return chunks.filter(chunk => !chunk.tokenLimitExceeded).map(chunk => chunk.text);
}

export async function measure(chunkText, doc, plan, vocab, matrix, countTokens) {
    let calls = 0, inputs = 0, singletons = 0, providerTokens = 0;
    function embed(batch) {
        for (const text of batch) {
            const tokens = countTokens(text);
            if (plan.maxChunkTokens && tokens > plan.maxChunkTokens) throw new Error('Token limit exceeded in an embedding request');
            providerTokens += tokens;
        }
        calls++;
        inputs += batch.length;
        if (batch.length === 1) singletons++;
        return batch.map(text => {
            const start = vocab.id(text) * dimension;
            return matrix.subarray(start, start + dimension);
        });
    }
    let chunks;
    if (plan.pack) {
        const fits = tokenBudget(plan.maxChunkTokens ?? Infinity, countTokens, '');
        chunks = packSentences(doc.parts, plan.maxChunkSize, fits).map(text => ({ text, tokenLimitExceeded: fits && !fits(text) }));
    } else {
        const { flatInput, ...options } = plan;
        if (options.maxChunkTokens) options.countTokens = countTokens;
        chunks = await chunkText(flatInput ? doc.flat : doc.raw, embed, { ...options, returnEmbedding: true });
    }
    const indexed = chunks.filter(c => !c.tokenLimitExceeded).map(c => c.text);
    if (plan.pack && indexed.length) embed([...new Set(indexed)]);
    const ids = indexed.map(vocab.id);
    // Keep rejected text for source alignment. It has no vector ID.
    const pieces = chunks.length === ids.length ? undefined :
        chunks.map(c => c.tokenLimitExceeded ? { text: c.text } : { text: c.text, index: vocab.id(c.text) });
    return { ids, ...(pieces && { pieces }), calls, inputs, singletons, providerTokens };
}

export function sourcePieces(row, texts) {
    return row.pieces ?? row.ids.map(index => ({ index, text: texts[index] }));
}

export function indexedChunks(docs, rows, texts) {
    const chunks = [];
    docs.forEach((doc, d) => {
        let cursor = 0;
        const pieces = sourcePieces(rows[d], texts);
        for (const [i, { text, index }] of pieces.entries()) {
            if (!doc.text.startsWith(text, cursor)) throw new Error('Chunk disagrees with ' + doc.title + ' at ' + cursor);
            if (index !== undefined) chunks.push({ doc: d, start: cursor, index });
            cursor += text.length;
            if (doc.text[cursor] === ' ' && !pieces[i + 1]?.text.startsWith(' ')) cursor++;
        }
        if (cursor !== doc.text.length) throw new Error('Incomplete chunk coverage in ' + doc.title);
    });
    return chunks;
}

export function costs(rows) {
    return { providerCalls: rows.reduce((n, r) => n + r.calls, 0), providerTexts: rows.reduce((n, r) => n + r.inputs, 0),
        singletonCalls: rows.reduce((n, r) => n + r.singletons, 0) };
}

// Each plan reuses the same normalized vectors. Compute each question/passage
// dot product once per dataset and rank ties in the original passage order.
export function denseRanker(matrix, width = dimension) {
    const cached = new Map();
    return (query, indices) => {
        if (!cached.has(query)) cached.set(query, new Float32Array(matrix.length / width).fill(NaN));
        const scores = cached.get(query), q = query * width;
        for (const id of indices) {
            if (!Number.isNaN(scores[id])) continue;
            let dot = 0;
            const p = id * width;
            for (let j = 0; j < width; j++) dot += matrix[q + j] * matrix[p + j];
            scores[id] = dot;
        }
        return indices.map((_, i) => i).sort((a, b) => scores[indices[b]] - scores[indices[a]]);
    };
}
