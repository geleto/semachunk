import { tokenizer } from './embeddingUtils.js';
import { cosineSimilarity } from './similarityUtils.js';
// import { createEmbedding } from './embeddingUtils.js'; // REMOVED

// -----------------------------------------------------------
// -- Function to create chunks of text based on similarity --
// -----------------------------------------------------------
export function createChunks(sentences, similarities, maxTokenSize, similarityThreshold, logging) {
    let chunks = [];
    let currentChunk = [sentences[0]];

    if (logging) {
        console.log('Initial sentence:', sentences[0]);
    }

    for (let i = 1; i < sentences.length; i++) {
        const nextSentence = sentences[i];

        // For cramit (when similarities is null), only check token size
        if (!similarities) {
            const currentChunkText = currentChunk.join(" ");
            const currentChunkSize = tokenizer(currentChunkText).input_ids.size;
            const nextSentenceTokenCount = tokenizer(nextSentence).input_ids.size;

            if (currentChunkSize + nextSentenceTokenCount <= maxTokenSize) {
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

            // Then check token size
            const currentChunkText = currentChunk.join(" ");
            const currentChunkSize = tokenizer(currentChunkText).input_ids.size;
            const nextSentenceTokenCount = tokenizer(nextSentence).input_ids.size;

            if (currentChunkSize + nextSentenceTokenCount <= maxTokenSize) {
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
    tokenizer,
    maxTokenSize,
    combineChunksSimilarityThreshold = 0.5,
    maxPasses = 5,
    maxMergesPerPass = 50,
    maxMergesPerPassPercentage = 0.4
) {
    // 1. Initialize chunks
    let currentChunks = combinedChunks.map(text => ({
        text,
        embedding: null,
        tokenCount: tokenizer(text).input_ids.size
    }));

    let pass = 1;

    while (pass <= maxPasses) {
        // 2. Batch Embed (Only for chunks missing embeddings)
        const chunksToEmbed = currentChunks.filter(c => c.embedding === null);
        if (chunksToEmbed.length > 0) {
            const newEmbeddings = await embedBatchCallback(chunksToEmbed.map(c => c.text));
            chunksToEmbed.forEach((chunk, index) => {
                chunk.embedding = newEmbeddings[index];
            });
        }

        // 3. Calculate all pairwise similarities
        const candidates = [];
        for (let i = 0; i < currentChunks.length - 1; i++) {
            const chunkA = currentChunks[i];
            const chunkB = currentChunks[i + 1];

            // Skip if combined size exceeds limit
            if (chunkA.tokenCount + chunkB.tokenCount > maxTokenSize) continue;

            const similarity = cosineSimilarity(chunkA.embedding, chunkB.embedding);

            if (similarity >= combineChunksSimilarityThreshold) {
                candidates.push({
                    index: i,
                    similarity: similarity,
                    chunkA: chunkA,
                    chunkB: chunkB
                });
            }
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
        // Effective limit is the minimum of both (but at least 1 if there are candidates)
        const effectiveLimit = Math.min(percentageLimit, absoluteLimit);

        // 6. Select merges (greedy but globally prioritized AND throttled)
        const mergedIndices = new Set();
        const mergesToExecute = [];

        for (const candidate of candidates) {
            // Stop if we hit the throttle limit
            if (mergesToExecute.length >= effectiveLimit) break;

            // If either chunk is already involved in a merge this pass, skip
            if (mergedIndices.has(candidate.index) || mergedIndices.has(candidate.index + 1)) {
                continue;
            }

            mergesToExecute.push(candidate);
            mergedIndices.add(candidate.index);
            mergedIndices.add(candidate.index + 1);
        }

        // If no valid merges could be executed (e.g. conflicts), break
        if (mergesToExecute.length === 0) break;

        // 7. Execute Merges
        // We rebuild the array. Chunks not in 'mergesToExecute' are kept.
        // Merged chunks are created new.
        const newChunks = [];

        let i = 0;
        while (i < currentChunks.length) {
            // Check if this index is the start of a merge
            const merge = mergesToExecute.find(m => m.index === i);

            if (merge) {
                // Create merged chunk
                const mergedText = merge.chunkA.text + " " + merge.chunkB.text;
                const mergedChunk = {
                    text: mergedText,
                    tokenCount: merge.chunkA.tokenCount + merge.chunkB.tokenCount, // Approx sum
                    embedding: null, // Needs re-embedding
                };
                newChunks.push(mergedChunk);
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
