import { cosineSimilarity } from './similarityUtils.js';

// -----------------------------------------------------------
// -- Function to create chunks of text based on similarity --
// -----------------------------------------------------------
export function createChunks(sentences, similarities, maxChunkSize, similarityThreshold, logging) {
    let chunks = [];
    let currentChunk = [sentences[0]];

    if (logging) {
        console.log('Initial sentence:', sentences[0]);
    }

    for (let i = 1; i < sentences.length; i++) {
        const nextSentence = sentences[i];

        // For cramit (when similarities is null), only check chunk size
        if (!similarities) {
            const currentChunkText = currentChunk.join(" ");
            const currentChunkSize = currentChunkText.length;
            const nextSentenceSize = nextSentence.length;

            if (currentChunkSize + nextSentenceSize <= maxChunkSize) {
                currentChunk.push(nextSentence);
            } else {
                chunks.push(currentChunkText);
                currentChunk = [nextSentence];
            }
            continue;
        }

        // Check similarity first for chunkit
        if (similarities[i - 1] >= similarityThreshold) {
            if (logging) {
                console.log(`Adding sentence ${i} with similarity ${similarities[i - 1]}`);
            }

            // Then check chunk size
            const currentChunkText = currentChunk.join(" ");
            const currentChunkSize = currentChunkText.length;
            const nextSentenceSize = nextSentence.length;

            if (currentChunkSize + nextSentenceSize <= maxChunkSize) {
                currentChunk.push(nextSentence);
            } else {
                chunks.push(currentChunkText);
                currentChunk = [nextSentence];
            }
        } else {
            if (logging) {
                console.log(`Starting new chunk at sentence ${i}, similarity was ${similarities[i - 1]}`);
            }
            chunks.push(currentChunk.join(" "));
            currentChunk = [nextSentence];
        }
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(" "));
    }

    return chunks;
}

// --------------------------------------------------------------
// -- Optimize and Rebalance Chunks (Global Priority Merge) --
// --------------------------------------------------------------
export async function optimizeAndRebalanceChunks(
    combinedChunks,
    embedBatchCallback,
    maxChunkSize,
    combineChunksSimilarityThreshold = 0.5,
    maxUncappedPasses = 5,
    maxMergesPerPass = 50,
    maxMergesPerPassPercentage = 0.4
) {
    // 1. Initialize chunks
    let currentChunks = combinedChunks.map(text => ({
        text,
        embedding: null
    }));

    // Initialize chunksToEmbed with all initial chunks since they lack embeddings
    let chunksToEmbed = [...currentChunks];

    let pass = 1;
    let numCappedPasses = 0;

    // Loop until we exceed the allowed number of UNCAPPED passes
    while ((pass - numCappedPasses) <= maxUncappedPasses) {
        // 2. Batch Embed (Only for chunks missing embeddings)
        // const chunksToEmbed = currentChunks.filter(c => c.embedding === null); // REMOVED optimization
        if (chunksToEmbed.length > 0) {
            const newEmbeddings = await embedBatchCallback(chunksToEmbed.map(c => c.text));
            chunksToEmbed.forEach((chunk, index) => {
                chunk.embedding = newEmbeddings[index];
            });
            // Clear the list after embedding
            chunksToEmbed = [];
        }

        // 3. Calculate all pairwise similarities
        const candidates = [];
        for (let i = 0; i < currentChunks.length - 1; i++) {
            const chunkA = currentChunks[i];
            const chunkB = currentChunks[i + 1];

            // Skip if combined size exceeds limit
            if (chunkA.text.length + chunkB.text.length > maxChunkSize) continue;

            const similarity = cosineSimilarity(chunkA.embedding, chunkB.embedding);

            if (similarity < combineChunksSimilarityThreshold) continue;

            // Store candidates that meet the threshold
            candidates.push({
                index: i,
                similarity: similarity,
                chunkA: chunkA,
                chunkB: chunkB
            });
        }

        // If no candidates, we are done
        if (candidates.length === 0) break;

        // 4. Sort by similarity (descending) - Global Priority
        candidates.sort((a, b) => b.similarity - a.similarity);

        // 5. Binary Search for Threshold Cutoff - REMOVED
        // We already filtered by threshold, so all candidates are valid
        // const validCandidateCount = candidates.length; // REMOVED

        // 6. Calculate Throttle Limit
        // Limit based on percentage of VALID candidates
        const percentageLimit = Math.max(1, Math.floor(candidates.length * maxMergesPerPassPercentage));
        // Absolute limit
        const absoluteLimit = maxMergesPerPass;
        // Effective limit is the minimum of both
        const effectiveLimit = Math.min(percentageLimit, absoluteLimit);

        // 7. Select merges (greedy but globally prioritized AND throttled)
        const mergesToExecute = [];


        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];

            // Stop if we hit the throttle limit
            if (mergesToExecute.length >= effectiveLimit) {
                // Capped passes are ignored in the max passes counting
                // as with big documents it can take many passes to go under the merge limit
                numCappedPasses++;
                break;
            }

            // If either chunk is already involved in a merge this pass, skip
            if (candidate.chunkA.mergePass === pass || candidate.chunkB.mergePass === pass) {
                continue;
            }

            mergesToExecute.push(candidate);
            candidate.chunkA.mergePass = pass;
            candidate.chunkB.mergePass = pass;
        }

        // If no valid merges could be executed (e.g. conflicts), break
        if (mergesToExecute.length === 0) break;

        // 8. Execute Merges
        // Create a Map for O(1) lookup of merges by index
        const mergesMap = new Map();
        for (const merge of mergesToExecute) {
            mergesMap.set(merge.index, merge);
        }

        // We rebuild the array. Chunks not in 'mergesToExecute' are kept.
        // Merged chunks are created new.
        const newChunks = [];

        let i = 0;
        while (i < currentChunks.length) {
            // Check if this index is the start of a merge
            const merge = mergesMap.get(i);

            if (merge) {
                // Create merged chunk
                const mergedText = merge.chunkA.text + " " + merge.chunkB.text;
                const mergedChunk = {
                    text: mergedText,
                    embedding: null, // Needs re-embedding
                };
                newChunks.push(mergedChunk);
                chunksToEmbed.push(mergedChunk); // Add to queue for embedding in next pass
                i += 2; // Skip next chunk as it's merged
            } else {
                // Keep existing chunk
                newChunks.push(currentChunks[i]);
                i++;
            }
        }

        currentChunks = newChunks;
        pass++;
    }

    // Return just the text strings
    return currentChunks.map(c => c.text);
}


// ------------------------------------------------
// -- Helper function to apply prefix to a chunk --
// ------------------------------------------------
export function applyPrefixToChunk(chunkPrefix, chunk) {
    if (chunkPrefix && chunkPrefix.trim()) {
        return `${chunkPrefix}: ${chunk}`;
    }
    return chunk;
};
