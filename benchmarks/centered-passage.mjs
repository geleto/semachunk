import {joinViews} from '../src/citations.js';
import {chunkContextParts,passageFits} from '../src/document.js';

// Assemble virtual left/right neighbours, then use the production section clipping,
// exact token ceiling and parser-unit selection. The core is always retained.
export function centeredPassage(doc, tokens, countTokens) {
    const virtual = {...doc,chunks:[]}, fits = passageFits(doc,countTokens);
    function neighbor(start,end) {
        const chunks = doc.chunks.slice(start,end);
        if (chunks.length<2) return chunks[0];
        return {...joinViews(chunks,'\n\n'),nodeIds:[...new Set(chunks.flatMap(c => c.nodeIds))]};
    }
    return (index,radius) => {
        let lo=index, hi=index+1;
        if (radius==='budget') {
            let left=0, right=0;
            while (lo>0 && left<512) left+=tokens[--lo];
            while (hi<tokens.length && right<512) right+=tokens[hi++];
        } else {
            lo=Math.max(0,index-radius);
            hi=Math.min(tokens.length,index+1+radius);
        }
        virtual.chunks=[neighbor(lo,index),doc.chunks[index],neighbor(index+1,hi)];
        return {lo,hi,parts:chunkContextParts(virtual,1,1,fits)};
    };
}
