# Does converting government HTML to Markdown improve retrieval?

On the 158 Federal Student Aid confirmation questions that exposed the original gap, converting the same 27 HTML pages to Markdown raised Semachunk’s complete first hits from **45 to 76** and complete evidence within five from **118 to 132**. Native Mastra recursive search went from **97 to 93** first hits. The conversion closed about two thirds of the original first-hit gap. The largest remaining problem we could isolate was the weight Semachunk gives the best paragraph in a candidate. [Per-question results, source hashes and paired intervals](2026-11-28-html-markdown.json.gz)

## Federal Student Aid

Each percentage counts questions for which the retrieved text contains all of an accepted set of evidence from the correct page. The within-five score allows the five passages to supply different pieces. Every displayed passage was limited to 512 tokens.

| Retrieval setup | HTML first | Markdown first | HTML within five | Markdown within five | Mean tokens in first hit, HTML → Markdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Semachunk combined, cutoff 0.15 and 30% semantic-neighbour weighting | 28.5% | 48.1% | 74.7% | 83.5% | 203 → 229 |
| Mastra native recursive, 512 tokens and 25% overlap | 61.4% | 58.9% | 91.8% | 90.5% | 443 → 440 |
| Mastra format-aware, whole-chunk cosine | 65.8% | 57.6% | 91.8% | 94.3% | 150 → 369 |
| Mastra format-aware with paragraph, section and neighbour scoring | 52.5% | 57.0% | 78.5% | 85.4% | 297 → 471 |
| Mastra format-aware and sentence pair with the same scoring | 58.9% | 57.0% | 84.2% | 84.2% | 347 → 465 |

For the original Mastra recursive baseline, the HTML column uses visible page text and the Markdown column uses literal Turndown output. The format-aware HTML route reads headings from the original DOM with Mastra and recursively splits their visible sections, retaining the introduction and nested content. Its Markdown counterpart uses Mastra’s Markdown splitter. The first two rows reproduce the comparison that motivated this test. [Original head-to-head](2026-11-27-mastra-comparison.md)

Semachunk gained 34 first hits and lost three, a net **+19.6 percentage points** (paired page-bootstrap 95% interval **+6.9 to +33.7**). Within five it gained 20 and lost six, a net **+8.9 points** (**−2.2 to +21.8**). First-hit evidence F1 rose from **12.2% to 14.1%**. The separate 140-question Student Aid development pool also improved, from **38.6% / 65.7%** to **61.4% / 92.9%**. The settings were fixed throughout.

## What changed in Semachunk?

**Passage construction fixed some real misses.** With direct HTML, 148 of the 158 questions had at least one complete candidate passage. With Markdown all 158 did. Of the 64 questions that native Mastra originally got first and Semachunk missed, Markdown recovered **28** at rank one and **55** within five. All five cases where the HTML index had no complete candidate became first hits. Of the other 59 cases, where the evidence was already available, 23 became first hits.

The two parsers found the same **283 headings** on these pages. Direct HTML produced 2,453 sentence nodes and 381 semantic cores, including 58 under 32 tokens. Converted Markdown produced 1,636 sentence nodes and 348 semantic cores, including 31 under 32 tokens. The median displayed window for a semantic core grew from 225 to 267 tokens. The total number of candidates across the combined layouts fell from 696 to 649.

**Paragraph scoring was the larger first-hit penalty on direct HTML.** The following controls keep the two candidate layouts and their displayed passages fixed within each format. Only the scores used to order them change.

| Scoring the same Semachunk candidates | HTML first / within five | Markdown first / within five |
| --- | ---: | ---: |
| Whole-chunk cosine | 56.3% / 87.3% | 54.4% / 92.4% |
| Add the best contained paragraph at 50% | 32.9% / 74.1% | 50.6% / 84.8% |
| Add only the enclosing section at 15% | 57.6% / 87.3% | 55.7% / 92.4% |
| Paragraph and section scoring | 29.7% / 75.3% | 51.3% / 84.2% |
| Paragraph and section scoring plus semantic neighbours | 28.5% / 74.7% | 48.1% / 83.5% |

Two questions illustrate the difference. For a borrower asking whether deferment would help with payments, the top direct-HTML passage was a 26-token introduction. No single HTML candidate contained all the annotated evidence. Markdown returned a complete 245-token passage first. For the question about how to request forbearance, the direct-HTML index already had an 81-token passage headed *Request a Forbearance*. Whole-chunk cosine ranked it first. Adding paragraph scoring put *Mandatory Forbearance* first and the complete passage third. Conversion still ranked *Mandatory Forbearance* first under the full scoring rule. [Question IDs and first-complete ranks](2026-11-28-html-markdown.json.gz)

