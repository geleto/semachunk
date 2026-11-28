# Native HTML retrieval, Markdown conversion and the Mastra comparison

Keep HTML input and its original-source citations. On four government confirmation pools, Semachunk went from **45.43% first / 82.85% within five** to **61.47% / 92.87%** by grouping nearby short heading sections and ranking each passage by one embedding of its text. Turndown followed by whole-chunk scoring reached **60.36% / 93.76%**, with slightly shorter and more evidence-dense answers. Both are credible choices for these pages. The native route needs one passage layout and one ranking vector per distinct passage text. [Per-question results and paired comparisons](2026-11-28-html-handling.json.gz)

## What Mastra does well on Federal Student Aid

The format-aware comparison obtains HTML headings from Mastra. Our benchmark adapter projects them onto visible source text, retains the introduction and nested body content, and calls Mastra recursive splitting on the resulting sections. This also enforces the common 512-token return limit. Mastra documents that HTML header splitting can ignore its size setting. The simpler native recursive baseline runs directly on visible text with 25% overlap. [Comparison adapter](../mastra-layouts.mjs) · [Mastra chunk reference](https://mastra.ai/reference/rag/chunk)

| Setup on 158 Student Aid questions | First | Within five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| Semachunk's previous combined index | 28.48% | 74.68% | 12.21% | 203 |
| Same indexed chunks and same reading windows, rank by chunk cosine | 56.33% | 87.34% | 30.22% | 117 |
| Semachunk native heading with its body, rank by passage cosine | 64.56% | 89.87% | 30.29% | 139 |
| Mastra format-aware HTML, rank by passage cosine | 65.82% | 91.77% | 30.03% | 150 |
| Mastra recursive on visible text | 61.39% | 91.77% | 5.59% | 443 |

The original Semachunk HTML and converted Markdown trees both identified 283 headings. The native tree introduced more subdivisions, yielding 58 semantic cores under 32 tokens against 31 after conversion. Ranking contributed separately. For the forbearance request question, direct chunk cosine ranked the 81-token *Request a Forbearance* passage first. Giving the best contained paragraph half the score promoted *Mandatory Forbearance*. On the same HTML passages, paragraph scoring alone cut first hits from 56.33% to 32.91%. There were also ten questions for which no original Semachunk passage contained all accepted evidence. [Earlier representation and scoring controls](2026-11-28-html-markdown.md)

## What transfers across agencies

Each cell in the first two metric columns counts complete cited evidence on 449 confirmation questions across 104 page records. Within five allows the returned passages to supply different parts of the evidence. First-hit evidence F1 also accounts for the amount of unrelated text in the first result. Every passage respects the same 512-token ceiling.

| HTML processing and scoring | First | Within five | Evidence F1 | Mean tokens |
| --- | ---: | ---: | ---: | ---: |
| Previous Semachunk HTML | 45.43% | 82.85% | 20.08% | 162 |
| Same Semachunk HTML chunks, whole-chunk scoring | 57.46% | 87.75% | **27.79%** | 124 |
| Native heading with its body | 54.57% | 86.41% | 27.06% | 107 |
| Native grouped heading passages, whole-passage scoring | **61.47%** | **92.87%** | 20.32% | 197 |
| Same grouped passages, score by their best constituent heading and body | 63.92% | 91.76% | 20.58% | 196 |
| Markdown conversion, previous combined scoring | 55.90% | 90.20% | 20.51% | 194 |
| Markdown conversion, whole-chunk scoring | 60.36% | 93.76% | 23.63% | 187 |
| Mastra format-aware HTML, whole-passage scoring | 57.24% | 87.08% | 25.51% | 148 |
| Mastra format-aware Markdown, whole-passage scoring | 64.59% | 94.88% | 11.45% | 379 |
| Mastra recursive on visible text | 63.92% | 92.87% | 9.27% | 440 |
| Semachunk plain visible-text control | 72.38% | 95.10% | 9.70% | 483 |

The native experiment uses heading locations from Semachunk's existing HTML parser. The introduction and every heading with the body up to the next heading form units. A unit over 512 tokens goes through Semachunk's structural text splitter. Consecutive whole units on the same page can share a passage while their combined text fits 256 tokens. An intact unit between 257 and 512 tokens stands alone. The scorer embeds exactly the displayed passage. This produced **573 passages** from 1,059 ungrouped units on confirmation. The alternative kept the same 573 displayed passages and scored each by its best constituent unit embedding. [Native benchmark implementation](../html-heading-index.mjs)

| Agency | Questions | Previous HTML first / five | Single heading first / five | Grouped native first / five | Markdown, whole chunk first / five |
| --- | ---: | ---: | ---: | ---: | ---: |
| Federal Student Aid | 158 | 28.5 / 74.7 | 64.6 / 89.9 | 59.5 / 92.4 | 54.4 / 92.4 |
| New York DMV | 92 | 48.9 / 89.1 | 40.2 / 82.6 | 64.1 / 92.4 | 59.8 / 93.5 |
| Social Security | 83 | 56.6 / 89.2 | 57.8 / 86.7 | 77.1 / 92.8 | 68.7 / 94.0 |
| Veterans Affairs | 116 | 57.8 / 84.5 | 50.0 / 84.5 | 50.9 / 94.0 | 62.9 / 95.7 |

The ungrouped layout already contained at least one complete passage for every DMV, Social Security and Veterans Affairs question and for 156 of 158 Student Aid questions. Grouping gave all 449 questions a complete candidate. At DMV it gained 27 first hits and lost five even though all 92 answers were already present somewhere in the ungrouped index. The two layouts emphasized different passages during retrieval. Selecting the whole page can also improve evidence coverage. The visible-text control returned at least 99% of the page on 8.9% of questions and averaged 53.5% of the page per first hit. The native grouped result averaged 21.9% and the converted whole-chunk result 18.4%.

Grouped native HTML gained **16.04 percentage points first** and **10.02 within five** over the previous HTML profile. The paired page-bootstrap 95% intervals were **+9.54 to +23.29** and **+4.88 to +15.60**. Compared with converted whole-chunk scoring, the differences were **+1.11 points first** and **−0.89 within five**, with intervals of **−5.49 to +6.89** and **−3.19 to +1.24**. The development-selected native choice embeds the full grouped passage. Scoring by the best constituent produced a higher confirmation first-hit rate and a lower within-five rate, with gains varying by agency.

## Effect on the full comparison

The main validation suite has 1,759 distinct questions over 201 documents. Its sole raw HTML pool comprises 27 Student Aid pages with 158 questions. We replaced that pool's actual per-question results and retained all other original results. The score gives each domain equal weight within its search scope and each independent evaluation set equal weight overall. Student Aid consequently contributes one twenty-first of the headline score. The other three government HTML pools above test transfer and do not enter this total. [Original head-to-head and weighting](2026-11-27-mastra-comparison.md)

| Full-suite setup | First | Within five | Evidence F1 | Mean tokens |
| --- | ---: | ---: | ---: | ---: |
| Current Semachunk benchmark recipe | 60.94% | 85.59% | 21.45% | 423 |
| Change only the ranking of the existing HTML chunks to chunk cosine | 62.27% | 86.19% | 22.30% | 419 |
| Replace the HTML path with the native single-heading layout | 62.66% | 86.31% | 22.31% | 420 |
| Use native grouped headings and whole-passage scoring for HTML | **62.42%** | **86.43%** | 21.60% | 424 |
| Use native grouped headings and best-constituent scoring for HTML | 62.87% | 86.43% | 21.70% | 424 |
| Convert HTML to Markdown, keep previous scoring | 61.88% | 86.01% | 21.54% | 424 |
| Convert HTML to Markdown and score by whole chunk | 62.18% | 86.43% | 21.72% | 423 |
| Mastra native recursive | 46.16% | 79.10% | 14.41% | 431 |
| Mastra format-aware layout with benchmark-added scoring | 59.90% | 86.25% | 17.24% | 484 |
| Same enhanced Mastra elsewhere, development-selected Markdown splitter and chunk cosine for HTML | 60.14% | 87.00% | 17.07% | 488 |

The native grouped route raises the main Semachunk score by **1.48 points first** and **0.84 within five**, with paired 95% intervals of **+0.92 to +2.01** and **+0.34 to +1.41**. Both it and the converted route retrieved complete evidence within five on 146 of the 158 questions that changed. Their overall within-five scores consequently agree exactly. When each system gets an HTML-specific choice, the native Semachunk profile leads the enhanced Mastra profile by 2.28 points first and trails by 0.57 within five. Both paired intervals include zero.

## Comparison excluding raw HTML

Removing the isolated Student Aid pool leaves **1,601 distinct questions and 174 documents**. Government questions on plain-text sources stay in the comparison. Neither shared validation corpus contained HTML distractors. These are comparisons on the same remaining queries and candidate pools, with the benchmark's domain weights recomputed after exclusion.

| Configuration | First | Within five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| Semachunk combined, cutoff 0.15 and 30% semantic-neighbour scoring | **62.75%** | 86.34% | 22.14% | 433 |
| Semachunk tuned structural blocks | 60.14% | 85.34% | 21.53% | 413 |
| Mastra native recursive | 45.55% | 78.81% | 14.98% | 431 |
| Mastra format-aware with benchmark-added scoring | 60.58% | **86.99%** | 17.71% | 494 |
| Mastra format-aware plus sentence layouts with the same scoring | 58.48% | 85.80% | 17.88% | 497 |

Compared with native Mastra, Semachunk's combined index leads by **17.20 points first** and **7.53 within five**. The paired 95% intervals are **+13.40 to +21.12** and **+4.58 to +10.44**. Compared with the strongest single enhanced layout, the differences are **+2.17 first** (**−0.12 to +4.83**) and **−0.65 within five** (**−3.17 to +1.17**). Giving every distinct question equal weight produces **67.02% / 90.22%** for Semachunk, **49.72% / 84.67%** for native Mastra and **64.49% / 90.60%** for the enhanced single layout.

Of two previously studied Semachunk configurations, the union of tuned structural blocks and semantic chunks at cutoff 0.225 scored **63.71% / 85.78%** after excluding HTML. The version weighting a contained semantic match at 50% with cutoff 0.175 scored **61.89% / 86.69%**. These give alternative operating points for first-hit and within-five retrieval. [Passage-placement experiments](2026-11-27-passage-placement.md)

## Decision and reproduction

Use the native grouped-heading prototype as the candidate for the library's HTML path. It preserves direct citations and matches the converted route closely on confirmation while using one layout. Conversion remains useful when an application already stores Markdown or prioritizes within-five coverage. A caller that needs citations against original HTML also needs a mapping through conversion. The converter study verified its mapping on these archived government pages. A release decision should compare the native and converted routes on an unseen sample of technical documentation, articles and pages with rich lists or tables. The implementation in this study is benchmark-only.

Development used 347 questions and 83 page records from the same four agencies. Confirmation used disjoint page IDs and raw bytes, although the agencies and earlier confirmation outcomes were already familiar. The ranking sweep used identical grids for raw HTML and converted Markdown with paragraph weights 0, 0.125, 0.25 and 0.5, an optional 0.30 semantic-neighbour weight, a fixed 0.15 section weight, and whole-chunk cosine as a control. Configurations within 0.25 points of the highest mean of first and within-five on equally weighted development agencies favored the simpler choice. Whole-chunk cosine won the initial selection within each representation. Grouping was a follow-up after examining the single-heading results. Development then selected whole-passage scoring within native HTML and converted whole-chunk scoring across representations. Mastra received the same development objective across its four earlier layouts and both representations. The previously reported Semachunk and enhanced Mastra recipes were fixed outside HTML.

The controls reproduce each original question's hits, evidence F1, returned length and page fraction. The scorer also reproduces the original full-suite averages and paired intervals before changing any HTML results. The indexer verifies the embedding model, query and source hashes, exact raw HTML citation coverage of visible characters, and the 512-token ceiling. The result archive includes the ranking grid, candidate availability, source-clustered intervals and both full-suite weightings. Run the following commands after preparing the caches from the earlier comparison. [Scoring and selection](../html-handling.py) · [HTML/Markdown data and setup](2026-11-28-html-markdown.md)

```powershell
node benchmarks/html-heading-index.mjs
$env:OPENBLAS_NUM_THREADS = '2'
& '.\benchmarks\.cache\semantic-python\Scripts\python.exe' benchmarks/html-handling.py
```
