// Cache the length on each live scoring node and preserve the provider's vector.
export function vectorDirection(vector) {
    let squared = 0;
    for (let i = 0; i < vector.length; i++) squared += vector[i] * vector[i];
    if (squared > 0 && Number.isFinite(squared) && Number.isFinite(1 / squared)) {
        return { vector, scale: Math.sqrt(squared), length: 1 };
    }
    // Extreme inputs can overflow or underflow when squared. Keep their
    // largest component separate so even their normalized length is representable.
    let scale = 0;
    for (let i = 0; i < vector.length; i++) scale = Math.max(scale, Math.abs(vector[i]));
    if (!scale) return { vector, scale: 1, length: 1 };
    squared = 0;
    for (let i = 0; i < vector.length; i++) squared += (vector[i] / scale) ** 2;
    return { vector, scale, length: Math.sqrt(squared) };
}

export function directionCosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.vector.length; i++) {
        dot += (a.vector[i] / a.scale) * (b.vector[i] / b.scale);
    }
    const cosine = dot / (a.length * b.length);
    // Preserve inclusive cutoffs for parallel directions despite rounding at the endpoints.
    if (cosine >= 1 - 2 * Number.EPSILON) return 1;
    if (cosine <= -1 + 2 * Number.EPSILON) return -1;
    return cosine;
}

export function cosineSimilarity(vecA, vecB) {
    return directionCosine(vectorDirection(vecA), vectorDirection(vecB));
}

// Online mean and population variance over size-eligible boundaries.
export class SimilarityStatistics {
    boundaryCount = 0;
    average = 0;
    squaredDeviations = 0;

    add(score) {
        const delta = score - this.average;
        this.boundaryCount++;
        this.average += delta / this.boundaryCount;
        this.squaredDeviations += delta * (score - this.average);
    }

    get variance() {
        return this.boundaryCount ? this.squaredDeviations / this.boundaryCount : 0;
    }
}

export function documentMergeThreshold({ boundaryCount, average, variance }, fallback) {
    return boundaryCount >= 2 ? average - 0.5 * Math.sqrt(variance) : fallback;
}
