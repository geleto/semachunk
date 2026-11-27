# Chunking improvements and benchmark results

## 2026-11-27 · Semantic boundaries, weighted neighbors and answer delivery

On 69 fresh documents, using the same sentence-assisted ranking and neighboring-chunk display gave 256-token structural blocks 71.5% complete first hits and uncapped .25 semantic groups 65.3% after citation review. Their top-five coverage was 93.1% and 92.5%. At .40, semantic cores outperformed equal-count, equal-group-size rotations by 11.5 points at rank one. A query-aware reader shortened strict first hits by 24% while retaining aggregate citation coverage in the 56-question audit. [Study and examples](results/2026-11-27-context-mixtures.md)

## 2026-11-27 · Context on uncapped semantic chunks, fiction and meetings

Across 807 primary confirmation questions in seven domains, embedding and displaying both adjacent units raised complete top-five retrieval for strict semantic sentence groups from 43.0% to 66.4%. Showing only the original group reached 46.7% with the same enriched key. Keeping an intervening B outperformed skipping it at the same A–C matches. On fixed 256-token structural passages, equally weighting the whole passage and its best matching sentence raised complete first hits from 45.0% to 51.3% and complete top fives from 81.1% to 84.6%. The corpus adds 46 stories, six spoken meetings and four board records. [Full comparison and reader examples](results/2026-11-27-context-retrieval.md) · [Source registry](results/2026-11-27-context-retrieval-manifest.json)

## 2026-11-27 · Fixed thresholds and heading attachment on revised prose citations

We corrected the grading of 49 questions and compared 72 structural and semantic settings across 1,302 questions. On the 740 confirmation questions, keeping headings with their sections raised the first-hit evidence F1 of 256-token blocks from 29.19 to 32.06. At the development-selected semantic cutoff of .10 it reached 31.87. All eight top-five citations lost when adding those cuts to heading-aware blocks had been split across passages. At .05 just 16 of 187 confirmation documents changed, yielding one additional complete top five. [Study and passage reviews](results/2026-11-27-prose-threshold-study.md) · [Threshold curves](results/2026-11-27-prose-threshold-curves.png) · [Correction decisions](prose-citations.json)

## 2026-11-27 · Prose retrieval and passage quality

We replayed 1,302 questions across 346 documents and inspected the text of successful and unsuccessful hits. Semantic cuts improved topical continuity in every domain. Matching a passage by its best sentence helped research papers, while keeping an FAQ heading with its answer recovered all 76 confirmation citations within five hits. On 271 questions where all methods returned the same citation first, a much shorter passage containing that citation existed for 10 structural, 77 capped semantic and 111 unlimited semantic hits. [Analysis, examples and controls](results/2026-11-27-prose-retrieval.md) · [23 reader assessments](results/2026-11-27-prose-reader-review.json)

## 2026-11-27 · Document and citation audit

The confirmation comparison covers 790 questions. Five complete hits never exhausted a candidate pool in either fold for any of the three indexes. The smallest confirmation pool had ten passages. Thresholds target each document's structural passage count using only its text. Each method returns all the text of its first five hits. [Source manifest and exclusions](results/2026-11-27-audited-data.json) · [Per-question outcomes](results/2026-11-27-whole-passage-audited-outcomes.jsonl.gz)

| Complete evidence in the first five hits | Questions | Blocks, 256 tokens | Semantic-blocks, 512 tokens | Semantic-blocks, unlimited |
|---|---:|---:|---:|---:|
| Government services | 449 | 90.13% | 87.90% | 87.01% |
| Software FAQs | 76 | 97.37% | 92.11% | 89.47% |
| Research papers | 190 | 63.68% | 68.95% | 71.58% |
| Financial filings | 75 | 26.67% | 32.00% | 33.33% |
| Equal-weight domain mean | | 69.46% | 70.24% | 70.35% |

For each method in column order, the mean tokens returned across domains were 897, 1,251 and 1,827 per question (rounded). Relative to blocks, the capped semantic index gained 0.78 percentage points with a paired 98.33% interval of −2.86 to +4.90. The unlimited index gained 0.89 points with an interval of −2.80 to +4.75. These previously examined folds give a descriptive comparison. [Full results, including rank one, tokens and paired intervals](results/2026-11-27-whole-passage-audited.json)

- **Government services.** Five of the 192 Doc2Dial pages duplicated another page's visible text. We merged their questions into the canonical copies, restored 60 missing page titles from the release and retained the distinct applicant profiles. Every query now searches all pages in its agency and fold. Forty-five questions accept a verified quotation on another relevant page. Of the 972 previous questions, 152 cited only navigation text and 24 had an underspecified request or evidence that answered a different question. The remaining 796 are scored in all three formats. [Government review](government-citations.json)
- **Software FAQs.** All nine manuals retain their original headings and examples. We rewrote the questions independently of the headings and cited the answer lines. Seven of the 105 entries pointed elsewhere for the requested information. The six confirmation manuals now share one search pool of 122 structural passages. [Reviewed questions and citations](faq-citations.json)
- **Research papers.** All 128 supplied papers remain in the corpus. We matched each annotator's highlighted evidence to the text and checked that the citation can be indexed. All spans from one answer are jointly required. Five of the 374 previously scored questions had no usable text citation, including two dataset questions whose entire annotation was the heading of an empty section. [QASPER source and audit](results/2026-11-27-audited-data.json)
- **Finance.** We verified the archived results on all 84 source documents. On the 50 table questions the top-five counts were 7, 13 and 13. On the 25 prose questions they were 13, 11 and 12. All PDF bytes were checked against the recorded SHA-256. The manifest preserves both the published source link and a release-pinned PDF link for each document. [Finance source registry](results/2026-11-27-audited-data.json) · [PDF citations](financebench-citations.json)

## 2026-11-27 · Full financial filings with whole-passage retrieval

We replaced the one-page FinQA inputs in the active comparison with 84 complete FinanceBench filings and earnings releases. They span 32 issuers and 12,013 PDF pages. Each question searches its entire source document. On the previous confirmation set, the first five hits exhausted the finance candidate pool for 80.1% of questions. On the new confirmation set, this happened for zero questions. The median held-out filing produced 584 structural chunks. [Frozen corpus and exclusions](results/2026-11-27-full-filings-data.json) · [Citations](financebench-citations.json)

| Held-out finance, 75 questions | Index chunks across 44 filings | Complete evidence in first hit | Complete evidence in first five | Mean tokens in first five |
|---|---:|---:|---:|---:|
| `blocks`, 256 tokens | 27,274 | 6/75 (8.0%) | 20/75 (26.7%) | 940 |
| `semantic-blocks`, 512 tokens | 27,271 | 9/75 (12.0%) | 24/75 (32.0%) | 1,620 |
| `semantic-blocks`, unlimited | 27,269 | 13/75 (17.3%) | 25/75 (33.3%) | 2,956 |

Both semantic indexes recovered complete evidence on 13 of 50 table questions in the first five hits. Structural chunks recovered seven. On the 25 prose questions, the counts were 13 for structural chunks, 11 for capped semantic chunks and 12 for unlimited semantic chunks. The issuer-bootstrap 98.33% intervals for the semantic gains over structural chunks were −5.6 to +18.8 percentage points at 512 tokens and −3.8 to +16.7 points with unlimited size. The 66 development questions scored 9.1%, 15.2% and 21.2% at rank five, respectively. [Per-question outcomes](results/2026-11-27-whole-passage-filings-outcomes.jsonl.gz)

The semantic thresholds use each filing's structural passage count as their target, with every hit returned in full. All three counts were within one passage of the structural target on 41 of the 44 confirmation filings. Across all four equally weighted domains, complete evidence at rank five reached 66.10% for `blocks`, 64.26% for capped `semantic-blocks` and 64.59% for unlimited `semantic-blocks`. The three nonfinancial domains reuse the same per-question results as the earlier run. [Comparison and intervals](results/2026-11-27-whole-passage-filings.json) · [Reproduction instructions](README.md#compare-three-limits-with-whole-passage-retrieval)

## 2026-11-27 · Three chunk limits with whole-passage retrieval

