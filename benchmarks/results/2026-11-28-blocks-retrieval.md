# Which semantic retrieval features help structural blocks?

Standalone `blocks` gained **0.91 percentage points in the first hit and 0.60 points across five** by extending the reading passage only when it preserved every source span available from the immediate neighbours. The first hit averaged 29 more tokens and evidence F1 fell 0.70 points. The improvement comes from the text delivered to the reader. The queries, candidate chunks, ranking scores and embeddings are identical. [Per-question measurements and paired intervals](2026-11-28-blocks-retrieval.json.gz)

| Standalone blocks | Complete evidence first | Complete evidence across five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| Previous default, immediate neighbours | 61.82% | 85.52% | 21.81% | 402 |
| Add 15% enclosing-section scoring | 61.81% | 85.86% | 21.93% | 398 |
| Add 30% adjacent-chunk vectors to the core | 61.53% | 86.32% | 22.18% | 403 |
| Allow several neighbours up to the passage budget | 62.15% | 86.20% | 20.85% | 432 |
| **Extend only if immediate citations survive** | **62.73%** | **86.12%** | **21.11%** | **430** |
| Preserve citations and add 15% section scoring | 62.72% | 86.46% | 21.24% | 426 |
| Preserve citations and add 30% neighbour scoring | 62.48% | 86.58% | 21.53% | 432 |

Section scoring and neighbour scoring each traded first-hit coverage for some five-hit coverage. Adding section scoring to the selected reader brought another 0.34 points within five and required section embeddings where available. The public standalone default keeps its existing chunk and paragraph index. Callers can set `sectionWeight` at search time. The selected reader works with previously prepared indexes.

## How the reading window changes the answer

The reader starts with the core and the fitting text from its immediate neighbours. It can draw from farther away in the same section or record up to the same 512-token ceiling. A wider window can fill its left side early and displace a nearby sentence on the right. The new reader adopts that window only if it covers all the original cited spans. Of 5,425 validation chunks, it extended 1,394 and retained the immediate window in 679 cases where widening would have dropped a citation. The other 3,352 windows were identical. The check uses source positions so repeated phrases at different offsets remain distinguishable. [Public reader](../../src/document.js)

| Search pool | Previous first / five | New first / five | Queries gaining / losing a complete first hit | Queries gaining / losing a complete top five |
| --- | ---: | ---: | ---: | ---: |
| Confirmation, 807 questions | 67.77 / 92.65% | 68.31 / 93.16% | 2 / 0 | 1 / 0 |
| Replication, original pools | 75.11 / 93.03% | 76.80 / 93.79% | 7 / 0 | 3 / 0 |
| Replication, all 69 documents | 70.17 / 89.21% | 71.56 / 89.72% | 5 / 0 | 2 / 0 |
| Later holdout, original pools | 51.97 / 79.09% | 52.61 / 79.73% | 1 / 0 | 1 / 0 |
| Later holdout, all 58 documents | 38.13 / 66.52% | 38.77 / 67.16% | 1 / 0 | 1 / 0 |

Across 2,711 question and search-pool pairs, preserving immediate citations added 16 complete first hits and eight complete top fives. These represent ten and five distinct questions. First-hit gains came from fiction, government pages, papers and meetings. Five-hit gains came from papers and meetings. A fixed first-ranked core retains its original evidence by construction. Later hits can change because the search suppresses overlapping windows. The unrestricted wider reader gained 17 first hits and lost five, and gained 11 complete top fives and lost seven.

For the selected reader versus the previous default, source-paired 95% intervals were **+0.18 to +1.79 points** first and **+0.09 to +1.29 points** across five. The first result cost **23 to 34 additional tokens** and its evidence F1 difference was **−0.98 to −0.38 points**. These per-comparison intervals come from 3,000 bootstrap resamples of documents within domains. [Scorer and aggregation](../blocks-retrieval.py)

## Does a larger core help?

