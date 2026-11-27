# Do semantic boundaries improve retrieval?

The follow-up distinguishes paragraphs from section boundaries, compares 101 neighbor weights with joint re-embedding, and traces the best-sentence calculation on a real search. [Boundary and weighting experiments](2026-11-27-scope-weights.md)

**Semantic boundaries helped when the alternative was an arbitrary cut at the same group sizes. Structural blocks still gave the most reliable first answer when both strategies could retrieve and show context.** The clearest evidence for semantic boundaries came at a .40 adjacent-sentence cutoff. On fresh sources, the original chunks retrieved a complete first answer on 38.7% of questions versus 27.2% for the matched-size control. That advantage largely disappeared when both methods could match an individual sentence and return neighboring chunks. [Matched-boundary comparisons](2026-11-27-context-mixtures-matched-boundaries.json)

## The main comparison

Development selected the same retrieval and display rule for both families. Score each candidate by the mean of its whole-passage similarity to the question and the highest similarity of any sentence it contains. Return that chunk together with the immediately preceding and following chunks. The selected semantic layout joined consecutive sentence-level parser units while adjacent cosine was at least .25, with no size cap. The structural layout used ordinary 256-token blocks. The choices below were frozen before evaluating the fresh results. [Development selections](2026-11-27-context-mixtures-selections.json)

| Fresh sources, reviewed citations | Complete first | Complete in five | First-hit evidence F1 × 100 | Mean first-hit length¹ |
|---|---:|---:|---:|---:|
| Ordinary 256-token blocks | 59.9% | 86.2% | 23.5 | 774 |
| Same blocks, add best-sentence score | 62.2% | 87.1% | 22.3 | 783 |
| Same blocks and score, show both neighboring blocks | **71.5%** | **93.1%** | 15.5 | 2,038 |
| Uncapped semantic groups at .25, same score and display | 65.3% | 92.5% | 16.1 | 2,221 |
| Uncapped semantic hierarchy at .55, selected for first-hit focus | 46.4% | 63.9% | 26.8 | 318 |
| Uncapped structural blocks | 99.0% | 100.0% | 4.7 | 31,393 |

¹ Nonwhitespace source characters. Each of the seven domains has equal weight. Complete in five credits the union of up to five whole passages from the correct source that cover one valid evidence alternative. First-hit evidence F1 measures the overlap between the first displayed hit and the cited evidence. Supplying extra explanation can improve a reader's understanding while lowering F1. With fixed rankings and inclusive expansion, evidence already in a displayed passage is retained. Changing the embedding can also change which passage ranks first. [Scores and paired intervals](2026-11-27-context-mixtures-sensitivity.json)

Structural blocks led the semantic coverage nominee by **6.2 percentage points at rank one**, with a paired document-bootstrap 95% interval of **+1.1 to +13.2**. The top-five lead was **0.5 points**, with an interval of **−4.6 to +4.3** for structural minus semantic. Before the citation audit the same methods scored 73.6% versus 64.3% at rank one, and 93.1% versus 92.5% at five. The reused confirmation fold favored blocks by 6.5 points first and 10.9 points at five. The development fold had favored semantic by 1.4 points at five. The audit changed evidence for nine fresh questions. Every previously ranked hit was held fixed and verified. [Original sweep](2026-11-27-context-mixtures-results.json.gz) · [Citation corrections](2026-11-27-context-mixtures-citation-audit.json)

Uncapped blocks are a useful ceiling for a coverage-only objective. Five hits exhausted the entire within-document candidate pool for 460 of the 484 primary fresh questions. The two finite alternatives differ appreciably in their ability to put the answer first even though their top-five coverage is similar. [Corpus registry](2026-11-27-context-mixtures-manifest.json)

| Fresh domain | Questions | Blocks first / five | Semantic .25 first / five |
|---|---:|---:|---:|
| Fiction | 371 | 77.9% / 96.0% | 65.5% / 92.7% |
| Spoken meetings | 13 | 46.2% / 76.9% | 30.8% / 69.2% |
| Research papers | 56 | 37.5% / 78.6% | **46.4% / 92.9%** |
| Government services | 14 | 78.6% / 100% | 64.3% / 92.9% |
| Board and policy minutes | 10 | 90% / 100% | 80% / 100% |
| Shareholder letters | 10 | 90% / 100% | 90% / 100% |
| Software documentation | 10 | 80% / 100% | 80% / 100% |

