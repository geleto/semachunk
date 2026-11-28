import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {buildMastraLayouts} from './mastra-layouts.mjs';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {canonicalMapper, sourceOptions} from './bounded-source.mjs';
import {cache, sha256} from './corpora.mjs';
import {encodingName, dimension, model, openReplay} from './encoder.mjs';

const root=join(cache,'mastra-comparison'), ranking=join(cache,'paragraph-ranking'), mixtures=join(cache,'context-mixtures');
const json=async path=>JSON.parse(await readFile(path)), unzip=async path=>JSON.parse(gunzipSync(await readFile(path)));
const protocol=await json(new URL('./mastra-protocol.json',import.meta.url));
const version=await json(join(root,'deps/node_modules/@mastra/rag/package.json'));
assert.equal(version.name+'@'+version.version,protocol.package);
assert.equal(model,protocol.model);
assert.equal(dimension,protocol.dimensions);
assert.equal(encodingName,protocol.encoding);
const registry={...await json(join(mixtures,'data/manifest.json')), ...await json(join(ranking,'holdout-data/manifest.json'))};
const outlines=await json(join(cache,'scope-weights/source-headings.json'));
const revision=sha256(Buffer.concat(await Promise.all([import.meta.url,'./mastra-layouts.mjs','./mastra-protocol.json','./bounded-source.mjs'].map(f=>readFile(new URL(f,import.meta.url))))));
const all=protocol.families.flatMap(f=>protocol.sizes.flatMap(s=>[...protocol.overlapPercent,...(s===512?protocol.extra512OverlapPercent:[])].map(o=>[f,s,o].join('/'))));
const [fold,collection]=process.argv.slice(2);
assert.ok(['development','confirmation','fresh','holdout'].includes(fold));
const labels=fold==='development'?all:(await json(join(root,'selection.json'))).layouts;
const limit=protocol.passageTokens;

async function build(key,i,doc,bank) {
    const stem=join(root,key,String(i)),previousStem=join(ranking,key,String(i));
    const previous=await unzip(previousStem+'.json.gz');
    const stamp=sha256(JSON.stringify([revision,previous.vectorHash,sha256(doc.source),sha256(doc.raw),labels]));
    try{
        const ix=await unzip(stem+'.json.gz');
        if(ix.stamp===stamp && sha256(await readFile(stem+'.f32'))===ix.vectorHash) return;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    assert.equal(previous.id,doc.id);
    assert.equal(previous.model,model);
    const old=await readFile(previousStem+'.f32');
    assert.equal(sha256(old),previous.vectorHash);
    const oldRows=new Map(previous.hashes.map((h,j)=>[h,j]));
    const rows=[],keys=new Map(),missing=[],missingIndices=[];
    function existing(index) {
        const hash=previous.hashes[index];
        if(!keys.has(hash)) {
            keys.set(hash,rows.length);
            rows.push(old.subarray(index*dimension*4,(index+1)*dimension*4));
        }
        return keys.get(hash);
    }
    function keyFor(text) {
        const hash=sha256(text);
        if(keys.has(hash)) return keys.get(hash);
        if(oldRows.has(hash)) return existing(oldRows.get(hash));
        const index=rows.length;
        keys.set(hash,index);missing.push(text);missingIndices.push(index);rows.push(null);
        return index;
    }
    const qs=previous.qs.map(q=>({...q,v:existing(q.v)}));
    const {options,mapping}=await sourceOptions(doc,outlines[key]?.[i]?.headings??[],bank.countTokens);
    const canonical=canonicalMapper(mapping);
    const structure=await chunkDocument(doc.raw,{...options,strategy:'blocks',maxChunkSize:256,maxStructuralSize:256,maxPassageSize:limit});
    const viewIds=new Map(),views=[];
    function view(a,b,tokens) {
        assert.ok(a>=0 && b>a && b<=doc.source.length && tokens>0 && tokens<=limit);
        const name=[a,b,tokens].join('/');
        if(!viewIds.has(name)) {viewIds.set(name,views.length);views.push({raw:[[a,b]],ranges:[[a,b]],tokens});}
        return viewIds.get(name);
    }
    const {layouts,geometry}=await buildMastraLayouts(doc,structure,canonical,bank,labels,view,keyFor);
    if(missing.length) {
        const vectors=await bank.embed(missing);
        vectors.forEach((v,j)=>rows[missingIndices[j]]=Buffer.from(v.buffer,v.byteOffset,v.byteLength));
    }
    const bytes=Buffer.concat(rows),ix={id:doc.id,model,dimension,stamp,vectorHash:sha256(bytes),views,qs,layouts,geometry};
    await writeFile(stem+'.f32.tmp',bytes);await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(ix)));await rename(stem+'.json.gz.tmp',stem+'.json.gz');
    console.log(key,i+1,rows.length,'vectors',bank.stats.apiInputTokens,'API tokens so far');
}

for(const [key,spec] of Object.entries(registry)) {
    if(spec.fold!==fold || collection && collection!==key) continue;
    const folder=fold==='holdout'?join(ranking,'holdout-data'):join(mixtures,fold==='fresh'?'audited-data':'data');
    const {docs}=await json(join(folder,key+'.json'));
    await mkdir(join(root,key),{recursive:true});
    const bank=await openReplay(undefined,join(root,'vectors',key),{lengthSafe:true,concurrency:4});
    try { for(const [i,doc] of docs.entries()) await build(key,i,doc,bank); }
    finally { bank.close(); }
}
