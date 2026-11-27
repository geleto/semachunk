// Rotate the group lengths. The document order, parser units, chunk count and
// multiset of group sizes in units are exactly preserved in each replicate.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {cache,sha256} from './corpora.mjs';
import {openReplay,dimension} from './encoder.mjs';
import {dot,union} from './prose-evidence.mjs';
const root=join(cache,'context-mixtures'),key=process.argv[2];
const {docs}=JSON.parse(await readFile(join(root,'data',key+'.json')));
for(const [di,doc] of docs.entries()){
    const pre=join(root,'indexes',key,String(di)),idx=JSON.parse(gunzipSync(await readFile(pre+'.json.gz')));
    const dir=join(root,'placebo',key);await mkdir(dir,{recursive:true});const out=join(dir,String(di));
    const stamp=sha256(JSON.stringify([idx.inputHash,idx.buildHash,4]));
    try{if(JSON.parse(gunzipSync(await readFile(out+'.json.gz'))).stamp===stamp)continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    const bytes=await readFile(pre+'.f32'),V=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
    const v=i=>V.subarray(idx.passages[i].v*dimension,(idx.passages[i].v+1)*dimension);
    const textIds=new Map(idx.texts.map((t,i)=>[t,i])),texts=[],passages=[],plans={},members={},stats={};
    const index=new Map(idx.passages.map((p,i)=>[JSON.stringify([p.v,p.spans]),i]));
    function group(atoms){
        if(atoms.length===1)return atoms[0];
        const runs=[];
        for(const [a,b] of union(atoms.flatMap(i=>idx.passages[i].spans))){
            if(runs.length&&!doc.source.slice(runs.at(-1)[1],a).trim())runs.at(-1)[1]=b;
            else runs.push([a,b]);
        }
        const s=runs.map(([a,b])=>doc.source.slice(a,b)).join('\n\n');
        if(!textIds.has(s)){textIds.set(s,idx.texts.length+texts.length);texts.push(s);}
        const p={v:textIds.get(s),spans:runs},sig=JSON.stringify([p.v,runs]);
        if(!index.has(sig)){index.set(sig,idx.passages.length+passages.length);passages.push(p);}
        return index.get(sig);
    }
    for(const t of [25,40,55]){
        const groups=[];
        for(const [i,p] of idx.atoms.entries()){
            if(!i || dot(v(idx.atoms[i-1]),v(p))<t/100)groups.push([]);
            groups.at(-1).push(p);
        }
        assert.deepEqual(groups.map(group),idx.plans['sent'+t]);
        const lengths=groups.map(g=>g.length),k=lengths.length;
        const first=k<2?0:1+parseInt(sha256(doc.id+'/'+t+'/first').slice(0,8),16)%(k-1);
        const second=k<3?first:1+(first-1+1+parseInt(sha256(doc.id+'/'+t+'/second').slice(0,8),16)%(k-2))%(k-1);
        for(const [j,off] of [first,second].entries()){
            const name='roll'+t+'ab'[j];let pos=0;plans[name]=[];
            for(const len of [...lengths.slice(off),...lengths.slice(0,off)]){
                const atoms=idx.atoms.slice(pos,pos+len);pos+=len;const i=group(atoms);
                plans[name].push(i);members[i]=atoms;
            }
            assert.equal(pos,idx.atoms.length);
            stats[name]=[k,plans[name].filter(i=>!idx.plans['sent'+t].includes(i)).length];
        }
    }
    const encoder=await openReplay(undefined,join(root,'placebo-vectors',key,String(di)),{lengthSafe:true,concurrency:2});
    try{
        const vv=await encoder.embed(texts);const b=Buffer.alloc(vv.length*dimension*4);
        vv.forEach((v,i)=>Buffer.from(v.buffer,v.byteOffset,v.byteLength).copy(b,i*dimension*4));
        await writeFile(out+'.f32',b);await writeFile(out+'.json.gz',gzipSync(JSON.stringify({stamp,texts,plans,passages,members,stats,hash:sha256(b)})));
    }finally{encoder.close();}
}
console.log(key,docs.length,'matched-size placebo documents');
