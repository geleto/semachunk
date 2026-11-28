# Semachunk and Mastra dense passage retrieval

Semachunk’s combined structural and semantic index retrieved complete evidence in the first hit on **60.94%** of validation questions by the benchmark’s domain-balanced measure. Mastra’s strongest native chunk-and-embed configuration reached **46.16%**. Giving Mastra’s chunks paragraph scoring, section scoring and neighbour context closed most of the gap. Its strongest single layout reached **59.90% first / 86.25% within five**, against **60.94% / 85.59%** for Semachunk. The Semachunk first passage averaged 61 fewer tokens and had higher evidence F1. [Scores, development grid, paired intervals and domain breakdowns](2026-11-27-mastra-comparison.json.gz)

## Held-out results

| Retrieval setup | Complete first | Complete within five | First-hit evidence F1 | Mean first-hit tokens |
| --- | ---: | ---: | ---: | ---: |
| Semachunk combined, cutoff 0.15 and 30% neighbour weighting | **60.94%** | 85.59% | **21.45%** | 423 |
| Mastra native recursive, 512 tokens and 25% overlap | 46.16% | 79.10% | 14.41% | 431 |
| Mastra format-aware with our scoring features | 59.90% | **86.25%** | 17.24% | 484 |
| Mastra format-aware plus sentence layouts with our scoring features | 58.14% | 85.46% | 17.41% | 490 |
| Semachunk tuned structural blocks | 58.75% | 84.92% | 21.02% | 403 |

The two-layout Mastra setup won development. The single format-aware layout transferred better to validation. Both had a 512-token core limit and zero splitting overlap. The format-aware layout used recursive splitting for prose, Markdown splitting for Markdown, and HTML headings followed by recursive splitting for HTML. The benchmark supplied its paragraph, section and neighbour scoring.

Relative to native Mastra, Semachunk gained **14.78 percentage points first** (paired 95% interval **+11.11 to +18.56**) and **6.49 within five** (**+3.47 to +9.39**). Against the two-layout development winner the differences were **+2.81 first** (**+0.27 to +5.36**) and **+0.12 within five** (**−1.35 to +1.76**). Against the single enhanced layout they were **+1.05 first** (**−1.23 to +3.65**) and **−0.66 within five** (**−3.08 to +1.32**).

Restricting Semachunk’s displayed context to the immediately adjacent chunks gave **60.34% / 84.92%**, **22.04%** first-hit evidence F1 and **396** mean tokens. Two previously measured Semachunk alternatives illustrate the first-hit versus within-five trade-off. Combining the tuned structural layout with semantic cores at cutoff 0.225 gave **62.27% / 85.14%**. Scoring the structural parent with a contained semantic match at cutoff 0.175 gave **60.23% / 86.09%**. The primary comparison retains the 0.15 configuration discussed before the Mastra run. [Earlier Semachunk configurations](2026-11-27-passage-placement.md)

### Results by search scope

Each cell gives complete evidence in the first hit / across the first five. Replication and later holdout each reuse the same questions in their original pools and in the search across all documents.

| Search scope | Questions | Semachunk combined | Mastra native | Mastra enhanced single | Mastra enhanced pair |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development, used for selection | 758 | 55.05 / 80.93 | 44.71 / 78.95 | 62.25 / 87.16 | 66.10 / 87.19 |
| Confirmation | 807 | 60.96 / 88.16 | 50.34 / 86.58 | 64.82 / 91.81 | 64.96 / 90.16 |
| Replication, original pools | 484 | 79.62 / 95.15 | 57.55 / 89.79 | 74.73 / 95.73 | 67.45 / 96.93 |
| Replication, all 69 documents | 484 | 74.34 / 91.01 | 53.89 / 81.02 | 70.39 / 90.28 | 63.04 / 91.15 |
| Later holdout, original pools | 468 | 52.18 / 82.55 | 38.70 / 75.67 | 50.65 / 84.15 | 52.22 / 81.23 |
| Later holdout, all 58 documents | 468 | 37.60 / 68.50 | 26.16 / 54.94 | 33.99 / 63.70 | 36.19 / 63.14 |

