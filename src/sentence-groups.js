import {sliceView} from './citations.js';
import {directionCosine} from './similarity.js';

function boundary(citations, offset, start) {
    for (const r of citations) {
        if (start ? r.start<=offset && offset<r.end : r.start<offset && offset<=r.end) {
            if (r.end-r.start===r.outputEnd-r.outputStart) return r.outputStart+offset-r.start;
            return start ? r.outputStart : r.outputEnd;
        }
    }
}

export function chunkSentences(doc, chunk) {
    const sentences=[];
    for (const id of chunk.nodeIds) {
        const node=doc.nodes[id];
        if (node.type!=='sentence' || !node.citations.length) continue;
        let parent=node.parentId;
        while (parent!==null && doc.nodes[parent].type!=='paragraph') parent=doc.nodes[parent].parentId;
        const start=boundary(chunk.citations,node.citations[0].start,true);
        const end=boundary(chunk.citations,node.citations.at(-1).end,false);
        if (start!==undefined && end>start) sentences.push({node,parent,start,end});
    }
    return sentences.sort((a,b)=>a.start-b.start);
}

export function adjacentSentences(chunk,left,right) {
    return right.parent!==null && left.parent===right.parent && left.end<=right.start &&
        !/\S/u.test(chunk.text.slice(left.end,right.start));
}

// Join complete consecutive sentence occurrences in the same source paragraph.
// A singleton keeps its existing vector. A merged group uses its exact text.
export function sentenceGroups(chunk,sentences,{threshold,maxSentences},directionFor) {
    const result=[];
    let run=[];
    function flush() {
        if (!run.length) return;
        if (run.length===1) result.push(run[0].node);
        else {
            const view=sliceView(chunk,run[0].start,run.at(-1).end);
            result.push({...view,type:'sentenceGroup',sourceId:chunk.sourceId,nodeIds:run.map(s=>s.node.id),headingPath:run[0].node.headingPath});
        }
        run=[];
    }
    for (const s of sentences) {
        const p=run.at(-1);
        if (p && (run.length>=maxSentences || !adjacentSentences(chunk,p,s) ||
            (threshold!==undefined && directionCosine(directionFor(p.node.text),directionFor(s.node.text))<threshold))) flush();
        run.push(s);
    }
    flush();
    return result;
}
