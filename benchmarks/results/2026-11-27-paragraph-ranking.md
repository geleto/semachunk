# Do neighboring paragraphs or a second layout improve retrieval?

Keep `blocks` as the default. A caller can index both layouts and score enclosing sections when comparing retrieval on its own documents. The existing combined index reproduced its earlier first-hit advantage. On 58 new documents it beat existing blocks on both measures when the source was known. When all sources were searched together it lost first-hit accuracy and gained 0.15 percentage points within five. Independent tuning also failed to produce a combined index that consistently beat independently tuned blocks. [Full results and paired intervals](2026-11-27-paragraph-ranking.json)

## Layouts under the same reading limit

Each entry is the percentage of questions with complete cited evidence in the **first passage / across the first five passages**. Each domain has equal weight. The two new columns ask the same 468 questions. One searches the known source, and the other searches all 58 documents. Every returned passage, including its reading context, fits 512 tokens. The primary experiments cap upper structural branches at 256 tokens.

| Layout and ranking | Development | Confirmation | Previous replication | Previous shared | New known source | New shared |
|---|---:|---:|---:|---:|---:|---:|
| Existing blocks + sections | 53.0 / 77.1 | 60.9 / 90.1 | 75.8 / 93.0 | 71.1 / 89.0 | 52.0 / 79.1 | 38.1 / 66.5 |
| Existing semantic-blocks + sections | 54.7 / 80.4 | 63.1 / 88.8 | 75.3 / 92.7 | 70.1 / 88.3 | 51.3 / 78.6 | 35.6 / 65.3 |
| Existing combined + sections | 55.2 / 79.9 | 62.2 / 89.8 | 77.9 / 92.2 | 73.2 / 88.3 | 52.9 / 79.5 | 37.3 / 66.7 |
| Retuned blocks | 54.7 / 82.2 | 61.1 / 88.6 | 71.0 / 93.4 | 66.0 / 88.8 | **54.3 / 82.7** | **39.0 / 67.4** |
| Retuned semantic-blocks | 55.4 / 84.2 | 63.9 / 90.1 | 70.4 / 91.1 | 66.3 / 87.1 | 49.8 / 78.0 | 33.9 / 64.1 |
| Retuned combined | 56.5 / 85.0 | 64.6 / 91.0 | 72.2 / 91.7 | 67.8 / 86.9 | 52.6 / 80.9 | 36.8 / 67.4 |
| Two retuned structural layouts | 54.7 / 82.2 | 61.1 / 89.6 | 71.1 / 94.2 | 64.6 / 89.8 | 54.3 / 82.5 | 38.5 / 67.3 |

The semantic cutoff of **0.15** and joining adjacent paragraphs survived development selection. Other choices moved. The retuned blocks index used a 512-token core, 40% paragraph weight, 22.5% enclosing-section weight where available, and an 85% overlap threshold for suppressing duplicate hits. The retuned combined index used the same two size limits, 25% paragraph weight, zero section weight and 15% weight for neighboring **chunk** scores. Existing blocks used a 256-token core. All three existing rows above used 50% paragraph weight, 15% section weight and 75% duplicate overlap.

On the new shared search the retuned combination gained 13 correct first hits over blocks and lost 23. Within five it gained ten and lost 19. Its domain-balanced differences were −2.2 and −0.07 percentage points, with source-paired 95% intervals of [−5.14, +0.86] and [−3.74, +3.55]. For known-source search the differences were −1.7 and −1.8 points, with intervals of [−4.16, +0.78] and [−4.43, +0.40]. The combined index averaged 422 tokens for a shared first hit and blocks averaged 434. Their first-hit citation F1 scores were 17.7% and 17.4%. F1 measures both evidence recovered and extra text returned. None of the three retuned indexes returned 99% or more of a source as its first hit on either new task.

## What happens when paragraphs borrow their neighbors’ scores?

For each paragraph in a candidate chunk, we blended its query score with the query scores of the immediately preceding and following paragraphs inside the same section or record. We then took the best blended paragraph score in the chunk. At 20%, the two neighbors share that 20% of the paragraph term. These trials kept the returned text, chunk score, section weight and duplicate rule fixed.

