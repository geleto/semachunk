# What makes a retrieved passage useful for a prose question?

Semantic splitting detected real changes of subject in all four domains. It helped most when a reader needed several related statements from a research paper. It also separated questions from answers, grouped independent FAQs on the same subject, and produced some first hits that named the topic without giving the requested fact. All three indexes use dense semantic search. The difference under examination is where each index puts its passage boundaries.

## Where the answer exists and where it ranks

I replayed 1,302 questions across 346 distinct documents, including 128 research papers, nine software manuals, 187 government service pages and 22 financial filings and releases. The table shows counts of questions on the 740-question confirmation fold. The other 562 questions are in the development column. Every triple is in the order **blocks at 256 tokens / semantic-blocks at 512 / semantic-blocks unlimited**.

| Domain | Confirmation questions | One indexed passage could cover the citation | First hit actually covers it | First five together cover it | Development, first five |
|---|---:|---:|---:|---:|---:|
| Research papers | 190 | 166 / 171 / 172 | 63 / 60 / 53 | **121 / 131 / 136** | 125 / 118 / 127 of 179 |
| Software FAQs | 76 | 75 / 68 / 66 | 64 / 56 / 57 | **74 / 70 / 68** | 21 / 22 / 22 of 22 |
| Government services | 449 | 439 / 420 / 410 | 259 / 230 / 226 | **394 / 389 / 378** | 327 / 317 / 318 of 347 |
| Financial prose | 25 | 17 / 17 / 17 | 5 / 3 / 5 | **13 / 11 / 12** | 4 / 5 / 7 of 14 |

The third column is an upper bound for a perfect first-hit ranker. It distinguishes two different problems. In papers the unlimited index makes six *more* questions answerable from one cited passage, yet returns ten *fewer* complete first hits than blocks. In manuals and government pages, semantic cuts often split evidence that a structural chunk already held intact. The unlimited index's upper bound is nine questions lower in manuals and 29 lower on government pages.

Every semantic threshold was fitted to the nearest attainable structural passage count in its own document, using the document text alone. Some tree layouts skip over the target. Among the confirmation source documents where all three counts were **exactly** equal, top-five counts were 38 / 43 / 43 on 55 paper questions, 87 / 92 / 92 on 102 government questions, and 9 / 7 / 6 on 14 finance questions. None of the six confirmation manuals had an exact three-way match. The government result changes direction in this subset. It covers 28 of the 104 pages and keeps the original agency-wide candidate pools, so page selection and differences elsewhere in the pool still matter. [Full counts and subsets](2026-11-27-prose-diagnostics.json)

## Are the successful first hits good passages?

For 271 confirmation questions, all three first hits covered **the same accepted citation**. I checked whether the indexes already contained a much shorter passage for that identical evidence. The last column counts first hits at least twice as long as an available alternative and at least 64 tokens longer. A long passage can earn that space by supplying a condition or exception.

| Common first-hit successes | Questions | Median first-hit tokens, blocks / 512 / unlimited | First hits with a much shorter alternative, blocks / 512 / unlimited |
|---|---:|---:|---:|
| Papers | 27 | 193 / 292 / 311 | 0 / 7 / 10 |
| FAQs | 50 | 203.5 / 291 / 444 | 5 / 18 / 28 |
| Government | 192 | 122 / 124.5 / 169 | 5 / 51 / 72 |
| Finance | 2 | 184.5 / 317.5 / 317.5 | 0 / 1 / 1 |
| **All four** | **271** | | **10 / 77 / 111** |

I also read 23 questions from distinct documents with method names and scores hidden. For each I evaluated every distinct first hit and the shortest passage covering an accepted citation, or the best partial passage if none was complete. I recorded what the reader would ideally get, even when all candidates passed. The sample deliberately includes wins, misses, short answers and unusually long successes. It illustrates failure modes and cannot estimate their prevalence. [All 23 questions, candidate judgments and ideal excerpts](2026-11-27-prose-reader-review.json)

