# Chunking improvements and benchmark results

## 2026-11-23 · Heading context on fixed Markdown bodies

All five calibration arms produced identical body and source-range hashes, and identical BM25 scores at every context budget. The baseline recovered complete dense evidence at 512 tokens for 52.77% of questions averaged across the four tasks. At the deployment cap of 256 tokens, titles alone added one complete paper answer (53.63% overall). Adding the heading path brought the count back to baseline. At the provider ceiling of 8,192 tokens all three means were 52.77%. The paired intervals include zero. Keep the existing caller prefix and leave automatic heading context out of the public API.

Of 1,561 chunks, 337 had extra heading or title context available. The 256-token heading arm kept it in full for 281, shortened it for 11 and omitted it for 45. At 8,192 tokens it retained all 337. The complete final shortlist is protected packing, packing with a lead-in, adaptive original-boundary scoring with and without a lead-in, and protected rescoring at 0.7. The final controls use the plain and Markdown defaults, plain packing and priority at 256 tokens, and 128/32 and 256/64 token windows. [Frozen bodies, retention counts, paired results and shortlist](results/2026-11-23-markdown-context.json)

## 2026-11-23 · Markdown combination on calibration

At 256 body tokens, protected greedy packing recovered all evidence at 512 displayed tokens in 22/86 contracts, 12/29 paper questions, 23/43 financial questions and 29/32 pooled multi-hop questions. The equal-task mean was 52.77%. The best original-boundary run used the adaptive cutoff and reached 55.96% (paired difference +3.19 per 100, 95% interval −1.52 to +7.51). Rescoring peaked at cutoff 0.7 and reached 54.89% (+2.13, −3.38 to +7.34). The respective logical costs were 358 calls and 254,784 tokens for packing, 427 and 399,205 for fixed boundaries, and 468 and 292,441 for rescoring. Sentence units under the paper headings recovered 10/29 complete references at 512 tokens, compared with 12/29 for paragraph units. [All cutoffs, cosine distributions, budgets and costs](results/2026-11-23-markdown-comparison.json)

Allowing one prose lead-in before an intact table or code block raised the original-boundary mean to 58.28%, including 31/43 FinQA hits. Its interval against greedy packing with the same lead-in rule was 0.00 to +10.51 per 100, and its interval against the corresponding protected semantic run was 0.00 to +5.30. Keep packing as the provisional release choice. The frozen shortlist also retains the strongest lead-in policy and its simpler comparators for independent evaluation. Whole-body rescoring did not earn the merge-order or window-ranking experiment.

For the FinQA debt-maturities question, both adaptive policies delivered both annotated rows. Original-boundary scoring missed all 187 characters of the required prose span. Rescoring delivered the full reference. In four other financial questions the original-boundary policy recovered complete references that rescoring missed. On the paper model-performance question, rescoring at 0.3 delivered the 351 annotated characters missing with original-boundary scoring. The inspection replay used zero paid requests. [Ranked source ranges and per-span coverage](results/2026-11-23-markdown-examples.json)

## 2026-11-23 · Retrieval protocol frozen before calibration

The fresh samples use six contracts, twelve papers, twenty-four financial reports and thirty-two multi-hop questions per split. Selection orders group IDs by seeded SHA-256. The multi-hop samples exclude historical article titles and share no titles with each other. FinQA contributes only questions requiring both complete table rows and surrounding prose. The frozen manifests identify documents and questions and hash the rendered sources, evidence and candidate pools. [Sample manifest](results/2026-11-23-markdown-samples.json)

Choose 128, 256 or 512 tokens on plain sentence packing by the equal-weight mean dense complete-evidence rate at 512 displayed tokens. Ties favor the larger body budget. Both token windows use 25% overlap. Compare greedy packing, original-boundary cosine and live-body cosine on those same Markdown units. Try 0.3, 0.5, 0.7 and the document cutoff on calibration. A more complex policy must have a positive lower endpoint in a seeded 2,000-draw paired group bootstrap and justify its indexing cost. Test a prose lead-in before an intact table or code block on each policy. Freeze bodies for the title and heading controls. The final evaluation uses the calibration shortlist and the declared controls.

The revised metric tokenizes the exact displayed strings and separators, clips at a complete character, and projects the visible text onto each source occurrence. It credits complete annotated portions of source tokens and counts a displayed token once when it contributes new evidence. For normalized text, a visible collapsed space maps to its original whitespace run. The historical source-token metric and reports retain their original definitions. The calibration query preload made one paid request for 138 distinct texts and 3,502 tokens.

The plain packing control now splits oversized seeds and recounts joins with the actual tokenizer. At 128, 256 and 512 body tokens its four-task calibration means were 45.09%, 51.81% and 51.53%. The selected **256-token** control recovered complete evidence for 22/86 CUAD, 10/29 QASPER, 27/43 FinQA and 27/32 pooled HotpotQA questions. Preparing the three sizes used 24 paid requests, 4,173 texts and 704,687 tokens. [All three budgets, per-task scores and costs](results/2026-11-23-markdown-size.json)

## 2026-11-23 · Markdown source parsing and greedy packing

The public API now packs contiguous source slices within a heading occurrence. Tables and code close a packing run. Only a split that needs repeated markup carries multiple pieces. A shared offset splitter handles hard token limits. The plain-text path still consumes normalized word separators. The Markdown path keeps them. Parser dependencies load on demand. No external splitter source was copied.

With a 500-character target and batches of at most 256 distinct texts, the long section yielded 1,025 chunks and made three final embedding calls (515 distinct texts, 17,199 tokens). Across 2,048 sections the same API yielded 2,560 chunks in seven calls (1,539 texts, 20,804 tokens). Neither case needed a singleton. Median warm times were 1.22 s and 1.38 s. Peak process RSS was 344 and 401 MiB respectively. These synthetic workloads measure parsing, packing and batching with a deterministic callback. [Raw timings, sizes and boundary checksums](results/2026-11-23-markdown-performance.json)

## 2026-11-23 · Simplified benchmark dataset loading

