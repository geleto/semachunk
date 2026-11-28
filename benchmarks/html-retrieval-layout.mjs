import {covers,joinViews,sourceSpans} from '../src/citations.js';
import {chunkContextParts,passageFits} from '../src/document.js';
import {centeredPassage} from './centered-passage.mjs';

export function semachunkLayout(doc,blocks,keyFor,addView,count,semantic) {
    const spans=blocks.nodes.map(sourceSpans);
    const paragraphs=new Set(blocks.nodes.filter(n=>n.type==='paragraph' && n.text && spans[n.id].length).map(n=>n.id));
    const counts=new Uint32Array(blocks.nodes.length);
    for(const id of paragraphs) for(let p=blocks.nodes[id].parentId;p!==null;p=blocks.nodes[p].parentId) counts[p]++;
    const length=parts=>parts.reduce((total,[a,b])=>total+b-a,0);
    const sections=blocks.nodes.filter(n=>['section','article'].includes(n.type) && n.text &&
        (n.retrievalOnly?[...paragraphs].filter(p=>covers(spans[n.id],spans[p])).length>=2:counts[n.id]>=2))
        .sort((a,b)=>length(spans[a.id])-length(spans[b.id]));
    const fits=passageFits(doc,count), centered=semantic?centeredPassage(doc,doc.chunks.map(c=>count(c.text)),count):null;
    return doc.chunks.map((c,j)=>{
        const core=sourceSpans(c);
        const section=sections.find(n=>covers(spans[n.id],core) && !covers(core,spans[n.id]) && !covers(spans[n.id],spans[0]));
        const parts=chunkContextParts(doc,j,1,fits);
        const display=joinViews((centered?centered(j,'budget').parts:parts).filter(p=>p?.text),'\n\n');
        return {v:keyFor(c.text),pa:c.nodeIds.filter(n=>paragraphs.has(n) && !covers(spans[n],core)).map(n=>keyFor(blocks.nodes[n].text,blocks.nodes[n])),
            section:section?keyFor(section.text):-1,bare:addView(c),win:addView(display),
            near:semantic?[0,2].filter(side=>parts[side]?.text).map(side=>j+side-1):[]};
    });
}
