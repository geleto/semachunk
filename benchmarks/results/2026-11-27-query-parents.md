# How a question finds its chunk

The experiment used 2,049 primary questions from 209 documents across fiction, spoken meetings, research papers, government guidance, finance, board minutes and software documentation. The reviewed replication fold contains 484 questions from 69 documents. Each domain contributes equally to evidence rates. Search-agreement percentages count individual queries. The model was `text-embedding-3-small` with 1,536 dimensions. The three folds have been examined in prior studies. All citations and displayed passages retain their original source spans. [Numerical results and paired intervals](2026-11-27-query-parents.json)

## Index once, search twice, return the passage

Store the vector of each complete chunk and the vectors of the complete parser units it contains. A unit is usually a sentence in prose. Some Markdown units are code or other indivisible content. Keep a link from each unit to its owning chunk or chunks. A chunk without a complete unit uses its own vector for the sentence score. The query needs one embedding, computed with the same model.

1. Search the chunk vectors and search the unit vectors with that query. Both searches use the same document and access filters.
2. Combine the chunk IDs from the first search with the parent IDs from the second. A chunk can enter through either search.
3. For each candidate chunk, take the maximum question cosine over all its contained units. Average that maximum with its question-to-chunk cosine. The sentence that maximizes this score can change with the question.
4. Return the highest-scoring chunks. The result can include the source spans of the matching sentence and neighboring text. Display expansion is a separate choice.

