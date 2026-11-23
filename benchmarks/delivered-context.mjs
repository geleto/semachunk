import { lowerBound } from './corpora.mjs';

// Project normalized plain-text words in occurrence order. A displayed space
// can stand for a whole source whitespace run; inserted spaces have no range.
export function alignPlain(source, texts) {
    let cursor = 0;
    const spaces = /\s*/uy;
    function whitespace() {
        spaces.lastIndex = cursor;
        cursor += spaces.exec(source)[0].length;
    }
    const chunks = texts.map(text => {
        whitespace();
        const sourceRanges = [];
        for (const { 0: word, index: outputStart } of text.matchAll(/\s+|\S+/gu)) {
            const start = cursor;
            if (/\s/u.test(word[0])) whitespace();
            else {
                if (!source.startsWith(word, cursor)) throw new Error('Plain-text mapping diverged at ' + cursor);
                cursor += word.length;
            }
            if (cursor === start) continue;
            const last = sourceRanges.at(-1);
            if (cursor - start !== word.length) sourceRanges.push({ start, end: cursor, outputStart, outputLength: word.length });
            else if (last && last.outputLength === undefined && last.end === start &&
                last.outputStart + last.end - last.start === outputStart) last.end = cursor;
            else sourceRanges.push({ start, end: cursor, outputStart });
        }
        return { text, sourceRanges };
    });
    whitespace();
    if (cursor !== source.length) throw new Error('Plain-text mapping ends before the source');
    return chunks;
}

export function tokenWindows(doc, tokens, size, overlap) {
    const chunks = [];
    for (let i = 0; i < tokens.length;) {
        let j = Math.min(i + size, tokens.length);
        while (j < tokens.length && tokens[j - 1][1] > tokens[j][0]) j--;
        if (j <= i) throw new Error('Window cannot fit a complete code point.');
        const start = tokens[i][0], end = tokens[j - 1][1];
        chunks.push({ text: doc.source.slice(start, end), sourceRanges: [{ start, end, outputStart: 0 }] });
        if (j === tokens.length) break;
        i = Math.max(i + 1, j - overlap);
        while (i > 0 && tokens[i - 1][1] > tokens[i][0]) i--;
    }
    return chunks;
}

export function deliver(ranked, budget, encoder) {
    const ranges = [];
    let text = '';
    for (const p of ranked) {
        const start = text.length + (text ? 2 : 0);
        const candidate = (text ? text + '\n\n' : '') + p.text;
        let end = candidate.length;
        if (encoder.countTokens(candidate) > budget) {
            end = encoder.offsets(candidate)[budget - 1]?.[2] ?? 0;
            while (end > start && encoder.countTokens(candidate.slice(0, end)) > budget) {
                end -= /[\uDC00-\uDFFF]/.test(candidate[end - 1]) && /[\uD800-\uDBFF]/.test(candidate[end - 2]) ? 2 : 1;
            }
        }
        if (end <= start) break;
        text = candidate.slice(0, end);
        for (const r of p.sourceRanges) {
            const a = start + r.outputStart, length = r.outputLength ?? r.end - r.start;
            if (a >= end) break;
            ranges.push({ doc: p.doc, a, b: Math.min(end, a + length), from: r.start,
                to: r.outputLength === undefined ? r.start + Math.min(end - a, length) : r.end, collapsed: r.outputLength !== undefined });
        }
        if (end < candidate.length) break;
    }
    const tokens = encoder.offsets(text);
    if (tokens.length > budget) throw new Error('Serialized retrieval context exceeds its budget');
    let i = 0;
    const projected = tokens.map(([a, b]) => {
        const spans = [];
        while (i < ranges.length && ranges[i].b <= a) i++;
        for (let j = i; j < ranges.length && ranges[j].a < b; j++) {
            const r = ranges[j];
            spans.push([r.doc, r.collapsed ? r.from : r.from + Math.max(0, a - r.a),
                r.collapsed ? r.to : r.from + Math.min(b, r.b) - r.a]);
        }
        return spans;
    });
    return { text, projected };
}

// A source token can straddle an annotation edge, or multiple tokenizer
// tokens can touch the same Unicode character. Retain each annotated portion.
export function goldReference(reference, sources) {
    const tokens = new Map(), byDoc = new Map();
    for (const [d, a, b] of reference) {
        const { offsets, ends } = sources[d];
        if (a < 0 || a >= b || b > ends.at(-1)) throw new Error('Invalid gold evidence range');
        if (!byDoc.has(d)) byDoc.set(d, []);
        byDoc.get(d).push([a, b]);
        for (let i = lowerBound(ends, a, true); i < offsets.length && offsets[i][0] < b; i++) {
            const id = d + '/' + i;
            if (!tokens.has(id)) tokens.set(id, []);
            tokens.get(id).push([d, Math.max(a, offsets[i][0]), Math.min(b, offsets[i][1])]);
        }
    }
    if (!tokens.size) throw new Error('Empty gold reference');
    return { tokens: [...tokens.values()], byDoc };
}

export function evidenceScore(projected, references) {
    let best = { recall: 0, precision: 0, complete: 0 };
    for (const { tokens, byDoc } of references) {
        const seen = new Map();
        let useful = 0, hits = 0;
        for (const spans of projected) {
            let fresh = false;
            for (const [d, a, b] of spans) {
                for (const [from, to] of byDoc.get(d) ?? []) {
                    if (b <= from || a >= to) continue;
                    if (!seen.has(d)) seen.set(d, new Set());
                    const positions = seen.get(d), before = positions.size;
                    for (let i = Math.max(from, a); i < Math.min(to, b); i++) positions.add(i);
                    if (positions.size > before) fresh = true;
                }
            }
            if (fresh) useful++;
        }
        for (const portions of tokens) {
            if (portions.every(([d, a, b]) => {
                const positions = seen.get(d);
                if (!positions) return false;
                for (let i = a; i < b; i++) if (!positions.has(i)) return false;
                return true;
            })) hits++;
        }
        const recall = hits / tokens.length, precision = useful / (projected.length || 1);
        if (recall > best.recall || (recall === best.recall && precision > best.precision)) {
            best = { recall, precision, complete: Number(hits === tokens.length) };
        }
    }
    return best;
}
