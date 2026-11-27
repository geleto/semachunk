import assert from 'node:assert/strict';
import {parseTextTree} from '../src/sentences.js';
import {sliceView,sourceSpans} from '../src/citations.js';

function union(spans) {
    const out=[];
    for (const [a,b] of spans.sort((x,y)=>x[0]-y[0])) {
        if(out.length && a<=out.at(-1)[1]) out.at(-1)[1]=Math.max(b,out.at(-1)[1]);
        else out.push([a,b]);
    }
    return out;
}

export function canonicalMapper(mapping) {
    if (!mapping) return spans=>spans;
    const rows=[...mapping].sort((a,b)=>a.start-b.start), ends=[];
    for (const r of rows) ends.push(Math.max(ends.at(-1)??0,r.end));
    return raw=>{
        const spans=[];
        for (const [a,b] of raw) {
            let lo=0,hi=ends.length;
            while (lo<hi) {
                const mid=(lo+hi)>>>1;
                if (ends[mid]<=a) lo=mid+1; else hi=mid;
            }
            for (let j=lo;j<rows.length && rows[j].start<b;j++) {
                const r=rows[j],start=Math.max(a,r.start),end=Math.min(b,r.end);
                if (start>=end) continue;
                spans.push(r.end-r.start===r.outputEnd-r.outputStart ?
                    [r.outputStart+start-r.start,r.outputEnd-(r.end-end)] : [r.outputStart,r.outputEnd]);
            }
        }
        return union(spans);
    };
}

export async function sourceOptions(doc,headings,countTokens) {
    const options={format:doc.format,sourceId:doc.id,includeHierarchy:true,returnEmbedding:false,sizeUnit:'tokens',countTokens};
    const flat=doc.format==='text' && headings.length && !/^#{1,6}\s/m.test(doc.raw);
    let tree;
    if (doc.raw!==doc.source || flat) {
        tree=await parseTextTree(doc.raw,{inputFormat:doc.format},true);
        assert.equal(tree.source,doc.source);
    }
    if (flat) {
        options.sectionRanges=headings.map(([a,depth],j)=>{
            const end=headings.slice(j+1).find(([,d])=>d<=depth)?.[0]??doc.source.length;
            const spans=sourceSpans(sliceView(tree.view,a,end));
            return {start:spans[0][0],end:spans.at(-1)[1]};
        });
    }
    return {options,mapping:doc.raw!==doc.source ? tree.view.citations : undefined};
}