| Question from the benchmark | What the reader actually gets |
|---|---|
| **Paper. How large was the Airbnb dataset?** | All three win. Blocks and capped semantic return the 201-token data subsection. Unlimited returns 1,194 tokens, including market history and an introduction to GANs. Even 201 tokens includes the occupancy definition. The count of roughly 40,000 listings, Manhattan and the observation period would suffice. |
| **Paper. Which named-entity recognition models were evaluated?** | Blocks puts the cited descriptions in three passages and completes them at rank 15. Capped semantic returns one 437-token Models section at rank 1. It gives Stanford NER, spaCy and the recurrent CRF model, with enough context to distinguish the baselines. Unlimited has the full answer in 829 tokens at rank 2. A reader asking for the models gains little from the training parameters. |
| **Manual. Which Vue features help a large team develop screens independently and reuse logic?** | Both semantic indexes rank a 24-token assurance about scalability first (cosine .651). The 112-token list naming Single-File Components and the Composition API ranks 10th and 8th (cosine .485). Blocks keeps the introduction with the list and ranks it first (187 tokens, .620). The high-scoring fragment repeats the question's premise. The list supplies the requested mechanisms. |
| **Manual. How do I see a file's effective Ruff settings?** | Unlimited delivers the heading and the exact command in 40 tokens. Blocks also answers, in 96 tokens that include an unrelated preview FAQ. Capped semantic retrieves a different 96-token entry about Python versions. Here the shortest first hit is independently usable. |
| **Manual. Which Vue version should I use for IE11?** | All three first hits cover the annotation in 252 / 494 / 1,576 tokens. The unlimited hit also covers governance, licensing and performance. The compatibility condition and the consequence for choosing Vue 2 versus Vue 3 are enough. |
| **Government. My plates were stolen. What steps do I take?** | Blocks ranks a seven-token title first. Both semantic indexes return 299 tokens, covering both plates stolen and the exception when only one of two was stolen. A shorter candidate covers the entire official citation, which only mentions surrendering the registration. The longer answer is preferable until the reader says how many plates were taken. |
| **Government. How is veterans pension eligibility determined?** | Every method wins with exactly the same 46-token overview. It names service, age or disability, and financial criteria. A reader trying to determine eligibility needs the conditions and alternatives in the following section. None of the first hits is sufficient for that purpose. |
| **Finance. What drove AMD's revenue change?** | A 252-token structural passage with the drivers ranks 3rd (.621). The 387-token capped passage also covers income, amortization, liquidity and debt and ranks 7th (.590). Replacing only this passage with its shorter child while holding every competing score fixed moves it back to rank 3. Unlimited ranks a 1,075-token overview first. It earns coverage, but the revenue explanation, period and offset would make a better answer. |

The AMD substitution also worked in both directions elsewhere. Among 113 paper questions with a fully cited structural passage contained inside a larger fully cited unlimited passage, substituting the child improved the passage's rank 46 times and worsened it 24 times. On 185 eligible government questions it improved rank 53 times and worsened it 20 times. These are gold-informed replacements selected using the best-ranked eligible structural child. They demonstrate sensitivity to surrounding text, and their rates should not be used to predict gains from a production rule. [Per-question rankings, similarities and substitutions](2026-11-27-prose-traces.jsonl.gz)

## What semantic splitting actually improved

The structural baseline already keeps fitting sections, paragraphs and sentences together and descends through oversized nodes. Semantic-blocks uses the same tree, scores adjacent siblings, and propagates low-similarity cuts to ancestors. A heading, a list introduction and an example can play different linguistic roles while forming a single useful answer. Conversely, several adjacent FAQ entries can stay on the same topic while answering different questions. [Structural packing](../../src/hierarchy.js) · [Semantic cuts](../../src/semantic-blocks.js)

I compared neighboring source sentences on which blocks and unlimited semantic disagreed. The pairs **kept only by semantic** had higher mean cosine similarity in every domain than the pairs **kept only by blocks**. The comparison is .426 versus .258 in papers (639 versus 606 pairs), .463 versus .334 in FAQs (24 versus 14), .438 versus .347 in government (214 versus 137), and .513 versus .326 in finance (1,506 versus 1,243). This measures the split encoder's own notion of topical continuity. The questions above show where a reader needs continuity of argument or procedure as well.

Multi-sentence answers show the clearest benefit in papers. On 81 confirmation questions where every accepted annotation touches at least two eligible prose units, the first five hits contain a complete citation in **47 / 56 / 57** cases. For the 107 where the smallest count is one unit, the counts are **73 / 74 / 78**. Two questions have an annotation touching no eligible unit. Units are a source-based sentence approximation, and an annotation can include background beyond the answer. Five full hits also give longer indexes more room. Across all 190 paper questions the mean tokens delivered were **889 / 1,178 / 1,477**.

### Small fragments and the size of the remaining passages

The fraction of indexed passages with at most 32 tokens was **1.6% / 20.5% / 27.5%** in papers, **6.6% / 19.8% / 27.4%** in manuals, **11.3% / 30.7% / 38.5%** in government and **4.4% / 30.6% / 39.9%** in finance. The finance indexes contained 6,220 / 6,220 / 6,219 passages. Of the unlimited index's 2,479 short passages, only 119 consisted entirely of Markdown headings or numbers and punctuation. Some short passages contained a complete fact. Others were sentence continuations, labels, or qualifications.

