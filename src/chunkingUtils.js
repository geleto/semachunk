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
// -- Optimize and Rebalance Chunks (optionally use Similarity) --
// --------------------------------------------------------------
export async function optimizeAndRebalanceChunks(combinedChunks, embedBatchCallback, tokenizer, maxTokenSize, combineChunksSimilarityThreshold = 0.5) {
    // Initialize chunks with versioning
    // version 0 means "initial state"
    let currentChunks = combinedChunks.map(text => ({
        text,
        embedding: null,
        version: 0
    }));

    let mergesHappened = false;
    let pass = 1;

    do {
        mergesHappened = false;

        // 1. Batch Embed (Only for chunks missing embeddings)
        const chunksToEmbed = currentChunks.filter(c => c.embedding === null);
        if (chunksToEmbed.length > 0) {
            const newEmbeddings = await embedBatchCallback(chunksToEmbed.map(c => c.text));
            // Assign back to objects
            chunksToEmbed.forEach((chunk, index) => {
                chunk.embedding = newEmbeddings[index];
            });
        }

        const newChunks = [];
        let i = 0;

        while (i < currentChunks.length) {
            let currentGroup = { ...currentChunks[i] }; // Shallow copy to start a potential new group
            // If we start merging, this group becomes "new" (version = pass)
            // But initially, it keeps its old version.

            let currentGroupSize = tokenizer(currentGroup.text).input_ids.size;

            // We need to track the embedding of the *last added chunk* for the chain similarity check.
            // Initially, it's the embedding of the current chunk itself.
            let lastAddedEmbedding = currentGroup.embedding;

            let j = i + 1;

            // Try to merge subsequent chunks
            while (j < currentChunks.length) {
                const nextChunk = currentChunks[j];
                const nextChunkSize = tokenizer(nextChunk.text).input_ids.size;

                // Check size limit
                if (currentGroupSize + nextChunkSize > maxTokenSize) {
                    break;
                }

                // OPTIMIZATION: Skip check if both are "old" and failed to merge previously
                // If currentGroup hasn't been modified in this pass (it's just chunks[i]),
                // AND chunks[i] is old (version < pass - 1)
                // AND nextChunk is old (version < pass - 1)
                // THEN they must have been compared in the previous pass and failed.
                const currentIsOld = currentGroup.version < pass - 1;
                const nextIsOld = nextChunk.version < pass - 1;

                // Only skip if we haven't started merging yet.
                // If we already merged i and i+1, currentGroup.version would be updated to `pass`.
                // So checking `currentGroup.version` is sufficient.

                if (currentIsOld && nextIsOld) {
                    // They failed to merge last time. Skip.
                    break;
                }

                // Check similarity
                // Compare last added embedding with candidate
                const similarity = cosineSimilarity(lastAddedEmbedding, nextChunk.embedding);

                if (similarity >= combineChunksSimilarityThreshold) {
                    // Merge!
                    currentGroup.text += " " + nextChunk.text;
                    currentGroupSize += nextChunkSize;

                    // Update state for next iteration of inner loop
                    lastAddedEmbedding = nextChunk.embedding;
                    currentGroup.version = pass; // Mark as modified in this pass
                    currentGroup.embedding = null; // Invalidate embedding (will be re-calced next pass)

                    mergesHappened = true;
                    j++;
                } else {
                    break;
                }
            }

            newChunks.push(currentGroup);
            i = j;
        }

        currentChunks = newChunks;
        pass++;

    } while (mergesHappened);

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
