# 🍱semachunk - a Minimal Semantic Chunker

Split plain text, Markdown, HTML or JSON into chunks in JavaScript or TypeScript. Use document structure on its own or supply an embedding callback to split by similarity.

## Installation

```bash
npm install semachunk
```

A normal install supports all four input formats. The optional parsers load on demand. Plain-text-only deployments can skip them with `npm install semachunk --omit=optional`.

## Usage

Call `chunkText(source)` to split a document with the default `blocks` strategy. Pass options as the second argument to set the chunk size or select another strategy.

```javascript
import { chunkText } from 'semachunk';

const text = 'Heat the stock.\n\nAdd the rice. Stir gently.';
const chunks = await chunkText(text, { maxChunkSize: 30 });
// [{ text: 'Heat the stock.' }, { text: 'Add the rice. Stir gently.' }]
```

To return vectors as well, call `chunkText(source, embedBatch, options)`. The callback receives an array of strings and returns one vector per string.

### Citable documents and search

`chunkDocument(text, options?)` returns chunks with citations into the original input, including plain text and HTML. Pass `includeHierarchy: true` to get `{ sourceId, format, nodes, chunks }`. Each node has an ID, parent ID, type, text, heading path and citations. Chunks identify their enclosing parent and the complete nodes they contain. IDs are local to the document. Citation offsets are half-open UTF-16 ranges in both strings. For example, the displayed `&` in `<p>A &amp; B</p>` maps to input `[5,10)` and output `[2,3)`.

`format` selects the parser and `strategy` selects the splitter. The defaults are `text` and `blocks`. All size limits use the selected `sizeUnit`.

| Document option | Characters | Tokens with `countTokens` |
|---|---:|---:|
| `maxChunkSize` for `blocks` and `pack` | 500 for text and HTML, 1,024 for Markdown and JSON | 256 |
| `maxChunkSize` for `semantic-blocks` | The passage ceiling | The passage ceiling |
| `maxStructuralSize`, the limit on a whole branch or a run across blocks | 1,024 UTF-16 units | 256 |
| `maxPassageSize`, the hard ceiling on a displayed passage including neighbors | 2,048 UTF-16 units | 512 |

`blocks` and `semantic-blocks` descend into oversized sections, lists and other branches. Whole branches and cross-paragraph joins must fit `maxStructuralSize`. Sentences within one paragraph can use the larger core budget. For example, semantic-blocks can keep one coherent 350-token paragraph intact. A 350-token section containing several paragraphs is divided at its children. The document strategy uses a 0.15 fixed similarity cutoff by default and joins adjacent sibling paragraphs when their shared edge fits. Pass `joinParagraphs: false` to preserve semantic cuts at paragraph boundaries. Both layouts retain the individual paragraph nodes for search and citation.

`maxPassageSize` must be a positive finite integer. It also bounds the core. Set `maxStructuralSize: Infinity` to allow branches to use the full core budget. Token mode counts the actual text, including separators. Character mode uses UTF-16 length directly. A fragment or caller prefix that cannot fit the hard limit is flagged at ingestion with `sizeLimitExceeded` in character mode or `tokenLimitExceeded` in token mode. Search indexes fitting cores.

```js
import { chunkDocument, createDocumentIndex } from 'semachunk';

const source = { sourceId: 'guide-v1', format: 'markdown', includeHierarchy: true,
    sizeUnit: 'tokens', countTokens };
const blocks = await chunkDocument(markdown, source);
const semantic = await chunkDocument(markdown, {
    ...source, strategy: 'semantic-blocks', embedBatch, returnEmbedding: false
});
const index = await createDocumentIndex([blocks, semantic], embedBatch, {
    includeSections: true
});
const [hit] = await index.search(question, { sectionWeight: 0.15 });
// hit.match contains the winning paragraph or the fallback chunk.
// hit.chunk is the ranked chunk. hit.context supplies the reading text and citations.
```

`createDocumentIndex` is an exact, in-memory retriever. The example builds one index from two chunk layouts of the same source revision. Give both layouts the same `sourceId`. `index.stats` reports source, layout, chunk and distinct embedding counts. One query embedding scores every distinct indexing text. By default each chunk receives equal weight from its own cosine score and its highest-scoring complete, strictly contained paragraph. A chunk with no such paragraph receives its own score. Equal text shares a stored vector across layouts and documents. Every result retains its own source occurrence. Semantic splitting can also compute sentence embeddings while choosing boundaries. The default retrieval index stores chunk and paragraph vectors.

