// Rebuild standalone structural passages and both reading windows against the frozen question vectors.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {chunk,search} from '../src/index.js';
import {alignWhitespace,joinViews,sourceSpans} from '../src/citations.js';
import {chunkContextParts,passageFits} from '../src/document.js';
import {parseTextTree} from '../src/sentences.js';
import {canonicalMapper,sourceOptions} from './bounded-source.mjs';
import {cache,sha256} from './corpora.mjs';
import {dimension,model,openReplay} from './encoder.mjs';
import {semachunkLayout} from './html-retrieval-layout.mjs';

const study=join(cache,'blocks-retrieval'), mixtures=join(cache,'context-mixtures'), ranking=join(cache,'paragraph-ranking');
const sizeArg=process.argv.slice(2).find(s=>s.startsWith('--core='));
const coreLimit=sizeArg?Number(sizeArg.slice(7)):256;
assert.ok([256,384,512].includes(coreLimit));
const root=coreLimit===256?study:join(study,String(coreLimit));
const json=async f=>JSON.parse(await readFile(f));
const zipped=async f=>JSON.parse(gunzipSync(await readFile(f)));
const registry={...await json(join(mixtures,'data/manifest.json')),...await json(join(ranking,'holdout-data/manifest.json'))};
const outlines=await json(join(cache,'scope-weights/source-headings.json'));

async function blocksDocument(source,headings,countTokens,embedBatch) {
    const setup=source.format==='html' ? {
        options:{format:'html',sourceId:source.id},
        mapping:alignWhitespace((await parseTextTree(source.raw,{inputFormat:'html'},true)).view,source.source).citations
    } : await sourceOptions(source,headings,countTokens);
    const doc=await chunk(source.raw,{...setup.options,strategy:'blocks',sizeUnit:'tokens',countTokens,
        maxChunkSize:coreLimit,maxStructuralSize:256,maxPassageSize:512,returnEmbedding:false,
        index:Boolean(embedBatch),embedBatch});
    return {doc,canonical:canonicalMapper(setup.mapping)};
}

async function build(key,i,source,fold,bank) {
    const dev=fold==='development';
    const alternate=coreLimit!==256;
    const stem=join(dev||alternate?ranking:join(cache,'mastra-finalists'),key,String(i));
    const frozen=await zipped(stem+'.json.gz'), bytes=await readFile(stem+'.f32');
    assert.equal(frozen.id,source.id);
    assert.equal(frozen.model,model);
    assert.equal(frozen.dimension,dimension);
    assert.equal(sha256(bytes),frozen.vectorHash);
    const row=j=>new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension);
    const {doc,canonical}=await blocksDocument(source,outlines[key]?.[i]?.headings??[],bank.countTokens);
    const keys=new Map(),views=[],viewIds=new Map();
    function keyFor(text,node) {
        const heading=node?.headingPath?.at(-1)?.trim(), input=heading?heading+'\n\n'+text:text;
        if (!keys.has(input)) keys.set(input,keys.size);
        return keys.get(input);
    }
    function addView(p) {
        const raw=sourceSpans(p), ranges=canonical(raw), tokens=bank.countTokens(p.text);
        assert.ok(tokens>0 && tokens<=512 && ranges.length && ranges.every(([a,b])=>a>=0 && a<b && b<=source.source.length));
        const view={raw,ranges,tokens}, id=JSON.stringify(view);
        if (!viewIds.has(id)) {viewIds.set(id,views.length);views.push(view);}
        return viewIds.get(id);
    }
    const chunks=semachunkLayout(doc,doc,keyFor,addView,bank.countTokens,false), fits=passageFits(doc,bank.countTokens);
    chunks.forEach((c,j)=>{
        const immediate=chunkContextParts(doc,j,1,fits);
        c.near=[0,2].filter(side=>immediate[side]?.text).map(side=>j+side-1);
        const wide=chunkContextParts(doc,j,1,fits,bank.countTokens);
        c.wide=addView(joinViews(wide.filter(p=>p?.text),'\n\n'));
    });
    const texts=[...keys.keys()], vectors=Array(texts.length);
    if (dev || alternate) {
        const known=new Map(frozen.hashes.map((h,j)=>[h,row(j)])), missing=[];
        if (alternate) {
            const original=join(study,key,String(i)), base=await zipped(original+'.json.gz'), raw=await readFile(original+'.f32');
            assert.equal(sha256(raw),base.vectorHash);
            assert.deepEqual(base.qs.map(q=>q.id),frozen.qs.map(q=>q.id));
            base.hashes.forEach((h,j)=>known.set(h,new Float32Array(raw.buffer,raw.byteOffset+j*dimension*4,dimension)));
            for (const [j,q] of base.qs.entries()) {
                assert.ok(raw.subarray(q.v*dimension*4,(q.v+1)*dimension*4).equals(
                    bytes.subarray(frozen.qs[j].v*dimension*4,(frozen.qs[j].v+1)*dimension*4)));
            }
        }
        for (const [j,t] of texts.entries()) {
            const prev=known.get(sha256(t));
            if (prev===undefined) missing.push(t); else vectors[j]=prev;
        }
        const fetched=missing.length?await bank.embed(missing):[];
        missing.forEach((t,j)=>{vectors[keys.get(t)]=fetched[j];});
    } else {
        // Use the exact heading-aware vectors from the finalist after matching every occurrence.
        const previous=frozen.layouts.blocks;
        assert.equal(previous.length,chunks.length);
        chunks.forEach((c,j)=>{
            const p=previous[j];
            assert.deepEqual(views[c.bare],frozen.views[p.bare]);
            assert.deepEqual(views[c.win],frozen.views[p.win]);
            assert.equal(c.pa.length,p.pa.length);
            assert.equal(c.section<0,p.section<0);
            vectors[c.v]=row(p.v);
            c.pa.forEach((v,k)=>{vectors[v]=row(p.pa[k]);});
            if (c.section>=0) vectors[c.section]=row(p.section);
        });
    }
    assert.ok(Array.from(vectors).every(v=>v?.length===dimension));
    const qs=frozen.qs.map(q=>({...q,v:vectors.push(row(q.v))-1}));
    const output=Buffer.concat(vectors.map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
    const ix={id:source.id,model,dimension,vectorHash:sha256(output),hashes:texts.map(sha256),qs,views,
        geometry:{blocks:{chunks:chunks.length}},layouts:{blocks:chunks}};
    const dest=join(root,key,String(i));
    await writeFile(dest+'.f32',output);
    await writeFile(dest+'.json.gz',gzipSync(JSON.stringify(ix)));
}

