# 🍱semachunk - a Minimal Semantic Chunker

A lightweight TypeScript/JavaScript library for semantically chunking text.

## Features

- Sentence splitting with `string-segmenter` and optional HTML text extraction with `parse5`
- Markdown chunks with heading paths, source ranges and protected tables and code
- Model Agnostic, plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple callback
- Batch Embeddings for Efficiency and handling API Rate Limiting
- Optimized Sentence/Chunk Merging Algorithm

## Chunking algorithms

- **Batched priority merging** is the default for text and HTML. It ranks eligible adjacent chunk pairs across the document by cosine similarity. Each pass merges the strongest disjoint pairs, then re-embeds changed chunks in batches to update neighboring scores.
- **Document-relative cutoff** takes the mean cosine similarity of eligible original neighbors, subtracts half the standard deviation, and uses that threshold throughout the document.
- **Markdown block splitting** uses `mdast-util-from-markdown` to identify sections, code and tables. Oversized lists split by item and tables by row.
- **Section-aware greedy packing** appends consecutive prose from the same Markdown section while it fits, following [Docling’s peer merging](https://docling-project.github.io/docling/concepts/chunking/#hybrid-chunker).
- **Original-boundary merging** scores adjacent prose units once, as in Aurelio’s `semantic-chunkers`, and reuses those scores to rank disjoint merges at larger Markdown budgets. Semachunk’s JavaScript merger joins only prose within the same section, a rule inspired by [LightRAG Java’s merge checks](https://github.com/dargoner/lightrag-java/blob/af70d08df7fd7fb2b6d979321f05008d9c250305/lightrag-core/src/main/java/io/github/lightrag/indexing/SemanticChunkRefiner.java#L162-L173).
- **Overlap through context expansion (benchmark only)** lets neighboring chunks share text for embedding after all merges. In each batched round, a chunk can borrow one whole prose unit from its better-scoring side within the same section. An optional check rejects expansions whose embeddings drift too far from the original. Retrieval returns the original chunk text. [Overlap results](benchmarks/LOG.md#2026-11-24--choosing-expansion-limits-and-similarity-thresholds)

## Installation

```bash
npm install semachunk
```

HTML extraction uses the optional `parse5` dependency, which npm installs by default. Plain-text deployments can use `npm install semachunk --omit=optional`.

## Usage

This example uses the optional `openai` SDK and an `OPENAI_API_KEY`.

```javascript
import OpenAI from 'openai';
import { chunkText } from 'semachunk';

const openai = new OpenAI();

async function myEmbedder(texts) {
    const response = await openai.embeddings.create({ input: texts, model: "text-embedding-3-small" });
    return response.data.map(item => item.embedding);
}

const text = "Your long document text...";
const chunks = await chunkText(text, myEmbedder);

console.log(chunks);
// Output: [{ text: "...", embedding: [...] }, ...]
```

The callback receives distinct texts in batches. Set `maxEmbeddingBatchSize` to your provider's input limit. It applies to sentence scoring, intermediate merges and final output. Requests are balanced within each stage. When embeddings are requested, chunks that can no longer fit beside either neighbor can share spare slots in a merge-scoring batch, using their final prefix. A single-item call is still possible when only one new vector is ready or one final output remains.

Return one nonempty vector per text in the same order. All vectors in a `chunkText` call must have the same dimension and contain finite numbers. Numeric arrays and numeric typed arrays are supported. Repeated text reuses its cached embedding within a call, and each returned chunk owns its vector. Empty or fully filtered input returns `[]` without calling the provider.

For large documents, `maxCachedEmbeddings` limits how many vectors the cache retains between stages. Active scoring vectors, the current batch and requested output still need memory. A finite limit can re-embed evicted texts and skips prefetching final vectors. The default caches each distinct provider input for the full call.

Input is plain text by default. Strings such as `Array<T>` and `&amp;` stay literal. Blank lines, Markdown headings and new bulleted or numbered items start separate units. A single line break inside prose wraps the same unit. For HTML, pass `inputFormat: 'html'`. Headings, paragraphs, list items and other blocks start separate units, inline tags preserve word continuity, and entities are decoded. The chunker normalizes whitespace inside each unit. Related units can subsequently merge.

### Markdown

Install the optional parser dependencies in applications that use Markdown.

```sh
npm install mdast-util-from-markdown mdast-util-gfm mdast-util-frontmatter micromark-extension-gfm micromark-extension-frontmatter
```

Pass `inputFormat: 'markdown'` to preserve spelling, whitespace, tables, code and the heading hierarchy. Joins use the exact intervening source within one section. A thematic break or skipped definition ends a run. Tables and code have their own chunks. Set `combineChunks: false` to return the initial units.

At the default 500-character target, Markdown greedily packs adjacent prose and embeds only the requested final texts. When **both** limits allow at least **1,024 UTF-16 code units and 256 tokens**, it scores each eligible original prose boundary once and merges the highest-scoring disjoint pairs that fit. An unlimited setting satisfies its side of the rule. For a token-only budget, set `maxChunkSize: Infinity` along with `maxChunkTokens` and `countTokens`. [Retrieval and indexing costs](benchmarks/LOG.md)

The scoring cutoff defaults to the document's mean eligible cosine minus half its population standard deviation. With fewer than two eligible boundaries it uses `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` or `mergeThresholdMode: 'fixed'` selects a fixed cutoff. The priority pass limits apply during scoring. `returnEmbedding: false` skips final indexing, though scoring can still call the embedder. With `combineChunks: false` and `returnEmbedding: false`, Markdown makes zero embedding calls.

Each Markdown result has a `sectionId` (heading offset, or `null` in the preamble), a `headingPath` of visible titles, and `sourceRanges`. For each `{ start, end, outputStart }`, the input slice from `start` to `end` appears verbatim at `outputStart` in the returned text. Offsets count UTF-16 code units. Repeated table headers map to the same input. Generated continuation markers and visible caller prefixes occupy gaps in the mapping. A hidden caller prefix is included in `embeddingText`, the exact string for external indexing.

Closed leading YAML, link definitions and empty sections are omitted. Reference links and footnotes keep their spelling for display with the original document. The first body carries its consecutive headings when the hard token budget permits. The character target guides splits by sentence, item, child block or table row. Code stays intact until a hard token cap requires line splitting. If a complete table row or a fence wrapper cannot fit, source fragments preserve the material within the cap.

For structural HTML ingestion, convert HTML to Markdown upstream with `rehype-parse`, `rehype-remark`, `remark-gfm` and `remark-stringify`. Pass that string to the Markdown path. Its ranges address the converted string.

### Fitting an embedding model’s input

For a rough size target, set `maxChunkSize`. It compares JavaScript string lengths and needs no tokenizer. For a hard model-token limit, set `maxChunkTokens` and supply a synchronous `countTokens(text)` using the same tokenizer and special tokens as your provider. The chunker checks each join and both the raw and prefixed forms. A sentence over budget is split at word boundaries when possible, then at Unicode code point boundaries if a single word is too long. Those pieces go directly into the final embedding batch. An input that cannot fit even one code point with its prefix raises a `RangeError` before embedding.

```javascript
const chunks = await chunkText(text, myEmbedder, {
    maxChunkTokens: 256,
    countTokens: text => tokenizer.encode(text).length // For a tokenizer that returns token IDs.
});
```

### Choosing a similarity threshold

For text and HTML, each sentence starts as its own chunk. Each pass merges the highest-scoring disjoint pairs whose joined length fits `maxChunkSize` (500 UTF-16 code units by default). The ordinary merge accepts adjacent pairs with cosine similarity **at least 0.05**. Set `similarityThreshold` to choose another cutoff. An explicit `combineChunksSimilarityThreshold` takes precedence. Set `combineChunks: false` to return the initial sentence units.

We selected 0.05 on plain text using `text-embedding-3-small` and `maxChunkSize: 500`. One index served 256, 512 and 1,024 retrieved tokens. On 553 held-out questions, the share that received all annotated evidence rose by 2.89, 4.77 and 7.23 percentage points over 0.5 at those budgets, with equal weight per task. Papers gained the most. Contracts favored 0.5 at every budget. Building the 0.05 index used 52% more embedding tokens and stored about half as many chunks. [Cutoff study and greedy packing comparison](benchmarks/LOG.md#2026-11-24--ordinary-merge-cutoff-by-retrieval-budget)

Set `mergeThresholdMode: 'document'` to derive one priority cutoff from the original size-eligible adjacent sentence pairs. It uses their mean cosine minus half their population standard deviation, reusing the first scoring batch. Later rounds use that same cutoff. With fewer than two eligible pairs it falls back to `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` selects a fixed cutoff in either mode. [Cutoff comparison and retrieval costs](benchmarks/LOG.md)

The RAG benchmark measures how much annotated evidence reaches a 256-, 512- or 1,024-token context in full contracts, scientific papers and multi-hop question answering. It compares semantic merging with sentence packing and overlapping token windows under both dense and lexical retrieval. [RAG benchmark and commands](benchmarks/README.md#run-the-rag-evidence-benchmark)

## Configuration

Character size and merge counts accept nonnegative safe integers or `Infinity`. Zero disables joins for `maxChunkSize`, priority passes for either pass limit, priority merges for `maxMergesPerPass`, and the soft minimum for `uncappedCandidateMerges`. The embedding batch size and token limit accept positive safe integers or `Infinity`. Cosine cutoffs must be finite.

| Option | Default | Description |
|---|---|---|
| `inputFormat` | `'text'` | Split plain text, extract text from `'html'`, or preserve structure in `'markdown'`. |
| `locale` | `'en'` | Language tag passed to the sentence segmenter. Its English and Spanish abbreviation lists use `en` and `es`. |
| `maxChunkSize` | 500 | Maximum UTF-16 code units in a join. Count the separating space for text and HTML or the actual intervening whitespace for Markdown. An indivisible leaf can exceed this target. The character limit excludes the caller prefix. |
| `maxChunkTokens` | `Infinity` | Hard model-token budget for each chunk and provider input, including any prefix. A finite value enables splitting oversized sentences. |
| `countTokens` | — | Synchronous tokenizer callback required for a finite token budget. Returns a nonnegative safe integer. |
| `maxEmbeddingBatchSize` | `Infinity` | Maximum distinct texts per provider request. Use a positive integer to set a limit. |
| `maxCachedEmbeddings` | `Infinity` | Maximum cached vectors between stages, in insertion order. Zero disables reuse between stages. |
| `similarityThreshold` | 0.05 for fixed text and HTML merges, 0.5 for document calibration or Markdown | Minimum cosine for fixed merging and fallback for document calibration. |
| `combineChunks` | `true` | Combine initial units using the input format's strategy. Set to `false` to keep those units. |
| `combineChunksSimilarityThreshold` | `similarityThreshold` in fixed mode | Supply a fixed priority cutoff, overriding document calibration and the base cutoff. |
| `mergeThresholdMode` | `'fixed'` for text and HTML, `'document'` for Markdown | Use a fixed priority cutoff or calibrate once per document from its original eligible neighbors. |
| `excludeNonLetterSentences` | `false` | Skip sentences containing no Unicode letters before embedding |
| `maxUncappedPasses` | `100` | Maximum number of passes that exhaust the available disjoint merges. A pass that defers an eligible disjoint pair because of a cap is exempt. |
| `maxPasses` | `Infinity` | Total priority rounds, including capped rounds. Final indexing and splitting requests to respect `maxEmbeddingBatchSize` can add provider calls. |
| `maxMergesPerPass` | `500` | Absolute limit on the number of merges per pass. |
| `candidateMergesPercentageCap` | `40` | Percentage from 0 through 100, including fractions. The per-pass count is rounded down before applying the soft minimum and absolute limit. The canonical spelling takes precedence over the legacy `candiateMergesPercentageCap`. |
| `uncappedCandidateMerges` | `12` | Soft-minimum number of merges per pass (overrides percentage cap) |
| `returnEmbedding` | `true` | Include embeddings in the output |
| `chunkPrefix` | `''` | Prefix added to the final chunk text and included in its returned embedding |
| `excludeChunkPrefixInResults` | `false` | Return the original chunk text while embedding the prefixed text |

# Acknowledgements

This project is derived from `jparkerweb`'s semantic-chunking library. [Upstream project](https://github.com/jparkerweb/semantic-chunking)

- Lightweight dependencies for sentence splitting and HTML extraction
- Stripped down to the core functionality
- Model Agnostic
- Batch Embeddings for Efficiency and handling API Rate Limiting
- New optimized chunk merging algorithm
