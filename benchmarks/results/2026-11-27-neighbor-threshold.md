# Does a stricter semantic cutoff make neighbouring context more useful?

**Strict semantic matches benefit when they retrieve a larger passage.** On the newer shared search, giving 30% of a standalone strict chunk's embedding to adjacent chunk vectors improved complete evidence within five from 31.6% to 35.7%. Embedding the entire bounded reading passage delivered a larger improvement in the combined index. At cutoff 0.55 it moved within-five coverage from 62.2% to 68.2% with exactly the same text available to the reader. The corresponding first-hit rate moved from 35.0% to 34.4%. For a general default, tuned structural blocks retain the stronger first hit on these documents. For a semantic index, a loose cutoff with a bounded reading window and a strict match that helps rank a structural passage both merit comparison. [All scores, geometry, and source-paired intervals (compressed JSON)](2026-11-27-neighbor-threshold.json.gz)

The previous combined-index experiment held the semantic cutoff at 0.15. An earlier experiment with flat, short sentence groups found a first-hit benefit at 0.55. This study crosses cutoff and context in the hierarchical index. A larger cutoff creates more boundaries. The context weight independently controls how much surrounding text contributes to a candidate's retrieval embedding. [Earlier sentence-group experiment](2026-11-27-scope-weights.md) · [Earlier hierarchical comparison](2026-11-27-paragraph-ranking.md)

## Varying the cutoff and the neighbour weight together

The two numbers in each cell are the percentage of questions with all the cited evidence in the first returned passage and across the first five. They give each domain equal weight. These rows search all 58 newer documents for each of 468 questions. The two layouts in the combined index compete for the same five places. Only the semantic candidates receive the experimental neighbour weight. Every ranking method at a given cutoff uses the same passages in this table.

| Semantic cutoff | Semantic alone | Semantic alone, 30% neighbours | Combined | Combined, 30% neighbours |
|---|---:|---:|---:|---:|
| 0.10 | 37.6 / 63.2 | 36.6 / 65.4 | 37.5 / 64.3 | 35.4 / 66.1 |
| 0.15 | 35.6 / 65.3 | 36.4 / 66.4 | 37.3 / 66.7 | 37.4 / 67.8 |
| 0.25 | 28.6 / 54.6 | 27.3 / 56.1 | 34.4 / 64.2 | 31.9 / 65.5 |
| 0.40 | 20.6 / 39.6 | 20.4 / 40.1 | 29.3 / 50.3 | 27.2 / 50.0 |
| 0.55 | 18.2 / 31.6 | 18.5 / 35.7 | 25.5 / 46.2 | 25.4 / 46.1 |
| 0.75 | 17.1 / 30.9 | 18.3 / 33.8 | 25.4 / 45.0 | 24.1 / 42.8 |

For semantic alone, adding the neighbours gained 4.1 points within five at 0.55 and 1.1 points at 0.15. The difference between those two gains was +3.0 points, with a source-paired 95% interval of −0.4 to +6.4. For the combined index the corresponding difference was −1.2 points (−6.3 to +3.4). On the 484-question replication across 69 sources, the strict combined index gained 3.3 points first when adding the neighbours and lost 1.8 points within five. A strict cutoff can create more opportunity to improve a weak fragment score while lowering the absolute retrieval result.

At 0.15 the 58 sources produced 1,899 semantic chunks with a median of 192 tokens. At 0.55 they produced 9,014 with a median of 28 tokens. Showing an immediate neighbour on each side yielded a median of 474 and 95 tokens respectively. Even with perfect ranking inside the correct source, one semantic passage could cover the whole reference for 85.4% of questions at 0.15 and 58.1% at 0.55. The combined index retained an 87.2% single-passage ceiling at either cutoff because the structural passages were still present.

The extra candidates also displaced complete structural answers. On the newer shared search the 0.55 semantic layout supplied 83.4% of first-ranked entries with the 30% blend. Against the identical structural layout alone, 4.0% of questions gained a complete first hit and 16.7% lost one, counting domains equally. At 0.15 those figures were 5.1% gained and 5.8% lost. A short fragment can confidently match a question's topic without containing its answer.

## How much context reaches the reader?

Keeping the 0.55 cutoff and the same 30% immediate-neighbour ranking, extending the reader's window from one to four chunks on each side raised the newer shared result from **25.4 / 46.1 to 30.6 / 59.5**. The identity of the first-ranked chunk was fixed. The extra text could complete its answer, and the altered overlap between displayed hits could change which lower hits were retained. The paired gains were +5.2 points first (95% interval +3.0 to +7.8) and +13.3 points within five (+9.3 to +17.6). Giving the four-neighbour context a share of the embedding as well, with weights decreasing with distance, scored 31.0 / 57.2. Median semantic reading windows grew from 95 to 290 tokens. The semantic single-passage evidence ceiling rose from 58.1% to 77.0%.

