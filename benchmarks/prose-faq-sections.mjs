import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { here } from './corpora.mjs';
import { openStudySet } from './matched-count.mjs';
import { citation, dot, ranking } from './prose-evidence.mjs';
import { readJSON } from './semantic-settings-data.mjs';
import { prepareQuestions } from './semantic-settings.mjs';

// Use only the document when constructing the index. Subheadings inside an answer
// stay with their parent. The preamble and all original nonwhitespace are retained.
function sections(source, grammar) {
    const headings = fromMarkdown(source, grammar).children.filter(node => node.type === 'heading');
    assert(headings.length);
    const counts = new Map();
    for (const { depth } of headings) counts.set(depth, (counts.get(depth) ?? 0) + 1);
    const [[depth]] = [...counts].sort(([a, countA], [b, countB]) => countB - countA || a - b);
    const starts = [0, ...headings.filter(h => h.depth === depth).map(h => h.position.start.offset), source.length];
    const passages = [];
    for (let i = 1; i < starts.length; i++) {
        const raw = source.slice(starts[i - 1], starts[i]);
        const text = raw.trim();
        if (!text) continue;
        const first = starts[i - 1] + raw.indexOf(text), last = first + text.length;
        passages.push({ text, spans: [[first, last]], first, last });
    }
    return { depth, passages };
}

const results = join(here, 'results');
const manifest = await readJSON(join(results, '2026-11-27-audited-data.json'));
const { markdownGrammar } = await loadMarkdownParser();
const output = {};
for (const fold of ['development', 'confirmation']) {
    const key = 'faq-' + fold + '-reviewed', meta = manifest.sets[key];
    assert.equal(meta.pool, 'collection');
    const { docs, encoder } = await openStudySet(key, meta);
    try {
        const rows = [], documents = [];
        for (const [doc, item] of docs.entries()) {
            assert.equal(item.format, 'markdown');
            assert.equal(item.raw, item.source);
            const { depth, passages } = sections(item.source, markdownGrammar);
            documents.push({ document: item.id, headingDepth: depth, chunks: passages.length });
            for (const passage of passages) rows.push({ ...passage, doc, id: rows.length });
        }
        const qs = prepareQuestions(docs, encoder);
        const queries = {};
        const vectors = await encoder.embed(rows.map(r => r.text));
        const qvecs = await encoder.embed(qs.map(q => q.text));
        for (const [i, q] of qs.entries()) {
            const { sorted, ranks } = ranking(rows, vectors.map(v => dot(v, qvecs[i])));
            const top = sorted.slice(0, 5);
            const evidence = citation(q, rows), prefix = evidence.prefix(ranks);
            assert(Number.isFinite(prefix), q.id);
            queries[q.id] = { firstSource: docs[top[0].doc].id, firstSpan: top[0].spans[0],
                firstTokens: encoder.countTokens(top[0].text),
                fiveTokens: encoder.countTokens(top.map(r => r.text).join('\n\n')),
                completeRank: prefix, minimumPassages: evidence.minimum };
        }
        output[fold] = { dataSHA256: meta.sha256, documents, queries };
    } finally {
        encoder.close();
    }
}
await writeFile(join(results, '2026-11-27-prose-faq-sections.json'), JSON.stringify(output, null, 2) + '\n');