To add individual sentence keys, pass `detailTypes: ['paragraph', 'sentence']` to `createDocumentIndex`. For fewer keys, pass `sentenceGrouping: { maxSentences: 3 }`. This adds consecutive complete sentences from the same paragraph inside each candidate. Groups share one embedding of their actual text. Setting `minSimilarity: 0.25` in the grouping options requires adjacent sentences to meet that cosine threshold. This mode uses temporary sentence vectors to decide joins. A group match includes the original sentence node IDs and source citations. These options work with either layout or with both in one index.

`includeSections` indexes authored sections containing at least two paragraphs. `sectionWeight` gives the nearest strictly enclosing section a share of the passage score. A title covering the entire document falls under document weighting. `useContainedSections: true` also lets fitting sections inside a chunk compete with paragraph matches. `includeDocuments` adds whole-source vectors for direct document retrieval or optional `documentWeight` in passage ranking. Both weights default to zero. A large section or document can help rank a bounded passage. Direct `searchNodes` lookups return section and document text that fits the structural and passage limits. To retrieve complete sources of any size explicitly, use `index.searchNodes(question, { types: ['document'], includeOversized: true })` on an index created with `includeDocuments: true`. The embedding callback receives the complete text of each requested key. A provider with an input limit needs a length-aware callback. Search accepts either a question string or its embedding.

If an importer supplies an outline for flattened text, pass `sectionRanges` to `chunkDocument` with `includeHierarchy: true`. Each `{ start, end, headingPath? }` gives the half-open UTF-16 interval of a complete section in the supplied string. Ranges can nest. The resulting nodes have `retrievalOnly: true` and provide scoring and citation metadata. The original parser hierarchy determines the chunk cuts and reading windows.

Reading context includes up to one neighboring chunk on either side, inside the authored section or record and the passage ceiling. The core stays intact. If the full window is too large, the renderer grows outward using the nearest complete parser units that fit, checking the joined text each time. Neighbors carry **zero ranking weight**. They contribute display text and can affect which overlapping hits are suppressed. Introductions identify the source headings and list lead-ins associated with the core. `getChunkContext(document, chunkIndex)` also works independently of search. Pass `neighbors: 0` to display just the core. Search suppresses same-source windows that overlap by at least 75% of the shorter window. Set `distinct: false` to inspect overlapping hits.

Token-sized documents retain their tokenizer in memory. After a JSON round trip, supply the same `countTokens` to `createDocumentIndex` or `getChunkContext`. Snapshots keep their recorded passage budget. Snapshots without any sizing metadata use the default character ceiling. An oversized legacy core requires rechunking the original source to build its bounded candidates. [Structural limits and comparison of strategies](benchmarks/results/2026-11-27-structural-limits.md) · [Sentence-group experiments](benchmarks/results/2026-11-27-bounded-passages.md)

## Chunking strategies

### `blocks`

The default strategy keeps a whole document or section together when it fits. When a node is too large, `blocks` descends into its children and groups consecutive siblings that fit. Omitted content and explicit record boundaries keep chunks separate.

### `pack`

`pack` fills each chunk from left to right. In text and HTML it appends whole sentences, so a chunk can span paragraphs. With a plain-text `separator` it packs whole records. In Markdown it appends consecutive prose from the same section until the next unit would exceed a size limit. A new heading, table, code block or thematic break ends the run.

Use `chunkOverlap` to repeat whole units from the end of the previous chunk. They must fit the overlap limit and leave room for a new unit. The overlap is measured in UTF-16 code units, or in tokens when `maxChunkTokens` is finite. To get individual text or HTML sentences, use `pack` with `maxChunkSize: 0`.

```javascript
const chunks = await chunkText('Add water. Stir well. Serve hot.', {
    chunkingStrategy: 'pack',
    maxChunkSize: 21,
    chunkOverlap: 10
});
chunks.map(chunk => chunk.text); // ['Add water. Stir well.', 'Stir well. Serve hot.']
```

### `semantic-blocks`

`semantic-blocks` scores adjacent siblings whose combined text fits the size limits, from sentences within a paragraph to top-level sections. A score below the cutoff forces a split even when the parent fits. The chunker then keeps whole nodes and groups consecutive siblings that fit between those splits. Related Markdown subsections can share a chunk. A table or code block can also share a chunk with related prose.

`semantic-blocks` requires an embedding callback, including when `returnEmbedding: false`. With `blocks` or `pack`, embeddings are used only for the requested output vectors.

## Supported formats

`inputFormat` defaults to `'text'`. Text, Markdown and HTML support all three strategies. JSON uses `blocks`.

