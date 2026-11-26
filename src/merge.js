import { directionCosine, documentMergeThreshold, SimilarityStatistics, vectorDirection } from './similarity.js';
import { createJoinCheck } from './token-limit.js';

export function mergeLimit(candidateCount, { maxMergesPerPass, candidateMergesPercentageCap, uncappedCandidateMerges }) {
    const percent = Math.floor(candidateCount * candidateMergesPercentageCap / 100 + 1e-9);
    return Math.min(maxMergesPerPass, Math.max(uncappedCandidateMerges, percent));
}

export async function mergeChunks(texts, embedBatch, options) {
    const { maxPasses = Infinity, maxUncappedPasses } = options;
    let cutoff = options.combineChunksSimilarityThreshold;
    if (maxPasses < 1 || maxUncappedPasses < 1 || (!options.calibrate && cutoff > 1) || mergeLimit(texts.length - 1, options) <= 0) {
        return texts;
    }

    // 1. Link chunks in document order. Each node represents the boundary with its next neighbor.
    let changed = texts.map(text => ({ text, prev: null, next: null, embedding: null, candidate: null, scoredPass: 0 }));
    const head = changed[0];
    for (let i = 1; i < changed.length; i++) {
        changed[i - 1].next = changed[i];
        changed[i].prev = changed[i - 1];
    }

    const queue = new CandidateQueue();
    let pass = 0;
    let remainingPasses = maxUncappedPasses;
    while (pass < maxPasses && remainingPasses >= 1) {
        // 2. Batch-embed missing texts and score adjacent pairs that fit. On later passes,
        //    only boundaries touching a merged chunk need a new score.
        cutoff = await scoreChangedChunks(changed, ++pass, queue, embedBatch, options, cutoff);
        if (options.logging && pass === 1) console.log('Priority merge cosine cutoff', cutoff);

        // 3. Set this pass's cap from the number of live candidates. Take the highest
        //    cosine first, with earlier candidates winning ties just as in a stable sort.
        changed = queue.takeDisjoint(options);
        if (!changed.length) break;

        // 4. The selected left nodes survive the join and form the next scoring batch.
        for (const left of changed) {
            const right = left.next;
            left.text += ' ' + right.text;
            left.embedding = null;
            left.next = right.next;
            if (left.next) left.next.prev = left;
            // A stale heap entry can still reference the retired node.
            right.embedding = right.prev = right.next = null;
        }

        // 5. Charge the pass budget once all available disjoint pairs have been processed.
        //    A surviving candidate means the cap deferred a merge.
        if (!queue.size) remainingPasses--;
    }

    // 6. Read out the surviving chunks in source order. chunkText handles final embeddings.
    const chunks = [];
    for (let node = head; node; node = node.next) chunks.push(node.text);
    return chunks;
}

async function scoreChangedChunks(changed, pass, queue, embedBatch, options, cutoff) {
    const { maxChunkSize, tokenLimit, finalEmbeddingText } = options;
    const canJoin = createJoinCheck(maxChunkSize, tokenLimit);
    const pending = [], finalTexts = [];
    for (const chunk of changed) {
        if (fitsNext(chunk) || fitsNext(chunk.prev)) pending.push(chunk);
        else if (finalEmbeddingText) {
            const pieces = tokenLimit?.oversized.get(chunk.text);
            if (pieces) {
                for (const part of pieces) if (tokenLimit.fits(part)) finalTexts.push(finalEmbeddingText(part));
            } else if (!tokenLimit || !(fitsLength(chunk) || fitsLength(chunk.prev))) {
                // Character length only grows; a tokenizer can change its count at a join.
                finalTexts.push(finalEmbeddingText(chunk.text));
            }
        }
    }
    if (!pending.length) return cutoff;
    let needed = pending;
    if (tokenLimit && pass > 1) {
        // A changed neighbor can make a previously token-ineligible edge fit.
        const endpoints = new Set(pending);
        for (const chunk of pending) {
            if (fitsNext(chunk) && !chunk.next.embedding) endpoints.add(chunk.next);
            if (fitsNext(chunk.prev) && !chunk.prev.embedding) endpoints.add(chunk.prev);
        }
        needed = [...endpoints];
    }
    const vectors = await embedBatch(needed.map(chunk => chunk.text), finalTexts);
    needed.forEach((chunk, i) => { chunk.embedding = vectorDirection(vectors[i]); });

    // Calibrate once, on the original eligible sentence boundaries and the same
    // embedding batch. Keep their scores so each cosine is computed only once.
    const initial = options.calibrate && pass === 1 ? new Map() : null;
    const stats = initial ? new SimilarityStatistics() : null;
    for (const chunk of pending) {
        scoreBoundary(chunk);
        scoreBoundary(chunk.prev);
    }
    if (initial) {
        cutoff = documentMergeThreshold(stats, cutoff);
        for (const [left, score] of initial) if (score >= cutoff) queue.add(left, score);
    }
    return cutoff;

    function fitsLength(left) {
        return left?.next && left.text.length + 1 + left.next.text.length <= maxChunkSize;
    }

    function fitsNext(left) {
        return left?.next && canJoin(left.text, left.next.text);
    }

    function scoreBoundary(left) {
        if (!left || left.scoredPass === pass) return;
        left.scoredPass = pass; // Neighboring merges share a boundary.
        if (!fitsNext(left)) return;
        const score = directionCosine(left.embedding, left.next.embedding);
        if (initial) {
            initial.set(left, score);
            stats.add(score);
        } else if (score >= cutoff) queue.add(left, score);
    }
}

// Each live boundary belongs to its left node. Invalidation drops it from the
// live count immediately. Its heap entry can be discarded when it reaches the top.
class CandidateQueue {
    heap = [];
    size = 0;
    nextOrder = 0;

    add(left, score) {
        const entry = { left, score, order: this.nextOrder++ };
        left.candidate = entry;
        this.size++;

        let index = this.heap.length;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!takesPriority(entry, this.heap[parent])) break;
            this.heap[index] = this.heap[parent];
            index = parent;
        }
        this.heap[index] = entry;
    }

    invalidate(left) {
        if (left?.candidate) {
            left.candidate = null;
            this.size--;
        }
    }

    takeDisjoint(options) {
        const limit = mergeLimit(this.size, options);
        const selected = [];
        while (this.size && selected.length < limit) {
            const left = this.takeBest();
            // These two boundaries share an endpoint with the selected pair.
            this.invalidate(left.prev);
            this.invalidate(left.next);
            selected.push(left);
        }
        return selected;
    }

    takeBest() {
        while (this.size > 0) {
            const entry = this.heap[0];
            const tail = this.heap.pop();
            if (this.heap.length) this.restoreHeap(tail);
            if (entry.left.candidate === entry) {
                this.invalidate(entry.left);
                return entry.left;
            }
        }
    }

    restoreHeap(tail) {
        let index = 0;
        let child = 1;
        while (child < this.heap.length) {
            const right = child + 1;
            if (right < this.heap.length && takesPriority(this.heap[right], this.heap[child])) child = right;
            if (!takesPriority(this.heap[child], tail)) break;
            this.heap[index] = this.heap[child];
            index = child;
            child = 2 * index + 1;
        }
        this.heap[index] = tail;
    }
}

function takesPriority(a, b) {
    return a.score > b.score || (a.score === b.score && a.order < b.order);
}
