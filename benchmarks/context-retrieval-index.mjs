import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cache, here, sha256 } from './corpora.mjs';
import { dimension, model, openReplay } from './encoder.mjs';
import { openStudySet } from './matched-count.mjs';
import { dot, union } from './prose-evidence.mjs';
import { layout } from './semantic-settings.mjs';
import { treeLayout } from './tree-policy.mjs';

const root = join(cache,'context-retrieval');
const json = async file => JSON.parse(await readFile(file,'utf8'));
const proto = await json(join(here,'context-retrieval-protocol.json'));
const sets = await json(join(root,'data','context-retrieval-manifest.json'));
const old = await json(join(here,'results','2026-11-27-audited-data.json'));
const version = sha256(JSON.stringify([proto,3]));
assert.equal(model,proto.model);

function canonical(row) {
    return {text:row.text, spans:union(row.sourceRanges.map(s=>[s.start,s.end]))};
}
function fromSpans(source, spans) {
    const parts=[];
    for (const [a,b] of union(spans)) {
        const prev=parts.at(-1);
        if (prev && !source.slice(prev[1],a).trim()) prev[1]=b;
        else parts.push([a,b]);
    }
    return {spans:parts,text:parts.map(([a,b])=>source.slice(a,b)).join('\n\n')};
}
function overlap(a,b) {return a.some(([s,e])=>b.some(([x,y])=>s<y && x<e));}
function start(p) {return p.spans[0][0];}
function end(p) {return p.spans.at(-1)[1];}

function selectNeighbors(atoms, headings, core, vectors) {
    const left=atoms.filter(a=>end(a)<=start(core)).slice(-2).reverse();
    const right=atoms.filter(a=>start(a)>=end(core)).slice(0,2);
    const inside=atoms.filter(a=>overlap(a.spans,core.spans));
    const title=headings.filter(h=>start(h)<=start(core) && start(core)<h.sectionEnd && !overlap(h.spans,core.spans)).at(-1);
    const sides=[[left,inside.slice(0,3)],[right,inside.slice(-3).reverse()]];
    const options=new Map(), skip=[], keep=[];
    for (const [near,edge] of sides) {
        for (const item of near) options.set(item,edge);
        if (near.length<2 || !edge.length) continue;
        const [middle,far]=near, anchor=edge[0];
        const sim=(a,b)=>dot(vectors[a.v],vectors[b.v]);
        const ac=sim(anchor,far);
        if (ac>=proto.bridgeMinimum && ac>=Math.max(sim(anchor,middle),sim(middle,far))+proto.bridgeMargin) {
            skip.push(far); keep.push(middle,far);
        }
    }
    if (title) options.set(title,[...inside.slice(0,3),...inside.slice(-3)]);
    function best(useFacets) {
        let chosen, score=proto.similarMinimum;
        for (const [option,facets] of options) {
            const target=vectors[option.v];
            const match=useFacets && facets.length ? Math.max(...facets.map(f=>dot(target,vectors[f.v]))) : dot(target,vectors[core.v]);
            if (match>=score && (!chosen || match>score)) {score=match;chosen=option;}
        }
        return chosen?[chosen]:[];
    }
    return {adjacent:[left[0],right[0]].filter(Boolean),similar:best(false),facets:best(true),skip,keep};
}

