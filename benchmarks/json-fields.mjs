import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chunkText } from '../src/index.js';
import { sha256 } from './corpora.mjs';
import { denseRanker } from './chunking.mjs';
import { deliver } from './delivered-context.mjs';
import { dimension, model, openEncoder } from './encoder.mjs';
import { records, queries, proseCount } from './json-field-corpus.mjs';

const source = JSON.stringify(records);
const gold = queries.map(([record, , ...answers]) => {
    const row = JSON.stringify(records[record]), start = source.indexOf(row);
    assert.ok(start >= 0 && start === source.lastIndexOf(row));
    return answers.map(answer => {
        const spelling = JSON.stringify(answer).slice(1, -1), at = row.indexOf(spelling);
        assert.ok(at >= 0, 'Missing answer: ' + answer);
        return [start + at, start + at + spelling.length];
    });
});
const encoder = openEncoder();
try {
    const layouts = {};
    for (const [name, cap] of [['intact'], ['chars973', 973], ['chars1024', 1024], ['chars1075', 1075],
        ['tokens243', 243], ['tokens256', 256], ['tokens269', 269]]) {
        // Only article strings exceed the soft target in this fixture. The length
        // counter exercises the same source-preserving cuts as a string-only fallback.
        layouts[name] = await chunkText(source, { inputFormat: 'json', maxChunkTokens: cap,
            countTokens: name.startsWith('chars') ? s => s.length : encoder.countTokens });
    }
    assert.deepEqual(layouts.intact.filter(c => c.text.length > 973).map(c => c.jsonPointer), ['/0/body', '/1/body', '/2/body']);
    const texts = [...new Set([...queries.map(q => q[1]), ...Object.values(layouts).flat().map(c => c.text)])];
    const ids = new Map(texts.map((text, i) => [text, i]));
    const { matrix, vectorsSHA256 } = await encoder.vectors(texts);
    const rank = denseRanker(matrix, dimension);
    const report = { model, dimension, sourceSHA256: sha256(source), vectorsSHA256, proseCount,
        queries: queries.map(q => q[1]), topK: 5, layouts: {} };
    for (const [name, chunks] of Object.entries(layouts)) {
        const rows = chunks.map((chunk, doc) => ({ ...chunk, doc }));
        const candidates = rows.map(c => ids.get(c.text));
        const ranks = queries.map(([, q]) => rank(ids.get(q), candidates).slice(0, report.topK).map(i => rows[i]));
        const budgets = {};
        for (const budget of [486, 512, 538]) {
            const hits = ranks.map((ranked, i) => {
                const visible = new Map();
                for (const token of deliver(ranked, budget, encoder).projected) {
                    for (const [doc, , end] of token) visible.set(doc, end);
                }
                return ranked.some(row => gold[i].every(([a, b]) => row.sourceRanges[0].start <= a && b <= visible.get(row.doc)));
            });
            budgets[budget] = { prose: hits.slice(0, proseCount).filter(Boolean).length,
                identifiers: hits.slice(proseCount).filter(Boolean).length, hits };
        }
        report.layouts[name] = { rows: rows.length, layoutSHA256: sha256(JSON.stringify(chunks)),
            indexTokens: rows.reduce((sum, c) => sum + encoder.countTokens(c.text), 0), budgets };
    }
    console.table(Object.entries(report.layouts).map(([layout, v]) => ({ layout, rows: v.rows, indexTokens: v.indexTokens,
        prose: v.budgets[512].prose, identifiers: v.budgets[512].identifiers })));
    if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
} finally {
    encoder.close();
}