Research papers were the strongest case for semantic grouping. It gained ten complete top fives and lost two, across 18 papers. Its average **first-hit** citation focus was lower there, 12.7 versus 15.9. Finance tied on coverage and favored semantic on first-hit focus, 13.4 versus 9.6. These ten finance questions came from two full Berkshire shareholder letters, including the 1983 appendix. On the 692 separately scored fiction questions that require whole supporting sections, structural and semantic contextualized top-five coverage was 91.5% and 63.6%. [Per-domain results](2026-11-27-context-mixtures-sensitivity.json) · [Coarse fiction outcomes](2026-11-27-context-mixtures-results.json.gz)

## Separating the location of the cut from the size of the chunk

For each document and cutoff, two deterministic rotations relocated the semantic group lengths. Each control had exactly the same sentences in the same order, the same number of chunks, and the same multiset of chunk lengths measured in parser units. Each resulting core was embedded from its actual text. Token counts can vary when a long sentence changes groups. This follow-up used the frozen source labels.

| Uncapped layout | Original first | Rotated first² | Original in five | Rotated in five² |
|---|---:|---:|---:|---:|
| .25, rank and display the core | 45.6% | 38.0% | 69.3% | 72.7% |
| .40, rank and display the core | **38.7%** | **27.2%** | 60.7% | 57.4% |
| .55, rank and display the core | 24.5% | 23.8% | 46.6% | 47.0% |
| .25, best-sentence score and whole neighbors | 64.3% | 63.9% | 92.5% | 91.4% |
| .40, same score and neighbors | 51.5% | 51.6% | 77.1% | 76.7% |
| .55, same score and neighbors | 44.7% | 47.6% | 68.2% | 69.6% |

² Mean of the two rotations. The .40 first-hit gain was **11.5 points**, with a paired 95% interval of **+5.2 to +18.4**. At the same cutoff, semantic boundaries also won first on development and reused confirmation. Strict .55 created 12,456 fresh cores, versus 3,220 at .25. Across this material, splitting that frequently left many answers dependent on a neighbor. The control tests retrieval effects directly. It provides no independent human rating of topic coherence. [All cutoffs, rotations and intervals](2026-11-27-context-mixtures-matched-boundaries.json)

## How to use adjacent context

The table holds the same .55 sentence cores and displayed adjacent sentences fixed. It uses the original fresh labels so every point in the weight sweep is comparable. The core vector is the embedding of the actual core text. For vector addition, 30% is the total weight for both neighbors. With two present each gets 15%. With one present it gets 30%. The neighbor mean keeps its magnitude and the resulting blend is normalized. A joint embedding uses the actual left–core–right text in source order. A centroid is the normalized mean of the core's constituent parser-unit vectors.

| Ranking key for the same displayed window | Complete first | Complete in five | Evidence F1 × 100 |
|---|---:|---:|---:|
| Core embedding | 41.1% | 65.6% | 25.0 |
| Core centroid | 41.4% | 64.5% | 24.7 |
| Add adjacent vectors at 15% | 44.2% | 65.0% | 26.8 |
| Add adjacent vectors at 30% | **48.4%** | 65.1% | 28.1 |
| Add adjacent vectors at 50% | 46.5% | 64.5% | 27.4 |
| Embed the combined text | 44.6% | **67.8%** | **29.4** |
| 40% core, 30% neighbors, 30% joint embedding | 46.2% | 65.2% | 27.5 |
| 40% core centroid, 30% neighbors, 30% joint embedding | 47.7% | 65.5% | 28.5 |
| Better of the core and joint cosine for this query | 44.1% | 66.4% | 26.8 |

