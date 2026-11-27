# Compact passage defaults and retrieval by strategy

The document API now allows **256 tokens for an upper structural block and 512 for an entire returned passage**. A semantic merge inside one paragraph can use all 512. Across the seven replication domains, searching both hierarchical layouts found complete evidence first in **77.9%** of questions. Structural blocks alone had the highest within-five coverage at **93.0%**. [Measurements, per-domain results, source-paired intervals and API checks](2026-11-27-structural-limits.json)

## All modes at the same 512-token ceiling

All modes indexed their chunk and contained paragraphs. The first two score columns use the original replication pools. The optional section score gives a strictly enclosing section 15% of the score where available. The shared search uses that option and searches all 69 replication sources for every question. Each score pair is complete evidence in the first returned passage / across the first five passages. Passage lengths and evidence F1 below use the section option on replication.

| Layout | Default search | With section scoring | Shared search | Mean first-hit tokens | First-hit evidence F1 |
|---|---:|---:|---:|---:|---:|
| Blocks | 75.3 / 92.5% | 75.8 / **93.0%** | 71.1 / **89.0%** | 413 | 18.0% |
| Pack | 69.1 / 92.3% | 69.7 / 92.6% | 63.5 / 87.6% | 428 | 16.5% |
| Semantic | 61.5 / 90.5% | 62.5 / 90.7% | 58.1 / 83.5% | 397 | 15.2% |
| Semantic-blocks | 73.3 / 92.1% | 75.3 / 92.7% | 70.1 / 88.3% | 411 | 18.7% |
| Blocks and semantic-blocks together | **76.0** / 91.7% | **77.9** / 92.2% | **73.2** / 88.3% | 410 | **19.0%** |

The combined index uses two sets of candidate passages for the same source. Its 3,850 chunks, paragraphs and eligible sections shared 7,609 distinct vectors. Blocks alone used 6,850 vectors, pack 6,431, flat semantic 6,791 and semantic-blocks 6,788. Displaying neighbors added no ranking weight or extra embeddings. The top-five score counts the union of cited evidence from the correct source. Evidence F1 penalizes both missing evidence and extra text in the first hit.

| Layout with section scoring | Development first / five | Confirmation first / five | Long replication sources first / five |
|---|---:|---:|---:|
| Blocks | 53.0 / 77.1% | 60.9 / **90.1%** | 71.9 / **91.8%** |
| Pack | 50.1 / 79.4% | 60.9 / 88.2% | 63.3 / 91.1% |
| Semantic | **56.9 / 83.1%** | 61.3 / 88.9% | 59.4 / 89.0% |
| Semantic-blocks | 54.7 / 80.4% | **63.1** / 88.8% | 71.4 / 91.3% |
| Both layouts | 55.2 / 79.9% | 62.2 / 89.8% | **74.4** / 90.8% |

The long-source subset contains 397 questions on 43 sources longer than 2,048 tokens. Across the full replication split, zero first hits from blocks, semantic-blocks or the combined index covered 99% of their source. The combined first-hit gain over blocks was 2.1 percentage points, with a source-paired 95% interval of +0.27 to +4.06. Within five, the difference was −0.8 points with an interval of −2.38 to +0.71. One extra correct first hit among ten finance questions contributed 1.4 points to the seven-domain average. Excluding finance, blocks reached 73.4% / 91.9%, semantic-blocks 74.5% / 93.1% and the combined index 74.2% / 90.9%. In spoken meetings the combined layout missed one additional question within five out of 13. [Domain scores](2026-11-27-structural-limits.json)

## What the lower structural limit does

This control changes only the maximum size of a structural branch or cross-paragraph join. Every row uses the same 0.15 similarity cutoff, paragraph joins, section score and 512-token ceiling for both semantic merges and returned text. The observed maximum size of a core containing two or more complete paragraphs equaled its configured limit in every row on replication.

| Structural limit | Semantic-blocks first / five | Semantic-blocks mean tokens | Semantic-blocks evidence F1 | Both layouts first / five |
|---|---:|---:|---:|---:|
| 192 | 72.9 / 92.5% | 355 | 19.0% | 72.2 / 91.6% |
| **256** | **75.3** / 92.7% | **411** | 18.7% | **77.9** / 92.2% |
| 384 | 70.6 / 90.9% | 453 | 17.7% | 73.9 / 91.0% |
| 512, full core budget | 68.6 / **96.1%** | 462 | 15.0% | 75.7 / **92.8%** |

