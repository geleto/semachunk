import { parseSentences } from 'sentence-parse';
import { DEFAULT_CONFIG } from './config.js';
import { tokenizer } from './embeddingUtils.js';
import { computeAdvancedSimilarities, adjustThreshold } from './similarityUtils.js';
import { createChunks, optimizeAndRebalanceChunks, applyPrefixToChunk } from './chunkingUtils.js';

export async function printVersion() {
    // Stub
}

// ---------------------------
// -- Main chunkit function --
// ---------------------------
export async function chunkit(
    documents,
    embedBatchCallback,
    {
        logging = DEFAULT_CONFIG.LOGGING,
        maxTokenSize = DEFAULT_CONFIG.MAX_TOKEN_SIZE,
        similarityThreshold = DEFAULT_CONFIG.SIMILARITY_THRESHOLD,
        dynamicThresholdLowerBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_LOWER_BOUND,
        dynamicThresholdUpperBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_UPPER_BOUND,
        numSimilaritySentencesLookahead = DEFAULT_CONFIG.NUM_SIMILARITY_SENTENCES_LOOKAHEAD,
        combineChunks = DEFAULT_CONFIG.COMBINE_CHUNKS,
        combineChunksSimilarityThreshold = DEFAULT_CONFIG.COMBINE_CHUNKS_SIMILARITY_THRESHOLD,
        maxUncappedPasses = DEFAULT_CONFIG.MAX_UNCAPPED_PASSES,
        returnEmbedding = DEFAULT_CONFIG.RETURN_EMBEDDING,
        returnTokenLength = DEFAULT_CONFIG.RETURN_TOKEN_LENGTH,
        chunkPrefix = DEFAULT_CONFIG.CHUNK_PREFIX,
        excludeChunkPrefixInResults = false,
        maxMergesPerPass = DEFAULT_CONFIG.MAX_MERGES_PER_PASS,
        maxMergesPerPassPercentage = DEFAULT_CONFIG.MAX_MERGES_PER_PASS_PERCENTAGE
    } = {}) {

    if (logging) { printVersion(); }

    // Input validation
    if (!Array.isArray(documents)) {
        throw new Error('Input must be an array of document objects');
    }

    const modelName = "custom-model";
    const usedDtype = "float32";

    // Process each document
    const allResults = await Promise.all(documents.map(async (doc) => {
        if (!doc.document_text) {
            throw new Error('Each document must have a document_text property');
        }

        // Normalize document text
        let normalizedText = doc.document_text.replace(/([^\n])\n([^\n])/g, '$1 $2');
        normalizedText = normalizedText.replace(/\s{2,}/g, ' ');
        doc.document_text = normalizedText;

        // Split the text into sentences
        const sentences = await parseSentences(doc.document_text);

        // Compute similarities and create chunks
        const { similarities, average, variance } = await computeAdvancedSimilarities(
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

        // Create the initial chunks
        const initialChunks = createChunks(sentences, similarities, maxTokenSize, dynamicThreshold, logging);

        if (logging) {
            console.log('\n=============\ninitialChunks\n=============');
            initialChunks.forEach((chunk, index) => {
                console.log(`-- Chunk ${(index + 1)} --`);
                console.log(chunk.substring(0, 50) + '...');
            });
        }

        let finalChunks;

        // Combine similar chunks
        if (combineChunks) {
            finalChunks = await optimizeAndRebalanceChunks(
                initialChunks,
                embedBatchCallback,
                tokenizer,
                maxTokenSize,
                combineChunksSimilarityThreshold,
                maxUncappedPasses,
                maxMergesPerPass,
                maxMergesPerPassPercentage
            );
            if (logging) {
                console.log('\n\n=============\ncombinedChunks\n=============');
                finalChunks.forEach((chunk, index) => {
                    console.log(`Chunk ${index + 1}`);
                    console.log(chunk.substring(0, 50) + '...');
                });
            }
        } else {
            finalChunks = initialChunks;
        }

        const documentName = doc.document_name || "";
        const documentId = Date.now();
        const numberOfChunks = finalChunks.length;

        // Batch embed final chunks if requested
        let finalEmbeddings = [];
        if (returnEmbedding) {
            const chunksToEmbed = finalChunks.map(chunk => applyPrefixToChunk(chunkPrefix, chunk));
            finalEmbeddings = await embedBatchCallback(chunksToEmbed);
        }

        return Promise.all(finalChunks.map(async (chunk, index) => {
            const prefixedChunk = applyPrefixToChunk(chunkPrefix, chunk);
            const result = {
                document_id: documentId,
                document_name: documentName,
                number_of_chunks: numberOfChunks,
                chunk_number: index + 1,
                model_name: modelName,
                dtype: usedDtype,
                text: prefixedChunk
            };

            if (returnEmbedding) {
                result.embedding = finalEmbeddings[index];
            }

            if (returnTokenLength) {
                try {
                    const encoded = tokenizer(prefixedChunk);
                    result.token_length = encoded.input_ids.size;
                } catch (error) {
                    result.token_length = 0;
                }
            }

            if (excludeChunkPrefixInResults && chunkPrefix && chunkPrefix.trim()) {
                const prefixPattern = new RegExp(`^${chunkPrefix}:\\s*`);
                result.text = result.text.replace(prefixPattern, '');
            }

            return result;
        }));
    }));

    return allResults.flat();
}
