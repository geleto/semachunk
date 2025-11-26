import { cosineSimilarity } from './similarity.js';

// --------------------------------------------------------------
// -- Optimize and Rebalance Chunks (Global Priority Merge) --
// --------------------------------------------------------------
export async function mergeChunks(
    sentences,
    embedBatchCallback,
    maxChunkSize,
    combineChunksSimilarityThreshold = 0.5,
    maxUncappedPasses = 5,
    maxMergesPerPass = 50,
    maxMergesPerPassPercentage = 0.4,
    initialEmbeddings = null // Optional: Pre-calculated embeddings for the input chunks
) {
    // 1. Initialize chunks
    let currentChunks = sentences.map((text, index) => ({
        text,
        embedding: initialEmbeddings ? initialEmbeddings[index] : null
    }));


    // Construct the linked list of chunks
    for (let i = 0; i < currentChunks.length; i++) {
        const chunkA = currentChunks[i];
        const chunkB = (i < currentChunks.length - 1 ? currentChunks[i + 1] : null);
        if (chunkB) {
            chunkB.prev = chunkA;
            chunkA.next = chunkB;
        }
        chunkA.index = i;
    }

    // If we have initial embeddings, we need to generate the initial candidates now
    let chunksToEmbed = [];
    let candidates = [];
    if (initialEmbeddings) {
        // Use the embeddings provided
        for (chunk of currentChunks) {
            const candidate = _getMergeCandidate(chunk, chunk.next, chunk.index, maxChunkSize, combineChunksSimilarityThreshold);
            if (candidate) {
                candidates.push(candidate);
            }
            // Mark as processed for this pass (pass 1 hasn't started yet, but we can init)
            chunk.candidatePass = 0;
        }
    } else {
        chunksToEmbed = currentChunks;//all need to be embedded
    }

    let pass = 1;
    let numCappedPasses = 0;

    // Loop until we exceed the allowed number of UNCAPPED passes
    while ((pass - numCappedPasses) <= maxUncappedPasses) {
        // 2. Batch Embed (Only for chunks missing embeddings)
        // const chunksToEmbed = currentChunks.filter(c => c.embedding === null); // REMOVED optimization
        if (chunksToEmbed.length > 0) {
            // Update chunk embeddings
            const newEmbeddings = await embedBatchCallback(chunksToEmbed.map(c => c.text));
            chunksToEmbed.forEach((chunk, index) => {
                chunk.embedding = newEmbeddings[index];
            });

            // Add candidates for the newly embedded chunks if they meet criteria
            chunksToEmbed.forEach((chunk) => {
                if (chunk.next && chunk.candidatePass !== pass) {
                    // Recalculate the chunk's similarity with the next chunk
                    const candidate = _getMergeCandidate(chunk, chunk.next, chunk.index, maxChunkSize, combineChunksSimilarityThreshold);
                    if (candidate) {
                        // Add to candidates if it meets criteria
                        candidates.push(candidate);
                    }
                    chunk.candidatePass = pass;//make sure it is not added twice
                }
                if (chunk.prev && chunk.prev.candidatePass !== pass) {
                    // Recalculate the chunk's similarity with the previous chunk
                    const candidate = _getMergeCandidate(chunk.prev, chunk, chunk.prev.index, maxChunkSize, combineChunksSimilarityThreshold);
                    if (candidate) {
                        // Add to candidates if it meets criteria
                        candidates.push(candidate);
                    }
                    chunk.prev.candidatePass = pass;//make sure it is not added twice
                }
            });
            // Clear the list after embedding
            chunksToEmbed = [];
        }

        // If no candidates, we are done
        if (candidates.length === 0) break;

        // 4. Sort by similarity (descending) - Global Priority
        candidates.sort((a, b) => b.similarity - a.similarity);

        // 5. Calculate Throttle Limit
        // Limit based on percentage of VALID candidates
        const percentageLimit = Math.max(1, Math.floor(candidates.length * maxMergesPerPassPercentage));
        // Absolute limit
        const absoluteLimit = maxMergesPerPass;
        // Effective limit is the minimum of both
        const effectiveMergeLimit = Math.min(percentageLimit, absoluteLimit);

        let mergeCount = 0;

        // Sorted, The most high-similarity candidates are processed first
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];

            // If any of the chunks has already been merged in this pass, skip it
            if (candidate.chunkA.mergePass === pass || candidate.chunkB.mergePass === pass) {
                continue;
            }

            // Merge chunks
            const divider = candidate.chunkA.text.charAt(candidate.chunkA.text.length - 1) === ' ' ? '' : ' ';
            candidate.chunkA.text = candidate.chunkA.text + divider + candidate.chunkB.text;
            candidate.chunkA.embedding = null; // no longer valid

            // Mark chunks as merged
            candidate.chunkA.mergePass = pass;
            candidate.chunkB.mergePass = pass;

            // Remove the second merged chunk from the linked list
            if (candidate.chunkB.next) {
                candidate.chunkB.next.prev = candidate.chunkA;
            }
            candidate.chunkA.next = candidate.chunkB.next;

            // Add to bulk re-embed list
            chunksToEmbed.push(candidate.chunkA);

            // Clear the second merged chunk (just in case)
            candidate.chunkB.text = null;
            candidate.chunkB.embedding = null; // will be removed from candidates if there


            // Stop if we hit the merge limit
            mergeCount++;
            if (mergeCount >= effectiveMergeLimit) {
                // Capped passes are ignored in the max passes counting
                // as with big documents we can have the max batch of merges for a long time before we are under the limit
                // This allows the algorithm to scale to documents of any size without premature termination.
                numCappedPasses++;
                break;
            }
        }

        // If no merges were executed, break
        if (mergeCount === 0) break;

        // Clean up candidates of chunks with unknown embeddings
        candidates = candidates.filter(c => c.chunkA.embedding !== null && c.chunkB.embedding !== null);

        pass++;
    }

    // Reconstruct the final chunks from the linked list
    // Find the first active chunk in the currentChunks array
    let chunk = currentChunks[0];// The very first element will never become null (A always stays)
    currentChunks = [];
    while (chunk) {
        currentChunks.push(chunk);
        chunk = chunk.next;
    }

    // Return just the text strings
    return currentChunks.map(c => c.text);
}

// --------------------------------------------------------------
// -- Get Merge Candidate if requirements are met (Helper Function) --
// --------------------------------------------------------------
function _getMergeCandidate(chunkA, chunkB, index, maxChunkSize, combineChunksSimilarityThreshold) {
    // Skip if combined size exceeds limit
    // account for the added space between the merged sentences
    const aLength = chunkA.text.charAt(chunkA.text.length - 1) === ' ' ? chunkA.text.length : chunkA.text.length + 1;
    if (aLength + chunkB.text.length > maxChunkSize) return null;

    const similarity = cosineSimilarity(chunkA.embedding, chunkB.embedding);

    if (similarity < combineChunksSimilarityThreshold) return null;

    // Return merge candidate
    return {
        index: index,
        similarity: similarity,
        chunkA: chunkA,
        chunkB: chunkB
    };
}