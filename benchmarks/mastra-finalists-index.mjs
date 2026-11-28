// Rebuild the established retrieval finalists against the same frozen query vectors.
import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {chunk} from '../src/index.js';
import {alignWhitespace, sourceSpans} from '../src/citations.js';
import {parseTextTree} from '../src/sentences.js';
import {canonicalMapper, sourceOptions} from './bounded-source.mjs';
import {cache, sha256} from './corpora.mjs';
import {dimension, model, openReplay} from './encoder.mjs';
import {semachunkLayout} from './html-retrieval-layout.mjs';
import {buildMastraLayouts} from './mastra-layouts.mjs';
import protocol from './mastra-protocol.json' with {type:'json'};

const root = join(cache,'mastra-finalists');
const ranking = join(cache,'paragraph-ranking');
const original = join(cache,'mastra-comparison');
const mixtures = join(cache,'context-mixtures');
const json = async file => JSON.parse(await readFile(file));
const zipped = async file => JSON.parse(gunzipSync(await readFile(file)));
const artifact = (dir,key,i) => join(dir,key,String(i));
const registry = {...await json(join(mixtures,'data/manifest.json')), ...await json(join(ranking,'holdout-data/manifest.json'))};
const outlines = await json(join(cache,'scope-weights/source-headings.json'));
const pkg = await json(join(original,'deps/node_modules/@mastra/rag/package.json'));
assert.equal(pkg.name+'@'+pkg.version,protocol.package);
assert.equal(model,protocol.model);
assert.equal(dimension,protocol.dimensions);
const selection = await json(join(original,'selection.json'));
const mastraLabels = [...new Set([selection.enhanced,...selection.two.split('+')].map(a=>a.split('@')[0]))];
const sourceFiles = (await readdir(new URL('../src/',import.meta.url))).filter(f=>f.endsWith('.js')).sort().map(f=>'../src/'+f);
const revision = sha256(Buffer.concat(await Promise.all([import.meta.url,'./html-retrieval-layout.mjs','./mastra-layouts.mjs',
    './bounded-source.mjs','./centered-passage.mjs','./mastra-protocol.json','../config.js',...sourceFiles].map(f=>readFile(new URL(f,import.meta.url))))));
const row = (bytes,j) => new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension);

async function readVectors(stem,ix) {
    const bytes = await readFile(stem+'.f32');
    assert.equal(sha256(bytes),ix.vectorHash??ix.vectorSHA256??ix.hash);
    return bytes;
}

