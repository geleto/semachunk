# Passage size, neighbor context and grouped sentences

This experiment records the earlier 2,048-token configuration. The following study compares smaller structural and reading limits and documents the current defaults. [Compact passage defaults](2026-11-27-structural-limits.md)

A hard limit of **2,048 tokens per returned passage**, including neighbors, preserved the two-layout result of **77.0% complete evidence first and 95.5% within five** on replication. The first result averaged **481 tokens**. Searching all 69 sources for each question gave **73.0% / 91.0%**. Paragraphs were the only detail keys in both runs. [Full measurements, per-domain results and paired intervals](2026-11-27-bounded-passages.json)

## How much of the source did the result return?

The table uses paragraph keys, a 15% enclosing-section weight where available and the same 2,048-token reading ceiling. “First” means the first passage contains a complete annotated answer. “Five” means the union of up to five passages covers one complete answer from the correct source. Evidence F1 measures the overlap between the first hit and the cited evidence, penalizing both missing evidence and extra text. “Whole source” means the first hit covers at least 99% of the source it returned, measured in nonwhitespace characters.

| Candidate core and token target | First | Five | Evidence F1 | Mean first-hit tokens | Whole source |
|---|---:|---:|---:|---:|---:|
| Blocks 256 | 76.3% | 93.7% | 17.5% | 465 | 1.3% |
| Semantic-blocks 2,048 | 67.9% | 91.8% | 14.1% | 645 | 13.3% |
| Both layouts | **77.0%** | **95.5%** | **18.2%** | **481** | **4.2%** |
| Blocks 512 | 82.4% | 98.6% | 12.2% | 907 | 20.6% |
| Blocks 1,024 | 83.8% | 98.3% | 9.2% | 1,364 | 24.0% |

Larger structural cores clearly expose the coverage bias. Raising the structural target from 256 to 1,024 nearly tripled first-hit length and roughly halved evidence F1. The two-layout search had a 95th-percentile first hit of 1,088 tokens and a maximum first hit of 1,721. Its five hits averaged 2,312 tokens in total. In 18.1% of cases those hits together covered at least 99% of the question's source. The ceiling applies separately to each hit.

Short documents can still fit. Counting every near-whole first hit as a miss gives **72.8%** first across the original replication pools. Restricting all methods to the same 397 questions about 43 sources longer than 2,048 tokens gives blocks 256 **72.4% / 92.5%** at 493 mean tokens and the two layouts **73.5% / 94.7%** at 491. No first hit covered 99% of its source in that two-layout run. Searching all 69 sources for those questions gave **67.1% / 87.6%** and **69.1% / 89.4%**, respectively. The long-source subset spans six domains because every government page fit under the ceiling.

## Choosing the ceiling

The structural core target was 256 throughout this comparison. Semantic-blocks used a 0.25 split threshold and allowed joins across adjacent paragraphs within their parent. Every emitted core and assembled reading passage had to fit its respective limit.

| Semantic core / reading ceiling, tokens | Replication first / five | Mean first-hit tokens |
|---|---:|---:|
| 512 / 512 | 71.5% / 92.5% | 388 |
| 512 / 1,024 | 73.2% / 94.4% | 464 |
| 1,024 / 1,024 | 75.8% / 94.5% | 467 |
| 1,024 / 2,048 | 76.9% / 95.5% | 483 |
| 2,048 / 2,048 | 77.0% / 95.5% | 481 |

The two largest settings were close on replication. The 2,048-token semantic target also reached 59.5% / 82.8% on development against 54.7% / 78.1% for the 1,024-token target at the same reading ceiling. The bounded run returned exactly the same first-hit evidence spans as the earlier uncapped run for all 484 replication questions and the same ordered five for 481. The highest reading window among all 4,008 bounded candidates was 2,048 tokens. The document API also offers a separate 8,192 UTF-16-unit character ceiling. This experiment measured token limits. [Previous uncapped run](2026-11-27-document-routing.md)

## Where neighbor context helps

The search scores the core embedding and the best contained paragraph embedding equally. With an eligible enclosing section, their shares are 42.5% each and the section receives 15%. The renderer then includes up to one previous and one next chunk inside the authored section or record. It keeps the complete core and adds the nearest complete parser units that fit. The displayed windows also determine which overlapping results are suppressed.

| Display and neighbor share of ranking score | Replication first / five | Shared first / five | Replication evidence F1 | Mean first-hit tokens |
|---|---:|---:|---:|---:|
| Core only, 0% | 65.4% / 86.7% | 62.6% / 82.5% | 23.8% | 226 |
| Core and neighbors, 0% | **77.0% / 95.5%** | **73.0% / 91.0%** | 18.2% | 481 |
| Core and neighbors, 15% | 75.4% / 95.2% | 70.8% / 90.4% | 16.8% | 487 |
| Core and neighbors, 30% | 71.6% / 96.1% | 66.6% / 91.2% | 15.7% | 507 |