## Does the result transfer to other agencies?

The confirmation data contains 449 questions over 104 pages. Each question was searched across every page in its agency’s confirmation pool. Each cell gives complete first hit / complete within five.

| Agency | Questions | Semachunk HTML | Semachunk Markdown | Mastra recursive HTML | Mastra recursive Markdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Federal Student Aid | 158 | 28.5 / 74.7 | 48.1 / 83.5 | 61.4 / 91.8 | 58.9 / 90.5 |
| New York DMV | 92 | 48.9 / 89.1 | 45.7 / 92.4 | 71.7 / 95.7 | 68.5 / 95.7 |
| Social Security | 83 | 56.6 / 89.2 | 72.3 / 94.0 | 69.9 / 94.0 | 75.9 / 95.2 |
| Veterans Affairs | 116 | 57.8 / 84.5 | 62.9 / 94.8 | 56.9 / 91.4 | 68.1 / 94.0 |
| **All questions** | **449** | **45.4 / 82.9** | **55.9 / 90.2** | **63.9 / 92.9** | **66.4 / 93.3** |

Across agencies, conversion added **10.5 points first** and **7.3 points within five** for Semachunk. Page-clustered 95% intervals were **+3.4 to +18.5** and **+2.4 to +12.9**. Giving each agency equal weight gives **47.9% / 84.4%** on HTML and **57.2% / 91.2%** on Markdown. Mastra’s format-aware whole-chunk route scored **57.2% / 87.1%** on HTML and **64.6% / 94.9%** on Markdown across the 449 questions.

**Plain visible text was a strong coverage control.** Feeding Semachunk the same visible source as plain text removed the heading and DOM hierarchy. It scored **67.7% / 94.3%** on Student Aid, averaging **482 tokens** in the first hit and **6.0% evidence F1**. Markdown used 229 tokens and reached 14.1% F1. Across all four confirmation pools the plain-text result was **72.4% / 95.1%**, with 483 tokens and 9.7% F1, compared with 194 tokens and 20.5% F1 for Markdown. The first plain-text hit contained an average of **53.5%** of its source page and returned at least 99% of that page on **8.9%** of questions. The corresponding Markdown figures were **18.8%** and **0%**. This control changes both candidate construction and the available ranking features.

## Method and reproduction

We used all eight reviewed Doc2Dial HTML collections already in the repository, with 187 page records and 796 questions across development and confirmation. Both systems received byte-identical Markdown from **Turndown 7.2.5** with **turndown-plugin-gfm 1.0.2**, ATX headings, fenced code, hyphen bullets and asterisk emphasis. A second conversion traced each visible DOM character. Removing the trace reproduced the ordinary converter output byte for byte on every page. Every non-whitespace source character mapped back in order to its original occurrence. Markdown punctuation received no extra citation credit. The corpus consists of archived government content snapshots. [Turndown](https://github.com/mixmark-io/turndown) · [GFM plugin](https://github.com/mixmark-io/turndown-plugin-gfm) · [Reviewed source manifest](2026-11-27-prose-reviewed-data.json)

The experiment reused the frozen retrieval configurations, the same questions and accepted alternatives, full agency candidate pools, exact cosine search with `text-embedding-3-small` at 1,536 dimensions and the same token ceiling. Semachunk combined 256-token structural cores with semantic cores capped at 512 tokens. The Student Aid HTML controls matched the earlier first-hit, within-five, evidence F1 and first-hit token measurements on every question. Both representations of a page used identical query vectors. Each paired interval used 3,000 document-cluster bootstrap draws within an agency. The four-agency interval combines independent draws at the observed agency question shares.

With the reviewed corpus and the preceding Mastra and Semachunk study caches in place, run the following commands in the repository root. The converter installation stays under the benchmark cache. [Indexer](../html-markdown-index.mjs) · [Scoring and controls](../html-markdown.py)

```powershell
npm install --prefix benchmarks/.cache/html-markdown/deps --no-audit --no-fund --ignore-scripts --save-exact turndown@7.2.5 turndown-plugin-gfm@1.0.2
node benchmarks/html-markdown-index.mjs
$env:OPENBLAS_NUM_THREADS = '2'
& '.\benchmarks\.cache\semantic-python\Scripts\python.exe' benchmarks/html-markdown.py
```
