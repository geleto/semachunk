import assert from 'node:assert/strict';
import { mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync,gunzipSync } from 'node:zlib';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { parseTextTree } from '../src/sentences.js';
import { cache,here,sha256 } from './corpora.mjs';
import { dimension,openReplay } from './encoder.mjs';
import { dot,union } from './prose-evidence.mjs';
import { bridgeTreeCores, paragraphCutoffs, paragraphRegions } from './paragraph-affinity.mjs';
const paragraphStudy=process.argv.includes('--paragraphs');
const key=process.argv[2],root=join(cache,'context-mixtures'),prior=join(cache,'scope-weights');
const out=paragraphStudy?join(cache,'query-parents'):prior;
const data=JSON.parse(await readFile(join(root,'data',key+'.json')));
const sourceHeads=JSON.parse(await readFile(join(prior,'source-headings.json')))[key];
const version=sha256(Buffer.concat(await Promise.all(['scope-weights-index.mjs',...(paragraphStudy?['paragraph-affinity.mjs']:[])].map(f=>readFile(join(here,f))))));
const gates=paragraphStudy?['any','paragraph','section',...paragraphCutoffs.map(t=>'para'+t)]:['any','paragraph','section','major','soft40','soft60'];
for(const [di,doc] of data.docs.entries()){
    const base=join(root,'indexes',key,String(di)),idx=JSON.parse(gunzipSync(await readFile(base+'.json.gz')));
    const dest=join(out,'indexes',key);await mkdir(dest,{recursive:true});const prefix=join(dest,String(di));
    const external=sourceHeads[di];assert.equal(external.id,doc.id);
    const stamp=sha256(JSON.stringify([idx.inputHash,external,version]));
    try{if(JSON.parse(gunzipSync(await readFile(prefix+'.json.gz'))).stamp===stamp)continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    const source=doc.source,budget={maxChunkSize:Infinity};
    const tree=doc.format==='markdown'?(await loadMarkdownParser()).parseMarkdownTree(doc.raw,budget):await parseTextTree(doc.raw,{...budget,inputFormat:doc.format});
    assert.equal(tree.source??doc.raw,source);
    const headings=[];
    function visit(node){
        if(node.depth&&!node.skip)headings.push({start:node.start,end:node.end,depth:node.depth});
        for(const c of node.children??[])visit(c);
    }
    tree.roots.forEach(visit);
    if(!headings.length)for(const [i,[start,depth]] of external.headings.entries()){
        const next=external.headings.slice(i+1).find(([,d])=>d<=depth);
        headings.push({start,depth,end:next?.[0]??source.length});
    }
    // Disregard a sole enclosing document title when determining its major sections.
    let levels=[...new Set(headings.map(h=>h.depth))].sort((a,b)=>a-b);
    while(levels.length>1){
        const at=headings.filter(h=>h.depth===levels[0]);
        if(at.length!==1||headings.some(h=>h.start<at[0].start||h.end>at[0].end))break;
        levels=levels.slice(1);
    }
    const majorDepth=levels[0]??0;
    const paras=[0,...Array.from(source.matchAll(/\n\s*\n/gu),m=>m.index+m[0].length)];
    const soft={};
    function scope(position,gate){
        if(gate==='any')return -1;
        if(gate==='paragraph'||gate in soft){
            const bounds=soft[gate]??paras;
            let a=0,b=bounds.length;
            while(a+1<b){const mid=Math.floor((a+b)/2);if(bounds[mid]<=position)a=mid;else b=mid;}
            return bounds[a];
        }
        return headings.findLast(h=>h.start<=position&&position<h.end&&(gate==='section'||h.depth<=majorDepth))?.start??-1;
    }
    const ps=[...idx.passages],numOriginal=ps.length,texts=[],vmap=new Map(idx.texts.map((t,i)=>[t,i]));
    const pmap=new Map(ps.map((p,i)=>[JSON.stringify([p.v,p.spans]),i]));
    const members={...idx.members},plans={},configs={},stats={};
    const first=p=>ps[p].spans[0][0],last=p=>ps[p].spans.at(-1)[1]-1;
    function combine(parts){
        if(parts.length<2)return parts[0]??-1;
        const runs=[];
        for(const [a,b] of union(parts.flatMap(i=>ps[i].spans))){
            if(runs.length&&!source.slice(runs.at(-1)[1],a).trim())runs.at(-1)[1]=b;
            else runs.push([a,b]);
        }
        const text=runs.map(([a,b])=>source.slice(a,b)).join('\n\n');
        if(!vmap.has(text)){vmap.set(text,idx.texts.length+texts.length);texts.push(text);}
        const p={v:vmap.get(text),spans:runs},sig=JSON.stringify([p.v,runs]);
        if(!pmap.has(sig)){pmap.set(sig,ps.length);ps.push(p);}
        return pmap.get(sig);
    }
    const buffer=await readFile(base+'.f32');assert.equal(sha256(buffer),idx.vectorSHA256);
    const v=i=>new Float32Array(buffer.buffer,buffer.byteOffset+ps[i].v*dimension*4,dimension);
    const atoms=idx.atoms,sims=atoms.map((p,i)=>i?dot(v(atoms[i-1]),v(p)):0);
    const sections=atoms.map(p=>scope(last(p),'section'));
    const atomParagraphs=atoms.map(p=>scope(last(p),'paragraph'));
    let paragraphSimilarities=[];
    if(paragraphStudy){
        const bank=await openReplay(undefined,join(prior,'vectors',key,String(di)),{lengthSafe:true,concurrency:2});
        try{
            const vectorForTexts=async inputs=>{
                const missing=[...new Set(inputs.filter(t=>!vmap.has(t)))];
                const fresh=await bank.embed(missing);
                const newVectors=new Map(missing.map((t,i)=>[t,fresh[i]]));
                return inputs.map(t=>vmap.has(t)?new Float32Array(buffer.buffer,buffer.byteOffset+vmap.get(t)*dimension*4,dimension):newVectors.get(t));
            };
            const result=await paragraphRegions({source,starts:paras,atomStarts:atoms.map(first),atomParagraphs,sections,vectorForTexts,dot});
            Object.assign(soft,result.regions);paragraphSimilarities=result.similarities;
        }finally{bank.close();}
    }
    for(const threshold of [40,60]){
        soft['soft'+threshold]=[0,...atoms.flatMap((p,i)=>i&&sections[i]!==sections[i-1]&&sims[i]<threshold/100?[first(p)]:[])].sort((a,b)=>a-b);
    }
    const labels=Object.fromEntries(gates.map(g=>[g,atoms.map(p=>scope(last(p),g))]));
    plans.blocks256=idx.plans.blocks256;
    if(paragraphStudy){
        const order=new Map(atoms.map((p,i)=>[p,i]));
        for(const t of [25,40]){
            const original=idx.plans['tree'+t];
            plans['tree'+t+'-any']=original;
            for(const k of paragraphCutoffs){
                const gate='para'+k;
                plans['tree'+t+'-'+gate+'-bridge']=bridgeTreeCores(original,members,order,atomParagraphs,sections,labels[gate],combine);
                if(t===25&&[25,40,55].includes(k))for(const [control,shift] of [['rollA',1/3],['rollB',2/3]]){
                    const cs=bridgeTreeCores(original,members,order,atomParagraphs,sections,labels[gate],combine,shift);
                    assert.equal(cs.length,plans['tree'+t+'-'+gate+'-bridge'].length);
                    plans['tree'+t+'-'+gate+'-'+control]=cs;
                }
            }
        }
    }
    for(const t of [25,40])for(const g of gates)for(const override of (paragraphStudy&&g.startsWith('para')&&g!=='paragraph'?[false,true]:[false])){
        const groups=[];
        for(const [i,p] of atoms.entries()){
            const waiveEdge=override&&i>0&&atomParagraphs[i]!==atomParagraphs[i-1];
            if(!i||(!waiveEdge&&sims[i]<t/100)||labels[g][i]!==labels[g][i-1]||(paragraphStudy&&g.startsWith('para')&&g!=='paragraph'&&sections[i]!==sections[i-1]))groups.push([]);
            groups.at(-1).push(p);
        }
        const cs=groups.map(items=>{
            const c=combine(items);members[c]??=items;return c;
        });
        if(g==='any'||g==='soft40'&&t===40)assert.deepEqual(cs,idx.plans['sent'+t]);
        plans['s'+t+'-'+g+(override?'-override':'')]=cs;
    }
    function overlap(a,b){return ps[a].spans.some(([x,y])=>ps[b].spans.some(([s,e])=>x<e&&s<y));}
    function side(n,pos,g,left){
        if(n<0||g==='any')return n;
        const label=scope(pos,g),kids=members[n]??[n];
        if(scope(first(n),g)===label&&scope(last(n),g)===label&&kids.every(p=>scope(last(p),g)===label))return n;
        const clipped=[];
        for(const p of left?kids.toReversed():kids){
            if(scope(last(p),g)!==label)break;
            clipped.push(p);
        }
        return combine(left?clipped.reverse():clipped);
    }
    for(const [plan,cs] of Object.entries(plans)){
        const settings={};
        const usedGates=paragraphStudy&&!plan.endsWith('-any')&&plan!=='blocks256'?[...new Set(['any','section',plan.split('-')[1]])]:gates;
        for(const g of usedGates)settings[g]=cs.map((c,i)=>{
            let l=cs[i-1]??-1,r=cs[i+1]??-1;
            if(l>=0&&overlap(c,l))l=-1;if(r>=0&&overlap(c,r))r=-1;
            return [side(l,first(c),g,true),side(r,last(c),g,false),c];
        });
        configs[plan]={settings,bridges:[]};
        stats[plan]=Object.fromEntries(usedGates.map(g=>[g,settings[g].filter(([l,r],i)=>l!==settings.any[i][0]||r!==settings.any[i][1]).length]));
    }
    const bank=await openReplay(undefined,join(prior,'vectors',key,String(di)),{lengthSafe:true,concurrency:2});
    try{
        const vecs=await bank.embed(texts),bytes=Buffer.alloc(vecs.length*dimension*4);
        vecs.forEach((v,i)=>Buffer.from(v.buffer,v.byteOffset,v.byteLength).copy(bytes,i*dimension*4));
        const extra={stamp,original:idx.inputHash,plans,configs,stats,headings:headings.length,majorDepth,
            sectionLabels:new Set(labels.section).size,majorLabels:new Set(labels.major).size,headingOrigin:external.origin,
            ...(paragraphStudy?{paragraphSimilarities}:{}),members:Object.fromEntries(Object.entries(members).filter(([k])=>!(k in idx.members))),passages:ps.slice(numOriginal),vectorSHA256:sha256(bytes)};
        await writeFile(prefix+'.f32.tmp',bytes);await rename(prefix+'.f32.tmp',prefix+'.f32');
        await writeFile(prefix+'.json.gz.tmp',gzipSync(JSON.stringify(extra)));await rename(prefix+'.json.gz.tmp',prefix+'.json.gz');
    }finally{bank.close();}
}