**The choice of weighting changes the closest result.** On the 158 confirmation government HTML questions, native Mastra found complete first hits on **61.4%**, its enhanced pair on **58.9%**, and Semachunk on **28.5%**. In the 13 replication spoken-transcript questions, Semachunk got seven more first hits than the enhanced pair. With equal domain weights this one small domain contributed 7.69 points to the replication first-hit difference. Giving each of the **1,759 individual validation questions** equal weight and averaging its two search scopes where applicable gives Semachunk **63.56% / 88.83%**, native Mastra **50.77% / 85.30%**, the enhanced single **63.42% / 89.51%**, and the pair **64.30% / 89.26%**.

We checked every eligible passage for the government HTML confirmation set and the later fiction set to distinguish a missing candidate from a ranking miss. On HTML, native Mastra got **64** first hits Semachunk missed. A complete Semachunk passage already existed for **59** of them, including the question about requesting loan forbearance. For the other **five**, the Semachunk index had no single passage containing all the accepted evidence. Semachunk got **12** first hits native Mastra missed. On the **354** later fiction questions in their original pools, both indexes contained a complete passage for every question. Semachunk got **90** first hits native Mastra missed, and native Mastra got **23** that Semachunk missed. Ranking accounts for the fiction difference and most of the HTML gap. [Candidate coverage counts and example question IDs](2026-11-27-mastra-comparison.json.gz)

### What improved Mastra’s results?

These controls hold the selected Mastra pair, the 512-token ceiling and the overlap suppression fixed. They were evaluated after selecting the pair and did not enter selection.

| Scoring and displayed passage for the same Mastra splits | Complete first | Complete within five | Mean first-hit tokens |
| --- | ---: | ---: | ---: |
| Chunk cosine, display the chunk | 44.02% | 81.00% | 387 |
| Chunk cosine, display adjacent context | 49.94% | 83.01% | 489 |
| Include paragraph and section scores, display adjacent context | **58.25%** | **85.60%** | 488 |
| Also blend 30% neighbour vectors, display adjacent context | 58.14% | 85.46% | 490 |
| Same full scoring, display the chunk alone | 54.32% | 83.89% | 390 |

Paragraph and section scoring added **8.32 points first** and **2.59 within five** with the same two splitters and display policy. Adding the 30% neighbour vector blend then changed those scores by **−0.12** and **−0.14**. Displaying adjacent context with full scoring added **3.82 points first** and **1.57 within five** over displaying the core alone. These controls measure the effect on Mastra’s selected layouts. The Semachunk and Mastra context readers also use different units when filling the 512-token budget, so the overall comparison measures the retrieval pipelines.

Across the 201 unique validation documents, native Mastra indexed **2,721** distinct retrieval embeddings, the enhanced single **16,127**, the pair **18,620**, and Semachunk **20,191**. These counts deduplicate keys within a source, include paragraph and section vectors when used for ranking, and exclude queries and temporary embeddings used to choose semantic boundaries. The corresponding counts of candidate passages were **2,724**, **2,738**, **5,228** and **11,102**. Every selected Mastra layout covered every non-whitespace source character in each validation document.

## Benchmark design

