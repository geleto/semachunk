import assert from 'node:assert/strict';
import { scores } from './tree-evidence.mjs';

export function union(ranges) {
    const result = [];
    for (const [a,b] of ranges.toSorted((x,y) => x[0]-y[0])) {
        if (result.length && a <= result.at(-1)[1]) result.at(-1)[1] = Math.max(b,result.at(-1)[1]);
        else result.push([a,b]);
    }
    return result;
}

export function covers(ranges, a, b) {
    return ranges.some(([lo,hi]) => lo <= a && b <= hi);
}

// Partition only the cited characters at passage boundaries. Each elementary interval must
// be covered by any one of its owners. This also handles repeated headings and partial tokens.
export function ownerGroups(choice, rows) {
    const ranges = union(choice.ranges), owners = [];
    for (const [a,b] of ranges) {
        const spans = [];
        for (const row of rows) {
            if (row.doc !== choice.doc || row.last <= a || b <= row.first) continue;
            for (const [lo,hi] of row.spans) if (lo < b && a < hi)
                spans.push([Math.max(lo,a),Math.min(hi,b),row.id]);
        }
        const cuts = [...new Set([a,b,...spans.flatMap(([lo,hi]) => [lo,hi])])].sort((x,y) => x-y);
        for (let i=1; i<cuts.length; i++) {
            const ids = spans.filter(([lo,hi]) => lo <= cuts[i-1] && cuts[i] <= hi).map(s => s[2]);
            owners.push(ids);
        }
    }
    return [...new Map(owners.map(ids => [ids.join(','),ids])).values()];
}

function minimumCover(groups) {
    if (groups.some(g => !g.length)) return Infinity;
    // Satisfying a subset also satisfies its supersets.
    const minimal = [];
    for (const g of groups.toSorted((a,b) => a.length-b.length)) {
        if (!minimal.some(s => s.every(id => g.includes(id)))) minimal.push(g);
    }
    function solve(left) {
        if (!left.length) return 0;
        return 1 + Math.min(...left[0].map(id => solve(left.filter(g => !g.includes(id)))));
    }
    return solve(minimal);
}

export function citation(q, rows) {
    const refs = q.choices.map(choice => ownerGroups(choice,rows));
    const minimum = Math.min(...refs.map(minimumCover));
    const any = new Set(refs.flat(2));
    const full = new Set(refs.flatMap(ref => ref[0].filter(id => ref.every(g => g.includes(id)))));
    const fraction = hits => Math.max(...q.choices.map(choice => scores(choice,
        hits.flatMap(row => row.spans.map(([from,to]) => ({doc:row.doc,from,to}))))[1]));
    const prefix = ranks => Math.min(...refs.map(ref => Math.max(...ref.map(group =>
        group.reduce((best,id) => Math.min(best,ranks.get(id)),Infinity)))));
    assert(minimum >= 1);
    return {refs,minimum,any,full,fraction,prefix};
}

export function dot(a,b) {
    let result = 0;
    for (let i=0; i<a.length; i++) result += a[i]*b[i];
    return Math.fround(result);
}

export function ranking(rows, similarities) {
    const sorted = rows.toSorted((a,b) => similarities[b.id]-similarities[a.id]);
    return {sorted, ranks:new Map(sorted.map((r,i) => [r.id,i+1]))};
}
