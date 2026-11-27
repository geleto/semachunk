# Searching structural nodes and choosing sentence boundaries

Paragraphs offered a useful middle ground between chunk-only and sentence-level search. Semantic boundaries helped most when the search had to return the core it matched. Preserving a reader's access to nearby text changed which boundary placements were best. All primary comparisons used 2,049 questions from 209 full source documents across seven domains. The development, earlier confirmation and reviewed replication sets contain 758, 807 and 484 questions. All were used in earlier studies. The separate Markdown list probes use new sources and questions. [Results by fold, domain and index size](2026-11-27-hierarchy-probes.json)

## What goes into the index

One query vector can search full chunks, sentences, paragraphs, headings, lists, list items and sections. A node supplies evidence to a candidate chunk when all of its visible source spans lie inside the chunk. The intermediate-node tests require a strict subspan, so a wrapper covering the whole chunk cannot give it a second vote. Identical text can use one stored vector and several links to locations and parents. For the all-level score, half the weight goes to the chunk's query cosine and half to the highest cosine among its contained nodes. The fallback is the chunk score. A section larger than a chunk can serve as a navigation result or a separate ranking signal. We also tested a 15% contribution from the nearest enclosing authored section, excluding the whole-document scope.

The table uses 256-token structural blocks and the 69 full replication documents. All rankers returned the same complete passage for a given center, including neighboring chunks up to the section boundary. Coverage rates give each domain equal weight. Complete in five allows evidence from the union of five passages. Vector counts deduplicate exact embedding inputs across documents and hierarchy levels. Storage is the float32 vector payload at 1,536 dimensions. Database indexes, identifiers, source text and location links add overhead.

| Searchable text in addition to chunks | Distinct vectors including chunks | Vector MiB | Complete first | Complete in five |
|---|---:|---:|---:|---:|
| Chunk text alone | 1,886 | 11.1 | 69.8% | 94.1% |
| Contained paragraphs | 6,505 | 38.1 | 75.8% | 94.5% |
| All intermediate structural nodes, excluding the separate leaf index | 6,934 | 40.6 | 74.8% | 95.0% |
| Broadest contained nodes plus uncovered leaves | 10,265 | 60.1 | 73.5% | 92.8% |
| Contained sentence or atomic parser units | 15,189 | 89.0 | 71.4% | 92.6% |
| All intermediate nodes and leaves | 18,197 | 106.6 | 73.6% | 92.3% |

The paragraph index represents about 593,000 source tokens, the sentence index 694,000 and the full hierarchy 904,000, including the chunks in each case. Encoding work and stored vector counts grow at different rates. In workflow terms a segmentation pass may already have computed a node embedding. Reusing it avoids an encoder call. Serving it as a searchable key still requires storage and a link to the chunk.

The average depends on the workload. Of 484 replication questions, 371 are about fiction. Giving each question equal weight yielded 72.9% complete first with sentence keys and 69.0% with paragraph keys. Fiction alone gained 15 first answers and lost 39 when switching from sentences to paragraphs. Paragraph keys gained two software answers and two spoken-meeting answers, among others. On development, paragraph versus sentence keys gave 61.1% versus 62.0% complete first for blocks. On earlier confirmation they gave 68.6% versus 66.5%. The vector-footprint difference persists across workloads.

The first-hit advantage of paragraphs over sentences on domain-balanced replication was 4.3 points, with a source-paired 95% bootstrap interval of −1.0 to +9.9. Moving the paragraph keys to different parents inside the same document, while keeping the number of keys per parent fixed, dropped first-hit coverage to 30.8%. Intermediate-node evidence depends on attaching the match to the right location. Related research on multilevel retrieval includes RAPTOR, whose upper nodes contain generated summaries. Here the upper nodes use existing source text and source spans. [RAPTOR](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8a2acd174940dbca361a6398a4f9df91-Abstract-Conference.html)

For semantic-blocks with the earlier within-section paragraph join, the all-level score gave 72.6% complete first and 94.6% in five on replication, compared with 69.9% and 93.0% using sentences. On development the corresponding first-hit rates were 67.6% and 65.7%, and on earlier confirmation they were 66.0% and 66.8%. The earlier study also showed that the majority of the gain over unjoined semantic-blocks was already available by returning a wider passage around the original match. [Passage-expansion controls](2026-11-27-query-parents.md)

## Random cuts specifically at sentence ends

