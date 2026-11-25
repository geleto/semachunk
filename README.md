# 🍱semachunk - a Minimal Semantic Chunker

A lightweight JavaScript library with TypeScript types for structure-aware and semantic text chunking.

## Features

- Sentence splitting with `string-segmenter` and optional HTML text extraction with `parse5`
- Markdown chunks with heading paths, source ranges and protected tables and code
- Model Agnostic, plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple callback
- Batch Embeddings for Efficiency and handling API Rate Limiting
- Optimized Sentence/Chunk Merging Algorithm

## Chunking strategies

`auto` uses the `inputFormat` you pass. It defaults to plain text. The default soft target per chunk is **1,024 UTF-16 code units in Markdown and JSON, and 500 in plain text and HTML**. The defaults require no tokenizer and use zero overlap. JSON always uses the record-based `blocks` layout. [Automatic selection results](benchmarks/LOG.md#2026-11-24--auditing-automatic-strategy-and-size-selection)

### When to use each strategy

| Strategy | When to choose it | How it builds a chunk |
|---|---|---|
| `auto` (default) | Start here if you have no retrieval examples to tune against. | JSON uses `blocks`. For other inputs with the default `combineChunks: true`, an omitted callback or positive overlap selects packing. With a callback and zero overlap, text and HTML use semantic merging. Markdown packs at or below 1,024 characters or with a hard cap below 256 tokens per chunk, and uses semantic merging otherwise. |
| `blocks` | Your source already has the unit you want to retrieve or cite, such as a contract clause in its own paragraph or a Markdown table. It also suits a retriever that can return many small hits. | Keeps blank-line paragraphs, HTML blocks or Markdown parser units separate. If a text or HTML block is too large, it splits at sentence boundaries and packs as many consecutive sentences as fit **within that block**. Oversized Markdown units split according to their structure. |
| `pack` | Start here for general passage retrieval, meeting transcripts or serving a few whole excerpts. It keeps surrounding context together at low indexing cost. | Takes as many consecutive sentences as fit, then starts the next chunk. Text and HTML can span paragraphs. Markdown joins adjacent prose only within the same section. Only requested output vectors use the embedding callback. Supports optional overlap. |
| `semantic` | Try it when packing mixes topics in one hit or separates evidence you need together. Compare it with `pack` on representative questions using your actual search limits. | Starts from the same units as `pack`. It embeds eligible neighbors and merges the most similar adjacent pairs that fit and meet the cutoff. Text and HTML rescore merged text in batches. Markdown reuses the original boundary scores and respects section boundaries. |

For example, `await chunkText(article, myEmbedder, { inputFormat: 'markdown', chunkingStrategy: 'pack' })` packs prose within each section using the 1,024-character target. This also gives you passages within chapters when a book has Markdown headings. Retrieval from whole books and native HTML remains untested here.

To reproduce the former default Markdown layout, pass `{ inputFormat: 'markdown', maxChunkSize: 500 }`. If your index used automatic semantic merging at exactly 1,024 characters, set `chunkingStrategy: 'semantic'` to keep that layout. Changing chunk size or strategy means rebuilding the chunks and vectors. Search hit counts and total excerpt budgets can change on an existing index.

### Chunk size and retrieval budget

- **Per chunk, at indexing time.** `maxChunkSize` is a soft character target. It counts the text and separators in a join. A single long sentence or fenced code block can exceed it. If your embedding model has a per-input limit, set `maxChunkTokens` at or below that limit and supply its tokenizer via `countTokens`. Both limits apply when both are finite. To size by tokens alone, set `maxChunkSize: Infinity`. [Token-limit example](#fitting-an-embedding-models-input)
- **Across hits, at query time.** Your retriever decides how many hits to fetch and how much text to send, using the answering model's tokenizer. For example, you can index up to **256 tokens per chunk**, retrieve up to **five hits**, then send at most **512 tokens of excerpts in total** for one question. Our benchmark uses `cl100k_base` for both token counts, includes separators and clips the last excerpt if needed. Instructions, the question and the answer also need room in the model's context window.

On 646 English Markdown questions, we built each index with the **same 256-token cap per chunk**, then varied only the search limits. The table shows the percentage of questions for which the retrieved text contained all annotated evidence, weighting the four tasks equally. [Markdown retrieval results](benchmarks/results/2026-11-24-chunking-modes.json)

| Hits per query | Total tokens of retrieved text per query | `blocks` | `pack` | `semantic` |
|---|---:|---:|---:|---:|
| Up to 5 | 512 | 53.71% | 57.48% | 60.64% |
| Up to 5 | 1,024 | 55.78% | 71.22% | 67.09% |
| As many as fit | 512 | 62.26% | 58.05% | 61.50% |

With five hits sharing 512 retrieved tokens, raising Markdown packing from **500 to 1,024 characters per chunk** improved complete evidence from 48.04% to 56.79% on the confirmation sample. At 1,024, semantic merging scored 57.54% and packing used 26% fewer embedding tokens. For short-answer lookup with **256 retrieved tokens in total**, try `pack` at 250 characters per chunk. It led the tested layouts on SQuAD and FriendsQA. [Automatic strategy and size results](benchmarks/LOG.md#2026-11-24--auditing-automatic-strategy-and-size-selection)

For **speaker-labelled dialogue**, choose the size with representative questions. With five hits sharing 512 tokens, raising the semantic target from 500 to 1,024 characters increased meeting-evidence recall from 18.27% to 24.93%. Packing at 1,024 reached 24.39% with 78% fewer indexing tokens than semantic merging. On 1,201 short-answer questions about dialogue, increasing the semantic target lowered answer-span hits from 69.61% to 61.03%. Allowing those five hits 1,024 tokens in total reversed that result. [Meeting evidence](benchmarks/results/2026-11-24-auto-confirmation.json) · [Dialogue answer spans](benchmarks/results/2026-11-24-auto-dialogue-small.json)

### Chunk boundaries and overlap

`chunkOverlap` sets how much trailing text a packed chunk can repeat at the start of the next. It counts UTF-16 code units, or tokens when `maxChunkTokens` is finite. Packing carries whole sentences or Markdown units and leaves room for at least one new unit, so actual overlap can be smaller or zero. Markdown section and block boundaries still apply. Both the returned text and its embedding include the overlap. In the Markdown study, an overlap target of 25% of the per-chunk token cap used 5.65% more indexing tokens and showed no retrieval gain. [Overlap results](benchmarks/LOG.md#2026-11-24--public-strategies-and-packed-chunk-overlap)

```javascript
const chunks = await chunkText('One. Two. Red. Sun. End.', myEmbedder, {
    chunkingStrategy: 'pack',
    maxChunkSize: 14,
    chunkOverlap: 4
});
// Chunk texts: "One. Two. Red." and "Red. Sun. End."
```

With `auto`, the legacy option `combineChunks: false` keeps individual sentences in text and HTML or parser units in Markdown. Explicit strategies take precedence. A positive overlap requires `pack` or `auto` with combining enabled.

### Names in other libraries

**LangGraph** orchestrates the retrieval workflow and leaves the splitter to the application. Its RAG tutorial imports LangChain's `RecursiveCharacterTextSplitter`, which tries separators in order. You can also index semachunk's output in a LangGraph application. LangChain's experimental `SemanticChunker` finds breakpoints between sentence windows. Semachunk's `semantic` ranks adjacent pairs for merging. [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview) · [LangGraph RAG tutorial](https://docs.langchain.com/oss/python/langgraph/agentic-rag) · [LangChain splitters](https://docs.langchain.com/oss/python/langchain/chunking)

**Mastra** exposes nine named strategies. Its `sentence` is closest to `pack`, though Mastra splits an oversized sentence at words by default and semachunk preserves it unless a token cap requires splitting. Mastra's `markdown` can split on configured headings and `semantic-markdown` can join small sibling or parent sections. Semachunk's Markdown strategies preserve sections, and `semantic` scores neighboring prose within each section. Mastra's `html` can attach heading metadata. Semachunk's basic HTML input extracts block text. [Mastra chunk strategies](https://mastra.ai/reference/rag/chunk) · [Tested examples](benchmarks/LOG.md#2026-11-25--mastra-splitter-behavior-and-code-reuse)

Mastra's `character` splits on one separator, `recursive` tries separators in order, `token` produces token windows and `json` splits a JSON tree. Its `latex` and default `markdown` use recursive splitting with format-specific separators. Semachunk's `maxChunkTokens` caps the embedding input for any strategy. [Mastra splitter implementations](https://github.com/mastra-ai/mastra/tree/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers)

Check the unit when transferring a size setting. Unstructured calls element packing `basic` or `by_title` and defaults to a hard ceiling of 500 characters per chunk. LlamaIndex's `SentenceSplitter` defaults to 1,024 tokens per chunk. Haystack measures `split_length` in the chosen unit, such as words, sentences or passages. Bedrock also uses the option name `chunkingStrategy`. [Unstructured strategies](https://docs.unstructured.io/open-source/core-functionality/chunking) · [LlamaIndex SentenceSplitter](https://developers.llamaindex.ai/python/framework-api-reference/node_parsers/sentence_splitter/) · [Haystack DocumentSplitter](https://docs.haystack.deepset.ai/docs/documentsplitter) · [Bedrock strategies](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_ChunkingConfiguration.html)

### Chunking algorithms

- **Batched priority merging** is the default for text and HTML with an embedding callback. It ranks eligible adjacent chunk pairs across the document by cosine similarity. Each pass merges the strongest disjoint pairs, then re-embeds changed chunks in batches to update neighboring scores.
- **Document-relative cutoff** takes the mean cosine similarity of eligible original neighbors, subtracts half the standard deviation, and uses that threshold throughout the document.
- **Markdown block splitting** uses `mdast-util-from-markdown` to identify sections, code and tables. Oversized lists split by item and tables by row.
- **JSON record splitting** uses `jsonc-parser` to find source spans. Each top-level array item starts its own record. Oversized containers split at field or item boundaries.
- **Section-aware greedy packing** appends consecutive Markdown prose from the same section while it fits. When overlap is requested, it carries a fitting suffix of whole units into the next chunk. [Docling’s peer merging](https://docling-project.github.io/docling/concepts/chunking/#hybrid-chunker)
- **Original-boundary merging** scores adjacent Markdown prose units once, as in Aurelio’s `semantic-chunkers`, and reuses those scores to rank pairs in later passes. Semachunk implements the same-section prose check in JavaScript, inspired by LightRAG Java. [LightRAG Java merge checks](https://github.com/dargoner/lightrag-java/blob/af70d08df7fd7fb2b6d979321f05008d9c250305/lightrag-core/src/main/java/io/github/lightrag/indexing/SemanticChunkRefiner.java#L162-L173)

## Installation

```bash
npm install semachunk
```

A normal install supports plain text, Markdown, HTML and JSON. The optional parsers load on demand. Plain-text-only deployments can skip them with `npm install semachunk --omit=optional`.

## Usage

For text chunks alone, call `await chunkText(text)` or pass options directly, for example `await chunkText(markdown, { inputFormat: 'markdown' })`. Supply an embedding callback for the `semantic` strategy or to return vectors. This example uses the optional `openai` SDK and an `OPENAI_API_KEY`.

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

The callback receives distinct texts in batches. Use `maxEmbeddingBatchSize` to limit the number of texts in one provider request. It applies to sentence scoring, intermediate merges and final output. Requests are balanced within each stage. When embeddings are requested, chunks that can no longer fit beside either neighbor can share spare slots in a merge-scoring batch, using their final prefix. A single-item call is still possible when only one new vector is ready or one final output remains.

Return one nonempty vector per text in the same order. All vectors in a `chunkText` call must have the same dimension and contain finite numbers. Numeric arrays and numeric typed arrays are supported. Repeated text reuses its cached embedding within a call, and each returned chunk owns its vector. Empty or fully filtered input returns `[]` without calling the provider.

For large documents, `maxCachedEmbeddings` limits how many vectors the cache retains between stages. Active scoring vectors, the current batch and requested output still need memory. A finite limit can re-embed evicted texts and skips prefetching final vectors. The default caches each distinct provider input for the full call.

Input is plain text by default. Strings such as `Array<T>` and `&amp;` stay literal. Blank lines, Markdown headings and new bulleted or numbered items start separate units. A single line break inside prose wraps the same unit. For HTML, pass `inputFormat: 'html'`. Headings, paragraphs, list items and other blocks start separate units, inline tags preserve word continuity, and entities are decoded. The chunker normalizes whitespace inside each unit. Related units can subsequently merge.

### Using Casai for retrieval

Pass your application's embedding model to Casai's `create.Embedder`. For Markdown, `chunkText` embeds the passages in batches and returns a vector and citation metadata for each. [Casai retrieval guide](https://casai.run/posts/retrieval-to-grounded-answers/)

```javascript
import { create } from 'casai';
import { chunkText } from 'semachunk';

const embedder = create.Embedder({ model: embeddingModel });
const chunks = await chunkText(markdown, async texts => (await embedder(texts)).embeddings, {
    inputFormat: 'markdown'
});
```

Index each `chunk.embedding` directly. Keep the document URL or ID, `text`, `headingPath` and `sourceRanges` on the corresponding passage record. When reranking retrieved passages with Casai, pass their texts in order and use each result's `originalIndex` to recover the passage and its citation.

Splitting CSV on newlines loses the header from later chunks and can split quoted multiline cells. Parse the file upstream, then index row objects keyed by column name or convert the rows to a Markdown table. The Markdown splitter repeats the header on each group of rows that fits with it under the hard token cap.

### JSON

Use `await chunkText(source, { inputFormat: 'json' })` for a serialized JSON document. Each item of a root array is a separate record. Any other root starts as one record. Fitting records stay whole. Oversized containers split into their fields or array items. Each excerpt carries a `jsonPointer` and half-open `sourceRanges` into the original input. Both indentation and escape spellings count toward the character target.

An individual string can exceed the 1,024-unit soft target. For article-length text, store paragraphs as separate records or set `maxChunkTokens` with the embedding model's tokenizer. A finite cap also splits large scalar values while keeping Unicode code points and JSON escapes intact. Set `maxChunkSize: 0` to address every scalar and empty container individually. [Long-field retrieval results](benchmarks/LOG.md#2026-11-25--token-sizing-and-json-field-retrieval)

### Markdown

Pass `inputFormat: 'markdown'` to preserve spelling, whitespace, tables, code and the heading hierarchy. Joins use the exact intervening source within one section. A thematic break or skipped definition ends a run. Tables and code have their own chunks. Set `chunkingStrategy: 'blocks'` to return the initial units.

The Markdown parser builds the syntax tree for the whole input before producing chunks. For large files, parsing contributes to both latency and peak memory. [Large-document timings](benchmarks/README.md#run-the-large-document-benchmark)

Markdown semantic merging defaults to the document's mean eligible cosine minus half its population standard deviation. With fewer than two eligible boundaries it uses `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` or `mergeThresholdMode: 'fixed'` selects a fixed cutoff. The priority pass limits apply during scoring. `returnEmbedding: false` skips final embeddings. Semantic scoring can still call the embedder. With `blocks` or `pack` and `returnEmbedding: false`, chunking makes zero embedding calls.

Each Markdown result has a `sectionId` (heading offset, or `null` in the preamble), a `headingPath` of visible titles, and `sourceRanges`. For each `{ start, end, outputStart }`, the input slice from `start` to `end` appears verbatim at `outputStart` in the returned text. Offsets count UTF-16 code units. Repeated table headers map to the same input. Generated continuation markers and visible caller prefixes occupy gaps in the mapping. A hidden caller prefix is included in `embeddingText`, the exact string for external indexing.

Closed leading YAML, link definitions, standalone HTML comments, whitespace-only paragraphs and empty sections are omitted. Inline HTML, reference links and footnotes keep their spelling for display with the original document. The first body carries its consecutive headings when the hard token budget permits. The character target guides splits by sentence, item, child block or table row. Code stays intact until a hard token cap requires line splitting. If a complete table row or a fence wrapper cannot fit, source fragments preserve the material within the cap.

### Converting HTML, LaTeX and PDF

Use `inputFormat: 'html'` when you want the readable text from an HTML fragment. For a web article whose headings, link destinations, lists, code or tables matter, select the article body and convert it to Markdown first. For example, install `node-html-markdown` in the ingestion application and pass the result directly to `chunkText`. [HTML converter](https://github.com/crosstype/node-html-markdown) · [Conversion checks](benchmarks/LOG.md#2026-11-25--converting-inputs-to-markdown)

```javascript
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { chunkText } from 'semachunk';

const markdown = NodeHtmlMarkdown.translate(articleHtml);
const chunks = await chunkText(markdown, embedBatch, { inputFormat: 'markdown' });
```

For LaTeX, an ingestion pipeline can use Pandoc to produce Markdown. For PDFs, use a layout-aware extractor such as Docling, with OCR for scans. The returned `sourceRanges` address the Markdown passed to semachunk. For citations into the original, keep the source URL and heading IDs or PDF page references alongside the converted sections. [Pandoc formats](https://pandoc.org/MANUAL.html#specifying-formats) · [Docling document model](https://docling-project.github.io/docling/concepts/docling_document/)

### Fitting an embedding model’s input

Use `maxChunkSize` alone when approximate passage length is sufficient. The token count at the same character target varies with the language, content and model. For a hard per-input cap, supply the embedding model's tokenizer via `countTokens(text)`, including any special tokens the provider counts. Semachunk checks both raw and prefixed text. Oversized sentences split at word boundaries where possible, then at Unicode code points. A code point or JSON escape that cannot fit with the prefix raises a `RangeError`. The example below uses only a 256-token cap. Omitting `maxChunkSize` keeps the default character target as an additional limit. [Measured token counts](benchmarks/LOG.md#2026-11-25--token-sizing-and-json-field-retrieval)

```javascript
const chunks = await chunkText(text, myEmbedder, {
    maxChunkSize: Infinity,
    maxChunkTokens: 256,
    countTokens: text => tokenizer.encode(text).length // For a tokenizer that returns token IDs.
});
```

### Choosing a similarity threshold

For semantic merging of text and HTML, the default cutoff is a cosine similarity of **at least 0.05** between adjacent chunks. Set `similarityThreshold` to choose another cutoff. An explicit `combineChunksSimilarityThreshold` takes precedence.

We selected 0.05 on plain text using `text-embedding-3-small` and a 500-character target per chunk. We searched the same index with budgets of 256, 512 and 1,024 tokens of retrieved text per question. On 553 held-out questions, the share that received all annotated evidence rose by 2.89, 4.77 and 7.23 percentage points over 0.5 at those budgets, with equal weight per task. Papers gained the most. Contracts favored 0.5 at every budget. Building the 0.05 index used 52% more embedding tokens and stored about half as many chunks. [Cutoff study and greedy packing comparison](benchmarks/LOG.md#2026-11-24--ordinary-merge-cutoff-by-retrieval-budget)

Set `mergeThresholdMode: 'document'` to derive one priority cutoff from the original size-eligible adjacent sentence pairs. It uses their mean cosine minus half their population standard deviation, reusing the first scoring batch. Later rounds use that same cutoff. With fewer than two eligible pairs it falls back to `similarityThreshold`. An explicit `combineChunksSimilarityThreshold` selects a fixed cutoff in either mode. On 1,255 confirmation questions at the 500-character target, document calibration used 14% fewer indexing tokens than fixed 0.05 and recovered complete evidence 43.90% versus 48.34% of the time, averaged across tasks and retrieval budgets. [Cutoff comparison and retrieval costs](benchmarks/LOG.md#2026-11-24--reviewing-the-remaining-merge-algorithms)

## Configuration

Character size and merge counts accept nonnegative safe integers or `Infinity`. Zero disables joins for `maxChunkSize`, priority passes for either pass limit, priority merges for `maxMergesPerPass`, and the soft minimum for `uncappedCandidateMerges`. The embedding batch size and token limit accept positive safe integers or `Infinity`. Cosine cutoffs must be finite.

| Option | Default | Description |
|---|---|---|
| `inputFormat` | `'text'` | Split plain text, extract text from `'html'`, preserve sections in `'markdown'`, or split records in `'json'`. |
| `chunkingStrategy` | `'auto'` | Select `'blocks'`, `'pack'` or `'semantic'` explicitly, or let `'auto'` choose. |
| `chunkOverlap` | 0 | Maximum packed suffix to repeat, in tokens with a finite token limit or UTF-16 code units otherwise. Accepts a nonnegative safe integer. |
| `locale` | `'en'` | Language tag passed to the sentence segmenter. Its English and Spanish abbreviation lists use `en` and `es`. |
| `maxChunkSize` | 1,024 in Markdown and JSON, 500 in text and HTML | Soft per-chunk target in UTF-16 code units, including source or join separators. A single sentence, protected block or JSON scalar can exceed it. The caller prefix is excluded. |
| `maxChunkTokens` | `Infinity` | Hard model-token budget for each chunk and provider input, including any prefix. A finite value enables splitting oversized sentences. |
| `countTokens` | — | Synchronous tokenizer callback required for a finite token budget. Returns a nonnegative safe integer. |
| `maxEmbeddingBatchSize` | `Infinity` | Maximum distinct texts per provider request. Use a positive integer to set a limit. |
| `maxCachedEmbeddings` | `Infinity` | Maximum cached vectors between stages, in insertion order. Zero disables reuse between stages. |
| `similarityThreshold` | 0.05 for fixed text and HTML merges, 0.5 for document calibration or Markdown | Fixed-mode minimum cosine. In document mode it applies only with fewer than two eligible original boundaries. Greedy Markdown packing uses no cutoff. To set a fixed Markdown cutoff directly, pass e.g. `combineChunksSimilarityThreshold: 0.7`. |
| `combineChunks` | `true` | In `'auto'`, set to `false` to keep initial Markdown units or individual text and HTML sentences. |
| `combineChunksSimilarityThreshold` | `similarityThreshold` in fixed mode | Supply a fixed priority cutoff, overriding document calibration and the base cutoff. |
| `mergeThresholdMode` | `'fixed'` for text and HTML, `'document'` for Markdown | Use a fixed priority cutoff or calibrate once per document from its original eligible neighbors. |
| `excludeNonLetterSentences` | `false` | Skip sentences containing no Unicode letters before embedding |
| `maxUncappedPasses` | `100` | Maximum number of passes that exhaust the available disjoint merges. A pass that defers an eligible disjoint pair because of a cap is exempt. |
| `maxPasses` | `Infinity` | Total priority rounds, including capped rounds. Final indexing and splitting requests to respect `maxEmbeddingBatchSize` can add provider calls. |
| `maxMergesPerPass` | `500` | Absolute limit on the number of merges per pass. |
| `candidateMergesPercentageCap` | `40` | Percentage from 0 through 100, including fractions. The per-pass count is rounded down before applying the soft minimum and absolute limit. The canonical spelling takes precedence over the legacy `candiateMergesPercentageCap`. |
| `uncappedCandidateMerges` | `12` | Soft-minimum number of merges per pass (overrides percentage cap) |
| `returnEmbedding` | `true` with a callback, otherwise `false` | Include an embedding for each output chunk. |
| `chunkPrefix` | `''` | Prefix added to the final chunk text and included in its returned embedding |
| `excludeChunkPrefixInResults` | `false` | Return the original chunk text while embedding the prefixed text |

# Acknowledgements

This project is derived from `jparkerweb`'s semantic-chunking library. [Upstream project](https://github.com/jparkerweb/semantic-chunking)

- Lightweight dependencies for sentence splitting and HTML extraction
- Stripped down to the core functionality
- Model Agnostic
- Batch Embeddings for Efficiency and handling API Rate Limiting
- New optimized chunk merging algorithm