The first five whole results from `blocks` at 256 tokens contained all the annotated answer evidence on 84.32% of confirmation questions, averaged over the four domains. The two semantic methods scored 81.20% and 81.26%. The 512-token semantic cap gave the highest first-hit score on confirmation and reduced the mean tokens returned in five hits by 18.5% relative to unlimited semantic chunks. [Protocol](whole-passage-protocol.json) · [Reproduction instructions](README.md#compare-three-limits-with-whole-passage-retrieval)

| Confirmation, 1,266 questions | Index chunks | Complete in first hit | Complete in first five | Evidence-token recall in first five | Mean tokens in first hit | Mean tokens in first five |
|---|---:|---:|---:|---:|---:|---:|
| `blocks`, 256 tokens | 4,877 | 51.16% | **84.32%** | 87.07% | 183 | 865 |
| `semantic-blocks`, 512 tokens | 4,812 | **53.53%** | 81.20% | 87.66% | 255 | 1,067 |
| `semantic-blocks`, unlimited | 4,851 | 52.49% | 81.26% | **88.34%** | 323 | 1,309 |

The benchmark scored every source range in each returned passage. It reused the 338 confirmation sources and their 556 renderings, the same dense encoder, and the same search pools as the preceding experiment. Public-service pages, masked technical FAQs, financial pages and research papers have equal domain weights. Size limits apply when creating the index. The first-hit metric credits an answer only when that single passage contains a complete annotated evidence set. The five-hit metric allows the evidence to span passages.

Each semantic method fitted its own cutoff to the 256-token structural count for each rendering, before considering questions or answers. All three counts matched exactly in 324 renderings. Both semantic counts were within one of the target in 503. The largest individual count differences were two for the capped method and three for the unlimited method. The median cutoff among renderings with active semantic splits was 0.194 at 512 tokens and 0.210 at unlimited size. The largest indexed passages were 256, 512 and 3,234 tokens respectively.

| Source domain | Questions | First hit, blocks / semantic 512 / unlimited | First five, blocks / semantic 512 / unlimited |
|---|---:|---:|---:|
| Public-service pages | 537 | 58.91% / 57.36% / 56.42% | 89.01% / 86.84% / 86.10% |
| Masked technical FAQs | 79 | 53.16% / 53.16% / 50.63% | 88.61% / 73.42% / 74.68% |
| Financial pages | 457 | 63.02% / 76.15% / 80.09% | 99.56% / 99.78% / 100.00% |
| Research papers | 193 | 29.53% / 27.46% / 22.80% | 60.10% / 64.77% / 64.25% |

The financial first-hit gain includes mixed table-and-prose questions, where the methods recovered 19, 34 and 37 of 51 answers respectively. On these within-document financial searches, five hits included every passage in the candidate pool for 80.09% of confirmation questions under each configuration. That limits what the top-five scores can distinguish. FAQs show the largest structural advantage at five hits.

Against `blocks`, semantic 512 gained 2.38 percentage points on the first hit (descriptive source-clustered 95% interval −1.40 to +5.73) and lost 3.12 points on the first five (98.33% interval −6.25 to +0.10, adjusted for three comparisons). Semantic 512 versus unlimited changed the five-hit score by −0.06 points (adjusted interval −2.48 to +3.05). All three adjusted intervals on the confirmation endpoint include zero.

On 552 confirmation questions whose sources produced exactly equal counts above one for all three methods in every rendering, five-hit completeness was 80.68%, 77.79% and 79.98% respectively. These questions retained their original candidate pools. On the separate 1,122 development questions, the three five-hit scores were 87.92%, 82.46% and 83.69%. Both folds had been used in earlier studies. The rerun reproduced all 8,664 archived method-by-question/rendering outcomes for the structural and unlimited controls, including full-hit evidence and token counts. [Full results and paired intervals](results/2026-11-27-whole-passage.json) · [Per-document counts and paired question outcomes](results/2026-11-27-whole-passage-outcomes.jsonl.gz)

## 2026-11-26 · Uncapped semantic splitting at a matched passage count

The structural reference is public `blocks` at 256 tokens. For each document, public `semantic-blocks` used `maxChunkSize: Infinity` and `maxChunkTokens: Infinity`. We chose the cosine cutoff producing the nearest attainable passage count to the structural reference. Opening a nested branch can create several passages, so a single threshold can skip the exact target. Ties favored the lower count. Only the document and its target count entered selection. Each selected layout was checked against the public chunker, including the text and source ranges. [Protocol](matched-count-protocol.json) · [Reproduction instructions](README.md#compare-uncapped-semantic-passages-at-a-matched-count)

On 338 distinct confirmation sources in 556 document renderings, structural packing produced 4,877 passages and semantic splitting produced 4,851. Counts matched exactly on 365 renderings and were within one on 518. The largest mismatch was three. The median fitted cutoff among renderings with an active cut was 0.210, with the middle 80% between 0.113 and 0.379. The same four domains and 1,266 confirmation questions were used as in the earlier benchmark. Their scores had been reported previously. A separate replay covered the 1,122 development questions.

| Complete evidence on confirmation | Structural `blocks` | Uncapped `semantic-blocks` | Shuffled similarities, mean of three runs |
|---|---:|---:|---:|
| First hit, whole passage | 51.16% | 52.49% | 48.58% |
| First hit, at most 256 tokens delivered | 51.16% | 33.34% | 33.56% |
| Five hits, whole passages | 84.32% | 81.26% | 82.12% |
| Five hits, 1,024 tokens delivered | 83.43% | 72.87% | 77.25% |
| Five hits, 512 tokens delivered | **75.04%** | **57.66%** | 62.98% |

The uncapped first-hit gain over `blocks` was 1.33 percentage points, with a source-clustered 95% interval of −2.42 to +4.56. Real similarities outscored shuffled similarities by 3.90 points on that measure (interval +0.91 to +7.41). Each shuffle permuted the same scores within each document, retained the same tree and refit its cutoff to the same target count. At 512 delivered tokens, genuine semantic splitting finished 17.38 points below `blocks` (interval −20.75 to −13.13). On development the corresponding scores were 65.43% and 76.22%. On the 625 confirmation questions whose source had multiple passages and exactly matched counts in every evaluated rendering, the scores were 54.10% and 75.17%. The original search pools were retained for that subset.

Passage counts conceal the length distribution. The median semantic passage was 82 tokens versus 200 for `blocks`, but the semantic 95th percentile was 642 tokens and its longest passage was 3,234. Of the semantic passages, 417 exceeded the entire 512-token delivery budget. The five retrieved passages averaged 1,309 tokens for semantic splitting and 865 for structural packing. Without clipping, semantic splitting recovered 88.34% of individual evidence tokens versus 87.07% for `blocks`, while fewer queries had *all* their evidence in the five hits. Every emitted passage was indexed. [Per-document counts, cutoffs, sizes and paired query outcomes](results/2026-11-26-matched-count-outcomes.jsonl.gz)

The first-ranked passage averaged 323 tokens with semantic splitting, 279 with shuffled scores and 183 with `blocks`. After seeing the whole-first-hit scores, we replayed those exact rankings with the same 256-token maximum prefix for each first hit. Semantic first-hit completeness fell to 33.34%, versus 51.16% for `blocks` (difference −17.82 points, descriptive 95% interval −23.42 to −12.98). This check uses the benchmark's existing prefix delivery rule. A reader who can consume the whole section has access to the evidence measured in the first row of the table.

| Source domain | Questions | First whole hit, blocks → semantic | Five hits at 512 tokens, blocks → semantic |
|---|---:|---:|---:|
| Public-service pages, averaged across renderings | 537 | 58.91% → 56.42% | 82.06% → 71.63% |
| Masked technical FAQs | 79 | 53.16% → 50.63% | 79.75% → 45.57% |
| Financial pages | 457 | 63.02% → 80.09% | 90.15% → 87.53% |
| Research papers | 193 | 29.53% → 22.80% | 48.19% → 25.91% |

Financial pages drove the increase in first-hit completeness. At 512 delivered tokens, the semantic method recovered 44 of 51 mixed table-and-prose answers versus 39 with `blocks`. It recovered 278 of 317 table-only answers versus 295, and both recovered 78 of 89 prose-only answers. On research papers, the five untrimmed semantic passages contained complete evidence for 64.25% of questions versus 60.10% for `blocks`, while the 512-token budget delivered it for only 25.91% versus 48.19%. Use shared-root `blocks` at 256 tokens as the reference configuration for the five-hit, 512-token retrieval profile. [Full results and paired intervals](results/2026-11-26-matched-count.json)

## 2026-11-26 · Choosing chunk sizes and semantic cutoffs with a shared document root

`blocks` now starts at the document root in the public API. Top-level paragraphs or Markdown sections can share a passage up to the configured size. The structural and semantic strategies use the same root and preserve omission barriers. JSON retains its existing record boundaries. The independent-root scores in earlier entries describe the earlier implementation.

The primary retrieval question is whether five dense-search hits deliver every annotated piece of an answer within 512 tokens. The selection score gives equal weight to public-service pages, technical FAQs, financial pages and research papers. A public-service question counts once across its HTML, Markdown and text renderings. The primary chunk cap was 256 tokens with zero overlap. Cutoffs were selected on 1,122 development questions and frozen before evaluating the 1,266 confirmation questions. We compared ten fixed cutoffs from −1 to 0.65 for each semantic family, document calibration, protection for paragraphs that fit, and three rules that move an existing split. The latter keep the structural chunk count fixed. [Protocol](semantic-settings-protocol.json) · [Frozen cutoff selections](results/2026-11-26-semantic-settings-nominees.json)

The confirmation set contains 537 public-service questions, 79 publisher-authored FAQ questions with their headings masked, 457 financial questions and 193 questions about research papers. Of these, 694 come from sources previously unused in the chunking studies. Financial reports, publishers, papers and public-service page families are disjoint between development and confirmation. Government searches include distractors from the same agency, FAQ searches cover the manuals in their cohort, and finance and research searches run within the requested document. These are English-language evidence retrieval measurements. [Dataset manifest](results/2026-11-26-semantic-settings-data.json) · [Reproduction instructions](README.md#search-thresholds-against-the-shared-root-baseline)

| Held-out complete evidence at 256 chunk tokens | Four-domain mean | Public service | Masked FAQs | Finance | Papers | Indexed chunks |
|---|---:|---:|---:|---:|---:|---:|
| Shared-root `blocks` | **75.04%** | 82.06% | 79.75% | 90.15% | 48.19% | 4,877 |
| `pack` | 70.50% | 77.59% | 68.35% | 85.78% | 50.26% | 5,205 |
| `semantic`, shipped settings | 68.38% | 80.88% | 53.16% | 92.34% | 47.15% | 7,836 |
| `semantic`, development cutoff 0.10 | 70.64% | 80.26% | 68.35% | 87.31% | 46.63% | 5,730 |
| `semantic-blocks`, development cutoff −1 | 75.04% | 82.06% | 79.75% | 90.15% | 48.19% | 4,877 |
| `semantic-blocks`, shipped cutoff 0.15 | 69.77% | 80.26% | 60.76% | 90.37% | 47.67% | 6,240 |
| Move an existing split to the weakest similarity | 75.12% | 83.18% | 79.75% | 88.84% | 48.70% | 4,877 |
| Move an existing split to balance lengths | 75.25% | 81.75% | 79.75% | 90.81% | 48.70% | 4,877 |

Use shared-root `blocks` at 256 tokens and zero overlap as the reference configuration for this retrieval budget. The flat 0.10 nominee finished 4.40 percentage points below it, with a source-clustered 98.33% interval of −8.24 to −0.55 points. Against the shipped flat settings, 0.10 gained 2.26 points with a descriptive 95% interval of −0.36 to +4.99. The hierarchical −1 nominee produced identical passage layouts to `blocks` in all 179 retrieval runs. Moving existing boundaries gained 0.08 points, with an interval of −1.12 to +1.52. Neither the observed gain nor the interval met the adoption rule. The length-balancing control was exploratory. Its small change also gives little reason to add a second packing pass. [Frozen size choices](results/2026-11-26-semantic-settings-sizes.json) · [Full curves and paired intervals](results/2026-11-26-semantic-settings.json)

Across the ten fixed cutoffs, the highest observed flat score was 71.03% at 0.05. For `semantic-blocks`, −1 and 0 tied `blocks`, 0.05 scored 74.63%, 0.10 scored 73.59%, 0.30 scored 60.10% and 0.40 scored 47.99%. Document calibration scored 49.19% for `semantic-blocks`. Protecting a paragraph that already fits improved the 0.15 result from 69.77% to 73.50%. On the identical public-service questions rendered as plain text, flat 0.10 recovered 416 answers versus 410 for `blocks`. On HTML it recovered 416 versus 447. The same Markdown format produced opposing results on finances, research and FAQs.

| Held-out results by chunk cap | `blocks`, 512 tokens delivered | Flat `semantic` 0.10, 512 delivered | `blocks`, 1,024 delivered |
|---|---:|---:|---:|
| 128 tokens | 67.64% | 63.86% | 68.11% |
| 256 tokens | **75.04%** | 70.64% | 83.43% |
| 512 tokens | 68.86% | **70.36%** | **85.00%** |

Each finalist independently selected 256 tokens on the development objective. At a fixed 512-token chunk cap, flat 0.10 did better than `blocks` by 1.50 points, with a descriptive 95% interval of −1.78 to +4.88. Allowing 1,024 delivered tokens increased the structural score at all three caps and favored larger chunks. On the 694 previously unused confirmation questions, averaged over the three covered domains, `blocks` scored 70.36%, flat 0.10 scored 66.62%, hierarchical 0.15 scored 64.20%, and moving existing boundaries scored 70.09%.

On the same smaller set of sources embedded with both models, `blocks` scored 80.19% with `text-embedding-3-small` and 81.42% with `text-embedding-3-large`. The weakest-boundary rule scored 80.05% and 81.87% respectively. Flat 0.10 scored 76.82% and 80.35%. Across the full primary index, `blocks` used zero embedding tokens to choose its boundaries, compared with 1.44 million for flat 0.10, 1.34 million for hierarchical 0.15 and 129 thousand for moving existing boundaries. All methods used embeddings for retrieval.

`blocks` already preserves useful semantic cues through the document structure. Extra cuts can separate the evidence needed to answer one question, leaving more passages to compete for five hits. At 0.15, `semantic-blocks` lost 15 FAQ answers that `blocks` retrieved. In all 15 cases, some required evidence fell outside the top five even before delivery clipping. Ten of those answers also lost the single passage that had previously covered the full evidence. At 0.40 the number of research questions with all their evidence present in at least one indexed passage fell from 158 to 60 out of 193. This loss happens during chunking, before the retriever ranks anything. The financial results below show where the same operation can help.

The old FinQA sample selected 115 questions requiring both a table row and prose. Its 77 pages each supplied one extracted table with a median of six data rows. At a cutoff of 0.15, `semantic-blocks` gained five answers and lost one against shared-root `blocks` (76 versus 72). Only 158 of 1,147 questions in the official FinQA test file require both kinds of evidence. For the new experiment we selected 64 reports per fold before inspecting evidence type and retained every mapped question. The 34 confirmation issuers supplied 159 pages, with a median of five data rows per table. Even a prose-only question in this corpus comes from a financial page containing a table. [FinQA](https://github.com/czyssrs/FinQA) · [QASPER](https://huggingface.co/datasets/allenai/qasper)

| Fresh financial pages, complete evidence at 512 delivered tokens | Prose only (89) | Table only (317) | Table and prose (51) | All (457) |
|---|---:|---:|---:|---:|
| `blocks` | 78 | 295 | 39 | 412 |
| `semantic-blocks`, 0.15 | 77 | 297 | 39 | 413 |
| `semantic-blocks`, 0.40 selected on financial development data | 80 | 301 | 41 | 422 |
| `semantic-blocks`, document-calibrated | 81 | 298 | 44 | 423 |
| `semantic`, 0.10 selected across domains | 79 | 289 | 31 | 399 |
| `semantic`, shipped settings | 82 | 302 | 38 | 422 |

The 0.15 splits recovered an International Paper question about North American printing-paper sales and lost an Air Products question about average interest expense across three years. Both questions require a table row and prose. For the sales question, the new layout put all the evidence into one passage. For the interest question, both layouts retrieved the necessary evidence within five hits, but the 512-token delivery limit clipped it for `semantic-blocks`. At 0.40, the largest absolute gain came from table-only questions. The financial-domain gain at that cutoff was 2.19 points, with a descriptive issuer-clustered 95% interval of −1.43 to +6.31. The results identify a candidate for numerical report-page retrieval, with uncertainty about transfer to other issuers.

Topic labels give a separate check on what the similarity score captures. On 718 WikiSection articles, moving an existing boundary to the weakest eligible sibling pair recovered 41 additional annotated transitions at the same passage count. Exact boundary F1 rose from 38.26% to 39.09%. On 162 QMSum transcripts, the same rule reduced F1 from 3.20% to 2.95%. Flat `semantic` at 0.10 scored 29.55% and 2.00% respectively. An exact topic transition and an answer-retrieval success measure different outcomes.

The eight historical datasets were replayed separately. Flat 0.10 improved FriendsQA dialogue retrieval from 58.03% to 62.03% and HotpotQA from 80.08% to 80.86%. It scored 50.37% versus 51.85% on the older QASPER cohort and 50.43% versus 62.61% on the old mixed-evidence FinQA cohort. At the original 500-character cap it improved SQuAD answer hit rate from 93.14% to 95.42%. These sets had appeared in earlier tuning rounds and used their original metrics and search pools. [Paired question outcomes and topic counts](results/2026-11-26-semantic-settings-outcomes.jsonl.gz)

## 2026-11-26 · Semantic cuts on a broader document benchmark

The new retrieval benchmark adds 192 real public-service pages from four agencies, six independently published technical FAQs, and three Casai guides. The public-service split keeps page versions and identical rendered pages in the same fold. The 61 FAQ questions come from the publishers. Six additional Casai questions were written for this study and have exact source evidence. The new topic task uses all 718 held-out WikiSection disease articles and 162 QMSum meetings previously unused in these experiments. Development uses 359 other articles and 35 other meetings. The matched HTML, Markdown and text versions count as one underlying source. [Checksummed manifest](results/2026-11-26-tree-corpus.json) · [Reproduction instructions](README.md#compare-semantic-cuts-on-the-document-tree)

Of 2,563 Doc2Dial openings with grounded replies, 1,177 had all their citations uniquely locatable in the source HTML. All 1,177 survived the three representation checks. Reading the candidate queries and gold strings revealed standalone greetings, keyboard noise, non-answers and navigation headings. A question and reference screen removed 205 openings from the decision metric, leaving 435 development and 537 confirmation questions. This screen was added during the run after preliminary aggregate results were visible. The same exclusions apply to every method and representation. The matching pages remain searchable. The results also report all 1,177 before screening. [Review rules](tree-labels.py) · [Exclusion reasons and affected question IDs](results/2026-11-26-tree-labels.json)

Five dense-search hits shared 512 delivered tokens in the primary comparison, with a 256-token chunk limit and the small embedding model. Complete evidence requires every annotated part of the answer. The study also measured fractional annotated-token recall and a 1,024-token delivery budget. The no-cut control gives all top-level siblings a common parent and applies the same size checks as `semantic-blocks`. Testing that control isolates what semantic vetoes add to structural packing. The fitting-paragraph variant uses the fixed 0.15 cutoff but suppresses semantic splits inside a paragraph that already fits.

| Held-out retrieval, complete answers at 512 delivered tokens | Questions | `blocks` | Shared tree, no cuts | 0.05 | 0.15 | 0.30 | Protect fitting paragraphs at 0.15 | Existing `semantic` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Public-service HTML | 537 | 446 | 447 | 446 | 427 | 314 | 440 | 428 |
| Same pages rendered as Markdown | 537 | 464 | 465 | 465 | 463 | 396 | 470 | 447 |
| Same pages rendered as text | 537 | 196 | 410 | 405 | 403 | 348 | 403 | 428 |
| Published technical FAQ headings | 35 | 32 | 32 | 31 | 28 | 20 | 31 | 25 |
| Masked technical FAQ headings | 35 | 31 | 31 | 30 | 24 | 14 | 27 | 20 |
| Casai product checks | 6 | 4 | 4 | 4 | 4 | 5 | 4 | 4 |

In plain text, independent top-level paragraphs made `blocks` spend its five search hits on small fragments. Sharing the document root reduced the index from 5,181 chunks to 615 at the same 256-token limit and recovered 214 additional complete answers. Applying a 0.15 cutoff to that same tree gained 22 answers and lost 29. Native HTML already supplied grouping. There the 0.15 cutoff gained seven answers and lost 27, a change of −3.72 percentage points with a source-family bootstrap interval of −7.64 to −0.82. Protecting fitting paragraphs gained five net Markdown answers over structural packing, or +0.93 points with an interval of −0.89 to +3.33. It still left the masked manuals four complete answers below structural packing. The Casai cases exercise local requirements and come from one project.

| Exact topic boundaries, 256-token chunks | Topics changing | Shared tree F1 | 0.05 F1 | 0.15 F1 | 0.30 F1 | Protect fitting paragraphs F1 |
|---|---:|---:|---:|---:|---:|---:|
| WikiSection articles | 4,783 | 38.26% | 38.28% | 38.13% | 35.67% | 38.07% |
| QMSum between single-topic turns | 466 | 3.20% | 3.22% | 3.21% | 1.70% | 3.33% |

The 0.15 tree found 149 additional article boundaries among 677 newly positioned cuts and lost 54 previously matched boundaries. Article recall rose from 39.89% to 41.88%, while precision fell from 36.76% to 35.00%. On meetings, 44 of 3,812 new evaluable cuts matched a topic change and 23 previously matched cuts disappeared. Thousands of ordinary meeting turns are about the same topic, and these transcripts regularly need several chunks for one topic. F1 here measures agreement with exact human-labeled transitions. The `blocks` strategy marks every labeled meeting transition while also splitting at 80,689 same-topic turns.

The edge replay explains one source of the difference. On the 12-meeting development panel, 34 of 5,407 evaluable sibling pairs in the `group` category changed topic. The 0.15 threshold flagged 13 of those 5,407 pairs and none of the 13 changed topic. Another 83 below-threshold pairs were inside paragraphs, where the turn-level ground truth cannot classify them. Repacking can move many downstream chunk boundaries after a single veto. The replay groups eligible cosine scores by node role, depth, document-length bin and local size. [Edge measurements](results/2026-11-26-tree-edges.json.gz)

At the common 1,024-character target the shared tree retrieved 453 HTML, 471 Markdown and 435 plain-text complete answers out of 537. The corresponding 0.15 results were 427, 466 and 420. Three intact TypeScript examples in the Casai guides exceeded the character target, reaching 2,117 to 2,374 characters. Every emitted chunk met the 256-token limit in the token-mode experiments. On the 90-question held-out SSA subset, switching to the large encoder changed the plain-text 0.15 result from five answers below its own no-cut control to two above. On masked manuals the large encoder retrieved 32 complete answers with the no-cut tree and 26 at 0.15. A numeric threshold depends on the embedding model as well as the document.

The original 0.15 scores and chunk counts reproduced on all eight historical benchmarks. Keep the existing papers, contracts and financial reports as separate regression cases. Keep FriendsQA and short HotpotQA passages as stress tests for dialogue and short documents. Their question counts should not determine the default. The financial-report advantage survives this comparison. On the 115 original FinQA questions, `blocks` retrieved 56 complete references, the shared no-cut tree retrieved 72, and 0.15 and paragraph protection both retrieved 76. On 135 QASPER questions the same four layouts scored 70, 70, 68 and 71. A financial-page win supports preserving relationships between prose and tables. It provides little evidence about splitting changes of topic in an ordinary paragraph.

The revised study completed 164 dataset/profile shards and recorded 9,648,153 new provider input tokens across both encoders. The historical replays are accounted for separately. Use the shared no-cut tree as the structural baseline for further development. For factual retrieval, the results favor keeping adjacent evidence together. Exact topic discovery has its own precision and recall tradeoff. A format-, depth- or file-length-specific threshold adds complexity without a demonstrated transferable gain here. The English government conversations are crowdsourced, the Markdown government view retains source heading depth and normalized paragraphs, and the FAQ split has three held-out publishers. Real Casai traffic, multilingual retrieval and OCR layout would address different coverage questions. [Paired results and source-family intervals](results/2026-11-26-tree-experiments.json) · [Per-question and per-document outcomes](results/2026-11-26-tree-outcomes.jsonl.gz)

## 2026-11-26 · Dataset audit for semantic-blocks

Keep the eight existing datasets for regression. Add direct topic labels, native HTML and technical Markdown before tuning another rule. The 0.15 tree improved the seven-dataset mean by 1.98 percentage points over `blocks` on the primary retrieval profile. FinQA contributed a 17.39-point gain. As a sensitivity check, the equal-weight difference across the six other datasets was −0.59 points. FinQA deliberately selects questions that require both table and prose evidence. Its result supports keeping related material together. [Archived per-question scores](results/2026-11-26-semantic-blocks-cutoffs.json)

| Held-out dataset | Evidence and coverage |
|---|---|
| CUAD | 298 answerable questions across 24 contracts. The labels identify clause spans. On these sources `blocks` retrieved 101 complete references, the tree at 0.15 retrieved 96 and the tree at 0.3 retrieved 115. |
| QASPER | 135 questions across 48 papers, with 46 papers contributing scored questions. The rendered Markdown reaches heading depth five. The median shortest annotated reference was 144 tokens. At 0.15, complete references fell from 70 to 68 relative to `blocks`, while annotated-token recall rose from 61.3% to 62.6%. |
| FinQA | 115 questions, 77 pages and 68 report groups. The pages have Markdown tables and no Markdown headings. `blocks` scored 56, the tree at zero scored 72 and the tree at 0.15 scored 76. |
| HotpotQA | 128 multi-hop questions. Of 1,262 source articles, 1,202 fit whole at 256 tokens. The rendering has a title and no subheadings. This stresses the cost of fragmenting short sources. |
| FriendsQA and QMSum | FriendsQA has 1,201 questions from eight TV episodes and a median answer of three tokens. QMSum has 244 questions from 35 meetings. On 136 questions even the shortest annotated reference exceeds the 512-token delivery budget, so QMSum measures recall. |
| SQuAD and WikiSection | SQuAD uses 437 questions from eight flattened articles. The separate editorial-boundary test uses eight English city articles with 47 reference boundaries. Both remove much of the source layout. |

The document cohorts use pinned sources and deterministic group selection. SQuAD and WikiSection use systematic subsamples. The cutoff sweep fixes one input format per dataset, uses one embedding model and gives each retrieval dataset equal weight. A format comparison therefore also changes the content and the annotations. These previously inspected sources are useful regression cases for future work. [Document sampling](markdown-corpora.mjs) · [Quality sampling](corpora.mjs) · [Cutoff protocol](semantic-blocks-cutoffs.mjs)

**What a lower cutoff does.** At zero, QASPER produced the exact `blocks` passage and citation hash. Building that paper index still used 649,325 embedding tokens, versus 266,790 for `blocks`. On FinQA the zero-cutoff tree emitted 331 passages, versus 1,823 for `blocks`. The tree gives top-level siblings a common parent that permits joining them, and zero can still split a pair with negative cosine. The next comparison needs ordinary `blocks`, the identical tree and packing rules with semantic cuts disabled, and that tree with cuts enabled. This isolates the effect of a topic cut from the effect of allowing a new join. [Tree implementation](../src/semantic-blocks.js) · [Archived passage hashes and costs](results/2026-11-26-semantic-blocks-cutoffs.json)

**External practice.** LangChain publishes hand-written questions over a fixed snapshot of its Python documentation. Its table study grades generated answers to 30 questions from six documents, including 25 questions derived from tables. The chunk-size notebook compares page splitting with 50-, 100- and 250-token chunks. It also maintains deterministic splitter fixtures. [Documentation QA](https://www.langchain.com/blog/public-langsmith-benchmarks) · [Table benchmark](https://www.langchain.com/blog/benchmarking-rag-on-tables) · [Chunk-size notebook](https://langchain-ai.github.io/langchain-benchmarks/notebooks/retrieval/semi_structured_benchmarking/ss_eval_chunk_sizes.html) · [LangChain JS splitter tests](https://github.com/langchain-ai/langchainjs/blob/f8879c4b43152a82ca5282306b19df1b84b3dd65/libs/langchain-textsplitters/src/tests/text_splitter.test.ts)

Mastra's published chunker tests use constructed Markdown to check heading families, bottom-up merging, code preservation and token thresholds. Its `semantic-markdown` implementation uses heading relationships and token counts. The repository and documentation reviewed supplied behavioral fixtures and no labeled retrieval comparison for that splitter. [Mastra document tests](https://github.com/mastra-ai/mastra/blob/0c9ea1fb5638b7ee47ab6e146dcaf44295a41fa8/packages/rag/src/document/document.test.ts#L3515) · [Transformer implementation](https://github.com/mastra-ai/mastra/blob/0c9ea1fb5638b7ee47ab6e146dcaf44295a41fa8/packages/rag/src/document/transformers/semantic-markdown.ts#L105)

**Data preparation.** The checks below inspect annotations and source identity. They use no embeddings or retrieval runs. Reproduce the inventory with `python benchmarks/semantic-blocks-corpus-audit.py`. [Checksummed source inventory and Doc2Dial split](results/2026-11-26-semantic-blocks-corpus-audit.json)

- The unused English disease portion of WikiSection supplies 718 test articles and 4,783 editorial boundaries. The separate validation split has 359 articles and 2,446 boundaries. Retain the published offsets as labels and withhold the reference headings when measuring topic discovery. [WikiSection dataset](https://github.com/sebastianarnold/WikiSection)
- The unused QMSum training partition supplies 162 meetings with 725 human-labeled topics. At 466 adjacent turn boundaries each side has a single, different topic. Another 80,689 pairs have the same single topic. Exclude the 7,019 ambiguous or unlabeled pairs from this metric. The transcripts have no exact duplicates in the previously scored validation or test sets. These labels measure changes at turn boundaries. [QMSum annotation method](https://aclanthology.org/2021.naacl-main.472/)
- Doc2Dial supplies native HTML, separate annotated text and grounded dialogues from four public-service domains. The official training and test sets share 237 document versions. Of 2,563 opening questions with a grounded solution reply, 1,177 have every gold span uniquely locatable in normalized HTML text, across 192 document versions. Grouping by page-title family and identical rendered content gives 506 development questions and 671 confirmation questions, with all four domains in both. Use the raw HTML as input. The next loader must verify the source offsets through HTML and Markdown rendering and account for missing or repeated evidence. [Doc2Dial schema and groundings](https://huggingface.co/datasets/IBM/doc2dial) · [Dataset paper](https://aclanthology.org/2020.emnlp-main.652/)
- Add native technical Markdown from distinct manuals, including Casai material relevant to its users. Review exact evidence for conditions and exceptions, code and explanations, and real topic changes inside fitting sections. Render the same sources as HTML and plain text, carry the evidence offsets across renderings, and keep all versions of a source in one partition. This labeled manual set is still outstanding.

**First policy to compare on the revised data.** Keep the fixed 0.15 control. Try preserving a fitting paragraph and using semantic cuts between adjacent paragraphs or subsections, descending to sentences when size requires it. Record the node type, local size as a fraction of the active character or token limit, cosine, and whether a cut was optional or forced by size. Report precision and recall for optional topic cuts, damage to previously co-retrievable evidence, retrieval under the same delivery budget, and embedding cost. Group uncertainty estimates by source. Whole-file length and absolute nesting depth can be inspected after accounting for node type and local size. A wrapper heading can increase depth everywhere with identical prose. A second embedding model checks whether a numeric cutoff transfers. The existing fixed setting remains the reference pending the revised benchmark.

## 2026-11-26 · One cutoff for semantic-blocks

`semantic-blocks` now defaults to a fixed cosine of **0.15** for text, Markdown and HTML. Calibration selected one setting across CUAD contracts, QASPER papers, FinQA financial reports, HotpotQA, QMSum meetings, FriendsQA dialogue and SQuAD. Each retrieval dataset carried equal weight. HotpotQA's shortlist and pooled results were averaged within the task. QMSum measured annotated evidence recall, SQuAD measured answer hits, and the other tasks measured complete evidence. The held-out samples contained 2,558 questions. WikiSection separately measured editorial boundaries on eight held-out articles.

| Tree cutoff | Calibration retrieval score | Held-out retrieval score | Held-out score with 1,024 delivered tokens | Held-out WikiSection boundary F1 |
|---|---:|---:|---:|---:|
| 0 | 55.57% | 58.57% | 70.54% | 0.261 |
| 0.05 | 55.61% | 58.60% | 70.57% | 0.276 |
| **0.15** | **55.88%** | **58.75%** | 69.65% | 0.233 |
| 0.3 | 48.19% | 53.30% | 58.49% | 0.325 |
| 0.5 | 42.73% | 44.62% | 45.84% | 0.345 |
| Document-relative | 49.78% | 49.72% | 51.75% | 0.321 |

The document retrieval runs used 256-token chunks and up to five passages sharing 512 tokens for the primary score. SQuAD used its usual 256-token retrieval budget for both columns. The flat-text benchmarks used 500-character chunks for this comparison and also ran at 250 and 1,000 characters. The previous format-dependent tree defaults scored 51.81% on held-out retrieval. Ordinary `blocks` scored 56.77% and `semantic` scored 58.77%. The cutoff sweep used `text-embedding-3-small` and English text and Markdown. HTML shares the cutoff and has parser regression tests. [Results and per-question outcomes](results/2026-11-26-semantic-blocks-cutoffs.json) · [Study runner](semantic-blocks-cutoffs.mjs)

At the public character targets, a further 199 questions from the four document datasets scored 60.88% at 0.15, 61.54% at both 0 and 0.05, and 52.21% with the document-relative rule. The character targets were 500 for text and 1,024 for Markdown. Each policy emitted the same 161 over-target contract passages under the soft character limit. The token-limited runs recorded zero over-target passages. [Character-limit check](results/2026-11-26-semantic-blocks-cutoffs.json)

## 2026-11-26 · Semantic merging on the parser tree

Compare the public `semantic` strategy, `semantic-blocks` and structural `blocks`. The tree strategy scores adjacent children at each level. A weak boundary splits its ancestors. Sibling sections under the document root can join, as can related tables, code and prose. The existing `semantic` strategy uses priority merging in text and original prose boundaries within each Markdown section. [Implementation](../src/semantic-blocks.js) · [Boundary and citation tests](../tests/semantic-blocks.test.js)

The first paired run used the existing confirmation splits, `text-embedding-3-small`, a 256-token chunk budget and the native threshold settings of each strategy. The retriever ranked passages within the source document and delivered up to five passages sharing 512 tokens. A hit required a complete annotated evidence reference in the delivered text. Parentheses show index rows. The paired intervals resample source groups.

| Input | Questions | `semantic` hits (rows) | `semantic-blocks` hits (rows) | `blocks` hits (rows) | Paired difference in percentage points, 95% interval |
|---|---:|---:|---:|---:|---:|
| QASPER papers, Markdown | 38 | 26 (567) | 14 (1,173) | 21 (352) | −31.6 [−54.8, −14.6] |
| FinQA financial reports, Markdown | 38 | 25 (256) | 30 (225) | 23 (611) | +13.2 [−2.6, +30.0] |
| CUAD contracts, text | 91 | 24 (457) | 23 (501) | 27 (1,158) | −1.1 [−8.1, +4.0] |

On the papers, cold indexing used 142,329 embedding tokens for `semantic-blocks` and 97,043 for `semantic`. On contracts the corresponding totals were 170,670 and 276,442. Both budgets and each question’s paired outcome are in the reports. [Papers](results/2026-11-26-semantic-blocks-qasper-markdown.json) · [Financial reports](results/2026-11-26-semantic-blocks-finqa-markdown.json) · [Contracts](results/2026-11-26-semantic-blocks-cuad-text.json)

On the separate flat-text check at 500 characters, `semantic` recovered 417 of 437 held-out SQuAD answers and `semantic-blocks` recovered 408. On eight held-out WikiSection articles, exact editorial-boundary F1 was 0.416 and 0.276 respectively. Both comparisons used the same sentence-normalized text and frozen embedding matrices. [Flat-text results](results/2026-11-26-semantic-blocks-quality.json)

For the Markdown cutoff check, compare the document-relative setting with fixed cosine cutoffs of 0.05, 0.3 and 0.5 on the separate QASPER and FinQA calibration groups. Choose the highest mean complete-evidence rate across the two tasks for five hits sharing 512 tokens. Break ties with fewer cold indexing tokens. Check the single selected setting on the separate `rules-test` groups against the existing Markdown semantic strategy. [Study runner](semantic-blocks-study.mjs)

A fixed cutoff of 0.05 led calibration at 49.80% mean complete evidence across the two tasks. Document calibration reached 48.72%, fixed 0.3 reached 42.34% and fixed 0.5 reached 35.97%. [Paper calibration](results/2026-11-26-semantic-blocks-qasper-calibration.json) · [Financial calibration](results/2026-11-26-semantic-blocks-finqa-calibration.json)

| Independent Markdown sample | Questions | `semantic`, 512 delivered tokens | Tree at 0.05, 512 | `semantic`, 1,024 | Tree at 0.05, 1,024 |
|---|---:|---:|---:|---:|---:|
| QASPER papers | 27 | 13 | 13 | 14 | 14 |
| FinQA financial reports | 27 | 23 | 22 | 23 | 27 |

At 512 delivered tokens the paper comparison exchanged one gain for one loss. The financial comparison recorded three gains and four losses. At 1,024 tokens the financial comparison gained four and lost zero. On these papers the 0.05 tree produced exactly the same passages and citations as ordinary `blocks`, at 129,793 cold indexing tokens versus 50,537 for `blocks`. These samples support retaining `semantic` as the general semantic strategy and keeping the tree variant opt-in. Across the recorded experiments, the provider supplied 454,216 new embedding input tokens. [Paper validation](results/2026-11-26-semantic-blocks-qasper-validation.json) · [Financial validation](results/2026-11-26-semantic-blocks-finqa-validation.json)

## 2026-11-26 · Token-limit rescue and retrieval scoring

- With `cl100k_base` and a one-token cap, JSON `"합니다"` used to skip `합`. Joining it to the completed neighbor gives `합니다`, which fits in one token. The shared splitter now retries adjacent final ranges when either still exceeds the cap. The provider receives the full word, and two fitting soft spans keep their boundary. The neighboring-range check passed for 2,440 tokenizer probes and all 8,192 combinations of fitting proper substrings of the JSON source `"abc"`. [Splitter](../src/token-limit.js) · [Regression tests](../tests/token-overflow.test.js)
- The Markdown and plain-text retrieval benchmarks used to give credit for a returned fragment that had no embedding. They now align the complete output to the source and index only eligible rows. The original failing case had a one-token cap and an emoji as its only evidence. An empty index now delivers zero tokens. Checking each rejected position, repeated passages and ordinary inputs produced the expected evidence scores in 168 method runs. [Markdown benchmark](markdown-index.mjs) · [RAG benchmark](rag.mjs) · [Delivery tests](delivered-context.test.mjs)
- Comparing two- and three-token caps on `abcdefghij` used to abort with a missing candidate. The RAG benchmark now prepares pieces for each finite cap on its configured input. In 96 runs across four documents, every method matched its standalone result in every configuration order. [Candidate preparation](rag.mjs) · [Regression tests](metrics.test.mjs)

All 372 frozen string layouts and 66,185 public record renderings matched their archive. The 7,404 capped development renderings recorded zero rejected fragments across all eight layouts. The overflow regressions exercise cases outside that evidence. The Node reporter reproduced the nomination and all 13,593 decompressed paired records. On the 151 affected confirmation questions, sibling packing gained 9.60 percentage points in attributable completion (95% interval +2.64 to +15.86). [Archived report](results/2026-11-25-json-records.json) · [Release decision](#2026-11-26--choosing-the-json-record-layout)

## 2026-11-26 · JSON line breaks and Node report replay

Soft JSON sentence cuts keep each run of decoded line breaks with the preceding text. Regression fixtures cover escaped, literal and mixed spellings and check the cited source slices. Text, HTML, Markdown and JSON tests now cover prefixes that block every fragment and token counters that charge less for the prefixed input than for its body. All 372 frozen string layouts and 66,185 public record renderings matched their archived hashes. [JSON tests](../tests/json.test.js) · [Token-limit tests](../tests/token-overflow.test.js)

The Node reporter reproduced the frozen nominees, the qualification of `packed-repeat` and every paired record from the saved scores. All 13,593 decompressed JSONL lines matched byte for byte. The largest change in a confidence bound was below 10⁻¹² percentage points. The Node tests exercise every nomination stopping point, changes to each prescribed scoring setting, and the archived confidence intervals. [Reporter](json-record-report.mjs) · [Reporter tests](json-record-report.test.mjs)

## 2026-11-26 · JSON soft cuts, delimiter matching and release settings

- **JSON embedding.** With `cl100k_base`, a two-token cap and a soft target of three, the source `"? ⇒"` now indexes both `"? ⇒` and the closing quote. The splitter holds the left piece until it knows whether the first piece on the right needs it. Two fitting pieces keep their soft boundary. [Regression test](../tests/token-overflow.test.js)
- **Literal separators.** Ordinary delimiters use native literal search. A delimiter starting with a low surrogate or ending with a high surrogate uses a single pass over code points. A simpler boundary check still repeated long comparisons on runs of legal lone surrogates. On Node v24.14.1 the single pass took a median of 2.25 ms on the reported 80,000-emoji input, down from 551 ms across five alternating trials per implementation. An independent matcher agreed on 20,000 generated cases, including CRLF and lone surrogates. [Delimiter search](../src/packing.js)
- **Release settings and costs.** Scoring and reporting enforce the frozen model, dimensions, hit count and delivery budget. Layouts with identical surviving rows share a cost entry only when their rejected-fragment counts also agree. The plan dates its 1,318-line measurement to the sibling-packing study. [Release protocol](json-record-protocol.json) · [Cost calculation](json-layouts.mjs) · [Implementation history](../work/delimited-text-and-json-chunking-plan.md#implementation-and-verification)

All 66,185 public corpus renderings matched the archived index hashes. Checking the first pool of every score batch reproduced every candidate group and cost for 2,075 renderings. The 372 frozen string layouts matched, and the saved scores reproduced the nomination, report and byte-identical paired results. Strict TypeScript checks, 127 Node tests, two Python tests and four offline package installations passed.

## 2026-11-26 · Overflow, sentence boundaries and literal separators

Accepted all eight review findings. The public JSON default remains sibling packing.

- **Text and HTML.** When an indivisible fragment exceeds the token cap, try a discarded space on either side before marking it. A space can belong to only one fragment. With `cl100k_base` at one token, `Wednesday 😀` now sends both `Wednesday` and the space-prefixed emoji for embedding.
- **JSON overflow.** Apply hard splitting across the soft spans of one scalar. Consecutive blocked ranges become one excerpt with one prefix. A fitting piece between them stays eligible for embedding. Duplicate keys remain distinct source occurrences.
- **Padded sentences.** Compact horizontal whitespace for sentence segmentation and translate the resulting boundaries back to the original offsets. Segment hard line breaks separately. Abbreviations, Unicode casing, escape spellings and exact citations passed the regression checks. On 35,000 generated strings across four locales, every sentence end matched the earlier implementation.
- **Literal separators.** Search for the literal on a newline-normalized view and reject matches that cut a surrogate pair. A 32,768-character separator now works when absent or present. An independent matcher agreed on all 20,000 generated cases.
- **Verification and citations.** The JSON benchmark reference marks an indivisible over-limit escape and the verifier compares the entire result. Development nomination stops on the first rejected addition. The regression exercises every stopping point. Mixed-overflow tests check the exact scoring, prefetched and final provider inputs with cache limits of zero, two and infinity, plus callback-free structural layouts. The README explains how source ranges disambiguate duplicate JSON keys. [Runtime tests](../tests/token-overflow.test.js) · [Reference tests](json-records.test.mjs) · [Nomination test](json-record-report.test.mjs) · [JSON citations](../README.md#json)

Measured the public JSON call on Node v24.14.1 with ICU 78.2. The field contained `First.`, the indicated number of spaces, and `Second. Last.`, with a soft target of 32 UTF-16 units. The figures are medians of nine calls per implementation after two timed warm-ups, alternating order in one process. The output was identical for every timing pair.

| Consecutive spaces | Before | After |
|---:|---:|---:|
| 6,000 | 87.0 ms | 0.99 ms |
| 12,000 | 337.3 ms | 0.94 ms |
| 24,000 | 1,359.0 ms | 1.02 ms |

An unpadded prose control with 600 repetitions of two sentences and a 512-unit target took 28.2 ms before and 29.9 ms after, yielding the same 76 chunks. All 66,185 corpus renderings matched the independent sibling packer and the stored layout hashes. All 372 frozen long-string layouts matched. Rebuilding from the recorded scores reproduced the development nomination, final report and paired question results byte for byte. Strict TypeScript checks, all 123 Node tests, the Python nomination test and four package installations passed. [Retrieval results](results/2026-11-25-json-records.json)

## 2026-11-26 · Choosing the JSON record layout

**Ship sibling packing.** On 4,084 title-disjoint HotpotQA questions, packing adjacent fields or items from the same parent improved complete evidence in all three compact JSON renderings. The 151 questions with an oversized supporting article showed the largest effect. In the title-first sentence-array rendering, packing gained 13.91 points for complete evidence and 19.21 points for evidence accompanied by its title in the same hit. The flattened text rendering tied on both measures in this subgroup. Averaged per question over those two renderings, attribution gained **9.60 points** (paired 95% interval **+2.64 to +15.86**). The limit was five hits sharing 512 delivered tokens, with a 1,024 UTF-16-unit indexing target. [Frozen development nominees](results/2026-11-25-json-record-nominees.json) · [Confirmation and sensitivity results](results/2026-11-25-json-records.json)

| Held-out rendering | Complete evidence, separate → packed siblings | Stored rows, change | All row tokens, change | Cold indexing tokens, change |
|---|---:|---:|---:|---:|
| Title first, sentence array | 2,792 → 2,836 | −15,642 (−25.57%) | −14,663 (−0.28%) | −13,896 (−0.27%) |
| Title last, sentence array | 2,772 → 2,819 | −15,642 (−25.57%) | −14,616 (−0.28%) | −13,849 (−0.27%) |
| Title first, flattened text | 2,864 → 2,865 | −20 (−0.04%) | 0 | 0 |

The title-first array fell from 61,180 to 45,538 rows. Its packed index used 5,162,656 cold tokens. The questions used another 82,658 tokens and the delivered excerpts used 1,961,511. For the 1,614 questions with only an oversized distractor, packing gained 0.74 points on both ordinary and attributable evidence (−0.23 to +1.71). Keeping every record whole gained 0.04 points in ordinary completion over sibling packing on the full two-view comparison (simultaneous 95% interval −0.66 to +0.73). The result supports keeping the record size target. [Costs and paired comparisons](results/2026-11-25-json-records.json)

**Repeating a preceding field** compared with sibling packing gained 25.17 points in attributable completion on the 151 affected questions (+11.19 to +37.41). Ordinary completion changed by −3.97 points (−13.10 to +5.48). Keeping each standalone field added no rows. Title-first arrays used 41,682 more row tokens (+0.81%) and 42,352 more cold tokens (+0.82%). Flattened text used 38,361 more row tokens (+0.75%) and 39,031 more cold tokens (+0.76%). Title-last arrays had identical costs and outcomes. After reviewing this tradeoff, the maintainer chose sibling packing alone for the general-purpose default.

**Omitting the standalone field** saved 2,711 array rows and 2,465 flattened-text rows. Title-only retrieval tied in all 1,758 and 1,637 eligible pools respectively. On affected questions the ordinary and attributable gains of 3.31 points both had intervals of −2.53 to +8.87. The lower limits missed the −1-point floor for promotion on savings. Keep standalone fields. [Per-question outcomes and costs](results/2026-11-25-json-records-paired.jsonl.gz)

**Which rule selected the nominees.** All three additions passed the frozen development filter on 7,404 questions. The first confirmation report incorrectly applied the savings-only subgroup floor to quality wins as well. Correcting the reporter to follow the written release rules changed eligibility for packing and repetition. It reproduced the frozen nomination and the entire paired-results file byte for byte. The latter's SHA-256 is `40486f33af90255c661ec84b8402d171a9da58a0d2ae39edd529f51e8dcaeaca`. The reported subgroup ordinary interval for packing was −1.53 to +14.96 around a gain of 6.95 points. Quality wins require the subgroup attribution gain and both full-frame loss guards. Savings-only wins also need the subgroup quality floor. [Prespecified release rule](../work/delimited-text-and-json-chunking-plan.md#release-decision) · [Paired reporter](json-record-report.mjs)

On WikiSQL every structured layout delivered the required row fields on 4,397 of 4,807 questions. All 29,283 rows fit the target. On FinQA, sibling packing delivered the evidence and column labels on 696 of 883 questions, against 689 for separate siblings, 688 with repetition and 228 with whole pages. For HotpotQA's development sensitivity checks, packing raised ordinary completion from 3,662 to 4,589 at a 500-unit target and from 5,022 to 5,107 with a 256-token cap. Peak scoring memory was 448 MiB on development and 359 MiB on confirmation. No structured layout needed model-level input pooling. Five WikiSQL plain-text inputs did. [Reproduction commands](README.md#compare-json-record-layouts)

The public output matched the independent sibling packer’s text, pointers and source ranges in all 66,185 corpus renderings and all 372 archived long-string layouts. Another 2,000 generated JSON documents covered nested containers, Unicode, zero and unlimited targets, and a token counter where joining strings can reduce the count. All 21,050 chunks matched. The final package passed 117 tests, strict TypeScript checks and four consumer installations. The public runtime grew from 1,201 to 1,318 JavaScript lines, including comments and blanks, with the same runtime dependencies.

## 2026-11-25 · Delimited records and JSON implementation

The public delimiter packer reproduced 668 chunks on the 2,000-event HDFS log and 1,021 on its headerless CSV representation. Both preserved all 1,998 individually fitting records under a 500-unit target. UTF-16 source offsets include the original CRLF pairs. The shared token splitter now returns indivisible over-limit fragments with their source information and excludes them from embedding requests.

The public JSON layout matched all 372 frozen hashes for English articles, Chinese articles, Casai fields and opaque identifiers. This covers the revised flattened Doctor Who article and the 32-URL pool. Reproduce with `node benchmarks/json-string-study.mjs --verify-runtime`. The corpus builder also reproduced 7,404 HotpotQA development pools, both checksums for the 4,084-question confirmation frame and its 151 affected questions, 4,807 WikiSQL queries on 1,806 tables, and 883 FinQA questions on 299 pages. [Layout replay](json-string-study.mjs) · [Corpus selection](json-record-corpora.py)

The packaged API passed with all optional parsers, none, JSON alone and Markdown alone. An independent delimiter matcher agreed on 20,000 deterministic cases. On 2,500 additional valid JSON strings with mixed literal and escaped surrogates, 18,695 returned fragments preserved every protected boundary and 2,433 over-limit fragments were marked. No over-limit input reached the test embedder. The original Casai field pilot also reproduced its report byte for byte with network access disabled.

At a 96-unit cap, binary search over protected JSON spans reduced lookups from 32,319 to 693 for 1,024 escapes, and from 130,175 to 1,524 for 2,048 escapes. The old and new splitters returned identical ranges on both inputs. Two adjacent fragments can each exceed the cap yet fit together, so the splitter tries that join before coalescing a longer overflow run. Before sibling packing, the runtime grew by 101 lines over the JSON baseline, from 1,201 to 1,302 lines across `src/*.js` and `config.js` including comments and blanks. The retrieval harness and corpus preparation are development-only.

**Nomination rule before confirmation.** Use paired development point estimates to nominate additions. Require the plan’s −1-point ordinary and attributable loss limits in each compact view and on the affected subgroup. Nominate a change for a greater-than-one-point attributable gain on affected title-first views, or for fewer rows or row tokens with neither increasing in any compact view. Evaluate packing first, then repetition on the nominated parent, then omission if repetition qualifies. Require the title-only loss limit wherever omission removes fields. Apply the prespecified confidence bounds on the untouched confirmation frame, stopping at the first failed addition. Match titles case-sensitively within their original article title or a single original sentence. Normalize whitespace in the search phrase and require a Unicode letter, mark, number or underscore to be separated at each end. The benchmark uses at most five ranked hits sharing 512 delivered tokens.

## 2026-11-25 · Preserving text that exceeds a token limit

Return the source fragment when legal cuts leave it over budget. A finite `maxChunkTokens` limits every string sent to the embedding provider. The planned `tokenLimitExceeded: true` result keeps the text and its metadata and omits the vector. Other chunks in the document remain eligible for the same batch. [Planned contract](../work/delimited-text-and-json-chunking-plan.md#when-text-exceeds-the-token-limit)

**Package comparison.** Ran Mastra `@mastra/rag@2.8.2` and Python `langchain-text-splitters==1.2.0` with `cl100k_base`, zero overlap and a one-token target. Mastra’s character strategy and LangChain’s recursive splitter both returned `A`, `😀`, `B`, with token counts 1, 2, 1. LangChain’s fixed token windows decoded the emoji alone as two replacement characters. With newline as the only recursive separator, both packages returned a 1,200-character, 600-token unbroken string at a target of 100 tokens. Mastra’s character strategy on the same string produced six 100-token pieces. [Mastra transformers](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/character.ts) · [LangChain recursive splitter](https://github.com/langchain-ai/langchain/blob/langchain-text-splitters==1.2.0/libs/text-splitters/langchain_text_splitters/character.py) · [LangChain token guide](https://docs.langchain.com/oss/python/integrations/splitters/split_by_token)

Checked the published Python `llama-index-core==0.14.26` source. Its token splitter logs a warning and emits an indivisible over-limit split. Its sentence splitter raises `ValueError` in that case. [Token splitter](https://github.com/run-llama/llama_index/blob/d8d7ffbb119a481147856392bba5bca549283030/llama-index-core/llama_index/core/node_parser/text/token.py) · [Sentence splitter](https://github.com/run-llama/llama_index/blob/d8d7ffbb119a481147856392bba5bca549283030/llama-index-core/llama_index/core/node_parser/text/sentence.py)

**Semachunk check.** The current public entry point throws before the callback for `A😀B` at one token and for `[0,"\u00e9",2]` at five raw UTF-16 units. An isolated prototype reused the span splitter and JSON parser. It kept the emoji and sent only `A` and `B` to the simulated embedding batch. Trying the adjacent piece also recovered ` 😀` in the quoted `"Wednesday 😀"` example. Under an eight-unit cap, adding the required `s: ` prefix brought the six-unit JSON escape to nine. The prototype retained its exact spelling, pointer `/1` and source offsets with either prefix visibility. All four fitting result occurrences were eligible for embedding. It returned a 10,000-unit leaf once when a fixed tokenizer overhead exceeded the budget everywhere. Retrying without optional context recovered both fitting pieces in a separate prefix fixture. These are splitter and batch-eligibility checks with no model calls.

## 2026-11-25 · Implementation-surface audit of the delimited text and JSON plan

Audited the full plan in each pass. Traced options through routing, parsing, sizing, overlap, embedding, returned ranges, declaration inference and the installed package. Worked backward from each proposed release decision through the rendered index, eligible questions, evidence spans, costs and comparison controls. Used different probes in successive passes so that the benchmark and implementation could disagree independently. [Revised plan](../work/delimited-text-and-json-chunking-plan.md)

**Pass 1. Independent inputs and controls.** Changing `chunkJson` to split strings would also change the historical control in the long-string benchmark. For a record with `body` set to `First block.`, a newline and 1,950 `A` characters, the planned first piece ends at source offset 24. The old control expects 1,975. Constructing the intact layout directly from the record and property spans reproduced all 371 frozen hashes. On the 7,404 valid HotpotQA development pools, the new string rule changes three distinct title-first array records, three title-last records and 4,322 title-first scalar records. The combined index has 242,533 distinct strings, up from 237,931. The plan separates the frozen oracle from the public implementation under test and bounds the replay cache by pool batch. [Study](json-string-study.mjs) · [Frozen layouts and outcomes](results/2026-11-25-json-string-policies.json)

Verified 4,807 WikiSQL lookups, 1,806 tables and 29,283 rows against the pinned archive (SHA-256 `755c728ab188e364575705c8641f3fafd86fb089cb8b08e8c03f01832aae0881`). JavaScript object-key ordering would reorder the columns for 64 questions. In FinQA, 1,063 row citations across 683 questions explicitly name a column in the annotation that the row itself omits. For example, the American Express row contains 637 and 647, and the header supplies “payments volume” and “total volume.” The plan now preserves WikiSQL member order and scores FinQA labels as well as cells. In 672 JSON syntax checks the strict parser agreed with native parsing. A valid decoded astral character written with one escaped and one literal surrogate could still be cut in half by the current hard splitter. Added all four spellings to the plan and made fragmented strings barriers to sibling packing. [WikiSQL source](https://github.com/salesforce/WikiSQL/tree/cffb423077756d04c1bac5bcd45167c86903fbcb) · [FinQA development data](https://github.com/czyssrs/FinQA/blob/0f16e2867befa6840783e58be38c9efb9229d742/dataset/dev.json) · [Current JSON splitter](../src/json.js)

**Pass 2. Counterexamples and decision rules.** The sentence segmenter breaks inside printable ASCII strings such as `AB!CD` and a URL with a query string. For 32 seeded 1,200-character URLs, both layouts delivered all 32 correct records at five hits sharing 512 tokens. Suppressing sentence edges inside non-space printable ASCII runs raised complete URL delivery from 0/32 to 32/32. It kept 370 of 371 existing layouts byte-identical. On the sole changed layout, flattened SQuAD *Doctor Who*, complete answers moved from 235/319 to 234/319. Across flattened English this is 8,478 instead of 8,479 out of 10,570. Chinese layouts are identical. The URL index went from 96 to 64 rows and from 13,395 to 13,643 cold embedding tokens. The two changed or new pools needed two provider requests and 40,180 additional input tokens. Incorporated the rule in the plan and made the historical benchmark control independent of the public splitter. Rerun the targeted comparison with `node benchmarks/json-string-study.mjs --identifier-audit report.json`. [Paired question outcomes and hashes](results/2026-11-25-json-identifier-audit.json)

Rebuilt the confirmation manifest from the checksummed 566,426,227-byte training archive. Both ID hashes match. Of 4,084 disjoint pools, 151 have an oversized supporting record and 1,614 have only oversized distractors. Kept confirmation rankings sealed. With all 151 subgroup outcomes tied, the registered two-view lower limit is −3.31 points. Reaching −1 point with pure ties under that calculation would take 505 independent affected questions. The plan keeps the simpler default on inconclusive savings and tests retaining a repeated field before testing its omission. An independent code-point delimiter oracle agreed on 20,000 cases. Eleven exact TypeScript assertions covered literal, possibly present and correlated options, including explicitly supplied vector types.

An explicit cap still bounds every emitted input, but the greedy hard splitter can fail despite a legal partition. At a one-token cap, `cl100k_base` charges two tokens for the bare emoji in `"Wednesday 😀"` and one with its preceding space. The opening quote, `Wednesday`, space plus emoji, and closing quote each fit. The audit initially recommended a clearer failure diagnostic. The subsequent decision preserves a fragment that still exceeds the cap after greedy splitting. [Overflow decision](#2026-11-25--preserving-text-that-exceeds-a-token-limit) [Hard splitter](../src/token-limit.js)

**Pass 3. What reaches the consumer.** A hit displaying two source ranges separated by a synthetic newline exposed intervals [0, 2) and [4, 6). Combining their minimum and maximum offsets would credit two missing characters. Six required rows also give complete unbudgeted source coverage while five hits cannot deliver them. The plan distinguishes indexing coverage from budgeted retrieval, specifies hit-local projections, and fixes tie ordering when repeated fields share the first source offset. To reuse scores from unchanged layouts, the targeted audit checks the input fingerprints, question identities, original Casai queries, model and budgets as well as the chunk hashes.

A prototype protecting whole decoded surrogate pairs passed 108 feasible and 60 infeasible character-count caps across all four raw spellings with and without a caller prefix. Packaged consumers passed offline with full dependencies, no optional parsers, the JSON parser alone, and the Markdown parsers alone. Added independent parser loading to the release checks, alongside source mapping, option typing, real tokenizer behavior, and staged promotion of benchmark candidates. [Shared delivery](delivered-context.mjs) · [Public entry point](../src/index.js)

**Pass 4. Full verification.** Rechecked the revised plan against the public entry point, all eleven findings in the supplied review, delimiter and overlap semantics, JSON types and limits, optional parser packaging, every corpus, both evidence scores, and the cost and promotion rules. Using the original CRLF source offsets reproduced 668 log chunks and 1,021 CSV chunks on the HDFS fixtures, covering 1,998 fitting rows in each. The independently rebuilt confirmation frame also reproduced 1,758 pools eligible for the title-omission lookup, including 260 where the first record qualifies. Both the full 371-pool report and the targeted identifier report replayed byte for byte with network access disabled. The packaged file list, strict TypeScript fixture and all 104 tests passed. This pass found no further substantial issue. The later overflow decision resolves the question of hard-cap partition discovery. [Plan](../work/delimited-text-and-json-chunking-plan.md) · [Identifier audit results](results/2026-11-25-json-identifier-audit.json)

## 2026-11-25 · JSON string boundaries and identifier retrieval

**Initial long-string decision.** Pack whole lines up to the existing `maxChunkSize` target. If a line alone is too large, use the existing sentence splitter inside that line. Allow a sentence or uninterrupted identifier to exceed the soft target. The later identifier audit adds a guard for URL punctuation inside printable ASCII runs. An explicit `maxChunkTokens` still enforces the caller’s model limit. [Plan and source-range rules](../work/delimited-text-and-json-chunking-plan.md#long-strings-and-identifier-lookups)

Compared nine layouts on the same records, raw JSON spellings, questions and source annotations. The indexing target was **1,024 UTF-16 units per value**. The retrieval budget was **512 model tokens total across the first five hits**, including separators and clipping. Casai also used a 1,024-token delivery budget. Used `text-embedding-3-small` at 1,536 dimensions, no overlap, prefix or hard indexing cap, and exact counts for delivery. The comparator called “forced cuts” bisects near whitespace and falls back to a character boundary while preserving escapes. Its first piece carries the key. On the original Casai guides it retrieved 8/12 complete answers at 512 tokens. The older whole-member pilot placed cuts differently and scored 9/12. [Benchmark and pinned inputs](json-string-study.mjs) · [Per-question outcomes, costs and hashes](results/2026-11-25-json-string-policies.json)

| Complete answer in one delivered hit | Keep whole | Forced cuts | Pack lines, then sentences |
|---|---:|---:|---:|
| Public Casai guide questions / 12 | 4 | 8 | 8 |
| English SQuAD, original paragraph breaks / 10,570 | 1,027 | 8,761 | 9,262 |
| Traditional Chinese DRCD, original paragraph breaks / 2,436 | 427 | 868 | 972 |
| SQuAD, paragraph breaks replaced by spaces / 10,570 | 1,038 | 8,762 | 8,479 |
| DRCD, paragraph breaks removed / 2,436 | 427 | 846 | 725 |

Each article was one `{title,body}` record. Joined the annotated paragraphs with two newlines for the original view. Included all SQuAD development articles and the DRCD development articles whose quoted body exceeded the indexing target. Kept the same questions in both views, including 29 in three DRCD articles whose flattened bodies fit the target. On the 12 original Casai prose queries, increasing the shared delivery budget to 1,024 tokens gave 4 complete answers with whole strings, 11 with forced cuts, 9 with lines and sentences, and 12 with whitespace packing.

For SQuAD and DRCD, rank chunks within the known article and require a full published answer at an annotated occurrence. Both renderings use the same questions. With paragraph breaks, the line-and-sentence rule gained **4.74 percentage points** over forced cuts for English (paired 95% interval +3.35 to +6.24) and **4.27 points** for Chinese (+2.03 to +6.33). Flattening the paragraphs reversed the comparison to **−2.68 points** for English (−4.37 to −1.05) and **−4.97 points** for Chinese (−7.41 to −2.54). Even an ideal first hit could expose only 1,077 flattened Chinese answers under sentence packing versus 1,259 under forced cuts at this delivery budget. Intervals resample whole articles 2,000 times. These measures describe passage retrieval on 48 English and 136 Chinese articles using one embedding model. [Pinned SQuAD 1.1 data](https://github.com/rajpurkar/SQuAD-explorer/blob/eee5fdbf62f8613a7812b03419e6b29617b74fd1/dataset/dev-v1.1.json) · [Pinned DRCD data](https://github.com/DRCKnowledgeTeam/DRCD/tree/ed294c593072546c659413e8223feffb857e412e) · [Paired interval calculation](markdown-decisions.mjs)

| Casai identifier lookup, 512 delivered tokens | Keep whole | Forced cuts | Pack lines, then sentences |
|---|---:|---:|---:|
| Correct record for real short digests, original 35-record index | 22/32 | 22/32 | 22/32 |
| Correct record for long high-entropy IDs, mixed 99-record index | 23/32 | 15/32 | 23/32 |
| Full long shared-prefix ID in one hit, mixed index | 32/32 | 0/32 | 32/32 |
| Correct record for a long high-entropy ID on its own line inside a prose field, separate 64-record index | 17/32 | 18/32 | 32/32 |

The two long-ID groups are synthetic 1,200-character controls derived from the real digests. All 32 shared-prefix queries retrieved the correct record in the mixed index with every layout, even when the literal had been cut. The high-entropy literals all exceed the 512-token delivery budget. At 1,024 delivered tokens the line-and-sentence rule returned 23 complete high-entropy IDs in the mixed index and all 32 inside prose. Forced cuts returned zero in each case. Adding the 64 distractors also pushed all 32 original short-digest records out of the top five under every layout. Keeping a literal intact helps when ranking finds it. [Casai fields and queries](json-field-corpus.mjs) · [Control construction and scoring](json-string-study.mjs)

The initial comparisons included whole strings, forced cuts, forced cuts restricted to a known prose field, and greedy packing at lines, whitespace, sentences, or sentences with a whitespace fallback. Sentence splitting used the library’s default `en` locale in both languages. Line-and-sentence packing and a whole-field test for any whitespace or sentence break were follow-ups. Lines alone recovered 9,295 English and 974 Chinese answers with paragraph breaks but only 427 Chinese answers after flattening. Whitespace alone reached 9/12 on Casai and 477/2,436 on flattened Chinese. Both the field-name rule and the whole-field test cut the ID when prose shared its field. Choosing actual cut positions preserved all 32 shared-prefix IDs in those prose fields at 512 tokens.

Indexing the mixed Casai pool took 166 stored rows for intact strings, 251 for forced cuts and 185 for line-and-sentence packing. The respective token sums over stored rows were 48,854, 48,868 and 48,854. After deducting identical inputs per index, cold embedding costs were 48,511, 42,201 and 48,511 tokens. Forced cuts saved embedding tokens because many synthetic prefix fragments were identical. On original English articles the three layouts stored 96, 2,464 and 2,126 rows and used 338,544, 340,017 and 339,040 cold tokens. The encoder pooled vectors for 13 intact English and five intact Chinese articles in each rendering. Every input from line-and-sentence packing fit the encoder directly.

Rerun from the repository root with `node benchmarks/json-string-study.mjs benchmarks/results/2026-11-25-json-string-policies.json`. The report includes ranked record hits before clipping, delivered record hits, complete answers or literals, and whether any indexed row could deliver the answer if ranked first. Fingerprints cover source text, answer spans, layouts and dense vectors. The 12 constructed Casai prose questions search across records from three public guides and a public lockfile. The synthetic groups test long identifiers that contain no line or sentence break.

The network-disabled replay reproduced all 371 pools byte for byte, SHA-256 `c8809bd50b0fb8ec2e67eb4d77911144ea2270ce0334c0ab146d6dda63e4ceb7`. The 35-record pilot also reproduced its original report after sharing the Casai fixtures. The strict TypeScript check and all 104 tests passed.

## 2026-11-25 · Token sizing and JSON field retrieval

**Character targets and token counts.** Measured 1,024-unit windows in seven translations of the same 30 UDHR articles, three public Casai guides and the distinct integrity strings in the Casai examples lockfile. Used the `para` elements inside each article, collapsed their internal whitespace and joined them with two newlines. Joined the guides with two newlines and the checksums with one. Took complete UTF-16 windows every 256 units plus the last full window. The overlapping windows describe these texts. Each table entry is the lower median of exact ordinary token counts. A four-units-per-token estimate predicts **256** in every row. [Translations at the measured revision](https://github.com/eric-muller/udhr/tree/e6a1b6f8cb048fba115d6b81bab47875a4eca0d8/data/udhr) · [Casai guides](https://github.com/geleto/casai/tree/6d93d977ec5dbe8e16630d35f5f1b1ca9999b22f/docs/matrix/articles) · [Integrity strings](https://github.com/geleto/casai-examples/blob/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/package-lock.json)

| Source | Windows | `cl100k_base` tokens | `o200k_base` tokens |
|---|---:|---:|---:|
| English | 30 | 187 | 187 |
| Spanish | 34 | 247 | 205 |
| Bulgarian | 33 | 493 | 293 |
| Arabic | 21 | 707 | 319 |
| Hindi | 31 | 983 | 292 |
| Japanese | 11 | 1,169 | 862 |
| Simplified Chinese | 6 | 1,156 | 763 |
| Casai guides, including code | 73 | 218 | 219 |
| Package integrity strings | 102 | 695 | 663 |

For the nominal 512-token estimate, the same method on 2,048 UTF-16 units gave `cl100k_base` medians of 375 in English, 987 in Bulgarian, 2,351 in Japanese, 441 in the Casai guides and 1,389 for integrity strings. Dividing UTF-8 bytes by four gave median signed errors of +36% for English, −36% for Japanese and −63% for integrity strings on the 1,024-unit samples. Casai can size its passages by characters with no runtime tokenizer. Preserve the caller-supplied counter for an explicit model limit and the exact answering-model count for a shared benchmark delivery budget. [Token budget](../src/token-limit.js) · [Tokenizer and its byte-average description](https://github.com/openai/tiktoken)

**Dense retrieval on Casai fields.** Stored the three published guides as `{title,body}` records and added 32 package records with distinct SHA-512 integrity values from the public lockfile. Searched the same 35 records for every query with `text-embedding-3-small` at 1,536 dimensions. Scored 12 constructed prose questions against source spans and 32 literal digest queries against the full checksum and its package name in a single delivered hit. The public data represents a guide-ingestion example. The digests are real short identifiers. [Reproduction script and pinned inputs](json-fields.mjs) · [Per-question results and layout hashes](results/2026-11-25-json-fields.json)

| Layout | Rows | Cold index tokens | Prose answers / 12 | Identifier hits / 32 |
|---|---:|---:|---:|---:|
| Intact scalar fields | 38 | 7,150 | 4 | 22 |
| Long fields cut at 1,024 UTF-16 units | 59 | 7,159 | 9 | 22 |
| Hard cap of 256 model tokens | 59 | 7,159 | 9 | 22 |

At five hits sharing 512 tokens, the 973-, 1,024- and 1,075-unit cuts produced the same text and source ranges as hard caps of 243, 256 and 269 tokens on these records. Lowering the delivery budget to 486 lost one prose answer on the split layouts. Raising it to 538 preserved the 512-token results. All 32 exact digests survived indexing under every layout. The 22 hits include ranking and clipping. This pilot motivated the later comparison on independent prose and long opaque values. [String policy comparison](#2026-11-25--json-string-boundaries-and-identifier-retrieval)

**Sensitivity to the indexing cap.** Repeated the 48-article SQuAD long-string comparison with the body cap about 5% either side of 256 model tokens. With unchanged within-article BM25 ranking rules and five hits sharing exactly 512 tokens, 243 tokens retrieved an annotated answer for **8,935 / 10,570** questions (84.53%), 256 for **8,911** (84.30%) and 269 for **8,888** (84.09%). The three indexes held 2,019, 1,910 and 1,798 rows respectively. This 0.44-point spread measures the effect of modestly changing an actual cap on English article fields. A fixed character conversion can miss that cap by much more on other inputs. [Source mapping and benchmark setup](#2026-11-25--re-audit-of-the-delimited-text-and-json-plan)

Rerun the dense pilot with `node benchmarks/json-fields.mjs report.json` from the repository root. Input downloads and embedding batches are checksummed and cached. Each indexing input in this fixture fits the encoder directly. A network-disabled replay reproduced the report byte for byte. The strict TypeScript fixture and all 104 runtime tests passed. Packed installations with and without optional dependencies verified plain-text chunking without a tokenizer, on-demand JSON loading and the missing-parser diagnostic. The public planning fixture retained all 12 complete scenarios and its separate active-scenario field. Checked 1,327 hard-limited fragments from 150 deterministic Unicode and escape fixtures. [Baseline implementation](../src/json.js) · [Planning fixture](https://github.com/geleto/casai-examples/blob/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/src/6-planning/input.json)

## 2026-11-25 · Re-audit of the delimited text and JSON plan

**Pass 1. Release decisions and public contracts.** Checked format routing, raw record spans, hard limits and overlap, JSON pointers and repetition, each retrieval comparison, type checks and packaging. The confirmation design allowed extra affected questions without establishing how many exist. Streamed the complete 566,426,227-byte pinned training archive and verified SHA-256 `26650cf50234ef5fb2e664ed70bbecdfd87815e6bffc257e068efea5cf7cd316`. Used labels only to identify valid supporting indices and oversize membership during this count. No confirmation rankings or embedding outcomes were used. [Pinned archive](https://huggingface.co/datasets/namlh2004/hotpotqa/blob/7e54db4656209750ff487f6fdf8e39a66dba136b/hotpot_train_v1.json)

Start with the 15,661 hard questions. Compare all context titles, including distractors, using NFC, Unicode case folding, underscores as spaces and collapsed whitespace. Require unique normalized titles within each pool, no title from any development pool, and valid nonblank supporting sentences at their original indices. This leaves 5,315 pools, 209 affected. Sort by SHA-256 of UTF-8 question ID, breaking ties by ID. Accept a pool only if all its titles are new among accepted pools. The resulting frame has **4,084 questions**, including **151 affected** in the title-first array, 128 in the title-first scalar, and 151 in their union. The first 1,000 accepted pools contain only 40 affected. Evaluate the complete frame, save the selected IDs with the result and report the subgroup separately. Its population is hard questions with disjoint titles.

The benchmark's percentile bootstrap returned `[0,0]` for 151 identical paired outcomes. Even if 1% of new affected questions suffer a loss, the chance of observing none in 151 is 21.9%. With no observed losses the exact two-sided 95% binomial upper limit for the loss probability is 2.41%. Report counts and observed differences for the fixed frame. Generalization across questions needs an interval that accounts for unobserved losses. [Existing bootstrap](markdown-decisions.mjs) · [Exact binomial limits](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats._result_classes.BinomTestResult.proportion_ci.html)

For the release limits, let each question contribute an integer change `j` in the number of complete views, with `m = 1` for one rendering and `m = 2` for the title-first average. For each integer `k` from 1 through `m`, count questions with `j ≥ k` and with `j ≤ −k`. The mean paired change is the sum of positive event rates minus negative event rates, divided by `m`. For the lower limit use exact binomial lower limits for positive rates and upper limits for negative rates, allocating `0.025 / (2m)` to each tail. Reverse the limits for the upper end. Under the independent-question assumption the union bound gives a conservative two-sided 95% interval and allows dependent renderings of the same question. All ties on 151 questions give a lower limit of −2.86 points for a single view and −3.31 for the two-view mean. Keep the one-point margin and mark unresolved comparisons inconclusive. The calculation belongs in benchmark tooling.

The earlier release rule could award field repetition credit for a gain already achieved by packing. Freeze a nonrepeating comparator and test the nominated field-repeating layout directly against it. A failed challenger leaves the qualified simpler layout available. Compute costs per rendering on the full frame, counting each stored occurrence even when its vector comes from cache. Rank only within the question's serialized pool. The existing HotpotQA aggregation selects the cross-question `pooled` result and the dense ranker caches a score array across its vocabulary for every query. Using pool-sized rankings also avoids that allocation. Of 18,001 distinct valid development facts, 7,631 have edge whitespace. Use the same trimmed content span in each rendering. The existing plain-text aligner successfully mapped 520 public packed layouts across the two title-first views. [Aggregation](markdown-decisions.mjs) · [Dense scorer](chunking.mjs) · [Source alignment](delivered-context.mjs)

**Pass 2. Source integrity, API types and long values.** Rechecked every section against the public entry point, parser, range packer, encoder and release rules. A Unicode delimiter reference and a literal matcher agreed on 40,328 short source/separator combinations. In `cl100k_base`, `Wednesday` costs one token and `esday` costs two. Splitting on `n` with a one-token cap shows why individual hard-limit barriers must be checked before joining. The published JSON parser gave separate source offsets for `"k":0` and `"\u006b":1` at the same pointer. With the current span splitter, rejecting a failing exact escape range before bisection preserved escaped backslashes, a 12-unit surrogate pair and six-unit escapes at all five feasible test caps. The other five caps raised the expected atomic-unit error. Restrict standalone-field omission to exact single-range matches on every surviving piece. This avoids discarding a chunk that also carries an inherited field. [Range packer](../src/packing.js) · [Span splitter](../src/token-limit.js)

A TypeScript 5.9.3 prototype exposed two problems in the proposed overload ordering under exact optional properties. `separator?: string` rejected explicit `undefined`. The ordinary text overload also captured a possibly present separator, leaving a narrowed `sourceRanges` typed as `unknown`. Allowing `undefined` on the option and requiring its absence on the plain-return overload fixed both checks. Use the shared finalizer for all ranged outputs, including hidden prefixes and duplicate texts at distinct source positions.

In the compact HotpotQA scalar rendering all 18,001 distinct development facts were fully visible within the first 512 tokens of their own first-ranked field, even when repeating an eligible title. That corpus cannot reveal how the soft target treats article-length values. For a separate check, serialized each of the 48 pinned SQuAD articles as one `{title,text}` record, joining original paragraphs with two newlines. Mapped every published answer offset to the escaped source and allowed any complete annotated alternative. All article records exceeded 1,024 UTF-16 units. Thirteen body members exceeded 8,192 tokens. [Pinned SQuAD data and offset conversion](corpora.mjs)

| Body layout | Questions whose answer fits in one first-ranked body excerpt | Questions with an answer in a delivered BM25 hit | Index rows including titles | Cold index tokens |
|---|---:|---:|---:|---:|
| Intact string | 1,032 / 10,570 | 1,032 (9.76%) | 96 | 338,496 |
| Whitespace-first cuts at 1,024 UTF-16 units | 10,455 / 10,570 | 9,044 (85.56%) | 2,464 | 339,949 |
| Hard limit of 256 tokens | 10,490 / 10,570 | 8,911 (84.30%) | 1,910 | 339,582 |

Used the same standalone title, zero overlap and no prefix, ranked only within the question's known article, and delivered at most five hits sharing 512 tokens. All cuts preserved the complete source and escapes. The first column measures single-hit visibility before ranking. The second uses BM25 and the actual delivery code. Using each original paragraph as the scalar instead made 10,565 answers visible in a first-ranked excerpt. Document the finite cap and paragraph-record options. Test the tokenizer-free string fallback separately on representative long fields and opaque identifiers before changing the default. [BM25 ranker](rag.mjs) · [Delivery](delivered-context.mjs)

**Pass 3. Packing order and benchmark reproducibility.** Rechecked the complete plan against format routing, source mapping, terminal cuts, packaging and the ranking implementation. In `{"a":"one","b":"two"}`, the 21-unit object needs descent at a soft target of 19. Its two members together use 19 units and eight `cl100k_base` tokens. Repeating the first field on a separate second chunk takes nine tokens, although the second member alone takes five. With an eight-token cap, testing the second member's standalone context first could prevent a valid join. Test the child's required limits, then the actual join with the open group's context. Reserve a new group's optional fields only when starting it.

Freeze the scalar policy before selecting and confirming the JSON layouts, since changing it alters which units compete for each hit. Specify the encoder, dimensions, handling of overlength inputs, tie order and the shared WikiSQL index. Save the invocation, input fingerprints, settings and paired outcomes with the implementation benchmark. The eligible WikiSQL tables provide a row-identity check. The distinct long-field and oversized-record comparisons each have their own evidence and decision. [Length-safe encoder](encoder.mjs) · [Row fixture counts](#2026-11-25--json-record-identity-and-public-return-types)

**Pass 4. Full verification.** Read all five sections again against the eleven review findings, including record boundaries, size and overlap rules, optional parsing, pointer and prefix mapping, benchmark candidates, decision rules and typed calls. No further substantial issue surfaced. The public entry point preserved distinct result vectors for duplicate text from a single provider input and round-tripped Markdown source ranges with visible and hidden prefixes. Reproduced the eight- and nine-token packing example, all three BM25 percentages and the interval bounds for 151 tied questions. Checked the local references and ran `npm test`. The strict TypeScript fixture and all 99 runtime tests passed.

## 2026-11-25 · JSON layout review and automated type checks

Rechecked the eleven findings from the third review against the pinned HotpotQA distractor archive, the existing chunkers and the package test command. The measurements below cover layout and indexing cost. The [subsequent audit](#2026-11-25--re-audit-of-the-delimited-text-and-json-plan) updates the confirmation frame and release comparisons. [Development archive and checksum](corpora.mjs) · [Tokenizer](encoder.mjs)

**1 and 11. Long strings and size limits.** With the review's `sentences.join('')` rendering, 346 of 7,405 pools have an oversized supporting `{title,text}` record at 1,024 UTF-16 units, and 4,451 do at 500. Those are whole-record counts. Among the 7,404 valid pools, the text member itself exceeds those targets in 276 and 4,025 pools. The candidate now carries context onto intact scalar bodies. Only the raw body consumes the soft target. The hard cap includes the repeated field, generated newline and caller prefix. Using the existing splitter and tokenizer on a Widget fixture with a 1,887-unit description member, the 16-unit name and newline could accompany the whole uncapped body. Reserving them before cutting at 64 tokens produced eight pieces, each retaining the name and its source range. The longest prefixed input was 63 tokens. A separate tight-cap check fell back to the bare body and preserved the caller's prefix. [Token budget and splitter](../src/token-limit.js)

**2 and 7. Release margin and question difficulty.** At the default, 385 valid development pools have an oversized supporting article. In 293 a supporting sentence in such an article lacks the full title by the review's case-insensitive substring test. A further 3,690 pools have an oversized distractor and fitting supporting articles. Changes to distractors can affect ranking and clipping. The 293 count measures title mentions and gives no ceiling on retrieval gains or losses. All 7,405 development questions are labelled hard. The first 8,000,000 bytes of the pinned training archive contain 1,284 complete pools (269 easy, 791 medium, 224 hard). Of those hard pools, 76 have unique titles disjoint from development. Only IDs, levels and context titles were needed for this check. [HotpotQA](https://hotpotqa.github.io/) · [Pinned training archive](https://huggingface.co/datasets/namlh2004/hotpotqa/blob/7e54db4656209750ff487f6fdf8e39a66dba136b/hotpot_train_v1.json)

Confirm on fresh, title-disjoint **hard** questions at 1,024 characters, with five hits sharing 512 tokens and no hard per-chunk cap. Require the lower paired 95% bound on the attributable-completion gain to exceed +1 point in the prespecified oversized-supporting-record subgroup. Average the two title-first shapes per question. Guard ordinary and attributable completion at −1 point in every compact shape on the representative full sample. Keep any extra subgroup questions out of that estimate. A cheaper candidate can win with the same full-sample guards and a subgroup lower bound of at least −1 point if neither indexing cost rises. An improvement that costs more goes to the maintainer. Freeze the nominee and sample before confirmation.

**3. Zero size.** Existing text blocks split two sentences at zero, and Markdown returned two table row chunks with their header. JSON at zero will descend through every nonempty container, preserve a body for every scalar or empty container and disable sibling packing. Optional repeated context can accompany each leaf. Unlimited size keeps a fitting record whole. [Existing size tests](../tests/chunk-text.test.js)

**4. Standalone repeated fields.** Recounted the first 2,500 development pools at the default with `cl100k_base`, zero overlap and no hard cap. All 24,872 article occurrences contribute to the full index. Of 2,310 oversized articles, 259 still have a fitting `"sentences":[…]` member. In 17, even both members fit together after removing the outer braces. The review's script descended every such array. Keeping fitting source spans gives the following logical indexing costs.

| Layout | Rows in oversized articles | Tokens in oversized articles | All index rows | All index tokens |
|---|---:|---:|---:|---:|
| Single-child descent | 21,044 | 696,757 | 43,606 | 3,477,578 |
| Packed siblings | 6,741 | 683,319 | 29,303 | 3,464,140 |
| Packed with repeated title, keep standalone title | 6,741 | 719,271 | 29,303 | 3,500,092 |
| Packed with repeated title, omit fully covered title | 4,448 | 700,596 | 27,010 | 3,481,417 |

The 2,293 standalone title chunks are 34.0% of packed rows in oversized articles and 7.8% of the full packed index. Removing them saves rows, while the last layout still uses more tokens than plain sibling packing. Compare keeping and omitting them on retrieval, including title-only queries. Suppress a chunk only when every detached piece already carries its entire source range. Preserve original chunks after a fallback, for mixed unrepeated fields and at size zero.

**5 and 6. Formatting and Unicode.** Two-space indentation inside the serialized array increased article-span length by 8.0% across 73,700 occurrences. Articles above 1,024 units rose from 6,954 to 8,780. Pools with oversized supporting articles rose from 385 to 563 (562 among valid pools). In the first 1,000 pools, 3,302 of 9,927 articles contained non-ASCII text. ASCII escaping alone raised indexing tokens 6.3% for those articles and 2.3% overall. The quoted JSON string `"Café Müller — 東京"` cost 9 tokens literally and 25 escaped. Run paired development checks for each rendering. Keep exact source spelling for display and indexing. Reconsider decoded embedding text only if retrieval loss warrants its extra mapping and token-budget logic. [Python JSON serialization](https://docs.python.org/3/library/json.html#json.dump)

**8. Generic references.** Nominate the stronger generic reference on development and compare it with the chosen structured layout on confirmation. If its full-sample ordinary completion leads by more than one point at the lower paired 95% bound, document the workload, budget, measured gap and strategy guidance in the README. Switching JSON defaults also requires preserving pointers, source ranges, record boundaries and sizing.

**9. Parser depth.** The published parser recursively visits arrays and objects. A 64-level valid fixture parsed successfully and an iterative walk visited its 68 syntax nodes. Use an explicit stack in the chunker and translate only a parser stack exhaustion into a JSON nesting diagnostic with its cause. Test that diagnostic separately from syntax, option and token-limit errors. A fixed portable maximum cannot be inferred from one JavaScript runtime. [Parser source](https://github.com/microsoft/node-jsonc-parser/blob/v3.3.1/src/impl/parser.ts) · [JSON parser limits](https://www.rfc-editor.org/rfc/rfc8259#section-9)

**10. Type checks.** Added TypeScript 5.9.3 as a locked development dependency. `npm test` now runs the exact-type fixture and the runtime suite. `npm run test:types` runs just the compiler. The strict check and all 99 runtime tests passed. In an isolated clean install, restoring the old text/HTML union made `npm test` exit with five failed type assertions. [Test commands](../package.json) · [Public API type fixture](../tests/types/chunk-text.ts)

## 2026-11-25 · Full-plan audit for delimited text and JSON

**Pass 1 – public contract, parser, packing and scoring.** The published `jsonc-parser@3.3.1` returned a tree alongside diagnostics for a trailing comma and comments. With strict flags and `allowEmptyContent`, empty input and JSON whitespace produced no root or errors. NBSP produced `InvalidSymbol`. Removing exactly one initial BOM preserved the second BOM as an error at original offset 1. The value in `{"\\u0061":1,"a":2}` has path `/a` at both occurrences, while asking for the property node's path returns the root. The library's array path helper searches siblings with `indexOf`. Carry the decoded key or current index during the traversal already needed for chunking. [Parser source](https://github.com/microsoft/node-jsonc-parser/blob/v3.3.1/src/impl/parser.ts) · [Pointer semantics](https://www.rfc-editor.org/rfc/rfc6901)

Checked literal delimiters against UTF-16 boundaries, raw-gap overlap, conditional `auto` routing, output prefixes, optional parser loading and the public type declarations. A source-slice tokenizer cap of six split a protected twelve-unit escaped surrogate pair into two pieces with the existing Markdown helper. JSON needs strict atomic cuts. On a two-hit fixture, `deliver` and `evidenceScore` awarded complete evidence for a title in one hit and its sentence in the next. The plan now specifies a per-hit attribution check after clipping. [Token splitter](../src/token-limit.js) · [Evidence scorer](delivered-context.mjs)

**Pass 2 – public defaults, independent data and release criteria.** The earlier 256-token profile omitted the public default of no hard cap. Across the 7,404 valid development pools, 4,075 contain an article over 1,024 UTF-16 units and 3,076 contain one over 256 tokens. Adding that cap changes which pools require descent in 66 cases. In 385 pools a supporting article exceeds the character target. None of the 66,629 distinct compact article texts exceeded the benchmark encoder's 8,192-token limit. These are input measurements. The new layouts have no retrieval scores yet. [Pinned development data](corpora.mjs) · [Benchmark tokenizer](encoder.mjs)

All development labels were used to inspect title loss. In a two-way split by the first SHA-256 byte of the question ID modulo two, 1,711 of 3,681 and 1,739 of 3,723 questions shared an article title with the other half. Reserve the separate labelled training archive for confirmation (SHA-256 `26650cf50234ef5fb2e664ed70bbecdfd87815e6bffc257e068efea5cf7cd316`). A 4 MiB source-only preflight found 673 complete question pools, 226 eligible by title after excluding the development corpus and 222 mutually disjoint. The preflight used IDs and context titles. For the benchmark, apply the same valid-annotation checks as on development, sort by hash of question ID, retain whole pools whose titles are disjoint from development and earlier selections, and record the frozen IDs and sample size. Compare titles after NFC normalization, case folding, replacing underscores with spaces and collapsing whitespace. [Pinned training archive](https://huggingface.co/datasets/namlh2004/hotpotqa/blob/7e54db4656209750ff487f6fdf8e39a66dba136b/hotpot_train_v1.json)

This pass proposed the protocol below. Later audits refined the rendering controls, confirmation sample and release rules. [Third review](#2026-11-25--json-layout-review-and-automated-type-checks) · [Current confirmation protocol](#2026-11-25--re-audit-of-the-delimited-text-and-json-plan)

- Rank the exact indexing text in each original pool. Compare both field orders on the same questions and candidates. Keep zero overlap, five hits and one 512-token delivery budget including joins. Primary sizing is 1,024 characters with no hard cap. Change one limit at a time on development (500 characters, or a 256-token cap at 1,024). Report the full sample and the subset with any oversized article, including distractors. WikiSQL remains a check of row identity.
- Locate the gold field and sentence spans while serializing each article. Preserve clipped hit boundaries in `deliver`. Credit each distinct gold fact once. Its title field or a complete title mention from the same article must be visible in that hit, including qualifiers. Test an escaped title, a short title inside a longer word, repeated sentences, a separate title-only hit and a title or sentence clipped midway. Count complete questions and use the question pool as the paired bootstrap unit.
- Select one candidate on development and freeze it before confirmation. At the default size, require the lower paired 95% bound for attributable complete questions to exceed a one-percentage-point gain over single-child descent on title-first data, with the ordinary score bounded to at most one point of loss. Guard both scores on title-last data at the same one-point loss margin. A cheaper candidate can also win if the lower bounds for both scores in both orders are at least −1 point and at least one indexing cost falls without increasing the other. Measure rows and cold embedding tokens on the exact stored strings, independent of API cache hits, and report delivered tokens. A quality gain that increases indexing cost needs an explicit trade-off decision. An inconclusive comparison keeps the baseline.

**Pass 3 – source fidelity and consumer behavior.** Eight literal delimiter cases covered metacharacters, overlapping matches, a partial surrogate and mixed line endings. A separator containing a lone carriage return must skip the carriage return of CRLF. With a seven-unit target and overlap of three, the existing range packer returned `a||b`, `b | c`, `c | d`, `d | e` from the original gaps. The plan spells out trimming, atomic newlines and the treatment of JSON Lines as text.

Compared 26 nonblank JSON samples with native `JSON.parse`. The parser's strict flags agreed on all, including malformed numbers, escaped backslashes, duplicate keys and unpaired escaped surrogates. On a BOM-prefixed nested array, two mapped ranges reproduced the preceding scalar and the sibling body including its original comma and CRLF. The second item in the nested body had pointer `/0/a~1b~0/items/1`. The plan now specifies raw sibling slices, terminal splitting before optional context and one serialized input per question pool or table.

Installed the current package tarball into two temporary consumers. Plain text and callback-free validation passed with and without optional dependencies. The normal install parsed Markdown and HTML, and the minimal install produced their documented missing-parser errors. The exact-type fixture and an inline typed-vector callback passed against the packaged declarations on TypeScript 5.2.2 and 5.9.3. The newer compiler preserved its narrower `Float32Array<ArrayBuffer>` result. [Public types](../src/index.d.ts) · [Type fixture](../tests/types/chunk-text.ts)

**Pass 4 – final full-plan audit.** Rechecked both public entry paths, sizing and overlap, strict parsing, mapped ranges and pointers, optional package loading, type inference and the release comparison against the five review findings. A five-case attribution fixture using the benchmark's tokenizer and delivery code credited a complete title and fact together. It rejected separate hits, the same sentence from another record, a clipped fact and a partial title. All 99 runtime tests passed. The plan's local links and heading anchors resolve. This pass found no further substantial issue. Held-out retrieval will decide the optional JSON layout during implementation.

## 2026-11-25 · JSON record identity and public return types

### Title loss in oversized JSON

Reproduced the review on all 7,405 HotpotQA development questions. Of 18,005 supporting-fact annotations, 18,004 map to a supplied sentence. Serialize each article as compact `{title, sentences}` JSON. When the article exceeds the character target, detach the title and greedily pack adjacent sentences. The review's figures reproduce with a case-insensitive title substring after removing a final parenthetical qualifier. Several facts can share a chunk. [HotpotQA](https://hotpotqa.github.io/) · [Pinned archive and checksum](corpora.mjs)

| Character target | Fact annotations in oversized articles | Facts in chunks missing the name | Distinct such chunks within question pools | Questions affected | Questions affected with repeated field |
|---|---:|---:|---:|---:|---:|
| 500 | 7,493 | 2,663 | 2,373 | 2,041 | 180 |
| 1,024 | 501 | 147 | 118 | 114 | 11 |

The last column reserves room for the exact preceding `"title":…` member and a newline. It omits that context when the member exceeds 128 UTF-16 units or a single body unit would exceed the target with it. We also checked the full title, including qualifiers, on the 7,404 questions with valid annotations and unique context titles. Allowing fitting sibling members to pack, the number of facts in chunks missing that full title fell from 3,517 to 363 at 500 characters and from 214 to 30 at 1,024. These checks measured text present before retrieval, with zero overlap and no token cap or embeddings.

Across all articles and distractors in the valid question pools, repeated fields increased the packed index from 164,923 to 170,063 chunks (+3.12%) and the total UTF-16 length by 6.55% at 500. At 1,024, chunks rose from 87,104 to 87,509 (+0.46%) and text length by 0.93%. Each repeated field and body mapped back to its source slice. Embedding-token cost and retrieval gains remain to be measured under the hard cap.

Checked **every candidate row** in the 1,806 WikiSQL tables serving the 4,807 eligible development lookups. Of 29,283 compact header-keyed row objects, 27 in six tables exceed 500 characters, zero exceed 1,024, and zero exceed 256 `cl100k_base` tokens. Only three questions target one of those 27 rows. At 1,024 the structured candidates produce identical index text across these tables, including the distractors. Use WikiSQL to test row identity and complete fields. Use HotpotQA to choose how oversized records split. [Pinned WikiSQL data](https://github.com/salesforce/WikiSQL/tree/cffb423077756d04c1bac5bcd45167c86903fbcb)

### JSON release decision

Later reviews refined the sizing rules and verified the confirmation frame. [Third review](#2026-11-25--json-layout-review-and-automated-type-checks) · [Current release rules](#2026-11-25--re-audit-of-the-delimited-text-and-json-plan)

- Ship strict JSON records, source ranges, pointers and hard-limit handling. Single-child descent is the baseline. Test individual children and packed siblings on oversized records, each with and without repeating preceding scalar fields. Text packing and one known record with a generic hard split are reference points only.
- For repetition, take the contiguous suffix of scalar members immediately before the detached body in the same object, up to 128 UTF-16 units including interior gaps. Use source order and field size alone. Inherit the range through arrays, replace it with a nearer eligible range on descent and clear it at record boundaries. Include it once per body, followed by a newline. Map both slices to their original offsets and keep the pointer of the body. Charge the repeated text, join and caller prefix to the applicable limits. Drop the optional context when it cannot accompany a body unit. Cover a later identifier, an unrelated preceding field, nested arrays, an already-present range and an oversized field in tests.
- Rank actual indexing text against all original distractors. Use five hits sharing 512 delivered tokens, a 256-token per-chunk cap, zero overlap and targets of 500 and 1,024 characters. Keep the same questions at both sizes and report the oversized-article subset separately. Score complete supporting sentences from the correct articles **after clipping**. For complete attributable evidence, each supporting sentence also needs its full article title visible in the same delivered excerpt, either as a field or in the body. Score each fact once. A pointer, external metadata or a separate title-only hit earns no title credit. Record indexed rows, embedding tokens and delivered tokens including repeated fields.
- Select one structured candidate on development and freeze it before testing title-disjoint confirmation pools. At comparable indexing cost, require the lower paired 95% confidence bound on its attributable-evidence gain over single-child descent to exceed one percentage point, with ordinary complete evidence also bounded to at most one point of loss. A smaller index can win if one indexing cost falls, the other does not grow, and the interval bounds the loss on both scores to one point. Otherwise keep single-child descent.

### Other review findings

- **CSV headers.** The HDFS comparison excluded the header and measured intact rows. Newline splitting carries no column names forward. Use a CSV parser upstream for quoted multiline records. When names matter, use header-keyed JSON objects or a Markdown table. Verified repeated header ranges on three Markdown row chunks. A row that exceeds the hard cap with its header falls back to fragments. [Markdown table implementation](../src/markdown.js)
- **TypeScript results.** Corrected callback-free default, text and HTML inference to `Chunk[]`. The five call signatures now share one optional-callback argument tuple for text/HTML, Markdown and an unknown format. The proposed two call-shape signatures worked with inferred vectors. With `chunkText<Float32Array>(…)`, TypeScript used the default options type and rejected existing calls with Markdown or a variable format. Widening that default lost the precise Markdown result. Three signatures preserve those calls and need one case per new result shape. The regression fixture checks exact types because assignment to `Chunk[]` also accepts the erroneous union. Passed under TypeScript 5.2.2 and 5.9.3 with `tsc --strict --exactOptionalPropertyTypes --noEmit --target es2022 --module nodenext tests/types/chunk-text.ts`. [Type fixture](../tests/types/chunk-text.ts) · [TypeScript generic defaults](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-parameter-defaults)
- **Unknown options and callback behavior.** Drop the proposed runtime rejection for `separators`. Like `chunkSize`, it never shipped, and JavaScript callers may pass through unrelated options. Keep validation of the supported singular `separator` when it ships, including the requirement for explicit `blocks` or `pack`. Confirmed that callback-free calls check batch and cache limits and reject explicit semantic scoring or vectors. The review requires no change to that runtime behavior.

## 2026-11-25 · Automatic chunking without an embedding callback

When the callback is omitted, `auto` uses the existing packer and returns chunks without vectors. `combineChunks: false` still gives the initial units. Explicit semantic scoring and an explicit request for output vectors each require a callback. With a callback, `returnEmbedding: false` suppresses the output vectors while allowing semantic scoring.

Compared callback-free `auto` with explicit `pack` on all 54 paragraphs of the first pinned SQuAD article, `Super_Bowl_50`. Used plain paragraphs, HTML paragraph tags and Markdown with the article title as a heading. All nine runs matched the full chunk objects and made zero embedding calls. At the default size, at 2,048 characters, and at 2,048 characters with a 256-token cap, 64-token overlap and hidden prefix, the respective chunk counts were 83 / 18 / 39 for text and HTML and 43 / 21 / 39 for Markdown. This checks layout, overlap and citation metadata. [Corpus and checksum](corpora.mjs)

The callback change added six net runtime lines, from 1,124 to 1,130 across `src/*.js` and `config.js`, including comments and blank lines. Plan delimited text and JSON as two reviewable changes in one release. The first reuses the range packer directly. The second adds record identity and escape-safe cuts, and its sibling-grouping choice depends on held-out retrieval results.

## 2026-11-25 · Delimited records and JSON plan review

Drop the proposed `recursive` strategy. The existing three layouts have measured uses. On the same 646 Markdown questions, `semantic` led packing with five hits sharing 512 tokens, `pack` led semantic merging with five whole hits, and `blocks` led semantic merging with unlimited hits and a 512-token body and delivery limit. Keep `auto` as the selector. On 244 meeting questions, the recursive reference gained 0.86 recall points over packing (95% interval −2.27 to +4.33). The new comparison tests how each layout preserves individual lines. [Markdown retrieval profiles](results/2026-11-24-chunking-modes.json) · [Meeting results](results/2026-11-24-paragraph-modes.json)

### Delimited records

Compared the public text `pack` and `blocks`, the existing range packer over trimmed newline-delimited source spans, and LangChain's `RecursiveCharacterTextSplitter` 1.0.2 with its default separators. Each run used a 500-character target, zero overlap, no token cap and no embeddings. The two real inputs represent the same 2,000 HDFS events. The structured CSV has no quoted multiline records and its header was excluded. The generated rows used `event=NNN service=ledger action=store region=north status=complete` and `NNN,ledger,store,north,complete`, numbered `001` through `040`. [Pinned HDFS files](https://github.com/logpai/loghub/tree/dd61d0952749ee7963bde24220d1be5ede023033/HDFS) · [Range packer](../src/packing.js)

| Source | Current `pack` or `blocks`, chunks | One chunk per line | Line packing, chunks | Recursive, chunks | Fitting rows covered by current / line packing / recursive |
|---|---:|---:|---:|---:|---:|
| Generated log | 1 | 40 | 6 | 6 | 0 / 40 / 40 |
| Generated CSV | 1 | 40 | 3 | 3 | 0 / 40 / 40 |
| HDFS log | 114 | 2,000 | 668 | 679 | 34 / 1,998 / 1,998 |
| HDFS CSV | 198 | 2,000 | 1,021 | 1,031 | 10 / 1,998 / 1,998 |

A row counted as covered when its complete whitespace-normalized text occurred in a chunk of at most 500 characters. Line packing and recursion returned byte-identical chunks on both generated fixtures. Each HDFS representation had two individually oversized rows. Line packing kept those whole under the soft character target. Recursion split them and kept every chunk within 500 characters.

Recursion does preserve some boundaries that flat packing can cross. With a 19-character target, flat packing starts `P0\n\nP1 title` while the reference emits `P0`, then `P1 title\nP1 first`, before continuing the second paragraph. Defer ordered separators unless held-out questions that need evidence from the same section show a gain over the best single separator. A future comparison must pack siblings separately at each level and flush when descending.

### JSON evidence and benchmark selection

At 500 characters, packing adjacent members of the same parent joined `"name":"Widget"` with `"price":3` and left the 1,500-character description separate. Putting the description between those fields left all three separate. On 1,000 small numbered properties, the same packer produced 27 chunks (maximum 493 characters) versus 1,000 individual fields. All 12 Casai scenarios also fit individually at 1,024 characters. That fixture establishes record integrity but cannot identify which packing rule produced Mastra's result. [Casai planning fixture](https://github.com/geleto/casai-examples/blob/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/src/6-planning/input.json)

- **WikiSQL for row lookup.** Of 8,421 development questions, 4,807 across 1,806 tables qualify. Keep nonaggregated selects with nonempty text-equality predicates on other columns, exactly one matching row after trimming and case folding, a nonempty answer, distinct column names and complete rows. Serialize each table as an array of row objects in original column order. Score the condition fields and answer field from the annotated row within the delivered excerpts. Only three qualifying questions refer to rows longer than 500 characters and none exceed 1,024. This corpus can test record identity. [Pinned WikiSQL data and question format](https://github.com/salesforce/WikiSQL/tree/cffb423077756d04c1bac5bcd45167c86903fbcb)
- **HotpotQA for oversized records.** Keep each question's distractors in their original order as an array of `{title, sentences}` articles. Use the published supporting title and sentence indices for scoring. Of 7,405 development questions, 7,404 had unique context titles and valid annotations. At 500 characters, 1,081 cited multiple sentences within at least one oversized supporting array. For 656, the span covering all cited sentences of such an article could fit. Greedy sibling packing kept that evidence together for 607, versus zero for one sentence per chunk. At 1,024 characters the counts were 76, 65 and 61. These counts measure evidence placement for one supporting article. The retrieval benchmark must recover the question's complete evidence across articles. [HotpotQA dataset](https://hotpotqa.github.io/) · [Archive checksum](corpora.mjs)

Compare the structured JSON candidates on matched questions and budgets. Use disjoint WikiSQL tables and title-disjoint HotpotQA pools for tuning and confirmation. Plain-text packing and one record with a generic hard split are references. The updated protocol tests sibling packing and parent-field repetition independently and scores record identity in delivered text. [Record identity results and release criteria](#2026-11-25--json-record-identity-and-public-return-types)

### Other review decisions

- Use one spelling, `separator`, for both text layouts. Removing the plural eliminates the reason for a separate `delimiter` name. The plan covers option errors, positive `blocks` overlap, repeated separators, non-overlapping literal matches, explicit LF/CRLF equivalence, and exact inner whitespace and offsets. Only the existing paragraph splitter treats whitespace-only lines as paragraph breaks. A hard token cap uses the same record fallback in either layout. Raw ranges, prefix offsets, hidden `embeddingText`, TypeScript and README coverage apply to both text and JSON.
- Keep LangChain in the benchmark environment. Its character fallback split `A😀B` into two isolated UTF-16 surrogate halves between `A` and `B` at size one. A single `|` separator returned a fitting input whole and attached the pipe to the next chunk when splitting. The reference package depends on `js-tiktoken` and has an `@langchain/core` peer. Semachunk already packs Markdown by slicing original ranges. [Published reference package](https://registry.npmjs.org/@langchain%2ftextsplitters/1.0.2) · [Markdown packer](../src/markdown-merge.js)
- Use external `jsonc-parser@^3.3.1`. The 3.3.1 release (June 24, 2024) is MIT, dependency-free and 212,821 bytes unpacked. The ESM-only 4.0 prereleases are outside that range. Strict diagnostics and named imports worked on Node 24. The plan specifies BOM offset adjustment, root and escaped pointers, root-array behavior, JSON Lines as delimited text, format-specific size and prefix handling, and an actionable missing-parser error. Trim the unrelated converter table and retain one sentence on using packages and original code. [Stable package](https://registry.npmjs.org/jsonc-parser/3.3.1) · [Prerelease metadata](https://registry.npmjs.org/jsonc-parser/4.0.0-next.2)
- Protect escape spellings in keys and values. Passing the escaped surrogate pair `\ud83d\ude00` as a single protected range to the current splitter still yielded offsets `[0,6)` and `[6,12)` when only six raw code units fit. Add an indivisible-escape check at the hard cap and cover escaped backslashes, whole pairs, literal emoji and an impossible prefixed cap. [Source span splitter](../src/token-limit.js)

## 2026-11-25 · Converting inputs to Markdown

Compared basic HTML extraction with two upstream converters, `node-html-markdown@2.0.0` and `rehype-remark@10.0.1` with `remark-gfm@4.0.1`. Selected the `article` element on Casai and `main` on W3C before conversion. Packed all three representations at 1,024 characters per chunk with zero overlap and no embeddings. Both converters retained the following structures in parsed Markdown. Every returned Markdown source range matched the converted string.

| Source | Headings | Links | Code blocks | Tables | Passages from basic HTML | Passages from either conversion |
|---|---:|---:|---:|---:|---:|---:|
| [Casai retrieval guide](https://casai.run/posts/retrieval-to-grounded-answers/) | 5 | 10 | 1 | 0 | 6 | 9 |
| [W3C tables with one header](https://www.w3.org/WAI/tutorials/tables/one-header/) | 6 | 14 | 3 | 3 | 4 | 16 |
| [W3C tables with irregular headers](https://www.w3.org/WAI/tutorials/tables/irregular/) | 5 | 12 | 2 | 2 | 7 | 14 |

Both converters also preserved a nested list, a relative link destination, a JavaScript fence and the header/value pairs of a small table in a controlled fixture. Both dropped the three explicit HTML heading IDs. Two headings titled `Limits` received distinct Markdown `sectionId` offsets, but neither offset identified the original anchor. On the W3C irregular tables, neither conversion retained the six explicit row or column spans. These checks measure structure and citation fidelity. They do not establish a retrieval winner.

**Decision.** Keep plain text and Markdown as the chunking inputs and retain basic HTML extraction for convenience. For rich HTML, the application can select the article body, convert it, and keep the original anchors when citations need them. The one-call converter covered the common structures tested here. Applications needing site-specific repairs can use the configurable rehype pipeline. LaTeX conversion and PDF extraction, OCR and page mapping also belong at ingestion. [NodeHtmlMarkdown](https://github.com/crosstype/node-html-markdown) · [rehype-remark](https://github.com/rehypejs/rehype-remark)

Moved the five existing Markdown parser packages from optional peers to optional dependencies, alongside the HTML parser. A clean production install of the packed module processed text, Markdown and HTML with 67 installed packages totaling 3.42 MiB, including semachunk. With `--omit=optional`, the same tarball processed text with two packages totaling 0.11 MiB. Reinstalling with `--include=optional` restored both parsers. All 68 locked dependency versions and integrity hashes were unchanged.

## 2026-11-25 · Mastra splitter behavior and code reuse

Checked the tagged source and ran `@mastra/rag@2.8.2` against small inputs with zero embedding calls. Its document source directory is identical to 2.8.1, the version used for the Casai fixtures below. [Mastra strategy dispatch](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/document.ts#L170-L199)

- At a 100-character size setting, 60 copies of the word `word` separated by spaces formed one 299-character semachunk `pack` passage and three 99-character Mastra `sentence` passages. Semachunk's character target preserves a single long sentence. Mastra's default sentence fallback splits it at words.
- With the delimiter `|`, a size of 100 and zero overlap, Mastra `character` returned three separate passages from `alpha|beta|gamma`. Mastra `recursive` with separators `['|', '']` returned the whole string. A shared implementation would need to preserve this difference for exact compatibility. Mastra's `latex` and default `markdown` each reproduced their `recursive` language preset on a multi-section input. [Character and recursive implementations](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/character.ts)
- On a Markdown document with two short sibling sections, semachunk's default returned each with its own heading path. Mastra `semantic-markdown` joined them at a threshold of 100 tokens, using the heading hierarchy. [Mastra section merging](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/semantic-markdown.ts)

Use Mastra's outputs as compatibility fixtures for the behaviors semachunk chooses to support. For any future source copy, the tagged license places Mastra-authored splitter code under Apache 2.0 and retains original licenses for incorporated third-party components. The published 2.8.2 tarball includes `LICENSE.md` and has no separate `NOTICE` file. [Mastra license](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/LICENSE.md) · [Apache 2.0 redistribution terms](https://www.apache.org/licenses/LICENSE-2.0)

For semachunk, ordered separators could feed original source spans to the existing range packer. An explicit record delimiter in `blocks` would keep short records separate. For a JSON input, tested `jsonc-parser@3.3.1` with comments and trailing commas disabled. Mastra's JSON splitter serialized the integer `9007199254740993` as `9007199254740992`. Slicing the original source at the parsed node's offset and length preserved the digits, and the node's path gave the JSON Pointer `/records/a~1b~0c/0/id`. This supports using a parser for locations and implementing record selection and size limits locally. [JSON parser](https://github.com/microsoft/node-jsonc-parser) · [Mastra's JSON implementation](https://github.com/mastra-ai/mastra/blob/05cad114ab838c3248e21dd8673203c636611cb1/packages/rag/src/document/transformers/json.ts#L497)

Exact token windows would require token boundaries from the caller's tokenizer. With `cl100k_base`, `A😀B` occupies four tokens. Decoding one token at a time produced replacement characters for both pieces of the emoji. A fixed-stride API would need to specify how it preserves source text at such cuts. The current token ceiling already keeps Unicode code points intact.

## 2026-11-24 · Chunking capabilities for Casai

Casai's RAG example already indexes semachunk vectors in Vectra and stores just the passage text as metadata. Its retrieval guide reranks passages before passing them to the model. A local integration check used Casai's embedder and reranker with mock models on the Markdown source of that guide. The default produced eight passages in one embedding batch. All eight source ranges reproduced the original text, and the reranker's `originalIndex` recovered the chosen passage's source ID and heading. This checks citation handling. Retrieval quality needs judged questions. [Casai index example](https://github.com/geleto/casai-examples/blob/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/src/7-rag/index.ts#L75-L87) · [Casai retrieval guide](https://casai.run/posts/retrieval-to-grounded-answers/)

Compared native splitters from `@mastra/rag@2.8.1` on the same Casai inputs.

- **HTML headings.** Packing the published guide's article at 1,024 characters produced six passages. The passage on embedding-model compatibility carried only text. Mastra's `html` with `h1`–`h3` header selectors gave five passages and attached the correct heading title and XPath. Neither result carried the actual HTML heading ID. Retaining section boundaries and native IDs in semachunk's HTML input would let Casai link to the original section directly. [Published section](https://casai.run/posts/retrieval-to-grounded-answers/#keep-the-index-and-query-embeddings-compatible)
- **JSON records.** Casai's planning fixture contains 12 named scenarios. Plain-text packing at 1,024 characters with a 256-token hard cap produced eight passages. Seven formatted scenarios and six minified scenarios retained their key and all fields in one passage. Mastra's `json` (`maxSize: 1024` characters) kept all 12 complete under their original keys in both renderings. Its longest passage measured 212 tokens. Simply indexing each scenario with its key also kept all 12 intact, at 99–128 tokens each (`cl100k_base`). Use one passage per record as the baseline when testing path-aware splitting on lookup questions and oversized records. This fixture measures record integrity. [Planning fixture](https://github.com/geleto/casai-examples/blob/4b4e083d2962e5c517239b05ac5be7aeefc1acf6/src/6-planning/input.json)
- **Cross-heading Markdown.** On the guide's Markdown source, Mastra's `semantic-markdown` with `joinThreshold: 500` yielded three chunks, one spanning two second-level headings. At 256 it yielded five. Both runs kept a 702-token section intact. A join threshold controls which sections combine. An embedding model's hard input cap is a separate requirement. [Markdown fixture](https://github.com/geleto/casai/blob/6d93d977ec5dbe8e16630d35f5f1b1ca9999b22f/docs/matrix/articles/retrieval-to-grounded-answers.md)

Keep the four public strategies. A configurable recursive splitter would serve applications with explicit record delimiters. One separator also covers the common literal-delimiter use of Mastra's `character`. On 244 meeting questions, LangChain recursion reached 32.18% evidence-token recall and sentence packing 31.32% at five hits sharing 512 tokens (paired difference +0.86 points, 95% interval −2.27 to +4.33). Defer fixed token windows until an application needs an exact stride, cross-heading Markdown joins until questions require evidence from small sibling sections, and LaTeX until Casai indexes native TeX sources. [Meeting comparison](results/2026-11-24-paragraph-modes.json) · [Mastra strategies](https://mastra.ai/reference/rag/chunk)

## 2026-11-24 · Auditing automatic strategy and size selection

Test the current public default, each explicit strategy, and per-chunk character targets of 250, 500, 1,024 and 2,048. Keep the existing hard-token comparisons separate. Use five hits sharing 512 delivered tokens as the primary retrieval profile. Also check other hit counts, token-only budgets, whole hits, lexical ranking and hybrid ranking. Score complete evidence for contracts, papers, financial reports and multi-hop articles and annotated-token recall for meetings. Retain the separate SQuAD answer-span, WikiSection boundary, historical plain-text RAG, timing and memory metrics.

Use the previously studied Markdown samples, plain contracts and QMSum test meetings for development. Reserve the next disjoint Markdown document groups, their plain-text renderings and QMSum validation meetings for confirmation. Freeze two simple document signals before confirmation. A mode candidate keeps existing paragraphs as blocks when at least four blank-line paragraphs are present and most fit within one chunk and occupy at least half its target. A size candidate rounds the median nonempty paragraph length up to 500, 1,024 or 2,048 characters (clamped to this range). Test each separately and together against fixed format defaults. All rules see only source text, format and caller limits. Rebuild and rerank mixed document pools.

Prefer the fixed choice within one point of the best development primary score when it costs less to index. To ship a document rule, require a positive lower bound on its held-out primary gain against the fixed choice (paired source-group bootstrap, adjusted for the three challengers), no secondary-profile loss above one point on average, and improvement on more than one source family. Evaluate size alternatives within each strategy as well as mode alternatives at the same size. Record the hindsight winners separately from rules available at indexing time. Explicit caller limits take precedence.

Select each format's fixed nominee on complete evidence only, giving each of the four retrieval tasks equal weight. Keep meeting recall, answer-span hits and boundary F1 separate. Test the nominee against the former default on new sources. For a change, require either a positive paired 95% lower bound or a primary score within one point with at least 15% lower indexing cost. Also compare with the simple fallback of packing Markdown at its previously confirmed 1,024-character target and semantic text at 500. If the nominee fails to transfer, use the validated simpler fallback. Preserve previously validated explicit caps unless a direct same-cap comparison supports a change.

Repeat the old default, fallback, frozen nominees and three candidate rules on the same confirmation sources with `text-embedding-3-large` at 1,536 dimensions. Keep the tokenizer, source groups and retrieval limits fixed. A second encoder can check transfer of a nominated rule, but cannot establish generality across languages or an unrelated family of models.

Before opening confirmation, the legacy suite showed that 500-character semantic text had 95.42% SQuAD answer hits and 41.60% WikiSection boundary F1. At 1,000 characters these fell to 86.73% and 28.92%. Both suites remove paragraph structure. Add one prespecified guard against enlargement when the input contains fewer than two blank-line paragraphs, and adjust all four rule intervals to 98.75%. Compare this guard with ordinary fixed sizes and the original versus flattened evidence study. For a general plain-text default, treat losses above two points on either separate quality objective as material; a rule that only recognizes how the test fixture was rendered is insufficient.

**Development selected `pack/1024` for Markdown and `semantic/1024` for text.** At five hits sharing 512 tokens on the 646 questions, Markdown packing scored 57.93% versus 58.45% for semantic merging at 1,024 characters and used 29% fewer embedding tokens. On the same four tasks rendered as text, semantic merging at 1,024 scored 56.23%, above packing at 54.00% and the former semantic default at 48.34%. These are nominees for this retrieval objective. [All twelve strategy and size combinations](results/2026-11-24-auto-development.json)

The historical RAG runner now projects intact paragraph chunks onto the same source token coordinates as sentence joins. This handles the inserted space when a segmenter splits inside an unspaced quotation. All 264 shared explicit-control counts for complete evidence reproduced the earlier OpenAI report across dense and BM25 rankings, including both HotpotQA pools. [Plain-text RAG results](results/2026-11-24-auto-rag.json) · [Answer-span and boundary results](results/2026-11-24-auto-quality.json)

The conservative paragraph-mode trigger never fired on the new document groups with the larger encoder. As a diagnostic, replay the earlier study's broader heading-or-protected-block rule on these groups and compare all three strategies at exactly 1,024 characters with hard caps of 256 and 512 tokens. This checks what happens at the old automatic switch and whether a rule that actually selects blocks helps. These follow-ups reuse confirmation data and are descriptive.

**Decision.** With no size override, `auto` now packs Markdown at **1,024 characters per chunk**. Previously it packed at 500. Each explicit Markdown strategy already defaulted to 1,024. Plain text and HTML keep semantic merging at **500 characters per chunk**. A positive overlap chooses packing and caller-supplied sizes take precedence. An explicit 1,024 now reproduces the omitted Markdown target. On larger Markdown targets, automatic semantic scoring still requires a hard token limit of at least 256 or an unlimited token limit.

The `public` rows in the development, confirmation and transfer reports record the default before this change. After updating the implementation, running `chunkText` without strategy or size options reproduced the selected text and source-range hashes in all nine confirmation cohorts on **both** encoders. The runs reused cached vectors with zero new embedding tokens. The `default` rows in the historical, hard-limit and unused-source reports exercise the updated public API.

At **five dense hits sharing 512 tokens per query**, packing Markdown at 1,024 versus 500 raised complete-evidence retrieval from 48.04% to 56.79% on the four confirmation tasks. The paired gain was +8.75 points (95% interval +5.07 to +12.80). On the same source groups the larger encoder gave 54.11% and 61.80% (+7.69, +4.34 to +10.95). Indexing tokens fell 0.6% on both. On plain-text renderings, increasing the semantic target from 500 to 1,024 gained 4.93 points (+0.47 to +9.33) on the small encoder and 7.06 (+3.72 to +10.44) on the large one, at roughly 45% more indexing tokens. The separate short-answer and segmentation tests favored smaller chunks. [Confirmation grid](results/2026-11-24-auto-confirmation.json) · [Larger encoder](results/2026-11-24-auto-transfer.json)

**Which signals failed?** Rounding median paragraph length to a chunk target lost 7.58 Markdown points on the small encoder (98.75% interval −12.03 to −3.60) and 6.91 on the large one (−10.93 to −2.92). The majority-fit mode trigger selected no blocks on these source groups at the nominated size. Adding it to the median rule gave the same results. The broader rule that selects blocks for headings or protected elements reduced Markdown scores from 56.79% to 51.49% and from 61.80% to 54.77%. Requiring two blank-line paragraphs before enlarging protected short-answer and boundary scores, but also kept short chunks for speaker-turn transcripts. On the larger encoder that cost 7.42 meeting recall points. None of these cues met the release criterion.

At the 1,024-character target, adding a hard per-chunk cap of 256 tokens gave packing versus scoring 58.57% / 59.13% on the small encoder and 62.17% / 62.24% on the large one. With a 512-token cap the corresponding scores were 56.98% / 57.92% and 61.42% / 62.15%. Packing used 26% fewer indexing tokens in each comparison and led scoring by 3.2–4.6 points when five hits shared 1,024 delivered tokens. With the character limit removed and 256 tokens per chunk, scoring led packing by 3.59 points on the small encoder and 0.98 on the large. This supports the simpler inclusive packing cutoff at 1,024 characters and retaining scoring at the established token-only setting. [Small encoder](results/2026-11-24-auto-limits-small.json) · [Large encoder](results/2026-11-24-auto-limits-large.json)

The 334 confirmation questions and their source groups were disjoint from this study's development samples and the five earlier Markdown samples. They were not all new to the project. Older plain-text archives contained 11 of the 12 contracts, 10 of the 24 papers, and 89 of the 635 article titles. None of the 34 financial pages overlapped. The 35 validation meetings were disjoint from the 35 development meetings but had appeared in earlier speaker-turn and expansion experiments.

For a further Markdown check, exclude every source ID in the project’s archived corpus manifests before selecting cases. Freeze the comparison to the former and new defaults plus 2,048-character packing. On 200 questions from **3 contracts, 24 papers, 38 financial pages and two multi-hop pools**, 500, 1,024 and 2,048 characters scored **51.86%, 56.54% and 55.67%**. The paired 95% interval for 1,024 versus 500 was −0.15 to +9.17 points. Only three unused contracts remained, and all three sizes tied on their 19 questions. At 2,048 papers improved from 35.71% to 47.14%, while financial reports fell from 70.21% to 55.32%. This check gives the same overall direction, with substantial uncertainty about the size of the gain. [Unused sources, question outcomes and retrieval profiles](results/2026-11-24-auto-unused.json)

**Where the default misses.** The following are measured winners among twelve layouts on the 334 confirmation questions, using the small encoder, dense retrieval and five hits sharing 512 tokens. Each number is the percentage receiving complete annotated evidence. Each cell with a tie shows one winning layout. These per-task maxima were identified after scoring. The plain and Markdown views use the same sources and questions. [Per-query outcomes, all ranks and delivery limits](results/2026-11-24-auto-confirmation.json)

| Input and task | Shipped `auto` | Best strategy at the default size | Best size for the default strategy | Best joint choice |
|---|---:|---|---|---|
| Markdown contracts | 26.52% | semantic 30.30% | 250, 28.79% | semantic 500, 31.82% |
| Markdown papers | 56.47% | pack 56.47% | 2,048, 57.65% | semantic 2,048, 58.82% |
| Markdown financial reports | 66.04% | pack 66.04% | 1,024, 66.04% | semantic 2,048, 67.92% |
| Markdown multi-hop articles | 78.13% | semantic 79.69% | 1,024, 78.13% | semantic 1,024, 79.69% |
| Plain contracts | 40.15% | blocks 40.91% | 500, 40.15% | blocks 500, 40.91% |
| Plain papers | 18.82% | blocks 20.00% | 2,048, 38.82% | blocks 2,048, 44.71% |
| Plain financial reports | 71.70% | pack 75.47% | 2,048, 81.13% | semantic 2,048, 81.13% |
| Plain multi-hop articles | 67.19% | pack 71.88% | 2,048, 78.13% | pack 1,024, 78.13% |

On the **same Markdown financial pages**, packing at 250 led with an allowance of 256 delivered tokens and as many hits as fit (37.74%). Semantic merging at 2,048 led with five hits sharing 512 (67.92%). Packing at 2,048 delivered complete evidence for every question when five whole hits were allowed. The future hit limit and excerpt budget are properties of the retriever. An indexing rule that sees only the document cannot distinguish those three requests.

Across all four Markdown tasks, the best dense layout with unlimited hits was `blocks/1024` at 256 retrieved tokens (40.15% versus 36.62% for `auto`) and `blocks/2048` at 512 (59.73% versus 57.17%). For five whole hits, `pack/2048` led (76.91% versus 68.58%) and could deliver more text. At five hits sharing 512, `semantic/2048` led dense retrieval (58.42% versus 56.79%), `semantic/1024` narrowly led BM25 (42.16% versus 42.08%), and the shipped `pack/1024` led hybrid retrieval (51.74%). The larger semantic layout cost 39% more indexing tokens and had scored below `pack/1024` on development. Treat the maxima in each profile as descriptive, including the near ties. [All twelve layouts, seven delivery profiles and three rankers](results/2026-11-24-auto-confirmation.json)

**Plain-text objectives.** On the small encoder, 250-character packing retrieved a SQuAD answer span for 430 of 437 questions with 256 tokens of retrieved text. Automatic semantic merging at 500 found 417, and semantic merging at 1,024 found 376. On WikiSection, the 500-character semantic default led all twelve layouts at 41.60% exact boundary F1, falling to 31.33% at 1,024. On the 237 meeting questions, the same change *increased* recall of annotated tokens from 18.27% to 24.93% (+6.66 points, +4.00 to +9.43). Semantic at 2,048 reached 27.04% there, but on the 244 development meeting questions it scored 28.97% versus 29.08% at 1,024. Packing at 1,024 reached 24.39% on confirmation with 78% fewer indexing tokens than semantic at the same size. The larger encoder also favored longer chunks on meetings and shorter ones on SQuAD and WikiSection. [Independent task metrics](results/2026-11-24-auto-confirmation.json) · [Second encoder](results/2026-11-24-auto-transfer.json)

On the historical plain-text RAG suite with a 512-token retrieval budget and unlimited hits, `auto` found complete evidence for 41/100 contract, 15/54 paper and 51/64 pooled multi-hop questions. A higher cutoff and 250-character target led on contracts (50/100), blocks led on papers (21/54), and `auto` tied for best on the multi-hop set. HTML extraction on paragraph-wrapped versions of all 16 held-out SQuAD and WikiSection articles matched the text layout across all four public modes with deterministic embeddings. Native HTML retrieval, books, non-English sources and downstream answer generation were outside these datasets. [Historical plain-text RAG](results/2026-11-24-auto-rag.json)

The live plain-text cutoff sweep reproduced the archived calibration choices and the full confirmation scores, costs and intervals. The shared cosine cutoff was 0.05 at 500 characters. Positive-overlap `auto` also reproduced all 24 measured Markdown packing layouts, including source ranges, for the 256- and 512-token caps and a 25% overlap on the three mode-study samples. The strategy and size grid above used zero overlap. [Cutoff sweep](results/2026-11-24-retrieval-budget-cutoffs.json) · [Overlap and recursion controls](results/2026-11-24-chunking-modes.json)

**Historical replay.** All five earlier Markdown samples favored 1,024 over 500 characters for packing at five hits sharing 512 tokens. The gains were 2.22, 4.34, 1.08, 3.41 and 4.74 percentage points on 190, 175, 199, 172 and 676 questions respectively. On the 676-question replication, increasing the plain semantic target from 500 to 1,024 improved complete evidence from 49.42% to 55.56% with source formatting and from 51.88% to 56.03% with whitespace collapsed. For meetings, the plain semantic scores of 22.47% and 29.08% repeated under both renderings. A rule that reduces size whenever a document occupies one physical line would lose that meeting gain despite identical words and questions. [Historical layouts and scores](results/2026-11-24-auto-history.json)

On the same replication with a **256-token chunk target and 512 retrieved tokens per query, with no hit-count limit**, automatic Markdown scored 57.99% complete evidence on original sources. The published recursive controls scored 54.91% without overlap and 57.17% with overlap. On original meetings, automatic plain text retrieved 29.40% of annotated evidence tokens versus 32.18% for zero-overlap recursion. The zero-overlap recursive implementation reproduced all ten original and flattened source hashes and scores. The other recursive and LangChain semantic controls use their archived measurements on the same verified sources, annotations, pools and encoder. The Python splitter's uncapped output and the historical MiniLM results have different indexing or tokenization conditions. [Historical replay](results/2026-11-24-auto-history.json) · [Published recursive and semantic controls](results/2026-11-23-semantic-formatting.json)

As a follow-up, test whether *knowing that the text is a speaker-labelled transcript* justifies the larger semantic target. QMSum uses passage-length turn annotations. For an independent short-answer objective, render the pinned FriendsQA test file with the same speaker-per-line convention, join scenes in chronological order within each episode and search that episode. Verify every annotated speaker or utterance span against the rendered source. Freeze semantic at 500 and 1,024 and packing at 250 and 1,024, five hits sharing 512 delivered tokens, with 256- and 1,024-token secondary profiles. Pair by episode and repeat on both encoders. The transcript identity is supplied by the dataset, so this tests even a perfect source classifier. [FriendsQA annotations](https://github.com/emorynlp/FriendsQA)

All 2,105 alternative answer spans mapped exactly for 1,201 questions from 113 scenes in eight episodes. At five hits sharing 512 tokens, increasing semantic text from 500 to 1,024 characters **lost** 8.58 points on the small encoder (69.61% to 61.03%, paired 95% interval −12.79 to −4.40) and 7.08 points on the large one (71.11% to 64.03%, −9.72 to −4.02). At five hits sharing 1,024 tokens, the *same questions and indexes* favored the larger chunks on both encoders (74.19% versus 70.27% and 77.02% versus 72.11%). At 256 retrieved tokens, packing at 250 characters led all four tested layouts. Speaker labels identify dialogue reliably here, but cannot identify the retrieval objective or the search budget. Keep the plain-text default and document the meeting-specific result. [Small encoder](results/2026-11-24-auto-dialogue-small.json) · [Large encoder](results/2026-11-24-auto-dialogue-large.json)

The synthetic merge suite preserved source text in all five workloads. Both cache policies produced the same 512 chunk boundaries, with peak live vector storage sampled at provider entry falling from 47,142,912 to 19,021,824 bytes at a 256-vector limit. Both Markdown character settings produced 1,025 chunks for the long section and 2,560 for many short sections, with identical body-range hashes and indexing token counts. These synthetic inputs contain frequent structural boundaries. Timing samples were collected on a shared machine and do not establish a latency difference between the defaults. [Priority merge](results/2026-11-24-auto-merge-performance.json) · [Cache memory](results/2026-11-24-auto-memory.json) · [Markdown timings](results/2026-11-24-auto-markdown-performance.json)

## 2026-11-24 · Character targets for the public strategies

This earlier comparison set the defaults for explicitly chosen strategies. The subsequent automatic-selection audit extended the 1,024-character Markdown default to `auto`. [Automatic strategy and size decision](#2026-11-24--auditing-automatic-strategy-and-size-selection)

Compare per-chunk targets of 500 and 1,024 UTF-16 code units with no token cap and zero overlap. Exercise the public `blocks`, `pack` and `semantic` strategies on the two previously studied Markdown samples, the same contracts as plain text, and the 35 QMSum transcripts. Hold queries, embeddings, ranking and delivery limits fixed. The primary retriever returns up to five hits and delivers at most 512 tokens of excerpts per query. Also check five hits with 1,024 tokens and unlimited hits with 512 tokens.

Retain the published `auto` default. For an explicit Markdown strategy, adopt the larger default if it improves primary retrieval in both samples, its paired source-group interval clears zero (98.33% for three strategies), and neither secondary profile loses more than one percentage point. For plain text, require support on both contracts and transcripts using their own metrics. Keep the existing value where evidence is inconclusive. These reused samples can guide a default, but cannot independently confirm it on other corpora, encoders or languages.

The primary results below use five hits and **512 tokens of retrieved text per query**. Markdown has 646 questions across contracts, scientific papers, financial reports and multi-hop article pools, with the four tasks weighted equally. Plain text uses the same 281 contract questions and separately the 244 questions from 35 meetings. Contract and Markdown percentages measure complete annotated evidence. Meeting percentages measure the fraction of annotated evidence tokens retrieved. Intervals pair layouts per question and resample whole documents or multi-hop pools within each task. The encoder was `text-embedding-3-small`. [Settings, source hashes, query outcomes and costs](results/2026-11-24-strategy-sizes.json)

| Input | Strategy | 500 characters per chunk | 1,024 characters per chunk | Paired change in points (98.33% interval) |
|---|---|---:|---:|---:|
| Markdown | `blocks` | 40.64% | 52.31% | +11.67 (+8.24 to +15.42) |
| Markdown | `pack` | 49.21% | 57.93% | +8.72 (+4.89 to +12.34) |
| Markdown | `semantic` | 45.50% | 58.45% | +12.95 (+9.37 to +17.00) |
| Plain contracts | `blocks` | 39.15% | 39.15% | 0.00 (−3.90 to +3.65) |
| Plain contracts | `pack` | 37.37% | 31.67% | −5.69 (−10.11 to −0.81) |
| Plain contracts | `semantic` | 40.57% | 36.65% | −3.91 (−8.27 to +1.61) |
| Plain meetings | `blocks` | 24.26% | 28.29% | +4.03 (+0.21 to +7.64) |
| Plain meetings | `pack` | 24.26% | 28.29% | +4.03 (+0.21 to +7.64) |
| Plain meetings | `semantic` | 22.47% | 29.08% | +6.60 (+4.14 to +9.04) |

**Adopt 1,024 UTF-16 units for explicit Markdown strategies.** All three improved on both samples and both secondary delivery profiles. All three also needed fewer index rows and fewer total embedding tokens at the larger target. At that size, `pack` and `semantic` differed by 0.52 points on the primary profile (paired 95% interval for semantic minus pack −1.81 to +2.91). Packing used 664,652 embedding tokens versus 939,522 for semantic merging, a 29.26% saving. The largest task gains came from scientific papers. [Character-target measurements](results/2026-11-24-strategy-sizes.json)

**Keep 500 for plain text and HTML.** Larger transcript chunks helped at both five-hit budgets, but increasing the target lost 5.69 points for packed contracts on the primary profile. The transcripts have single newlines between speaker turns, so `blocks` and `pack` produced identical layouts there. HTML shares the text layout algorithms after extraction and has functional coverage only. **Keep `auto` at 500 for all formats** to preserve the plan's default layout and indexing behavior for existing callers. For a new general-purpose Markdown passage index, explicit `pack` uses the larger measured target without intermediate scoring. Hard token limits remain opt-in and an explicit `maxChunkSize` overrides the default. [Reproduction commands](README.md#compare-chunking-modes-and-retrieval-limits)

After applying the defaults, calling the public API with both size options and the tokenizer omitted reproduced all 44 expected sets of chunk texts and source ranges (four strategies across eleven format and corpus combinations). The replay used cached embeddings throughout. All 96 tests and the TypeScript declaration check passed.

## 2026-11-24 · Public strategies and packed chunk overlap

Expose the three measured layouts as `blocks`, `pack`, and `semantic`, with `auto` selecting the existing format and capacity defaults. Use `chunkingStrategy` and `chunkOverlap` as the public option names. A positive overlap requests packing. Repeat trailing whole units in returned chunks within their existing Markdown boundaries, and require room for new source material in each chunk.

Replay the previous mode study and compare each existing layout, indexing cost and retrieval outcome with its recorded result. Add one fixed overlap target of one quarter of the body limit (64 of 256 or 128 of 512 tokens), matching the earlier recursive comparison. Compare directly with ordinary packing on the two confirmation samples, totaling 646 questions, using the same paired source groups and five delivery configurations. The primary metric remains complete evidence within five hits and 512 delivered tokens. These samples have already been studied. This checks the public implementation and the tradeoff for an opt-in setting.

| Markdown retrieval configuration | Pack, zero overlap | Pack, 25% overlap target | Paired difference in points (95% interval) |
|---|---:|---:|---:|
| Five hits, 512 tokens | 54.49% | 53.19% | −1.31 (−3.03 to +0.57) |
| Three hits, 512 tokens | 52.29% | 51.03% | −1.26 (−2.97 to +0.61) |
| Five hits, 1,024 tokens | 71.74% | 70.87% | −0.87 (−2.26 to +0.54) |
| Unlimited hits, 512 tokens | 54.97% | 53.62% | −1.35 (−3.04 to +0.54) |
| Five whole hits | 75.14% | 73.99% | −1.15 (−2.24 to −0.15) |

Across both body caps, the overlap target increased cold indexing tokens from 1,329,330 to 1,404,401 (+5.65%) and rows from 7,683 to 7,875 (+2.50%). Five whole hits with overlap delivered 978 tokens on average, up from 948. Keep overlap opt-in with a default of zero. The percentages weight the four tasks equally. Each interval resamples complete source groups and pairs both caps. [Markdown results and per-question outcomes](results/2026-11-24-chunking-modes.json)

The public strategies reproduced all 360 earlier Markdown measurements and all 18 plain-text measurements, including indexing costs and per-query outcomes. The extended Markdown report includes 24 additional overlap measurements. All 94 tests passed. A separate 1,200-case comparison checked packed text, HTML and Markdown against an independent search over possible suffixes, including literal Markdown source ranges. [Plain-text results](results/2026-11-24-paragraph-modes.json)

## 2026-11-24 · Chunking modes and retrieval limits

Test four layouts on the updated Markdown parser: original units, section-aware greedy packing, original-boundary semantic merging, and the zero-overlap recursive reference. Use the earlier 676 questions for development. Freeze the candidates before testing two additional samples, each with 12 contracts, 24 papers, 24 financial reports and two 32-question multi-hop pools. Exclude the earlier Markdown documents and question IDs. Use mixed prose-and-table FinQA training questions from reports absent from the entire development and test files because the earlier study exhausted those files' eligible reports.

The primary retriever takes the first five hits and delivers at most 512 tokens. Repeat with body caps of 256 and 512. Check three hits with the same token budget, five hits with 1,024 tokens, unlimited hits with 512 tokens and five whole hits. Score the literal delivered evidence and record actual tokens and index rows. Each task has equal weight. Resample source groups, including whole multi-hop pools, and keep repeated body caps paired.

Compare existing automatic selection with three cheap rules. Given a delivery budget and a hit limit, divide the former by the latter. First, pack adjacent original units up to this target while preserving fitting paragraphs. Second, use the target as the actual chunk cap and split oversized paragraphs. Third, choose original units if their mean length reaches the target, packed units if even their mean packed length falls short, and semantic merging otherwise. Also test a rule that uses document structure alone: keep original units in documents with an explicit section or protected block and use semantic merging elsewhere. Always rerank across the actual mixed document layouts. Use development results to nominate one rule, then compare it with existing automatic selection and the best fixed native mode selected on development. For a new automatic rule require a positive difference on each fresh sample and a pooled paired 95% interval above zero against the existing default, or at least 15% fewer cold embedding tokens with a pooled lower bound above −1 point. Prefer the simpler fixed mode when it meets the same criteria.

Check what a literal paragraph mode would do on plain text. Use the 24 fresh contracts and the 35 QMSum test meetings at a 256-token body cap. Compare blank-line paragraph preservation with sentence units, greedy sentence packing, the current full-text semantic merger, and zero-overlap recursion. A fitting paragraph stays whole and an oversized paragraph packs sentences within its own boundaries. Measure five hits with 512 tokens, 512 tokens alone, and five whole hits. Contracts use complete evidence and meetings use annotated-token recall. The meeting set was used in earlier studies.

Development froze semantic merging as the strongest fixed native mode (56.22%) and the document-length rule as the accuracy nominee (56.31%). Before examining either fresh sample, add a cost nominee to reflect the second acceptance criterion above. Choose the most accurate development candidate within one point of semantic merging that saves at least 15% of cold embedding tokens. Only soft-target packing qualified (55.55%, 31.5% fewer tokens). Use paired 97.5% intervals for the two nominee decisions. Keep 95% intervals for descriptive comparisons.

Also check fixed choices made when building an index for a known retrieval configuration. On development the strongest native mode was semantic for three or five hits capped at 512 tokens, packed for five hits capped at 1,024 tokens or delivered whole, and original units for a 512-token budget alone. Check those choices on the fresh data, including the earlier review's specific 512-token body and delivery setting. The three finite combinations do not establish a continuous switch point.

The recursive reference exceeded the body limit on nine development rows across the two caps. Add a diagnostic that splits only an oversized final recursive result using its literal source range and the same hard tokenizer check. Retain the native result and the frozen nominees for comparison.

### Results and recommended modes

The two fresh samples contained 369 and 277 questions. The table shows complete evidence delivered in up to five hits and 512 tokens. Percentages weight the four tasks equally and average the 256- and 512-token body caps. Indexing tokens sum the work to build both indexes on both samples. [Per-question Markdown results](results/2026-11-24-chunking-modes.json)

| Markdown layout | Sample A | Sample B | Pooled | Cold indexing tokens |
|---|---:|---:|---:|---:|
| Original blocks | 48.89% | 61.22% | 53.99% | 1,317,354 |
| Greedy packing | 52.10% | 58.74% | 54.49% | 1,329,330 |
| Semantic merging | 57.57% | 61.85% | 59.17% | 1,931,565 |
| Recursive splitting with hard cap | 52.56% | 53.29% | 52.45% | 1,328,231 |
| Select by average block and packed length | 58.06% | 61.97% | 59.53% | 1,885,356 |
| Target 102 tokens when joining whole blocks | 56.00% | 63.97% | 59.10% | 1,325,487 |

The length rule gained 0.35 points over semantic merging (adjusted 97.5% interval −0.40 to +1.11) and saved 2.4% of indexing tokens. Soft-target packing saved 31.4%, but the −0.07-point difference had an interval of −2.64 to +2.88. Both missed the criteria for changing the default. Making 102 tokens a hard cap dropped complete evidence to 48.36%. Choosing blocks whenever a heading or protected unit appeared reached 53.77%. A single heading gives little information about suitable chunk sizes elsewhere in the document.

The retrieval configuration gave clearer guidance for choosing a fixed mode. These differences use descriptive paired 95% intervals.

| Markdown retrieval configuration | Comparison on fresh questions | Difference |
|---|---|---:|
| Five hits, 512 delivered tokens | Semantic 59.17% vs. packed 54.49% | +4.68 points (+1.93 to +7.30) |
| Five hits, 1,024 delivered tokens | Packed 71.74% vs. semantic 68.29% | +3.45 (+1.05 to +6.05) |
| Five whole hits | Packed 75.14% vs. semantic 69.22% | +5.92 (+3.63 to +8.57) |
| 512 delivered tokens, unlimited hits, 512-token body cap | Original blocks 61.61% vs. semantic 58.09% | +3.52 (+0.57 to +6.88) |

Five whole packed hits delivered 948 tokens on average and five semantic hits delivered 735. With three hits capped at 512 tokens, the development preference for semantic merging reversed on the fresh questions (50.39% semantic, 52.29% packed, difference −1.90 points, −4.61 to +0.78). With unlimited hits and a 256-token body cap, the blocks advantage was uncertain (+0.76, −1.86 to +3.61). The recursive reference exceeded the nominal body cap on eight fresh chunks. Enforcing it moved the primary result from 52.40% to 52.45%. Across five whole hits the capped reference reached 75.52% and delivered 1,125 tokens on average.

On the same 24 contracts rendered as plain text (281 questions, five hits, 512 tokens), literal paragraphs recovered 36.65% of complete evidence in 2,870 index rows. Individual sentences recovered 37.01% in 5,728 rows and semantic merging 35.23% in 1,141. On the 35 previously studied meetings (244 questions), the transcripts had no blank-line paragraphs. The oversized-paragraph fallback and greedy sentence packing produced identical chunks and 31.32% annotated-token recall. The capped recursive reference reached 32.18%, a difference of +0.86 points from packing (95% interval −2.27 to +4.33). Semantic merging reached 29.40% and sentences 8.44%. Five sentence hits delivered only 156 tokens on average. [Plain-text layout hashes, costs and query outcomes](results/2026-11-24-paragraph-modes.json)

Recommend three explicit layouts and a default selector. `blocks` preserves a fitting paragraph in plain text or a parser block in Markdown and splits oversized units locally. `pack` fills chunks greedily across eligible neighbors. `semantic` ranks eligible joins by embedding similarity. `auto` keeps the existing format and size decision when the retrieval configuration is unknown. An application that knows its retrieval limits at indexing time can use the fixed choices above. Keep the existing sentence-level opt-out for plain text. Keep generic recursion as a benchmark reference. This study covers English evidence, one embedding model and four fresh multi-hop search pools. Before adding a retrieval-aware public default, replicate these specific choices with a second model and measure HTML separately.

A clean replay reproduced all 360 Markdown measurements, including per-question outcomes and cold costs, using the cached vectors. All five earlier Markdown sample manifests also reproduced their recorded source and annotation hashes.

## 2026-11-24 · Checking the Markdown review

Test the proposed size controls on the same literal Markdown units, protected runs, hard caps, and source ranges as the shipped scorer. The primary comparison uses the 256-token body limit and dense complete evidence at 512 delivered tokens on the 676-question replication sample. Repeat at a 512-token body cap. Compare unlimited greedy packing, packing at most three consecutive units, three deterministic shuffles of the original eligible scores within each document, a single descending-score sweep, and attaching sub-16-token chunks to their best eligible neighbor. Retain the 256- and 1,024-token retrieval measurements and report untruncated top-three and top-five retrieval with its delivered token cost. Shuffling uses the observed score distribution as an experimental control. It cannot supply a document's true rejection rate without first observing it. For replacement, require the lower end of the paired 95% interval to exceed −1 percentage point at both body budgets and a meaningful reduction in indexing work, while preserving caller-specified limits.

The child-only control in the parent-retrieval pilot reached 60.06% on the 676 questions at a 256-token body cap, compared with 57.99% for scoring. Check the public `combineChunks: false` option at **both** body caps on the updated parser. Freeze this comparison before running the separate 199-question confirmation and 172-question rule-validation samples. Apply the same one-point loss margin to both caps, examine fixed-count delivery alongside fixed-token delivery, and verify actual indexing costs. These samples were used in earlier studies and were separate from the parent-retrieval pilot.

### Boundary placement and chunk size

The historical controls use the parser from `7b3d07a`. Both semantic and greedy layouts reproduced all archived body hashes and complete-evidence outcomes. The review's 58.18% and 55.20% use HotpotQA's question-specific shortlist. The release metric searches a pool of about 320 articles per question and gives each of the four tasks equal weight. Its corresponding scores are **57.99% and 55.00%**. With 512 tokens available to the retriever, the results were as follows. [Per-task results and costs](results/2026-11-24-markdown-review.json)

| Indexing policy | 256-token body cap | 512-token body cap | Cold embedding tokens at 256 | Index rows at 256 |
|---|---:|---:|---:|---:|
| Original-boundary scoring | 57.99% | 56.76% | 1,079,606 | 7,828 |
| Greedy packing | 55.00% | 49.29% | 763,600 | 5,779 |
| Greedy, at most three units | 57.09% | 55.14% | 763,275 | 6,998 |
| Deterministic random ranking, 30% rejection cutoff | 57.29% | 55.21% | 763,663 | 7,410 |
| Original scores shuffled within each document, mean of three seeds | 56.47% | 56.10% | 1,072,902 | 7,627 |
| One descending-score sweep | 57.58% | 56.57% | 1,077,069 | 7,827 |
| Attach chunks under 16 tokens to their best eligible neighbor | 57.77% | 56.87% | 1,102,962 | 7,026 |

Three-unit packing recovered roughly two-thirds of the original 256-token gain over unrestricted packing. Its paired differences from scoring were −0.90 points (95% interval −2.98 to +1.21) at 256 and −1.62 (−4.03 to +0.87) at 512. Randomly relocating the observed scores preserves each document's initial score distribution, including the number of above-threshold edges. Size limits and competing pairs can still change the final chunk count. Across three seeds, relocating the scores cost 1.52 points at 256 (−3.05 to −0.16 for shuffle minus scoring) and 0.66 at 512 (−2.37 to +1.04). The shuffled control pays to discover the scores. The separate fixed 30% random control needs only final embeddings, and its intervals extend below the one-point loss margin at both caps. These intervals resample whole contracts, papers, financial reports and HotpotQA search pools. Seed repetitions stay paired within each question. There are only four multi-hop pools.

FinQA contributed most of the original gain at 256. Three-unit packing brought its complete-evidence rate up from 53.91% to 61.74%, close to semantic scoring's 63.48%. QASPER favored unrestricted packing, 51.85% versus 49.63% for scoring. Choosing each task's best packing size from the six archived settings using **calibration** scores, with cold embedding tokens breaking ties, gave 57.55% on the replication. Selecting on the replication answers themselves yielded 59.31% on pooled search. Several character-only settings in that six-way comparison allow chunks over 256 tokens. Restricting selection to the 128- and 256-token caps gave 56.74% on replication. [Calibration grid](results/2026-11-23-markdown-rules.json) · [Replication grid](results/2026-11-23-markdown-rule-replication.json)

**Priority passes.** The single sweep changed retrieval by −0.40 points at 256 and −0.19 at 512, saving under 0.3% of cold embedding tokens. The review itself found different boundaries on 89 of 400 synthetic documents. An initially oversized pair can also become eligible after its neighbor changes because a caller's tokenizer can assign fewer tokens to the larger joined string. A sweep over initially eligible edges misses that case. Keep the existing passes, which also implement explicit pass and batch limits. [Regression for a newly eligible boundary](delivered-context.test.mjs)

**Tiny chunks.** Absorption reduced index rows from 7,828 to 7,026 at 256, with a −0.22-point retrieval change. At 512 it reduced rows from 6,190 to 5,450, with a +0.11-point change. The original boundary vectors were reusable, but the new final texts cost 2.2–2.3% more cold embedding tokens. The extra merge rule does not justify a default change on these results.

**Delivery by rank.** At a 256-token body cap, unrestricted packing recovered complete evidence for 69.7% at top five (763 delivered tokens on average). Original-boundary scoring reached 63.2% (629 tokens) and three-unit packing 62.3% (625 tokens). The larger passages benefited when the retriever could deliver them in full. The active baseline benchmark now reports untruncated top three and top five with their actual token counts alongside the fixed budgets. [Benchmark commands](README.md#compare-markdown-retrieval)

**Small-to-big retrieval.** Rank each original Markdown unit and return the first occurrence of its enclosing greedily packed section-bounded passage, deduplicating parents by source occurrence. Returning parents recovered 53.37% at 512 delivered tokens. Returning the identical ranked children recovered 60.06%, a paired difference of −6.69 points for parent delivery (−9.81 to −3.66). At top five, parents recovered 70.2% using 783 tokens, compared with 53.2% using 429 tokens for the children. Both indexed the same 12,530 vectors. Keep this parent strategy out of the chunker. This test covers whole prepacked parents. Other query-time neighborhood sizes and allocation rules remain distinct retrieval policies.

### Release decision on the updated parser

Keep semantic merging at larger Markdown limits and keep the existing `combineChunks: false` option for applications that rank individual units. The 676-question comparison on the updated parser gave the following results with 512 delivered tokens. A separate run through the public API reproduced the scored layouts, indexing costs and per-question outcomes at both caps.

| Public or experimental layout | 256-token body cap | 512-token body cap |
|---|---:|---:|
| Score original boundaries | 57.99% | 56.67% |
| Greedy packing | 55.09% | 49.12% |
| Greedy, at most three units | 57.25% | 55.31% |
| Absorb chunks under 16 tokens | 57.77% | 56.79% |
| Return original units with `combineChunks: false` | 59.89% | 59.25% |

With a **512-token body cap and 512 delivered tokens**, the unmerged layout also improved complete evidence on both independent samples, by 4.28 and 3.36 points. Pooled across their 371 questions, the gain was **3.82 points** (paired 95% interval +0.05 to +7.98). With a 256-token body cap, the differences were −1.87 and +1.07 points, or **−0.52** pooled (−3.56 to +2.57). The smaller cap missed the predeclared margin for replacing scoring. Each independent sample had a single HotpotQA search pool, which limits precision on that task.

The deployment tradeoff changes with the retrieval interface. At the 512-token body cap on the 676 questions, original units used **34.0% fewer cold embedding tokens** (757,182 versus 1,147,717), but needed **71.8% more index rows** (10,591 versus 6,166). Delivering five whole hits gave 55.35% complete evidence for original units (527 tokens on average) and 66.68% for scoring (842 tokens). A body-size setting alone cannot express whether the caller limits delivered tokens, ranked hits or vector storage. The README documents the existing option for the case that repeated. [Public API results and grouped confirmation intervals](results/2026-11-24-markdown-review.json)

### Parser and remaining review findings

- **Sentence boundaries.** Markdown now shares abbreviation-aware segmentation with text and HTML. Regression cases exercise English and Spanish abbreviations, CRLF, a character that expands on uppercase, trailing whitespace, inline code and links, and Chinese punctuation. Returned Markdown ranges still address the literal UTF-16 input.
- **Cutoff precedence.** The options table now specifies the fallback and gives a fixed Markdown example. The tests exercise a document with several eligible edges and one with just one edge. Existing callers can choose a fixed cutoff directly, so changing the meaning of an explicitly supplied `similarityThreshold` would break its documented fallback use.
- **Blank and numeric units.** Omit paragraphs containing only whitespace, including decoded nonbreaking spaces. In the review's first 24 CUAD contracts, the 14 blank units actually consisted of newlines between oversized *indented code* lines. Carrying those newlines into a neighboring code fragment removed all 14 while preserving the source. The sample now has 631 of 5,197 original units at five tokens or fewer (12.1%). Bare numbers, dates and labels can carry evidence. They retain their original text, including in protected tables and code. PDF page removal requires page provenance.
- **HTML comments.** Omit standalone comment blocks, including multiline comments and comments inside lists or quotes. They break a merge run like a definition. Mixed HTML and visible prose, inline HTML, and code examples keep their literal Markdown. This preserves visible text on lines such as `<!-- comment --> visible suffix` and avoids interpreting examples as markup.
- **Benchmark hooks.** Removed both `overlapBarrier` writes and the `sentenceUnits` parser switch, along with the one-off QASPER arm that used it. The old comparison and a pinned replay remain available. [Historical QASPER comparison](results/2026-11-23-markdown-comparison.json)
- **One merger for text and Markdown.** The review's older text cutoff was 0.5. The subsequent 500-character evaluation tried original boundaries and a blend with rescoring at the current 0.05 cutoff. Original boundaries saved 24.64% of embedding tokens but reduced held-out WikiSection boundary F1 from 0.416 to 0.365. The blend saved no indexing work. Keep rescoring for text and HTML. The 500-character evidence leaves a 256-token-only text comparison open. [Text retrieval and segmentation trials](#2026-11-24--reviewing-the-remaining-merge-algorithms)
- **Meeting turns.** QMSum renders each known speaker turn as a single line. Marking every true turn as a separate Markdown paragraph increased median chunk size from 29 to 34 tokens in the test split. Annotated-token recall at 512 delivered tokens moved from 26.29% to 26.39% across 244 questions in 35 meetings (+0.10 points, −2.64 to +2.60). On the separate 35 validation meetings and 237 questions it moved from 22.52% to 23.20% (+0.67, −1.97 to +3.32). This used the known turn starts and checked the exact annotated words after remapping. It left most of the original gap to zero-overlap recursive splitting (32.18% test recall). Keep ordinary soft line breaks. Inferring turns from punctuation would additionally need a hard-wrapped prose control.
- **Second model and multilingual retrieval.** Spanish and Chinese parser tests exercise splitting and source mapping. Retrieval calibration still covers one embedding model and English evidence. A transfer test needs aligned non-English evidence spans, a second model and its token accounting to distinguish a language effect from a budget or model effect. The size switch remains unvalidated outside the measured setting.
- **Performance and coverage.** The updated code passed 85 automated tests, the supplied 11 edge cases at three settings, and 1,200 randomized documents, including 354 in scoring mode. No source-range, coverage or cap violations were reported. With a deterministic local embedder, the 114,887- and 149,139-character Markdown workloads took median 946 and 1,289 ms at the 500-character target on this shared machine. The reviewer's parser-isolation probe measured the syntax-tree step at 791 and 971 ms in a separate run. Timings vary with load. The README now describes the full-document parse. [Workloads and measurement method](README.md#run-the-large-document-benchmark)

## 2026-11-24 · Reviewing the remaining merge algorithms

Retire post-merge context expansion from the active benchmark suite. It tied core-only indexing at 57.99% complete evidence on 676 document questions while using 3.3% more indexing tokens. The chosen meeting setting changed evidence recall by −0.21 percentage points across 307 questions in 46 independent meetings (paired 95% interval −0.65 to +0.19). Keep the Markdown parser, section packing at small budgets and original-boundary scoring at larger budgets. The Markdown size rule gained 3.22 points over packing (interval +1.74 to +4.67). [Expansion results](#2026-11-24--choosing-expansion-limits-and-similarity-thresholds) · [Archived runner](README.md#compare-overlap-after-markdown-merging) · [Markdown size comparison](#2026-11-23--markdown-combination-by-chunk-budget)

On 1,255 confirmation questions, scoring only the original sentence boundaries saved **24.64% of cold indexing tokens and 37.84% of calls**. Mean complete evidence changed by **−0.09 points** (paired 95% interval −0.78 to +0.56). The separate cohorts changed by +0.42 and −0.52 points. At 500 characters on held-out SQuAD, both methods retrieved 417 of 437 annotated answers. Full-text rescoring better preserved editorial topic boundaries on held-out WikiSection at the same cutoff. Its F1 was 0.416 versus 0.365 at 500 characters and 0.289 versus 0.259 at 1,000. At 1,000 characters it retrieved 379 SQuAD answers versus 375. These tests used English text and one embedding model. [Per-question retrieval, quality metrics, costs and paired intervals](results/2026-11-24-merge-algorithm-review.json)

| Text policy at 500 characters | Mean complete evidence | Difference vs default, percentage points (95% interval) | Cold indexing tokens | Embedding calls |
|---|---:|---:|---:|---:|
| Full-text priority, cutoff 0.05 | 48.34% | — | 3,258,685 | 8,661 |
| Original boundaries, cutoff 0.05 | 48.24% | −0.09 (−0.78 to +0.56) | 2,455,622 | 5,384 |
| Equal blend of original and current scores, cutoff 0.05 | 48.30% | −0.03 (−0.51 to +0.43) | 3,261,262 | 8,678 |
| Up to 100% of candidates per pass | 48.19% | −0.15 (−0.64 to +0.32) | 3,216,700 | 8,499 |
| Public document-relative cutoff | 43.90% | −4.44 (−6.10 to −2.74) | 2,801,150 | 7,928 |
| Looser document cutoff, mean minus 2.5 standard deviations | 48.30% | −0.03 (−0.10 to 0.00) | 3,256,904 | 8,632 |
| Greedy sentence packing | 47.59% | −0.75 (−2.09 to +0.58) | 1,387,177 | 2,693 |

Keep the 40% batch cap and the general-purpose full-text default. The blend's calibration lead disappeared on confirmation. The looser document threshold reproduced nearly all the default's outcomes and costs. The existing document cutoff used 14.0% fewer tokens than the default. Against fixed 0.35 at similar cost, it gained 0.49 points (−0.65 to +1.57). It remains an optional cost tradeoff in text and the calibrated cutoff in Markdown. The 100% cap saved 1.9% of calls and scored lower on one cohort and higher on the other.

### Comparison protocol

Compare the ordinary text merger at its 500-character default with three changes in isolation. First, let it use the original sentence boundary cosine throughout a join, as Markdown does. Also test a 50/50 mean of that score and the recomputed full-text cosine. Keep the same priority queue, size checks, pass caps and tie order. Second, compare the public document cutoff (mean minus 0.5 standard deviations) with looser multipliers of 1.5, 2.5 and 4 and a fixed cutoff at comparable indexing cost. Third, allow up to 100% of currently eligible disjoint pairs instead of the default 40%, keeping the absolute cap and soft minimum. Include greedy sentence packing.

Use the 544-question calibration set to select a cutoff from 0.05, 0.25, 0.5 and the document cutoff for each alternative boundary score. Select the document multiplier on the same set, then match each document policy to the fixed cutoff closest in calibration indexing tokens from the archived 0.05-step grid. Freeze selections before evaluating the separate 553- and 702-question cohorts. Measure equally weighted complete evidence across contracts, papers and multi-hop questions at 256, 512 and 1,024 retrieved tokens, plus cold indexing work. These cohorts have been used for previous questions. For a default change, require a gain on both cohorts with a pooled paired 95% interval above zero, or at least 15% fewer indexing tokens or calls with a lower endpoint above −1 percentage point and no material increase in the other cost. Keep documented caller controls when evaluating a new default.

Calibration froze 0.05 for both the original-boundary and blended scores, and 2.5 standard deviations for the looser document cutoff. The ordinary merger scored 52.52%, the original boundaries scored 52.20%, and the blend scored 53.25%. Fixed cutoffs of 0.35 and 0.10 were closest in indexing tokens to the public and looser document cutoffs respectively.

Original-boundary scoring met the pooled retrieval-and-cost criterion at 500 characters. Before applying this result outside that setting, check SQuAD answer hits and WikiSection boundary F1 at 250, 500 and 1,000 characters, with both 0.05 and 0.5 fixed cutoffs. Also check the public document cutoff on these tasks. Use the existing held-out partitions and keep all settings fixed. A repeated quality loss at other sizes or cutoffs argues against replacing full-text scoring throughout the API.

At 500 characters and cutoff 0.05, original-boundary scoring matched 23 of 47 annotated WikiSection breaks in eight held-out articles, versus 26 with full-text scoring. The F1 difference was −0.051 (paired 95% interval −0.088 to −0.003, resampling articles). At 250 characters both matched 32 breaks, and at 1,000 the F1 difference was −0.030 (−0.059 to +0.005).

## 2026-11-24 · Ordinary merge cutoff

Keep the full-text pair cutoff at **0.05**. On 1,255 confirmation questions, ordinary merging scored 48.34% for mean complete-evidence retrieval. Requiring the joined embedding to match both parents scored 48.14%. Of seven scoring rules, calibration favored a length-weighted mean, which scored 48.06% on confirmation and used 0.53% more indexing tokens.

## 2026-11-24 · Retiring the optional centroid pass

Retire the centroid pass as a retrieval feature. At the tuned full-text cutoff of 0.05, adding a single sweep changed the complete-evidence rate by **−0.26, +0.32 and −0.52 percentage points** in the three cohorts (544, 553 and 702 questions). Pooling the 1,799 distinct questions and weighting tasks and retrieval budgets equally gives **−0.17 points** (paired 95% interval **−1.04 to +0.71**). The pooled estimate is retrospective. On the fresh cohort alone, the sweep saved 2.5% of indexing tokens and used 3.6% more calls. [First two cohorts](results/2026-11-24-centroid-passes.json) · [Fresh cohort](results/2026-11-24-centroid-fresh-confirmation.json)

| Policy on the 702-question cohort | Mean complete evidence | Cold indexing tokens | Embedding calls |
|---|---:|---:|---:|
| Full-text best pairs, public default | 50.25% | 1,946,972 | 4,443 |
| One centroid sweep, same 0.05 full-text cutoff | 49.73% | 1,899,252 | 4,604 |
| `groupSentences: true` with its default 0.5 full-text cutoff | 40.66% | 1,204,288 | 2,954 |
| Centroid grouping alone | 40.43% | 1,156,181 | 2,715 |
| Greedy sentence packing | 49.42% | 836,179 | 1,371 |

The matched-cutoff comparison isolates the effect of the sweep. Enabling the flag by itself also changed the downstream cutoff from 0.05 to 0.5. For standalone grouping, simple sentence packing gained 8.99 points (paired 95% interval +6.14 to +11.96) and used 27.7% fewer indexing tokens. All five policies used the same six cached matrices, a 500-unit size target and the same 256-, 512- and 1,024-token retrieval budgets. The additional three controls replayed the source and question order from the fresh cohort with zero provider requests. [Exact options and per-question outcomes](results/2026-11-24-grouping-retirement.json)

Removed the centroid pass, `groupSentences`, `dynamicThresholdLowerBound` and `dynamicThresholdUpperBound` from the library. Text and HTML now go directly from sentence splitting to full-text priority merging. Callers using `combineChunks: false` receive the initial sentence units, subject to the token limit. Git callers who used the flag's implicit 0.5 full-text cutoff can request it explicitly with `combineChunksSimilarityThreshold: 0.5`. The published 0.3.2 package predates the pass. [Archived experiment and replay instructions](README.md#compare-centroid-passes-and-pair-order)

After removal, the default reproduced every per-question result on the 702-question cohort at all three retrieval budgets. It produced 10,391 chunks with the same 4,443 embedding calls and 1,946,972 cold indexing tokens. The independent 553-question cutoff study also reproduced its original outcomes and costs. Both checks used cached vectors. [Default comparison](results/2026-11-24-centroid-fresh-confirmation.json) · [Cutoff study](results/2026-11-24-retrieval-budget-cutoffs.json)

## 2026-11-24 · Fresh confirmation of alternating centroid batches

Keep full-text best-pair merging as the text and HTML default. On 702 fresh questions it retrieved complete evidence **50.25%** of the time, averaged equally across tasks and budgets. Alternating leftmost centroid batches with full-text best-pair batches scored **49.47%**. The paired difference was **−0.78 percentage points** (95% interval −1.67 to +0.03). Alternation used **4.29% fewer indexing tokens** and **5.33% more embedding calls**. Its earlier retrieval gain did not repeat. [Per-question outcomes, source IDs and indexing costs](results/2026-11-24-centroid-fresh-confirmation.json)

| Merge schedule | 256 retrieved tokens | 512 | 1,024 | Mean | Cold indexing tokens | Embedding calls |
|---|---:|---:|---:|---:|---:|---:|
| Full-text best pairs | 37.64% | 49.93% | 63.19% | 50.25% | 1,946,972 | 4,443 |
| One left-to-right centroid sweep, then full-text best pairs | 37.82% | 48.45% | 62.93% | 49.73% | 1,899,252 | 4,604 |
| Alternate leftmost centroid pairs with full-text best pairs | 36.86% | 48.97% | 62.58% | 49.47% | 1,863,389 | 4,680 |
| Alternate highest-scoring centroid pairs with full-text best pairs | 37.21% | 48.97% | 61.79% | 49.32% | 1,869,475 | 4,691 |

Within the alternating schedule, taking the leftmost qualifying centroid pairs gained 0.15 points over taking the highest-scoring pairs (95% interval −0.82 to +1.15). That comparison gives little reason to prefer either centroid order. A single optional grouping sweep scored 0.52 points below the default (95% interval −1.45 to +0.40). [Decision on the single pass](#2026-11-24--retiring-the-optional-centroid-pass)

The sample contained 384 contract questions, 190 paper questions and 128 multi-hop questions. Intervals resample contracts, papers and multi-hop cases within their respective tasks, with the two multi-hop indexes fixed. Preparing the shared passage and query vectors used 464 requests and 7,407,192 tokens across all four schedules. The table gives the separate cost of indexing each schedule from scratch. An offline replay reproduced every per-question outcome and cost. [Reproduction command](README.md#compare-centroid-passes-and-pair-order)

### Protocol fixed before scoring

Freeze the leftmost disjoint centroid batch followed by a best-pair full-text batch, repeated until both stop. Compare it with the public text default at 500 UTF-16 units. Use the original adaptive grouping base of 0.5, full-text cutoff 0.05, ordinary pass caps and `text-embedding-3-small`. The primary outcome is the change in complete annotated evidence, equally weighted across the three tasks and the 256-, 512- and 1,024-token retrieval budgets. For this default decision, favor alternation if its paired source-resampled 95% interval is above zero and its cold indexing token count is no higher. Also measure a single grouping sweep and highest-first centroid batches on the same vectors.

Use 32 contracts from the full CUAD release outside its 102-contract test split, 64 fresh QASPER papers and 128 fresh HotpotQA cases. Exclude the sources and question IDs in the cutoff study and all five Markdown samples. Select by the SHA-256 order of the seed `semachunk-centroid-confirm-v1/` plus source or case ID. Split deterministically into two shards, each with a separate 64-case multi-hop index balanced between bridge and comparison questions. Freeze the selection and settings before scoring.

## 2026-11-24 · Repeating and alternating centroid passes

Keep best-pairs-first for ordinary full-text merging and keep alternation experimental. With a centroid batch first and a 0.05 full-text cutoff, highest-cosine-first scored **0.36 percentage points below leftmost-first** on the later 553 questions (95% paired interval −1.01 to +0.33). On the earlier 544 questions the difference was −0.74 (−2.04 to +0.65). Both treatments used the same disjoint-pair scheduler. When full-text priority went first, the ordering difference reversed to +0.08 on the later set (−0.49 to +0.69) and +0.55 on the earlier set (+0.09 to +1.13). [Pair-order results, question outcomes and costs](results/2026-11-24-centroid-pair-order.json)

| Policy at full-text cutoff 0.05 | Earlier mean | Later at 256 tokens | At 512 | At 1,024 | Later mean | Later cold indexing tokens |
|---|---:|---:|---:|---:|---:|---:|
| Full-text priority alone | 52.52% | 33.74% | 45.82% | 59.76% | 46.44% | 1,311,713 |
| One left-to-right centroid sweep, then full-text priority | 52.26% | 33.77% | 46.80% | 59.70% | 46.76% | 1,272,965 |
| Alternate a left-to-right centroid sweep with a full-text batch | 52.45% | 33.89% | 47.09% | 60.11% | 47.03% | 1,222,389 |
| Alternate leftmost disjoint centroid pairs with full-text best pairs | 53.09% | 34.51% | 47.12% | 61.61% | 47.75% | 1,253,967 |
| Alternate highest-cosine disjoint centroid pairs with full-text best pairs | 52.35% | 33.63% | 47.50% | 61.04% | 47.39% | 1,261,929 |

The leftmost disjoint policy had the highest average on both sets. Against ordinary full-text priority it gained 1.31 points on the later set (+0.17 to +2.52) and 0.56 on the earlier set (−1.07 to +2.17), using about 4.4% fewer indexing tokens on each. Both sets had already been used to study merge cutoffs, so we tested that schedule again on fresh sources. [Fresh confirmation](#2026-11-24--fresh-confirmation-of-alternating-centroid-batches)

### How the comparisons work

Compare one initial grouping sweep, grouping until stable before priority merging, and alternating one grouping sweep with one disjoint priority round in either starting order. Include priority alone, grouping alone, and a literal repeat using fresh full-text embeddings of the current groups. Use a 500-unit target, an adaptive grouping base of 0.5 frozen from the original sentences, and full-text priority cutoffs of 0.05 and 0.5. For centroid sweeps over merged chunks, carry the sum of the original unit sentence vectors. Verify each local sweep against a full left-to-right rescan, including the first sweep after a priority-first start.

Use the two archived sets of 544 and 553 questions and their cached matrices. The primary comparison on the 553-question set is centroid-first alternation versus one grouping sweep followed by priority at 0.05, averaged equally over tasks and the 256-, 512- and 1,024-token retrieval budgets. Compare both with the ungrouped public default. Use the earlier 544 questions to check consistency. These sets have been used in earlier studies. Record paired source-resampled intervals, indexing costs and how many boundary cosines the local sweeps evaluate.

For the pair-order comparison, give both centroid policies the same cosine score, cutoff, size limit, disjoint-pair requirement and per-round cap. Compare taking the highest cosine first with taking the leftmost qualifying pair first. The primary comparison alternates a centroid batch followed by a full-text best-pairs batch at 0.05. Check the opposite starting order, centroid-only rounds, and a 0.5 full-text cutoff. Use the public priority queue for both scoring signals.

The existing sequential grouper can extend one run several times during a sweep and also checks the immediately preceding input. The pair-order control allows each span to participate once per batch. Both scorers share the size check, priority queue, disjoint selection, caps and join operation in the pair prototype. Two singleton spans use the same original cosine. After a join, full-text scoring batch-embeds changed text and centroid scoring adds unit sentence vectors locally. Each scorer caches its own score for each pair of live spans, and qualifying pairs deferred by a cap can compete again.

Alternating left-to-right centroid sweeps with priority batches gained **0.28 percentage points** over one initial sweep on the later set (95% paired interval −0.05 to +0.70) and **0.19** on the earlier set (−0.13 to +0.49). On the later set it used 1,222,389 cold indexing tokens versus 1,272,965 for one sweep. Repeating all centroid sweeps before starting priority gained 0.13 points on the later set and lost 0.42 on the earlier set. Literally regrouping the current full-text embeddings before priority changed the average by −0.02 and −0.04 points, respectively. These comparisons use the 0.05 priority cutoff. [Sweep results and paired outcomes](results/2026-11-24-centroid-passes.json)

The first centroid sweep checks all eligible boundaries. Later sweeps check edges incident to newly formed chunks and follow any group that keeps growing to the right. Every resulting boundary matched a full rescan. On the later set, repeated grouping before priority needed 3,868 later centroid cosines versus 6,755 on full rescans. Alternating the two methods needed 4,183 versus 4,516. Both reuse the initial singleton cosines. These counts measure vector dot products. The prototype still walks the chunk list to emit each pass.

The pair prototype rebuilds the queue in source order each round from cached scores. The production merger retains deferred candidates in the heap. A full-text-only control reproduced every question's retrieval outcome across both sets, both cutoffs and all three budgets. At cutoff 0.05 it produced one fewer stored chunk on the later set. All experiments used the archived vectors with zero new provider requests. [Reproduction commands](README.md#compare-centroid-passes-and-pair-order)

## 2026-11-24 · Ordinary merge cutoff by retrieval budget

The public text and HTML chunker now defaults to **0.05 for ordinary fixed priority merging**. One index at this cutoff gained **4.97 percentage points** of complete evidence over the previous 0.5 default across contracts, papers and multi-hop questions with `text-embedding-3-small` and `maxChunkSize: 500`. The average gives each task and retrieval budget equal weight (paired 95% interval **+2.18 to +7.61**). Building it used 51.6% more embedding tokens and produced 50.6% fewer chunks. [Full grid, source IDs, paired outcomes and costs](results/2026-11-24-retrieval-budget-cutoffs.json)

| Held-out policy | 256 retrieved tokens | 512 retrieved tokens | 1,024 retrieved tokens | Stored chunks | Cold indexing tokens |
|---|---:|---:|---:|---:|---:|
| Ordinary merge, 0.05 | 33.74% | 45.82% | 59.76% | 7,057 | 1,311,713 |
| Budget-specific, 0.05 / 0.05 / 0.10 | 33.74% | 45.82% | 59.24% | 14,137 | 2,623,780 |
| Ordinary merge, previous default 0.5 | 30.85% | 41.05% | 52.53% | 14,295 | 865,499 |
| Greedy sentence packing | 33.71% | 45.57% | 57.84% | 6,482 | 550,998 |

The only budget-specific change was at 1,024 tokens. Switching from 0.05 to 0.10 lost complete evidence on two multi-hop questions and gained none. The paired difference was −0.52 points at that budget (95% interval −1.30 to 0.00) and −0.17 averaged across the three budgets (−0.43 to 0.00). Indexing costs count each distinct cutoff once, with a cold cache for each build.

The gains over 0.5 were +2.89 points at 256 tokens (95% interval −0.48 to +6.15), +4.77 at 512 (+1.38 to +8.51) and +7.23 at 1,024 (+3.84 to +10.61). Papers gained the most. At 1,024 tokens, 0.05 retrieved complete evidence on **71/161** paper questions, **110/128** multi-hop questions and **130/264** contract questions. The 0.5 cutoff completed **40**, **103** and **138**, respectively. Contracts favored 0.5 at every budget.

Greedy packing used 58% fewer cold indexing tokens than the tuned merge. The merge's average advantage over packing was +0.73 points (95% interval −1.65 to +3.10). The two methods were within 0.25 points at both shorter budgets.

We replayed all 553 held-out questions with the cutoff and chunk size omitted. The public default matched the explicit 0.05 run on every question at every budget and reproduced its 7,057 chunks and 1,311,713 indexing tokens using cached vectors. The benchmark's `priority-default` method calls the chunker with its current defaults. Sentence grouping, document fallback and Markdown scoring use their existing 0.5 base. [Public options](../README.md#choosing-a-similarity-threshold)

### Sampling and cutoff selection

We fixed the tuning rule before scoring. Use the public text chunker with a 500 UTF-16 code unit target, sentence grouping off, the usual pass caps and `text-embedding-3-small`. Test fixed full-text cosine cutoffs from 0 to 1 in steps of 0.05, plus −1 to admit every size-eligible pair. Select a cutoff independently for each delivered context of 256, 512 and 1,024 tokens. Select a shared cutoff on the mean of the three budget scores. Each score is the mean complete-evidence rate across contracts, papers and pooled multi-hop search, weighting the three tasks equally. Break ties by fewer cold indexing tokens, then proximity to 0.5, the default at the time. Greedy packing and the 0.5 setting provide controls.

Use both previously scored cohorts (544 questions) for calibration. Freeze the choices before scoring 24 new contracts, 48 new papers and 128 new multi-hop cases. Exclude calibration sources and all five earlier Markdown samples. Search two disjoint 64-question multi-hop indexes to match the calibration pool size. The primary comparison is the budget-specific policy against the best shared cutoff, paired across questions and budgets. Prefer a single index if the source-resampled 95% interval includes zero. Also compare both policies with 0.5 at each budget and measure the indexing cost of supporting all three budgets.

Calibration selected **0.05, 0.05 and 0.10** in ascending budget order and **0.05** for one shared index. Cutoffs −1, 0 and 0.05 tied on complete evidence at all three budgets. The indexing-token tie-break chose 0.05. At 1,024 tokens, 0.10 recovered one additional contract question and tied the counts on the other two tasks. All six historical vector matrices matched their recorded checksums, and the 0.5 control reproduced every historical completion count and indexing-token total.

| Calibration policy | 256 tokens | 512 tokens | 1,024 tokens |
|---|---:|---:|---:|
| Ordinary merge, 0.05 | 37.92% | 53.12% | 66.53% |
| Ordinary merge, 0.10 | 37.69% | 52.89% | 66.65% |
| Ordinary merge, previous default 0.5 | 35.18% | 45.29% | 57.17% |
| Greedy sentence packing | 38.45% | 51.71% | 66.41% |

Confirmation covered **553 new questions**. All 24 contracts and 47 of the 48 indexed papers contributed eligible questions. The two multi-hop pools contained 629 and 621 distinct articles, with 32 bridge and 32 comparison questions per pool. We resampled whole contracts, papers and multi-hop cases within task 2,000 times, keeping each question's outcomes together across policies and budgets. The multi-hop intervals are conditional on the two search pools. Preparing all held-out passage candidates and queries used 75,164 inputs and 4,649,185 provider tokens in 297 requests. An offline replay reproduced every score, interval, cost and vector checksum. The policy costs above measure only the work to build the deployed indexes. [Reproduction commands](README.md#tune-the-priority-merge-cutoff)

## 2026-11-24 · Calibrating full-text and centroid merge scores

Keep full-text batched priority merging as the default. For a quality-focused configuration, the existing separate sentence-grouping pass followed by full-text priority was competitive with every centroid rule. On 326 source-disjoint validation questions, adding the calibration-winning 50/50 blend after the same grouping pass raised the mean complete-evidence rate by **0.38 percentage points** (paired 95% interval **−0.79 to +1.83**). It gained one paper question, traded two contract wins for two losses, and matched every multi-hop outcome. It used 2.7% more cold embedding tokens and scored slightly lower at both longer retrieval budgets. [Full grid, frozen nominees, paired question IDs, and costs](results/2026-11-24-centroid-settings.json)

| Policy | Calibration at 256 | Validation at 256 | At 512 | At 1,024 | Validation indexing tokens |
|---|---:|---:|---:|---:|---:|
| Public full-text priority, cutoff 0.5 | 32.55% | 36.85% | 47.64% | 59.75% | 573,984 |
| Public grouping base 0.5, then full-text priority at 0.5 | 32.69% | 37.61% | 48.96% | 60.32% | 539,099 |
| Full-text priority, tuned cutoff 0.3 | 33.27% | 37.64% | 53.45% | 68.84% | 782,732 |
| Grouping alone, base 0.5 | 33.02% | 37.08% | 48.30% | 59.95% | 518,126 |
| Grouping base 0.6, then full-text priority at 0.3 | 34.31% | 39.34% | 53.64% | 69.03% | 767,965 |
| 50/50 blend alone, cutoff 0.3 | 36.07% | 37.64% | 52.54% | 68.51% | 801,751 |
| Grouping base 0.6, then 50/50 blend at 0.3 | 37.63% | 39.72% | 53.11% | 68.51% | 788,557 |
| Centroid-only priority, cutoff 0.3 | 36.07% | 36.74% | 53.30% | 69.26% | 629,526 |

Percentages give each dataset equal weight. The tuned separate pass delivered complete evidence for 63/174 contract, 17/88 paper and 40/64 pooled multi-hop questions at 256 tokens. The prespecified comparison with the blend used those same questions and settings. Grouping bases feed the existing adaptive grouping cutoff. Centroid-only priority skipped intermediate full-text embeddings and used 1,374 indexing calls, compared with 2,164 for full-text priority at the same 0.3 cutoff. Both indexed their final chunks with full-text embeddings.

### Scaling one cosine

For positive scale `s`, a scaled minimum at cutoff `t` requires `F ≥ t` and `C ≥ t/s`. A scaled maximum accepts either condition. A gate with those two independent cutoffs can admit the same pairs as the minimum and still choose different merges, since the gate ranks by full-text cosine. A fixed scale gives callers one cutoff to set.

| Rule with cutoff fixed at 0.5 | Calibration at 256 | Validation at 256 | At 512 | At 1,024 | Validation indexing tokens |
|---|---:|---:|---:|---:|---:|
| Full-text priority | 32.55% | 36.85% | 47.64% | 59.75% | 573,984 |
| Minimum, scale 0.9 | 31.41% | 35.38% | 44.75% | 59.00% | 523,716 |
| Minimum, scale 1 (calibration winner for minimum) | 32.89% | 36.85% | 47.64% | 59.38% | 571,167 |
| Minimum, scale 1.1 | 32.55% | 36.85% | 47.64% | 59.38% | 573,175 |
| Maximum, scale 0.9 | 32.89% | 37.37% | 48.02% | 59.75% | 577,821 |
| Maximum, scale 1 | 33.45% | 36.85% | 47.50% | 59.18% | 590,819 |
| Maximum, scale 1.25 (calibration winner for maximum) | 34.93% | 34.85% | 49.05% | 62.78% | 709,950 |

The selected maximum cost 23.7% more indexing tokens than plain priority at 0.5. Its validation difference at 256 tokens was −2.00 points (paired 95% interval −4.90 to +0.80). Scaling also changes the first round, where single sentences have identical full-text and centroid scores. A maximum with `s = 1.25` and `t = 0.5` admits a singleton pair at 0.4. In a follow-up diagnostic, plain priority at 0.4 scored 36.32%, 49.10% and 62.21% at the three budgets using 688,690 indexing tokens. Applying the 1.25 scale only once a side contained multiple sentences scored 36.80%, 49.63% and 59.94%, using 646,988 tokens. The report also includes the analogous stricter minimum check. These diagnostics were run after the primary comparison.

### Sampling and reproduction

We fixed the comparison before scoring. At a 500 UTF-16 code unit target, let `F` be the full-text cosine and `C` the cosine between the sums of the original unit sentence vectors. Test full-text priority, centroid-only priority, separate full-text and centroid cutoffs, a centroid cutoff applied after a side contains multiple sentences, `min(F, sC)`, `max(F, sC)`, and `(1 − w)F + wC`. Test each with the grouping pass off and with adaptive grouping bases of 0.4, 0.5 and 0.6. Include grouping alone and the existing grouping-then-priority control. The threshold grid is 0.3, 0.4, 0.5, 0.6 and 0.7 for each cutoff, the scales are 0.75, 0.9, 1, 1.1 and 1.25, and the blend weights are 0.25, 0.5 and 0.75. Centroid-only priority can skip intermediate full-text embeddings.

Use the 218 historical questions for calibration. Select by mean complete-evidence rate across contracts, papers and pooled multi-hop search at 256 delivered tokens, with equal weight per task. Break ties by fewer cold embedding tokens, then fewer calls and grid order. Freeze the best existing policy and the best centroid policy for the primary paired comparison. Also freeze nominees per rule and with the public cutoff fixed at 0.5. For validation, use 16 new contracts, 32 new papers and 64 new multi-hop cases, excluding source IDs from calibration and all five prior Markdown samples. Resample contracts, papers and multi-hop cases within task for a paired interval. Other budgets and rule-specific nominees are secondary checks.

The grid contained 459 configurations and produced 24 distinct validation nominees. Preparing the new source, passage and query vectors used 48,122 inputs and 2,942,048 provider tokens with `text-embedding-3-small`. All scoring runs replayed the checksummed vectors offline. Apply the [study and tests](baselines/2026-11-24-centroid-settings.patch) to a disposable checkout of `0bc7e8f`. Run `node benchmarks/centroid-study.mjs STAGE OUTDIR TASK` from the repository root. Run `preflight`, `prefill` and `calibration` for each of `cuad`, `qasper` and `hotpotqa`, then `select OUTDIR` once. Run `validation` and `diagnostic` for each task. Finish with `report OUTDIR OUTPUT.json`. The historical RAG suite supplies the calibration cache. Set `SEMACHUNK_BENCHMARK_CACHE` to share an existing cache directory. [Benchmark setup](README.md)

## 2026-11-24 · Sentence centroids in batched priority merging

Keep full-text priority merging as the default and sentence grouping as an option. Requiring a second cosine score recovered one additional contract answer out of 100. The same 54 paper and 64 multi-hop questions had identical completion outcomes, including when all multi-hop passages shared one index. The separate grouping pass recovered one additional paper answer and one multi-hop answer, lost three contract answers, and used the fewest indexing calls. These are historical benchmark samples with one embedding model. [Scores, paired question IDs and costs](results/2026-11-24-centroid-priority.json)

| Merge rule | Contracts / 100 | Papers / 54 | Multi-hop, pooled / 64 | Short-answer hits / 437 | Editorial boundary F1 | RAG indexing calls |
|---|---:|---:|---:|---:|---:|---:|
| Full-text priority | 34 | 4 | 36 | 423 | 0.3436 | 1,608 |
| Group sentences, then run priority | 31 | 5 | 37 | 423 | 0.3467 | 1,409 |
| Require both scores, rank by full text | 35 | 4 | 36 | 423 | 0.3421 | 1,591 |
| Rank by the lower score | 35 | 4 | 36 | 423 | 0.3421 | 1,590 |
| Rank by the mean score | 34 | 5 | 36 | 423 | 0.3378 | 1,620 |

The table uses a target of 500 UTF-16 code units, a 0.5 priority cutoff and a 256-token retrieval budget. The first three result columns count questions with complete evidence under dense retrieval. At 512 tokens, requiring both scores still recovered one extra contract answer. At 1,024 tokens its complete counts matched full-text priority on all three tasks. With a larger 1,000-unit chunk target on the quality suite, it raised held-out short-answer hits from 405 to 408 and lowered editorial boundary F1 from 0.3349 to 0.3318.

Each live chunk carries its full-text embedding and the sum of the unit vectors of its original sentences. Adding the sums gives every sentence equal weight across uneven merges. For two single sentences the centroid cosine and full-text cosine coincide. On later passes the primary candidate keeps a pair only when both cosines reach the cutoff, then ranks it by full-text cosine. The two alternatives use the lower score or the arithmetic mean for both eligibility and ranking. All three score the two existing chunks and re-embed accepted joins in the usual batches. The separate grouping pass also checks the immediate sentence boundary and visits sentences from left to right.

Computing a centroid uses existing vectors. Different merge choices changed the number of texts sent to the embedder across the three RAG indexes from 10,501 under full-text priority to 10,474 with the centroid check. The extra vector arithmetic has a local cost. On the 4,096-sentence fixture with 384-dimensional vectors, the median went from 32 to 53 ms on one run and from 75 to 118 ms on a repeat. Both implementations produced identical boundaries and embedding requests on this fixture.

For reproduction, apply the [prototype patch](baselines/2026-11-24-centroid-priority.patch) to a disposable checkout of `0bc7e8f`. Run the quality suite and the RAG suite with `--methods merge-500-0.5 group+merge-500 flat-merge-500-0.5 merge-500-token-256` for RAG. Leave `SEMACHUNK_CENTROID_RULE` unset for the control, then set it to `gate`, `minimum` or `mean` for each candidate. The grouped control always uses the original merger. All comparisons replayed identical checksummed vectors with zero live embedding requests. [Benchmark commands](README.md)

## 2026-11-24 · Choosing expansion limits and similarity thresholds

Keep core-only indexing for general Markdown. The document setting selected on calibration used a 256-token total ceiling, a 0.65 neighbor cutoff and a 0.95 final floor. On 676 held-out questions it expanded 80 of 7,828 cores and changed zero complete-evidence outcomes at 512 delivered tokens. Both indexes scored 57.99%. Expansion used 1,115,273 cold embedding tokens versus 1,079,606 (+3.30%). Both recovered complete evidence for 112 of 298 contract questions, 67 of 135 paper questions, 73 of 115 financial questions and 104 of 128 multi-hop questions. Their macro scores also tied at 256 delivered tokens. At 1,024 the difference was +0.08 points. [Full grid, held-out results, costs and paired comparisons](results/2026-11-24-expansion-settings.json)

| Index window, neighbor cutoff, final floor | Complete document evidence | Cold document tokens vs core | Meeting evidence recall on 11 held-out transcripts |
|---|---:|---:|---:|
| Core alone | 57.99% | — | 21.13% |
| 256, 0.65, 0.95 (document nominee) | 57.99% | +3.3% | 21.13% |
| 320, 0.50, off (meeting nominee) | 57.25% | +23.3% | 20.85% |
| 256, 0.50, 0.90 | 57.20% | +12.9% | 20.86% |
| 320, 0.50, 0.90 | 57.33% | +31.9% | 20.86% |
| 384, 0.50, 0.90 | 56.79% | +46.6% | 20.86% |
| 512, 0.50, 0.90 | 56.61% | +66.7% | 20.86% |
| 384, 0.35, 0.90 | 56.90% | +90.4% | 21.85% |
| 384, 0.65, 0.90 | 57.55% | +17.3% | 21.06% |
| 384, ordinary merge cutoff, 0.90 | 56.63% | +74.2% | 21.32% |
| 384, 0.50, off | 56.47% | +31.3% | 20.85% |
| 384, 0.50, 0.80 | 56.47% | +50.0% | 20.85% |
| 384, 0.50, 0.95 | 57.23% | +42.6% | 20.91% |

At 0.50/0.90, the 320-, 384- and 512-token ceilings produced byte-identical meeting indexes on the 11 transcripts. The largest accepted window was 313 tokens. On documents, 283 windows used more than 384 tokens at the 512 ceiling. Reusing the ordinary cutoff allowed more neighbors. Its median on these meetings was 0.31, and it increased meeting embedding work by 39.4% over the core. The fixed 0.50 cutoff increased it by 4.2%.

The two similarity tests had different effects. Averaged across the other factors in the 48-setting calibration grid, raising the neighbor cutoff from 0.50 to 0.65 improved complete document evidence by 1.03 points (paired 95% interval +0.15 to +2.41) and reduced meeting token recall by 0.63 points (−1.32 to −0.08). Adding a 0.90 final floor to the neighbor check improved document completions by 1.39 points (+0.24 to +2.51) and reduced meeting recall by 0.22 points (−0.38 to −0.06). These exploratory comparisons weight each combination of the other two parameters equally and keep every outcome for a question in its source group. On document calibration, the 64-token per-side limit tied the control on the macro score and used 17.8% more embedding tokens. Limiting each side to one original unit or doubling the core size fell 1.72 and 2.31 points below the control respectively.

### Transcript results

The original transcript layout contains speaker-turn starts. Every expansion stayed within the outermost turns already in its core. The cheaper meeting nominee improved calibration recall by 0.78 points (+0.17 to +1.51). Its difference was −0.27 points on the next 11 meetings (−1.23 to +0.60) and −0.19 on a further 35 meetings (−0.66 to +0.25). Across those 307 held-out questions in 46 meetings, the paired difference was −0.21 points (−0.65 to +0.19). The earlier gain survived turn preservation on its own sample and failed to repeat on separate meetings. [Independent transcripts, per-query recall, costs and intervals](results/2026-11-24-expansion-meetings.json)

| Index window, neighbor cutoff, final floor | Calibration recall (174 queries) | Further 35 meetings (237 queries) | Difference vs core on the 35 meetings, points (95% interval) | Cold embedding tokens vs core on the 35 meetings |
|---|---:|---:|---:|---:|
| Core alone | 28.36% | 22.52% | — | — |
| 320, 0.50, off (cheaper nominee) | 29.14% | 22.33% | −0.19 (−0.66 to +0.25) | +4.8% |
| 320, 0.35, off (highest calibration recall) | 29.63% | 22.94% | +0.41 (−0.56 to +1.50) | +17.0% |
| 384, 0.50, 0.90 | 29.13% | 22.22% | −0.30 (−0.72 to +0.07) | +6.9% |
| 384, 0.35, 0.90 | 28.81% | 22.62% | +0.10 (−0.81 to +1.08) | +26.5% |

The highest-recall calibration setting improved 50 of the 237 new queries and worsened 43 at the primary delivery budget. At the secondary budgets of 256 and 1,024 delivered tokens it gained 1.15 and 1.17 recall points on average. The 384/0.35/0.90 setting gained 0.73 points in the first 11 held-out meetings, then 0.10 on the next 35. Its combined difference was +0.24 points (−0.55 to +1.09). These estimates leave room for a workload-specific benefit at the lower neighbor cutoff.

### Expansion settings protocol

Freeze the public 256-token cores, use the frozen core to score both sides, lock rejected sides, and enforce Markdown and explicit meeting-turn boundaries. Return only core text. Cross total indexing ceilings of 256, 320, 384 and 512 tokens with neighbor cutoffs of 0.35, 0.50 and 0.65. For each combination, compare the final-window cosine floor switched off, at 0.80, at 0.90 and at 0.95. A 256-token ceiling still allows a short core to grow. At 384/0.50/0.90 also test a 64-token allowance per side, one original unit per side, and a window up to twice the core length. At 384/0.90 test allowing either neighbor regardless of its cosine score.

Calibrate on the frozen calibration document sample and the first 24 QMSum meetings in the existing hash order. Nominate one expansion setting each for complete document evidence and meeting token recall at 512 delivered tokens. Within half a percentage point of the best calibration result, prefer a setting without an extra side or relative-size limit, then the lowest cold embedding token cost. Always keep core-only as a separate control. Validate both nominees on the larger replication documents and the remaining 11 meetings. Also repeat the one-factor comparisons around 384/0.50/0.90 on validation. Report paired 95% intervals over whole source groups, embedding costs, actual growth and results at 256 and 1,024 delivered tokens. A general default needs a positive validation interval on its primary outcome and enough improvement to justify the indexing cost.

At 384 tokens with a 0.90 final floor, also reuse each document's ordinary merge cutoff as the expansion neighbor cutoff on both samples. Calculate it from the same eligible original pairs used to create the cores. The ordinary Markdown merge accepts a pair on the boundary score. Expansion has a separate acceptance decision that compares the actual candidate indexing string's embedding with the frozen core embedding. [Markdown merging](../src/markdown-merge.js) · [Archived expansion study](README.md#compare-overlap-after-markdown-merging)

The initial fixed-cutoff results on 11 meetings put the cheaper calibration nominee below core-only and the 384/0.35/0.90 setting above it, with both intervals spanning zero. Freeze a follow-up on the 35 transcripts in the separate QMSum validation file. Compare core-only, the cheaper calibration nominee, the highest-recall calibration setting (breaking ties by cold tokens), and the matched 384/0.50/0.90 and 384/0.35/0.90 settings. Check transcript hashes against all 35 QMSum test meetings before scoring. [Pinned meeting data](https://github.com/Yale-LILY/QMSum/blob/83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e/data/ALL/jsonl/val.jsonl)

Verification matched 325 dataset and policy combinations against a run that scored every query afresh. Network-disabled replays matched the ten combinations sharing the ordinary cutoff and all five runs on the independent meeting split. Across those 340 combinations, the core hashes, index hashes, cold embedding work and all 1,221 retrieval results matched. Source audits covered 53,057 expanded windows and 91,228 original-unit additions, counting each setting's occurrences. Every meeting expansion passed the turn-boundary check. The runs fetched 2,551,857 new provider input tokens for calibration and replication and 1,148,935 for the further meetings. All 104 tests passed.

## 2026-11-24 · Locking a rejected side during context expansion

Keep the frozen core as the experimental scoring reference and keep a rejected side locked. Reopening produced identical final index strings and retrieval at all three delivery budgets for both scoring references, on both source formats. With the frozen reference it added 44 proposals on the original sources and 58 on the flattened sources. These cost 11,938 and 13,669 additional cold input tokens respectively. Scoring neighbors against the current window tied the frozen reference on original document completions and gained 0.38 meeting recall points (paired 95% interval −0.08 to +1.03). The public chunker continues to return and index the original cores. [Full results, source fingerprints and paired comparisons](results/2026-11-24-overlap-side-locks.json)

| Source and outcome at 512 delivered tokens | Core alone | Frozen score and permanent lock | Difference in points (paired 95% interval) |
|---|---:|---:|---:|
| Documents with original formatting, complete evidence | 62.53% | 59.74% | −2.80 (−6.11 to +0.27) |
| Same documents flattened, complete evidence | 55.02% | 55.02% | 0.00 (−2.28 to +1.92) |
| Meetings with original turn lines, annotated token recall | 23.61% | 24.56% | +0.95 (−0.55 to +2.23) |
| Same meetings flattened, annotated token recall | 23.14% | 22.55% | −0.60 (−1.81 to +0.83) |

The 199 document questions cover contracts, scientific papers, financial reports and multi-hop Wikipedia searches. On the original sources expansion gained two complete answers and lost eight. With an equal weight for each of the four datasets, document token recall also fell, from 73.83% to 71.47%. Flattening changed the effect of expansion by +2.80 points on complete document evidence (paired interval −0.62 to +6.08) and −1.54 points on meeting recall (−2.59 to −0.36). The flattened sources preserve word order, speaker labels and table delimiters. This comparison measures the effect of removing layout from these sources. Across the original documents and meetings the frozen policy grew 538 of 4,074 cores, accepted 990 of 1,417 trials and used 807,636 cold embedding tokens against 485,466 for the control.

Meeting turn lines are soft breaks in Markdown. With only Markdown boundaries, 181 of 209 expanded meeting cores crossed at least one additional turn. Enforcing the known turn starts reduced that to zero across 38 expanded cores. Recall was 24.66%, compared with 24.56% when crossing was allowed (+0.10 points, −1.87 to +2.23). Cold meeting embedding work fell from 255,838 to 187,938 tokens, compared with 178,492 for the core index. The improvement over the core index came from three of 59 queries in two of eight meetings. A core that already spans turns keeps its original text and may grow within its outermost turns.

A cache-only replay of the earlier 512-token guarded run at `5261906` reproduced every per-dataset final index hash and the cited 824 rejections, 171 opposite-side trials and 89 recoveries. Of its 965 expanded windows, 30 borrowed a piece of a hard-split sentence and 22 borrowed a non-paragraph block. Nine more had such a barrier inside their original core. The corrected pass treats those units and mixed cores as barriers. It can take an entire fitting paragraph or a complete detected sentence, including an attached section heading when present. Same-section paragraphs may join across whitespace. The source audit checked 4,574 expanded windows and 9,227 whole-unit additions across the new policies and formatting conditions. Counts include each policy's independently checked occurrences. [Earlier run](results/2026-11-24-embedding-context.json)

### Side-lock protocol

Use the 199 document questions and eight meetings from the earlier confirmation sample. Compare four 512-token indexing windows on the same 256-token cores. Rank both neighbors by cosine to either the frozen core or the current window. Try the better eligible side once per round. At a 0.50 neighbor cutoff and 0.90 prospective-window floor, compare a permanent side lock with reopening after the opposite side succeeds. Repeat on the same words and questions after stripping heading markers and collapsing whitespace, with evidence offsets remapped. Compare each policy with its own formatting-matched core control. Audit every expanded interval against top-level Markdown blocks and sentence endpoints, and count original meeting windows that cross an additional turn. The primary delivery budget is 512 tokens.

On the original meeting transcripts also test enforcing the known turn starts when adding context. Keep any turns already present in a public core. Use the frozen-core score and permanent lock for this comparison.

The main comparison fetched 664,550 new provider input tokens. The turn-boundary condition fetched another 954. A network-disabled replay reproduced all 51 layouts, 183 retrieval results, cold embedding costs, source checks and paired comparisons. All 101 tests passed.

## 2026-11-24 · Neighbor context for embeddings

Keep neighbor expansion experimental. On 199 separate document questions, embedding the original 256-token cores recovered complete evidence for 62.53%, compared with 60.01% at a guarded 384-token window and 59.19% at 512. The 512-token difference against the original cores was −3.35 points (paired 95% interval −6.76 to −0.25). It used 75.9% more cold embedding tokens. On 59 queries from eight separate meetings, both guarded windows retrieved 24.94% of annotated tokens, compared with 23.61% for the cores (+1.33 points, −0.39 to +2.85). The two guarded sizes had identical per-query meeting recall at 512 delivered tokens. [Confirmation results and source fingerprints](results/2026-11-24-embedding-confirmation.json)

Returning the original core improved document retrieval by 2.01 percentage points over returning the whole 512-token window with the identical guarded index (paired 95% interval +0.05 to +4.11). Meeting recall differed by −0.04 points (−1.25 to +1.28). All embedding-only settings returned exactly the same text and source ranges for all 8,065 cores. Scores below cover 347 document questions and 115 meeting queries at 512 delivered tokens. [Configurations, per-query outcomes, window sizes and costs](results/2026-11-24-embedding-context.json)

| Embedding input | Returned text | Complete document evidence | Meeting token recall | Expanded cores | Cold embedding tokens |
|---|---|---:|---:|---:|---:|
| Original 256-token cores | Core | 62.68% | 30.80% | 0 | 928,577 |
| Up to 320, neighbor cutoff 0.50 | Core | 62.68% | 30.93% | 1,205 | 1,317,461 |
| Up to 320, also require 0.90 core similarity | Core | 62.68% | 30.92% | 840 | 1,270,841 |
| Up to 384, neighbor cutoff 0.50 | Core | 62.84% | 30.98% | 1,350 | 1,435,121 |
| Up to 384, also require 0.90 core similarity | Core | 64.03% | 30.93% | 934 | 1,376,721 |
| Up to 512, neighbor cutoff 0.50 | Core | 61.57% | 30.98% | 1,395 | 1,580,755 |
| Up to 512, also require 0.80 core similarity | Core | 62.28% | 30.98% | 1,300 | 1,551,430 |
| Up to 512, also require 0.90 core similarity | Core | 63.08% | 30.93% | 965 | 1,483,751 |
| Up to 512, at most 64 added tokens per side | Core | 62.68% | 30.67% | 824 | 1,108,595 |
| Same 512-token index with the 0.90 floor | Whole window | 61.07% | 30.96% | 965 | 1,483,751 |

At the 512-token ceiling the 0.90 floor rejected 824 of 2,398 preferred proposals. Of the 171 proposals tried on the opposite side, 89 passed. This yielded 1,663 accepted whole-neighbor additions. Only 121 of 8,065 final embeddings (1.50%) used more than 384 tokens. A failed trial leaves the last accepted window and its cached embedding available. The check compares each prospective indexing input, including a configured prefix, to the frozen core rendered the same way. The delivered body and evidence offsets always come from the original core in the embedding-only runs.

Compared with the original core index, the 512-token guarded window gained 0.40 document points (−0.98 to +1.77) and used 59.8% more cold embedding tokens. The 384-token guarded window gained 1.35 points (+0.17 to +2.50) and used 48.3% more. It added one complete contract result and three paper results. Both sizes had the same meeting recall on every query at this delivery budget. At 256 delivered tokens the 384-token guarded index scored 40.16% on documents against 42.16% for the original cores. At 1,024 delivered tokens it scored 74.95% against 75.10%.

On the confirmation sample, the original, 384- and 512-token configurations used 485,466, 757,825 and 853,789 cold embedding tokens respectively. Of 4,074 guarded windows at the 512 ceiling, 107 actually used more than 384 tokens. Widening from 384 to 512 lost three complete contract results and tied the other three document datasets. These two sizes showed the same ordering on both document samples.

The sizing experiment fetched 129,902 new provider tokens over the existing cache. A network-disabled replay reproduced all 100 returned and indexed layouts, 360 retrieval results, cold embedding costs and proposal counts. The published sizing file is that replay. The separate confirmation fetched 360,114 new provider tokens. Cold costs in the table count every input a fresh index build would embed. All 95 tests passed.

### Embedding context protocol

Freeze the public 256-token Markdown cores and keep their text and source ranges as the retrieval payload. Embed the accepted neighboring window. Compare 320-, 384- and 512-token ceilings using the same 0.50 neighbor cutoff, with and without a 0.90 floor on similarity between the prospective embedding and the original core embedding. At 512 also test a 0.80 floor, a 64-token allowance per side, and delivering the expanded passage with the same 0.90-guarded index. Check hashes of both returned bodies and indexed strings. Count preferred proposals, rejections and trials of the opposite side. Use the previous two samples, the same query vectors and literal delivery budgets of 256, 512 and 1,024 tokens. The primary outcomes are complete document evidence and meeting evidence recall at 512 delivered tokens.

The first comparison favored the 384-token guarded window on documents. Freeze the two guarded ceilings and the 256-token control for a separate comparison on the existing confirmation document sample and the next eight meetings in the same hash order. These sources are disjoint from the sizing experiment. Use the same thresholds, scoring and budgets.

## 2026-11-23 · Batched overlap after Markdown merging

Checking the proposed **whole passage** against its frozen core helped control semantic drift. At a 320-token final ceiling, a 0.90 cosine floor recovered 1.76 percentage points of complete document evidence over the neighbor cutoff alone (paired 95% interval +0.17 to +3.93). Against the original 256-token cores its difference was −1.22 points (−2.94 to +0.40), with 36.9% more cold embedding tokens. Meeting recall changed by +0.24 points (−1.76 to +1.84). Keep the non-overlapping cores as the public default. [Raw configurations, source fingerprints, per-query results and paired comparisons](results/2026-11-23-batched-overlap.json)

We scored each configuration on the same 347 document questions and 115 specific queries from 16 meetings at 512 delivered tokens. The table pools the two source-disjoint samples within each dataset, then gives each of the four document datasets equal weight. The document score measures complete annotated evidence. The meeting score measures the mean share of annotated tokens retrieved. Cold tokens include boundary scoring, accepted and rejected proposals that required embeddings, and the final index. The growth runs started from the same 8,065 public cores.

| Growth rule | Final token ceiling | Document score | Meeting recall | Cores expanded | Cold embedding tokens |
|---|---:|---:|---:|---:|---:|
| Public cores | 256 | 62.68% | 30.80% | 0 | 928,577 |
| Public cores | 320 | 62.92% | 31.20% | 0 | 937,990 |
| Neighbor cutoff 0.50 | 256 | 60.26% | 31.16% | 872 | 1,160,438 |
| Neighbor cutoff 0.50 | 320 | 59.70% | 30.87% | 1,205 | 1,317,461 |
| Neighbor cutoff 0.50 | 384 | 57.95% | 30.81% | 1,350 | 1,435,121 |
| Neighbor cutoff 0.35 | 320 | 53.59% | 30.14% | 2,679 | 2,832,855 |
| Up to two original units per side | 320 | 60.91% | 31.23% | 1,205 | 1,242,303 |
| Up to 64 added tokens per side | 320 | 61.88% | 31.03% | 824 | 1,107,605 |
| Neighbor also scores 0.50 against the core | 320 | 60.51% | 30.71% | 1,205 | 1,267,942 |
| Body up to twice the core's token length | 320 | 60.51% | 30.59% | 1,015 | 1,215,064 |
| Proposed body scores at least 0.80 against the core | 320 | 60.51% | 30.80% | 1,123 | 1,299,054 |
| Proposed body scores at least 0.90 against the core | 320 | 61.47% | 31.04% | 840 | 1,270,841 |
| Same 0.90 floor, more room | 384 | 61.86% | 30.96% | 934 | 1,376,721 |
| Same 0.90 floor, neighbor cutoff 0.35 | 320 | 59.14% | 31.36% | 1,774 | 2,055,129 |

With the 0.50 neighbor cutoff and 320-token ceiling, 46 of 674 passages that added one unit ended below 0.80 core similarity (6.8%). Among passages that added several, 109 of 531 fell below it (20.5%). The longest run added ten units. Lowering the cutoff to 0.35 allowed 31 additions. The direct 0.90 floor held for every accepted body, including all 299 passages that grew more than once at 320.

One limit of a cosine floor showed up in the financial evidence. The 0.90 floor recovered complete evidence for 40 of 62 questions, compared with 37 under the neighbor cutoff alone and 44 using the original cores. For papers those counts were 33, 32 and 32 of 63. Repeated source positions accounted for 4.28% of delivered document characters with the neighbor cutoff alone, 2.09% with the floor and 0.11% with the original cores. A separate retrieval experiment could rank the cores, then fill context from their expansions while counting each source range once.

The intervals above resample paired contracts, papers, reports, shared search pools and meetings with the study's 2,000-draw bootstrap. They describe individual exploratory comparisons. The document splits contribute just two independent pooled Wikipedia searches. The raw file also reports retrieval at 256 and 1,024 delivered tokens. [Reproduction commands](README.md#compare-overlap-after-markdown-merging)

The full run reproduced all 100 earlier layouts, cold embedding costs and 360 retrieval results from the first ten settings. A network-disabled replay reproduced the other 40 layouts, their costs, growth diagnostics and all 144 retrieval results. Every output stayed within its configured final cap. The initial run fetched 1,946,594 new provider tokens and the expanded study fetched 150,270 more. All 93 tests passed.

### Overlap protocol

Freeze the public 256-token Markdown cores. Every overlap arm must reproduce their text and source ranges before growth. Grow by one whole original prose unit per core per round, using its better eligible side and fresh span embeddings. Keep the existing section, omitted-source and protected-block boundaries. Count all repeated text against the same 512-token retrieval budget.

Measure ten settings on two source-disjoint samples. Include the 256- and 320-token public cores, a 0.50 live cosine cutoff at final ceilings of 256, 320 and 384, and five variations at 320. Test a 0.35 cutoff, two units per side, 64 tokens per side, a second 0.50 test against the frozen core, and a final body at most twice its core's token length as separate runs. Both splits run the same settings. Use four published document datasets and eight whole QMSum meetings per split, selected by sorted hashes of meeting IDs before scoring. Assess complete evidence for documents and token recall for meetings. Record cold embedding work, identical output intervals, growth by round and final-to-core cosine for changed bodies. Use 0.80 as a descriptive drift marker.

For the follow-up, check the actual proposed body against the original core after every addition. Test 0.80 and 0.90 floors at a 320-token ceiling, then test 0.90 with either a 384-token ceiling or a lower 0.35 neighbor cutoff. These four settings allow any number of original units on either side. In each round, batch the preferred sides first. Try the other qualifying side in a second batch when the preferred expansion fails the floor. The retrieval budget stays fixed.

## 2026-11-23 · Semantic splitters and document formatting

The original layout favored recursive splitting in the four-document-dataset benchmark. Removing layout lowered the overlapping recursive splitter by **8.32 percentage points** (paired 95% interval −12.17 to −4.65). LangChain's chunk-count configuration with a 256-token cap held at 49.96% in both views. Its gain *relative to recursion* from removing layout was **8.32 points** (+4.38 to +12.25). Its final lead on flattened text was **1.11 points** (−2.48 to +4.77). [Full results, source fingerprints, chunk sizes, costs and paired intervals](results/2026-11-23-semantic-formatting.json)

Every method could deliver 512 tokens. The document columns measure complete annotated evidence, averaged equally over CUAD, QASPER, FinQA and pooled HotpotQA. The meeting columns measure the mean fraction of annotated evidence tokens retrieved for each QMSum query. Cold tokens include embedding work for selecting boundaries and indexing the final passages.

| Chunker | Documents, original | Documents, flat | Meetings, speaker lines | Meetings, flat | Cold tokens, original documents | Cold tokens, speaker lines |
|---|---:|---:|---:|---:|---:|---:|
| Semachunk Markdown | **57.99%** | **51.49%** | 26.29% | 25.73% | 1,079,606 | 902,926 |
| Semachunk plain text | 45.73% | 47.17% | 20.08% | 20.08% | 1,611,376 | 875,226 |
| Recursive, 64-token target overlap | 57.17% | 48.86% | 30.09% | 29.59% | 839,378 | 579,781 |
| Recursive, zero overlap | 54.91% | 45.10% | **32.18%** | **29.63%** | 760,579 | 484,503 |
| LangChain semantic, native default | 41.22% | 40.86% | 23.62% | 23.31% | 2,946,712 | 1,931,014 |
| LangChain semantic, native chunk count | 47.53% | 47.36% | 25.08% | 25.17% | 2,946,414 | 1,931,086 |
| Native chunk count with a 256-token cap | 49.96% | 49.96% | 29.00% | 29.41% | 2,947,404 | 1,931,806 |

**What the document sample rewards.** All 48 papers have heading hierarchies and paragraph evidence, all 77 financial pages have formatted tables, and 23 of 24 raw contracts have blank-line breaks. Of 1,262 titled Wikipedia documents, 1,202 already fit in 256 tokens. Each of these four tasks contributes one quarter of the primary score. Flattening cost overlapping recursion 6.71 points on contracts, 17.78 on papers and 9.57 on finance. It gained 0.78 on pooled Wikipedia. Semachunk Markdown's four-task result also fell by 6.49 points (−10.38 to −2.84).

On original documents, semachunk Markdown led capped semantic splitting by 8.02 points (+4.14 to +11.91). On flattened documents its lead narrowed to 1.53 (−1.38 to +4.35). The capped semantic method led overlapping recursion on flattened contracts (34.56% vs 25.84%) and financial pages (67.83% vs 56.52%). Recursive splitting led on flattened papers (32.59% vs 17.78%). With both contestants at zero overlap, capped semantic splitting led recursive splitting on flattened documents by 4.86 points (+1.41 to +8.32). At 1,024 delivered tokens on flattened documents, overlapping recursion reached 67.00% and capped semantic splitting reached 66.44%.

**What the meeting transcripts reward.** On speaker-labelled meeting lines, zero-overlap recursion led capped semantic splitting by 3.18 recall points (+0.91 to +5.32). Capped semantic splitting led semachunk Markdown by 2.72 (+0.35 to +5.32). On a single paragraph per meeting the gap between zero-overlap recursion and capped semantic splitting was 0.22 points (−2.60 to +3.02). The capped semantic method used 3.99 times the cold embedding tokens of zero-overlap recursion on the speaker lines. In that view, semachunk Markdown produced 9,406 chunks with a median of 29 tokens, plain text produced 18,901 with a median of 14, and zero-overlap recursion produced 2,309 with a median of 229. The three methods recovered complete meeting evidence for 2, 1 and 16 questions respectively.

**Decision.** Keep the release behavior. Recursive splitting is a competitive low-cost baseline for these multi-topic transcripts. The native semantic default trailed overlapping recursion on both document presentations and both transcript presentations. Controlling semantic passage size closed much of that gap. Five native default passages across the two document presentations exceeded the embedding client's 8,191-token slice length. The longest had 9,598 tokens. The requested native chunk count still produced an original passage of 3,334 tokens. Explicit subdivision kept all capped semantic passages within 256 tokens.

### Measurement and verification

Compare the shipped Markdown and plain-text APIs, generic recursive splitting at 256 tokens with 64 tokens of target overlap, and the published Python SemanticChunker. Run its default 95th-percentile breakpoint, its native document chunk-count setting (one requested chunk per 256 source tokens, rounded up), and the latter with an exact 256-token subdivision of oversized outputs. The native settings have no hard size cap. Give every method identical dense retrieval, source evidence and 256-, 512- and 1,024-token delivery budgets. Record native size distributions and the cold embedding inputs for boundaries and final indexing. [Semantic splitter source](https://github.com/langchain-ai/langchain-experimental/blob/main/libs/experimental/langchain_experimental/text_splitter.py)

Run each approach on both the original presentation and a single-paragraph rendering of the same words in the same order, with heading markers removed and whitespace collapsed. Preserve financial cell delimiters, speaker names, case and punctuation. Remap the human evidence offsets before scoring. Use the prior 676 questions from four datasets and report their equal-weight complete-evidence score. Separately evaluate all 244 span-annotated specific queries from the 35 published QMSum test meetings. Score meeting evidence by mean token recall as many annotated discussions exceed the delivery budget. Measure the change in each method's lead over recursion when formatting is removed using paired group resampling. [QMSum data and annotation format](https://github.com/Yale-LILY/QMSum)

The first native contract run exposed a passage exceeding the model input limit. Preserve native retrieval boundaries by following OpenAIEmbeddings' long-input rule. Embed contiguous slices of up to 8,191 token IDs, then normalize the token-count-weighted sum of their vectors. Count these passages explicitly. The capped configuration uses the ordinary single-vector path. Verified all 15,111 individual source annotations after flattening and complete plain-text alignment for all 2,892 document presentations. [Length-safe embedding implementation](https://github.com/langchain-ai/langchain/blob/master/libs/partners/openai/langchain_openai/embeddings/base.py)

After the first contract and paper results, add the previously tested zero-overlap recursive configuration as a secondary control. This matches the semantic output's zero overlap. Keep the overlapping recursive splitter as the primary comparator.

All 35 meetings have two to seven annotated topics (median four). Render each speaker and utterance on one line in the original view and retain the speaker labels in the flattened view. Score utterance content at its annotated turn offsets. At the primary budget, 108 of 244 queries have at most 512 annotated source tokens. The median is 593 and the maximum is 8,983. The 37 general meeting queries have no supporting spans and are outside this retrieval metric.

The paired intervals use 2,000 within-task bootstrap samples of whole contracts, papers, financial reports, shared HotpotQA search pools or meetings. The formatting comparison holds question, word order and topic sequence fixed. Both the splitter and the embedding model see the changed rendering. These retrieval results use one English-language meeting dataset, one embedding model and one external semantic algorithm in three configurations. LangChain's maintainers described the archive as a package-wide maintenance decision. [Maintainers' announcement](https://github.com/langchain-ai/langchain-experimental/issues/87)

All 70 combinations respected the delivery budget. Both semachunk modes and the capped semantic configuration met their body limit everywhere. Some native recursive chunks exceeded the 256-token target by up to three tokens. The original Markdown and both recursive controls reproduced all 45 prior dense retrieval results across the three delivery budgets, as well as their body hashes and cold indexing costs. Recomputed all ten paired changes in relative performance independently. The successful measurements recorded 859 provider requests for 192,553 inputs and 16,828,113 tokens. These provider totals exclude the interrupted first attempt and reflect cache reuse. [Reproduction commands](README.md#compare-markdown-retrieval)

A full network-disabled replay reproduced all 70 body hashes, all 252 dense retrieval measurements and all 42 paired estimates. It also reproduced indexing calls, input counts, final index tokens and 69 of 70 cold embedding-token totals exactly. On the original meeting transcripts, plain-text semachunk requested 875,226 tokens in the measured run and 875,279 on replay, a difference of 0.0061%. Two provider batches had slightly different vectors for the same scoring input (text SHA-256 starts with `242d65d196fd`). Substituting that single recorded vector reproduced the 53-token difference in meeting 33. Its intermediate embedding inputs changed and its final chunks were identical. All 83 tests passed.

## 2026-11-23 · Comparison with other chunking and retrieval methods

At 256 body tokens with dense search, the shipped Markdown implementation gained **8.03 percentage points over sentence packing** (paired 95% interval +4.13 to +12.09) and **8.31 over overlapping token windows** (+4.57 to +12.15). Its lead over generic recursive splitting with 25% overlap was **0.81 points** (−3.05 to +4.56), at a cost of **28.6% more embedding tokens** to build the index. The two overlapping recursive splitters tied on the aggregate dense score, with different outcomes on 12 paper questions. [Full scores, per-question outcomes and paired intervals](results/2026-11-23-retrieval-baselines.json)

Each percentage is the average of four dataset rates for retrieving all annotated evidence in 512 delivered tokens. Cold embedding tokens include each method's boundary-scoring and final indexing inputs. Indexed chunks count the vectors stored for retrieval.

| Body setting | Chunker | Dense | BM25 | Hybrid | Indexed chunks | Cold embedding tokens |
|---|---|---:|---:|---:|---:|---:|
| 256 tokens | **Shipped Markdown** | **57.99%** | 44.26% | **55.43%** | 7,828 | 1,079,606 |
| 256 tokens | Sentence packing | 49.95% | 41.99% | 50.27% | 3,996 | 753,054 |
| 256 tokens | Recursive, zero overlap | 54.91% | 46.59% | 54.20% | 4,637 | 760,579 |
| 256 tokens | Recursive, 25% overlap | 57.17% | 47.23% | 55.12% | 4,893 | 839,378 |
| 256 tokens | Markdown recursive, 25% overlap | 57.17% | **48.15%** | 54.57% | 5,052 | 833,204 |
| 256 tokens | Token windows, 25% overlap | 49.68% | 42.34% | 47.96% | 4,488 | 959,894 |
| 500 characters | **Shipped Markdown** | **53.20%** | **42.72%** | **50.05%** | 9,887 | 767,454 |
| 500 characters | Sentence packing | 48.09% | 41.99% | 47.34% | 8,848 | 752,027 |
| 500 characters | Recursive, zero overlap | 48.29% | 38.93% | 45.98% | 10,549 | 759,421 |
| 500 characters | Recursive, 25% overlap | 51.95% | 40.68% | 50.01% | 11,263 | 877,421 |
| 500 characters | Markdown recursive, 25% overlap | 51.76% | 40.87% | 49.64% | 11,436 | 876,430 |

At 256 body tokens, dense search with shipped Markdown recovered more complete contract evidence than overlapping generic recursion (37.58% vs 32.55%) and less financial evidence (63.48% vs 66.09%). Papers scored 49.63% vs 50.37% and pooled HotpotQA scored 81.25% vs 79.69%. Reducing the delivered budget to 256 tokens gave 39.22% vs 36.67%. Increasing it to 1,024 gave 74.77% vs 73.50%.

With BM25 alone, the Markdown recursive splitter led shipped Markdown by 3.89 points (+1.07 to +6.58). On the shipped chunks, fusing dense and keyword ranks reduced complete evidence by 2.56 points at 256 body tokens (−5.12 to −0.14) and by 3.15 at 500 characters (−5.98 to −0.34).

At the public 500-character default, shipped greedy packing scored 1.25 points above overlapping generic recursion with dense search (−1.59 to +3.99) and used 12.5% fewer embedding tokens. The character setting is a soft target for shipped Markdown and sentence packing. They exceeded it on 511 of 9,887 and 400 of 8,848 chunks respectively. All recursive character chunks met it. At the 256-token setting every shipped chunk met the hard limit. The three recursive configurations exceeded their token target on 8, 14 and 14 chunks, with maxima of 257, 258 and 258 tokens. The delivered-context cap was enforced for every method.

Retain the existing release rule. The results support the section-aware approach against flat sentence packing and fixed windows. Overlapping recursion was competitive on dense retrieval and used fewer indexing tokens at the token setting. The comparison covers one embedding model and four English-language datasets. For the contracts, papers and financial records, the search already knows the source document. Generated answers, citation support and full-corpus search across those collections would require a separate evaluation.

### Measurement and verification

Use the existing 676-question replication sample with the release settings fixed. The primary comparison uses 256-token chunks and 512 delivered tokens. Also measure the public 500-character default and the 256- and 1,024-token retrieval budgets. Keep all four datasets, document pools, source annotations, query vectors and the embedding model identical. The sample was previously used to validate the release rule.

Run the public Markdown API, sentence packing, 256-token windows with 64 tokens of overlap, and the published JavaScript recursive text splitters. Use the generic recursive splitter with zero and 25% target overlap and the Markdown recursive splitter with 25%. Pass the same tokenizer to the reference splitters for token sizing and preserve their native output. Count actual target overruns. Verify that each sequence of reference chunks has a single placement covering the source in order. The splitter can trim whitespace and repeat text when overlap is enabled. [Recursive splitter](https://docs.langchain.com/oss/javascript/integrations/splitters/recursive_text_splitter)

Dense cosine and standalone BM25 each rank the full candidate set, with ties in source order. Hybrid uses equal-weight reciprocal rank fusion of all dense results and positive BM25 matches with the published rank constant of 60. Compare paired complete-evidence outcomes at 512 delivered tokens using 2,000 group bootstrap draws. Resample contracts, papers, financial reports and whole HotpotQA search pools. Each of the four HotpotQA pools shares its distractors across 32 questions. Report cold indexing costs separately from API cache misses. [Reciprocal rank fusion](https://cormack.uwaterloo.ca/cormack/cormacksigir09-rrf.pdf)

The test indexed 1,411 source documents. Its 298 contract, 135 paper, 115 financial and 128 multi-hop questions contributed 24, 46, 68 and 4 bootstrap groups respectively. All 47,830 native recursive chunks mapped uniquely to source spans. The public API reproduced the prior body hashes and cold indexing costs for all eight dataset/size combinations, and all 60 prior dense and BM25 results across the three delivered budgets. The run made 138 provider requests for 30,501 new inputs and 3,856,342 reported tokens. All 79 tests passed. [Prior replication](results/2026-11-23-markdown-rule-replication.json) · [Reproduction commands](README.md#compare-markdown-retrieval)

## 2026-11-23 · Markdown combination by chunk budget

Ship greedy section packing when `maxChunkSize < 1024` or `maxChunkTokens < 256`. When both limits allow that capacity, score the original eligible prose boundaries once, calibrate the cutoff from their cosines and keep it for every pass. The public 500-character default uses packing. Each hard token check still counts the actual raw and prefixed text. [Frozen rules](results/2026-11-23-markdown-rules.json) · [Replication on 676 independent questions](results/2026-11-23-markdown-rule-replication.json)

The primary outcome is complete annotated evidence in 512 delivered tokens, averaged equally across four datasets and six size settings. Costs cover all six indexes, including scoring and final embeddings. Intervals are paired 95% group bootstraps.

| Combination | Complete evidence | Gain per 100 over packing | Logical calls | Embedded tokens |
|---|---:|---:|---:|---:|
| Greedy packing | 52.82% | — | 8,491 | 4,588,066 |
| **Budget rule** | **56.04%** | **+3.22 (+1.74 to +4.67)** | **9,249** | **5,958,407** |
| Always score, frozen cutoff | 55.81% | +2.99 (+1.45 to +4.60) | 10,564 | 6,634,566 |
| Tighten the cutoff after pass one | 55.83% | +3.01 (+1.20 to +4.86) | 10,564 | 6,379,911 |
| Score when half the interior units fit both neighbors | 55.99% | +3.17 (+1.70 to +4.77) | 10,374 | 6,320,249 |

The budget rule used **29.9% more tokens than packing** and **10.2% fewer than always scoring**. Its gain over always scoring was +0.23 per 100 (−0.37 to +0.80). Tightening the cutoff after the first pass scored −0.21 against the budget rule (−1.30 to +0.96). Selecting by competing neighbors scored −0.06 (−0.79 to +0.67). Both alternatives used more tokens. Keep the size rule and the frozen cutoff.

| Dataset | Questions | Packing | Budget rule |
|---|---:|---:|---:|
| CUAD contracts | 298 | 33.05% | 36.13% |
| QASPER papers | 135 | 44.57% | 43.70% |
| FinQA annotated rows and prose | 115 | 53.19% | 63.48% |
| Pooled HotpotQA | 128 | 80.47% | 80.86% |

At 500 characters, scoring changed complete-evidence retrieval by −0.82 per 100 (−2.73 to +1.05). At 256 body tokens it gained +2.98 (+0.38 to +5.72), at 2,048 characters +6.09 (+3.22 to +8.99) and at 512 body tokens +7.46 (+4.58 to +10.46). The 1,024-character estimate was +2.80 (−0.02 to +5.52). With both a 500-character and a 256-token cap, the observed gain was −0.74 (−2.57 to +1.17). These measurements used English-language data and one embedding model. Heading context, special table lead-ins and pass-dependent cutoffs remain benchmark experiments. [Per-size intervals, question outcomes, budget curves and cost breakdown](results/2026-11-23-markdown-rule-replication.json)

The replication needed 270 provider requests, 40,869 inputs and 4,052,838 reported tokens. The full Markdown study, including heuristic calibration and both independent rule evaluations, used 1,007 provider requests, 95,550 inputs and 9,775,482 reported tokens. Logical cold index costs in the table count the work of each policy independently of provider-cache reuse.

At the 1,024-character setting, the synthetic long section made 10 calls for 2,052 distinct inputs and 28,281 tokens. Its median warm time was 780 ms and peak RSS was 352 MiB. With 2,048 short sections the API made seven calls for 1,539 inputs and 20,804 tokens, with the same boundaries as the 500-character run. Median time was 975 ms and peak RSS was 374 MiB. Neither workload needed a singleton call. [Timings, chunk counts and boundary hashes](results/2026-11-23-markdown-automatic-performance.json)

An offline replay through the public `chunkText` API verified **83,487 chunks** across both rule-validation samples, including the two mixed caps. All 64 dataset/setting comparisons reproduced the measured text and source-range hashes, callback counts, singleton counts, input counts and token totals. Every returned vector matched the recorded vector for its literal indexing string. The two historical suites also reproduced their original scores, sample fingerprints and indexing costs from 177 cached batches. All 76 tests passed. A clean consumer installation verified optional parser loading, the install error, Markdown source mapping and the strict TypeScript overloads.

## 2026-11-23 · Independent test of automatic Markdown rules

On 172 fresh questions the budget switch recovered **60.93%** of complete evidence at 512 delivered tokens across the six settings. Greedy packing recovered **58.50%**. The paired gain was **+2.43 per 100** (95% interval −0.78 to +5.68). The budget switch used 1,463,289 embedding tokens versus 1,104,710 for packing and 1,618,484 for scoring everywhere. The document-structure rule reached 61.23%, +0.30 over the budget rule (−1.15 to +1.56). [Validation scores, cost and paired intervals](results/2026-11-23-markdown-rule-validation.json)

Tightening the cutoff to the initial mean after the first pass reached 62.17%, +3.66 over packing (+0.82 to +6.67), +0.96 over a frozen cutoff (−0.43 to +2.81), and +1.24 over the budget rule (−0.26 to +3.18). It used 1,561,480 tokens. At 256 body tokens, original-boundary scoring gained +4.87 per 100 (+0.22 to +9.82), the third positive independent interval at the previously selected setting. At 500 characters the difference was −0.06 (−3.01 to +2.37). The mixed-cap runs matched the tighter limit, including chunk hashes and retrieval scores. The heuristic search and this validation added 364 provider requests, 18,963 inputs and 2,309,949 reported tokens.

The budget-switch interval crosses zero across sizes, and the pass challenger changed rank between calibration and validation. Use one larger replication of the frozen shortlist to resolve the release decision. Keep all cutoffs, pass schedules, size settings, controls, metric and weighting fixed. The primary comparison is the budget switch against packing. Adopt it if the lower paired bound exceeds zero. A more expensive pass or document rule must clear both packing and the budget switch and show positive differences against both on the preceding independent sample. Otherwise choose the simpler qualifying rule, or packing when none qualifies. This is the final sample for this decision.

The replication has 298 contract, 135 paper, 115 row-plus-prose financial and 128 multi-hop questions. It uses the next 24 contracts and 48 papers in seeded order and all 68 eligible financial reports in the released test split that appeared in none of the sampled development groups. Four title-disjoint, balanced 32-question multi-hop pools preserve the distractor setting. All document IDs, question IDs and groups were checked against the preceding four splits before scoring. [Frozen sample and source hashes](results/2026-11-23-markdown-samples.json)

Offline verification matched all 32 dataset/setting layouts for public greedy packing and all 32 for the original-boundary implementation. Both reproduced the independently measured source-range and text hashes, callback counts, inputs, singleton batches and embedded token totals. The priority mergers share the same per-pass cap calculation. An insufficient percentage cap can skip scoring entirely. All 75 tests passed.

## 2026-11-23 · Automatic policy experiment design

Use the original calibration documents for the heuristic search. Cross three character caps (500, 1,024 and 2,048) with three independently measured token budgets (128, 256 and 512) as six separate settings. The pairs have similar nominal sizes in English. Token counts are measured for each actual input. Weight each setting and each dataset equally. Resample independent question groups once per bootstrap draw, keeping all six results for each question together.

Compare always packing and always scoring against rules using the presence of a hard token cap, a medium or large configured budget, the fraction of original boundaries that fit (one half or three quarters), and the fraction of interior units that fit with both neighbors (one quarter or one half). For original-boundary scoring, compare the frozen document cutoff with one merge pass, a cutoff tightened to the initial mean after the first pass, and recalibration from the remaining eligible scores each pass. Select candidates on calibration and retain the simplest when an extra adjustment has no clear gain.

The fourth independent sample contains 86 contract, 27 paper, 27 row-plus-prose financial and 32 multi-hop questions. It shares no sampled documents or groups with the three previous samples. Freeze the best budget rule, document rule and pass challenger before measuring this sample. Also check the two mixed-cap settings of 500 characters with 256 tokens and 1,024 characters with 128 tokens. Report indexing work alongside paired complete-evidence differences. [Frozen samples](results/2026-11-23-markdown-samples.json)

Two additional calibration arms directly vary the initial cosine cutoff with available capacity. If `p` is the fraction of original boundaries that fit, test both `mean − p × SD` and `mean − (1 − p) × SD`. These coincide with the existing cutoff at `p = 0.5` and test opposite directions without introducing a fitted coefficient. Compare the stronger of these with the pass schedules before freezing the shortlist.

Require a positive lower paired interval over packing to add automatic scoring. Favor the cheaper budget rule if the more involved document or pass rule has an interval spanning zero against it. Report the comparison with scoring every document as well. The mixed caps are diagnostics and do not enter the selection mean.

Calibration froze the budget rule at **1,024 characters and 256 tokens**. An unbounded limit satisfies its side of the test. Its mean was 53.68%, compared with 50.83% for packing, 51.98% for scoring whenever a token cap was set, and 53.22% for scoring everywhere. Relative to packing the paired difference was +2.85 per 100 (+0.34 to +5.28). Scoring when at least half the interior units fit with both neighbors reached 53.51%. Tightening to the initial mean after pass one scored 52.82%, one pass 52.47%, live recalibration 52.18%, and the two density-adjusted cutoffs 52.54% and 52.37%. The independent shortlist uses the budget rule, the half-competing rule, the stronger pass challenger and both constant controls. [Raw calibration grid and paired comparisons](results/2026-11-23-markdown-rules.json)

## 2026-11-23 · Fresh confirmation at both size settings

At **500 UTF-16 code units**, greedy packing scored **57.78%**, original-boundary scoring at the document cutoff **57.57%** (−0.22 per 100, paired 95% interval −2.57 to +1.47), and a fixed 0.5 cutoff **56.40%**. Greedy used 365 logical calls and 210,282 tokens. The document cutoff used 530 calls and 295,668 tokens.

At **256 body tokens**, greedy scored **56.51%** and the document cutoff **62.53%** (+6.02 per 100, +2.14 to +10.66). Original-boundary scoring recovered eight more complete contract answers, two more paper answers and five more financial answers, and lost one pooled multi-hop answer. Its 421 calls and 306,974 tokens compare with 363 calls and 209,507 tokens for packing. This independently reproduces the benefit at the matched token setting and locates the tradeoff at the public character setting. [Complete confirmation results](results/2026-11-23-markdown-confirmation.json)

On the semantic candidate's fixed calibration bodies, heading paths added zero complete answers at the 256-token deployment cap and lost one paper answer at the provider ceiling. The title control gained one paper answer at the deployment cap with an interval spanning zero. The release has no automatic heading-indexing option. [Context results for original-boundary scoring](results/2026-11-23-markdown-fixed-context.json)

The complete study used **373 paid requests, 35,718 distinct inputs and 3,412,695 provider-reported tokens**, including the query preload, calibration, both context studies and both independent evaluations. A subsequent offline replay reproduced the body and source-range hash of every reported configuration on every sample and verified all 373 ordered provider input lists against their batch keys.

An isolated repeat of the synthetic performance run produced the same boundary hashes, call counts and embedded token counts as the initial run. Median warm times were 279 ms for the long section and 559 ms for 2,048 sections. Peak process RSS was 324 and 415 MiB. The first measurement overlapped other verification work, so the time difference includes machine load. [Repeat timings and memory](results/2026-11-23-markdown-performance-repeat.json)

## 2026-11-23 · Independent Markdown retrieval evaluation

The frozen finalists produced the following complete-evidence counts at 512 delivered tokens. Each mean gives equal weight to the four tasks. Calls and tokens include scoring and final indexing across all documents. [All costs, budget curves and paired outcomes](results/2026-11-23-markdown-final.json)

| Markdown combination | CUAD / 72 | QASPER / 36 | FinQA / 35 | Pooled HotpotQA / 32 | Mean | Logical calls | Embedded tokens |
|---|---:|---:|---:|---:|---:|---:|---:|
| Greedy | 34 | 17 | 16 | 28 | 56.91% | 358 | 146,228 |
| Original boundaries, document cutoff | 35 | 19 | 20 | 29 | 62.29% | 420 | 206,385 |
| Rescored bodies, cutoff 0.7 | 35 | 18 | 22 | 29 | 63.02% | 466 | 160,138 |

Original-boundary scoring gained 5.37 complete answers per 100 over packing (paired 95% interval +1.00 to +10.45). Rescoring gained 0.73 over original-boundary scoring (−3.05 to +4.66). The lead-in rule changed zero complete outcomes for either finalist tested with it. On the public 500-character settings, the plain priority control scored 49.39% and the Markdown packer scored 55.52%. Matched plain packing scored 58.42%, plain priority 50.78%, the 128/32 window 51.40% and the 256/64 window 55.40%.

This result favors testing the simpler semantic candidate at the public character default before deciding which combination to integrate. Freeze a third, independent sample using the next groups in the original seeded ordering. At 500 characters compare packing, original boundaries at 0.5, and original boundaries at the document cutoff. Repeat the already-selected 256-token comparison. Recheck title and heading context on the original-boundary candidate's calibration chunks. [Confirmation sample and source hashes](results/2026-11-23-markdown-samples.json)

The historical quality and RAG suites replayed offline. Both quality reports matched the published scoring, samples and vector hashes. All twelve RAG methods matched in each of the three datasets, including both HotpotQA pools and every indexing cost. This verification read 177 cached batches and used zero paid requests. [Historical quality](results/2026-11-23-openai-quality.json) · [Historical RAG](results/2026-11-23-openai-rag.json)

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
- The initial grouping heuristic left 26 of 32 documents at 0.5. With grouping enabled, removing the centroid guard preserved SQuAD hits but changed boundaries. With grouping plus merging, WikiSection F1 moved from .3276 to .3290 and pooled HotpotQA BM25 complete at 256 fell from 30 to 29. The centroid used existing sentence vectors. [Archived grouping implementation](README.md#compare-centroid-passes-and-pair-order)
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
