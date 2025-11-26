import { parseSentences } from 'sentence-parse';
import { DEFAULT_CONFIG } from '../config.js';

import { computeAdvancedSimilarities, adjustThreshold } from './similarity.js';
import { mergeChunks, applyPrefixToChunk } from './merge.js';

export async function printVersion() {
    // Stub
}

// ---------------------------
// -- Main chunkit function --
// ---------------------------
export async function chunkit(
    text,
    embedBatchCallback,
    {
        logging = DEFAULT_CONFIG.LOGGING,
        maxChunkSize = DEFAULT_CONFIG.MAX_CHUNK_SIZE,
        similarityThreshold = DEFAULT_CONFIG.SIMILARITY_THRESHOLD,
        dynamicThresholdLowerBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_LOWER_BOUND,
        dynamicThresholdUpperBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_UPPER_BOUND,
        numSimilaritySentencesLookahead = DEFAULT_CONFIG.NUM_SIMILARITY_SENTENCES_LOOKAHEAD,
        combineChunks = DEFAULT_CONFIG.COMBINE_CHUNKS,
        combineChunksSimilarityThreshold = DEFAULT_CONFIG.COMBINE_CHUNKS_SIMILARITY_THRESHOLD,
        maxUncappedPasses = DEFAULT_CONFIG.MAX_UNCAPPED_PASSES,
        returnEmbedding = DEFAULT_CONFIG.RETURN_EMBEDDING,
        chunkPrefix = DEFAULT_CONFIG.CHUNK_PREFIX,
        excludeChunkPrefixInResults = false,
        maxMergesPerPass = DEFAULT_CONFIG.MAX_MERGES_PER_PASS,
        maxMergesPerPassPercentage = DEFAULT_CONFIG.MAX_MERGES_PER_PASS_PERCENTAGE
    } = {}) {

    if (logging) { printVersion(); }

    // Input validation
    if (!text || typeof text !== 'string') {
        throw new Error('Input must be a string');
    }

    // Normalize document text
    let normalizedText = text.replace(/([^\n])\n([^\n])/g, '$1 $2');
    normalizedText = normalizedText.replace(/\s{2,}/g, ' ');
    text = normalizedText;

    // Split the text into sentences
    const sentences = await parseSentences(text);

    // Compute variance and initial embeddings
    const { average, variance, embeddings } = await computeAdvancedSimilarities(
        sentences,
        embedBatchCallback,
        {
            numSimilaritySentencesLookahead,
            logging,
        }
    );

    // Dynamically adjust the similarity threshold
    let dynamicThreshold = similarityThreshold;
    if (average != null && variance != null) {
        dynamicThreshold = adjustThreshold(average, variance, similarityThreshold, dynamicThresholdLowerBound, dynamicThresholdUpperBound);
    }

    // Create the initial chunks (just the sentences)

    if (logging) {
        console.log('\n=============\ninitialChunks (Sentences)\n=============');
        initialChunks.forEach((chunk, index) => {
            console.log(`-- Chunk ${(index + 1)} --`);
            console.log(chunk.substring(0, 50) + '...');
        });
    }

    let mergedChunks;

    // Combine similar chunks
    if (combineChunks) {
        mergedChunks = await mergeChunks(
            sentences,
            embedBatchCallback,
            maxChunkSize,
            combineChunksSimilarityThreshold,
            maxUncappedPasses,
            maxMergesPerPass,
            maxMergesPerPassPercentage,
            embeddings // Pass the pre-calculated embeddings
        );
        if (logging) {
            console.log('\n\n=============\ncombinedChunks\n=============');
            mergedChunks.forEach((chunk, index) => {
                console.log(`Chunk ${index + 1}`);
                console.log(chunk.substring(0, 50) + '...');
            });
        }
    } else {
        mergedChunks = sentences.map((text, index) => {
            return {
                text,
                embedding: embeddings[index]
            };
        });
    }

    const prefixPattern = (excludeChunkPrefixInResults && chunkPrefix && chunkPrefix.trim()) ? new RegExp(`^${chunkPrefix}:\\s*`) : null;
    return mergedChunks.map((chunk) => {
        const result = {
            text: chunk.text,
        };
        if (returnEmbedding) {
            result.embedding = chunk.embedding;
        }

        if (prefixPattern) {
            result.text = result.text.replace(prefixPattern, '');
        } else if (chunkPrefix) {
            result.text = chunkPrefix + ': ' + result.text;
        }

        return result;
    });
}