Thirty percent is a reasonable low-cost setting for strict cores if first-hit coverage matters. The joint embedding bought more top-five coverage here. The three-way blend adds storage and computation, and neither development coverage nominee used it. With the 30% key held fixed, returning only the core scored 27.2% first and 53.6% in five. Returning both adjacent sentences raised this to 48.4% and 65.1%. Suppressing highly overlapping displayed hits changed top-five coverage from 65.1% to 65.4%. [Complete parameter sweep](2026-11-27-context-mixtures-results.json.gz)

**Crossing a boundary.** For .25 groups with the best-sentence ranking, allowing both neighboring chunks reached 92.5% in five. Trimming each neighbor to the portion in the core edge's scope reached 87.3%. Dropping the entire neighbor when it crossed scope reached 83.6%. A rule allowing a few recognizable links such as a question followed by a reply reached 87.3%. The corresponding structural results were 93.1%, 89.8%, 89.8% and 90.9%. A scope used an authored heading where available, an explicit agenda section where recovered, or a paragraph/turn. Expansion always stayed in the same document. Trimming a wholly out-of-scope sentence drops it. Trimming a multi-paragraph chunk can preserve its same-scope portion. Returning wider text accounts for part of the coverage gain. [Boundary comparisons](2026-11-27-context-mixtures-results.json.gz)

**The A–B–C case.** At an A–C cosine of .45 and a margin of .10 above both adjacent similarities, a supplementary A+C key and display for the outer chunks recovered 46.2% in five on strict groups. Keeping B in the key and display recovered 50.8%. Offering the same A+B+C key to the center alone scored 50.6%, and offering it to all three scored 50.1%. Multiple anchors can spend several top positions on the same window. Across the nine cutoff combinations, keeping B at the outer anchors scored 46.4–52.3%. Plain adjacent-sentence delivery with a 30% key reached 65.1%. At matched trigger counts, using cosine, the strongest signed embedding coordinates, or the same coordinate test after a fixed orthogonal rotation scored 51.0%, 51.4% and 50.8%. The experiment gives little reason to add a coefficient-specific rule. It tests one salience rule and one rotation. [Bridge and coordinate controls](2026-11-27-context-mixtures-results.json.gz)

## Which text should a reader see?

Eight primary questions per domain were drawn by a fixed hash. For each of three rankings a selector saw the query and the four possible windows at each of the top five hits. It had no reference answers. A second model assessed first-hit sufficiency and unnecessary material. A gold-aware oracle shows how short a window could be while preserving every cited character the full window contains.

| Strict .55 groups, 30% adjacent key, 56 audited questions | Complete first | Complete in five | Mean first-hit length | Evidence F1 × 100 | Judged sufficient first |
|---|---:|---:|---:|---:|---:|
| Display core | 14 | 26 | 156 | 24.6 | 33 |
| Display both adjacent sentences | 26 | 35 | 341 | 28.6 | 35 |
| Display each neighbor with query cosine ≥ .40 | 20 | 28 | 237 | 27.8 | 33 |
| Query-aware reader chooses among four windows | **26** | **35** | **259** | **32.7** | **37** |
| Gold-aware shortest sufficient window | 26 | 35 | 190 | 37.2 | — |

The reader preserved aggregate first and top-five coverage on strict cores and shortened the first passage by 24%. On .25 groups it retained 51 complete top fives, lost one complete first hit, and shortened the mean first hit from 2,426 to 2,246 characters. On blocks it preserved 40 complete firsts and 51 complete top fives and shortened the mean from 2,052 to 1,785. A fixed query cosine readily drops the sentence containing a vote or condition. The grounded judge assessed 417 distinct question–passage pairs separately. For 287 of 387 assessments awarding support, all supplied evidence quotes could be located verbatim after whitespace and case normalization. On six strict cases it gave a shorter core a higher sufficiency grade than the window containing it. These are model judgments, and the exact citation metrics and source readings carry more weight for small differences. [Reader decisions and grades](2026-11-27-context-mixtures-reader-audited.json.gz) · [Original and audited reader comparisons](2026-11-27-context-mixtures-sensitivity.json)

### What happened in individual searches

