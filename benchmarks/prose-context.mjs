import { covers, dot } from './prose-evidence.mjs';

const segmenter = new Intl.Segmenter('en', {granularity:'sentence'});

// Use the same source units for every index. A table, code block or very long sentence
// breaks the sequence, so two distant passages cannot masquerade as a one-unit interruption.
export function sourceUnits(source, count, format) {
    const units = [], fences = [];
    let open;
    if (format==='markdown') for (const m of source.matchAll(/^ {0,3}(`{3,}|~{3,})(.*)$/gmu)) {
        if (!open) open={a:m.index,mark:m[1]};
        else if (m[1][0]===open.mark[0] && m[1].length>=open.mark.length && !m[2].trim()) {
            fences.push([open.a,m.index+m[0].length]); open=undefined;
        }
    }
    if (open) fences.push([open.a,source.length]);
    let group = 0;
    for (const match of source.matchAll(/[^\n](?:(?!\n\s*\n)[\s\S])*/gu)) {
        const paragraph = match[0].trim(), offset = match.index + match[0].indexOf(paragraph);
        if (!paragraph) continue;
        if (/^(?:\||```|~~~|<!--)/u.test(paragraph) ||
            fences.some(([a,b])=>offset<b && a<offset+paragraph.length)) { group++; continue; }
        const heading = /^#{1,6}\s/u.test(paragraph);
        const pieces = heading ? [{segment:paragraph,index:0}] : segmenter.segment(paragraph);
        for (const {segment,index} of pieces) {
            const text = segment.trim(), tokens = count(text);
            if (!text || tokens > 128) { group++; continue; }
            const a = offset + index + segment.indexOf(text);
            units.push({a,b:a+text.length,text,tokens,group,heading,
                prose:!heading && tokens>=8 && /\p{L}.{0,10}\p{L}/u.test(text)});
        }
    }
    return units;
}

function shared(a,b) { return a.some(id => b.includes(id)); }

export async function documentContext(units, docIndex, methods, encoder) {
    const vectors = units.length ? await encoder.embed(units.map(u => u.text)) : [];
    const names = Object.keys(methods);
    for (const u of units) {
        u.parents = Object.fromEntries(names.map(name => [name,methods[name].filter(r =>
            r.first <= u.a && u.b <= r.last && covers(r.spans,u.a,u.b)).map(r => r.id)]));
    }
    const pairs = {}, bridges = [];
    for (const lag of [1,4]) {
        const bins = {};
        for (let i=lag; i<units.length; i++) {
            const a=units[i-lag], c=units[i];
            if (a.group !== c.group || !a.prose || !c.prose ||
                names.some(k => !a.parents[k].length || !c.parents[k].length)) continue;
            const pattern = names.map(k => Number(shared(a.parents[k],c.parents[k]))).join('');
            const bin = bins[pattern] ??= [0,0];
            bin[0]++; bin[1]+=dot(vectors[i-lag],vectors[i]);
        }
        pairs[lag] = bins;
    }
    const sensitivity = [0,0,0];
    for (let i=2; i<units.length; i++) {
        const [a,b,c] = units.slice(i-2,i+1);
        if (a.group!==c.group || !a.prose || !c.prose || b.tokens>32 ||
            names.some(k => !a.parents[k].length || !c.parents[k].length)) continue;
        const sim=dot(vectors[i-2],vectors[i]), margin=sim-Math.max(dot(vectors[i-2],vectors[i-1]),dot(vectors[i-1],vectors[i]));
        if (sim<0.45) continue;
        for (const [j,cut] of [0.05,0.10,0.15].entries()) if (margin>=cut) sensitivity[j]++;
        if (margin < 0.10) continue;
        bridges.push({a:i-2,b:i-1,c:i,sim,margin,text:a.text+'\n\n'+c.text});
    }
    const bridgeVectors = bridges.length ? await encoder.embed(bridges.map(b => b.text)) : [];
    function forQuery(q, qvec) {
        const sentenceSim=units.map((u,i)=>u.prose?dot(vectors[i],qvec):0);
        const bridgeSim=bridgeVectors.map(v=>dot(v,qvec));
        function touches(choice,u) {return choice.ranges.some(([lo,hi])=>lo<u.b && u.a<hi);}
        const relevant=q.choices.filter(c=>c.doc===docIndex);
        const twoSided=bridges.map(({a,b,c})=>relevant.some(ref=>
            touches(ref,units[a]) && touches(ref,units[c]) && !touches(ref,units[b])));
        return (name,sentences,bridgeScores,gold)=>{
            for (const [i,u] of units.entries()) if (u.prose)
                for (const id of u.parents[name]) sentences[id]=Math.max(sentences[id],sentenceSim[i]);
            for (const [i,{a,c}] of bridges.entries()) {
                const first=units[a],last=units[c];
                if (twoSided[i]) gold[0]++;
                if (shared(first.parents[name],last.parents[name])) continue;
                for (const id of [...first.parents[name],...last.parents[name]])
                    bridgeScores[id]=Math.max(bridgeScores[id],bridgeSim[i]);
                if (twoSided[i]) {
                    gold[1]++;
                    if (shared(first.parents.blocks,last.parents.blocks)) gold[2]++;
                }
            }
        };
    }
    return {forQuery, stats:{pairs,bridges:sensitivity,
        separated:Object.fromEntries(names.map(name=>[name,bridges.filter(({a,c})=>
            !shared(units[a].parents[name],units[c].parents[name])).length]))}};
}