This supports the proposed size-distribution explanation. Semantic cuts spend many of the available passages on small units, while many retrieved answers are left in larger units. Most tiny finance fragments rarely reach the reader directly. Only 2 / 4 / 5 of the 125 first-five finance hit slots were at most 32 tokens. The median first hit was 196 / 277 / 414 tokens. The FAQ and government probes below show the complementary failure when a short, highly ranked fragment *does* reach the reader.

### Testing local matches, interrupted topics and missing context

Each entry is the number of confirmation questions with complete evidence in five whole returned hits. The retrieval probes preserve the original three indexes, encoder and pool. A sentence or sentence pair is only a search key. The delivered passage is always whole.

| Domain | Original dense ranking | Best of whole-passage and sentence similarity | Also match A+C across one short interruption | Expand short original hits to a containing block |
|---|---:|---:|---:|---:|
| Papers, 190 | 121 / 131 / 136 | 121 / 141 / **154** | 121 / 141 / 153 | 121 / 133 / 139 |
| FAQs, 76 | 74 / 70 / 68 | 73 / 69 / 68 | 73 / 69 / 68 | 74 / 72 / **73** |
| Government, 449 | 394 / 389 / 378 | 371 / 374 / 371 | 377 / 379 / 377 | 394 / **405** / 395 |
| Finance, 25 | 13 / 11 / 12 | 13 / 12 / 12 | 13 / 12 / 12 | 13 / 11 / 13 |

- **Matching at sentence level.** Each passage can win on its full vector or on its strongest contained prose sentence. For unlimited papers, 136 becomes 154 on confirmation and 127 becomes 138 on development. The evidence was already in the indexed passages. A more local retrieval key made it findable. On government pages the same rule worsened all three top-five counts on both folds. A short topical match can outrank a complete procedural answer.
- **The A–B–C hypothesis.** I required A and C to have cosine at least .45 and exceed both A–B and B–C by at least .10, with B at most 32 tokens. This identified 785 / 77 / 484 / 1,568 candidate triples across the four confirmation domains in table order. For endpoints split across passages, I added an embedding of A+C as a key for either passage. The extra key recovered five or six government questions per index over sentence scoring alone, yet all three totals stayed below the original ranking. It added zero FAQ or finance completions and cost unlimited papers one. On development its incremental effect ranged from −1 to +1 across domain and method. Only one confirmation paper question had an accepted citation explicitly selecting A and C on opposite sides of such a split while excluding B, and none did in the other domains. Unannotated context can still matter. This particular one-gap intervention gives little support for adding a general second merging pass.
- **Supplying context after a short match.** For each of the original five hits at most 64 tokens long, I delivered the smallest *already indexed* 256-token structural passage that wholly contained it, when available. Ranks were fixed, duplicate parents were delivered once, and there was no backfill. On government confirmation, capped semantic improved from 230 to 247 complete first hits and from 389 to 405 complete top fives, at 87 additional tokens per five on average. Unlimited improved from 226 to 248 firsts and from 378 to 395 fives, at 123 extra tokens. The capped government top-five gain also held on development, 317 to 325, versus 327 for blocks. Unlimited manual first hits improved from 57 to 65 and top fives from 68 to 73, at 216 extra tokens. This isolates missing context in short results. The veterans-pension example also shows how an officially sufficient hit can need more context than the score detects. [Both folds, token costs and detailed results](2026-11-27-prose-diagnostics.json)

### A structural control for software FAQs

I indexed each manual using its most frequent Markdown heading depth as the FAQ boundary. Each passage keeps the heading, its whole answer and its deeper subheadings. Preambles and original text are retained. The index was constructed without looking at questions or citations. The controls search the same six-manual confirmation pool and three-manual development pool.

| FAQ index | Confirmation passages | First complete, of 76 | First five complete, of 76 | Mean tokens in five | Development first / five, of 22 |
|---|---:|---:|---:|---:|---:|
| Blocks | 122 | 64 | 74 | 850 | 18 / 21 |
| Semantic-blocks 512 | 116 | 56 | 70 | 968 | 16 / 22 |
| Semantic-blocks unlimited | 117 | 57 | 68 | 1,449 | 15 / 22 |
| FAQ headings and answers | 86 | **69** | **76** | 1,421 | **18 / 22** |

The Vue scaling question moved to first with a 150-token entry including both features. Docker project-name isolation took 90 tokens, compared with 171 / 352 / 352 for the three original hits. For a Pandoc PDF/A question the whole 641-token entry was less focused than the 224-token structural hit. The simple heading control used fewer, differently sized passages than the count-matched experiment. Its value here is that a known question–answer boundary predicts reader usefulness and exposes cases where a whole entry is still too broad. [Per-question results and heading depths](2026-11-27-prose-faq-sections.json)

