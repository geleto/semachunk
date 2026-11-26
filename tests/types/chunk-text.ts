import { chunkText, type Chunk, type ChunkingOptions, type EmbedBatchCallback, type JsonChunk, type MarkdownChunk, type RangedChunk } from '../../src/index.js';

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
const inferred = chunkText('One.', embed);
const explicitText = chunkText<Float32Array>('One.', embed, { inputFormat: 'text' });
const explicit = chunkText<Float32Array>('One.', embed, { inputFormat: 'markdown' });
const explicitJson = chunkText<Float32Array>('[1]', embed, { inputFormat: 'json' });
declare const options: ChunkingOptions;
const dynamic = chunkText('One.', options);
const dynamicVector = chunkText<Float32Array>('One.', embed, options);
declare const maybeMarkdown: { inputFormat: 'markdown' } | undefined;
const optional = chunkText('One.', null, maybeMarkdown);
const delimited = chunkText('a|b', { chunkingStrategy: 'blocks', separator: '|' });
const absent = chunkText('x', { separator: undefined });
declare const maybeSeparator: string | undefined;
const possible = chunkText<Float32Array>('x', embed, { chunkingStrategy: 'pack', separator: maybeSeparator });
declare const mixed: { inputFormat: 'json' } | { inputFormat: 'text', chunkingStrategy: 'pack', separator: string };
const mixedResult = chunkText('x', mixed);
const explicitDelimited = chunkText<Float32Array>('x', embed, { chunkingStrategy: 'pack', separator: '|' });
const explicitMixed = chunkText<Float32Array>('x', embed, mixed);

type Inference = [
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
