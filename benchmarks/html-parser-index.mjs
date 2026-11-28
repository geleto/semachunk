import assert from 'node:assert/strict';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {alignWhitespace,sourceSpans} from '../src/citations.js';
import {cache,here,sha256} from './corpora.mjs';
import {dimension,model,openReplay} from './encoder.mjs';
import {canonicalMapper} from './bounded-source.mjs';
import {convertGovernmentPage} from './html-markdown-source.mjs';
import {semachunkLayout} from './html-retrieval-layout.mjs';

const external = process.argv.includes('--external'), legacy = process.argv.includes('--legacy');
assert.ok(!legacy || external);
const moduleRoot = legacy ? './.cache/html-parser/base/src/' : '../src/';
const {chunkDocument} = await import(moduleRoot+'index.js');
const {parseTextTree} = await import(moduleRoot+'sentences.js');
const output = join(cache,'html-parser',legacy?'legacy':'current');
const zipped = async file => JSON.parse(gunzipSync(await readFile(file)));
const edition = JSON.parse(await readFile(join(here,'results/2026-11-27-prose-reviewed-data.json')));
const inputs = external ? [['external-html',{sha256:null}]] :
    Object.entries(edition.sets).filter(([key])=>/^government-(development|confirmation)-reviewed-\w+-html$/u.test(key));
const files = ['index.js','sentences.js','hierarchy.js','html-citations.js','markdown-units.js','markdown-merge.js','document.js','semantic-blocks.js','citations.js','token-limit.js'];
if (!legacy) files.push('html.js','structured-units.js','structured-chunks.js');
const version = sha256(Buffer.concat(await Promise.all([import.meta.url,'./html-retrieval-layout.mjs','./centered-passage.mjs',
    ...files.map(f=>moduleRoot+f)].map(f=>readFile(new URL(f,import.meta.url))))));

async function build(key, doc, i, bank) {
    const stem = join(output,key,String(i)), stamp = sha256(JSON.stringify([version,model,dimension,doc]));
    try {
        const saved = await zipped(stem+'.json.gz');
        if (saved.stamp===stamp && saved.vectorHash===sha256(await readFile(stem+'.f32'))) return;
    } catch (e) {if (e.code!=='ENOENT') throw e;}
    const texts = new Map(), rows = [], views = [], layouts = {}, tree = {}, frozen = new Map();
    function keyFor(text) {
        if (!texts.has(text)) texts.set(text,rows.length+texts.size);
        return texts.get(text);
    }
    let qs = doc.questions.filter(q=>q.kind!=='section');
    if (!external) {
        const old = join(cache,'html-markdown',key,String(i));
        const archived = await zipped(old+'.json.gz'), bytes = await readFile(old+'.f32');
        assert.equal(archived.model,model); assert.equal(archived.dimension,dimension);
        assert.equal(archived.vectorHash,sha256(bytes));
        assert.deepEqual(qs,archived.qs.map(({v,...q})=>q));
        for (const q of archived.qs) rows.push(bytes.subarray(q.v*dimension*4,(q.v+1)*dimension*4));
        qs = qs.map((q,v)=>({...q,v}));
        // The original Student Aid study preferred its document's stored vector
        // for identical text. A later provider response can change a close tie.
        if (key.endsWith('-studentaid-html')) {
            const prefix=join(cache,'paragraph-ranking',key,String(i));
            const keys=await zipped(prefix+'.json.gz'), raw=await readFile(prefix+'.f32');
            assert.equal(keys.model,model); assert.equal(keys.vectorHash,sha256(raw));
            keys.hashes.forEach((h,j)=>frozen.set(h,new Float32Array(raw.buffer,raw.byteOffset+j*dimension*4,dimension)));
        }
    } else qs = qs.map(q=>({...q,v:keyFor(q.text)}));
    async function embed(input) {
        if (!frozen.size) return bank.embed(input);
        const hashes=input.map(sha256), missing=input.filter((_,j)=>!frozen.has(hashes[j]));
        if (missing.length) {
            const vectors=await bank.embed(missing);
            missing.forEach((t,j)=>frozen.set(sha256(t),vectors[j]));
        }
        return hashes.map(h=>frozen.get(h));
    }
    const parsed = await parseTextTree(doc.raw,{inputFormat:'html'},true);
    const visible = alignWhitespace(parsed.view,doc.source);
    for (const format of external?['html']:['html','markdown']) {
        const converted = format==='markdown' && convertGovernmentPage(doc);
        const raw = converted ? converted.markdown : doc.raw;
        const canonical = converted ? converted.canonical : canonicalMapper(visible.citations);
        const options = {format,sourceId:doc.id,includeHierarchy:true,returnEmbedding:false,sizeUnit:'tokens',
            countTokens:bank.countTokens,maxStructuralSize:256,maxPassageSize:512};
        const blocks = await chunkDocument(raw,{...options,strategy:'blocks',maxChunkSize:256});
        const semantic = await chunkDocument(raw,{...options,strategy:'semantic-blocks',maxChunkSize:512,
            similarityThreshold:.15,joinParagraphs:true,embedBatch:embed});
        tree[format] = {};
        for (const n of blocks.nodes) tree[format][n.type]=(tree[format][n.type]??0)+1;
        function addView(p) {
            const original = sourceSpans(p), ranges=canonical(original), tokens=bank.countTokens(p.text);
            assert.ok(tokens>0 && tokens<=512 && ranges.length,doc.id);
            assert.ok(original.every(([a,b])=>a>=0 && a<b && b<=raw.length));
            views.push({raw:original,ranges,tokens});
            return views.length-1;
        }
        for (const [name,document] of [['blocks',blocks],['semantic',semantic]]) {
            layouts[format+'/'+name]=semachunkLayout(document,blocks,keyFor,addView,bank.countTokens,name==='semantic');
        }
    }
    const vectors=await embed([...texts.keys()]);
    for(const v of vectors) rows.push(Buffer.from(v.buffer,v.byteOffset,v.byteLength));
    const bytes=Buffer.concat(rows);
    const ix={id:doc.id,model,dimension,stamp,vectorHash:sha256(bytes),sourceHash:sha256(doc.source),htmlHash:sha256(doc.raw),qs,layouts,tree,views};
    await writeFile(stem+'.f32.tmp',bytes); await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(ix))); await rename(stem+'.json.gz.tmp',stem+'.json.gz');
}

for (const [key,record] of inputs) {
    const bytes=await readFile(external?join(cache,'html-parser/external-html.json'):join(cache,'prose-reviewed',key+'.json'));
    if (record.sha256) assert.equal(sha256(bytes),record.sha256);
    const docs=JSON.parse(bytes);
    await mkdir(join(output,key),{recursive:true});
    const bank=await openReplay(undefined,join(cache,'html-markdown','vectors',key),{lengthSafe:true,concurrency:3});
    try {
        for (let i=0;i<docs.length;i+=3) await Promise.all(docs.slice(i,i+3).map((d,j)=>build(key,d,i+j,bank)));
        console.log(key,docs.length,'documents;',bank.stats.apiInputTokens,'new tokens');
    } finally {bank.close();}
}
