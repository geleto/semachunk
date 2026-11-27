import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {chunkDocument} from '../src/index.js';
import {chunkContextParts} from '../src/document.js';
import {covers,joinViews,sourceSpans} from '../src/citations.js';
import {vectorDirection} from '../src/similarity.js';
import {chunkSentences,sentenceGroups} from '../src/sentence-groups.js';
import {cache,sha256} from './corpora.mjs';
import {dimension,model,openReplay} from './encoder.mjs';
import {canonicalMapper,sourceOptions} from './bounded-source.mjs';

const upperControls=process.argv.includes('--upper-controls');
const settingsStudy=upperControls || process.argv.includes('--structural-limits');
const bounded=join(cache,'bounded-passages'), root=settingsStudy ? join(cache,upperControls?'structural-upper-controls':'structural-limits') : bounded;
const old=join(cache,'context-mixtures');
const registry=JSON.parse(await readFile(join(old,'data','manifest.json')));
const outlines=JSON.parse(await readFile(join(cache,'scope-weights','source-headings.json')));
const protocol=JSON.parse(await readFile(new URL('./structural-limits-protocol.json',import.meta.url)));
const configs=new Map();
function layout(name,strategy,target,upper=Infinity,threshold=.25,joined=true) {
    const options={strategy,maxChunkSize:target};
    if (strategy==='blocks' || strategy==='semantic-blocks') options.maxStructuralSize=upper;
    if (strategy==='semantic-blocks') Object.assign(options,{similarityThreshold:threshold,joinParagraphs:joined});
    configs.set(name,options);
}
if (upperControls) {
    layout('blocks256','blocks',256);
    for(const upper of [192,256,384,Infinity]) layout('tree512u'+(upper===Infinity?'all':upper)+'low','semantic-blocks',512,upper,.15);
} else if (settingsStudy) {
    for(const n of protocol.structuralCores) layout('blocks'+n,'blocks',n);
    layout('pack256','pack',256);
    for(const n of protocol.flatSemanticCores) layout('semantic'+n,'semantic',n);
    for(const n of protocol.semanticTreeCores) {
        for(const upper of protocol.upperTargets) {
            if (upper!==null && upper>=n) continue;
            layout('tree'+n+'u'+(upper??'all'),'semantic-blocks',n,upper??Infinity);
        }
        if(n<=768) {
            layout('tree'+n+'u256low','semantic-blocks',n,256,.15);
            layout('tree'+n+'u256separate','semantic-blocks',n,256,.25,false);
            layout('tree'+n+'u256base','semantic-blocks',n,256,.15,false);
        }
    }
} else {
    for(const n of [256,512,1024]) layout('b'+n,'blocks',n);
    for(const n of [512,1024,2048]) layout('s'+n,'semantic-blocks',n);
}
const groupings={pair:{maxSentences:2},triple:{maxSentences:3},
    cos25:{maxSentences:3,threshold:.25},cos40:{maxSentences:3,threshold:.40},cos55:{maxSentences:3,threshold:.55}};
const fileHash=sha256(Buffer.concat(await Promise.all(['./bounded-passages-index.mjs','./bounded-source.mjs','./structural-limits-protocol.json',
    '../src/hierarchy.js','../src/markdown-units.js','../src/sentences.js','../src/sentence-groups.js','../src/document.js','../src/semantic-blocks.js']
    .map(p=>readFile(new URL(p,import.meta.url))))));

