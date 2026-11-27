# Agreed chunkDocument API and citations

The implemented document API includes the optional hierarchy, paragraph retrieval and source-mapped reading passages. [Usage and examples](../README.md#citable-documents-and-search)

Use `chunkDocument(text, options?)` to produce citable passages from a string. The format selects the parser. The parser supplies ordered units and their source positions to the chunking strategy. Callers can pass the same Markdown to `blocks`, `pack` or `semantic-blocks`.

## Calls and defaults

```js
await chunkDocument(text);
await chunkDocument(markdown, { format: 'markdown' });
await chunkDocument(markdown, { sourceId: 'guide@3', format: 'markdown', strategy: 'semantic-blocks', embedBatch });
```

Only `text` is required. `sourceId` is an optional identifier copied to each result. `format` defaults to `'text'` and `strategy` to `'blocks'` for every format. The first call chunks plain text by structure. Supplying an embedding callback adds vectors to those passages.

The document API uses one `sizeUnit` for the core target (`maxChunkSize`), whole branches and cross-block joins (`maxStructuralSize`), the complete reading passage (`maxPassageSize`) and `chunkOverlap`. Character mode is the default. Structural cores target 500 UTF-16 units for text and HTML or 1,024 for Markdown and JSON. In token mode they target 256 tokens for every format. Upper structural branches default to 1,024 UTF-16 units or 256 tokens. The hard passage ceiling is 2,048 UTF-16 units or 512 tokens. The `semantic-blocks` core target defaults to that ceiling. Token mode requires the caller’s tokenizer. The API counts the joined passage with its separators and checks the core embedding input including its prefix. [Retrieval experiments](../benchmarks/results/2026-11-27-structural-limits.md)

```ts
type DocumentSize = { sizeUnit?: 'characters' } | { sizeUnit: 'tokens'; countTokens: (text: string) => number };
type DocumentOptions<V extends Embedding = number[]> =
    Omit<ChunkingOptions, 'inputFormat' | 'chunkingStrategy' | 'maxChunkTokens' | 'countTokens'> & DocumentSize & {
    sourceId?: string;
    format?: 'text' | 'markdown' | 'html' | 'json';
    strategy?: ChunkingStrategy;
    maxStructuralSize?: number;
    maxPassageSize?: number;
    embedBatch?: EmbedBatchCallback<V>;
};

interface DocumentChunk<V extends Embedding = number[]> extends Chunk<V> {
    sourceId?: string;
    citations: { start: number; end: number; outputStart: number; outputEnd: number }[];
    embeddingText?: string;
}

declare function chunkDocument<V extends Embedding = number[]>(
    text: string, options?: DocumentOptions<V>
): Promise<DocumentChunk<V>[]>;
```

The signature shows the common result. Keep the format-specific return types for Markdown heading paths and section IDs and for JSON Pointers. The new names `format` and `strategy` correspond to `inputFormat` and `chunkingStrategy` in the existing `chunkText` API. [Current declarations](../src/index.d.ts)

## Format and strategy

Plain text recognizes sections introduced by `#` through `######`, blank-line-separated paragraphs, list items and sentences. Markdown also protects units such as tables and code. Basic HTML extracts readable block text. For richer HTML, the caller can convert an article to Markdown and select `format: 'markdown'`. JSON uses `blocks` and returns record pointers. [Supported formats](../README.md#supported-formats) · [Shared size limits](../README.md#chunk-size-limits)

`blocks` uses the hierarchy supplied by the parser. Its name applies to paragraphs, titled sections and JSON records. `pack` takes consecutive eligible units that fit. `semantic-blocks` scores adjacent children throughout the tree and uses each weak boundary to subdivide its ancestors. Its document root can join top-level siblings. `semantic-blocks` requires `embedBatch`.

The recorded decision dropped a public `recursive` strategy and kept one literal `separator` for delimited text. Mastra’s generic `recursive` tries a blank line, a newline, a space, then individual characters. Its Markdown preset gives all six heading levels the same priority. Its separate `semantic-markdown` strategy uses section hierarchy and a token threshold to join related headings. [Recorded decision](../benchmarks/LOG.md#2026-11-25--delimited-records-and-json-plan-review) · [Mastra recursive splitter](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/character.ts#L165-L269) · [Mastra chunk reference](https://mastra.ai/reference/rag/chunk)

### Parser tree and size limits

The parser supplies ordered nodes with a rendered span, source identity and children. Markdown sections own their introductory blocks and subsections. Plain prose supplies paragraphs and sentences. A blank line starts a paragraph. A single newline inside a sentence is a soft wrap. In an oversized paragraph, a line ending at a sentence boundary or an explicit Markdown hard break provides a finer division. Basic HTML can supply heading levels and explicit section elements. JSON supplies objects, arrays and values, with each top-level array item treated as a record.

The `blocks` traversal tries the document root first. If a node is oversized, it visits the children in source order and packs adjacent whole siblings under their common parent while they fit. This includes top-level paragraphs and sections. JSON arrays preserve their individual records. A split child ends the surrounding sibling group. Format-specific leaves handle table rows, fenced code, JSON escapes and indivisible text. The returned metadata names the common parent when a passage covers multiple children.

A contiguous node gets its character length from its rendered UTF-16 end and start offsets. Normalized text has its own rendered offsets. The traversal can measure a span of siblings, including the intervening separators, without walking the descendants again. Token mode counts the actual rendered text and the prefixed embedding input when applicable. Token counts across children are not additive. The existing leaf policy handles a sentence, code fence or other unit that exceeds the soft character target, and flags a fragment that still exceeds the hard token limit.

## Citations

Each citation maps a half-open UTF-16 interval `[start, end)` in the supplied string to `[outputStart, outputEnd)` in the displayed passage. For `<p>A &amp; B</p>`, the displayed `&` in `A & B` maps input `[5, 10)` to output `[2, 3)`. Generated prefixes occupy gaps in the map. Overlap and repeated table headers cite their original spans on each appearance. Return `embeddingText` whenever the indexing string differs from the displayed text.

Carry positions through parsing, normalization, packing and semantic merging. Reuse the existing Markdown, JSON and delimited-text ranges. Plain text needs positions through whitespace normalization, and HTML needs positions through text-node and entity decoding. When a converter supplies Markdown, citations address that Markdown. A reader can map them back to original HTML anchors, PDF pages or spreadsheet cells when it retains the conversion map.

Verify existing chunk boundaries with equivalent `chunkText` options. Exercise identical passages at different offsets, collapsed whitespace, inline HTML and entities, Unicode, hidden prefixes, overlap and token-limit splits.