One research-paper question asked which languages the authors actually tested (QASPER 1606.02601). At 0.55 the 42-token first hit said the method might work especially well for Turkish and German. A reader could easily mistake that prediction for an experiment. Expanding around the same hit produced 180 tokens and recovered the statement that the authors only reported English results, along with details about morphology that the question did not require. At 0.15 the first passage already contained the answer in 177 tokens.

## Giving loose and strict matches the same reading budget

After seeing the four-neighbour results, we gave both cutoffs enough surrounding chunks to fill the same 512-token ceiling, subject to the authored section and complete parser units. The renderer grows outward on both sides. Once the ceiling binds, additional context on one side can displace text on the other. Median semantic passages on the 58 sources reached 500 tokens at 0.15 and 502 at 0.55. A passage with the complete reference was now available for **85.3%** and **88.6%** of known-source questions respectively. Strict centres provided additional useful placements, even though retrieval did not consistently put them first.

The two ranking methods below use the same displayed text for each candidate at each cutoff. The **30% blend** gives that total share to the unit vectors of the immediately adjacent eligible chunks and normalises the sum with the core. The **window embedding** embeds the complete, ordered, bounded passage and uses its cosine for the semantic candidate's core score. Both keep the paragraph and section terms. Structural candidates retain their original ranking and reading windows throughout.

| Combined search | 0.15, 30% blend | 0.55, 30% blend | 0.15, window embedding | 0.55, window embedding |
|---|---:|---:|---:|---:|
| Development | 55.1 / 80.9 | 55.1 / 75.3 | 54.1 / 75.9 | 56.5 / 77.3 |
| Confirmation | 61.0 / 88.2 | 63.3 / 89.0 | 60.1 / 88.9 | 68.5 / 88.4 |
| Replication, original pools | 79.6 / 95.1 | 75.3 / 93.0 | 76.7 / 94.1 | 75.9 / 94.2 |
| Replication, all 69 sources | 74.3 / 91.0 | 70.5 / 87.1 | 72.3 / 89.5 | 72.2 / 89.9 |
| New documents, source known | 52.2 / 82.6 | 45.9 / 78.5 | 53.8 / 80.8 | 49.0 / 79.8 |
| New documents, all 58 sources | 37.6 / 68.5 | 34.6 / 62.8 | 38.7 / 67.7 | 34.4 / 68.2 |

On the newer shared search, ranking the 0.55 candidates by their core while displaying the full budget gave **35.0 / 62.2**. Re-embedding the entire window gave **34.4 / 68.2**. The within-five gain at the same cutoff and display was +6.1 points (95% interval +1.9 to +10.6). At 0.15 the same change gave **37.3 / 66.6 → 38.7 / 67.7**. Comparing 0.55 directly with 0.15 under whole-window embedding, the strict setting lost 4.3 points first (−7.2 to −1.3) and gained 0.5 within five (−1.7 to +3.0). The first results averaged 429 and 425 tokens respectively. Whole-window embedding also moved first-hit accuracy in the opposite direction on the 807-question confirmation set.

The radius experiment added 72 configurations per search condition, and the fixed-budget follow-up added 40, including overlapping controls. The latter also tested a 50/50 core/window vector blend and a 30% blend of all contributing chunks with weights decreasing with distance. These are exploratory measurements on reused benchmarks. The direct neighbour-weight comparisons hold the number of candidates fixed within each cutoff. Across cutoffs, both the number and placement of search candidates change. This study did not isolate search-centre density with a matched-count nonsemantic sliding-window index.

## Using the strict match to rank a structural passage

For each structural core, find the highest-scoring semantic core wholly contained in it. Use half the structural retrieval score and half that child's retrieval score. A structural core with no eligible child keeps its own score. The candidate list and returned passages are fixed across semantic cutoffs. Development selected a 0.75 cutoff and a fresh embedding of the child's literal one-neighbour window as its core retrieval key. The child still uses its best contained paragraph and eligible enclosing section when present.

