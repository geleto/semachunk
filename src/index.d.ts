export type ChunkingStrategy = 'auto' | 'blocks' | 'pack' | 'semantic';

export interface ChunkingOptions {
	logging?: boolean;
	/** Split literal text (default), extracted HTML text, Markdown sections or JSON records. */
	inputFormat?: 'text' | 'html' | 'markdown' | 'json';
	/** Select natural blocks, greedy packing, or similarity merging. By default 'auto' packs when no embedding callback is supplied. */
	chunkingStrategy?: ChunkingStrategy;
	/** Maximum trailing text to repeat in packed chunks, in tokens with a finite maxChunkTokens or UTF-16 units otherwise. Defaults to 0. */
	chunkOverlap?: number;
	/** BCP 47 language tag for sentence segmentation. Defaults to 'en'. */
	locale?: string;
	/** Soft per-chunk target in UTF-16 units. Defaults to 1024 in Markdown and JSON, and 500 in text and HTML. Use Infinity for token-only sizing. */
	maxChunkSize?: number;
	/** Hard token ceiling per chunk and embedding input, including any prefix. Defaults to Infinity. A finite cap also requires countTokens. */
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
	/** In 'auto', false returns initial Markdown units or individual text/HTML sentences. Explicit strategies take precedence. */
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
	/** Include output vectors. Defaults to true with an embedding callback and false without one. */
	returnEmbedding?: boolean;
	chunkPrefix?: string;
	excludeChunkPrefixInResults?: boolean;
}

export type Embedding = readonly number[] | (ArrayBufferView & ArrayLike<number>);

export interface Chunk<Vector extends Embedding = number[]> {
	text: string;
	embedding?: Vector;
}

export interface RangedChunk<Vector extends Embedding = number[]> extends Chunk<Vector> {
	/** Half-open input offsets and the corresponding offset in the returned text. */
	sourceRanges: { start: number; end: number; outputStart: number }[];
	/** Exact indexing string when it differs from the displayed text. */
	embeddingText?: string;
}

export interface MarkdownChunk<Vector extends Embedding = number[]> extends RangedChunk<Vector> {
	/** UTF-16 offset of the section heading. The preamble has a null sectionId. */
	sectionId: number | null;
	headingPath: string[];
}

export interface JsonChunk<Vector extends Embedding = number[]> extends RangedChunk<Vector> {
	/** RFC 6901 pointer to the body in the original document. The root is the empty string. */
	jsonPointer: string;
}

/** Return one finite numeric vector per text, in order and with a consistent dimension. */
export type EmbedBatchCallback<Vector extends Embedding = number[]> = (texts: string[]) => Promise<Vector[]>;

type ChunkArguments<Vector extends Embedding, Options extends unknown[]> =
	Options | [embedBatchCallback: EmbedBatchCallback<Vector> | null | undefined, ...Options];
type ChunkFor<Format, Vector extends Embedding> = Format extends 'markdown' ? MarkdownChunk<Vector>
	: Format extends 'json' ? JsonChunk<Vector> : Chunk<Vector>;

/** Omit the embedding callback to return text chunks and format metadata. */
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options?: (ChunkingOptions & { inputFormat?: 'text' | 'html' }) | undefined]>
): Promise<Chunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat: 'markdown' }]>
): Promise<MarkdownChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat: 'json' }]>
): Promise<JsonChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[], Options extends ChunkingOptions | undefined = ChunkingOptions | undefined>(
	text: string, ...args: ChunkArguments<Vector, [options?: Options]>
): Promise<ChunkFor<Options extends ChunkingOptions ? Options['inputFormat'] : undefined, Vector>[]>;

export function _printVersion(): Promise<void>;