async function build(doc,di,arch,encoder) {
    const texts=[], ids=new Map();
    function id(text) {
        if (!ids.has(text)) {ids.set(text,texts.length);texts.push(text);}
        return ids.get(text);
    }
    const source=doc.source, budget={maxChunkSize:Infinity};
    const leaves=await treeLayout(doc.raw,doc.format,budget,'2',async ts=>ts.map(()=>[1]));
    assert.equal(leaves.source,source,doc.id);
    const atoms=leaves.rows.map(canonical);
    const marked=await treeLayout(doc.raw,doc.format,budget,'blocks',undefined,undefined,true);
    const headings=marked.headings.map(h=>({...fromSpans(source,[[h.start,h.end]]),sectionEnd:h.sectionEnd}));
    for (const p of [...atoms,...headings]) p.v=id(p.text);
    const av=await encoder.embed(texts);
    const plans={};
    for (const [name,key,method,limit] of [
        ['blocks256','ordinary/256/blocks','blocks',256],['head256','sections/256/blocks','blocks',256],
        ['blocksInf','ordinary/unlimited/blocks','blocks',Infinity],['tree40','ordinary/unlimited/0.4','semantic-blocks/0.4',Infinity]]) {
        if (arch) plans[name]=arch.plans[key][di].map(i=>{
            const p=arch.passages[i];assert.equal(p.doc,di);
            return {text:arch.texts[p.v],spans:p.spans};
        });
        else {
            assert.equal(headings.length,0,'New datasets are plain text');
            plans[name]=name==='head256'?plans.blocks256:(await layout(doc,method,limit,encoder)).rows.map(canonical);
        }
    }
    for (const cutoff of proto.sentenceCutoffs) {
        const groups=[];
        for (const [i,atom] of atoms.entries()) {
            if (!i || dot(av[atoms[i-1].v],av[atom.v])<cutoff) groups.push([]);
            groups.at(-1).push(...atom.spans);
        }
        plans['sentence'+Math.round(cutoff*100)]=groups.map(spans=>fromSpans(source,spans));
    }
    const cores=[], unique=new Map();
    for (const [name,rows] of Object.entries(plans)) {
        plans[name]=rows.map(row=>{
            const v=id(row.text), key=JSON.stringify([v,row.spans]);
            if (!unique.has(key)) {unique.set(key,cores.length);cores.push({...row,v});}
            return unique.get(key);
        });
    }
    const base=await encoder.embed(texts);
    for (const c of cores) {
        c.ext={};
        for (const [type,candidates] of Object.entries(selectNeighbors(atoms,headings,c,base))) {
            const parts=[c];
            for (const p of candidates) if (!parts.some(x=>overlap(x.spans,p.spans))) parts.push(p);
            parts.sort((a,b)=>start(a)-start(b));
            c.ext[type]={v:id(parts.map(p=>p.text).join('\n\n')), spans:union(parts.flatMap(p=>p.spans))};
        }
        delete c.text;
    }
    const questions=doc.questions.map(q=>({...q,v:id(q.text)}));
    const vectors=await encoder.embed(texts);
    for (const c of cores) for (const e of Object.values(c.ext)) e.drift=dot(vectors[c.v],vectors[e.v]);
    const buf=Buffer.alloc(vectors.length*dimension*4);
    vectors.forEach((v,i)=>Buffer.from(v.buffer,v.byteOffset,v.byteLength).copy(buf,i*dimension*4));
    return {buf,data:{id:doc.id,sourceSHA256:sha256(source),version,model,dimension,plans,cores,texts,questions}};
}

async function run(key) {
    const file=join(root,'data',key+'.json'), input=await readFile(file);
    assert.equal(sha256(input),sets[key].sha256);
    const {docs}=JSON.parse(input);
    const dir=join(root,'indexes',key);await mkdir(dir,{recursive:true});
    const arch=old.sets[key] ? JSON.parse(gunzipSync(await readFile(join(cache,'prose-thresholds',key+'.json.gz')))):null;
    const encoder=arch ? (await openStudySet(key,old.sets[key])).encoder :
        await openReplay(undefined,join(root,'vectors',key),{lengthSafe:true,concurrency:4});
    try {
        for (const [di,doc] of docs.entries()) {
            const prefix=join(dir,String(di)), path=prefix+'.json.gz';
            try {
                const prev=JSON.parse(gunzipSync(await readFile(path)));
                if (prev.version===version && prev.inputSHA256===sets[key].sha256) continue;
            } catch (e) {if(e.code!=='ENOENT') throw e;}
            if (arch) assert.equal(arch.documents[di].sha256,sha256(doc.source));
            const {data,buf}=await build(doc,di,arch,encoder);
            data.inputSHA256=sets[key].sha256;data.vectorSHA256=sha256(buf);
            await writeFile(prefix+'.f32.tmp',buf);await rename(prefix+'.f32.tmp',prefix+'.f32');
            await writeFile(path+'.tmp',gzipSync(JSON.stringify(data)));await rename(path+'.tmp',path);
        }
        console.log(key,docs.length,'documents;',encoder.stats.apiInputTokens,'new tokens');
    } finally {encoder.close();}
}
const key=process.argv[2];
if (key==='list') console.log(Object.keys(sets).join('\n'));
else {assert(key in sets,'Pass a shard key or list');await run(key);}