| Neighbor share in the existing combined index | Previous replication | New known source | New shared |
|---|---:|---:|---:|
| 0% | 77.9 / 92.2 | 52.9 / 79.5 | 37.3 / 66.7 |
| 5% | 77.5 / 93.0 | 52.9 / 78.8 | 37.9 / 66.0 |
| 10% | 73.2 / 91.5 | 52.3 / 79.4 | 37.2 / 65.6 |
| 15% | 73.2 / 91.2 | 52.0 / 79.4 | 36.6 / 65.6 |
| 20% | 71.7 / 91.2 | 51.1 / 79.4 | 36.4 / 65.0 |
| 30% | 67.3 / 91.1 | 50.1 / 78.4 | 35.4 / 64.0 |
| 40% | 64.8 / 90.9 | 48.4 / 79.6 | 33.5 / 63.7 |
| 50% | 64.2 / 90.9 | 48.7 / 79.8 | 33.6 / 63.1 |

We also tested the strongest neighbor, crossing section boundaries, keeping only neighbors substantially visible in the returned text, normalizing the blended vector, and re-embedding the three paragraphs together. Blending 20% of the joint text embedding into the center gave **37.7 / 65.0** on new shared search. Blending 20% of the mean adjacent scores gave **36.4 / 65.0**. Both lost within-five coverage. Returning neighboring **text** remained valuable. Keeping the zero-weight ranking but displaying only the core dropped new shared coverage from **37.3 / 66.7** to **25.9 / 54.2**. [Controls for each layout and fold](2026-11-27-paragraph-ranking.json)

Three known-source first hits show what the 20% mean changed. In all three, the cited answer still appeared within five.

| Question | First hit with zero paragraph-neighbor weight | First hit at 20% |
|---|---|---|
| How large was the Twitter dataset? QASPER paper 1910.02001 | The 194-token data passage gave 2,973,371 tweets and 2,848 users. | A 252-token experimental setup passage gave graph sizes. It missed both requested counts. |
| How did the authors compare embeddings with human judgments? QASPER paper 1606.02601 | A 317-token passage discussed character-level models. | A 433-token passage explained the word-pair ratings and rank correlation. |
| What did participants think about the risk of losing focus? QMSum meeting 160 | A 497-token passage contained the cited discussion of the advisory group's remit. | A 363-token passage discussed the narrow focus of school performance measures. It addressed a different concern. |

Across all 468 known-source questions, the change produced nine first-hit gains and 22 losses. It produced nine gains and 24 losses across documents. The examples illustrate why a relevant neighbor can boost a passage that discusses the right subject but answers a different question.

## What semantic retrieval contributes

After validation we inspected the two independently ranked top-five lists. Using the annotated evidence, we calculated the best possible choice of one or five passages from those lists. Every choice uses the actual cited text and the same token ceiling. These are diagnostic upper bounds. The ranker would have to identify the passages from the question alone to reach them.

| Where a complete answer was available on new shared search | Blocks | Blocks plus a second structural layout | Blocks plus semantic-blocks |
|---|---:|---:|---:|
| Somewhere in a single indexed passage of the correct source | 87.2% | 87.2% | 87.2% |
| In at least one layout's first hit | 39.0% | 39.0% | 42.6% |
| In a single passage drawn from each layout's first five | 62.3% | 62.3% | 65.1% |
| In the best selection of at most five passages from those lists | 67.4% | 68.1% | 70.9% |

Blocks already had a single passage covering the full citation for 448 of 468 questions somewhere in the correct source. Adding semantic boundaries did not expand that set. **Semantic retrieval still brought nine additional single-passage answers into the candidate lists and made complete five-passage coverage possible for ten additional questions.** A second structural layout brought in zero additional single-passage answers and enabled one additional five-passage answer. For these documents, semantic retrieval's measurable contribution was finding alternative candidates. The observed loss came when choosing which candidates to show. [Diagnostic calculator](../paragraph-ranking-complement.py)

We tested that explanation with a second experiment. We retrieved five passages independently from each layout, then ranked their union by reciprocal search rank and BM25 term matches in the **cited text**. The same reranker ran on blocks alone and on two structural layouts. Selection on development gave equal weight to search rank and lexical rank in all three families. This experiment followed inspection of the new documents and is exploratory.

| Index with the shortlist reranker | Previous replication | Previous shared | New known source | New shared |
|---|---:|---:|---:|---:|
| Blocks | 71.2 / 93.4 | 66.9 / 88.8 | **55.1 / 82.7** | 39.9 / 67.4 |
| Two structural layouts | 71.3 / 93.4 | 65.8 / 88.8 | 55.1 / 82.1 | 39.9 / 66.1 |
| Blocks plus semantic-blocks | **74.9 / 95.6** | **67.8 / 90.9** | 53.8 / 81.8 | **40.5 / 67.7** |

The shortlist reranker recovered some of the shared-search advantage and increased first-hit citation F1 from 17.8% to 19.9% there. Its shared first-hit and within-five differences against reranked blocks both had intervals spanning zero. It also lost on the new known-source task. [Shortlist experiment](../paragraph-ranking-shortlist.py)