Giving whole branches the full budget helped semantic-blocks deliver a complete answer across five results. The 256-token structural limit improved its chance of delivering that answer first by 6.7 points, raised evidence F1 by 3.7 points and reduced first-hit length by 51 tokens. Tightening further to 192 cost first-hit coverage in both original and shared search.

## Should the structural reading window also be smaller?

Holding the semantic reading window at 512, we varied only the structural reading window. These are measured, complete source-mapped passages from the public renderer. Both layouts kept the same cores and ranking scores throughout. The window controls the evidence displayed and which overlapping hits survive deduplication.

| Structural / semantic reading ceiling | Combined replication first / five | Shared first / five | Mean first-hit tokens | Evidence F1 |
|---|---:|---:|---:|---:|
| 256 / 512 | 73.7 / 87.8% | 69.8 / 83.4% | 291 | 21.7% |
| 384 / 512 | 74.9 / 88.5% | 70.5 / 84.2% | 364 | 19.4% |
| **512 / 512** | **77.9 / 92.2%** | **73.2 / 88.3%** | 410 | 19.0% |

The 384-token structural reading window saved 46 tokens per first hit, but lost 3.0 points first and 3.7 within five. With the chosen core settings, allowing both windows to grow to 768 yielded 78.4% / 94.2% at 467 mean tokens and a 716-token 95th percentile. The 512-token default gave a 510-token 95th percentile. The previous 2,048-token setup gave 77.0% / 95.5%, averaged 481 tokens, had a 1,088-token 95th percentile and returned nearly the whole source first in 4.2% of cases. Its semantic cutoff and core size also differed. [Previous benchmark](2026-11-27-bounded-passages.md)

## Selection and verification

The primary sweep evaluated 208 settings on 2,049 questions about 209 whole documents. Development had 758 questions on 66 sources, confirmation had 807 on 74, and replication had 484 on 69. Shared search used all 484 replication questions. Each of seven domains received equal weight. All three splits had been used in earlier semachunk research. The original pools used document or collection search according to their dataset. Where an importer had a source outline for flattened text, it supplied those section ranges for ranking.

We selected the defaults on development using mean first-hit and within-five coverage. The predeclared rule chose the smaller eligible ceiling within one percentage point of the best and used the 95th percentile and mean first-hit length to break near ties. The eligible ceilings were 512 and 768, with 1,024 as a comparison. The combined development score was 55.2% / 79.9% at 512 and 57.3% / 79.4% at 768. The selection gave semantic-blocks a 512-token core, a 256-token structural limit, a 0.15 cutoff and paragraph joins. Flat semantic stayed at a 256-token core. A 384-token blocks core reached 73.0% / 94.0% on replication and delivered 455 tokens on average, compared with 413 for blocks 256. The character defaults of 1,024 for structure and 2,048 for the reading passage are engineering choices. These measurements used tokens. [Selection protocol](../structural-limits-protocol.json)

The study used `text-embedding-3-small` with 1,536 dimensions and `cl100k_base` token counts. Ranking searched the complete pool and suppressed subsequent same-source windows overlapping at least 75% of the shorter one. The public JavaScript API reproduced the independent scorer’s ordered citations and token counts in **5,050 searches**. The checks exercised five layouts with both default and optional section scoring on all 484 original-pool and 21 sampled shared-pool questions. [Scorer](../structural-limits.py) · [API verification](../bounded-passages-verify.mjs)

Use the prepared corpora and embeddings from the bounded-passage experiment and a Python environment with NumPy. To regenerate the retired flat-strategy rows, run the commands below in the [historical replay checkout](../README.md#replaying-results-for-the-retired-flat-strategy). Run development before confirmation and replication to freeze the selection. [Input preparation](2026-11-27-bounded-passages.md#data-and-reproduction)

```sh
node --max-old-space-size=4096 benchmarks/bounded-passages-index.mjs --structural-limits
python benchmarks/structural-limits.py development confirmation fresh shared
node --max-old-space-size=4096 benchmarks/bounded-passages-index.mjs --upper-controls
python benchmarks/structural-limits.py upper-controls
node benchmarks/structural-reading-windows.mjs
python benchmarks/structural-limits.py asymmetric verify
node --max-old-space-size=4096 benchmarks/bounded-passages-verify.mjs --structural-limits
python benchmarks/structural-limits.py publish
```
