# Source-cited HTML parsing through the shared Markdown structure

Semachunk's public HTML parser now produces the same kinds of positioned blocks as the Markdown parser. Both feed the same code for heading attachment, structural packing, semantic cuts, bounded neighbours and retrieval. HTML projects each displayed range back to its original UTF-16 span, including decoded entities and repeated table headers. [HTML parser](../../src/html.js) · [Shared structure](../../src/structured-units.js) · [Shared chunking](../../src/structured-chunks.js)

## Retrieval with scoring fixed

The headline profile combines 256-token structural chunks and 512-token semantic chunks at cutoff 0.15. The original benchmark gives the semantic arm 30% neighbour weight, blends contained paragraphs and enclosing sections into the scores, and returns at most 512 tokens per passage. Every run used the same queries, evidence, page pools, embedding model and scoring rules as its control. First-hit success requires all accepted evidence from the correct source in the first passage. Within-five success allows those passages to supply different parts of an accepted answer. [Original benchmark and scoring protocol](2026-11-27-mastra-comparison.md)

| Evaluation | Previous HTML first / five | New HTML first / five | Same pages converted to Markdown, first / five |
| --- | ---: | ---: | ---: |
| Four agencies, 347 development questions | 50.43% / 78.96% | 62.82% / 90.20% | 62.54% / 89.91% |
| Four agencies, 449 confirmation questions | 45.43% / 82.85% | **52.34% / 87.97%** | **55.90% / 90.20%** |
| Federal Student Aid, 158 confirmation questions | 28.48% / 74.68% | 47.47% / 84.18% | 48.10% / 83.54% |
| New York DMV, 92 | 48.91% / 89.13% | 45.65% / 84.78% | 45.65% / 92.39% |
| Social Security, 83 | 56.63% / 89.16% | 67.47% / 91.57% | 72.29% / 93.98% |
| Veterans Affairs, 116 | 57.76% / 84.48% | 53.45% / 93.10% | 62.93% / 94.83% |

The confirmation gain was **31 additional complete first hits and 23 additional complete answers within five**. Across the 449 questions, first-hit evidence F1 went from **20.08% to 19.61%**, and mean first-hit length went from **161 to 187 tokens**. More answers were found, with more surrounding text on average. The paired 95% page-bootstrap intervals for the accuracy gains were **+0.46 to +13.73 percentage points first** and **+0.38 to +10.54 within five**. The four-agency data was familiar from earlier experiments.

On Student Aid, the HTML and converted Markdown confirmation trees now agree in their counts of headings, sections, paragraphs and sentences. On DMV, the source sometimes puts a literal number inside an existing HTML list item. Conversion can turn that number into another nested list marker. Native HTML follows the authored list nesting. Scope, visible Markdown syntax and the rendered lengths can still affect individual retrieval results.

Ranking also explains part of the gap. Keeping the same chunks and reading windows and scoring each candidate by its chunk embedding alone gave **61.47% / 90.20%** on direct HTML and **60.36% / 93.76%** on converted Markdown. The previously measured Mastra recursive baseline on the same HTML pages reached **63.92% / 92.87%**. On the separate four-document search below, whole-chunk scoring found 13/20 first and 19/20 within five, one fewer within five than the combined scorer. The production rankings continue to use the same rules across formats. [Mastra and conversion controls](2026-11-28-html-markdown.md)

## Full validation and independent pages

The existing domain-balanced validation score rose from **60.94% / 85.59% to 61.85% / 86.04%** over 1,759 distinct questions. Student Aid is the only raw HTML pool in this suite. We replaced its observed question outcomes and replayed all 174 non-HTML documents against the published baseline. Their complete node and chunk outputs matched, including **5,132 structural and 5,274 semantic passages**. The checker also matched the original source ranges and token counts of their benchmark reading windows. [Non-HTML replay](../html-parser-controls.mjs)

Across the 1,601 non-HTML questions, Semachunk scored **62.75% / 86.34%**, native Mastra recursive **45.55% / 78.81%**, and Mastra's format-aware layout with benchmark-added paragraph, section and neighbour scoring **60.58% / 86.99%**. [Comparison excluding raw HTML](2026-11-28-html-handling.md#comparison-excluding-raw-html)

