import { chunkit } from './chunkit.js';

/**
 * Chunk text semantically using batch embeddings
 * @param {string} text - Input text to chunk
 * @param {Function} embedBatchCallback - async (texts[]) => embeddings[][]
 * @param {Object} options - Chunking options
 * @returns {Array} chunks - [{ text, embedding }, ...]
 */
export async function chunkText(text, embedBatchCallback, options = {}) {
	const defaultOptions = {
		similarityThreshold: 0.4,
		maxTokenSize: 500,
		dynamicThresholdLowerBound: 0.3,
		dynamicThresholdUpperBound: 0.5,
		combineChunks: true,
		combineChunksSimilarityThreshold: 0.5,
		maxPasses: 5,
		returnEmbedding: true // Default to true for this API
	};

	const mergedOptions = { ...defaultOptions, ...options };

	// Wrap text in document object
	const documents = [{ document_text: text }];

	// Call the refactored core function
	const chunks = await chunkit(documents, embedBatchCallback, mergedOptions);

	// Return simplified format: [{ text, embedding }, ...]
	return chunks.map(chunk => ({
		text: chunk.text,
		embedding: chunk.embedding
	}));
}