async function build(doc,key,i,bank,splitBank) {
    const base = artifact(ranking,key,i), dest = artifact(root,key,i);
    const frozen = await zipped(base+'.json.gz');
    assert.equal(frozen.id,doc.id);
    assert.equal(frozen.model,model);
    const stamp = sha256(JSON.stringify([revision,pkg.version,mastraLabels,frozen.vectorHash,doc.raw,doc.source,outlines[key]?.[i]]));
    try {
        const ix = await zipped(dest+'.json.gz');
        if (ix.stamp===stamp) {await readVectors(dest,ix); return;}
    } catch (e) {if(e.code!=='ENOENT') throw e;}
    const known = new Map();
    async function seed(stem, ix, map) {
        const bytes = await readVectors(stem,ix);
        assert.equal(bytes.length,ix.hashes.length*dimension*4);
        ix.hashes.forEach((h,j)=>map.set(h,row(bytes,j)));
        return bytes;
    }
    const queries = await seed(base,frozen,known);
    const html = doc.format==='html';
    if (!html) await seed(base+'.detail',await zipped(base+'.detail.json.gz'),known);
    const semStem = artifact(join(cache,html?'html-parser/current':'neighbor-threshold'),key,i);
    const oldSem = await zipped(semStem+'.json.gz');
    const splitKeys = oldSem.originalEdges ? new Map() : known;
    if (oldSem.originalEdges) {
        for (const dir of ['hierarchy-probes/indexes','bounded-passages','structural-limits']) {
            const stem = artifact(join(cache,dir),key,i);
            await seed(stem,await zipped(stem+'.json.gz'),splitKeys);
        }
    }
    async function embed(texts,map=known,provider=bank) {
        const hashes = texts.map(sha256);
        const missing = new Map();
        hashes.forEach((h,j)=>{if(!map.has(h)) missing.set(h,texts[j]);});
        if (missing.size) {
            const vs = await provider.embed([...missing.values()]);
            [...missing.keys()].forEach((h,j)=>map.set(h,vs[j]));
        }
        return hashes.map(h=>map.get(h));
    }
    const {options,mapping} = html ? {
        options:{format:'html',sourceId:doc.id,includeHierarchy:true,returnEmbedding:false,sizeUnit:'tokens',countTokens:bank.countTokens},
        mapping:alignWhitespace((await parseTextTree(doc.raw,{inputFormat:'html'},true)).view,doc.source).citations
    } : await sourceOptions(doc,outlines[key]?.[i]?.headings??[],bank.countTokens);
    const canonical = canonicalMapper(mapping);
    const opts = {...options,maxStructuralSize:256,maxPassageSize:512};
    const combined = await chunk(doc.raw,{...opts,strategy:'semantic',maxChunkSize:512,
        similarityThreshold:.15,joinParagraphs:true,embedBatch:texts=>embed(texts,splitKeys,splitBank)});
    const blocks = {...combined,chunks:combined.chunks.filter(c=>c.layout==='blocks')};
    const semantic = {...combined,chunks:combined.chunks.filter(c=>c.layout==='semantic')};
    const texts = [], keys = new Map(), views = [], viewIds = new Map();
    function keyFor(text,node) {
        const heading = node?.headingPath?.at(-1)?.trim();
        const input = heading ? heading+'\n\n'+text : text;
        if (!keys.has(input)) {keys.set(input,texts.length);texts.push(input);}
        return keys.get(input);
    }
    function view(raw,ranges,tokens) {
        assert.ok(tokens>0 && tokens<=512 && ranges.length && ranges.every(([a,b])=>0<=a && a<b && b<=doc.source.length));
        const entry = {raw,ranges,tokens}, id = JSON.stringify(entry);
        if (!viewIds.has(id)) {viewIds.set(id,views.length);views.push(entry);}
        return viewIds.get(id);
    }
    function semView(part) {
        const raw = sourceSpans(part);
        return view(raw,canonical(raw),bank.countTokens(part.text));
    }
    const {layouts,geometry} = await buildMastraLayouts(doc,blocks,canonical,bank,mastraLabels,
        (a,b,n)=>view([[a,b]],[[a,b]],n),keyFor);
    layouts.blocks = semachunkLayout(blocks,blocks,keyFor,semView,bank.countTokens,false);
    layouts.semantic = semachunkLayout(semantic,blocks,keyFor,semView,bank.countTokens,true);
    for (const name of ['blocks','semantic']) geometry[name] = {chunks:layouts[name].length};

    // Reuse a historical core only after rebuilding and matching its source spans and token count.
    async function replayCores(stem,ix,labels) {
        assert.equal(ix.id,doc.id);
        const bytes = await readVectors(stem,ix);
        for (const [name,previous] of labels) {
            const before = ix.layouts[previous], after = layouts[name];
            assert.equal(after.length,before.length,doc.id+' '+name);
            after.forEach((c,j)=>{
                const a = views[c.bare], b = ix.views[before[j].bare];
                assert.deepEqual(a.raw,b.raw,doc.id+' '+name);
                assert.equal(a.tokens,b.tokens);
                known.set(sha256(texts[c.v]),row(bytes,before[j].v));
            });
        }
    }
    const mastraStem = artifact(original,key,i);
    await replayCores(mastraStem,await zipped(mastraStem+'.json.gz'),mastraLabels.map(l=>[l,l]));
    await replayCores(semStem,oldSem,[['blocks',html?'html/blocks':'blocks'],['semantic',html?'html/semantic':'0.15']]);
    const vs = await embed(texts);
    const qs = frozen.qs.map((q,j)=>({...q,v:vs.length+j}));
    const bytes = Buffer.concat([...vs,...frozen.qs.map(q=>row(queries,q.v))].map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
    const ix = {id:doc.id,format:doc.format,model,dimension,stamp,vectorHash:sha256(bytes),layouts,views,geometry,qs};
    await writeFile(dest+'.f32.tmp',bytes); await rename(dest+'.f32.tmp',dest+'.f32');
    await writeFile(dest+'.json.gz.tmp',gzipSync(JSON.stringify(ix))); await rename(dest+'.json.gz.tmp',dest+'.json.gz');
}

const [fold,collection] = process.argv.slice(2);
assert.ok(['confirmation','fresh','holdout'].includes(fold));
const bank = await openReplay(undefined,join(cache,'html-parser/format-comparison/heading-embedding-cache'),{lengthSafe:true,concurrency:3});
try {
    for (const [key,spec] of Object.entries(registry)) {
        if (spec.fold!==fold || collection && collection!==key) continue;
        const dir = fold==='holdout'?join(ranking,'holdout-data'):join(mixtures,fold==='fresh'?'audited-data':'data');
        const {docs} = await json(join(dir,key+'.json'));
        await mkdir(join(root,key),{recursive:true});
        // Reuse the original HTML edge embeddings when a similarity is close to the cutoff.
        const splitBank = docs.some(d=>d.format==='html') ?
            await openReplay(undefined,join(cache,'html-markdown/vectors',key),{lengthSafe:true}) : bank;
        try {for (const [i,doc] of docs.entries()) await build(doc,key,i,bank,splitBank);}
        finally {if (splitBank!==bank) splitBank.close();}
        console.log(key,docs.length,'sources built;',bank.stats.apiInputTokens,'new embedding tokens so far');
    }
} finally {bank.close();}