On a separate four-document search with 20 newly annotated questions, both versions found **13/20 first and 20/20 within five**. Mean first-hit length fell from **382 to 364 tokens** and first-hit evidence F1 rose from **6.58% to 6.73%**. The new parser gained one SQLite first hit and lost one Python first hit. This small check covers reference prose, executable examples, a real two-header table and a science article. Its questions and accepted citation ranges were fixed before measuring either version on those pages. The source manifest records the original URLs and hashes of the exact article fragments. [Question and source manifest](../html-parser-external.json) · [Python](https://docs.python.org/release/3.13.8/library/bisect.html) · [W3C](https://www.w3.org/WAI/tutorials/tables/two-headers/) · [NASA](https://science.nasa.gov/eclipses/types/) · [SQLite](https://www.sqlite.org/whentouse.html)

## What transfers across formats?

On the four government question pools, the native Mastra recursive baseline led the current Semachunk profile with both raw HTML and the same pages converted to Markdown. Across the 1,601 non-HTML validation questions, Semachunk led native Mastra by 17.20 points first and 7.53 within five. Native Mastra won first-hit accuracy in one of the 26 non-HTML domain and search-scope comparisons, retrieving 11 of 56 Markdown research-paper answers first against Semachunk's 9 in the shared replication pool. Semachunk retrieved 32 of those answers within five against Mastra's 24. The two search scopes reuse questions. The independent four-site HTML comparison used the original query vectors, 512-token ceiling and complete coverage of visible source text for each Mastra layout. [Scope counts, controls and paired question outcomes](2026-11-28-heading-paragraph-retrieval.json.gz)

We tested one change to the shared paragraph ranking signal. When the parser supplies a heading path, embed the nearest heading, two newlines and the original paragraph together. Use this vector in the paragraph's existing scoring position. A paragraph without a heading keeps its existing vector. The chunk and section vectors, semantic neighbours, ranking weights, search pools, returned text for each candidate and citation rules were fixed. The experiment embedded 9,058 distinct heading–paragraph combinations. The table gives complete evidence first / within five.

| Search | Semachunk with body-only paragraph embeddings | Semachunk with heading in paragraph embedding | Mastra recursive | Mastra with benchmark-added scoring |
| --- | ---: | ---: | ---: | ---: |
| Government HTML, 449 questions | 52.34% / 87.97% | **65.70% / 92.87%** | 63.92% / 92.87% | 54.34% / 83.96% |
| Same government pages as Markdown, same 449 | 55.90% / 90.20% | **67.26% / 94.65%** | 66.37% / 93.32% | 61.69% / 92.20% |
| Python, W3C, NASA and SQLite HTML, 20 | 13/20 / 20/20 | 14/20 / 20/20 | 13/20 / 20/20 | 14/20 / 20/20 |
| Original Markdown validation, 240 | 57.18% / 82.24% | 58.22% / 82.56% | 48.69% / 78.39% | 57.57% / 84.15% |
| Original plain text validation, 1,361 | 64.66% / 87.84% | 64.66% / 87.84% | 41.91% / 77.86% | 62.05% / 87.29% |
| Full domain-balanced validation, 1,759 | 61.85% / 86.04% | **63.12% / 86.50%** | 46.16% / 79.10% | 59.90% / 86.25% |

The HTML change gained 69 first hits and lost nine. Its first-hit evidence F1 rose from 19.61% to **23.55%**, with the mean first result moving from 187.3 to **186.6 tokens**. The DMV deposit question now retrieves the 229-token answer in first place. The paired page-bootstrap 95% interval for the first-hit gain against current Semachunk was **+7.82 to +18.90 percentage points**. Against native Mastra it was **−7.40 to +10.65**. The four agencies were familiar from earlier experiments. The independent four-site pool gained one NASA first hit. None of the plain-text sources supplied a heading path for an indexed paragraph, and their per-question outcomes matched exactly. The full-suite first-hit improvement had a paired 95% interval of **+0.31 to +2.29 points**, and the within-five interval was **−0.10 to +1.07**. [Per-question replay and protocol](2026-11-28-heading-paragraph-retrieval.json.gz)

The ranking and context controls behaved differently across collections. On non-HTML validation, replacing the current ranker with whole-chunk similarity lowered first / within-five accuracy from **62.75% / 86.34% to 56.31% / 83.97%**. Independently expanding the current ranker's first five displayed hits towards 440 tokens, while preserving existing text and the 512-token ceiling, yielded **62.76% / 86.52%** and lowered evidence F1 from **22.14% to 19.59%**. All validation and format-restricted aggregates use the original domain and search-scope weighting. Scores on the government and four-site pools give each question equal weight.

### Verification through the public index

The shared index now embeds each indexed paragraph with its nearest heading. We replayed the same questions through the previous and updated versions of `createDocumentIndex` using identical parsed documents and query vectors. Each index combined 256-token structural chunks and 512-token semantic chunks at cutoff 0.15. Both used a 15% section weight and the public search reader, which can display one neighbour per side within the section and the 512-token ceiling. The benchmark profile above also weights semantic neighbours during ranking and can display a wider window.

| Search | Previous index, first / within five | Updated index, first / within five |
| --- | ---: | ---: |
| Four government agencies, HTML, 449 questions | 53.01% / 87.53% | **67.26% / 91.98%** |
| Same pages and questions, converted Markdown | 57.02% / 89.09% | **68.37% / 93.54%** |
| Python, W3C, NASA and SQLite HTML, 20 questions | 13/20 first, 20/20 within five | **14/20 first, 20/20 within five** |

On government HTML, 71 questions gained a complete first hit and seven lost one. First-hit evidence F1 rose from 19.36% to 23.81%, and mean first-hit length moved from 173.9 to 174.4 tokens. [Public API outcomes and index settings](2026-11-28-heading-paragraph-public-index.json.gz)

## Reproduction

Use the reviewed page data and original comparison caches from the preceding study. The external preparation script reads the reference library from Git revision `b29a2c22` into the ignored benchmark cache and verifies each source snapshot. The indexer builds the new HTML and Markdown layouts through `chunkDocument`. The scorer checks all three Markdown control profiles against every archived question and verifies byte-identical query vectors for the external comparison. [Original data preparation](2026-11-28-html-markdown.md) · [Per-question results](2026-11-28-html-parser.json.gz)

```powershell
node benchmarks/html-parser-external.mjs
node benchmarks/html-parser-index.mjs --external --legacy
node benchmarks/html-parser-index.mjs --external
node benchmarks/html-parser-index.mjs
node benchmarks/html-parser-controls.mjs
$env:OPENBLAS_NUM_THREADS = '2'
& '.\benchmarks\.cache\semantic-python\Scripts\python.exe' benchmarks/html-parser-score.py
```
