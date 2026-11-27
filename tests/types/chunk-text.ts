import { chunkText, chunkDocument, createDocumentIndex, getChunkContext, type Chunk, type ChunkingOptions, type EmbedBatchCallback, type JsonChunk, type MarkdownChunk, type RangedChunk } from '../../src/index.js';

// Assignment to Chunk[] also accepts MarkdownChunk[]. Check exact inferred types instead.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

const plain = chunkText('One.');
const text = chunkText('One.', { inputFormat: 'text' });
const html = chunkText('<p>One.</p>', { inputFormat: 'html' });
const markdown = chunkText('One.', { inputFormat: 'markdown' });
const json = chunkText('[1]', { inputFormat: 'json' });
const noCallback = chunkText('One.', undefined, { inputFormat: 'markdown' });
const embed: EmbedBatchCallback<Float32Array> = async texts => texts.map(() => Float32Array.of(1));
const parsed = await chunkDocument('# One\n\nTwo.', {format:'markdown',includeHierarchy:true,embedBatch:embed});
const sectionId: number | null = parsed.chunks[0].sectionId;
const end: number = getChunkContext(parsed,0).citations[0].outputEnd;
const search = await createDocumentIndex([parsed],embed,{includeDocuments:true});
const hit = (await search.search('one',{documentWeight:.15}))[0];
const vector: Float32Array | undefined = hit.chunk.embedding;
const pointer: string = (await chunkDocument('[]',{format:'json'}))[0].jsonPointer;
// @ts-expect-error A token-sized chunk requires its tokenizer.
void chunkDocument('One.',{sizeUnit:'tokens'});
const withOutline = await chunkDocument('A.\n\nB.',{includeHierarchy:true,sectionRanges:[{start:0,end:6}]});
const estimated: true | undefined = withOutline.nodes[1].retrievalOnly;
const groupedIndex = await createDocumentIndex([parsed],embed,{sentenceGrouping:{maxSentences:3,minSimilarity:.25}});
const members: number[] = (await groupedIndex.searchNodes('a',{types:['sentenceGroup']}))[0].node.nodeIds;
const parentId: number | null = (await groupedIndex.searchNodes('a'))[0].node.parentId;
const boundedDoc = await chunkDocument('A.\n\nB.',{includeHierarchy:true,maxStructuralSize:256,maxPassageSize:768});
const structuralBudget: number | undefined = boundedDoc.maxStructuralSize;
void groupedIndex.searchNodes('source',{types:['document'],includeOversized:true});
// @ts-expect-error A supplied source outline is used with a hierarchical result.
void chunkDocument('One.',{sectionRanges:[]});
// @ts-expect-error The retired flat strategy is absent from both APIs.
void chunkDocument('One.', {strategy: 'semantic', embedBatch: embed});
// @ts-expect-error The retired flat strategy is absent from both APIs.
void chunkText('One.', embed, {chunkingStrategy: 'semantic'});
const inferred = chunkText('One.', embed);
const explicitText = chunkText<Float32Array>('One.', embed, { inputFormat: 'text' });
const explicit = chunkText<Float32Array>('One.', embed, { inputFormat: 'markdown' });
const explicitJson = chunkText<Float32Array>('[1]', embed, { inputFormat: 'json' });
declare const options: ChunkingOptions;
const dynamic = chunkText('One.', options);
const dynamicVector = chunkText<Float32Array>('One.', embed, options);
declare const maybeMarkdown: { inputFormat: 'markdown' } | undefined;
const optional = chunkText('One.', null, maybeMarkdown);
const delimited = chunkText('a|b', { separator: '|' });
const absent = chunkText('x', { separator: undefined });
declare const maybeSeparator: string | undefined;
const possible = chunkText<Float32Array>('x', embed, { chunkingStrategy: 'pack', separator: maybeSeparator });
declare const mixed: { inputFormat: 'json' } | { inputFormat: 'text', chunkingStrategy: 'pack', separator: string };
const mixedResult = chunkText('x', mixed);
const explicitDelimited = chunkText<Float32Array>('x', embed, { chunkingStrategy: 'pack', separator: '|' });
const explicitMixed = chunkText<Float32Array>('x', embed, mixed);

type Inference = [
    Assert<Equal<NonNullable<ChunkingOptions['chunkingStrategy']>, 'blocks' | 'pack' | 'semantic-blocks'>>,
    Assert<Equal<typeof plain, Promise<Chunk[]>>>,
    Assert<Equal<typeof text, Promise<Chunk[]>>>,
    Assert<Equal<typeof html, Promise<Chunk[]>>>,
    Assert<Equal<typeof markdown, Promise<MarkdownChunk[]>>>,
    Assert<Equal<typeof json, Promise<JsonChunk[]>>>,
    Assert<Equal<typeof noCallback, Promise<MarkdownChunk[]>>>,
    Assert<Equal<typeof inferred, Promise<Chunk<Float32Array>[]>>>,
    Assert<Equal<typeof explicitText, Promise<Chunk<Float32Array>[]>>>,
    Assert<Equal<typeof explicit, Promise<MarkdownChunk<Float32Array>[]>>>,
    Assert<Equal<typeof explicitJson, Promise<JsonChunk<Float32Array>[]>>>,
    Assert<Equal<typeof dynamic, Promise<(Chunk | RangedChunk | MarkdownChunk | JsonChunk)[]>>>,
    Assert<Equal<typeof dynamicVector, Promise<(Chunk<Float32Array> | RangedChunk<Float32Array> | MarkdownChunk<Float32Array> | JsonChunk<Float32Array>)[]>>>,
    Assert<Equal<typeof delimited, Promise<RangedChunk[]>>>,
    Assert<Equal<typeof absent, Promise<Chunk[]>>>,
    Assert<Equal<typeof possible, Promise<(Chunk<Float32Array> | RangedChunk<Float32Array>)[]>>>,
    Assert<Equal<typeof mixedResult, Promise<(JsonChunk | RangedChunk)[]>>>,
    Assert<Equal<typeof explicitDelimited, Promise<RangedChunk<Float32Array>[]>>>,
    Assert<Equal<typeof explicitMixed, Promise<(Chunk<Float32Array> | RangedChunk<Float32Array> | MarkdownChunk<Float32Array> | JsonChunk<Float32Array>)[]>>>,
    Assert<Equal<typeof optional, Promise<(Chunk | MarkdownChunk)[]>>>
];
