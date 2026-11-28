import assert from 'node:assert/strict';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {getChunkContext} from '../src/index.js';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {covers,sourceSpans} from '../src/citations.js';
import {cache,sha256} from './corpora.mjs';
import {dimension,model,openReplay} from './encoder.mjs';
import {canonicalMapper,sourceOptions} from './bounded-source.mjs';

const root=join(cache,'paragraph-ranking'), old=join(cache,'context-mixtures'), bounded=join(cache,'bounded-passages');
const readJSON=async file=>JSON.parse(await readFile(file));
const protocol=await readJSON(new URL('./paragraph-ranking-protocol.json',import.meta.url));
const registry={...await readJSON(join(old,'data/manifest.json')),...await readJSON(join(root,'holdout-data/manifest.json'))};
const outlines=await readJSON(join(cache,'scope-weights/source-headings.json'));
const layouts={};
for(const [core,upper] of protocol.blocks) layouts[`B${core}u${upper}`]={strategy:'blocks',maxChunkSize:core,maxStructuralSize:upper};
function tree(core,upper,cutoff,joinParagraphs) {
    const label=`T${core}u${upper}t${cutoff}${joinParagraphs?'j':'s'}`;
    layouts[label]={strategy:'semantic-blocks',maxChunkSize:core,maxStructuralSize:upper,joinParagraphs,
        ...(cutoff==='cal'?{mergeThresholdMode:'document',similarityThreshold:.15}:{similarityThreshold:cutoff})};
}
for(const cutoff of protocol.semanticCutoffs) tree(512,256,cutoff,true);
for(const args of protocol.otherTrees) tree(...args);
tree(512,256,'cal',true);
const version=sha256(Buffer.concat(await Promise.all(['./paragraph-ranking-index.mjs','./paragraph-ranking-protocol.json',
    './bounded-source.mjs','../src/semantic.js','../src/document.js','../src/hierarchy.js'].map(p=>readFile(new URL(p,import.meta.url))))));
const spanLength=rs=>rs.reduce((n,[a,b])=>n+b-a,0);

