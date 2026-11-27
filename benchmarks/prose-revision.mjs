import assert from 'node:assert/strict';
import { compact } from './corpora.mjs';

// Verified against the release PDFs in the source-probe experiment. Preserve the
// frozen input on disk and remap every original annotation, including table queries.
export function proseSourceEdits(doc) {
    const source = doc.source, edits = [];
    if (doc.id === 'PEPSICO_2023Q1_EARNINGS') {
        for (const [start, end] of [
            ['PURCHASE, N.Y. - April 25', 'the first quarter 2023.'],
            ['“We are very pleased', 'CEO Ramon Laguarta.'],
            ['Laguarta continued', 'in the marketplace.”'],
            ['1 Please refer to the Glossary','for additional information regarding PepsiCo’s financial results.']
        ]) {
            const a = source.indexOf(start), b = source.indexOf(end, a);
            assert(a >= 0 && b >= a && a === source.lastIndexOf(start));
            for (const m of source.slice(a, b + end.length).matchAll(/\n\s*\n/gu))
                edits.push([a + m.index, a + m.index + m[0].length]);
        }
        assert.equal(edits.length, 13);
    } else if (doc.id === 'JOHNSON_JOHNSON_2022Q4_EARNINGS') {
        for (const tail of ['increasing by 3.6%*', 'adjusted operational EPS of $10.50, reflecting growth of 3.5%*']) {
            const prefix = '\n\n### ', at = source.indexOf(prefix + tail);
            assert(at >= 0 && at === source.lastIndexOf(prefix + tail));
            edits.push([at, at + prefix.length]);
        }
    }
    return edits;
}

export function repairProseSource(doc) {
    const edits = proseSourceEdits(doc);
    if (!edits.length) return doc;
    const source = doc.source;
    const offset = p => p - edits.reduce((removed, [a,b]) => removed + Math.max(0, Math.min(b,p) - a - 1), 0);
    let repaired = source;
    for (const [a,b] of edits.toReversed()) repaired = repaired.slice(0,a) + ' ' + repaired.slice(b);
    function remap([a,b]) {
        const out = [offset(a),offset(b)];
        assert.equal(compact(source.slice(a,b)),compact(repaired.slice(...out)));
        return out;
    }
    const questions = doc.questions.map(q => ({...q, references: q.references.map(ref => ref.map(remap))}));
    return {...doc, raw: repaired, source: repaired, questions};
}