Removed the benchmark development dependencies `tar-stream`, `fflate` and `hyparquet`. WikiSection and QASPER read named members of their checksummed archives through the system `tar` command. CUAD and HotpotQA now download pinned JSON mirrors. CUAD's test JSON matched the bytes in the authors' ZIP. For all 7,405 HotpotQA validation rows, the JSON matched the previous Parquet source on row order, question IDs, question and answer text, question type, passage titles and sentences, and supporting facts. [Dataset loaders](corpora.mjs)

Compared the complete serialized loader output against revision `3745d3a`. All five SHA-256 hashes matched, including answer and evidence offsets, exclusions and query pools. The changed readers cover 16 WikiSection documents, 8 CUAD contracts with 100 questions, 16 QASPER papers with 54 questions, and 640 HotpotQA passages with 64 questions. This was a data-parity check. The existing retrieval scores are recorded below. [Benchmark setup](README.md)

## 2026-11-23 · OpenAI embeddings and outstanding review decisions

The live quality and RAG benchmarks now use `text-embedding-3-small` at its native 1,536 dimensions. The tests and synthetic performance workloads already have deterministic vectors, so their execution provided no reason to retain local inference. Removed the ONNX runner, model download and weights, both Hugging Face tokenizer dependencies, and the MiniLM replay option. One `cl100k_base` tokenizer supplies both counts and source positions. The model-specific historical results and hashes remain available below. [Current commands](README.md)

