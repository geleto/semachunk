# Running the chunking benchmarks

The quality suite scores short-answer retrieval and editorial boundaries. The RAG suite searches complete contracts, research papers and collections of related and distracting passages. The Node performance suite measures batching and library time on large documents. Each run writes a new JSON file under `benchmarks/results/`. [Results and change log](LOG.md)

## Run the quality suite

Use Node 20.12 or newer. WikiSection and QASPER also use the system `tar` command on PATH to read their published archives. Set `OPENAI_API_KEY` in your environment or in the repository's Git-ignored `.env`. To read the key directly from another project, pass `--env-file path/to/.env` after npm's argument separator. The runner reads only `OPENAI_API_KEY` from that file. From the repository root run

```sh
npm ci
npm test
npm run benchmark
```

On a cold run the benchmark verifies the pinned public datasets and sends candidate passages and questions to the OpenAI embeddings API. Each completed batch is cached with a checksum under `benchmarks/.cache/openai-embeddings/`. Replaying the same inputs works offline once the datasets and all batches are cached. The API client and tokenizer are development dependencies. Unit tests and the synthetic performance benchmarks use local fixtures.

To score another checkout with its own JavaScript dependencies installed, use the same harness and cache. The output path must be new.

```sh
npm run benchmark -- --implementation ../semachunk-reference --output benchmarks/results/reference.json
```

### Retrieval with SQuAD 1.1

