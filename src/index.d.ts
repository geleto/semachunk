export type ChunkingStrategy = 'blocks' | 'pack' | 'semantic-blocks';

export interface ChunkingOptions {
	logging?: boolean;
	/** Split literal text (default), extracted HTML text, Markdown sections or JSON records. */
	inputFormat?: 'text' | 'html' | 'markdown' | 'json';
	/** Defaults to 'blocks'. 'semantic-blocks' scores sibling boundaries throughout the parser tree. */
	chunkingStrategy?: ChunkingStrategy;
	/** Literal record delimiter for plain text with 'blocks' or 'pack'. LF and CRLF match each other. */
	separator?: string | undefined;
	/** Maximum trailing text to repeat in packed chunks, in tokens with a finite maxChunkTokens or UTF-16 units otherwise. Defaults to 0. */
	chunkOverlap?: number;
	/** BCP 47 language tag for sentence segmentation. Defaults to 'en'. */
	locale?: string;
	/** Soft per-chunk target in UTF-16 units. Defaults to 1024 in Markdown and JSON, and 500 in text and HTML. Use Infinity for token-only sizing. */
	maxChunkSize?: number;
	/** Token target per chunk and hard ceiling per embedding input. A finite value requires countTokens. Defaults to Infinity. */
	maxChunkTokens?: number;
	/** Synchronous token count using the embedding model's tokenizer, including its special tokens. */
	countTokens?: (text: string) => number;
	/** Maximum distinct texts per provider call across all stages. Defaults to Infinity. */
	maxEmbeddingBatchSize?: number;
	/** Maximum cached vectors retained between stages. Evicted texts may be embedded again. Default Infinity. */
	maxCachedEmbeddings?: number;
	/** Cosine cutoff for semantic-blocks. Defaults to 0.15 in fixed mode and 0.5 as the fallback in document mode. */
	similarityThreshold?: number;
	excludeNonLetterSentences?: boolean;
	/** Sets a fixed cutoff for semantic-blocks, overriding similarityThreshold and document calibration. */
	combineChunksSimilarityThreshold?: number;
	/** Use a fixed cutoff (default) or calibrate from eligible sibling boundaries in the document. */
	mergeThresholdMode?: 'fixed' | 'document';
	/** Include output vectors. Defaults to true with an embedding callback and false without one. */
	returnEmbedding?: boolean;
	chunkPrefix?: string;
	excludeChunkPrefixInResults?: boolean;
}

export type Embedding = readonly number[] | (ArrayBufferView & ArrayLike<number>);

export type DocumentFormat = 'text' | 'markdown' | 'html' | 'json';
export type DocumentNodeType = 'document' | 'article' | 'section' | 'heading' | 'paragraph' |
    'line' | 'sentence' | 'list' | 'listItem' | 'blockquote' | 'footnoteDefinition' | 'code' |
    'html' | 'table' | 'record' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null';
export interface Citation {
    /** Half-open UTF-16 span in the original input. */
    start: number;
    end: number;
    /** Corresponding half-open UTF-16 span in the displayed text. */
    outputStart: number;
    outputEnd: number;
}
export interface CitedText {
    text: string;
    sourceId?: string;
    citations: Citation[];
}
export interface DocumentNode extends CitedText {
    id: number;
    parentId: number | null;
    type: DocumentNodeType;
    headingPath: string[];
    /** Node ID of the authored heading or list lead-in. */
    introducedBy?: number;
    jsonPointer?: string;
    record?: boolean;
    /** An additional source-outline entry available for retrieval. */
    retrievalOnly?: true;
}
export type DocumentChunk<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> =
    CitedText & Chunk<V> & {embeddingText?: string; sizeLimitExceeded?:true} &
    (F extends 'markdown' ? MarkdownChunk<V> : F extends 'json' ? JsonChunk<V> : {});
export interface ChunkedDocument<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> {
    sourceId?: string;
    format: F;
    /** Older snapshots can omit sizing metadata. */
    sizeUnit?: 'characters' | 'tokens';
    maxPassageSize?: number;
    maxStructuralSize?: number;
    nodes: DocumentNode[];
    chunks: (DocumentChunk<V,F> & {nodeIds:number[], parentId:number})[];
}
export type DocumentOptions<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> =
    Omit<ChunkingOptions,'inputFormat' | 'chunkingStrategy' | 'countTokens' | 'maxChunkTokens'> & {
        sourceId?: string;
        format?: F;
        strategy?: ChunkingStrategy;
        embedBatch?: EmbedBatchCallback<V>;
        /** Rejoin cuts exactly between adjacent sibling paragraphs under the same parent. Defaults to true for semantic-blocks. */
        joinParagraphs?: boolean;
        /** Hard limit on the core plus its displayed neighbors. Defaults to 512 tokens or 2,048 UTF-16 units. */
        maxPassageSize?: number;
        /** Limit on whole branches, cross-block runs and directly returned sections or documents. Defaults to 256 tokens or 1,024 UTF-16 units. */
        maxStructuralSize?: number;
    } & ({sizeUnit?:'characters', countTokens?:never} | {sizeUnit:'tokens', countTokens:(text:string)=>number}) &
    ({includeHierarchy:true,
        /** Original UTF-16 source intervals for section retrieval. Requires includeHierarchy. */
        sectionRanges?: readonly {start:number, end:number, headingPath?: readonly string[]}[];
    } | {includeHierarchy?:boolean, sectionRanges?:never});

