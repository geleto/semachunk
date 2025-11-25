import { chunkit } from './chunkit.js';
import { DEFAULT_CONFIG } from '../config.js';

/**
 * Chunk text semantically using batch embeddings
 * @param {string} text - Input text to chunk
 * @param {Function} embedBatchCallback - async (texts[]) => embeddings[][]
 * @param {Object} options - Chunking options
 * @returns {Array} chunks - [{ text, embedding }, ...]
 */
export async function chunkText(text, embedBatchCallback, options = {}) {
	const defaultOptions = {
		similarityThreshold: DEFAULT_CONFIG.SIMILARITY_THRESHOLD,
		maxChunkSize: DEFAULT_CONFIG.MAX_CHUNK_SIZE,
		dynamicThresholdLowerBound: DEFAULT_CONFIG.DYNAMIC_THRESHOLD_LOWER_BOUND,
		dynamicThresholdUpperBound: DEFAULT_CONFIG.DYNAMIC_THRESHOLD_UPPER_BOUND,
		combineChunks: DEFAULT_CONFIG.COMBINE_CHUNKS,
		combineChunksSimilarityThreshold: DEFAULT_CONFIG.COMBINE_CHUNKS_SIMILARITY_THRESHOLD,
		maxUncappedPasses: DEFAULT_CONFIG.MAX_UNCAPPED_PASSES,
		maxMergesPerPass: DEFAULT_CONFIG.MAX_MERGES_PER_PASS,
		maxMergesPerPassPercentage: DEFAULT_CONFIG.MAX_MERGES_PER_PASS_PERCENTAGE,
		returnEmbedding: DEFAULT_CONFIG.RETURN_EMBEDDING
	};

	const mergedOptions = { ...defaultOptions, ...options };

	// Wrap text in document object
	const documents = [{ document_text: text }];

	// Call the refactored core function
	const chunks = await chunkit(documents, embedBatchCallback, mergedOptions);

	// Return simplified format: [{ text, embedding }, ...]
	return chunks.map(chunk => {
		const result = {
			text: chunk.text,
			embedding: chunk.embedding
		};
		return result;
	});
}
