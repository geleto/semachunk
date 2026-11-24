export interface ChunkingOptions {
	logging?: boolean;
	/** Extract HTML text, chunk Markdown sections, or split literal text (the default). */
	inputFormat?: 'text' | 'html' | 'markdown';
	/** BCP 47 language tag for sentence segmentation. Defaults to 'en'. */
	locale?: string;
	/** Maximum UTF-16 code units per join, including its separator. Nonnegative safe integer or Infinity. */
	maxChunkSize?: number;
	/** Maximum tokens in raw and prefixed texts. A finite positive integer enables the tokenizer fallback. */
	maxChunkTokens?: number;
	/** Synchronous token count using the embedding model's tokenizer, including its special tokens. */
	countTokens?: (text: string) => number;
	/** Maximum distinct texts per provider call across all stages. Defaults to Infinity. */
	maxEmbeddingBatchSize?: number;
	/** Maximum cached vectors retained between stages. Evicted texts may be embedded again. Default Infinity. */
	maxCachedEmbeddings?: number;
	/** Base cosine cutoff. Defaults to 0.05 for fixed text/HTML merging and 0.5 for document calibration or Markdown. */
	similarityThreshold?: number;
	excludeNonLetterSentences?: boolean;
	combineChunks?: boolean;
	/** Sets a fixed priority merge cutoff, overriding similarityThreshold and document calibration. */
	combineChunksSimilarityThreshold?: number;
	/** Calibrate the priority cutoff from original eligible neighbors. Defaults to 'document' for Markdown and 'fixed' for text and HTML. */
	mergeThresholdMode?: 'fixed' | 'document';
	/** Limit all priority merge rounds, including capped rounds. Default Infinity. */
	maxPasses?: number;
	/** Maximum uncapped passes. Nonnegative safe integer or Infinity. */
	maxUncappedPasses?: number;
	/** Absolute per-pass merge limit. Nonnegative safe integer or Infinity. */
	maxMergesPerPass?: number;
	/** Percentage from 0 through 100. Fractional percentages are supported. */
	candidateMergesPercentageCap?: number;
	/** @deprecated Use candidateMergesPercentageCap. */
	candiateMergesPercentageCap?: number;
	/** Per-pass soft minimum before the absolute limit. Nonnegative safe integer or Infinity. */
	uncappedCandidateMerges?: number;
	returnEmbedding?: boolean;
	chunkPrefix?: string;
	excludeChunkPrefixInResults?: boolean;
}

export type Embedding = readonly number[] | (ArrayBufferView & ArrayLike<number>);

export interface Chunk<Vector extends Embedding = number[]> {
	text: string;
	embedding?: Vector;
}

export interface MarkdownChunk<Vector extends Embedding = number[]> extends Chunk<Vector> {
	/** UTF-16 offset of the section heading. The preamble has a null sectionId. */
	sectionId: number | null;
	headingPath: string[];
	/** Half-open input offsets and the corresponding offset in the returned text. */
	sourceRanges: { start: number; end: number; outputStart: number }[];
	/** Exact indexing string when it differs from the displayed text. */
	embeddingText?: string;
}

export type EmbedBatchCallback<Vector extends Embedding = number[]> = (texts: string[]) => Promise<Vector[]>;

/**
 * Chunk text semantically using batch embeddings
 * @param text - Input text to chunk
 * @param embedBatchCallback - Returns one finite numeric vector per input text, in order and with a consistent dimension
 * @param options - Chunking options
 * @returns Array of chunks with text and optional embedding
 */
export function chunkText<Vector extends Embedding = number[]>(
	text: string,
	embedBatchCallback: EmbedBatchCallback<Vector>,
	options: ChunkingOptions & { inputFormat: 'markdown' }
): Promise<MarkdownChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string,
	embedBatchCallback: EmbedBatchCallback<Vector>,
	options?: ChunkingOptions & { inputFormat?: 'text' | 'html' }
): Promise<Chunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string,
	embedBatchCallback: EmbedBatchCallback<Vector>,
	options?: ChunkingOptions
): Promise<(Chunk<Vector> | MarkdownChunk<Vector>)[]>;

export function _printVersion(): Promise<void>;
