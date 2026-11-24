import assert from 'node:assert/strict';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { markdownGrammar } from '../src/markdown.js';
import { lowerBound } from './corpora.mjs';

// Reconstruct permitted endpoints from the source, independently of the units
// and flags used by the overlap pass. A heading may prefix its first paragraph.
function paragraphBoundaries(source) {
    const starts = new Map(), ends = new Map(), headings = [];
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    const bom = Number(source.startsWith('\uFEFF'));
    let run = 0;
    for (const node of fromMarkdown(source, markdownGrammar).children) {
        const a = bom + node.position.start.offset, b = bom + node.position.end.offset;
        const line = a + 1 - node.position.start.column;
        if (node.type === 'heading') { headings.push(line); run++; continue; }
        if (node.type === 'paragraph') {
            for (const h of headings) starts.set(h, run);
            starts.set(line, run);
            for (const { index, segment } of segmenter.segment(source.slice(a, b).replace(/[\r\n]/g, ' '))) {
                starts.set(a + index, run);
                ends.set(a + index + segment.length, run);
            }
        } else run++;
        headings.length = 0;
    }
    return { starts, ends };
}

// The QMSum renderer starts exactly one turn per line.
export function meetingTurnStarts(doc) {
    return doc.turnStarts ??= [...doc.source.matchAll(/\n/g)].map(m => m.index + 1);
}

export function auditBoundaries(doc, units, cores, spans, stats, countTurns) {
    const audit = stats.boundaries ??= { expandedWindows: 0, addedUnits: 0 };
    if (countTurns) audit.windowsCrossingNewTurns ??= 0;
    for (const [i, span] of spans.entries()) {
        const core = cores[i];
        if (span === core) continue;
        const { starts, ends } = doc.paragraphBoundaries ??= paragraphBoundaries(doc.source);
        const run = starts.get(span.start);
        assert.notEqual(run, undefined);
        assert.ok(span.first <= core.first && core.last <= span.last);
        assert.equal(span.start, units[span.first].start);
        assert.equal(span.end, units[span.last].end);
        for (let j = span.first; j <= span.last; j++) {
            const unit = units[j];
            assert.equal(starts.get(unit.start), run);
            assert.equal(ends.get(unit.end), run);
            assert.equal(unit.sectionId, core.sectionId);
            assert.equal(unit.run, core.run);
            if (j > span.first) assert.match(doc.source.slice(units[j - 1].end, unit.start), /^\s*$/u);
        }
        audit.expandedWindows++;
        audit.addedUnits += core.first - span.first + span.last - core.last;
        if (countTurns) {
            const turns = meetingTurnStarts(doc);
            const inside = u => lowerBound(turns, u.end) - lowerBound(turns, u.start, true);
            if (inside(span) > inside(core)) audit.windowsCrossingNewTurns++;
        }
    }
}
