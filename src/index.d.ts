export type ChunkingStrategy = 'blocks' | 'pack' | 'semantic';

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
export interface Chunk<Vector extends Embedding = number[]> {
	text: string;
	embedding?: Vector;
	/** The source fragment or its prefixed text exceeds the token budget. It has no embedding. */
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

type PassageFields<V extends Embedding, F extends DocumentFormat> =
    CitedText & Chunk<V> & {
        /** Index into doc.nodes of the smallest enclosing node. */
        parentId:number;
        /** Indices of document nodes fully contained in this passage. */
        nodeIds:number[];
        embeddingText?:string;
        sizeLimitExceeded?:true;
        sourceRanges?:RangedChunk<V>['sourceRanges'];
    } &
    (F extends 'markdown' ? MarkdownChunk<V> : F extends 'json' ? JsonChunk<V> : {});

/** One citable passage in doc.chunks, with the layout that produced it. */
export type DocumentChunk<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> =
    PassageFields<V,F> & {layout:ChunkingStrategy};
type StoredChunk<V extends Embedding, F extends DocumentFormat = DocumentFormat> =
    PassageFields<V,F> & {layout?:ChunkingStrategy};

/** Default retrieval inputs and their vectors, stored once per distinct input within the document. */
export interface DocumentIndexData {
    embeddings:[text:string, vector:number[]][];
}

/** Previously stored single-layout documents may omit layout and sizing metadata. */
export interface DocumentSnapshot<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> {
    sourceId?: string;
    format: F;
    strategy?: ChunkingStrategy;
    sizeUnit?: 'characters' | 'tokens';
    maxPassageSize?: number;
    maxStructuralSize?: number;
    nodes: DocumentNode[];
    chunks: StoredChunk<V,F>[];
    index?: DocumentIndexData;
}

export interface ChunkedDocument<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> extends DocumentSnapshot<V,F> {
    strategy: ChunkingStrategy;
    sizeUnit: 'characters' | 'tokens';
    maxPassageSize: number;
    maxStructuralSize: number;
    chunks: DocumentChunk<V,F>[];
}

export type IndexedDocument<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> =
    ChunkedDocument<V,F> & {index:DocumentIndexData};

export type ChunkOptions<V extends Embedding = number[], F extends DocumentFormat = DocumentFormat> = {
    format?: F;
    sourceId?: string;
    maxChunkSize?: number;
    maxPassageSize?: number;
    maxStructuralSize?: number;
    sectionRanges?: readonly {start:number, end:number, headingPath?:readonly string[]}[];
    joinParagraphs?: boolean;
    separator?: string | undefined;
    chunkOverlap?: number;
    locale?: string;
    logging?: boolean;
    maxEmbeddingBatchSize?: number;
    maxCachedEmbeddings?: number;
    similarityThreshold?: number;
    combineChunksSimilarityThreshold?: number;
    mergeThresholdMode?: 'fixed' | 'document';
    excludeNonLetterSentences?: boolean;
    returnEmbedding?: boolean;
    chunkPrefix?: string;
    excludeChunkPrefixInResults?: boolean;
} & ({strategy?:'blocks'|'pack', index?:false, embedBatch?:EmbedBatchCallback<V>} |
     {strategy?:ChunkingStrategy, index?:boolean, embedBatch:EmbedBatchCallback<V>})
  & ({sizeUnit?:'characters', countTokens?:never} | {sizeUnit:'tokens', countTokens:(text:string)=>number});

/** Return one cited document. Semantic retrieval prepares structural and semantic passages together. */
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'markdown'> & {format:'markdown',index:true}):Promise<IndexedDocument<V,'markdown'>>;
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'json'> & {format:'json',index:true}):Promise<IndexedDocument<V,'json'>>;
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'html'> & {format:'html',index:true}):Promise<IndexedDocument<V,'html'>>;
export function chunk<V extends Embedding = number[], F extends DocumentFormat = 'text'>(
    text:string, options:ChunkOptions<V,F> & {index:true}
):Promise<IndexedDocument<V,F>>;
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'markdown'> & {format:'markdown'}):Promise<ChunkedDocument<V,'markdown'>>;
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'json'> & {format:'json'}):Promise<ChunkedDocument<V,'json'>>;
export function chunk<V extends Embedding = number[]>(text:string, options:ChunkOptions<V,'html'> & {format:'html'}):Promise<ChunkedDocument<V,'html'>>;
export function chunk<V extends Embedding = number[], F extends DocumentFormat = 'text'>(
    text:string, options?:ChunkOptions<V,F>
):Promise<ChunkedDocument<V,F>>;

