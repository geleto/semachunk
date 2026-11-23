import { createJoinCheck } from './token-limit.js';

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

// Keep scores at their original boundary indices. A pair that cannot fit
// provides no evidence for the cutoff, even when both endpoints have vectors.
export async function computeAdvancedSimilarities(sentences, embedBatch, { maxChunkSize = Infinity, canJoin = createJoinCheck(maxChunkSize), logging = false } = {}) {
    const boundaries = [];
    const endpoints = [];
    for (let i = 0; i + 1 < sentences.length; i++) {
        const left = sentences[i], right = sentences[i + 1];
        if (!canJoin(left, right)) continue;
        boundaries.push(i);
        if (endpoints.at(-1) !== i) endpoints.push(i);
        endpoints.push(i + 1);
    }
    let embeddings = [];
    const similarities = [];
    if (endpoints.length === sentences.length || sentences.length === 1) {
        embeddings = await embedBatch(sentences);
    } else if (endpoints.length) {
        const vectors = await embedBatch(endpoints.map(i => sentences[i]));
        endpoints.forEach((index, j) => { embeddings[index] = vectors[j]; });
    }
    const stats = new SimilarityStatistics();
    const directions = embeddings.map(vectorDirection);
    for (let j = 0; j < boundaries.length; j++) {
        const i = boundaries[j];
        const score = directionCosine(directions[i], directions[i + 1]);
        similarities[i] = score;
        if (logging) console.log(`Similarity between sentences ${i + 1} and ${i + 2}`, score);
        stats.add(score);
    }
    return { similarities, embeddings, directions, average: stats.average, variance: stats.variance, boundaryCount: stats.boundaryCount };
}

export function adjustThreshold(average, variance, baseThreshold = 0.5, lowerBound = 0.2, upperBound = 0.8, boundaryCount = 2) {
    let change = 0;
    // A lone boundary gives no estimate of the document's score spread.
    if (boundaryCount >= 2) {
        if (variance < 0.01) change -= 10;
        else if (variance > 0.05) change += 10;
        if (average < 0.3) change += 5;
        else if (average > 0.7) change -= 5;
    }
    const adjusted = change ? (baseThreshold * 100 + change) / 100 : baseThreshold;
    return Math.min(Math.max(adjusted, lowerBound), upperBound);
}

function addUnitVector(sum, { vector, scale, length }) {
    for (let i = 0; i < vector.length; i++) sum[i] += (vector[i] / scale) / length;
}

export async function groupAdjacentSentences(sentences, embedBatch, options, analysis) {
    const { maxChunkSize, canJoin = createJoinCheck(maxChunkSize), similarityThreshold, dynamicThresholdLowerBound, dynamicThresholdUpperBound, logging } = options;
    if (sentences.length < 2) return sentences;
    const { similarities, embeddings, directions = embeddings.map(vectorDirection), average, variance, boundaryCount } =
        analysis ?? await computeAdvancedSimilarities(sentences, embedBatch, options);
    if (!boundaryCount) return sentences;
    const threshold = adjustThreshold(average, variance, similarityThreshold, dynamicThresholdLowerBound, dynamicThresholdUpperBound, boundaryCount);
    if (logging) console.log('Initial grouping threshold', threshold);

    const groups = [];
    let current = sentences[0];
    let groupStart = 0;
    let directionSum = null;
    for (let i = 1; i < sentences.length; i++) {
        const sentence = sentences[i];
        let joins = similarities[i - 1] >= threshold && canJoin(current, sentence);
        // A singleton's centroid test is its boundary test. Start accumulating
        // unit directions only when a third sentence could join this group.
        if (joins && i > groupStart + 1) {
            if (!directionSum) {
                directionSum = new Float64Array(directions[i].vector.length);
                addUnitVector(directionSum, directions[groupStart]);
            }
            addUnitVector(directionSum, directions[i - 1]);
            joins = directionCosine(vectorDirection(directionSum), directions[i]) >= threshold;
        }
        if (joins) {
            current += ' ' + sentence;
        } else {
            groups.push(current);
            current = sentence;
            groupStart = i;
            directionSum = null;
        }
    }
    groups.push(current);
    return groups;
}