## What the benchmark grades incorrectly

- **A correct answer can occur twice.** Asked to define a concept map, both semantic indexes put the authors' explicit 21-token definition first (.797). It gives the nodes, the edges and what they represent. The accepted citation points to the same definition elsewhere. Blocks retrieves that 184-token passage (.694) and gets full credit. The official first-hit scores for this question are 1 / 0 / 0. In 111 confirmation paper questions with substantive native extractive answers, the five hits contained all strings of at least one answer in 77 / 82 / 83 cases. Official complete citations on those same questions were 75 / 79 / 83. Exact string presence can also miss a paraphrase or a necessary relationship. Alternative wording explains individual misses without erasing the overall pattern. [Answer-string checks on both folds](2026-11-27-prose-diagnostics.json)
- **An annotated overview can be the wrong target.** For the FAFSA correction question, all three first hits actually explain how to correct the application. All score zero at rank 1 because the citation marks the generic introduction. The 191-token structural hit was the more focused answer. Both semantic hits also included later award and disbursement material. The pension question demonstrates the reverse error, where an overview earns full credit but leaves the reader's eligibility question unresolved. [Reader assessments](2026-11-27-prose-reader-review.json)
- **A source conversion error can look like a semantic failure.** Two PepsiCo questions cite the same forecast quotation. The prepared document introduced blank lines at visual line wraps. The 78-token semantic passage lost its issuer and reporting-period dateline and ended midway through the attribution. A guidance footnote scored higher. Restoring 13 spurious line breaks in four page-one paragraphs, mapping the original citations, and refitting all three indexes yielded exactly 64 passages each. Both semantic answers moved from ranks 19 / 18 and 14 / 16 to first. Blocks stayed at rank 2 on both. Merely adding the dateline to *all* semantic candidates moved both to rank 5. Even after reflow, the semantic first hit was 481 tokens for an answer that needs the dateline and quotation. In a separate Johnson & Johnson release the conversion marked a bold sentence continuation as an empty heading. The needed EPS figure was absent from all three indexes. Rejoining two continuations made complete evidence reachable at ranks 6 / 8 / 7. Both repairs were confined to the experiment. [Measured source interventions](2026-11-27-prose-source-probes.json) · [PepsiCo source PDF](https://raw.githubusercontent.com/patronus-ai/financebench/cc39aeb4afdf33909ee1412188bf89035950c2eb/pdfs/PEPSICO_2023Q1_EARNINGS.pdf) · [Johnson & Johnson source PDF](https://raw.githubusercontent.com/patronus-ai/financebench/cc39aeb4afdf33909ee1412188bf89035950c2eb/pdfs/JOHNSON_JOHNSON_2022Q4_EARNINGS.pdf)

## Implications for semachunk

I would keep hierarchical blocks as the general default. For identifiable FAQ entries, preserving a question with its answer is the first change I would test in the library. For research prose, the existing semantic index can already group a multi-model comparison well. Scoring its passages using contained sentences produced a larger paper retrieval gain than changing the grouping between the two semantic size limits. The experiments point to separate decisions about where to split, what text to embed for search, and how much surrounding evidence to show the reader. A global cutoff change cannot address all three.

For the next benchmark, retain strict citation recall for regression checks and add independently reviewed minimal sufficient answers with accepted equivalent locations. Mark indispensable conditions and exceptions, measure tokens returned, and judge focusedness on successes as well as misses. Paper results favor local scoring and manuals favor preserving entries. Government results depend on whether a short match is expanded. A new evaluation should test these rules on previously unseen documents. Long-form editorial prose, narrative and transcripts are outside these four collections.

## Reproducing the analysis

The audit uses the frozen sources and `text-embedding-3-small`. Each paper and filing searches its whole source, each FAQ query searches the manuals in its fold, and each government query searches all pages in its agency and fold. Government uses its native HTML version once per question. Finance includes all questions labeled as text in the audited release, including a few with columnar evidence. All listed retrieval results use full passages. These previously examined folds and exploratory probes give descriptive results. The 23-case review is a single reader's assessment. [Audited source manifest](2026-11-27-audited-data.json) · [Original outcomes](2026-11-27-whole-passage-audited.json)

The first command reads the portable archive directly. With the [audited local corpus prepared](../README.md), the remaining commands rebuild the traces and controls and display the full, unabridged passages for an individual question.

```sh
python benchmarks/prose-report.py
node benchmarks/prose-retrieval.mjs
node benchmarks/prose-retrieval.mjs archive
python benchmarks/prose-report.py --diagnostics
python benchmarks/prose-report.py --reader-sample
node benchmarks/prose-faq-sections.mjs
node benchmarks/prose-source-probe.mjs
python benchmarks/prose-report.py vue-30
```
