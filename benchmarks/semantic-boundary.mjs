import { treeLayout } from './tree-policy.mjs';
import { directionCosine, vectorDirection } from '../src/similarity.js';

// Move an existing boundary at most once per passage. Keep the chunk count, original
// source order and both size limits. Only whole, visible siblings may change sides.
export async function adjustBoundaries(doc, limit, count, policy, embed) {
    const parents = [];
    const budget = {maxChunkSize:Infinity, fits:text => count(text) <= limit};
    const {source,rows} = await treeLayout(doc.raw,doc.format,budget,'blocks',undefined,(_s,parent,siblings) => {
        if (siblings.length >= 3 && !parent.separateChildren) parents.push({parent,siblings});
    });
    const starts = new Map(), ends = new Map(), inputs = new Map();
    rows.forEach(({text,sourceRanges},i) => {
        const [r] = sourceRanges;
        if (sourceRanges.length === 1 && !r.outputStart && text === source.slice(r.start,r.end)) {
            starts.set(r.start,i); ends.set(r.end,i);
        }
    });
    const scoreId = node => {
        const text = source.slice(node.start,node.end);
        if (!inputs.has(text)) inputs.set(text,inputs.size);
        return inputs.get(text);
    };
    const groups = [];
    for (const {parent,siblings} of parents) {
        for (let split=1; split<siblings.length; split++) {
            const row = ends.get(siblings[split-1].end);
            if (row === undefined || starts.get(siblings[split].start) !== row+1) continue;
            let first = split-1, last = split;
            const start = rows[row].sourceRanges[0].start, end = rows[row+1].sourceRanges[0].end;
            while (first > 0 && siblings[first].start > start) first--;
            while (last+1 < siblings.length && siblings[last].end < end) last++;
            if (siblings[first].start !== start || siblings[last].end !== end || last-first < 2 ||
                siblings.slice(first,last+1).some(s => s.skip || s.blocked || s.breakBefore)) continue;
            const options = [];
            for (let j=first+1; j<=last; j++) {
                const left = siblings[j-1], right = siblings[j];
                if (/\S/u.test(source.slice(left.end,right.start))) continue;
                if (policy !== 'balance' && (count(source.slice(left.start,left.end)) > limit ||
                    count(source.slice(right.start,right.end)) > limit)) continue;
                const n = count(source.slice(start,left.end)), m = count(source.slice(right.start,end));
                if (j !== split && (Math.min(n,m) < limit/2 || Math.max(n,m) > limit)) continue;
                options.push({j,balance:Math.max(n,m)});
            }
            if (options.length < 2 || !options.some(o=>o.j===split)) continue;
            if (policy !== 'balance') for (const o of options) {
                o.a = scoreId(siblings[o.j-1]); o.b = scoreId(siblings[o.j]);
            }
            groups.push({row,split,first,last,options,siblings,parent});
        }
    }
    const directions = inputs.size ? (await embed([...inputs.keys()])).map(vectorDirection) : [];
    function render(parent, nodes, first,last) {
        const start = nodes[first].start, end = nodes[last].end, owner = first === last ? nodes[first] : parent;
        return {text:source.slice(start,end),sourceRanges:[{start,end,outputStart:0}],headingPath:owner.headingPath,sectionId:owner.sectionId};
    }
    let lastEdited = -1, moved = 0;
    for (const g of groups.sort((a,b) => a.row-b.row)) {
        if (g.row <= lastEdited) continue;
        const score = o => policy === 'balance' ? o.balance : directionCosine(directions[o.a],directions[o.b]);
        const original = g.options.find(o=>o.j===g.split);
        let chosen = original, best = score(original);
        for (const o of g.options) {
            const s = score(o);
            if (s < best && (policy !== '0.3' || s < .3)) { chosen=o; best=s; }
        }
        if (chosen === original) continue;
        rows[g.row] = render(g.parent,g.siblings,g.first,chosen.j-1);
        rows[g.row+1] = render(g.parent,g.siblings,chosen.j,g.last);
        lastEdited=g.row+1; moved++;
    }
    return {rows,moved};
}