export function chunkDocument<V extends Embedding = number[], F extends DocumentFormat = 'text'>(
    text:string, options:DocumentOptions<V,F> & {includeHierarchy:true}
):Promise<ChunkedDocument<V,F>>;
export function chunkDocument<V extends Embedding = number[], F extends DocumentFormat = 'text'>(
    text:string, options?:DocumentOptions<V,F> & {includeHierarchy?:false}
):Promise<DocumentChunk<V,F>[]>;
export function chunkDocument<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat>(
    text:string, options:DocumentOptions<V,F>
):Promise<ChunkedDocument<V,F> | DocumentChunk<V,F>[]>;

export interface ReadingPassage extends CitedText {
    /** Recoverable source headings and list lead-ins associated with the core. */
    introductions:DocumentNode[];
}
export function getChunkContext(doc:ChunkedDocument<Embedding>, chunkIndex:number,
    options?:{neighbors?:0|1,countTokens?:(text:string)=>number}):ReadingPassage;
export interface DocumentSearchOptions {
    limit?:number;
    /** Include up to one adjacent passage on either side inside the authored section. Default 1. */
    neighbors?:0|1;
    /** Suppress windows sharing at least 75% of the shorter source span. Default true. */
    distinct?:boolean;
    useContainedSections?:boolean;
    sectionWeight?:number;
    documentWeight?:number;
}
export interface DocumentSearchHit<V extends Embedding = Embedding> {
    sourceId?:string;
    documentIndex:number;
    chunkIndex:number;
    score:number;
    match:DocumentNode | SentenceGroup | DocumentChunk<V>;
    chunk:DocumentChunk<V>;
    context:ReadingPassage;
}
export interface SentenceGroup extends CitedText {
    type:'sentenceGroup';
    nodeIds:number[];
    headingPath:string[];
}
export interface DocumentIndex<V extends Embedding = Embedding> {
    stats:{documents:number, layouts:number, chunks:number, uniqueEmbeddings:number};
    search(query:string | Embedding, options?:DocumentSearchOptions):Promise<DocumentSearchHit<V>[]>;
    searchNodes(query:string | Embedding, options?:{types?:readonly DocumentNodeType[],limit?:number,includeOversized?:boolean}):
        Promise<{node:DocumentNode,sourceId?:string,documentIndex:number,score:number}[]>;
    searchNodes(query:string | Embedding, options:{types:readonly ['sentenceGroup'],limit?:number,includeOversized?:boolean}):
        Promise<{node:SentenceGroup,sourceId?:string,documentIndex:number,score:number}[]>;
    searchNodes(query:string | Embedding, options:{types:readonly (DocumentNodeType|'sentenceGroup')[],limit?:number,includeOversized?:boolean}):
        Promise<{node:DocumentNode|SentenceGroup,sourceId?:string,documentIndex:number,score:number}[]>;
}
export function createDocumentIndex<V extends Embedding = Embedding>(
    documents:readonly ChunkedDocument<V>[], embedBatch:EmbedBatchCallback<Embedding>,
    options?:{detailTypes?:readonly DocumentNodeType[],includeSections?:boolean,includeDocuments?:boolean,
        maxEmbeddingBatchSize?:number,countTokens?:(text:string)=>number,
        /** Opt in to complete adjacent sentences within one paragraph and chunk. Defaults to at most three per group. */
        sentenceGrouping?:{maxSentences?:number,minSimilarity?:number}}
):Promise<DocumentIndex<V>>;

export interface Chunk<Vector extends Embedding = number[]> {
	text: string;
	embedding?: Vector;
	/** The source fragment or its prefixed text exceeds maxChunkTokens. It has no embedding. */
	tokenLimitExceeded?: true;
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
type ChunkFor<Format, Separator, Vector extends Embedding> = Format extends 'markdown' ? MarkdownChunk<Vector>
	: Format extends 'json' ? JsonChunk<Vector> : Format extends 'html' ? Chunk<Vector>
	: Separator extends string ? RangedChunk<Vector> : Chunk<Vector>;
type Result<Options, Vector extends Embedding> = Options extends ChunkingOptions
	? ChunkFor<Options['inputFormat'], Options['separator'], Vector> : Chunk<Vector>;

/** Omit the embedding callback to return text chunks and format metadata. */
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat?: 'text', separator: string }]>
): Promise<RangedChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options?: (ChunkingOptions & { inputFormat?: 'text' | 'html', separator?: undefined }) | undefined]>
): Promise<Chunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat?: 'text' }]>
): Promise<(Chunk<Vector> | RangedChunk<Vector>)[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat: 'markdown' }]>
): Promise<MarkdownChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[]>(
	text: string, ...args: ChunkArguments<Vector, [options: ChunkingOptions & { inputFormat: 'json' }]>
): Promise<JsonChunk<Vector>[]>;
export function chunkText<Vector extends Embedding = number[], Options extends ChunkingOptions | undefined = ChunkingOptions | undefined>(
	text: string, ...args: ChunkArguments<Vector, [options?: Options]>
): Promise<Result<Options, Vector>[]>;

export function _printVersion(): Promise<void>;