| Fresh question | What the passages actually contained |
|---|---|
| Who received the PSF's NLTK grant, who mentored it, and what was the vote? | The strict core named Mikhail Korobov and Steven Bird. The following sentence reported the 9–0–0 vote. Its query cosine missed the .40 gate. The reader restored the vote and also included an unnecessary link to a previous committee report. The right neighbor alone would have sufficed. |
| What two objectives did a paper introduce for unsupervised sentence representation? | The .25 semantic first hit covered both named approaches, SDAEs and FastSent. The structural first hit missed the full citation. This illustrates the papers result. The long semantic hit also included introductory material beyond the names. |
| What did Maisie's mother do when the nobleman questioned her song? | The .25 semantic first hit discussed her reputation for industriousness and the value placed on spinning. It matched the character and theme. The structural first hit covered the specific action of turning and walking into the house without answering. |
| How does Prettier print decorators on a class? | The semantic first hit explained the general rule for decorators and gave member examples. The class-specific exception lay outside that window. The structural first hit included the exception and unnecessary neighboring examples. An answer that repeated the general rule would give the wrong advice. |
| Why did intrinsic value exceed Berkshire's book value? | A .25 semantic first hit ended as the letter announced its two reasons. The structural first hit included the subsequent explanation of stock carrying values and economic goodwill. The transition sentence was a strong search match and a poor place to finish reading. |
| What did Kirsty Williams say about university mergers? | The published citation pointed to another speaker agreeing with an unrelated remark. The actual answer, eleven turns earlier, left mergers to individual institutions and described the government's interest in sound plans. Larger windows had received credit for exposing the wrong turn. |
| What was the price of VA dependent coverage in the source? | A short answer saying it cost nothing was sufficient. The label had also required the age condition. The correction accepts the cost answer and preserves the longer evidence as an alternative. |

## Corpus and checks

The main sweep scored 3,609 configurations. It crossed three uncapped cutoffs in the production semantic hierarchy and in linear sentence grouping with structural controls, alternative ranking keys and different display rules. All methods used the same 1,536-dimensional text-embedding-3-small model. The published sweep archives every configuration's domain-balanced metrics and individual outcomes for the development nominees. The paired intervals resample source documents within each domain. They describe uncertainty for the stated comparisons. Exploring thousands of variants, using one embedding model, and having only two fresh sources in several domains limit generalization. [Sweep protocol](../mixture-protocol.json) · [Per-question finalist outcomes](2026-11-27-context-mixtures-outcomes.json.gz)

There were 209 full source documents, 2,049 primary questions and 1,671 broader fiction-section questions. The 69 fresh documents supplied 484 primary questions and 692 section questions. Fresh sources include 24 stories, six meeting transcripts, 18 papers, 15 government pages, two sets of minutes, two shareholder letters and two software manuals. Four of the six transcripts had eligible short-span questions. Two government pages served only as distractors. The government pool retains all 15 pages after removing underspecified utterances and repeated questions pointing to the same solution. Search covers the collection for government and software. The other five domains use known-document retrieval. The results speak most directly to English prose, fairy tales, formal meetings and technical documentation. Full novels and informal workplace conversations are still underrepresented. [Source manifest](2026-11-27-context-mixtures-manifest.json) · [Fresh hand-checked citations](../mixture-citations.json)

The fiction importer now joins printed line wraps while preserving blank paragraphs. Thirteen development and sixteen confirmation stories changed. All 2,032 old fiction questions and their references mapped to exactly the same nonwhitespace positions. On unchanged sources, 5,690 question–configuration checks reproduced the archived first, top-five and focus results. We independently checked 1,152 normalized vector blends against direct vector construction. The maximum cosine difference was below 0.000001. All returned windows are whole. The embedding provider's input limit is handled by pooling complete token segments. [Verification](2026-11-27-context-mixtures-verification.json) · [Protocol](../mixture-protocol.json) · [Reproduction](../README.md#uncapped-semantic-groups-and-neighbor-weighting)

For a general-purpose component, these results favor **structural blocks as the default**, with the best contained sentence available as a retrieval signal and optional neighboring text at delivery. The .40 core-only result supports retaining semantic segmentation as an option for focused passages. The 30% blend and query-aware display are credible options for applications that specifically want small semantic cores. The evidence for a universal threshold or a specialized A–B–C weighting rule is weak.
