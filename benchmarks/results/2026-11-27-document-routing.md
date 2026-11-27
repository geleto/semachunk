# Searching paragraphs, sections and whole documents

The original two-layout result used structural chunks capped at 256 tokens and uncapped semantic chunks with a 0.25 similarity cutoff. The latter rejoined cuts between paragraphs inside the same section. Both layouts contributed candidate passages. Separately, each chunk received half its score from its own embedding and half from its best contained detail. The published 76.8% first and 95.4% within five used all available detail types, including sentences. The same candidate layouts with paragraph detail reached 75.0% and 95.3%. [Earlier experiment](2026-11-27-hierarchy-probes.md)

## Upper-level retrieval on the archived layouts

The following rates measure complete evidence in the first reading passage and in the union of the first five passages. Each of seven domains receives equal weight. Development used 758 questions and 66 sources, confirmation 807 and 74, and replication 484 and 69. The original pools either specify the document or search its collection. The shared column searches all 69 replication sources for every question. Some questions presume the reader knows the source. All are previously used benchmark splits. [All rates, domain breakdowns, vector counts and paired intervals](2026-11-27-document-routing.json)

| Keys and scoring on both layouts | Development | Confirmation | Replication | Shared 69 |
|---|---:|---:|---:|---:|
| Chunk and best paragraph | 62.8 / 84.5 | 64.9 / 89.7 | 75.0 / 95.3 | 70.8 / 91.0 |
| Also allow a contained multi-paragraph section to win the detail score | 62.8 / 84.5 | 65.0 / 89.8 | 75.0 / 95.3 | 70.8 / 91.0 |
| Give the enclosing multi-paragraph section 15% of the score | 62.2 / 83.9 | 66.7 / 89.9 | **77.0 / 95.5** | **73.0 / 91.0** |
| Give the whole document 15% of the score | 62.8 / 84.9 | 65.0 / 89.6 | 75.0 / 95.3 | 70.8 / 91.0 |

The enclosing-section score is `0.85 × (chunk + best paragraph) / 2 + 0.15 × section`, using query cosine for each term. An eligible section contains at least two paragraphs and strictly encloses the candidate. Without such a section the paragraph score stands. All variants use the same clipped neighbor windows and suppress a later same-source window overlapping at least 75% of the shorter one. Ranking considers the full pool. [Scoring implementation](../document-routing.py)

Sections added 340 distinct vectors to the 8,585-vector two-layout paragraph index. The earlier all-detail index used 19,994. The replication first-hit gain from the enclosing section was 1.94 percentage points, with a source-paired 95% bootstrap interval of 0.00 to 3.88. Papers went from 37.5% to 41.1% first and finance from 90% to 100%. Finance has ten replication questions. Fiction, spoken meetings and the other three domains held steady. The first reading passage averaged 1,787 nonwhitespace characters with section routing and 1,772 with paragraph scoring alone. The development result supports keeping the section weight configurable. [Results](2026-11-27-document-routing.json)

## Whole-document retrieval

The whole-document test used one direction per complete document. Twenty-five of the 209 sources exceeded 8,191 tokens. The longest had 29,926. The encoder embedded every token in successive windows, weighted the vectors by window token counts and normalized the sum. For shorter sources it used one embedding of the full text. Input hashes and archived vector-file checksums were verified. [Index builder](../document-routing-index.mjs) · [Length-aware encoder](../encoder.mjs)

Across all 69 replication documents, the correct source ranked first for 82.8% and within five for 94.3%, allowing audited equivalent sources. That measures source discovery. The passage task additionally requires the returned text to contain the answer. Mixing 5%, 15% or 30% whole-document similarity into passage ranking gave inconsistent results across collection tasks. With two layouts, the 30% weight moved shared first-hit coverage from 70.8% to 71.2% and five-hit coverage from 91.0% to 90.2%. A document score is constant across candidates in a single-document search. [Routing comparison](2026-11-27-document-routing.json)

## End-to-end public API on the original inputs

