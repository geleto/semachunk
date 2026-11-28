import {chunk, search, createDocumentIndex, getChunkContext, type ChunkedDocument, type ChunkOptions,
    type ChunkingStrategy, type EmbedBatchCallback, type DocumentSnapshot, type DocumentChunk} from '../../src/index.js';

type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? true : false;
type Assert<T extends true> = T;
const embed:EmbedBatchCallback<Float32Array> = async texts=>texts.map(()=>Float32Array.of(1));
const plain = await chunk('One.');
const md = await chunk('# One\n\nTwo.',{format:'markdown',strategy:'semantic',embedBatch:embed});
const explicit = await chunk<Float32Array>('# One',{format:'markdown',embedBatch:embed});
const json = await chunk('[1]',{format:'json',sizeUnit:'tokens',countTokens:s=>s.length});
const html = await chunk('<p>Text</p>',{format:'html'});
const typed:ChunkOptions = {sectionRanges:[{start:0,end:4}],strategy:'blocks',separator:undefined};
const dynamic = await chunk('One.',typed);
type Inference = [
    Assert<Equal<typeof plain,ChunkedDocument<number[],'text'>>>,
    Assert<Equal<typeof md,ChunkedDocument<Float32Array,'markdown'>>>,
    Assert<Equal<typeof explicit,typeof md>>,
    Assert<Equal<typeof json,ChunkedDocument<number[],'json'>>>,
    Assert<Equal<typeof html,ChunkedDocument<number[],'html'>>>,
    Assert<Equal<ChunkingStrategy,'blocks'|'semantic'|'pack'>>
];
const section:number|null = md.chunks[0].sectionId;
const pointer:string = json.chunks[0].jsonPointer;
const layout:ChunkingStrategy = md.chunks[0].layout;
const end:number = getChunkContext(md,0).citations[0].outputEnd;
const index = await createDocumentIndex([md],embed,{sentenceGrouping:{maxSentences:3,minSimilarity:.25}});
const vector:Float32Array|undefined = (await index.search('one'))[0].chunk.embedding;
const members:number[] = (await index.searchNodes('one',{types:['sentenceGroup']}))[0].node.nodeIds;
const prepared = await chunk('# One',{index:true,format:'markdown',embedBatch:embed});
const explicitPrepared = await chunk<Float32Array>('# One',{index:true,format:'markdown',embedBatch:embed});
type IndexedInference = Assert<Equal<typeof explicitPrepared,typeof prepared>>;
const key:[string,number[]] = prepared.index.embeddings[0];
const passage:DocumentChunk<Float32Array,'markdown'> = prepared.chunks[0];
const passageLayout:ChunkingStrategy = passage.layout;
const [single] = await search(prepared,Float32Array.of(1));
const typedEmbedding:Float32Array|undefined = single.chunk.embedding;
const mdSection:number|null = single.chunk.sectionId;
const docs = [prepared,json] as const;
const [mixed] = await search(docs,'one',{embedBatch:embed});
const mixedVector:Float32Array|number[]|undefined = mixed.chunk.embedding;
const mixedLayout:ChunkingStrategy = mixed.chunk.layout;
void createDocumentIndex(prepared);
const custom = await createDocumentIndex(docs,embed,{detailTypes:['paragraph','sentence']});
const customLayout:ChunkingStrategy = (await custom.search([1]))[0].chunk.layout;
void createDocumentIndex<Float32Array>(prepared,embed);
declare const snapshot:DocumentSnapshot;
void createDocumentIndex([snapshot],embed);
const optionalLayout:ChunkingStrategy|undefined = (await search(snapshot,[1]))[0].chunk.layout;
// @ts-expect-error A portable search index requires an embedding provider at ingestion.
void chunk('One.',{index:true});
// @ts-expect-error Pass documents with their nodes, rather than bare passage arrays.
void search(prepared.chunks,[1]);
// @ts-expect-error Token sizing requires its tokenizer.
void chunk('One.',{sizeUnit:'tokens'});
// @ts-expect-error Semantic boundary selection requires an embedding provider.
void chunk('One.',{strategy:'semantic'});
// @ts-expect-error The individual semantic layout is not a public strategy.
void chunk('One.',{strategy:'semantic-blocks',embedBatch:embed});
// @ts-expect-error There is only one document return shape.
void chunk('One.',{includeHierarchy:false});
// @ts-expect-error Use the options object for the callback.
void chunk('One.',embed);
