import assert from 'node:assert/strict';

function sourceIndices(text) {
    const map = [];
    for (let i = 0; i < text.length; i++) if (!/\s/u.test(text[i])) map.push(i);
    return map;
}
export function projectPlain(source, rows) {
    const coords = sourceIndices(source), raw = source.replace(/\s/gu,'');
    let at = 0;
    return rows.map(({text}, i) => {
        const sourceRanges = [];
        for (let k = 0; k < text.length; k++) {
            if (/\s/u.test(text[k])) continue;
            assert.equal(text[k],raw[at], 'Legacy passage/source mismatch');
            const start = coords[at++], last = sourceRanges.at(-1);
            if (last && last.end === start && last.outputStart + last.end - last.start === k) last.end++;
            else sourceRanges.push({start,end:start+1,outputStart:k});
        }
        if (i + 1 === rows.length) assert.equal(at,coords.length);
        return { text,sourceRanges };
    });
}

export function scores(q, delivered) {
    const ranges = delivered.filter(r => r.doc === q.doc).map(r => [r.from,r.to]).sort((a,b) => a[0]-b[0]);
    const merged = [];
    for (const [a,b] of ranges) {
        if (merged.length && a <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(b,merged.at(-1)[1]);
        else merged.push([a,b]);
    }
    let hits = 0;
    for (const portions of q.gold.tokens) {
        if (portions.every(([,a,b]) => merged.some(([from,to]) => from <= a && b <= to))) hits++;
    }
    return [Number(hits === q.gold.tokens.length), hits/q.gold.tokens.length];
}

// Coordinates in original transcripts/articles and in parser output agree after removing whitespace.
export function ordinals(text) {
    const map = new Uint32Array(text.length + 1);
    for (let i = 0; i < text.length; i++) map[i+1] = map[i] + Number(!/\s/u.test(text[i]));
    return map;
}
export function prepareBoundaries(doc) {
    const starts = [];
    if (doc.turns) {
        let pos = 0;
        for (const [i,turn] of doc.turns.entries()) {
            if (i) starts.push(pos);
            pos += turn.length + 2;
        }
        doc.raw = doc.turns.join('\n\n');
    } else starts.push(...doc.starts);
    const ord = ordinals(doc.raw);
    doc.gold = new Set(); doc.known = new Set();
    for (const [i,start] of starts.entries()) {
        const k = ord[start], label = doc.labels ? doc.labels[i] : 1;
        if (label !== null) doc.known.add(k);
        if (label === 1) doc.gold.add(k);
    }
    assert.equal(doc.gold.size, doc.labels ? doc.labels.filter(l => l === 1).length : starts.length);
}