### Text and HTML

Plain text keeps strings such as `Array<T>` and `&amp;` literal. Blank lines start paragraphs, `#` through `######` introduce sections, and bulleted or numbered items start new blocks. A single newline inside a sentence wraps the same paragraph. When subdividing an oversized paragraph, `blocks` prefers line endings that coincide with sentence boundaries.

Pass `inputFormat: 'html'` to extract readable text, decode entities and preserve inline word continuity. The structural strategies recognize `h1` through `h6`, paragraphs, articles, sections, lists and block quotations. They separate blocks with a blank line.

### Delimited text

For newline-delimited logs or JSON Lines, pass `{ separator: '\n' }`. With `blocks`, each trimmed, nonblank record is a chunk unless the token cap requires a split. With `pack`, consecutive records can share a chunk with their original separators and can overlap in whole records. Delimiters are literal strings. LF and CRLF match each other.

For CSV with quoted multiline cells, parse the CSV first. Pass the rows as serialized JSON to keep record boundaries. For duplicate column names, keep the headers and values in positional arrays.

### JSON

Pass `{ inputFormat: 'json' }` with a serialized JSON string. Each item of a nonempty root array is a separate record. Every other root, including `[]`, starts as one record. Fitting records stay whole. Inside an oversized object or array, consecutive fields or items from the same parent share a chunk while they fit.

Long strings split by line and then by sentence within an oversized line. A single sentence or an uninterrupted ASCII identifier can exceed the soft character target. A hard token cap can split scalar values while preserving Unicode code points and raw JSON escapes. With `maxChunkSize: 0`, each scalar and empty container is a separate unit before token splitting.

Each chunk's `jsonPointer` identifies the value or, for a group of siblings, their parent. Duplicate keys can share a pointer. Use `sourceRanges` to cite the exact occurrence.

### Markdown

Pass `{ inputFormat: 'markdown' }` to preserve source spelling, whitespace and heading hierarchy. Oversized lists can split by item and tables by row, repeating the header when it fits. Code stays intact until a hard token cap requires splitting. Closed leading YAML front matter, link definitions, standalone HTML comments and empty sections are omitted.

Each chunk carries a `headingPath` of visible titles and a `sectionId` giving the heading's UTF-16 offset. A chunk spanning sibling sections carries their common parent's heading path. At the document root the path is `[]` and the ID is `null`.

### Source ranges

Markdown, JSON and delimited text return `sourceRanges`. For each `{ start, end, outputStart }`, `source.slice(start, end)` appears verbatim at `outputStart` in the returned text. All offsets count UTF-16 code units. A repeated table header maps to the same source text each time. Generated continuation markers and visible caller prefixes occupy gaps in the mapping.

If you set `chunkPrefix` and `excludeChunkPrefixInResults: true`, these formats also return `embeddingText` with the exact prefixed text used for indexing.

For HTML articles whose links, tables or heading paths need to survive chunking, convert the article body to Markdown first. PDF and LaTeX sources can also be converted before chunking. The ranges refer to the converted input. Keep original page or heading identifiers alongside it for citations.

## Chunk size limits

- `maxChunkSize` is a soft target in UTF-16 code units. It includes separators between units and excludes `chunkPrefix`. The default is 500 for text and HTML and 1,024 for Markdown and JSON. A single sentence, protected block or JSON scalar can exceed it.
- `maxChunkTokens` is a token target per chunk and a hard ceiling for each embedding input, including its prefix. It defaults to `Infinity`. A finite limit requires a synchronous `countTokens(text)` callback.

### Fitting an embedding model’s input

Supply the embedding model's tokenizer, including any special tokens the provider counts. Both the raw and prefixed text must fit. Oversized sentences split at whitespace where possible and then at Unicode code points. A fragment that still exceeds the cap is returned with `tokenLimitExceeded: true` and no embedding.

Both size limits apply when both are finite. Set `maxChunkSize: Infinity` to size by tokens alone.

```javascript
const chunks = await chunkText(text, {
    maxChunkSize: Infinity,
    maxChunkTokens: 256,
    countTokens: text => tokenizer.encode(text).length
});
```

## Embeddings

Pass a batch callback to use your embedding provider. This example uses the `openai` SDK (`npm install openai`) and reads `OPENAI_API_KEY` from the environment.

```javascript
import OpenAI from 'openai';
import { chunkText } from 'semachunk';

const openai = new OpenAI();

async function embedBatch(texts) {
    const response = await openai.embeddings.create({ input: texts, model: 'text-embedding-3-small' });
    return response.data.map(item => item.embedding);
}

const chunks = await chunkText('Heat the stock. Add the rice. Stir gently.', embedBatch, {
    chunkingStrategy: 'semantic-blocks'
});
```