async function sources(key,fold) {
    const dir=fold==='holdout'?join(ranking,'holdout-data'):join(mixtures,fold==='fresh'?'audited-data':'data');
    return (await json(join(dir,key+'.json'))).docs;
}

async function verify(profile,bank) {
    for (const fold of ['confirmation','fresh','holdout']) {
        const all=[], groups=[];
        for (const [key,spec] of Object.entries(registry)) {
            if (spec.fold!==fold) continue;
            const collection=[];
            for (const [i,source] of (await sources(key,fold)).entries()) {
                const stem=join(root,key,String(i)), ix=await zipped(stem+'.json.gz'), bytes=await readFile(stem+'.f32');
                assert.equal(sha256(bytes),ix.vectorHash);
                const row=j=>new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension);
                const ids=new Map(ix.hashes.map((h,j)=>[h,j]));
                const embedBatch=async texts=>{
                    const missing=texts.filter(t=>!ids.has(sha256(t)));
                    const extra=missing.length?await bank.embed(missing):[], extras=new Map(missing.map((t,j)=>[t,extra[j]]));
                    return texts.map(t=>extras.get(t)??row(ids.get(sha256(t))));
                };
                const {doc}=await blocksDocument(source,outlines[key]?.[i]?.headings??[],bank.countTokens,embedBatch);
                const item={doc,qs:ix.qs.map(q=>({id:q.id,vector:row(q.v)}))};
                collection.push(item);
                all.push(item);
            }
            groups.push(...(spec.pool==='collection'?[collection]:collection.map(d=>[d])));
        }
        const scopes=[[fold,groups]];
        if (fold!=='confirmation') scopes.push(['shared-'+fold,[all]]);
        for (const [scope,pools] of scopes) {
            const ref=await zipped(join(root,scope+'-verify.json.gz')), hashes=ref.profiles[profile];
            assert.ok(hashes,'Unknown benchmark profile '+profile);
            let i=0;
            for (const group of pools) {
                const docs=group.map(d=>d.doc);
                for (const {doc,qs} of group) for (const q of qs) {
                    assert.deepEqual(ref.questions[i].slice(1),[doc.sourceId,q.id]);
                    const hits=await search(docs,q.vector);
                    const cited=hits.map(h=>[h.sourceId,sourceSpans(h.context),bank.countTokens(h.context.text)]);
                    assert.equal(sha256(JSON.stringify(cited)),hashes[i++],scope+' '+doc.sourceId+' '+q.id);
                }
            }
            assert.equal(i,hashes.length);
            console.log(scope,i,'public top fives matched');
        }
    }
}

const args=process.argv.slice(2).filter(s=>s!==sizeArg);
const bank=await openReplay(undefined,join(cache,'html-parser/format-comparison/heading-embedding-cache'),{lengthSafe:true});
try {
    if (args[0]==='verify') {
        await verify(args[1],bank);
    } else {
        for (const [key,spec] of Object.entries(registry)) {
            if (args.length && !args.includes(spec.fold)) continue;
            const docs=await sources(key,spec.fold);
            await mkdir(join(root,key),{recursive:true});
            for (const [i,source] of docs.entries()) await build(key,i,source,spec.fold,bank);
            console.log(key,docs.length,'sources;',bank.stats.apiInputTokens,'new embedding tokens');
        }
    }
} finally {bank.close();}