The independent run started with the original strings, called `chunkDocument`, built `createDocumentIndex`, searched every candidate and scored the actual source citations in `hit.context`. It used the same encoder and questions as the archived study. It also queried the public whole-document index directly, which reproduced the 82.8% / 94.3% source-discovery result. [Public API run and per-domain results](2026-11-27-document-api.json)

| Layout and retrieval keys | Original pools first / five | Shared 69 first / five | Unique indexed texts |
|---|---:|---:|---:|
| Blocks and paragraphs | 75.8 / 93.2 | 70.8 / 89.4 | 6,471 |
| Semantic and paragraphs | 59.1 / 85.7 | 55.5 / 79.8 | 7,457 |
| Semantic with paragraph-edge joins and paragraphs | 68.0 / 91.9 | 63.5 / 85.7 | 6,025 |
| Blocks and joined semantic, paragraph scoring | 75.0 / 95.3 | 70.8 / 91.0 | 8,546 |
| Both layouts, paragraph scoring plus 15% parser-detected section | 75.5 / 95.5 | 71.3 / 91.0 | 8,773 |
| Both layouts, 15% section score with source-supplied ranges where available | **77.0 / 95.5** | **73.0 / 91.0** | **8,906** |

Paragraph-edge joins reduced the semantic layout from 4,107 candidates to 2,114 across the 69 documents. On its own, the joined semantic layout delivered first passages averaging 3,109 nonwhitespace characters. Combining it with blocks and section scoring brought this to 1,875, with evidence F1 of 18.0%. Searching blocks alone yielded 1,811 characters and 17.0% F1. The public API's two-layout paragraph scores reproduced the archived scores on both pools. The raw source added 227 distinct section keys. [Public API measurements](2026-11-27-document-api.json)

The entire 1.43-point first-hit difference between 75.5% on raw input and 77.0% on archived structure came from one of the ten finance questions. It asks which two headwinds would make it hard to repeat Berkshire's 1977 percentage return. The raw text has a standalone “Insurance Underwriting” title with its formatting stripped. In the archived hierarchy its section score demoted a competing passage about insurance mistakes. The introductory passage forecasting next year's return then ranked first, using its chunk and paragraph score. Both runs scored the other six domains identically on the replication first-hit metric. [Source outline audit](2026-11-27-scope-weights.md) · [Archived scores by domain](2026-11-27-document-routing.json)

We also restored explicit heading marks before parsing all 19 flattened replication sources for which the earlier source audit supplied an outline. This changed both candidate boundaries and neighbor windows. Finance recovered to 100% first, while government pages fell from 85.7% to 42.9% first. The seven-domain total fell to 70.8% / 94.5%, and shared retrieval to 66.8% / 90.0%. First-hit evidence F1 improved from 18.0% to 21.9% as the reading passages became shorter. The evaluation maps every restored heading marker out of the evidence coordinates. [Public API measurements](2026-11-27-document-api.json)

Supplying those same 19 outlines through the public `sectionRanges` option made the sections available for ranking while the parser supplied the original 4,000 candidate chunks and reading windows. This reproduced **77.0% first / 95.5% within five** in the original pools and **73.0% / 91.0%** across all 69 sources. It recovered the finance answer and retained 85.7% first on government pages. The first reading passage averaged 1,884 nonwhitespace characters, with evidence F1 of 18.2%. The index used 8,906 unique vectors, including 360 more than the chunk-and-paragraph configuration. Both layouts and the source-outline keys shared one index. Sentence keys were disabled. [Scores, index sizes and paired confidence intervals](2026-11-27-document-api.json)

## Reproduction

Use the prepared corpora, evidence references and vector indexes from the [hierarchy study](2026-11-27-hierarchy-probes.md). From the repository root, with the benchmark encoder configured and NumPy installed, run the commands below. The first command accepts optional shard names.

```sh
node benchmarks/document-routing-index.mjs
python benchmarks/document-routing.py
node --max-old-space-size=4096 benchmarks/document-api.mjs
node --max-old-space-size=4096 benchmarks/document-api.mjs --source-headings
node --max-old-space-size=4096 benchmarks/document-api.mjs --section-ranges
python benchmarks/document-api-report.py
```
