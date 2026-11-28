# 🍱semachunk - a Minimal Semantic Chunker

Split plain text, Markdown, HTML or JSON into chunks in JavaScript or TypeScript. Use document structure on its own or supply an embedding callback to split by similarity.

## Installation

```bash
npm install semachunk
```

A normal install supports all four input formats. The optional parsers load on demand. Plain-text-only deployments can skip them with `npm install semachunk --omit=optional`.

## Usage

```js
import { chunk } from 'semachunk';

const doc = await chunk('Heat the stock.\n\nAdd the rice. Stir gently.', { maxChunkSize: 30 });
doc.chunks.map(c => c.text); // ['Heat the stock.', 'Add the rice. Stir gently.']
```

`chunk(text, options?)` returns one document with a parsed hierarchy and citable passages in `doc.chunks`.

### Strategies

| `strategy` | Description |
| --- | --- |
| `blocks` (default) | Keep fitting structural units together and descend into oversized ones. |
| `pack` | Append consecutive sentences or records up to the limit, with optional overlap. |
| `semantic` | Build structural and similarity-based passages from the same document and search both layouts together. Requires `embedBatch`. |

### Formats

| `format` | Structure |
| --- | --- |
| `text` (default) | Blank-line paragraphs, headings, list items, lines and sentences. |
| `markdown` | Headings, paragraphs, lists, tables and code blocks with original Markdown ranges. |
| `html` | Visible text and authored structure with citations into the original markup. |
| `json` | Records, objects, arrays and scalar values. Supports `blocks`. |

### Size limits

All limits use `sizeUnit: 'characters'` by default. For tokens, pass `sizeUnit: 'tokens'` and the embedding model's synchronous `countTokens` function.

| Option | Characters (UTF-16) | Tokens |
| --- | --- | --- |
| `maxChunkSize` | 500 for plain text or 1,024 for structured formats | 256 |
| `maxStructuralSize` | 1,024 | 256 |
| `maxPassageSize` | 2,048 | 512 |

In `semantic` mode the similarity-based layout targets `maxPassageSize` by default. Its structural layout uses the ordinary `blocks` target. An explicit `maxChunkSize` sets the semantic target and can lower the structural target. `maxStructuralSize` limits whole branches and joins across paragraphs. `maxPassageSize` bounds every returned passage including context. An indivisible fragment or prefix that exceeds the ceiling is flagged with `sizeLimitExceeded` or `tokenLimitExceeded` and skipped by the search index.

## Chunking strategies

### `blocks`

The default strategy keeps a whole document or section together when it fits. When a node is too large, `blocks` descends into its children and groups consecutive siblings that fit. Omitted content and explicit record boundaries keep chunks separate.

### `pack`

`pack` fills each chunk from left to right. In plain text it appends whole sentences, so a chunk can span paragraphs. With a plain-text `separator` it packs whole records. In HTML and Markdown it appends consecutive prose from the same section until the next unit would exceed a size limit. A new heading, table, code block or thematic break ends the run.

Use `chunkOverlap` to repeat whole units from the end of the previous chunk. They must fit the overlap limit and leave room for a new unit. The overlap is measured in UTF-16 code units, or in tokens with `sizeUnit: 'tokens'`. To get individual plain-text sentences, use `pack` with `maxChunkSize: 0`.

```javascript
const { chunks } = await chunk('Add water. Stir well. Serve hot.', {
    strategy: 'pack',
    maxChunkSize: 21,
    chunkOverlap: 10
});
chunks.map(chunk => chunk.text); // ['Add water. Stir well.', 'Stir well. Serve hot.']
```

### `semantic`

One call builds a structural layout followed by a similarity-based layout. Both refer to the same hierarchy and source. In `doc.chunks` each passage has `layout: 'blocks'` or `layout: 'semantic'`. The two layouts can cover the same source text.

The semantic layout scores adjacent siblings from sentences to sections. A similarity below the default cutoff of 0.15 creates a boundary even within a fitting parent. Adjacent sibling paragraphs can rejoin within the structural limit. Pass `joinParagraphs: false` to preserve those cuts. `embedBatch` is required for boundary scoring even with `returnEmbedding: false`.

## What chunk returns