We used two controls with three fixed seeds per document. The **within-paragraph** control kept the original number of cuts in each paragraph, permuting their positions among eligible sentence-end gaps inside it. Every cut outside those gaps stayed fixed, including transitions between paragraphs and sections. Some short paragraphs have only one possible layout. The **shuffled-length** control kept the document's exact multiset of chunk lengths in parser units and shuffled their order before laying them back on the original text. This also preserves chunk count and source order, while allowing different paragraph and section crossings. Code and other atomic parser units stay whole. All randomized cores were embedded from their actual complete text.

| Replication complete first | Original boundaries | Random inside each paragraph | Shuffled lengths across document |
|---|---:|---:|---:|
| Flat semantic .40, rank and return bare core | 38.7% | 35.6% | 28.3% |
| Hierarchical semantic .25, rank and return bare core | 43.2% | 41.9% | 33.5% |
| Hierarchical .25 with paragraph joins, rank and return bare core | 47.6% | 46.3% | 39.0% |
| Hierarchical .25 with paragraph joins, best sentence and section-clipped neighbors | 69.9% | 70.7% | 70.0% |

These controls make different comparisons. The within-paragraph difference measures the additional value of locating a cut using semantic similarity once paragraph placement and cut counts are already given. The document-wide control can lose useful structure as well. Once a sentence can independently retrieve its parent and context can cross the cut, a misplaced boundary may have little cost. Conversely, it can bring a needed qualification into the returned passage.

For joined semantic-blocks the three within-paragraph trials moved 753, 773 and 753 of the 2,032 replication cuts, affecting 64 of 69 documents in at least one trial. For bare-core ranking the 1.3-point original-minus-control difference had a source-paired 95% interval of −4.2 to +6.7. With the best sentence and neighboring context the difference was −0.8 points (−3.6 to +1.9). These measurements give limited support to choosing the precise location of every within-paragraph cut by cosine.

