import assert from 'node:assert/strict';
import {sliceView} from '../src/citations.js';

function lowerBound(array, value, position) {
    let lo=0, hi=array.length;
    while (lo<hi) {
        const mid=Math.floor((lo+hi)/2);
        if (position(array[mid])<value) lo=mid+1; else hi=mid;
    }
    return lo;
}

function closest(array, value, position) {
    const j=lowerBound(array,value,position);
    if (!j) return 0;
    if (j===array.length || value-position(array[j-1])<=position(array[j])-value) return j-1;
    return j;
}

// Both treatments select from the same immutable passages. Coordinates in the
// parser's root view retain the original citations, including decoded HTML.
export function placementLattice(doc, layouts, bank, keyFor, viewFor) {
    const root=doc.nodes[0], refs=root.citations;
    for (let j=1;j<refs.length;j++) assert.ok(refs[j-1].end<=refs[j].start);
    const offsets=bank.offsets(root.text);
    function inRoot(raw) {
        const j=lowerBound(refs,raw+1,r=>r.end);
        if (j===refs.length) return root.text.length;
        const r=refs[j];
        if (raw<=r.start) return r.outputStart;
        return r.outputEnd-r.outputStart===r.end-r.start ? r.outputStart+raw-r.start : r.outputStart;
    }
    const tokenAt=offset=>lowerBound(offsets,offset+1,p=>p[1]);
    const cuts=new Set([0,root.text.length]), events=new Map();
    const parents=new Set(doc.nodes.filter(n=>!n.retrievalOnly).map(n=>n.parentId));
    function event(at,id,open) {
        cuts.add(at);
        if (!events.has(at)) events.set(at,[]);
        events.get(at).push([id,open]);
    }
    for (const node of doc.nodes) {
        if (!node.id || node.retrievalOnly || !node.citations.length) continue;
        const a=inRoot(node.citations[0].start), b=inRoot(node.citations.at(-1).end);
        if (!parents.has(node.id)) cuts.add(a);
        if (a<b && (node.type==='section'||node.type==='article'||node.type==='record'||node.record)) {
            event(a,node.id,true); event(b,node.id,false);
        }
    }
    for (const c of doc.chunks) if (c.citations.length) cuts.add(inRoot(c.citations[0].start));
    function atom(start,end,scope) {
        const s=root.text.slice(start,end);
        if (!s.trim()) return;
        const a=start+s.length-s.trimStart().length, b=start+s.trimEnd().length;
        const ta=tokenAt(a), tb=tokenAt(b-1)+1;
        return {a,b,ta,tb,mid:(ta+tb)/2,scope};
    }
    const ordered=[...cuts].sort((a,b)=>a-b), active=new Set(), atoms=[];
    let run=-1, lastOwner=-1, longPieces=0;
    for (let i=0;i+1<ordered.length;i++) {
        const a=ordered[i], b=ordered[i+1];
        for (const [id,open] of events.get(a)??[]) {
            if (open) active.add(id); else active.delete(id);
        }
        const owner=active.size ? Math.max(...active) : 0;
        if (owner!==lastOwner) {run++; lastOwner=owner;}
        const part=atom(a,b,run);
        if (!part) continue;
        if (bank.countTokens(root.text.slice(part.a,part.b))<=256) {
            atoms.push(part);
            continue;
        }
        // Fallback for a long indivisible parser leaf, independent of the semantic cuts.
        let start=part.a;
        for (let k=part.ta+128;k<part.tb;k+=128) {
            const end=offsets[k][0], piece=atom(start,end,run);
            if (piece) atoms.push(piece);
            start=end;
            longPieces++;
        }
        const tail=atom(start,part.b,run);
        if (tail) atoms.push(tail);
    }
    assert.ok(atoms.length);
    const byRun=Map.groupBy(atoms,a=>a.scope), targets={}, requested=new Map();
    for (const [label,entries] of Object.entries(layouts)) {
        if (label==='blocks'||label==='tuned') continue;
        const groups=new Map();
        for (const e of entries) {
            const lo=inRoot(e.start), hi=inRoot(e.end);
            const mid=(tokenAt(lo)+tokenAt(Math.max(lo,hi-1))+1)/2;
            const scope=atoms[closest(atoms,mid,a=>a.mid)].scope;
            if (!groups.has(scope)) groups.set(scope,[]);
            groups.get(scope).push(mid);
        }
        targets[label]=groups;
        for (const [s,positions] of groups) requested.set(s,Math.max(requested.get(s)??0,positions.length));
    }
    let refinements=0;
    for (const [scope,group] of byRun) {
        while (group.length<(requested.get(scope)??0)) {
            const i=group.reduce((best,v,j)=>v.b-v.a>group[best].b-group[best].a?j:best,0);
            const original=group[i], str=root.text.slice(original.a,original.b);
            const middle=(original.a+original.b)/2;
            const breaks=[...str.matchAll(/\s+(?=\S)/gu)].map(m=>original.a+m.index+m[0].length);
            const at=breaks.length ? breaks[closest(breaks,middle,x=>x)] : Math.floor(middle);
            const left=atom(original.a,at,scope), right=atom(at,original.b,scope);
            assert.ok(left&&right,'A parser run cannot supply the requested number of distinct centres');
            group.splice(i,1,left,right);
            refinements++;
        }
    }
    const rows=[];
    for (const group of byRun.values()) {
        for (const [j,center] of group.entries()) {
            let lo=j, hi=j, before=true, after=true;
            const history=[];
            while (before||after) {
                const left=before && lo>0, right=after && hi+1<group.length;
                if (!left&&!right) break;
                const useLeft=left && (!right || center.ta-group[lo].ta<=group[hi].tb-center.tb);
                const nextLo=useLeft?lo-1:lo, nextHi=useLeft?hi:hi+1;
                if (group[nextHi].tb-group[nextLo].ta<=512) {
                    history.push([lo,hi]); lo=nextLo; hi=nextHi;
                } else if (useLeft) before=false; else after=false;
            }
            let candidate=sliceView(root,group[lo].a,group[hi].b);
            while (bank.countTokens(candidate.text)>512 && history.length) {
                [lo,hi]=history.pop();
                candidate=sliceView(root,group[lo].a,group[hi].b);
            }
            assert.ok(bank.countTokens(candidate.text)<=512);
            center.index=rows.length;
            center.tokens=bank.countTokens(candidate.text);
            rows.push({v:keyFor(candidate.text),win:viewFor(candidate),tokens:center.tokens,pos:center.mid,scope:center.scope});
        }
    }
    function choose(group,positions) {
        assert.ok(positions.length<=group.length);
        let prev=-1;
        return positions.map((p,i)=>{
            const nearest=closest(group,p,a=>a.mid);
            const at=Math.max(prev+1,Math.min(nearest,group.length-(positions.length-i)));
            prev=at;
            return group[at].index;
        });
    }
    function even(group,count,phase) {
        const lo=group[0].ta, width=group.at(-1).tb-lo;
        return choose(group,Array.from({length:count},(_,i)=>lo+width*(i+phase)/count));
    }
    const all=[...byRun.values()].flat(), selections={};
    for (const [label,groups] of Object.entries(targets)) {
        const picks={semantic:[],even:[],early:[],late:[],lengthMatched:[]};
        const distances=[];
        for (const [scope,positions] of groups) {
            const group=byRun.get(scope), k=positions.length, chosen=choose(group,positions);
            picks.semantic.push(...chosen);
            chosen.forEach((j,i)=>distances.push(Math.abs(rows[j].pos-positions[i])));
            for (const [name,phase] of [['even',.5],['early',.25],['late',.75]]) picks[name].push(...even(group,k,phase));
            const lengthBand=a=>Math.floor((a.tokens-1)/64);
            const bands=Map.groupBy(group,lengthBand);
            const bandCounts=new Map();
            for (const j of chosen) {
                const band=Math.floor((rows[j].tokens-1)/64);
                bandCounts.set(band,1+(bandCounts.get(band)??0));
            }
            for (const [band,count] of bandCounts) picks.lengthMatched.push(...even(bands.get(band),count,.5));
        }
        picks.documentEven=even(all,picks.semantic.length,.5);
        for (const list of Object.values(picks)) {
            list.sort((a,b)=>a-b);
            assert.equal(list.length,layouts[label].length);
            assert.equal(new Set(list).size,list.length);
        }
        selections[label]={picks,projectionTokenDistance:distances.reduce((a,b)=>a+b,0)};
    }
    return {rows,selections,refinements,longPieces};
}