export interface ReadingPassage extends CitedText {
    /** Recoverable source headings and list lead-ins associated with the core. */
    introductions:DocumentNode[];
}
export function getChunkContext(doc:DocumentSnapshot<Embedding>, chunkIndex:number,
    options?:{neighbors?:0|1,countTokens?:(text:string)=>number}):ReadingPassage;
export interface DocumentSearchOptions {
    limit?:number;
    /** Use bounded reading context (1, default) or the core alone (0). Structural context can span several chunks. */
    neighbors?:0|1;
    /** Suppress windows sharing at least 75% of the shorter source span. Default true. */
    distinct?:boolean;
    useContainedSections?:boolean;
    sectionWeight?:number;
    documentWeight?:number;
}
export interface DocumentSearchHit<V extends Embedding = Embedding, C extends StoredChunk<V> = StoredChunk<V>> {
    sourceId?:string;
    documentIndex:number;
    chunkIndex:number;
    score:number;
    match:DocumentNode | SentenceGroup | C;
    chunk:C;
    context:ReadingPassage;
}
export interface SentenceGroup extends CitedText {
    type:'sentenceGroup';
    nodeIds:number[];
    headingPath:string[];
}
export interface DocumentIndex<V extends Embedding = Embedding, C extends StoredChunk<V> = StoredChunk<V>> {
    stats:{documents:number, layouts:number, chunks:number, uniqueEmbeddings:number};
    search(query:string | Embedding, options?:DocumentSearchOptions):Promise<DocumentSearchHit<V,C>[]>;
    searchNodes(query:string | Embedding, options?:{types?:readonly DocumentNodeType[],limit?:number,includeOversized?:boolean}):
        Promise<{node:DocumentNode,sourceId?:string,documentIndex:number,score:number}[]>;
    searchNodes(query:string | Embedding, options:{types:readonly ['sentenceGroup'],limit?:number,includeOversized?:boolean}):
        Promise<{node:SentenceGroup,sourceId?:string,documentIndex:number,score:number}[]>;
    searchNodes(query:string | Embedding, options:{types:readonly (DocumentNodeType|'sentenceGroup')[],limit?:number,includeOversized?:boolean}):
        Promise<{node:DocumentNode|SentenceGroup,sourceId?:string,documentIndex:number,score:number}[]>;
}
export interface SearchOptions extends DocumentSearchOptions {
    /** Embed a text query or prepare missing retrieval vectors. Use the document's embedding model. */
    embedBatch?:EmbedBatchCallback<Embedding>;
    /** Original tokenizer for a stored token-sized document. */
    countTokens?:(text:string)=>number;
}
type DocumentInput = DocumentSnapshot<Embedding> | readonly DocumentSnapshot<Embedding>[];
type InputChunk<D> = D extends readonly DocumentSnapshot<Embedding>[] ? D[number]['chunks'][number] :
    D extends DocumentSnapshot<Embedding> ? D['chunks'][number] : never;
/** Rank one document or an array together. documentIndex addresses the input order and chunkIndex addresses doc.chunks. */
export function search<D extends DocumentInput>(documents:D, query:string | Embedding, options?:SearchOptions):
    Promise<DocumentSearchHit<Embedding,InputChunk<D>>[]>;
export interface DocumentIndexOptions {
    detailTypes?:readonly DocumentNodeType[];
    includeSections?:boolean;
    includeDocuments?:boolean;
    maxEmbeddingBatchSize?:number;
    countTokens?:(text:string)=>number;
    /** Opt in to complete adjacent sentences within one paragraph and chunk. Defaults to at most three per group. */
    sentenceGrouping?:{maxSentences?:number,minSimilarity?:number};
}
export function createDocumentIndex<D extends DocumentInput>(
    documents:D, embedBatch?:EmbedBatchCallback<Embedding>, options?:DocumentIndexOptions
):Promise<DocumentIndex<Embedding,InputChunk<D>>>;
export function createDocumentIndex<V extends Embedding = Embedding>(
    documents:DocumentSnapshot<V> | readonly DocumentSnapshot<V>[], embedBatch?:EmbedBatchCallback<Embedding>,
    options?:DocumentIndexOptions
):Promise<DocumentIndex<V>>;

export function _printVersion(): Promise<void>;