`chunk(text, options?)` returns a `Promise<ChunkedDocument>`. The document contains `chunks`, the parsed hierarchy in `nodes`, the `format`, `strategy`, `sizeUnit`, `maxStructuralSize` and `maxPassageSize`. Pass `sourceId` to identify the source in citations and search results.

`DocumentChunk` is the TypeScript type of **one passage** in `doc.chunks`. For example, `await chunk('Heat the stock.', { sourceId: 'recipe' })` returns a document whose first chunk is

```js
{
    text: 'Heat the stock.', sourceId: 'recipe', layout: 'blocks',
    parentId: 2, nodeIds: [1, 2],
    citations: [{ start: 0, end: 15, outputStart: 0, outputEnd: 15 }]
}
```

`parentId` and `nodeIds` address `doc.nodes`. Markdown chunks also carry `headingPath` and `sectionId`, and JSON chunks carry `jsonPointer`. With `embedBatch`, each fitting chunk includes its core `embedding` by default. Use `index: true` to store the retrieval vectors for the whole document.

## Search and citations

```js
import { chunk, search } from 'semachunk';

const options = {
    format: 'markdown', strategy: 'semantic', index: true, embedBatch, returnEmbedding: false
};
const handbook = await chunk(handbookMarkdown, { ...options, sourceId: 'handbook' });
const [hit] = await search(handbook, 'When does coverage start?');

const docs = [handbook];
docs.push(await chunk(policyMarkdown, { ...options, sourceId: 'policy' }));
const [questionVector] = await embedBatch(['When does coverage start?']);
const hits = await search(docs, questionVector, { limit: 3 });
```

`search(docOrDocs, query, options?)` returns a promise of ranked hits. The default `limit` is five across the collection. `docs[hit.documentIndex].chunks[hit.chunkIndex]` is the exact passage in `hit.chunk`. For a single document, `documentIndex` is zero. `hit.score` is the passage score. `hit.match` gives the best matching indexed detail or, when there is none, the core passage. Display `hit.context.text` and use `hit.context.citations` to cite it.

With `index: true`, `chunk` stores the distinct passage, paragraph and eligible section vectors in `doc.index`. Appending another indexed document reuses the vectors already prepared. When a source changes, replace its document in the array with a fresh `chunk` result. Set `returnEmbedding: false` to omit the extra copy of the core vector on each chunk. For a document created without an index, `search` can prepare the missing vectors on first use with `embedBatch` and reuse them in memory.

Use the same embedding model for every document and query. A text query is embedded once for the collection. Live documents remember their callback. To search indexed documents loaded from JSON, pass a query vector, or pass a string and `{ embedBatch }`. For token-sized documents loaded from storage, also pass the original `{ countTokens }` so the returned context respects its budget.

Chunk scoring blends the core and the best contained paragraph equally. Paragraphs are embedded with their nearest heading. Semantic-layout cores mix 70% of their vector with 30% from eligible immediately adjacent chunks in that layout, within the authored section. A single eligible neighbour gets the full 30%. Both layouts of a semantic document give an eligible enclosing section 15% of the score by default. Search suppresses results from the same source that overlap by at least 75% of the shorter passage. [Retrieval benchmark](benchmarks/results/2026-11-28-mastra-finalists.md)

Displayed context keeps the core intact and stays within its section or record and `maxPassageSize`. For a structural chunk, the reader first fits text from the immediate neighbour on each side. It uses a wider window only when that window retains every source span in the first one. This applies to standalone `blocks` and structural hits in `semantic`. Similarity-split chunks can draw from several neighbours. Packed chunks draw from one per side. Use `neighbors: 0` to display the core alone. `getChunkContext(doc, chunkIndex)` returns the same reading passage, including its cited headings and list introductions. [Structural reading-window results](benchmarks/results/2026-11-28-blocks-retrieval.md)

Citation offsets are half-open UTF-16 ranges in both the input and the displayed text. The displayed `&` in `<p>A &amp; B</p>` maps from output `[2,3)` to input `[5,10)`. Search returns original paragraph text and citations even when its embedding includes a heading.

### Custom indexes and node lookup