async function build(key,i,doc,bank) {
    const stem=join(root,key,String(i)), archive=join(cache,'hierarchy-probes','indexes',key,String(i));
    const previous=JSON.parse(gunzipSync(await readFile(archive+'.json.gz')));
    assert.equal(previous.model,model,'Archived vectors must use the configured embedding model');
    assert.equal(previous.dimension,dimension,'Archived vectors must use the configured dimension');
    const stamp=sha256(fileHash+previous.vectorSHA256+sha256(doc.raw)+JSON.stringify(outlines[key][i]));
    try {
        const cached=JSON.parse(gunzipSync(await readFile(stem+'.json.gz')));
        if(cached.stamp===stamp && sha256(await readFile(stem+'.f32'))===cached.vectorHash) return;
    } catch(e) { if(e.code!=='ENOENT') throw e; }
    const blob=await readFile(archive+'.f32');
    assert.equal(sha256(blob),previous.vectorSHA256);
    const archived=new Map();
    function loadRows(hashes,bytes) {
        hashes.forEach((h,i)=>archived.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+i*dimension*4,dimension)));
    }
    loadRows(previous.hashes,blob);
    if (settingsStudy) {
      for (const directory of (upperControls?[bounded,join(cache,'structural-limits')]:[bounded])) {
        const priorStem=join(directory,key,String(i));
        const ix=JSON.parse(gunzipSync(await readFile(priorStem+'.json.gz')));
        const priorBytes=await readFile(priorStem+'.f32');
        assert.equal(sha256(priorBytes),ix.vectorHash);
        loadRows(ix.hashes,priorBytes);
      }
    }
    const vectors=new Map(), counts=new Map(), directions=new Map();
    function count(s) {
        if(!counts.has(s)) counts.set(s,bank.countTokens(s));
        return counts.get(s);
    }
    async function embed(texts) {
        const missing=[];
        for (const s of new Set(texts)) {
            if (vectors.has(s)) continue;
            const row=archived.get(sha256(s));
            if (row===undefined) missing.push(s);
            else vectors.set(s,row);
        }
        if (missing.length) {
            const fresh=await bank.embed(missing);
            missing.forEach((s,j)=>vectors.set(s,fresh[j]));
        }
        return texts.map(s=>vectors.get(s));
    }
    function direction(s) {
        if(!directions.has(s)) directions.set(s,vectorDirection(vectors.get(s)));
        return directions.get(s);
    }
    const inputs=new Map();
    function id(s) {
        if(!inputs.has(s)) inputs.set(s,inputs.size);
        return inputs.get(s);
    }
    const {options:opts,mapping}=await sourceOptions(doc,outlines[key][i].headings,count);
    const canonical=canonicalMapper(mapping);
    const views=[], viewIds=new Map(), layouts={};
    function addView(parts,cap) {
        const view=joinViews(parts.filter(v=>v?.text),'\n\n'), tokens=count(view.text);
        assert.ok(tokens<=cap,'Returned passage exceeds cap');
        const raw=sourceSpans(view),sig=JSON.stringify([tokens,raw]);
        if (!viewIds.has(sig)) {
            viewIds.set(sig,views.length);
            views.push({raw,ranges:canonical(raw),tokens});
        }
        return viewIds.get(sig);
    }
    const sectionKeys=new Set();
    for (const [plan,options] of configs) {
        const target=options.maxChunkSize;
        const parsed=await chunkDocument(doc.raw,{...opts,...options,maxPassageSize:2048,
            ...(options.strategy.startsWith('semantic')?{embedBatch:embed}:{})});
        const spans=parsed.nodes.map(sourceSpans);
        const paragraphs=parsed.nodes.filter(n=>n.type==='paragraph');
        const paragraphCounts=new Uint32Array(parsed.nodes.length);
        for(const n of paragraphs) for(let p=n.parentId;p!==null;p=parsed.nodes[p].parentId) paragraphCounts[p]++;
        const spanSize=s=>s.reduce((total,[a,b])=>total+b-a,0);
        const sections=parsed.nodes.filter(n=>['section','article'].includes(n.type) && n.text &&
            (n.retrievalOnly ? paragraphs.filter(p=>covers(spans[n.id],spans[p.id])).length>=2 : paragraphCounts[n.id]>=2))
            .sort((a,b)=>spanSize(spans[a.id])-spanSize(spans[b.id]));
        for(const n of sections) sectionKeys.add(id(n.text));
        if (!settingsStudy) await embed(parsed.nodes.filter(n=>n.type==='sentence' && n.text).map(n=>n.text));
        layouts[plan]=parsed.chunks.map((chunk,j)=>{
            assert.ok(!chunk.tokenLimitExceeded && count(chunk.text)<=target);
            const geometry=sourceSpans(chunk);
            const pa=chunk.nodeIds.filter(k=>parsed.nodes[k].type==='paragraph' && !covers(spans[k],geometry)).map(k=>id(parsed.nodes[k].text));
            if (Number.isFinite(options.maxStructuralSize) && pa.length>=2) {
                assert.ok(count(chunk.text)<=options.maxStructuralSize,'Multi-paragraph structural core exceeds its limit');
            }
            const strict=n=>!covers(sourceSpans(n),geometry);
            const detail={};
            if (!settingsStudy) {
                const sentences=chunkSentences(parsed,chunk);
                detail.sentence=sentences.map(s=>s.node).filter(strict).map(n=>id(n.text));
                for (const [g,settings] of Object.entries(groupings)) {
                    detail[g]=sentenceGroups(chunk,sentences,settings,direction).filter(strict).map(n=>id(n.text));
                }
            }
            const section=sections.find(n=>covers(spans[n.id],geometry) && !covers(geometry,spans[n.id]) && !covers(spans[n.id],spans[0]));
            const core=id(chunk.text), bare=addView([chunk],target), windows={};
            for(const cap of (settingsStudy?protocol.passageCaps:[512,1024,2048]).filter(c=>c>=target)) {
                const parts=chunkContextParts(parsed,j,1,s=>count(s)<=cap);
                windows[cap]={view:addView(parts,cap),sides:settingsStudy?[]:[parts[0],parts[2]].filter(v=>v?.text).map(v=>id(v.text))};
            }
            return {core,pa,detail,section:section?id(section.text):-1,bare,windows};
        });
    }
    const qs=doc.questions.filter(q=>q.kind!=='section').map(q=>({...q,v:id(q.text)}));
    const texts=[...inputs.keys()], matrix=await embed(texts);
    const bytes=Buffer.concat(matrix.map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
    const info={stamp,model,dimension,id:doc.id,sourceTokens:count(doc.source),hashes:texts.map(sha256),
        vectorHash:sha256(bytes),views,layouts,qs,sections:[...sectionKeys]};
    await writeFile(stem+'.f32.tmp',bytes);
    await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(info)));
    await rename(stem+'.json.gz.tmp',stem+'.json.gz');
}

const args=process.argv.slice(2).filter(s=>s!=='--structural-limits' && s!=='--upper-controls');
for (const [key,meta] of Object.entries(registry)) {
    if(args.length && !args.includes(key) && !args.includes(meta.fold)) continue;
    await mkdir(join(root,key),{recursive:true});
    const data=JSON.parse(await readFile(join(old,meta.fold==='fresh'?'audited-data':'data',key+'.json')));
    const bank=await openReplay(undefined,join(bounded,'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        const batchSize=settingsStudy ? 4 : 1;
        for(let i=0;i<data.docs.length;i+=batchSize) {
            await Promise.all(data.docs.slice(i,i+batchSize).map((doc,j)=>build(key,i+j,doc,bank)));
        }
        console.log(key,data.docs.length);
    } finally {bank.close();}
}