The original benchmark scored every eligible chunk and every complete unit in the evaluation pool. The follow-up ran two real SQLite vector queries, looked up the candidate parents' member vectors and recomputed their scores. A second implementation indexed only chunks globally for the first search and reranked those candidates with their sentences. Both used identical embeddings and memberships. The table below compares the candidates' results with exhaustive scoring. [SQLite vector search](https://alexgarcia.xyz/sqlite-vec/features/knn.html)

For “Did they use The Onion as their dataset?”, the paper contained 51 structural chunks and 278 eligible units. The methods chunk ranked eighth by whole-chunk cosine (.392). Its answer sentence ranked first among all 278 units (.526). Their mean (.459) beat the general corpus-description chunk (.420 whole, .414 best sentence, .417 combined). The complete 993-character methods chunk ranked first, even with a five-hit shortlist from each search. [Question and source evidence](2026-11-27-scope-weights-examples.json)

Pooling all 69 replication documents puts the same methods chunk at rank 14 in the chunk index and rank one in the unit index. The following percentages count how often reranking recovered all five parent IDs selected by exhaustive 50/50 scoring. Rows refer to the same 484 questions. Each entry gives the size of the candidate search **per index**, before deduplicating parent IDs.

| Formation | Chunk / unit rows | 10 chunk hits only | 10 chunk + 10 unit hits | 20 chunk + 20 unit hits |
|---|---:|---:|---:|---:|
| Blocks, 256 tokens | 1,886 / 14,295 | 62.2% | 99.6% | 100% |
| Flat semantic, .25 | 3,220 / 14,327 | 64.7% | 99.8% | 100% |
| Hierarchical semantic, .25 | 4,107 / 14,327 | 70.0% | 100% | 100% |
| Flat semantic, .55 | 12,456 / 14,327 | 98.3% | 100% | 100% |

The 20+20 search for structural blocks reranked an average of 24.9 distinct parents and looked up 211 contained unit vectors. For hierarchical .25 it reranked 24.5 parents and looked up 177 units. The application can do this with two searches and membership lookups. SQLite performed exact nearest-vector searches internally. A deployment using an approximate index has an additional source of retrieval error. These measurements establish candidate agreement on this pool and do not measure production latency.

## Chunk formation, ranking and delivery

“Complete first” means the first returned passage contains all cited evidence for an accepted answer. “Complete in five” allows the union of the first five results. “Available” means at least one passage in the entire candidate pool contains a complete accepted citation. A ranking method can never exceed that availability for its first result. All display comparisons use complete passages.

The following replication results used the same display policy for every ranker, with up to one adjacent chunk on each side. Similarity cutoffs of .25 and .55 applied to uncapped semantic chunks. Each cell gives complete first / complete in five.

| Chunk formation | Whole chunk cosine | Best contained unit alone | 50/50 whole and best unit | Evidence available in one window |
|---|---:|---:|---:|---:|
| Structural blocks, 256 tokens | 71.2 / 95.1% | 70.4 / 90.6% | 71.4 / 93.1% | 98.6% |
| Flat semantic, .25 | 60.5 / 87.7% | 59.1 / 92.1% | 65.3 / 92.5% | 93.2% |
| Hierarchical semantic-blocks, .25 | 50.6 / 86.5% | 60.1 / 89.0% | 57.4 / 88.8% | 92.4% |
| Flat semantic, .55 | 42.4 / 69.5% | 44.6 / 69.0% | 45.7 / 69.2% | 85.8% |

The earlier development sweep picked 50/50 for first-hit coverage for structural blocks, flat semantic and hierarchical semantic. For top five it chose 50/50 for blocks and flat semantic. For hierarchical semantic it chose the larger of the query-to-core and query-to-re-embedded-window cosines, with heavily overlapping results suppressed. The choices were made on the development fold. Replication changed the ordering of several rankers. [Development selections](2026-11-27-context-mixtures-selections.json)

The structural chunker descends through sections, paragraphs and sentences until children fit the 256-token budget. It packs consecutive siblings under the same parent and falls back to splitting a single oversized leaf if necessary. Both structural and semantic whole-core vectors embed the actual passage text. The earlier direct test of semantic boundary placement used two rotations of semantic group lengths with exactly the same sentence order, group count and multiset of lengths in parser units. At .40, embedding and returning the bare core gave 38.7% complete first for the semantic cuts versus 27.2% for the relocated cuts. With sentence-aware retrieval and neighboring chunks, those rates converged to 51.5% and 51.6%. This comparison used the earlier frozen citations. [Hierarchy traversal](../../src/hierarchy.js) · [Matched-boundary study](2026-11-27-context-mixtures-matched-boundaries.json)

Five replication domains had at least four questions with single-unit evidence and four requiring multiple units. These were papers, government, finance, boards and software. For the 44 questions whose accepted citation fit in one parser unit, flat semantic .25 achieved 79.0% complete first, hierarchical .25 achieved 74.2% and blocks achieved 68.4%. For the 56 requiring multiple units the same rates were 66.9%, 61.6% and 80.7%. These are equal-domain rates on small exploratory subsets. They support the possibility that sentence coherence helps a precise fact while a wider grouping can better represent a relation, an exception or an answer with several parts.

## Comparing re-embedding with adding vectors

The additive method embeds the complete core text and assigns 36% total weight to the mean of the available left and right neighbor vectors before normalization. The joint method embeds the actual left, core and right text in order. The three-vector method assigns 49% to the core, 21% to the neighbor mean and 30% to the joint vector. The weights come from the earlier development study. Within each row all methods return exactly the same text for any given center. The ranking determines which center wins.

| Cores and displayed neighbors | Add vectors | Re-embed full text | Three-vector blend |
|---|---:|---:|---:|
| Flat .55, one **sentence** per side | 50.8 / 66.7% | 44.8 / 69.2% | 48.0 / 64.9% |
| Flat .25, one **chunk** per side | 59.0 / 87.0% | 53.5 / 84.9% | 60.1 / 87.2% |
| Hierarchical .25, one **chunk** per side | 51.6 / 84.4% | 50.1 / 75.7% | 51.2 / 81.6% |
| Structural blocks, one **chunk** per side | 72.0 / 94.6% | 61.1 / 96.2% | 70.9 / 96.0% |

For the strict semantic cores with sentence neighbors, the source-paired 95% intervals for additive minus joint were −2.3 to +14.4 points for complete first and −6.5 to +1.0 for complete in five. A plausible explanation for their different behavior is that explicit weighting keeps the center influential, whereas the joint embedding represents all of the supplied text. The experiment measures retrieval outcomes and does not identify which linguistic features the encoder used. The fixed 50/50 best-sentence score uses neither neighbor key. [Weight sweep and paired comparisons](2026-11-27-scope-weights-weights.json)

## Letting paragraph boundaries admit context

The flat .25 cores from the previous study were allowed to straddle paragraphs. With those cores and rankings fixed, clipping displayed neighbors at every paragraph gave 59.8% complete first and 83.9% in five. Allowing display to cross paragraphs whose **complete paragraph text embeddings** reached .25 gave 63.2% and 89.3%. Allowing all ordinary paragraph crossings up to a section boundary gave 64.8% and 92.3%. The only change in this comparison was which source text the user saw.

For hierarchical semantic-blocks we tested a different modification. When one existing core ends at the last parser unit of a paragraph and the next begins at the first unit of the following paragraph in the same section, the two may join. Cuts inside either paragraph survive. A run of eligible joins can span several paragraphs. Each resulting core is embedded from its actual combined text and linked to its original units. All variants below use 50/50 ranking, one neighboring chunk on each side and the same section-clipped display. Explicit headings, blank-line paragraph boundaries and citations retain their source positions. Paragraphs containing only a wrapped line depend on the input's extraction quality.

| Hierarchical formation, .25 internal cutoff | Development first / five | Earlier confirmation first / five | Reviewed replication first / five | Replication first-hit size¹ |
|---|---:|---:|---:|---:|
| Original hierarchical cores | 58.3 / 84.2% | 57.7 / 82.1% | 57.4 / 87.1% | 1,636 |
| Join paragraph edges at whole-paragraph cosine ≥ .40 | 61.5 / 85.9% | 64.0 / 85.7% | 67.4 / 91.8% | 2,034 |
| Join paragraph edges at whole-paragraph cosine ≥ .25 | 63.2 / 87.3% | 64.6 / 86.9% | 69.3 / 92.8% | 2,167 |
| Join every eligible paragraph edge within a section | 65.7 / 89.0% | 66.8 / 88.4% | 69.9 / 93.0% | 2,469 |
| Structural blocks, 256 tokens | 62.0 / 80.3% | 66.5 / 96.0% | 71.4 / 92.6% | 1,679 |

¹ Mean nonwhitespace characters in the full first passage. On replication the unconstrained paragraph joins improved the original hierarchical method by 12.5 points for complete first (source-paired 95% interval +7.1 to +20.1) and 5.9 for complete in five (+3.0 to +9.2). Against structural blocks the corresponding intervals were −8.9 to +5.5 and −3.4 to +4.9. When all 69 documents competed in one pool, structural blocks scored 66.6% / 88.9%, original hierarchical cores 53.5% / 81.7%, and the unrestricted paragraph joins 63.9% / 87.9%. Some questions in that stress test presume the identity of their source.

Among 65 replication questions that went from an incomplete first hit to a complete one after the paragraph joins, 64 already had a complete candidate lower down under the original rule. Thirteen questions changed in the opposite direction. In the PSF minutes, the motion specified the conduct policy required for conference sponsorship and a subsequent line recorded a 9–0–1 vote. Complete evidence moved from rank four to rank one. The class-specific exception to Prettier's decorator rule moved from rank two to rank one. In one paper a question about a new metric needed its description, formula and variable definitions. Its first complete candidate became available after joining.

**Holding the search score fixed isolates the effect of returning more context.** Each old semantic core belongs to one joined passage. Rank the old cores exactly as before. When one is retrieved, return the joined passage around it, with the same section-clipped neighbors as the other joined variants. For top five, keep each joined passage once, using its highest old score. The following comparison keeps these new deliverable passages identical across the last three rows.

| Ranking and delivery at ordinary paragraph boundaries | Complete first | Complete in five |
|---|---:|---:|
| Original core score and original display | 57.4% | 87.1% |
| Original core scores, deliver the joined passage | 69.1% | 91.9% |
| Mean vector of the old cores, combined with the best unit in the joined passage | 68.3% | 91.8% |
| Re-embed the joined passage, combine with its best unit | 69.9% | 93.0% |

The wider display recovered 40 of the 65 newly successful first answers with the original search scores. The re-embedded ranking recovered the remaining 25, while also losing some questions that expansion alone got right. Most of the aggregate first-hit improvement was already available by returning the wider passage around an old match. Re-embedding gave the best observed numbers on those same passages. Relative to the old scores with expanded delivery, its incremental gain was 0.8 points for complete first (paired 95% interval −0.3 to +1.7) and 1.2 for complete in five (+0.04 to +3.5). Larger passages can cost focus. At .25 the similarity-gated join retained a first-hit citation F1 of 19.1%, compared with 17.7% for unconditional joining, while costing 0.6 points of complete first.

To separate the effect of choosing a particular paragraph edge from the effect of making fewer chunks, we moved each acceptance mask by one-third and two-thirds of its eligible positions **within each section**. Each control preserved sentence order and the exact number of joins in every section. Text lengths could change. At .40, similarity-chosen locations scored 67.4% / 91.8%. The two relocated controls averaged 65.9% / 91.6%. At .55, the comparison was 63.7% / 90.3% against 61.4% / 88.5%. Similarity supplied some signal when the number of joins was constrained. For coverage, allowing all eligible paragraph crossings won on all three folds among the five tested hierarchical paragraph thresholds (no minimum, .25, .40, .55, .70). The source-paired uncertainty and first-hit lengths are available for judging the extra similarity computation. [Thresholds, matched controls, domain scores and intervals](2026-11-27-query-parents.json)

## Reproducing the comparisons

Use the mixture indexes, reviewed citations and source headings described in the earlier study. The SQLite extension is a benchmark-only dependency. Paragraph vectors and newly joined passages reuse the original model and exact-text cache. The paragraph stage requests embeddings for missing texts. Long inputs follow the existing length-safe pooling rule. The ranking and database checks run locally. [Index prerequisites](../README.md#paragraph-and-section-boundaries-and-finer-weights)

```powershell
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
python -m pip install --target benchmarks/.cache/query-parents-deps sqlite-vec==0.1.9
python benchmarks/query-parents.py query
python benchmarks/query-parents.py keys
python benchmarks/query-parents.py paragraphs
python benchmarks/query-parents.py bridge-support
python benchmarks/query-parents.py anchors
python benchmarks/query-parents.py global
python benchmarks/query-parents.py shared-bridges
python benchmarks/query-parents-report.py
```