Two additional boundary scorers kept the same cut count per paragraph. One compared the mean vectors of up to three sentences on each side. The other compared that cross-boundary similarity with the mean adjacent-sentence similarity inside the two sides. Both used complete legal sentence gaps. With joined hierarchical cores, the original rule gave 69.9% first-hit coverage on replication, the window rule 70.3% and the relative-drop rule 72.1%. For bare-core search the same three scored 47.6%, 46.9% and 46.9%. These are experiments in boundary placement. A deployment would still need a rule for the number of cuts. The idea of identifying topic shifts from changes in local cohesion has a precedent in TextTiling. [Hearst, 1997](https://aclanthology.org/J97-1003/)

## Which structural boundaries to cross

The previous paragraph experiment logically joined the tail of one paragraph and the head of the next when a semantic cut coincided with their shared boundary. Both paragraphs remained intact in the source tree. Keeping every eligible same-section join improved answer coverage more consistently than imposing a whole-paragraph cosine threshold. The operations investigated here act on retrieval passages as well. [Paragraph comparisons](2026-11-27-query-parents.md)

The implementation already distinguishes several node roles. The semantic merger compares eligible sibling texts with one cosine rule and propagates a cut up the tree. Markdown parsing and rendering separately handle headings, list items, continuation markers, fenced code, tables and omitted nodes. Markdown can attach adjacent headings to the first body unit that fits. The normalized text and HTML trees expose fewer explicit roles. The separate JSON path protects the top-level array's record boundaries and builds JSON pointers. A parser pass can record parenthood, section paths and the relationship between an introduction and its list. A retrieval passage can then include several nodes while preserving the original offsets and the identity of each item or record. [Semantic merger](../../src/semantic-blocks.js) · [Markdown renderer](../../src/markdown-units.js) · [Text and HTML trees](../../src/sentences.js) · [JSON records](../../src/json-records.js)

On replication, allowing joins at transitions between different Markdown body types in the original semantic layout exposed 32 boundaries in only two documents. It lifted domain-balanced complete first from 57.4% to 58.8% and left complete in five at 87.1% with sentence-aware ranking. After the paragraph join there were no additional boundaries eligible for this rule, nor any remaining eligible adjacent list-item pairs. Several structured HTML containers do not expose a specific list-item role through the normalized tree. This limits what the primary set establishes about lists.

We also allowed a passage to cross from one explicitly identified section into the next sibling section. Incoming and outgoing context around each resulting core was clipped to the section at each end. With all contained levels searchable this moved replication from 72.6% / 94.6% complete first / five to 70.4% / 95.9%. Mean first-passage length grew from 2,517 to 3,074 nonwhitespace characters and first-passage citation F1 fell from 18.4% to 13.2%. A cross-section passage needs to preserve both source paths for citation.

### Lists, introductions and headings

The separate probe used the complete pinned npm clean-install manual, GitHub's open-source contribution guide and Contributor Covenant 2.1. The three documents supplied 21 lists and 87 direct items. Twelve manually authored questions and their evidence lines were recorded before ranking. They cover individual items, facts in several items, headings or lead-ins, and control passages in ordinary prose. All three documents competed in the same search. A lead-in could be an immediately preceding heading in the same section or a paragraph ending in a colon. Each candidate returned a complete source span.

| Search and return policy | Complete first | Complete in five | Average first passage¹ |
|---|---:|---:|---:|
| Find an item and return the item | 5/12 | 8/12 | 144 |
| Find an item and return its list | 8/12 | 9/12 | 326 |
| Embed and return the whole list | 7/12 | 9/12 | 324 |
| Find an item and return its list with the lead-in | 9/12 | 11/12 | 347 |
| Embed and return the list with the lead-in | 7/12 | 11/12 | 359 |

¹ Nonwhitespace characters. For example, matching a bullet in the contribution guide and returning its heading identifies which contributor interest the suggestions belong to. In the Covenant, adjacent lists give examples of encouraged and unacceptable behavior. Their similar subject matter makes the lead-in especially important. This is a small targeted diagnostic with three sources and hand-authored queries. The primary benchmark rates above exclude these questions. [Probe results](2026-11-27-hierarchy-list-probes.json) · [Pinned sources and annotations](../hierarchy-list-probes.json)

## Where a semantic method could win

Development selected a ranking using both sentences and paragraphs for first hits in both the structural and joined semantic families. Applying those selections to earlier confirmation gave 65.5% for structural and 65.4% for semantic. On reviewed replication they scored 75.3% and 72.1%. For complete in five, development selected paragraph keys for structural blocks and the cross-section variant with all keys for semantic. Those reached 95.6% and 89.4% on earlier confirmation, then 94.5% and 95.9% on replication. This change of ordering is a reason to test on new sources before picking a default.

The simpler paragraph-key structural index and the joined all-level semantic index found complementary first answers. On replication, 11.4% of questions on a domain-balanced basis had a complete first answer from the structural layout alone, and 8.2% from the semantic layout alone. A hypothetical selector given the answer labels would reach 84.0%. That is a ceiling for choosing between these particular first hits.

We also tested a selector that can actually run. Search both layouts, score every candidate using its whole text and its highest-scoring contained node, and keep distinct results by suppressing later passages whose overlap covers at least 75% of the smaller passage in the same source. On replication this gave **76.8% complete first and 95.4% complete in five**. Its mean first-hit length was 1,840 nonwhitespace characters. With the same rule, structural candidates alone gave 73.6% / 92.7%, and joined semantic candidates alone 72.6% / 93.8%. Across one shared pool of all 69 documents the combined results were 73.3% / 91.6%. Some questions in that pool implicitly identify a particular source. On earlier confirmation the combination reached 64.8% / 90.1%, while structural blocks using only paragraph keys with the same overlap suppression reached 68.6% / 90.9%.

The next discriminating experiment is to keep the searchable match and its possible returned parent linked in the original tree. Compare always returning the matching block, always expanding by the structural relationship, and expanding only when the query favors the containing paragraph, introduction-plus-list or section. All approaches can expose exactly which text supports each citation. Choose the expansion rule on development and evaluate complete evidence, passage focus and vector footprint on previously unseen documents. This tests whether semantics can choose the right reading unit for the question beyond what the structural baseline already provides.

## Reproduction

Use the reviewed source, mixture-vector and paragraph-join caches from the preceding study. The index builder reuses exact embeddings and calls the same encoder for missing text. Long inputs use complete token-weighted pooling. The experiments preserve all returned text and citation offsets. Policies and sources are inspectable in the benchmark code. [Prerequisites](2026-11-27-query-parents.md#reproducing-the-comparisons)

```powershell
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
python benchmarks/hierarchy-probes.py study --jobs 3
python benchmarks/hierarchy-probes.py global
node benchmarks/hierarchy-list-probes.mjs
python benchmarks/hierarchy-probes-report.py
```