Use `const index = await createDocumentIndex(docOrDocs, embedBatch, options)` for direct node lookup, custom detail types or index statistics. It shares equal embedding inputs across documents. `index.search(query)` uses the same passage scorer as `search`. `index.stats` reports sources, layouts, candidate chunks and distinct embeddings. Pass `detailTypes: ['paragraph','sentence']` to index sentences, or `sentenceGrouping: {maxSentences: 3, minSimilarity: 0.25}` to index groups of adjacent sentences in a paragraph. `index.searchNodes(query, { types: ['paragraph'] })` returns the matching nodes and their citations.

`includeSections` controls section indexing and `sectionWeight` overrides the default score share. For standalone `blocks` and `pack` documents the default share is zero. `includeDocuments` enables whole-source keys, with explicit `documentWeight` for passage ranking. `useContainedSections` lets fitting sections inside a chunk compete with paragraph matches. The top-level `search` can also take these weights and uses `embedBatch` for any extra keys they require. `searchNodes` ordinarily returns sections or whole documents that fit the structural limit. To request full nodes of any size, pass `includeOversized: true`. A provider with a per-input limit needs a length-aware callback for large routing nodes.

To supply an outline for flattened text, pass `sectionRanges` to `chunk` with original `{start, end, headingPath?}` intervals. These add retrieval nodes while preserving the parser's chunk boundaries. `createDocumentIndex` and `getChunkContext` also accept `countTokens` for restored documents.

## Format details

### HTML

Pass `{ format: 'html' }` to `chunk`. The HTML parser builds a visible-text outline from headings, paragraphs, nested lists, quotations, tables and preformatted code. A section wrapper around a heading contributes one section to the outline. Inline links retain their labels, and code preserves indentation and line breaks.

HTML and Markdown use the same structure builder, chunking strategies and retrieval rules. The budgets measure each input's rendered passage. HTML returns decoded text with rows and cells separated by newlines and tabs. Oversized tables can repeat their column headers, with each repetition citing the original cells. The document nodes retain heading paths and source spans. A title-only document returns citable headings.

### Delimited text

For newline-delimited logs or JSON Lines, pass `{ separator: '\n' }`. With `blocks`, each trimmed, nonblank record is a chunk unless the passage budget requires a split. With `pack`, consecutive records can share a chunk with their original separators and can overlap in whole records. Delimiters are literal strings. LF and CRLF match each other.

For CSV with quoted multiline cells, parse the CSV first. Pass the rows as serialized JSON to keep record boundaries. For duplicate column names, keep the headers and values in positional arrays.

### JSON

Pass `{ format: 'json' }` with a serialized JSON string. Each item of a nonempty root array is a separate record. Every other root, including `[]`, starts as one record. Fitting records stay whole. Inside an oversized object or array, consecutive fields or items from the same parent share a chunk while they fit.

Long strings split by line and then by sentence within an oversized line. A single sentence or an uninterrupted ASCII identifier can exceed the soft character target. A hard token cap can split scalar values while preserving Unicode code points and raw JSON escapes. With `maxChunkSize: 0`, each scalar and empty container is a separate unit before budget-driven splitting.

Each chunk's `jsonPointer` identifies the value or, for a group of siblings, their parent. Duplicate keys can share a pointer. Use `sourceRanges` to cite the exact occurrence.

### Markdown

Pass `{ format: 'markdown' }` to preserve source spelling, whitespace and heading hierarchy. Oversized lists can split by item and tables by row, repeating the header when it fits. Code stays intact until a hard token cap requires splitting. Closed leading YAML front matter, link definitions, standalone HTML comments and empty sections are omitted.

Each chunk carries a `headingPath` of visible titles and a `sectionId` giving the heading's UTF-16 offset. A chunk spanning sibling sections carries their common parent's heading path. At the document root the path is `[]` and the ID is `null`.

### Source ranges

Markdown, JSON and delimited text return `sourceRanges`. For each `{ start, end, outputStart }`, `source.slice(start, end)` appears verbatim at `outputStart` in the returned text. All offsets count UTF-16 code units. A repeated table header maps to the same source text each time. Generated continuation markers and visible caller prefixes occupy gaps in the mapping.

If you set `chunkPrefix` and `excludeChunkPrefixInResults: true`, these formats also return `embeddingText` with the exact prefixed text used for indexing.