The five datasets required **177 successful batched requests, 44,653 inputs and 3,323,239 API-reported tokens**. At $0.02 per million input tokens, that is **$0.0665** for the two suites combined. A separate two-input authentication check used 13 tokens. These are charges estimated from usage and the published rate. Each completed batch is checksummed and cached. The provider costs for each chunking strategy in the JSON describe the calls that strategy makes to build its index. [OpenAI rate](https://developers.openai.com/api/docs/models/text-embedding-3-small) · [Quality report](results/2026-11-23-openai-quality.json) · [RAG report](results/2026-11-23-openai-rag.json)

### Retrieval results

Each RAG cell gives the number of questions with a complete reference at 256 / 512 / 1,024 source tokens. SQuAD and WikiSection use their held-out splits. The three semantic settings use a 500 UTF-16 unit size limit. Historical MiniLM runs measured context in WordPiece tokens. Both the encoder and the context tokenization changed, so these two runs cannot isolate the effect of switching encoders.

| Policy | SQuAD hits / 437 | WikiSection F1 | Contracts / 100 | Papers / 54 | Hotpot shortlist / 64 | Hotpot pooled / 64 |
|---|---:|---:|---|---|---|---|
| Fixed 0.5 | 423 | .3436 | 34 / 45 / 56 | 4 / 5 / 9 | 36 / 47 / 59 | 36 / 45 / 55 |
| Fixed 0.3 | 420 | .3922 | 34 / 43 / 54 | 6 / 12 / 22 | 35 / 50 / 59 | 35 / 48 / 54 |
| Document cutoff | 420 | .3841 | 33 / 41 / 53 | 5 / 10 / 20 | 36 / 47 / 60 | 36 / 46 / 55 |
| Greedy packing at 500 | 407 | .2609 | 25 / 39 / 53 | 7 / 12 / 21 | 42 / 52 / 60 | 42 / 51 / 58 |

The quality grid picked size 250 and cutoff 0.3 on SQuAD calibration, yielding 428 held-out hits. WikiSection calibration selected size 1,000 and cutoff 0.3, yielding .2857 held-out F1. The held-out WikiSection score at size 500 and cutoff 0.3 was .3922. The selection procedure uses calibration documents alone.

### Isolating the percentage cap and soft minimum

All four policies use 500 UTF-16 units, cutoff 0.5 and the same absolute cap of 500 merges per pass. Each row changes one setting from the first row. Replaying all five cached OpenAI matrices reproduced the control scores and required zero API requests. Provider columns give calls / single-item calls for indexing. [Full cap comparison](results/2026-11-23-openai-caps.json)

| Eligible boundary percentage / soft minimum | SQuAD hits | Contracts complete at 512 | Contract calls | Paper calls | Hotpot calls | Pooled Hotpot complete at 256 |
|---|---:|---:|---|---|---|---:|
| 40% / 12 | 423 | 45 | 36 / 5 | 85 / 5 | 1,487 / 617 | 36 |
| 100% / 12 | 423 | 44 | 25 / 2 | 59 / 5 | 1,487 / 617 | 36 |
| 40% / 1 | 421 | 45 | 68 / 31 | 163 / 57 | 1,721 / 1,045 | 36 |
| 40% / 0 | 425 | 46 | 53 / 16 | 129 / 27 | 825 / 167 | 35 |

On these contracts and papers, allowing 100% is a better choice when sequential API calls matter most. Lowering the floor to one made singleton requests much more frequent. With a zero floor and 40%, one or two eligible pairs produce a zero merge allowance, which can end a short document's merge early. This helps explain the zero-floor result on HotpotQA.

### Review decisions

| Finding or proposal | Decision and reason |
|---|---|
| Exact decimal arithmetic and one-ULP heuristic tests | **Accepted.** Deleted the BigInt helper and tests for adjacent float representations. Ordinary cosine cutoffs are inclusive. JavaScript evaluates `375 * 18.4 / 100` just below 69, so the fractional cap uses a small allowance at the integer floor. |
| Overflow handling and repeated normalization | **Accepted the repeated-work finding. Kept support for finite extreme vectors.** A live scoring node reuses its normalization factors. The rare scaled path preserves the existing finite-vector contract. Normalizing returned embeddings in place would change the provider values, and caching a second full vector would use more memory. |
| Remove final-vector piggybacking | **Declined.** Filling spare capacity eliminated 170 singleton requests on the 16,384-sentence tight-cap workload. These are guaranteed final texts and add no scoring request. Bounded-cache mode skips prefetch because an eviction could waste the work. |
| Remove initial grouping and the centroid | **Declined as a blanket removal.** Grouping is opt-in. On OpenAI pooled HotpotQA at 256 tokens it raised complete references from 36 to 37 while reducing provider calls from 1,487 to 1,336. The earlier centroid-only ablation also changed boundaries and lost one pooled BM25 completion when removed. These are small, workload-dependent effects. |
| Weak adaptive grouping bands and shared cutoffs | **Agree with the limitation. Deferred replacing the heuristic.** Its bands are discontinuous, its mean adjustment can amplify scale differences, and 26 of 32 documents in the original diagnostic kept the same cutoff. Lower and upper bounds can be set equal for fixed grouping. The priority stage has its own explicit override. A replacement grouping rule needs its own ablation because groups stay merged. |
| Fixed 0.5, model dependence, proposed document cutoff and optional floor | **Accepted document calibration as an option. Declined a universal default change.** The original fixed 0.3 result held for a particular dense complete-evidence metric. On OpenAI, the paper and contract outcomes above favor different settings. The document rule estimates the mean minus half a standard deviation from eligible original neighbors. An additional absolute floor is deferred until it demonstrates a benefit across providers. |
| Cosine drifts with chunk length, proposed length penalty | **Agree with the observation. Declined the proposed general penalty.** Some diagnostic pairs exceeded the production size limit. In the separate MiniLM ablation, the eligibility penalty changed SQuAD hits from 409 to 415 and left all four 256-token RAG complete counts unchanged. Applying it only to queue order changed one such count by one. This does not establish a universal slope. |
| Force short fragments to merge, or increase the default maximum size | **Declined both default changes.** The 100-unit override cut CUAD chunks from 1,176 to 706 but increased embedded inputs from 1,594 to 2,064 and lost two held-out SQuAD hits. The new packing results show that larger contexts help some tasks and hurt others. |
| Discarded structure and oversized sentences | **Accepted.** Blank lines, marked headings, list items and HTML blocks delimit initial units. The token limit splits long units and checks the actual provider input. A single wrapped prose line can continue its paragraph. A separate cross-paragraph merge penalty is deferred because the structure comparison did not test one. |
| Cache memory, Float32 storage and eviction of merged texts | **Accepted bounding retention. Declined converting every returned vector.** Typed inputs preserve their width. Optional eviction reduced sampled live vector buffers from 45.0 to 18.1 MiB with one extra batched request. Eager eviction by default could re-embed recurring text. Narrowing arbitrary caller-supplied vectors would change their values or type. |
| Unbounded rounds and sequential provider sub-batches | **Accepted a total-round limit. Deferred concurrent callbacks.** On OpenAI papers, two rounds reduced calls from 85 to 48 and complete references at 256 tokens from four to three. Later rounds depend on the preceding results. Concurrency within a round would need an opt-in contract for providers with rate limits or reusable response buffers. |
| Percentage counts overlapping candidates, soft minimum depends on document length | **Agree with both observations. Declined removing the controls.** Counting disjoint pairs first would change existing settings. The OpenAI comparison above favors 100% for lower call counts on papers and contracts. Keeping the controls preserves tuning and compatibility. The floor of 12 reduced paper singletons from 57 to five compared with a floor of one. `maxPasses` supplies a total budget. |
| Wider context predicts section breaks, proposed lookahead | **Declined the merge rule.** In the matched sample two sentences per side improved classification of the central boundary. That result supplies no evidence for joining A and B because A resembles C. The library compares the two adjacent chunks it actually joins, as requested. |
| Token limits, locale, optional HTML parser | **Accepted all three.** The public API provides `maxChunkTokens`, `countTokens` and `locale`. Plain-text use works when the optional `parse5` dependency is omitted. |
| Return original source offsets | **Deferred.** Whitespace normalization, inserted separators, prefixes and HTML entity decoding can give a chunk multiple original source ranges. The benchmark maps its own annotations. A public result needs a defined raw-text and HTML coordinate contract. |
| Browser support and synchronous package metadata read | **Accepted lazy loading of version metadata. Deferred browser support.** This project targets Node and the segmenter still uses Node module loading. Removed browser-integration keywords from the package. |

The earlier review also endorsed the priority heap, disjoint selection, eligibility filtering, balanced batches, pass accounting, early validation, the options object and explicit HTML parsing. Those behaviors remain covered by the library tests. The earlier ablations and the cache measurements provide the evidence for the decisions above. [Threshold and cap experiments](#cutoff-size-and-grouping-experiments) · [Memory results](results/2026-11-23-node-memory.json) · [Priority-merge trials](results/2026-11-23-merge-final.json)

A clean npm install passed 55 tests. Both complete benchmark suites then ran from cache with network requests disabled and an absent credentials file. All quality scores, all 288 RAG score cells, example source ranges, simulated provider counts and vector hashes matched the live runs exactly.

## 2026-11-23 · Native Node benchmarks and review follow-up

The quality and RAG runners now import the public chunker directly. Node handles dataset reading, tokenization, CPU inference, ranking and scoring. The old runners used Python for Hugging Face Tokenizers, ONNX Runtime, NumPy and Parquet, and passed text and vectors across a process boundary. The current npm commands use development dependencies from the lockfile. A clean `npm ci` and `npm test` passed all 50 tests, including the ten ported scorer cases. [Commands and scoring rules](README.md)

### Reproduction against the previous runners

Fresh Node inference produced the same ordered candidates and **byte-identical Float32 matrices on all five datasets** on Windows x64. The two tokenizer bindings also agreed on model input lengths across 31,375 distinct comparison strings counted separately by RAG dataset, including the strict-budget chunker's probes. The following counts use the production default at 500 UTF-16 units and a fixed cutoff of 0.5. Each RAG cell gives complete references at 256 / 512 / 1,024 tokens. [Node quality report](results/2026-11-23-node-quality.json) · [Node RAG report, including source ranges](results/2026-11-23-node-rag.json)

| Dataset | Distinct texts embedded | Previous and Node scores |
|---|---:|---|
| SQuAD | 5,122 | 409 / 437 held-out questions, 290 in the first chunk |
| WikiSection | 8,179 | Held-out boundary F1 0.3234, with 38 matches against 47 gold boundaries |
| CUAD | 7,761 | 31 / 50 / 55 complete out of 100 |
| QASPER | 13,535 | 2 / 3 / 10 complete out of 54 |
| HotpotQA | 10,079 | 30 / 43 / 56 complete out of 64 in the shortlist, 29 / 37 / 45 in the pooled index |

All 120 quality configuration/split/dataset combinations matched on answer hits, boundary counts, selected configurations, and embedding costs. In 24 WikiSection results the mean WindowDiff differed by at most 2.23 × 10⁻¹⁶ from the earlier arithmetic. All 288 RAG method/pool/ranker/budget results, gold and retrieved example ranges, and provider counts matched exactly. BM25 now lowercases Unicode words with JavaScript. Both normal runs and archived-matrix replays record the candidate and vector hashes. [Previous quality report](results/2026-11-23-structure-quality.json) · [Previous RAG report](results/2026-11-23-structure-rag.json) · [Verified archive matrix manifest](baselines/2026-11-23-python-vectors.json)

### Library changes

- Removed the BigInt decimal helper and the tests for adjacent floating-point representations. Grouping adjustments and percentage caps use ordinary JavaScript numbers. Regression cases cover inclusive cosine cutoffs and fractional caps that change the number of merges.
- Cosine scoring keeps a vector's length on its live scoring node and reuses it for adjacent comparisons. The centroid uses the same normalization. Returned vectors preserve the provider's values and numeric type. Retiring a merged node clears that node's references to its embedding and neighbors.
- Added an optional `maxCachedEmbeddings` limit. On 4,096 sentences with 1,536-dimensional Float32 vectors, the maximum live ArrayBuffer storage sampled at provider entry fell from 45.0 to 18.1 MiB at a limit of 256. Both runs produced the same 512 chunks with zero single-item requests. The bounded run used 17 calls and 7,936 inputs, up from 16 calls and 7,680 inputs. These samples cover vector storage between batches. The default retains full-call reuse. [Memory measurements](results/2026-11-23-node-memory.json)
- Exposed the sentence segmenter's `locale` option and made `parse5` an optional npm dependency. A packed consumer install with optional and development dependencies omitted processed plain text and reported the missing parser when asked to extract HTML. [Library options](../README.md)

The seven-trial merge comparison used the immediately preceding structure-aware runtime. All boundary checksums and provider counts matched. For 16,384 sentences with a cap of 12, current / previous medians were 152.68 / 198.14 ms and 95.98 / 131.41 ms in two runs. Both made 1,196 requests with zero singletons. Timing varied by workload. On 4,096 sentences with dense 384-dimensional vectors, the medians were 127.43 / 123.62 ms. [First comparison](results/2026-11-23-node-merge.json) · [Repeat and dense-vector workload](results/2026-11-23-node-merge-repeat.json)

### Disposition of the remaining review findings

Paragraphs, headings, list items, a strict tokenizer budget, a total-pass ceiling and an opt-in document-relative cutoff were implemented in the preceding revision. The initial grouping heuristic and its centroid remain opt-in. The length penalty, forced minimum size, centroid removal and alternative cap schedules produced mixed retrieval results. The percentage cap still counts eligible boundaries, including overlapping ones, and the soft minimum still changes when it takes effect. Priority merging continues to select disjoint adjacent pairs in descending score order and batch their embeddings. [Threshold and scheduling experiments](#cutoff-size-and-grouping-experiments)

Cross-model cutoff calibration remains untested. Source offsets in the public API, concurrent provider sub-batches within a round, and browser support remain open. The Node benchmark changes exercise one embedding model. [Scoring and scope](README.md)

To reproduce a historical snapshot in a separate copy, first apply the pre-Node restoration patch. It restores the earlier runtime and its Python benchmark harness for the archived experiments. The subsequent patches below apply to that restored tree. The runtime hashes for the structure-aware, pre-structure and experimental snapshots were verified. [Pre-Node restoration](baselines/2026-11-23-before-node.patch)

## 2026-11-23 · Structure-aware splitting, token budgets and document cutoffs

The library now splits blank-line paragraphs, headings and list items into units before semantic merging. HTML block elements also delimit units. The fixed 0.5 cutoff is the default. The document-relative cutoff, model-token budget and total priority-pass ceiling are opt-in. The RAG benchmark now feeds original contract whitespace, paper blocks, and article titles and bodies into the public API. [Options and examples](../README.md) · [All RAG scores](results/2026-11-23-structure-rag.json)

### Complete evidence delivered

Each cell counts questions with complete supporting evidence under MiniLM retrieval at 256 / 512 / 1,024 delivered tokens. Every method in a task uses the same frozen candidate vectors. On all 664 source documents, the flattened control matched the previous library on the original input, chunk for chunk, including provider call and input counts. Adding structural candidates changes MiniLM’s quantization batches, so compare the policies within this run. [Full dense and BM25 results, sample IDs and source ranges](results/2026-11-23-structure-rag.json)

| Policy at size 500 | CUAD / 100 | QASPER / 54 | Hotpot ten passages / 64 | Hotpot pooled / 64 |
|---|---|---|---|---|
| Flattened input, fixed 0.5 | 32 / 46 / 47 | 1 / 2 / 9 | 30 / 43 / 56 | 29 / 37 / 45 |
| Original layout, fixed 0.5 | 31 / 50 / 55 | 2 / 3 / 10 | 30 / 43 / 56 | 29 / 37 / 45 |
| Original layout, document cutoff | 32 / 43 / 53 | 5 / 9 / 17 | 36 / 44 / 57 | 32 / 43 / 49 |
| Original layout, fixed 0.5, strict 256-token input | 31 / 50 / 56 | 2 / 3 / 10 | 30 / 43 / 56 | 29 / 37 / 45 |
| Original layout, fixed 0.5, at most two priority rounds | 30 / 47 / 54 | 1 / 3 / 8 | 30 / 43 / 56 | 29 / 37 / 45 |

CUAD gained eight complete references at 1,024 tokens and lost one at 256 with the structure-aware default. Seven flattened contract chunks exceeded MiniLM's 256-token model input. Preserving layout reduced that to two, and enabling the token budget reduced it to zero. On QASPER the corresponding counts were two, zero and zero. The token-limited run checked the actual length of every provider input, including special tokens.

### Embedding requests and merge quality

Each cell gives provider calls / single-item calls for the full collection. Counts include scoring and final indexing. The document cutoff calibrates in the existing sentence-scoring batch. Admitting different pairs changes the work in subsequent rounds.

| Policy | Eight contracts | Sixteen papers | 640 Hotpot passages |
|---|---:|---:|---:|
| Flattened, fixed 0.5 | 30 / 3 | 78 / 6 | 1,451 / 606 |
| Original layout, fixed 0.5 | 37 / 6 | 83 / 7 | 1,451 / 606 |
| Document cutoff | 53 / 7 | 108 / 15 | 1,739 / 694 |
| Strict 256-token limit | 37 / 6 | 83 / 7 | 1,451 / 606 |
| At most two rounds | 24 / 1 | 48 / 0 | 1,428 / 583 |

The quality suite reproduced all 27 earlier configurations on both flattened Wikipedia datasets, including every retrieval score, editorial-boundary score and provider count. It also ran the new document cutoff at sizes 250, 500 and 1,000. At size 500 the production mode reproduced the experimental results on SQuAD and WikiSection. It retrieved 409 of 437 short answers with 171 indexed chunks, compared with 409 hits in 239 chunks at fixed 0.5. Held-out WikiSection boundary F1 rose from .3234 to .3506. Replaying the earlier 64-question HotpotQA follow-up on its original vectors also matched all four archived methods, both rankers, all budgets and provider costs. [Quality scores](results/2026-11-23-structure-quality.json) · [Original follow-up](results/2026-11-23-review.json)

The large-document benchmark compared the current library with the immediately preceding working tree twice. Every boundary checksum, provider input count and batch count matched on all four workloads in both runs. For 16,384 sentences and a per-pass cap of 12, both versions embedded 30,720 inputs in 1,196 requests with zero single-item requests. Current / previous seven-trial medians were 223.22 / 230.37 ms in the first run and 214.87 / 203.45 ms in the repeat. At cap 500 on the same topic runs, the medians were 194.35 / 168.96 ms and 229.52 / 255.84 ms. The timing order changed between runs. [First performance run](results/2026-11-23-structure-performance.json) · [Repeat](results/2026-11-23-structure-performance-repeat.json)

Verification passed 38 Node tests and ten Python benchmark tests. The merge tests compare the optimized implementation with a full rescan on 1,000 seeded documents under both fixed and document-relative cutoffs. Targeted cases cover strict token limits with prefixes, Unicode fallback, token counts changing after a join, and final batched embeddings when a total-pass ceiling stops the merge. [Replay instructions](README.md) · [Restore the previous runtime and benchmark harness](baselines/2026-11-23-before-structure.patch)

## 2026-11-23 · Independent check of the Claude review

The experiment compared 22 size-500 configurations on the five existing datasets. All five frozen vector matrices and 29 archived method/dataset controls reproduced exactly, including provider costs. A separate check used 64 new HotpotQA questions. The experimental scoring rules live in a replay patch. The production library still uses the adjacent, priority-ordered, disjoint merge. [Complete scores, per-question outcomes and source ranges](results/2026-11-23-review.json) · [Experiment patch](baselines/2026-11-23-review.patch)

### RAG on new questions

The primary measure was complete evidence from both source articles within 256 retrieved tokens in a pooled MiniLM search. The three semantic settings were fixed before scoring these questions. We took the midpoint of each sampling stratum for 32 bridge and 32 comparison questions. Every question ID is new. Three of the 640 passage titles also occur in the earlier index. The new index contains 79,880 WordPiece tokens.

| Policy | Complete at 256 / 64 | At 512 | At 1,024 | Embedding calls | Single-item calls |
|---|---:|---:|---:|---:|---:|
| Fixed 0.5 | 28 | 31 | 40 | 1,482 | 641 |
| Fixed 0.3 | 28 | 36 | 44 | 1,823 | 723 |
| Document mean minus half a standard deviation | 30 | 34 | 45 | 1,752 | 700 |
| 128-token windows with 32-token overlap | 25 | 40 | 47 | 640 | 398 |

Against 0.5, the document-relative cutoff recovered two additional questions and lost none at 256 tokens. Fixed 0.3 gained three and lost three. At 512 and 1,024 tokens the overlapping-window baseline delivered the most complete references. With BM25 at 256 tokens the order also changed, with 26, 24, 24 and 18 complete questions in table order. This sample tests one embedding model.

### Cutoff, size and grouping experiments

The four RAG columns count complete references with dense retrieval at 256 tokens. SQuAD counts complete short-answer spans on 437 held-out queries. WikiSection reports held-out exact boundary F1. The two HotpotQA columns reuse the same 64 questions.

| Policy | SQuAD hits | WikiSection F1 | CUAD / 100 | QASPER / 54 | Hotpot, ten / 64 | Hotpot, pooled / 64 |
|---|---:|---:|---:|---:|---:|---:|
| Fixed 0.5 | 409 | .3234 | 32 | 1 | 29 | 29 |
| Fixed 0.3 | 402 | .3436 | 35 | 4 | 35 | 31 |
| Fixed 0.2 | 401 | .3586 | 35 | 6 | 31 | 29 |
| Document median | 412 | .3187 | 35 | 2 | 33 | 32 |
| Document mean minus half a standard deviation | 409 | .3506 | 34 | 4 | 35 | 34 |
| Length penalty on eligibility and priority | 415 | .3268 | 32 | 1 | 29 | 29 |
| Length penalty on priority alone | 410 | .3234 | 33 | 1 | 29 | 29 |
| Admit a pair if either chunk is under 100 UTF-16 units | 407 | .3373 | 34 | 5 | 32 | 31 |

- Fixed 0.3 beat 0.5 on dense complete evidence in all 12 original task/budget comparisons. On QASPER it reduced mean evidence recall at 256 from 30.9% to 28.6%. For pooled HotpotQA, BM25 complete at 256 fell from 30 to 27. On QASPER at 1,024, fixed 0.2 retrieved 17 complete references, the document-relative mean rule retrieved 14, and the existing greedy packing baseline retrieved 18. These tasks reward different chunk sizes. [Original RAG run](results/2026-11-23-rag.json)
- The document-relative rules estimate the cutoff once from the original size-eligible adjacent pairs, reuse their scoring batch, and fall back to 0.5 with fewer than two scores. The mean rule uses population standard deviation. On CUAD it indexed 892 chunks with 44 provider calls, compared with 875 chunks and 43 calls at fixed 0.2. The relative rule remains a candidate for an opt-in setting. A second embedding model would test the portability claim.
- The length penalty subtracts `0.15 × joined UTF-16 length / 500`. Applying it to eligibility gave the same four 256-token complete counts as fixed 0.6. Applying it only to queue order changed one count by one. Admitting short fragments regardless of cosine reduced CUAD chunks from 1,176 to 706, while increasing embedded texts from 1,594 to 2,064. It helped QASPER and gave mixed results on other tasks.
- The current initial grouping heuristic left 26 of 32 documents at 0.5. With grouping enabled, removing the centroid guard preserved SQuAD hits but changed boundaries. With grouping plus merging, WikiSection F1 moved from .3276 to .3290 and pooled HotpotQA BM25 complete at 256 fell from 30 to 29. The centroid uses existing sentence vectors. [Grouping implementation](../src/similarity.js)
- The original length-drift diagnostic includes hypothetical pairs longer than the 500-unit merge limit and windows that can cross extra section boundaries. A matched comparison on held-out WikiSection kept only legal pairs whose sides contained no internal section break. With two sentences per side, the same 20 gold and 82 other boundaries scored AUC .631 using the nearest sentence on each side and .786 using both. With three per side, zero gold boundaries qualified. This measures classification of the central boundary. It supplies no retrieval result for lookahead.

### Batched merges and request cost

The one-at-a-time and all-disjoint settings both ran to exhaustion. All-disjoint selects nonoverlapping pairs in descending score order and batch-embeds the results. Costs below cover the eight CUAD contracts, including final indexing.

| Cutoff | Merges per pass | Calls | Single-item calls | CUAD complete at 256 / 512 / 1,024 | SQuAD held-out hits |
|---|---|---:|---:|---|---:|
| 0.5 | Production limits | 30 | 3 | 32 / 43 / 47 | 409 |
| 0.5 | One | 208 | 194 | 32 / 43 / 47 | 410 |
| 0.5 | All disjoint | 23 | 1 | 32 / 43 / 47 | 407 |
| 0.3 | Production limits | 40 | 5 | 35 / 45 / 48 | 402 |
| 0.3 | One | 354 | 338 | 34 / 45 / 48 | 409 |
| 0.3 | All disjoint | 31 | 4 | 35 / 46 / 49 | 405 |

The percentage cap counts eligible edges, which can overlap. The soft minimum makes the percentage inactive on small candidate sets. Changing the schedule can change later neighbors and final boundaries. Each successful merge reduces the chunk count by one, but `maxUncappedPasses` only limits passes that exhaust their candidates. A ceiling on total passes could bound sequential work. A provider batch-size limit can create multiple calls within one pass. The earlier 5.9× speedup was measured against Git revision `991b828` on the tight-cap synthetic case. Sharing scoring requests with finished chunks eliminated 170 single-item calls on that case. [Performance trials](results/2026-11-23-merge-final.json) · [Merge implementation](../src/merge.js)

### Input structure and implementation findings

- A plain heading and two unpunctuated bullets become one sentence. An HTML heading followed by two list items does too. The benchmark loaders also flatten whitespace before the library sees it. Mapping the seven overlength CUAD sentences back to raw contracts showed that **all seven contain blank lines**. Splitting on those breaks alone brought every part of five under MiniLM’s 256-token input limit. The other two still had parts of 293 and 495 tokens including special tokens. This supports preserving blank-line and HTML block boundaries during sentence splitting and testing a token-aware fallback for remaining oversized units. [Sentence splitter](../src/sentences.js) · [Raw CUAD ranges and counts](results/2026-11-23-review.json)
- Cache memory grows with the number and dimension of distinct texts embedded in one call. Numeric typed arrays keep their type when copied, including `Float32Array`. Converting all vectors to unit length changes the values returned to callers. Evicting a text that recurs can add a provider call. The staged code already validated vector counts, dimensions and finite values. [Embedding cache](../src/embeddings.js)
- The historical decimal helper preserved the exact decimal floor for percentages immediately below an integer cutoff. The Node follow-up removed it after reviewing its value for the heuristic. [Archived implementation](baselines/2026-11-23-before-node.patch) · [Merge regression cases](../tests/merge.test.js)
- Browser support requires addressing both the import-time package-version read and the installed sentence segmenter's use of Node’s `module.createRequire`. The HTML parser already loads on demand. A token-based size limit, offsets into the original input and locale selection would each extend the public API. [Package entry point](../src/index.js) · [Sentence splitter](../src/sentences.js)

To replay the historical experiment, use a separate copy with its Node dependencies installed. Apply the pre-Node restoration, then the pre-structure restoration, then the experiment patch. In the copy, install `benchmarks/requirements-rag.txt` into a Python environment and run `python benchmarks/review_cases.py --output review-replay.json`. The driver uses the restored harness and checks the archived controls before writing results. [Pre-Node restoration](baselines/2026-11-23-before-node.patch) · [Pre-structure restoration](baselines/2026-11-23-before-structure.patch) · [Experiment patch](baselines/2026-11-23-review.patch)

## 2026-11-23 · Long-document and multi-source RAG retrieval

The earlier SQuAD run searched eight article excerpts per split and credited one complete answer span. Its held-out articles ranged from 867 to 1,862 WordPiece tokens, with a median of 1,282. The new suite evaluates 218 distinct answerable questions, including 64 multi-hop questions evaluated in two search pools. It crosses eight chunking methods with MiniLM and BM25, at 256, 512 and 1,024 tokens of retrieved context. All 192 combinations and example source ranges are archived. [Run the suite](README.md#run-the-rag-evidence-benchmark) · [Complete scores and examples](results/2026-11-23-rag.json)

### Default chunker with MiniLM retrieval

Complete counts require every annotated supporting token from a valid reference at its original source position. Evidence recall gives partial credit. The settings are size 500, merge cutoff 0.5 and initial grouping off.

| Search task | Questions | Complete at 256 | Complete at 512 | Complete at 1,024 | Mean evidence recall at 256 | Could fit at 256 |
|---|---:|---:|---:|---:|---:|---:|
| CUAD, one complete contract | 100 | 32 | 43 | 47 | 41.8% | 94 |
| QASPER, one full paper's text | 54 | 1 | 2 | 9 | 30.9% | 49 |
| HotpotQA, ten supplied passages | 64 | 29 | 42 | 54 | 71.6% | 64 |
| HotpotQA, shared index of 640 passages | 64 | 29 | 36 | 42 | 70.8% | 64 |

The eight contracts range from 417 to 20,407 tokens and the 16 research papers from 1,755 to 8,312. The shared HotpotQA index has 80,514 tokens, split into 2,292 chunks at the default settings. All 64 questions require two distinct articles. The CUAD sample excludes 228 questions with no annotated clause. QASPER contributes 54 of 59 questions. One was marked unanswerable by every annotator, and four lacked a complete reference mappable to the supplied text. The scores measure evidence delivery for answerable queries.

### Which context reached the reader

- In the longest contract, the governing-law evidence spans tokens 18,361 through 18,400 (zero-based). The default retriever included a chunk ending at 18,361, immediately before the clause, and delivered zero of its 40 tokens at a budget of 256.
- The HotpotQA bridge question about the actress who played Corliss Archer requires evidence about the film and Shirley Temple. The default retriever delivered all 24 supporting tokens from the film and none of the 75 from her biography at 256. For the comparison question about the nationalities of Scott Derrickson and Ed Wood, it recovered both references in the first two chunks.
- QASPER labels whole evidence paragraphs. At 256 tokens the default recovered 30.9% of annotated tokens on average, with one fully covered question. At 1,024 tokens, greedy 500-unit sentence packing covered 18 questions completely, 128-token overlapping windows covered 14, and default semantic merging covered nine. Recovering a whole paragraph is a stricter test than finding a fact sufficient to answer.
- With the same default chunks and a 256-token budget, BM25 recovered complete evidence for 24/100 contract questions, 0/54 paper questions, 35/64 shortlisted multi-hop questions and 30/64 pooled multi-hop questions. The dense retriever's corresponding counts were 32, 1, 29 and 29. The corpus, ranker and definition of sufficient evidence all affect the comparison.

All 32 Node tests and nine benchmark tests passed. A second RAG run reproduced all 192 results, provider counts and example source ranges. The earlier 27-setting suite also reproduced its archived selections, scores and vector checksums after sharing the offset and candidate-text helpers with the new runner.

## 2026-11-23 · Cutoffs, size eligibility and embedding batches

**Default settings retained.** Size 500 and merge cutoff 0.5 won retrieval calibration. Size 500 and cutoff 0.3 won calibration for exact editorial boundaries. Initial grouping remains opt-in. These decisions use one MiniLM model and two small English Wikipedia samples. [Methodology and commands](README.md)

### Implementation history

| Revision | Changes measured | Full quality scores for 27 settings on each dataset |
|---|---|---|
| Before this review | The working tree already had a request-local embedding cache, balanced provider batches, a heap for ranking disjoint adjacent pairs, stable tie handling, plain-text and HTML parsing, and optional grouping with an adjacent-sentence and centroid check. | [Before](results/2026-11-23-before.json) |
| Eligibility and arithmetic | Grouping estimates its mean and population variance only from adjacent pairs that fit. It batches their endpoints, skips scoring with zero eligible boundaries, and uses the bounded base with one. Decimal cutoff steps preserve inclusive equality. Fractional per-pass percentages floor exactly. Invalid sizes, counts and percentages fail before parsing or embedding. | [Intermediate](results/2026-11-23-eligibility.json) |
| Final batching | When a scoring request has spare capacity, it can also embed chunks that have become final by size. It uses the exact requested prefix, deduplicates texts and respects the provider batch limit. Score ordering and disjoint-pair selection still drive each merge pass. | [Final](results/2026-11-23-final.json) |

Two regression cases distinguish rounding from tolerance. With two eligible scores of 0.7, the low-variance adjustment from 0.8 admits both at a cutoff of 0.7. An explicit cutoff just above 0.7 rejects them. With 375 candidates, an 18.4% cap allows 69 merges and a cap just below 18.4% allows 68.

### Answer-span retrieval

One hit means a complete reference answer was visible at its source position within 256 retrieved WordPiece tokens. Counts below use the final implementation. The article splits have 481 calibration questions and 437 held-out questions.

| Method | Calibration hits | Held-out hits | Held-out chunks | Provider calls | Single-item calls |
|---|---:|---:|---:|---:|---:|
| One sentence per chunk | 445 | 420 | 365 | 8 | 0 |
| Pack to 500 | 427 | 397 | 128 | 8 | 0 |
| Priority, 500 / 0.5 | **447** | 409 | 239 | 26 | 3 |
| Group only, 500 | 444 | 409 | 241 | 16 | 0 |
| Group then priority, 500 / 0.5 | 447 | 410 | 236 | 21 | 5 |
| Priority, 250 / 0.5 | 445 | **421** | 327 | 17 | 2 |
| Priority, 500 / 0.3 | 440 | 402 | 157 | 31 | 3 |

Size 250 and cutoff 0.5 recovered 12 more held-out answers than the default and indexed 88 more chunks. It recovered two fewer calibration answers. At size 500, enabling both stages recovered one extra held-out answer. Adaptive and fixed initial cutoffs at this size tied on retrieval. All 15 size/cutoff pairs, first-chunk hits, input counts and both split scores are in the run record. [Full retrieval and segmentation scores](results/2026-11-23-final.json)

### Editorial boundaries

The eight held-out city articles contain 47 reference boundaries. Precision, recall and F1 count exact matches. WindowDiff measures local disagreement in boundary counts. Lower WindowDiff is better.

| Method | Calibration F1 | Held-out precision | Held-out recall | Held-out F1 | Held-out WindowDiff | Held-out chunks |
|---|---:|---:|---:|---:|---:|---:|
| One sentence per chunk | 0.164 | 0.185 | 0.979 | 0.312 | 0.950 | 256 |
| Pack to 500 | 0.142 | 0.221 | 0.319 | 0.261 | 0.567 | 76 |
| Priority, 500 / 0.5 | 0.182 | 0.202 | 0.809 | 0.323 | 0.857 | 196 |
| Group only, 500 | 0.172 | 0.203 | 0.851 | 0.328 | 0.862 | 205 |
| Group then priority, 500 / 0.5 | 0.177 | 0.205 | 0.809 | 0.328 | 0.851 | 193 |
| Priority, 500 / 0.3 | **0.223** | 0.241 | 0.596 | **0.344** | 0.676 | 124 |

The lower merge cutoff produced fewer boundaries. It matched 28 of 47, with 116 predicted, while the default matched 38 with 188 predicted. Packing had a lower WindowDiff at size 500. The choice of metric affects which chunking behavior scores well. [Full boundary counts](results/2026-11-23-final.json)

### Before and after

All three revisions used byte-identical embeddings within each dataset. Across the 27 settings on both held-out sets, provider calls fell from 1,192 to 1,070, single-item calls from 166 to 118, and provider input texts from 19,140 to 19,139. Each setting re-indexes the same documents. These totals measure work across experiments.

| Held-out case | Before calls | Final calls | Before single-item | Final single-item | Final input texts |
|---|---:|---:|---:|---:|---:|
| SQuAD, default priority | 32 | 26 | 5 | 3 | 491 |
| WikiSection, default priority | 30 | 25 | 10 | 5 | 316 |
| SQuAD, group then priority at 500 | 26 | 21 | 3 | 5 | 456 |
| WikiSection, group then priority at 500 | 25 | 20 | 5 | 0 | 310 |

The default produced identical scores and chunk counts in all three runs. At size 250, eligibility-aware grouping alone gained one SQuAD calibration hit and one extra predicted WikiSection held-out boundary, taking F1 from 0.3118 to 0.3106. Adding spare-capacity batching changed the distribution of provider requests. Its quality scores matched the intermediate revision in every setting. Single-item calls still occur in some workloads, including five for the combined mode on held-out SQuAD. [Before](results/2026-11-23-before.json) · [Eligibility only](results/2026-11-23-eligibility.json) · [Final](results/2026-11-23-final.json)

### Large-document performance

Each cell is the median of seven timed public API calls in milliseconds. Each comparison alternated the order of the two implementations, after warm-up. The original sorted implementation is Git revision `991b8285b2f9155053b13367b723da76e9941814`. The pre-fix working tree already used the heap. Compare values within the same pair of columns. Absolute timings varied between runs.

| Sentences | Sentences per topic | Merge cap | Original sort | Final in same run | Pre-fix heap | Final in same run |
|---:|---:|---:|---:|---:|---:|---:|
| 2,048 | 8 | 500 | 24.93 | 20.52 | 23.95 | 26.86 |
| 16,384 | 8 | 500 | 393.28 | 356.07 | 271.69 | 233.85 |
| 16,384 | 8 | 12 | 1,369.90 | 231.77 | 262.90 | 261.24 |
| 16,384 | 1 | 500 | 283.68 | 303.42 | 207.30 | 197.08 |

Every comparison produced identical boundary checksums and provider input counts for each workload. The tight-cap case was 5.9× faster than the original sorted implementation. Its 1,196 batched requests included 170 single-item calls before the fixes and zero afterward. With a topic change at every sentence, the final version took 303.42 ms against the original's 283.68 ms. The direct pre-fix comparison also showed a small slowdown on the 2,048-sentence workload. These are library timings with inexpensive synthetic vectors. [Original vs final, all trials](results/2026-11-23-merge-final.json) · [Pre-fix vs final](results/2026-11-23-merge-before-vs-final.json) · [Original vs intermediate](results/2026-11-23-merge-eligibility.json)

### Replaying the snapshots

When starting from the structure-aware implementation, first restore the preceding runtime and benchmark harness in the separate copy. [Pre-structure restoration](baselines/2026-11-23-before-structure.patch)

The quality reports identify runtime sources by SHA-256 because the starting implementation included uncommitted changes. They used Node 24.14.1, `string-segmenter` 1.3.0 and `parse5` 7.3.0. Two small restoration patches cover the runtime changes in this entry. In a separate checkout of the version containing this entry, apply the eligibility patch to reproduce the intermediate runtime. Then apply the before patch to reproduce the starting runtime. Both reconstructions were checked against the recorded hashes. Point the benchmark's `--implementation` at that checkout. [Restore intermediate](baselines/2026-11-23-eligibility.patch) · [Restore before](baselines/2026-11-23-before.patch)

Verification passed 32 Node tests, including a comparison with a full-rescan merge on 1,000 seeded documents, and three benchmark scoring tests. A second run of the final quality suite reproduced every score and fingerprint.

### Earlier retrieval pilot

The earlier size-500 pilot on the same 437 held-out SQuAD questions recorded 396 hits for packing, 410 for priority at 0.5, 411 for grouping plus priority, and 420 each for single sentences and priority at 0.7. Expanding candidate precomputation to size 1,000 changed quantized inference batches. The corresponding counts became 397, 409, 410, 420 and 419. The archived suite freezes that expanded candidate set and records its vector checksum for future comparisons.

The earlier review also tried requiring the original sentence boundary to pass the cutoff again after chunks had grown. At size 500 and cutoff 0.5 it recovered 410 answers in 247 chunks, gaining three and losing two answers relative to the 409-hit baseline. The shipped merge continues to compare the current adjacent chunk embeddings.

### Earlier merge-stage timings

The prior review measured the merge stage with precomputed vectors. These are its reported seven-run medians in milliseconds. The archived performance runs above include parsing and final embedding handling.

| Prior workload | Sentences | Per-pass cap | Sorted implementation | Heap implementation |
|---|---:|---:|---:|---:|
| Mixed topics | 2,048 | 500 | 12.82 | 15.55 |
| Mixed topics | 16,384 | 500 | 240.80 | 142.96 |
| Mixed topics | 16,384 | 12 | 2,368.02 | 138.08 |
| Mixed topics | 4,096 | 1 | 1,055.99 | 62.95 |
| Equal scores, two-sentence chunks | 2,048 | 500 | 6.40 | 8.73 |
| Equal scores, two-sentence chunks | 32,768 | 500 | 162.35 | 99.96 |
| Sparse candidates | 16,384 | 500 | 45.80 | 38.25 |
| 384-dimensional vectors | 4,096 | 500 | 62.67 | 62.67 |
| Broad single pass | 32,768 | All eligible pairs | 26.86 | 38.68 |
| Topic runs | 16,384 | 16,384 | 72.47 | 60.42 |