| Search | Independently tuned blocks | Existing combined, 0.15 | Parent, child at 0.15 with context | Parent, child at 0.75 alone | Parent, child at 0.75 with context |
|---|---:|---:|---:|---:|---:|
| Development, 758 questions | 54.7 / 82.2 | 55.2 / 79.9 | 49.8 / 77.1 | 51.8 / 76.6 | 57.2 / 80.7 |
| Confirmation, 807 questions | 61.1 / 88.6 | 62.2 / 89.8 | 63.2 / 90.2 | 57.6 / 89.7 | 61.7 / 90.3 |
| Replication, original pools | 71.0 / 93.4 | 77.9 / 92.2 | 76.8 / 93.3 | 69.4 / 90.0 | 74.8 / 91.6 |
| Replication, all 69 sources | 66.0 / 88.8 | 73.2 / 88.3 | 72.1 / 88.3 | 65.5 / 84.1 | 71.4 / 86.9 |
| New documents, source known | 54.3 / 82.7 | 52.9 / 79.5 | 52.1 / 79.1 | 47.1 / 80.9 | 54.1 / 83.6 |
| New documents, all 58 sources | 39.0 / 67.4 | 37.3 / 66.7 | 36.7 / 66.9 | 34.1 / 65.3 | 38.0 / 68.3 |

Jointly embedding the strict child and its surrounding text improved both endpoints in every row against the same parent and bare child. The **cutoff** comparison was mixed. Relative to an equally contextualized 0.15 child, the 0.75 child gained 4.5 points within five on the newer known-source search (95% interval +1.5 to +7.9) and lost 1.7 points on the original replication. In the newer shared search, the strict parent approach gained 0.8 points within five against tuned blocks and lost 1.0 point first. The respective intervals were −2.5 to +4.0 and −5.5 to +3.7. Its first-hit citation F1 was 20.1% versus 17.4% for tuned blocks, on mean first passages of 418 and 434 tokens.

## Search and verification

The data comprise 267 documents and 2,517 evaluation questions across four sets. Development and the earlier confirmation and replication include fiction, meetings, research papers, finance, software FAQs, government documents and board minutes. The 58 newer sources comprise 24 stories, 24 papers and 10 meetings. Known-source and shared retrieval reuse the questions within a set. These corpora have been used in earlier experiments. [Dataset and citation review](2026-11-27-paragraph-ranking.md)

The hierarchical experiment used 11 split cutoffs from 0 through 0.75. It tested normalised vector mixtures of adjacent chunks, nearest visible sentences and just the displayed portion of each neighbour. Further variants allowed section crossings for ranking, chose the better side for the query, retained the original core as a second key, gave short cores more context, or increased the weight when the two neighbours resembled each other more than either resembled the core. The re-embedding variants used the literal ordered window, a mixture of that vector with the core, and a mixture of the core, neighbours and window. In the direct index the structural score was fixed. In the parent experiment the candidate passages and their displayed text were fixed. Earlier experiments also tested rejoining interrupted topics, selecting display text per query, and choosing enclosed paragraph or sentence keys. [Complete protocol](../neighbor-threshold-protocol.json) · [Interrupted-topic and reader experiments](2026-11-27-context-mixtures.md)

Both layouts kept the 256-token upper structural limit and 512-token displayed ceiling. Structural cores used a 256-token target and semantic cores could grow to 512. The incumbent scoring gave equal shares to the core and its best contained paragraph. An eligible enclosing section received 15% of the score. Evaluation kept the production 75% overlap suppression and used a single encoder, `text-embedding-3-small`, at 1,536 dimensions. Development screened 882 profiles, including the structural controls, and froze choices before validation. Validation tested 215 profiles per search condition, including fixed comparisons at each cutoff. Paired 95% intervals use 3,000 source-level resamples within domains. Explicit vector construction checked 3,135 cosine calculations across all seven domains, with maximum absolute error below 5 × 10⁻¹⁶. The three incumbent layouts reproduced the archived ordered top-five citations throughout.

Start from the [prepared paragraph-ranking corpora and cached encodings](2026-11-27-paragraph-ranking.md). Run the commands from the repository root in the existing NumPy benchmark environment. The index builder reuses saved embeddings and requests missing vectors for the literal passages. The Python scorer compares the whole candidate pool, includes every tie at each search boundary, and expands the candidates considered until it finds five distinct passages or exhausts the pool.

```sh
node benchmarks/neighbor-threshold-index.mjs
node benchmarks/neighbor-threshold-index.mjs --windows
node benchmarks/neighbor-threshold-index.mjs --budget
python benchmarks/neighbor-threshold.py development confirmation fresh shared-fresh holdout shared-holdout
python benchmarks/neighbor-threshold.py --windows development confirmation fresh shared-fresh holdout shared-holdout
python benchmarks/neighbor-threshold.py --budget development confirmation fresh shared-fresh holdout shared-holdout
python benchmarks/neighbor-threshold.py --windows --budget verify publish
```