Direct HTML citations refer to offsets in the original markup, including the full spelling of decoded entities. Applications that convert HTML, PDF or LaTeX to Markdown first receive ranges in the converted input. Retain a source map when citations must point back to the original.

## Embeddings

Pass a batch callback to use your embedding provider. This example uses the `openai` SDK (`npm install openai`) and reads `OPENAI_API_KEY` from the environment.

```javascript
import OpenAI from 'openai';
import { chunk } from 'semachunk';

const openai = new OpenAI();

async function embedBatch(texts) {
    const response = await openai.embeddings.create({ input: texts, model: 'text-embedding-3-small' });
    return response.data.map(item => item.embedding);
}

const { chunks } = await chunk('Heat the stock. Add the rice. Stir gently.', {
    strategy: 'semantic', embedBatch
});
```

Return one nonempty numeric array or typed array per input, in order. All vectors in a call must have the same dimension and contain finite numbers. Use `maxEmbeddingBatchSize` to limit the number of distinct texts per request. The library caches vectors within each call. Set `maxCachedEmbeddings` to bound the cache between stages. A later stage may request an evicted vector again.

### Using Casai for retrieval

Pass your application's embedding model to Casai's `create.Embedder` and adapt its result to the batch callback.

```javascript
import { create } from 'casai';
import { chunk } from 'semachunk';

const embedder = create.Embedder({ model: embeddingModel });
const { chunks } = await chunk(markdown, {
    format: 'markdown', embedBatch: async texts => (await embedder(texts)).embeddings
});
```

Store the document ID, text and citations with external vector records so a retrieved passage can point back to the original input.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `locale` | `'en'` | Language tag for sentence segmentation, including long JSON strings. |
| `excludeNonLetterSentences` | `false` | Skip sentences containing no Unicode letters in text, HTML and Markdown. Applies when parsing sentences. JSON and delimited records reject this option when enabled. |
| `returnEmbedding` | `true` with a callback, otherwise `false` | Include a vector for each output chunk that fits the passage budget. |
| `index` | `false` | Store the vectors used by `search` on the returned document. Requires `embedBatch`. |
| `maxEmbeddingBatchSize` | `Infinity` | Maximum distinct texts per provider request. Use a positive integer to set a limit. |
| `maxCachedEmbeddings` | `Infinity` | Maximum cached vectors between stages, in insertion order. Zero disables reuse between stages. |
| `chunkPrefix` | `''` | Prefix added to the final text and included in its embedding. |
| `excludeChunkPrefixInResults` | `false` | Display the original text while embedding the prefixed text. |
| `logging` | `false` | Print diagnostic information. |

### Delimited text and packing

| Option | Applies to | Default | Description |
|---|---|---|---|
| `separator` | `blocks`, `pack` on plain text | omitted | Literal record delimiter. Record edges are trimmed and blank records are skipped. |
| `chunkOverlap` | `pack` | 0 | Maximum suffix to repeat in whole units, measured in tokens with token sizing or UTF-16 code units otherwise. Accepts a nonnegative safe integer. |

### Choosing a similarity threshold

To require a specific minimum cosine, set `mergeThresholdMode: 'fixed'` and `similarityThreshold`. In `'document'` mode the chunker uses the mean cosine of eligible original neighbors minus half the population standard deviation. With fewer than two eligible pairs it falls back to `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` overrides either mode.

| Option | Default |
|---|---|
| `mergeThresholdMode` | `'fixed'` for every format. |
| `similarityThreshold` | 0.15 in fixed mode. The fallback in document mode is 0.5. |
| `combineChunksSimilarityThreshold` | Omitted. Supply a finite cosine cutoff to override `similarityThreshold` and document calibration. |

## Browser usage

Browser applications can bundle the same `import { chunk, search } from 'semachunk'` used in Node. Use a browser with `Intl.Segmenter`. When bundling Markdown for a Web Worker, enable the `worker` package export condition. For esbuild, set `platform: 'browser', conditions: ['worker']` for the worker bundle.

From a source checkout, install the test browsers with `npx playwright install chromium firefox`, then run `npm run test:browser`.

## Acknowledgements

This project is derived from `jparkerweb`'s semantic-chunking library. [Upstream project](https://github.com/jparkerweb/semantic-chunking)