We rebuilt standalone blocks with core targets of 384 and 512 tokens. The 256-token limit for upper structural blocks, the 512-token reading ceiling, the query vectors and the ranking weights were fixed. We tested both the immediate and the citation-preserving reader at each size. Development selected 256 for the new reader. The validation results below use that reader throughout.

| Core target | Complete first | Complete across five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| **256 tokens** | 62.73% | **86.12%** | **21.11%** | 430 |
| 384 tokens | **63.13%** | 86.02% | 21.10% | 431 |
| 512 tokens | 63.00% | 85.79% | 20.75% | 431 |

The 384-token target gained 0.40 points first and lost 0.10 across five relative to 256. Its paired intervals were −0.88 to +1.73 and −1.36 to +1.42 points. The 512-token target showed the same trade-off. These results support retaining the 256-token structural default.

## Structural hits inside semantic search

We also changed just the structural reading window in the published two-layout semantic finalist. Its 15% section score, its 30% neighbour weight on similarity-split chunks, and all its candidate scores were held fixed. The control reproduced the earlier four metrics for every question and scope. [Earlier finalist](2026-11-28-mastra-finalists.md)

| Combined semantic search | Complete first | Complete across five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| Previous structural window | 63.12% | 86.50% | 21.93% | 423 |
| Structural window preserving immediate citations | 63.13% | 87.07% | 21.69% | 431 |

The combined five-hit gain was concentrated in confirmation. Replication was level and both later holdout searches lost 0.09 points. Its aggregate paired interval was −0.08 to +2.35 points. Using the same rule for structural hits in both strategies keeps the immediate evidence available in either mode.

## Protocol and reproduction

Development screened 36 configurations on 758 questions about 66 sources. Section shares were 0%, 7.5%, 15% and 22.5%. Neighbour shares were 0%, 15% and 30%. The third reading policy was added after the two original policies exchanged nearby and farther source spans on 100 of 1,197 development chunks. Development nominated the plain wider reader using the mean of first-hit and five-hit coverage, preferring simpler configurations within 0.15 points. Validation compared all three readers at the previously established 0% or 15% section and 0% or 30% neighbour settings.

Validation used 1,759 distinct questions about 201 sources across seven domains. The original and shared searches reused the same 484 replication questions and the same 468 later holdout questions. Scores weight domains equally within a scope and the three question sets equally overall. The documents have appeared in prior studies. All variants used the same 256-token structural chunks, heading-aware paragraphs, 50% best-paragraph score, 75% same-source overlap suppression, and 512-token maximum returned passage. Character-mode limits were exercised in regression tests. The retrieval experiment used token counts. [Index construction](../blocks-retrieval-index.mjs)

The encoder was `text-embedding-3-small` at 1,536 dimensions, with `cl100k_base` for token counts. The 256-token study requested 62,633 new embedding tokens on development and reused frozen vectors across validation. The larger-core check requested another 143 embedding tokens across all sets. For standalone blocks and for combined semantic search, a replay through the public API matched the source, ordered citation spans and token count of every returned passage for all 2,711 validation searches per strategy.

Start with the prepared paragraph-ranking and retrieval-finalist corpora and the project’s NumPy benchmark environment.

```powershell
node benchmarks/blocks-retrieval-index.mjs development confirmation fresh holdout
node benchmarks/blocks-retrieval-index.mjs --core=384
node benchmarks/blocks-retrieval-index.mjs --core=512
$env:OPENBLAS_NUM_THREADS = '2'
$benchPython = '.\benchmarks\.cache\semantic-python\Scripts\python.exe'
& $benchPython benchmarks/blocks-retrieval.py select
& $benchPython benchmarks/blocks-retrieval.py validate
& $benchPython benchmarks/blocks-retrieval.py combined
& $benchPython benchmarks/blocks-retrieval.py sizes
node --max-old-space-size=4096 benchmarks/blocks-retrieval-index.mjs verify 0/0/extend
```
