import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { cache, here, sha256 } from './corpora.mjs';
import { openReplay } from './encoder.mjs';
import { dot, union } from './prose-evidence.mjs';

const config=JSON.parse(await readFile(join(here,'hierarchy-list-probes.json')));
const dir=join(cache,'hierarchy-probes','list-sources');
await mkdir(dir,{recursive:true});
const parsers=await loadMarkdownParser(), candidates=[], questions=[], texts=new Set(), counts={};
const policies=['item','itemReturnList','list','itemReturnLeadList','leadList'];
for(const {id,url,hash,questions:annotations} of config){
    const file=join(dir,id+'.md');
    let raw;
    try{raw=await readFile(file);}catch(e){
        if(e.code!=='ENOENT')throw e;
        const res=await fetch(url);if(!res.ok)throw new Error('Download failed '+res.status);
        raw=Buffer.from(await res.arrayBuffer());assert.equal(sha256(raw),hash);await writeFile(file,raw);
    }
    assert.equal(sha256(raw),hash);
    const source=raw.toString('utf8'), lines=[0,...Array.from(source.matchAll(/\n/gu),m=>m.index+1),source.length];
    const ord=new Uint32Array(source.length+1);
    for(let i=0;i<source.length;i++)ord[i+1]=ord[i]+Number(!/\s/u.test(source[i]));
    const slice=(a,b)=>({t:source.slice(a,b).trim(),span:[ord[a],ord[b]]});
    const tree=parsers.parseMarkdownTree(source,{maxChunkSize:Infinity});
    counts[id]={lists:0,items:0,leadLists:0};let previous;
    function record(key,display,mode){
        texts.add(key.t);candidates.push({id,key:key.t,span:display.span,mode});
    }
    function ordinary(a,b,kind,section){
        const row=slice(a,b);
        if(!row.t)return;
        for(const mode of policies)record(row,row,mode);
        previous={a,b,kind,section};
    }
    function visit(node,section=-1){
        if(node.skip){previous=undefined;return;}
        const children=tree.children(node)??[];
        if(node.depth){
            const end=source.indexOf('\n',node.start);
            ordinary(node.start,end<0?node.end:Math.min(end,node.end),'heading',node.start);
            for(const c of children)visit(c,node.start);
        }else if(node.blocked){
            previous=undefined;for(const c of children)visit(c,section);previous=undefined;
        }else if(node.kind==='list'&&children.length&&children.every(c=>c.kind==='listItem')){
            const list=slice(node.start,node.end);
            const hasLead=previous&&previous.section===section&&!source.slice(previous.b,node.start).trim()
                &&(previous.kind==='heading'||previous.kind==='paragraph'&&source.slice(previous.a,previous.b).trimEnd().endsWith(':'));
            const led=hasLead?slice(previous.a,node.end):list;
            counts[id].lists++; counts[id].items+=children.length; counts[id].leadLists+=Number(Boolean(hasLead));
            for(const c of children){
                const item=slice(c.start,c.end);
                record(item,item,'item');record(item,list,'itemReturnList');record(item,led,'itemReturnLeadList');
            }
            record(list,list,'list');record(led,led,'leadList');previous=undefined;
        }else ordinary(node.start,node.end,node.kind,section);
    }
    tree.roots.forEach(n=>visit(n));
    for(const [kind,q,refs] of annotations){
        const evidence=union(refs.map(([a,b])=>slice(lines[a-1],lines[b]).span));
        questions.push({id,kind,q,evidence});texts.add(q);
    }
}
const bank=await openReplay(undefined,join(dir,'embeddings'),{lengthSafe:true,concurrency:2});
try{
    const ts=[...texts],vectors=new Map((await bank.embed(ts)).map((v,i)=>[ts[i],v]));
    const size=sp=>sp.reduce((n,[a,b])=>n+b-a,0);
    const intersection=(a,b)=>union(a.flatMap(([x,y])=>b.flatMap(([s,e])=>Math.min(y,e)>Math.max(x,s)?[[Math.max(x,s),Math.min(y,e)]]:[])));
    const rows=questions.map(({id,kind,q,evidence})=>{
        const results={};
        for(const mode of policies){
            const all=candidates.filter(c=>c.mode===mode).map(c=>({c,score:dot(vectors.get(q),vectors.get(c.key))})).sort((a,b)=>b.score-a.score);
            const distinct=[],seen=new Set();
            for(const {c} of all){
                const sig=JSON.stringify([c.id,c.span]);if(seen.has(sig))continue;seen.add(sig);distinct.push(c);
                if(distinct.length===5)break;
            }
            const first=distinct[0],same=distinct.filter(c=>c.id===id).map(c=>c.span);
            const amount=first.id===id?size(intersection([first.span],evidence)):0, target=size(evidence), length=size([first.span]);
            results[mode]=[Number(amount===target),Number(size(intersection(union(same),evidence))===target),2*amount/(length+target),length];
        }
        return {document:id,kind,question:q,results};
    });
    await writeFile(join(here,'results','2026-11-27-hierarchy-list-probes.json'),JSON.stringify({counts,rows},null,2)+'\n');
}finally{bank.close();}