The experimental ranking blend used cosine similarity between the question and the actual displayed text from each available side, averaging the two sides if both were present. At 30%, a small within-five gain came with a 5.4-point first-hit loss on replication. At 15% the development first-hit rate rose from 59.5% to 61.4%, while within-five fell from 82.8% to 82.4%. The implemented reading window gives neighbors **zero ranking weight** and needs no extra neighbor embeddings.

## How much do sentence embeddings buy?

Both candidate layouts used the same core, paragraph and section scoring throughout. Optional sentence groups had to stay within one chunk and one source paragraph. A group got one embedding of its actual text. The cutoff applies to each consecutive pair of sentences during grouping. Stored vectors count distinct embedded texts across the 69 replication sources, including cores, paragraphs and sections. Repeated text shares storage.

| Optional detail keys | Stored vectors | Development first / five | Confirmation first / five | Replication first / five | Shared first / five |
|---|---:|---:|---:|---:|---:|
| Paragraphs only | 8,913 | 59.5 / 82.8 | 60.4 / 89.1 | 77.0 / 95.5 | 73.0 / 91.0 |
| Individual sentences | 19,815 | 66.4 / 85.5 | 61.3 / 90.6 | 76.0 / 95.6 | 72.0 / 91.6 |
| Consecutive pairs | 16,164 | 63.2 / 86.1 | 61.9 / 90.5 | 75.8 / 95.4 | 70.9 / 91.6 |
| Consecutive triples | 14,013 | 64.2 / 84.8 | 62.7 / 90.5 | 76.8 / 95.6 | 72.5 / 91.5 |
| Up to three, cosine ≥ 0.25 | 13,028 | 63.6 / 84.1 | 61.7 / 90.4 | 76.5 / 95.6 | 72.3 / 91.6 |
| Up to three, cosine ≥ 0.40 | 16,019 | 64.3 / 84.8 | 62.2 / 90.5 | 76.0 / 95.6 | 71.9 / 91.8 |
| Up to three, cosine ≥ 0.55 | 18,508 | 66.3 / 85.4 | 62.0 / 90.5 | 76.4 / 95.3 | 72.1 / 91.9 |

At 0.25, groups saved **34% of the whole index** against individual sentence keys and reached the same 95.6% within five on replication. The source-paired 95% interval for the first-hit difference spans −1.98 to +3.23 percentage points. Development lost 2.8 points first and 1.4 within five. Fixed triples saved **29%** and need no individual sentence embeddings to choose group boundaries. Individual sentences helped most on development, while paragraph keys alone had the highest replication first-hit rate. The API keeps paragraph keys as the default and offers both forms of sentence grouping.

The same detail option had different effects on the two individual layouts. Adding individual sentences to semantic-blocks alone raised replication from **67.9% / 91.8%** to **71.1% / 93.8%**. Adding them to blocks 256 alone moved it from **76.3% / 93.7%** to **74.8% / 92.5%**. Fixed triples reached **68.1% / 93.5%** for semantic-blocks and **76.8% / 93.3%** for blocks. The sentence tests used a 2,048-token passage ceiling for semantic-blocks and 1,024 for blocks 256. Every blocks-256 window fit within 760 tokens.

## Data and reproduction

The sweep used 101 configurations on 2,049 questions about 209 complete sources. Development used 758 questions on 66 sources, confirmation used 807 on 74, and replication used 484 on 69. The original pools search the specified document or its collection according to the dataset. Shared search uses all 69 replication sources as candidates for each of the same 484 questions. The seven domains carry equal weight. All three splits had been used in earlier experiments. Source-provided outlines were available for ranking flattened documents. A 75% same-source overlap rule suppressed duplicate windows after ranking. The embedding model was `text-embedding-3-small` at 1,536 dimensions with `cl100k_base` token counts.

Four public JavaScript index configurations reproduced the independent sweep's ordered top-five citations and rendered token counts in 1,936 original-pool and 84 shared-pool search comparisons. The shared verification sample used 21 questions. The shared rates above use all 484. [Scoring and intervals](../bounded-passages.py) · [Public API verification](../bounded-passages-verify.mjs)

Use the prepared corpus, citation and vector inputs from the earlier document retrieval study and a Python environment with NumPy. From the repository root run the following commands. [Corpus and input preparation](2026-11-27-document-routing.md#reproduction)

```sh
node --max-old-space-size=4096 benchmarks/bounded-passages-index.mjs
python benchmarks/bounded-passages.py
python benchmarks/bounded-passages.py verify
node --max-old-space-size=4096 benchmarks/bounded-passages-verify.mjs
python benchmarks/bounded-passages-report.py
```
