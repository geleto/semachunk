export interface ChunkingOptions {
	logging?: boolean;
	maxChunkSize?: number;
	similarityThreshold?: number;
	dynamicThresholdLowerBound?: number;
	dynamicThresholdUpperBound?: number;
	numSimilaritySentencesLookahead?: number;
	combineChunks?: boolean;
	combineChunksSimilarityThreshold?: number;
	maxUncappedPasses?: number;
	maxMergesPerPass?: number;
	candiateMergesPercentageCap?: number;
	returnEmbedding?: boolean;
	chunkPrefix?: string;
	excludeChunkPrefixInResults?: boolean;
}

export interface Chunk {
	text: string;
	embedding?: number[];
}

export type EmbedBatchCallback = (texts: string[]) => Promise<number[][]>;

/**
 * Chunk text semantically using batch embeddings
 * @param text - Input text to chunk
 * @param embedBatchCallback - Function that takes an array of strings and returns a promise resolving to an array of embeddings (arrays of numbers)
 * @param options - Chunking options
 * @returns Array of chunks with text and optional embedding
 */
export function chunkText(
	text: string,
	embedBatchCallback: EmbedBatchCallback,
	options?: ChunkingOptions
): Promise<Chunk[]>;

export function _printVersion(): Promise<void>;
