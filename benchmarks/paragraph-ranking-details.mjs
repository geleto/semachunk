import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {chunkDocument} from '../src/index.js';
import {covers,sourceSpans} from '../src/citations.js';
import {chunkSentences,sentenceGroups} from '../src/sentence-groups.js';
import {vectorDirection} from '../src/similarity.js';
import {sourceOptions} from './bounded-source.mjs';
import {cache,sha256} from './corpora.mjs';
import {dimension,openReplay} from './encoder.mjs';

const root=join(cache,'paragraph-ranking'), old=join(cache,'context-mixtures');
const read=async f=>JSON.parse(await readFile(f));
const registry={...await read(join(old,'data/manifest.json')),...await read(join(root,'holdout-data/manifest.json'))};
const outlines=await read(join(cache,'scope-weights/source-headings.json'));
const families=new Set(['B256u256','T512u256t0.15j']);
for(const file of ['selection.json','compact-selection.json']) {
    const selected=await read(join(root,file));
    for(const c of Object.values(selected.nominees)) {
        for(const p of c.policy?[c.base,c.alt]:[c]) for(const l of p.layouts) families.add(l);
    }
}
function options(label) {
    const [,type,target,upper,t,join]=/^([BT])(\d+)u(\d+)(?:t([.\d]+|cal)([js]))?$/.exec(label);
    return {maxChunkSize:+target,maxStructuralSize:+upper,maxPassageSize:512,strategy:type==='B'?'blocks':'semantic-blocks',
        ...(type==='T'?{joinParagraphs:join==='j',similarityThreshold:t==='cal' ? .15 : +t,mergeThresholdMode:t==='cal'?'document':'fixed'}:{})};
}
const suffix='-'+sha256(JSON.stringify([...families])).slice(0,10);
const args=process.argv.slice(2);
for(const [key,meta] of Object.entries(registry)) {
    if(args.length && !args.includes(meta.fold))continue;
    const directory=meta.fold==='holdout'?join(root,'holdout-data'):join(old,meta.fold==='fresh'?'audited-data':'data');
    const {docs}=await read(join(directory,key+'.json'));
    const bank=await openReplay(undefined,join(meta.fold==='holdout'?root:join(cache,'bounded-passages'),'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        async function build(doc,i) {
            const stem=join(root,key,String(i));
            const ix=JSON.parse(gunzipSync(await readFile(stem+'.json.gz')));
            const bytes=await readFile(stem+'.f32');
            assert.equal(sha256(bytes),ix.vectorHash);
            const stamp=ix.stamp+suffix;
            try {
                const previous=JSON.parse(gunzipSync(await readFile(stem+'.detail.json.gz')));
                if(previous.stamp===stamp && sha256(await readFile(stem+'.detail.f32'))===previous.hash)return;
            } catch(e){if(e.code!=='ENOENT')throw e;}
            const ids=new Map(ix.hashes.map((h,j)=>[h,j])), extra=new Map(), memory=new Map(), archival=new Map();
            if(meta.fold!=='holdout'){
                const b=join(cache,'bounded-passages',key,String(i)), cacheIx=JSON.parse(gunzipSync(await readFile(b+'.json.gz'))), blob=await readFile(b+'.f32');
                assert.equal(sha256(blob),cacheIx.vectorHash);
                cacheIx.hashes.forEach((h,j)=>archival.set(h,new Float32Array(blob.buffer,blob.byteOffset+j*dimension*4,dimension)));
            }
            function id(s) {
                const h=sha256(s);
                if(ids.has(h))return ids.get(h);
                if(!extra.has(s))extra.set(s,ix.hashes.length+extra.size);
                return extra.get(s);
            }
            async function embed(texts) {
                const missing=[];
                for(const s of new Set(texts)) {
                    if(memory.has(s))continue;
                    const h=sha256(s), j=ids.get(h);
                    if(j!==undefined)memory.set(s,new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension));
                    else if(archival.has(h))memory.set(s,archival.get(h));
                    else missing.push(s);
                }
                const fetched=missing.length?await bank.embed(missing):[];
                missing.forEach((s,j)=>memory.set(s,fetched[j]));
                return texts.map(s=>memory.get(s));
            }
            const {options:base}=await sourceOptions(doc,outlines[key]?.[i]?.headings??[],bank.countTokens);
            const small={},directions=new Map();
            function direction(s) {
                if(!directions.has(s))directions.set(s,vectorDirection(memory.get(s)));
                return directions.get(s);
            }
            for(const label of families) {
                const d=await chunkDocument(doc.raw,{...base,...options(label),embedBatch:embed});
                await embed(d.nodes.filter(n=>n.type==='sentence'&&n.text).map(n=>n.text));
                small[label]=d.chunks.map((c,j)=>{
                    assert.equal(sha256(c.text),ix.hashes[ix.layouts[label][j].v]);
                    const geometry=sourceSpans(c), ss=chunkSentences(d,c);
                    const strict=nodes=>nodes.filter(n=>!covers(sourceSpans(n),geometry)).map(n=>id(n.text));
                    return {sentence:strict(ss.map(s=>s.node)),triple:strict(sentenceGroups(c,ss,{maxSentences:3})),
                        group25:strict(sentenceGroups(c,ss,{maxSentences:3,threshold:.25},direction))};
                });
            }
            const texts=[...extra.keys()], matrix=await embed(texts);
            const blob=Buffer.concat(matrix.map(v=>Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
            await writeFile(stem+'.detail.f32.tmp',blob);
            await rename(stem+'.detail.f32.tmp',stem+'.detail.f32');
            await writeFile(stem+'.detail.json.gz.tmp',gzipSync(JSON.stringify({stamp,hash:sha256(blob),hashes:texts.map(sha256),small})));
            await rename(stem+'.detail.json.gz.tmp',stem+'.detail.json.gz');
        }
        await mkdir(join(root,key),{recursive:true});
        for(let i=0;i<docs.length;i+=3)await Promise.all(docs.slice(i,i+3).map((d,j)=>build(d,i+j)));
        console.log(key);
    } finally {bank.close();}
}
