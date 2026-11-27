import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync,gunzipSync } from 'node:zlib';
import { tokenBudget } from '../src/token-limit.js';
import { cache,here,sha256 } from './corpora.mjs';
import { dimension,model,openReplay } from './encoder.mjs';
import { scoredTree } from './matched-count.mjs';
import { dot,union } from './prose-evidence.mjs';
import { attachHeadings,treeLayout } from './tree-policy.mjs';
const root=join(cache,'context-mixtures'), old=join(cache,'context-retrieval');
const protocol=JSON.parse(await readFile(join(here,'mixture-protocol.json')));
const buildHash=sha256(Buffer.concat(await Promise.all(['mixture-index.mjs','mixture-protocol.json','tree-policy.mjs'].map(f=>readFile(join(here,f))))));
const [key,number]=process.argv.slice(2);
const data=JSON.parse(await readFile(join(root,'data',key+'.json')));
const start=p=>p.spans[0][0],end=p=>p.spans.at(-1)[1];
function canon(row){return {text:row.text,spans:union(row.sourceRanges.map(r=>[r.start,r.end]))};}
async function build(di,doc) {
    const dir=join(root,'indexes',key);await mkdir(dir,{recursive:true});
    const prefix=join(dir,String(di)), inputHash=sha256(JSON.stringify(doc));
    try {
        const done=JSON.parse(gunzipSync(await readFile(prefix+'.json.gz')));
        if (done.inputHash===inputHash && done.buildHash===buildHash)return;
    } catch(e){if(e.code!=='ENOENT')throw e;}
    const bank=await openReplay(undefined,join(root,'vectors',key,String(di)),{lengthSafe:true,concurrency:4});
    const memory=new Map();
    try {
        try {
            const p=join(old,'indexes',key,String(di)), idx=JSON.parse(gunzipSync(await readFile(p+'.json.gz')));
            assert.equal(idx.id,doc.id);assert.equal(idx.model,model);
            const buf=await readFile(p+'.f32');assert.equal(sha256(buf),idx.vectorSHA256);
            idx.texts.forEach((t,i)=>memory.set(t,new Float32Array(buf.buffer,buf.byteOffset+i*dimension*4,dimension)));
        }catch(e){if(e.code!=='ENOENT')throw e;}
        async function embed(ts){
            const unseen=[...new Set(ts.filter(t=>!memory.has(t)))];
            if(unseen.length)(await bank.embed(unseen)).forEach((v,i)=>memory.set(unseen[i],v));
            return ts.map(t=>memory.get(t));
        }
        const source=doc.source, texts=[], ids=new Map(), passages=[], unique=new Map();
        function tid(s){if(!ids.has(s)){ids.set(s,texts.length);texts.push(s);}return ids.get(s);}
        function add(p){
            const v=tid(p.text),sig=JSON.stringify([v,p.spans]);
            if(!unique.has(sig)){unique.set(sig,passages.length);passages.push({v,spans:p.spans});}
            return unique.get(sig);
        }
        function combine(parts,exact=false){
            parts=parts.filter(i=>i>=0);
            if(parts.length===1)return parts[0];
            if(!parts.length)return -1;
            const spans=union(parts.flatMap(i=>passages[i].spans));
            if(!exact)return add({spans,text:parts.map(i=>texts[passages[i].v]).join('\n\n')});
            const runs=[];
            for(const [a,b] of spans){
                if(runs.length&&!source.slice(runs.at(-1)[1],a).trim())runs.at(-1)[1]=b;
                else runs.push([a,b]);
            }
            return add({spans:runs,text:runs.map(([a,b])=>source.slice(a,b)).join('\n\n')});
        }
        const budget={maxChunkSize:Infinity},small={...budget,fits:tokenBudget(256,bank.countTokens,'')};
        const leaves=await treeLayout(doc.raw,doc.format,budget,'2',async ts=>ts.map(()=>[1]));
        assert.equal(leaves.source,source,doc.id);
        const atoms=leaves.rows.map(row=>add(canon(row)));
        const av=await embed(atoms.map(i=>texts[passages[i].v]));
        const marked=await treeLayout(doc.raw,doc.format,small,'blocks',undefined,undefined,true);
        const tree=await scoredTree(doc,{...bank,embed},Infinity);
        const rows=async (size,how)=>(await treeLayout(doc.raw,doc.format,size,how)).rows.map(row=>add(canon(row)));
        const plans={blocks256:await rows(small,'blocks'),head256:attachHeadings(marked.headings,marked.rows).map(row=>add(canon(row))),blocksInf:await rows(budget,'blocks')};
        for(const t of protocol.semanticCutoffs){
            plans['tree'+Math.round(t*100)]=tree.at(t).map(row=>add(canon(row)));
            const groups=[];
            for(const [i,a] of atoms.entries()){
                if(!i||dot(av[i-1],av[i])<t)groups.push([]);
                groups.at(-1).push(a);
            }
            plans['sent'+Math.round(t*100)]=groups.map(g=>combine(g,true));
        }
        const paras=[0,...Array.from(source.matchAll(/\n\s*\n/gu),m=>m.index+m[0].length)];
        const agenda=data.domain==='boards' ? paras.filter(a=>/^\d+(\.\d+)*\s+[A-Z][^\n]{1,100}(?:\n|$)/u.test(source.slice(a,a+150))) : [];
        const explicit=doc.sectionStarts??agenda;
        function scope(n) {
            const heading=marked.headings.findLast(h=>h.start<=n && n<h.sectionEnd);
            if(heading)return heading.start;
            const starts=explicit.length?explicit:paras;
            return starts.findLast(a=>a<=n)??0;
        }
        const members={};
        for(const i of new Set(Object.values(plans).flat())){
            const p=passages[i];
            members[i]=atoms.filter(j=>passages[j].spans.every(([a,b])=>p.spans.some(([s,e])=>s<=a&&b<=e)));
        }
        function overlaps(p,q){return p.spans.some(([a,b])=>q.spans.some(([s,e])=>a<e&&s<b));}
        function sameSide(n,anchor){
            const p=passages[n],part=scope(anchor);
            if(scope(start(p))===part && scope(end(p)-1)===part)return n;
            const contained=(members[n]??[n]).filter(a=>scope(start(passages[a]))===part&&scope(end(passages[a])-1)===part);
            return combine(contained,true);
        }
        function relation(left,right){
            const a=texts[passages[left].v].trimEnd(),b=texts[passages[right].v].trimStart();
            return /\?\s*["”']?$/u.test(a)||/^(?:[\w .'-]{1,32}:\s*)?(?:approved\b|(?:the )?(?:motion|resolution) (?:passed|carried)|yes\b|no[,.:]|because\b|however\b|therefore\b|as a result\b|in other words\b)/iu.test(b);
        }
        await embed([...new Set(Object.values(plans).flat())].map(i=>texts[passages[i].v]));
        const configs={};
        for(const [plan,cores] of Object.entries(plans)){
            const bridges=[];
            for(let k=1;k+1<cores.length;k++){
                const [a,b,c]=cores.slice(k-1,k+2);
                if(overlaps(passages[a],passages[b])||overlaps(passages[b],passages[c])||overlaps(passages[a],passages[c]))continue;
                const v=await embed([a,b,c].map(i=>texts[passages[i].v]));
                const [ab,bc,ac]=[dot(v[0],v[1]),dot(v[1],v[2]),dot(v[0],v[2])];
                if(ac>=.35&&ac-Math.max(ab,bc)>=.05)bridges.push([k,ac,ac-Math.max(ab,bc),combine([a,c]),combine([a,b,c])]);
            }
            const settings={};
            for(const mode of protocol.neighbors)for(const gate of protocol.boundaries){
                settings[mode+'/'+gate]=cores.map((ci,i)=>{
                    const p=passages[ci];
                    let l,r;
                    if(mode==='sentence'){
                        l=atoms.findLast(a=>end(passages[a])<=start(p))??-1;
                        r=atoms.find(a=>start(passages[a])>=end(p))??-1;
                    }else {
                        l=cores[i-1]??-1;r=cores[i+1]??-1;
                        if(l>=0&&overlaps(p,passages[l]))l=-1;
                        if(r>=0&&overlaps(p,passages[r]))r=-1;
                    }
                    function side(n,anchor,left){
                        if(n<0||gate==='allow')return n;
                        const within=sameSide(n,anchor);
                        if(gate==='trim')return within;
                        if(within===n)return n;
                        if(gate==='linked'&&relation(left?n:ci,left?ci:n))return n;
                        return gate==='linked'?within:-1;
                    }
                    l=side(l,start(p),true);r=side(r,end(p)-1,false);
                    return [l,r,combine([l,ci,r])];
                });
            }
            configs[plan]={settings,bridges};
        }
        const questions=doc.questions.map(q=>({...q,v:tid(q.text)}));
        const buf=Buffer.alloc(texts.length*dimension*4);
        const vectors=await embed(texts);
        vectors.forEach((v,i)=>Buffer.from(v.buffer,v.byteOffset,v.byteLength).copy(buf,i*dimension*4));
        const result={id:doc.id,buildHash,inputHash,dimension,model,plans,atoms,configs,members,passages,texts,questions,vectorSHA256:sha256(buf)};
        await writeFile(prefix+'.f32.tmp',buf);await rename(prefix+'.f32.tmp',prefix+'.f32');
        await writeFile(prefix+'.json.gz.tmp',gzipSync(JSON.stringify(result)));await rename(prefix+'.json.gz.tmp',prefix+'.json.gz');
        console.log(key,di,plans.blocks256.length,'blocks',texts.length,'vectors',bank.stats.apiInputTokens,'new tokens');
    } finally {bank.close();}
}
if(number!==undefined)await build(Number(number),data.docs[Number(number)]);
else for(const [di,doc] of data.docs.entries())await build(di,doc);