async function build(key,i,doc,bank) {
    const stem=join(root,key,String(i));
    const headings=outlines[key]?.[i]?.headings??[];
    const stamp=sha256(version+sha256(doc.raw)+JSON.stringify([doc.questions,headings,model,dimension]));
    try {
        const existing=JSON.parse(gunzipSync(await readFile(stem+'.json.gz')));
        if(existing.stamp===stamp && sha256(await readFile(stem+'.f32'))===existing.vectorHash) return;
    } catch(e) {if(e.code!=='ENOENT')throw e;}
    const known=new Map(), vectors=new Map(), counts=new Map();
    if(registry[key].fold!=='holdout') {
        for(const dir of [join(cache,'hierarchy-probes','indexes'),bounded,join(cache,'structural-limits')]) {
            const archive=join(dir,key,String(i));
            const ix=JSON.parse(gunzipSync(await readFile(archive+'.json.gz'))), bytes=await readFile(archive+'.f32');
            assert.equal(sha256(bytes),ix.vectorHash??ix.vectorSHA256);
            if(ix.model) assert.equal(ix.model,model);
            ix.hashes.forEach((h,j)=>known.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension)));
        }
    }
    function count(s) {
        if(!counts.has(s)) counts.set(s,bank.countTokens(s));
        return counts.get(s);
    }
    async function embed(texts) {
        const missing=[];
        for(const s of new Set(texts)) {
            if(vectors.has(s)) continue;
            const v=known.get(sha256(s));
            if(v) vectors.set(s,v); else missing.push(s);
        }
        const fetched=missing.length?await bank.embed(missing):[];
        missing.forEach((s,j)=>vectors.set(s,fetched[j]));
        return texts.map(s=>vectors.get(s));
    }
    const keys=new Map(), views=[], viewIds=new Map(), result={};
    function id(text) {
        if(!keys.has(text))keys.set(text,keys.size);
        return keys.get(text);
    }
    const {options,mapping}=await sourceOptions(doc,headings,count), canonical=canonicalMapper(mapping);
    function viewId(view) {
        const raw=sourceSpans(view), tokens=count(view.text), signature=JSON.stringify([tokens,raw]);
        assert.ok(tokens<=protocol.passageTokens);
        if(!viewIds.has(signature)) {
            viewIds.set(signature,views.length);
            views.push({raw,ranges:canonical(raw),tokens});
        }
        return viewIds.get(signature);
    }
    let paragraphs, byNode, spans, sections, sectionKeys, nodeCount;
    function collectNodes(nodes) {
        nodeCount=nodes.length;
        spans=nodes.map(sourceSpans);
        const ps=nodes.filter(n=>n.type==='paragraph'&&n.text&&spans[n.id].length)
            .sort((a,b)=>spans[a.id][0][0]-spans[b.id][0][0]);
        byNode=new Map(ps.map((p,j)=>[p.id,j]));
        const paragraphCounts=new Uint32Array(nodes.length);
        paragraphs=ps.map(n=>{
            let scope=0;
            for(let p=n.parentId;p!==null;p=nodes[p].parentId) {
                paragraphCounts[p]++;
                if(!scope && (['section','article','record'].includes(nodes[p].type)||nodes[p].record)) scope=p;
            }
            return {v:id(n.text),scope,raw:spans[n.id],tokens:count(n.text)};
        });
        paragraphs.forEach((p,j)=>{
            const near=[j-1,j+1].filter(k=>paragraphs[k]?.scope===p.scope);
            const sequence=[...near,j].sort((a,b)=>a-b);
            p.joint=near.length?id(sequence.map(k=>ps[k].text).join('\n\n')):p.v;
        });
        sections=nodes.filter(n=>['section','article'].includes(n.type)&&n.text&&
            (n.retrievalOnly?ps.filter(p=>covers(spans[n.id],spans[p.id])).length>=2:paragraphCounts[n.id]>=2))
            .sort((a,b)=>spanLength(spans[a.id])-spanLength(spans[b.id]));
        sectionKeys=sections.map(n=>id(n.text));
    }
    for(const [label,layout] of Object.entries(layouts)) {
        const d=await chunkDocument(doc.raw,{...options,...layout,maxPassageSize:protocol.passageTokens,embedBatch:embed});
        if(!paragraphs) collectNodes(d.nodes);
        assert.equal(d.nodes.length,nodeCount,'Layout changed the source hierarchy');
        result[label]=d.chunks.map((c,j)=>{
            const geometry=sourceSpans(c);
            assert.ok(!c.tokenLimitExceeded && count(c.text)<=layout.maxChunkSize);
            const members=c.nodeIds.filter(k=>byNode.has(k));
            const proper=members.filter(k=>!covers(spans[k],geometry)).map(k=>byNode.get(k));
            const same=members.find(k=>covers(spans[k],geometry)&&d.nodes[k].text===c.text);
            let enclosing=c.parentId;
            while(enclosing!==null && !byNode.has(enclosing)) enclosing=d.nodes[enclosing].parentId;
            const parent=byNode.get(enclosing);
            const section=sections.find(n=>covers(spans[n.id],geometry)&&!covers(geometry,spans[n.id])&&!covers(spans[n.id],spans[0]));
            return {v:id(c.text),pa:proper,same:byNode.get(same)??-1,
                parent:parent!==undefined&&paragraphs[parent].tokens<=512?parent:-1,
                section:section?id(section.text):-1,bare:viewId(c),win:viewId(getChunkContext(d,j))};
        });
    }
    const qs=doc.questions.filter(q=>q.kind!=='section').map(q=>({...q,v:id(q.text)}));
    const texts=[...keys.keys()], embeddings=await embed(texts);
    const bytes=Buffer.concat(embeddings.map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
    const ix={id:doc.id,stamp,model,dimension,vectorHash:sha256(bytes),sourceTokens:count(doc.source),hashes:texts.map(sha256),
        views,layouts:result,paragraphs,sectionKeys,qs};
    await writeFile(stem+'.f32.tmp',bytes);
    await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(ix)));
    await rename(stem+'.json.gz.tmp',stem+'.json.gz');
}
const args=process.argv.slice(2);
for(const [key,meta] of Object.entries(registry)) {
    if(args.length && !args.includes(key) && !args.includes(meta.fold)) continue;
    const directory=meta.fold==='holdout'?join(root,'holdout-data'):join(old,meta.fold==='fresh'?'audited-data':'data');
    await mkdir(join(root,key),{recursive:true});
    const data=await readJSON(join(directory,key+'.json'));
    const bank=await openReplay(undefined,join(meta.fold==='holdout'?root:bounded,'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        for(let i=0;i<data.docs.length;i+=3) {
            await Promise.all(data.docs.slice(i,i+3).map((doc,j)=>build(key,i+j,doc,bank)));
        }
        console.log(key,data.docs.length);
    } finally {bank.close();}
}
