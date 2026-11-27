// One cache per chunkText call, shared by boundary scoring and output batches.
export function createBatchEmbedder(embedBatchCallback, maxEmbeddingBatchSize = Infinity, maxCachedEmbeddings = Infinity) {
    if (maxEmbeddingBatchSize !== Infinity && !(Number.isSafeInteger(maxEmbeddingBatchSize) && maxEmbeddingBatchSize > 0)) {
        throw new RangeError('maxEmbeddingBatchSize must be a positive integer or Infinity.');
    }
    if (maxCachedEmbeddings !== Infinity && !(Number.isSafeInteger(maxCachedEmbeddings) && maxCachedEmbeddings >= 0)) {
        throw new RangeError('maxCachedEmbeddings must be a nonnegative safe integer or Infinity.');
    }
    if (embedBatchCallback == null) return;
    if (typeof embedBatchCallback !== 'function') throw new TypeError('embedBatchCallback must be a function');

    const cache = new Map();
    let dimension;

    return async function embedBatch(texts) {
        const needed = new Set(texts);
        for (const text of needed) if (cache.has(text)) needed.delete(text);
        const missing = [...needed];
        for (let offset = 0; offset < missing.length;) {
            const remaining = missing.length - offset;
            // Balance requests so a final singleton is sent only when unavoidable.
            const batchCount = Math.ceil(remaining / Math.min(remaining, maxEmbeddingBatchSize));
            const count = Math.ceil(remaining / batchCount);
            const vectors = await embedBatchCallback(missing.slice(offset, offset + count));
            dimension = validateEmbeddings(vectors, count, dimension);
            for (let i = 0; i < count; i++) {
                cache.set(missing[offset + i], copyEmbedding(vectors[i]));
            }
            offset += count;
        }
        const result = texts.map(text => cache.get(text));
        // Scoring still receives every vector in this stage. Release older cache
        // entries between stages, after the caller has received every requested vector.
        if (cache.size > maxCachedEmbeddings) {
            const oldest = cache.keys();
            while (cache.size > maxCachedEmbeddings) cache.delete(oldest.next().value);
        }
        return result;
    };
}

export function copyEmbedding(vector) {
    // Buffer.slice() aliases its source. TypedArray.prototype.slice copies every numeric subtype.
    return Array.isArray(vector) ? vector.slice() : Uint8Array.prototype.slice.call(vector);
}

function validateEmbeddings(vectors, expectedCount, dimension) {
    if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
        const received = Array.isArray(vectors) ? vectors.length : 'a non-array result';
        throw new TypeError(`embedBatchCallback must return one vector per text. Expected ${expectedCount}, received ${received}.`);
    }

    const expectedDimension = dimension ?? vectors[0]?.length;
    for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        if (!(Array.isArray(vector) || ArrayBuffer.isView(vector)) || !vector.length) {
            throw new TypeError(`Embedding ${i} must be a nonempty numeric array or typed array.`);
        }
        if (vector.length !== expectedDimension) {
            throw new RangeError(`Embedding ${i} has dimension ${vector.length}. Expected ${expectedDimension}.`);
        }
        for (let j = 0; j < vector.length; j++) {
            if (!Number.isFinite(vector[j])) {
                throw new TypeError(`Embedding ${i} must contain finite numbers. Invalid value at index ${j}.`);
            }
        }
    }
    return expectedDimension;
}
