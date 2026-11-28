# Chunked documents and citations

`chunk(text, options?)` returns a single document with its hierarchy, passages and source citations. Both `blocks` and `pack` return one layout. One `semantic` call prepares the structural and similarity-based layouts. The index searches both and returns one ranked list. [Public API and retrieval](../README.md#search-and-citations)

```js
import { chunk, search } from 'semachunk';

const options = {format:'markdown', strategy:'semantic', embedBatch, index:true, returnEmbedding:false};
const guide = await chunk(markdown, {...options, sourceId:'guide@3'});
const [hit] = await search(guide, question);
const notes = await chunk(releaseNotes, {...options, sourceId:'release-notes'});
const hits = await search([guide, notes], questionEmbedding, {limit: 5});
```

`DocumentChunk` is one citable passage in `doc.chunks`. Each hit identifies the document by `sourceId` and its position in the input by `documentIndex`. Its `chunkIndex` addresses that document’s `chunks` array. The displayed `hit.context` has its own citation offsets. `index: true` keeps the retrieval vectors with each document for reuse and storage. `sizeUnit` selects UTF-16 characters or tokens for all size limits. Token mode requires `countTokens`, including when searching a document restored from JSON. [Public types](../src/index.d.ts) · [Defaults](../README.md#size-limits)

## Format and strategy

Plain text recognizes sections introduced by `#` through `######`, blank-line-separated paragraphs, list items and sentences. Markdown also protects units such as tables and code. HTML supplies heading, paragraph, list, table and code nodes. For richer HTML, the caller can convert an article to Markdown and select `format: 'markdown'`. JSON uses `blocks` and returns record pointers. [Supported formats](../README.md#formats) · [Shared size limits](../README.md#size-limits)

`blocks` uses the hierarchy supplied by the parser. Its name applies to paragraphs, titled sections and JSON records. `pack` takes consecutive eligible units that fit. `semantic` scores adjacent children throughout the tree and uses each weak boundary to subdivide its ancestors. Its document root can join top-level siblings. `semantic` requires `embedBatch`.

The recorded decision dropped a public `recursive` strategy and kept one literal `separator` for delimited text. Mastra’s generic `recursive` tries a blank line, a newline, a space, then individual characters. Its Markdown preset gives all six heading levels the same priority. Its separate `semantic-markdown` strategy uses section hierarchy and a token threshold to join related headings. [Recorded decision](../benchmarks/LOG.md#2026-11-25--delimited-records-and-json-plan-review) · [Mastra recursive splitter](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/character.ts#L165-L269) · [Mastra chunk reference](https://mastra.ai/reference/rag/chunk)

### Parser tree and size limits

The parser supplies ordered nodes with a rendered span, source identity and children. Markdown sections own their introductory blocks and subsections. Plain prose supplies paragraphs and sentences. A blank line starts a paragraph. A single newline inside a sentence is a soft wrap. In an oversized paragraph, a line ending at a sentence boundary or an explicit Markdown hard break provides a finer division. Basic HTML can supply heading levels and explicit section elements. JSON supplies objects, arrays and values, with each top-level array item treated as a record.

The `blocks` traversal tries the document root first. If a node is oversized, it visits the children in source order and packs adjacent whole siblings under their common parent while they fit. This includes top-level paragraphs and sections. JSON arrays preserve their individual records. A split child ends the surrounding sibling group. Format-specific leaves handle table rows, fenced code, JSON escapes and indivisible text. The returned metadata names the common parent when a passage covers multiple children.

A contiguous node gets its character length from its rendered UTF-16 end and start offsets. Normalized text has its own rendered offsets. The traversal can measure a span of siblings, including the intervening separators, without walking the descendants again. Token mode counts the actual rendered text and the prefixed embedding input when applicable. Token counts across children are not additive. The existing leaf policy handles a sentence, code fence or other unit that exceeds the soft character target, and flags a fragment that still exceeds the hard token limit.

## Citations

Each citation maps a half-open UTF-16 interval `[start, end)` in the supplied string to `[outputStart, outputEnd)` in the displayed passage. For `<p>A &amp; B</p>`, the displayed `&` in `A & B` maps input `[5, 10)` to output `[2, 3)`. Generated prefixes occupy gaps in the map. Overlap and repeated table headers cite their original spans on each appearance. Return `embeddingText` whenever the indexing string differs from the displayed text.

Carry positions through parsing, normalization, packing and semantic merging. Reuse the existing Markdown, JSON and delimited-text ranges. Plain text needs positions through whitespace normalization, and HTML needs positions through text-node and entity decoding. When a converter supplies Markdown, citations address that Markdown. A reader can map them back to original HTML anchors, PDF pages or spreadsheet cells when it retains the conversion map.

Verify that both layouts use the same original document, hierarchy and citation offsets. Exercise identical passages at different offsets, collapsed whitespace, inline HTML and entities, Unicode, hidden prefixes, overlap and token-limit splits.