## Other controls and limits

- Reranking the same five blocks using semantic support preserves their collective evidence exactly. With the 256-token structural limit it improved the previous replication first hit from 71.0% to 73.1%, then fell from 54.3% to 49.6% on new known-source search. Replacing a passage only with a semantic passage covering every one of its cited spans produced no coverage gains on either new search.
- Relaxing the structural limit to 512 favored a blocks index using 30% joint-paragraph re-embedding. Semantic reranking improved its first hit on all six measured pools, with identical top-five coverage. It reached 53.2 / 84.6 on the new known-source task and 37.6 / 64.3 across documents. First-hit gains over equally wide blocks had intervals spanning zero on both. Average first-hit lengths reached 469 and 477 tokens.
- Adding individual sentences, triples or similarity-gated sentence groups raised index cost. Individual sentence keys won development selection for the extended blocks and combined indexes. New shared scores were **41.5 / 67.8** for blocks and **39.8 / 69.8** for the combination. They needed **17,292 and 17,803 distinct vectors** across the 58 sources. The corresponding paragraph-based indexes used **5,298 and 5,740**. The within-five gain came with a first-hit loss.

## Selection, verification and reproduction

The main study tested 3,116 distinct development profiles across 34 layouts. We varied core and structural limits, ten fixed semantic cutoffs from 0 to 0.40, document-calibrated cutoffs, paragraph joining, chunk/paragraph/section weights, paragraph and chunk neighborhood scoring, duplicate overlap and small indexing units. Geometry screening preceded joint scoring on the shortlisted layouts. This is a broad search with one embedding model and a fixed 512-token reading ceiling. It establishes neither a global optimum nor the best character-mode limits. [Selection protocol](../paragraph-ranking-protocol.json) · [All development scores](2026-11-27-paragraph-ranking-development.json.gz)

Development used 758 questions in seven domains. The earlier confirmation and replication sets had 807 and 484 questions. The additional 58 sources were 24 FairytaleQA stories (354 questions), 24 QASPER papers (62) and 10 QMSum meetings (52). Their source IDs, normalized document text and question text were checked against the earlier corpus. All 58 participated in shared search, including two distractors with no surviving questions. Scores average domains equally. Intervals use 3,000 paired resamples of source documents within each domain. Promotion required positive lower 95% bounds for both coverage measures on both new tasks, alongside passage-size and focus checks. [Source manifest, per-domain outcomes and costs](2026-11-27-paragraph-ranking.json)

The paper data contained two source-free prompts each asked about two different papers. After a citation review, shared scoring accepts either paper's annotated answer for each identical prompt. Known-source scoring still requires the specified paper. As a sensitivity check, removing all four records gave **39.6 / 68.7** for retuned blocks and **37.3 / 67.5** for the retuned combination. Other questions also assume a known source, which limits the interpretation of absolute shared-search scores. [Reviewed prompts and sensitivity results](2026-11-27-paragraph-ranking.json)

The encoder was `text-embedding-3-small` with 1,536 dimensions and `cl100k_base` token counts. All candidate passages in each search pool were scored before duplicate suppression in the main experiment. The study reproduced the previous aggregate scores for all three incumbent indexes. Independent checks matched ordered citations and token counts in 1,515 archived comparisons and 1,512 new public-API comparisons. A separate scalar JavaScript implementation matched the 20% paragraph experiment on 36 known-source and 36 shared searches. [Verification code](../paragraph-ranking-verify.mjs)

Start with the prepared corpora, encodings and verification outputs from the structural-limit study and a Python environment with NumPy. A single BLAS thread is sufficient. Freeze development candidates before running validation. [Input preparation](2026-11-27-structural-limits.md#selection-and-verification)

```sh
python benchmarks/paragraph-ranking-holdout.py
node --max-old-space-size=4096 benchmarks/paragraph-ranking-index.mjs
python benchmarks/paragraph-ranking-study.py select compact
node --max-old-space-size=4096 benchmarks/paragraph-ranking-details.mjs
python benchmarks/paragraph-ranking-study.py details
python benchmarks/paragraph-ranking-study.py development confirmation fresh shared-fresh holdout shared-holdout
node --max-old-space-size=4096 benchmarks/paragraph-ranking-verify.mjs
python benchmarks/paragraph-ranking-complement.py
python benchmarks/paragraph-ranking-shortlist.py select
python benchmarks/paragraph-ranking-shortlist.py validate
python benchmarks/paragraph-ranking-study.py publish
```
