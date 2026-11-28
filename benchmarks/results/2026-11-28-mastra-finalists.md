# Semachunk and Mastra retrieval finalists

On 1,759 distinct questions from 201 documents, Semachunk returned complete evidence in the first passage **63.12%** of the time. Mastra's format-aware index reached **61.32%**. Across five passages Mastra reached **86.96%** and Semachunk **86.50%**. Semachunk's first passage averaged **60 fewer tokens** and had higher evidence F1. The accuracy differences are small enough that either ordering is consistent with the paired uncertainty estimates. [Per-question results and intervals](2026-11-28-mastra-finalists.json.gz)

| Retrieval strategy | Complete evidence in first hit | Complete evidence across top five | First-hit evidence F1 | Mean first-hit tokens | Indexed passages |
| --- | ---: | ---: | ---: | ---: | ---: |
| Semachunk, structural and semantic layouts | **63.12%** | 86.50% | **21.93%** | **423** | 11,039 |
| Mastra, format-aware layout | 61.32% | **86.96%** | 17.86% | 483 | 2,738 |
| Mastra, format-aware and sentence layouts | 59.11% | 86.64% | 17.66% | 488 | 5,228 |

The paired 95% intervals for Semachunk minus the Mastra single layout were **−0.60 to +4.82 percentage points** in the first hit and **−2.81 to +1.40 points** across five. Giving each distinct question equal weight yielded **67.34% / 90.48%** for Semachunk and **65.58% / 90.51%** for Mastra. Under either weighting, first-hit accuracy favored Semachunk and five-hit coverage was close.

## Where the results differed

| Search pool | Distinct questions in pool | Semachunk first / five | Mastra format-aware first / five |
| --- | ---: | ---: | ---: |
| Confirmation | 807 | 66.96% / 90.79% | **68.27% / 93.16%** |
| Replication, original pools | 484 | **78.70%** / 95.40% | 74.06% / **96.50%** |
| Replication, all 69 documents | same 484 | **74.19% / 91.52%** | 69.99% / 90.54% |
| Later holdout, original pools | 468 | **53.26%** / 83.09% | 51.18% / **84.15%** |
| Later holdout, all 58 documents | same 468 | **38.68% / 67.43%** | 36.14% / 64.24% |

The main benchmark's raw HTML subset has 158 Federal Student Aid questions. Mastra led on the first hit there, **68.35% to 65.19%**. Semachunk led across five passages, **91.77% to 87.97%**. The two unrestricted multi-document searches both favored Semachunk on both metrics.

## What was tested

The run rebuilt the existing finalists from Semachunk revision `151330b` and Mastra RAG **2.8.2**. Semachunk combined 256-token structural chunks with 512-token semantic chunks at cutoff 0.15. Mastra used its format-aware layout with 512-token cores and zero overlap. It routed prose to recursive splitting, Markdown to Markdown splitting, and HTML through heading segmentation followed by recursive splitting. The earlier development winner added Mastra's sentence splitter. The single layout was the stronger Mastra finalist on the previous full validation and again on this replay. Settings were fixed before this run. These validation documents have been used in earlier experiments. [Earlier selection and splitter settings](2026-11-27-mastra-comparison.md)

Both systems received the original question and the same eligible sources. Both used the same frozen query embeddings, `text-embedding-3-small`, and a ceiling of 512 tokens per returned passage. Both could score contained paragraphs with their nearest heading and use the enclosing section. The Semachunk semantic arm and the Mastra layouts used 30% adjacent-chunk scoring with their established context readers. The harness supplied Mastra's structural scoring and, at revision `151330b`, Semachunk's semantic neighbour scoring and wider reading window. The unified public `chunk` API at revision `2e7c869` implemented this Semachunk profile directly. A replay through `chunk`, `createDocumentIndex` and `index.search` reproduced all four archived metrics on every one of the 2,711 question and search-pool pairs. Each search used a single semantic document per source. The experiment ends at the returned passages. [Mastra chunking API](https://mastra.ai/reference/rag/chunking-and-embedding) · [Public Semachunk index measurements](2026-11-28-html-parser.md)

A later experiment extended structural reading windows while preserving their immediate citations. It reevaluated Semachunk on the same questions. [Updated structural and combined results](2026-11-28-blocks-retrieval.md)

Success requires the passages to cover a complete accepted reference in the correct source. The top five can supply different parts of that reference. First-hit evidence F1 measures overlap with the reference and penalizes unrelated text. The headline gives equal weight to domains within a search scope and equal weight to the three question sets. The paired bootstrap resampled documents within domains 3,000 times, keeping each repeated search paired. All four Semachunk metrics reproduced the previous heading-aware result for every question in all five scopes. [Scoring and aggregation](../mastra-finalists.py)

## Reproduction

Use the corpus snapshots, pinned Mastra installation and embedding caches from the earlier Mastra and HTML parser studies. The indexer checks frozen vector hashes and rebuilds the passage boundaries. New heading-aware Mastra inputs are embedded using the same model as Semachunk. [Index builder](../mastra-finalists-index.mjs)

```powershell
node benchmarks/mastra-finalists-index.mjs confirmation
node benchmarks/mastra-finalists-index.mjs fresh
node benchmarks/mastra-finalists-index.mjs holdout
$env:OPENBLAS_NUM_THREADS = '2'
& '.\benchmarks\.cache\semantic-python\Scripts\python.exe' benchmarks/mastra-finalists.py
```
