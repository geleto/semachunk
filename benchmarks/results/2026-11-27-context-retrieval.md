# Can nearby context rescue semantic sentence chunking?

The fiction edition used for this study turned printed line wraps into paragraph breaks in 29 stories. The follow-up corrects the import, verifies every original fiction citation, and tests disjoint documents from all seven domains. [Corrected study](2026-11-27-context-mixtures.md)

**Adding adjacent sentences helped strict semantic chunks recover complete answers. Most of that gain came from letting the reader see the neighbors.** A related experiment produced a stronger retrieval result. Keeping 256-token structural passages and scoring each by both its whole text and its most relevant sentence raised complete first hits from 45.0% to 51.3% and complete top fives from 81.1% to 84.6%. First-hit evidence F1 moved from 28.5 to 27.9. The gains were uneven across domains. [Primary results](2026-11-27-context-retrieval-results.json) · [Fixed-parent results](2026-11-27-context-retrieval-parent-results.json)

## What the existing strategies do

In prose, the parser can expose sentences below sections, paragraphs and sentence-ending lines. Structural `blocks` accepts a whole node when it fits. It descends into a node when required and packs consecutive siblings that fit. A well-formed paragraph can therefore pass through without the structural packer ever requesting its sentences. `pack` is the linear strategy. Markdown also has atomic structures such as fenced code.

`semantic-blocks` visits eligible sibling pairs at multiple depths. A low cosine sets a boundary that propagates to ancestors. The older `semantic` procedure scores neighboring chunks, merges qualifying pairs and can score the resulting chunks again. A reason, command or vote can legitimately have a low cosine to the sentence that introduces it. In the previous sweep, a zero cutoff reproduced the structural passages in every confirmation document. The current experiment also joins consecutive parser leaves while each neighboring pair clears a fixed threshold, with unlimited group size. This directly tests the proposed sentence-only approach. [Structural traversal](../../src/hierarchy.js) · [Semantic hierarchy](../../src/semantic-blocks.js) · [Iterative merging](../../src/merge.js) · [Previous sweep](2026-11-27-prose-threshold-study.md)

## Corpus and grading

The earlier 1,302-question prose sweep covered papers, manuals, government service pages and financial filings. Separate older benchmarks contained meetings and scripted dialogue. Continuous narrative fiction and board minutes were missing from that sweep.

| Domain | Documents, both folds | Development questions | Confirmation questions | Evidence used |
|---|---:|---:|---:|---|
| Narrative fiction | 46 | 538 | 515 | All 23 validation and 23 test stories from FairytaleQA. A reference answer of at least three words occurs uniquely in the story and inside an expert-labeled supporting section. Any qualifying alternative earns credit. |
| Spoken meetings | 6 | 23 | 14 | Complete QMSum transcripts. A query cites one to three consecutive turns. Each split supplies the three meetings with the most such queries. |
| Board minutes | 4 | 8 | 8 | Full minutes of two Python Software Foundation board meetings and two Federal Reserve meetings. We wrote four questions per meeting and checked the exact references before scoring. |
| Research papers | 16 | 21 | 28 | Eight complete papers from the first reviewed shard in each fold. |
| Software FAQs | 9 | 22 | 76 | All reviewed manuals. The search spans all manuals in the fold. |
| Government services | 51 | 140 | 158 | The complete StudentAid collection in each fold, searched across pages. |
| Financial filings | 8 | 6 | 8 | All reviewed earnings releases and 8-Ks below 90,000 source characters. The entire selected filing is searched. |