Return one nonempty numeric array or typed array per input, in order. All vectors in a call must have the same dimension and contain finite numbers. Use `maxEmbeddingBatchSize` to limit the number of distinct texts per request. The library caches vectors within each call. Set `maxCachedEmbeddings` to bound the cache between stages. A later stage may request an evicted vector again.

### Using Casai for retrieval

Pass your application's embedding model to Casai's `create.Embedder` and adapt its result to the batch callback.

```javascript
import { create } from 'casai';
import { chunkText } from 'semachunk';

const embedder = create.Embedder({ model: embeddingModel });
const chunks = await chunkText(markdown, async texts => (await embedder(texts)).embeddings, {
    inputFormat: 'markdown'
});
```

Store the document URL or ID, `text`, `headingPath` and `sourceRanges` with each vector so retrieved passages can cite the original document.

## Configuration

### Shared options

| Option | Default | Description |
|---|---|---|
| `inputFormat` | `'text'` | Split plain text, extract text from `'html'`, preserve sections in `'markdown'`, or split records in `'json'`. |
| `chunkingStrategy` | `'blocks'` | Select `'blocks'`, `'pack'` or `'semantic-blocks'`. JSON supports `'blocks'`. |
| `maxChunkSize` | 1,024 in Markdown and JSON, 500 in text and HTML | Soft per-chunk target in UTF-16 code units, including source or join separators. A single sentence, protected block or JSON scalar can exceed it. The caller prefix is excluded. |
| `maxChunkTokens` | `Infinity` | Token target per chunk and hard ceiling for every embedding input, including its prefix. An indivisible over-limit fragment is returned with `tokenLimitExceeded: true` and no vector. |
| `countTokens` | — | Synchronous tokenizer callback required for a finite token budget. Returns a nonnegative safe integer. |
| `locale` | `'en'` | Language tag for sentence segmentation, including long JSON strings. |
| `excludeNonLetterSentences` | `false` | Skip sentences containing no Unicode letters in text, HTML and Markdown. Applies when parsing sentences. JSON and delimited records reject this option when enabled. |
| `returnEmbedding` | `true` with a callback, otherwise `false` | Include a vector for each output chunk that fits the token limit. |
| `maxEmbeddingBatchSize` | `Infinity` | Maximum distinct texts per provider request. Use a positive integer to set a limit. |
| `maxCachedEmbeddings` | `Infinity` | Maximum cached vectors between stages, in insertion order. Zero disables reuse between stages. |
| `chunkPrefix` | `''` | Prefix added to the final text and included in its embedding. |
| `excludeChunkPrefixInResults` | `false` | Display the original text while embedding the prefixed text. |
| `logging` | `false` | Print diagnostic information. |

### Delimited text and packing

| Option | Applies to | Default | Description |
|---|---|---|---|
| `separator` | `blocks`, `pack` on plain text | omitted | Literal record delimiter. Record edges are trimmed and blank records are skipped. |
| `chunkOverlap` | `pack` | 0 | Maximum suffix to repeat in whole units, measured in tokens with a finite token limit or UTF-16 code units otherwise. Accepts a nonnegative safe integer. |

### Choosing a similarity threshold

To require a specific minimum cosine, set `mergeThresholdMode: 'fixed'` and `similarityThreshold`. In `'document'` mode the chunker uses the mean cosine of eligible original neighbors minus half the population standard deviation. With fewer than two eligible pairs it falls back to `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` overrides either mode.

| Option | Default |
|---|---|
| `mergeThresholdMode` | `'fixed'` for every format. |
| `similarityThreshold` | 0.15 in fixed mode. The fallback in document mode is 0.5. |
| `combineChunksSimilarityThreshold` | Omitted. Supply a finite cosine cutoff to override `similarityThreshold` and document calibration. |

## Browser usage

Browser applications can bundle the same `import { chunkText } from 'semachunk'` used in Node. Use a browser with `Intl.Segmenter`. When bundling Markdown for a Web Worker, enable the `worker` package export condition. For esbuild, set `platform: 'browser', conditions: ['worker']` for the worker bundle.

From a source checkout, install the test browsers with `npx playwright install chromium firefox`, then run `npm run test:browser`.

## Acknowledgements

This project is derived from `jparkerweb`'s semantic-chunking library. [Upstream project](https://github.com/jparkerweb/semantic-chunking)