We compared the combined Semachunk index at cutoff 0.15 and 30% immediate-neighbour weighting with the published `@mastra/rag@2.8.2` package. Both systems used the same saved question embeddings, source documents, accepted alternative citations and exact cosine search with `text-embedding-3-small` at 1,536 dimensions. Each displayed passage had a hard ceiling of 512 `cl100k_base` tokens. The first-hit metric requires one complete accepted evidence set in the first passage. The within-five metric allows passages to supply different parts of the same accepted evidence set from the correct source. Evidence F1 also accounts for surplus text in the first passage. [Mastra’s chunking and embedding reference](https://mastra.ai/reference/rag/chunking-and-embedding)

Development had 758 questions over 66 documents. The three validation sets had 807, 484 and 468 questions over 74, 69 and 58 documents, respectively. The latter two were searched twice, once in their original document or collection pools and once against every document in the set. Each domain had equal weight within a search. The validation average gave each independent question set one third of the weight and averaged the two search scopes where applicable. Paired 95% intervals resample source documents within each domain, preserving the pairing between the two searches of the same questions.

### Mastra configurations

We tested four core sizes of 128, 256, 384 and 512 tokens, with 0%, 25% and 50% overlap, plus 75% overlap at 512. Six routes covered recursive, sentence, token, character and two format-aware setups. Both format-aware routes used recursive splitting for plain text and Mastra HTML headings on HTML. On Markdown, one used Mastra Markdown splitting, the other semantic Markdown with its header-family join threshold set to the target size. Mastra’s character splitter used four characters per target token. An additional Mastra token split divided any oversized output, preserving its tail. The corpus contains text, Markdown and HTML. [Mastra chunk options](https://mastra.ai/reference/rag/chunk)

The generic splitters received the corpus’s visible text for HTML. The format-aware routes detected headings on the original HTML with Mastra and split the corresponding visible source sections, including introductions and nested content. This preserved text outside a heading’s immediate DOM siblings. Citations aligned the actual returned characters to offsets in the benchmark source, allowing whitespace reflow and checking repeated occurrences in source order.

The native retrieval baseline ranked the literal Mastra chunks with one embedding each and returned the top five. Three additional benchmark treatments tested immediate neighbour text in the displayed passage, paragraph and section scoring, and the same scoring with a normalized 30% neighbour vector blend. The context reader expanded on either side within the enclosing section and the 512-token cap. Paragraph scoring used the best wholly contained paragraph with a 50% share and an eligible enclosing section with a 15% share. The enhanced searches suppressed a hit if at least 75% of the shorter passage already appeared in a higher hit. Two-layout searches also used this suppression. Rankings and displayed passages used no answer labels. All candidates in the requested pool were eligible.

The selection objective was the mean of complete-first and complete-within-five on development. Within 0.15 percentage points of the best mean, the simpler configuration won. We scored **312** single-layout configurations, shortlisted one for each strategy family and scoring treatment, then tested **265** pairs and froze the finalists before validation. This comparison measures passage retrieval with a common dense encoder. Mastra also supports external reranking models, which introduce an additional model at query time. [Selection protocol](../mastra-protocol.json) · [Mastra reranking](https://mastra.ai/reference/rag/rerank)

### Semachunk configurations

The agreed configuration combined 256-token structural cores with semantic cores capped at 512 tokens and used the 0.15 similarity cutoff. Only the semantic branch mixed immediate-neighbour vectors into its core score. The primary comparison used the previously selected display window that could fill the 512-token budget within the section. We also checked the archived version whose display stopped after one neighbour on each side. Both used the same immediate neighbours for scoring. The tuned structural control used 512-token cores with a 256-token structural cap. [Semachunk cutoff and window study](2026-11-27-passage-placement.md) · [Immediate-neighbour results](2026-11-27-neighbor-threshold.md)

## Reproduction

Use the audited corpus, query vectors and Semachunk scores prepared by the linked passage-placement study. The isolated npm installation below keeps the benchmark dependency under the ignored cache directory. The comparison was run with Node 24, `@mastra/core@1.86.0` and `js-tiktoken@1.0.21`. The shared embedding replay cache can resume interrupted indexing.

```powershell
npm install --prefix benchmarks/.cache/mastra-comparison/deps --no-audit --no-fund --ignore-scripts --save-exact @mastra/rag@2.8.2 @mastra/core@1.86.0 js-tiktoken@1.0.21
$python = '.\benchmarks\.cache\semantic-python\Scripts\python.exe'
$env:OPENBLAS_NUM_THREADS = '2'
node benchmarks/mastra-index.mjs development
& $python benchmarks/mastra-comparison.py development
foreach ($split in 'confirmation','fresh','holdout') { node benchmarks/mastra-index.mjs $split }
foreach ($scope in 'confirmation','fresh','shared-fresh','holdout','shared-holdout') { & $python benchmarks/mastra-comparison.py $scope }
& $python benchmarks/mastra-comparison.py publish
```