There are **1,565 primary questions on 140 documents**. The remaining 979 story questions have broader expert citations and are scored separately against their complete supporting sections. Their answers can be inferential or paraphrased. An exact phrase is a narrow retrieval target, and a whole supporting section is a broad one. Neither gives a general measure of story understanding. All three confirmation spoken meetings are chaired by the same Welsh committee chair. Full-length novels, spontaneous corporate boardroom dialogue and typical private meeting notes still need independent coverage. [Corpus manifest](2026-11-27-context-retrieval-manifest.json) · [Board citations](../context-board-citations.json) · [FairytaleQA source](https://github.com/uci-soe/FairytaleQAData) · [QMSum paper](https://aclanthology.org/2021.naacl-main.472/)

The primary sweep has 252 configurations. It crosses structural controls and uncapped semantic groups with a local context policy, a ranking representation and the text returned to the reader. Each enriched key is an embedding of actual text in source order. Added passages retain separate source ranges. Selection uses either complete answers among the first five whole hits or first-hit evidence F1, giving each of the seven domains equal weight. F1 measures source overlap with the annotated answer and penalizes surrounding text. No selector uses passage count or size as an objective. Four original controls reproduced the previous coverage and focus in all 1,836 matched question–method checks. [Protocol](../context-retrieval-protocol.json) · [Development selections](2026-11-27-context-retrieval-nominees.json)

## What context contributes

| Confirmation, seven equally weighted domains | Complete first | Complete in five | First-hit evidence F1 × 100 |
|---|---:|---:|---:|
| Sentence groups at .55 alone | 17.27% | 42.98% | 26.11 |
| Embed immediate neighbors, return the original group | 10.46% | 46.67% | 16.90 |
| Keep the original ranking, return the neighbors too | 33.27% | 62.53% | 26.54 |
| Embed and return the neighbors | 32.42% | 66.41% | 25.87 |
| Embed and return the neighbors, guard embedding drift at .85 | 33.04% | 62.04% | 27.25 |
| Embed and return the best similar nearby unit or heading | 20.07% | 43.75% | 23.79 |
| Select that unit by its best matching edge sentence | 20.68% | 43.53% | 23.74 |
| Where A and C match across B, include C | 19.10% | 41.46% | 24.79 |
| At those same boundaries, include B and C | 21.51% | 45.96% | 25.76 |
| Sentence groups at .25, rank by the better of core and adjacent-context keys, return both neighbors | 48.95% | 80.22% | 22.26 |
| Heading-aware 256-token blocks, original text | 43.83% | 80.95% | 30.60 |
| Heading-aware 256-token blocks with the same adjacent embedding and delivery | 47.13% | 84.68% | 23.19 |
| Unlimited ordinary blocks | 87.15% | 99.46% | 5.22 |

With strict groups, ranking and delivery can pull in different directions. A neighbor may make a small group an excellent search match even though only the neighbor states the answer. Returning the original group in that case makes the result look inexplicable. Adding neighbors only at delivery gained 19.55 percentage points of top-five coverage. Re-embedding that expanded text gained a further 3.88 points. The .85 drift guard reverted 9,169 of 10,161 strict confirmation cores to their original ranking key. It improved first-hit focus by 1.38 points and lost 4.37 points of top-five coverage against unrestricted expansion.

The explicit A–B–C rule fired on 1,814 strict confirmation cores. A and C had to reach cosine .45 and exceed both A–B and B–C by at least .10. Including B alongside C gained 45 complete top fives and lost four compared with skipping B. Plain adjacency still retrieved considerably more complete answers across the corpus. The narrow trigger misses common two-part relationships, including a resolution followed by its vote with no matching third sentence.

Development chose .55 with adjacent embedding and delivery for semantic first-hit focus. Its confirmation F1 was 25.87, versus 30.80 for the development-selected structural setting. The latter kept 256-token heading-aware blocks for display and used an A+C embedding key where available. The semantic-minus-structural paired source-bootstrap interval was −9.7 to +0.8 focus points. Its complete-at-five gap was −13.1 points, with interval −20.6 to −5.8. The .25 semantic strategy was the development winner for coverage among semantic methods. Unlimited blocks exhausted their entire candidate pool in five hits on 567 of 807 primary confirmation questions. Their 99.46% coverage coexists with very low first-hit focus. [All methods and intervals](2026-11-27-context-retrieval-results.json)

## What a reader gets

| Confirmation question | What changed |
|---|---|
| **Fiction. What did the jellyfish hear leaving the island?** | A describes his unhappy departure. C describes the court waiting for him to return. B says the monkey laughed at him. Keeping B returned the answer first. Skipping B returned a speech attribution and missed the answer in five. The waiting court still adds unnecessary text to the successful passage. |
| **Fiction. What was the fox doing while the wolf was thinking?** | The isolated sentence says the fox was galloping along the other road. With adjacent embedding and delivery, a later exchange about cheese ranked first. It mentions both animals. The answer survived in the first five. |
| **Board. How much did the PSF grant Kiwi PyCon and how did the directors vote?** | The strict core retrieved the NZD 1,000 resolution and missed the vote in five. The context key retrieved the six-to-zero vote first. Its displayed neighbors supplied the resolution and an unnecessary heading about the next budget item. Structural blocks answered both but also included votes on unrelated contracts. |
| **Board. Why was an outreach budget increase put off?** | The strict core found the proposed increase but omitted the reason. Adjacent embedding and delivery found the complete evidence in five, while the top hit came from an earlier committee report. A name was split after the initial “D.” in that hit. The shared committee name is a strong match for both agenda items. |
| **Spoken meeting. How did the Welsh Baccalaureate prepare students for employment, in the college principal's view?** | The strict contextualized search returned a greeting and the interviewer's question. The wording is close, but the principal's answer is in another turn. Blocks recovered the cited testimony in five. A speaker turn can be a more meaningful delivery unit than a neighboring sentence. |
| **Research. Where did the lexicon come from?** | The expanded first hit said it used the training and testing sets. The preceding classifier rule and the following precision–recall observation add little for this question. The heading-aware structural hit missed the complete citation in five. |

On the 515 exact-answer fiction queries, strict groups with both forms of context retrieved 366 complete top fives and scored 15.7 in first-hit focus. Heading-aware blocks retrieved 462 and scored 5.5. On the eight board queries the .25 semantic coverage nominee retrieved all eight and answered six first, versus eight and three for heading-aware blocks. On the 14 longer spoken-turn queries, .55 with adjacency retrieved zero complete turn citations in five, .25 retrieved six and heading-aware blocks retrieved seven. Partial responses can be useful even when a complete-turn label remains uncovered. On the 492 separate fiction queries requiring whole supporting sections, the .55 adjacent strategy covered 6.5% in five and heading-aware blocks covered 63.8%. [Per-question outcomes](2026-11-27-context-retrieval-outcomes.jsonl.gz)

## Matching the relevant part of a longer passage

We ran an exploratory follow-up on the same questions. Each candidate and its displayed text stayed fixed. It received a score from its whole-passage cosine and its best matching contained child. A child could be a single parser unit, usually a sentence, or an uncapped group of semantically related units. Children extending outside the displayed parent were ineligible. Development selected equal weighting for the best coverage treatments. [Follow-up protocol](../context-parent-protocol.json) · [Development selections](2026-11-27-context-retrieval-parent-nominees.json)

| Same ordinary 256-token passages | Complete first | Complete in five | First-hit evidence F1 × 100 |
|---|---:|---:|---:|
| Rank by the whole passage | 44.99% | 81.13% | 28.51 |
| Give equal weight to the best .55 semantic group | 47.88% | 81.61% | 26.83 |
| Give equal weight to the best individual parser unit | **51.35%** | **84.63%** | 27.88 |

The individual-unit gain over whole-passage ranking was **6.36 percentage points at rank one** (descriptive paired 95% interval +2.90 to +9.78) and **3.50 at five** (+0.12 to +9.29). First-hit F1 changed by −0.63 (−2.60 to +1.42). Fiction gained 26 top fives and lost 13, research gained three and lost zero, and government gained seven and lost nine. A financial gain of one question matters substantially to the seven-domain average because there are eight confirmation finance questions. These reused folds and the concentration of meeting sources warrant replication. The result favors adding an optional sentence matching signal to retrieval. It gives little reason to require semantic chunk boundaries for that signal. [Follow-up results and paired comparisons](2026-11-27-context-retrieval-parent-results.json)

## How the research relates

**Partial matching.** ColBERT represents queries and passages with multiple contextual token vectors. For each query token it takes the best passage-token match and sums those scores. A passage can therefore match several aspects of a query even if it covers other material. Our best-sentence experiment is a simpler version with one pooled query vector and sentence-sized document units. Ordinary dense-embedding coordinates have no guaranteed interpretation as concepts. Rotating the space preserves every cosine but changes which individual coordinates appear to overlap. A learned multi-vector or asymmetric model gives a principled way to pursue the idea. [ColBERT](https://arxiv.org/abs/2004.12832) · [Order embeddings](https://arxiv.org/abs/1511.06361)

**Contextual embeddings.** Late Chunking encodes the surrounding document before pooling the token representations belonging to each chunk. It can give a short passage access to its context while keeping it separately retrievable. It requires token-level hidden states from the encoder. Our current benchmark encoder returns one pooled vector per input. Anthropic's Contextual Retrieval uses another route by generating a chunk-specific description and prepending it before embedding and lexical indexing. Both methods differ from explicitly copying neighboring sentences. [Late Chunking](https://arxiv.org/abs/2409.04701) · [Anthropic's experiment](https://www.anthropic.com/research/contextual-retrieval)

**Keeping B.** LlamaIndex's semantic double-merging parser explicitly checks a later chunk when the immediate neighbor fails to match. If the later chunk matches and the merged text fits, it can include the intervening chunk. Semachunk's iterative semantic merge compares immediate neighbors. The jellyfish example shows when keeping B is justified. The Welsh meeting example shows why location and speaker role also matter. [LlamaIndex implementation](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/node_parser/text/semantic_double_merging_splitter.py)