The suite takes every third article of the public development set and the first eight paragraphs of each selected article. It alternates articles between calibration and held-out evaluation, with eight articles per split. Every question needs at least one annotation that matches the original passage at its stated offset. Each query searches all chunks from all eight articles in its split. [SQuAD data and authors](https://rajpurkar.github.io/SQuAD-explorer/)

Chunks are ranked by OpenAI embedding cosine similarity, with source order breaking ties. A hit requires one retrieved chunk to contain a complete annotated answer span at the correct source position. Each query gets 256 `cl100k_base` tokens. A clipped chunk contributes only its visible prefix, ending at the last complete Unicode character. The report records hits, question count and hits in the first chunk. The official SQuAD task evaluates generated answers.

### Topic boundaries with WikiSection

The suite uses the English city corpus. From each official validation and test partition it takes eight complete articles at indices `floor(i × partitionSize / 8)` for `i = 0…7`. The validation articles serve as calibration. Section headings supply the reference offsets and are excluded from the input. Both source annotations and chunk boundaries are aligned to the chunker's sentence text after whitespace normalization. [WikiSection dataset and authors](https://github.com/sebastianarnold/WikiSection)

Exact boundary precision, recall and F1 pool counts across articles in each split. Document endpoints are excluded. Word-based WindowDiff compares how many boundaries fall between words `i` and `i+k`, with `k` equal to half the mean reference section length, rounded to the nearest word (minimum one). The report averages the error rate across articles. Higher F1 and lower WindowDiff are better. A size limit can force cuts inside a long editorial section, so compare semantic merging with packing at the same size. [WindowDiff definition](https://aclanthology.org/J02-1002/)

### Settings, costs and repeatability

- The priority-merge grid crosses maximum sizes of 250, 500 and 1,000 UTF-16 code units with cosine cutoffs of 0.3, 0.4, 0.5, 0.6, 0.7 and a per-document cutoff. Each task selects its own setting on calibration, maximizing answer hits or exact boundary F1. Ties favor fewer indexed chunks, then the first setting in the listed grid order. Held-out results are reported for every setting.
- Comparisons include one sentence per chunk, greedy sentence packing at all three sizes, adaptive grouping alone and with priority merging at all three sizes, and both grouping modes with a fixed 0.5 cutoff at size 500.
- All methods use `text-embedding-3-small` at its full 1,536 dimensions. The runner precomputes the union of contiguous chunks up to the largest candidate size, individual long sentences and queries. It sends up to 256 inputs per request, checks the 8,192-token input limit and the 300,000-token request limit, and preserves the provider's row indices. [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings) · [API limits](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
- The runner imports the checkout's `chunkText` directly. Costs count its actual provider calls, input texts and single-item calls, including final indexing. Greedy packing makes one indexing call per document. Offline precomputation and query encoding are excluded from these counts.
- Each report records the embedding model, tokenizer, dimensions, sample IDs and hashes of the ordered inputs and vector bytes. Per-dataset `precomputation` records successful live requests, inputs, API-reported input tokens and batches read from cache. Compare vector hashes when reproducing a run. Older reports record their original model and token budgets.
- Both quality datasets use English Wikipedia and a single embedding model. Small differences can depend on the articles, context budget and retriever. The reports retain per-split sample identities, raw counts, settings, runtime versions, and hashes of the implementation, scoring harness, assets and vectors.

## Run the RAG evidence benchmark

After `npm ci`, run

```sh
npm run benchmark:rag
```

To run one dataset, use `npm run benchmark:rag -- --task cuad` with a task name of `cuad`, `qasper` or `hotpotqa`. The three pinned data files total about 72 MB. CUAD and HotpotQA use checksummed JSON mirrors of the original splits. A cache from the ZIP/Parquet loader needs one download per changed dataset. The sample IDs, texts and gold evidence are identical. Each report records sample IDs, lengths in `cl100k_base` tokens, exclusions, indexing costs and source ranges for example queries.

Use `--methods merge-500-0.5 merge-500-document` to run selected policies alongside the token window. For an older implementation, select settings it supports. Include `flat-merge-500-0.5` to compare its normal input with a flattened control on a shared vector matrix.

| Task | What the retriever can search | What constitutes complete evidence |
|---|---|---|
| CUAD | One full commercial contract per query, sampled at eight evenly spaced indices of the official test set. | All highlighted clause spans for an answerable clause-review question. The report counts questions with no annotated clause separately. [CUAD authors and data](https://www.atticusprojectai.org/cuad/) |
| QASPER | One full paper per query, sampled at 16 evenly spaced indices of the official test set. Input includes the title, abstract, section headings, paragraphs and available captions. | All annotated paragraphs from any one answerer. An annotation that requires a figure or lacks uniquely mappable text is excluded as a whole. Questions without a usable textual reference are counted. [QASPER paper](https://aclanthology.org/2021.naacl-main.365/) · [Authors’ dataset](https://huggingface.co/datasets/allenai/qasper) |
| HotpotQA, distractors | A question's ten supplied Wikipedia passages, with the title at the start of each passage. We take 32 bridge and 32 comparison questions at evenly spaced indices within their validation categories. | Every annotated supporting sentence from both source articles. [HotpotQA dataset and evaluation](https://hotpotqa.github.io/) |
| HotpotQA, pooled search | All distinct passages from those same 64 cases in one index. Each question searches the entire index with the same ranking rules and evidence labels. | The same supporting sentences. This is a local pooled-corpus experiment. The official full-wiki task searches a much larger collection. |

The suite crosses twelve chunking methods with two rankers. It compares single sentences, greedy packing to 500 UTF-16 units, priority merging at 250/0.5 and 500/0.3, 0.5 and 0.7, initial grouping plus priority at 500/0.5, and 128-token windows with a 32-token overlap. Window edges move to complete Unicode characters if necessary. Four additional size-500 configurations measure a flattened-input control, the document-relative cutoff, a strict 256-token chunk budget, and a ceiling of two priority passes.

CUAD passes the original contract whitespace to the chunker. QASPER supplies headings, paragraphs and captions as blocks. HotpotQA separates article titles from passage bodies. The flat control receives the same words and labels with whitespace normalized. All methods share the vectors for identical strings. One `cl100k_base` tokenizer supplies the synchronous chunk budget and source offsets. The dense ranker uses OpenAI cosine similarity. BM25 uses lowercased Unicode word counts and document frequencies over the query's pool, with `k1=1.2` and `b=0.75`. Both break ties by source order.

Each ranked context gets **256, 512 or 1,024 source tokens** from the document's `cl100k_base` encoding. A standalone separator token between adjacent chunks is charged to the following chunk. The last chunk is clipped to the remaining budget. Overlapping windows spend budget again for repeated tokens. A gold token earns credit once, at its actual position in its source document. Evidence split over multiple retrieved chunks counts toward the same answer.

For a disjoint chunking policy, the scorer checks that every source token belongs to exactly one chunk. It reports an error if an implementation cuts through a token shared by two chunks. All sampled source documents passed this check.

- **Evidence recall** is the fraction of annotated evidence tokens delivered, averaged over questions. **Context precision** is the number of distinct gold tokens delivered divided by all delivered tokens, also averaged over questions. With multiple answerers, the scorer chooses one answerer's reference by highest recall and breaks ties by precision.
- **Complete** counts questions for which the context contains every token of a valid reference. **Budget feasible** counts questions where at least one reference could fit if every selected token were useful. Whole-paragraph requirements can make complete coverage difficult even when a reader could infer the answer from a shorter excerpt.
- The examples include the governing-law query in the longest sampled contract that has one, the first paper question requiring multiple annotated paragraphs from every answerer, and the first bridge and comparison questions. Their logged document indices and half-open token ranges show what the default dense retriever actually delivered.
- The provider counts describe building the chunk index with output embeddings. BM25 reuses the same chunk text for lexical ranking. The overlapping-window baseline models one dense indexing batch per document.

Retrieval benchmarks such as BEIR also use rank-based metrics including nDCG and Recall@k. A token budget makes comparisons across chunk sizes meaningful here. LegalBench-RAG measures overlap with cited source spans. End-to-end benchmarks such as RAGBench additionally evaluate how faithfully a generated response uses the supplied context. This suite measures the evidence a generator would receive. [BEIR evaluation](https://github.com/beir-cellar/beir) · [LegalBench-RAG](https://github.com/zeroentropy-ai/legalbenchrag) · [RAGBench metrics](https://arxiv.org/html/2407.11005v2)

## Compare Markdown retrieval

The Markdown study uses fresh group-disjoint samples, checked against the source and annotation hashes in the frozen manifest. It selects the common body budget on plain sentence packing, then compares section-aware packing with fixed-boundary and rescored merges. The next run measures context on the selected bodies. The final run evaluates the frozen shortlist alongside the plain-text defaults, matched token controls and overlapping windows.

```sh
node benchmarks/markdown-study.mjs size size.json
node benchmarks/markdown-study.mjs compare comparison.json size.json
node benchmarks/markdown-study.mjs context context.json comparison.json
node benchmarks/markdown-study.mjs final final.json context.json
node benchmarks/markdown-study.mjs confirm confirmation.json final.json fixed-document
node benchmarks/markdown-study.mjs context fixed-context.json comparison.json fixed-document
```

Each command takes a new output path. The study uses the same model, tokenizer, credentials and provider limits as the historical RAG suite. It records the literal inputs alongside each checksummed vector batch and verifies the model, dimension and input order against the batch key on replay. Different merge orders and batch compositions can reuse individual texts. Logical cold indexing costs count each policy's own calls, including singleton batches and repeated scoring inputs. Provider usage records paid cache misses separately. Peak RSS is the process high-water mark through that measurement. Timing includes retrieval, replay and any API calls.

The confirmation command evaluates the already-selected original-boundary strategy at both the public character setting and the matched token setting on a third, group-disjoint sample. The final context command reuses its calibration bodies for the predeclared heading comparison.

To reproduce the automatic policy comparison, run calibration first and pass its report to the independent fourth split.

```sh
node benchmarks/markdown-study.mjs rules rules.json
node benchmarks/markdown-study.mjs validate-rules rule-validation.json rules.json
node benchmarks/markdown-study.mjs replicate-rules rule-replication.json rules.json
```

The six primary settings are 500, 1,024 and 2,048 characters and 128, 256 and 512 tokens. The runner scores the actual document layouts selected by each rule, including mixed-policy HotpotQA pools. Budget-only rules reuse the corresponding full-policy measurement at each setting. The JSON grid identifies those measurements. Bootstrap draws keep a question's outcomes across all six settings in the same independent group. Both validation reports also include two mixed-cap diagnostics. The larger replication uses the frozen shortlist, report-disjoint FinQA test data and four independent 32-question multi-hop pools.

In a six-setting comparison, a question counts as a win if the rule recovered its complete evidence at more settings than the control. The paired difference and interval use the magnitude of each question's change.

The external comparison runs the public API, reference recursive splitters, sentence packing and overlapping token windows on the same 676 questions. It reports dense, BM25 and hybrid retrieval. Install the pinned reference implementation in the ignored benchmark cache and pass a new output path.

```sh
npm install --prefix benchmarks/.cache/reference --no-save --package-lock=false --ignore-scripts @langchain/textsplitters@1.0.2 @langchain/core@1.5.0
node --max-old-space-size=6144 benchmarks/markdown-study.mjs baselines retrieval-baselines.json
```

All arms search the same sources. QASPER uses the paper's heading hierarchy. FinQA includes pre-table prose, the table and post-table prose with offsets keyed by the annotation IDs. A financial hit requires every annotated row and prose span. The primary score averages the four dataset complete-evidence rates at 512 delivered tokens with pooled HotpotQA. The diagnostic shortlist searches each question's supplied articles. Each report also records scores at 256 and 1,024 delivered tokens, per-question outcomes at 512 tokens and paired group bootstrap intervals. [Frozen sample IDs](results/2026-11-23-markdown-samples.json)

## Run the large-document benchmark

Run `node benchmarks/markdown-performance.mjs` for the public Markdown entry point. An optional output path saves a new JSON report. A second argument sets the character target, for example `node benchmarks/markdown-performance.mjs performance.json 1024`. Each workload runs in its own process with one warmup and three timed iterations. The inputs include repeated and unique paragraphs, fenced code and tables in either one long section or 2,048 short sections.

```sh
npm run benchmark:merge
npm run benchmark:merge -- --compare ../semachunk-reference --output benchmarks/results/merge-comparison.json
```

This benchmark runs the public API on 2,048 and 16,384 unique sentences with eight-dimensional vectors and on 4,096 sentences with dense 384-dimensional vectors. One workload changes topic every eight sentences and another changes topic at every sentence. Deterministic topic vectors make provider latency negligible. Each case records seven timed runs after warm-up, their median, provider call and input counts, and a checksum of the output boundaries. With a reference checkout, the runner alternates implementation order. Run it on an idle machine and compare medians for each workload.

## Measure embedding cache memory

`npm run benchmark:memory` compares the default cache with a 256-vector cache on 4,096 sentences and 1,536-dimensional Float32 embeddings. Each policy runs in its own Node process. The report records live ArrayBuffer bytes above baseline after garbage collection at provider entry, the number of texts embedded and the output boundary checksum. These samples measure vector storage between batches. Allocations inside a batch and other JavaScript heap objects also contribute to process memory.
