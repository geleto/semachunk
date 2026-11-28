// Replay the two published layouts on every non-HTML validation source.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {sourceSpans,joinViews} from '../src/citations.js';
import {chunkContextParts,passageFits} from '../src/document.js';
import {chunkDocument as baseChunkDocument} from './.cache/html-parser/base/src/index.js';
import {sourceOptions} from './bounded-source.mjs';
import {centeredPassage} from './centered-passage.mjs';
import {cache,sha256} from './corpora.mjs';
import {openReplay,dimension} from './encoder.mjs';

const read=async file=>JSON.parse(await readFile(file)), zip=async file=>JSON.parse(gunzipSync(await readFile(file)));
const ranking=join(cache,'paragraph-ranking'), mixtures=join(cache,'context-mixtures'), bounded=join(cache,'bounded-passages');
const registry={...await read(join(mixtures,'data/manifest.json')),...await read(join(ranking,'holdout-data/manifest.json'))};
const headings=await read(join(cache,'scope-weights/source-headings.json'));
const counts={documents:0,blocks:0,semantic:0};

async function verify(key,i,doc,bank) {
    const stem=join(cache,'neighbor-threshold',key,String(i));
    const saved=await zip(stem+'.json.gz'), wide=await zip(stem+'.budget.json.gz');
    const vectors=new Map();
    async function reuse(file,detail=false) {
        const ix=await zip(file+'.json.gz'),bytes=await readFile(file+'.f32');
        assert.equal(sha256(bytes),detail?ix.hash:ix.vectorHash??ix.vectorSHA256);
        for (const [j,h] of ix.hashes.entries()) vectors.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension));
    }
    const original=join(ranking,key,String(i));
    await reuse(original);await reuse(original+'.detail',true);
    if (saved.originalEdges) {
        vectors.clear();
        for (const folder of [join(cache,'hierarchy-probes/indexes'),bounded,join(cache,'structural-limits')]) await reuse(join(folder,key,String(i)));
    }
    async function embed(texts) {
        const missing=texts.filter(t=>!vectors.has(sha256(t)));
        if (missing.length) {
            const fresh=await bank.embed(missing);
            missing.forEach((t,j)=>vectors.set(sha256(t),fresh[j]));
        }
        return texts.map(t=>vectors.get(sha256(t)));
    }
    const {options}=await sourceOptions(doc,headings[key]?.[i]?.headings??[],bank.countTokens);
    for (const [strategy,label] of [['blocks','blocks'],['semantic-blocks','0.15']]) {
        const semantic=strategy==='semantic-blocks';
        const opts={...options,strategy,maxChunkSize:semantic?512:256,maxPassageSize:512,maxStructuralSize:256,
            similarityThreshold:.15,joinParagraphs:semantic,embedBatch:embed};
        const actual=await chunkDocument(doc.raw,opts), previous=await baseChunkDocument(doc.raw,opts);
        assert.deepEqual(actual.nodes,previous.nodes,doc.id+' hierarchy');
        assert.deepEqual(actual.chunks,previous.chunks,doc.id+' '+strategy);
        const entries=saved.layouts[label], centered=semantic&&centeredPassage(actual,actual.chunks.map(c=>bank.countTokens(c.text)));
        assert.equal(actual.chunks.length,entries.length);
        for (const [j,c] of actual.chunks.entries()) {
            assert.deepEqual(sourceSpans(c),saved.views[entries[j].bare].raw);
            const parts=semantic?centered(j,'budget').parts:chunkContextParts(actual,j,1,passageFits(actual));
            const win=joinViews(parts.filter(p=>p?.text),'\n\n');
            const archived=semantic?wide.views[wide.layouts[label][j].budget.win]:saved.views[entries[j].win];
            assert.deepEqual(sourceSpans(win),archived.raw);
            assert.equal(bank.countTokens(win.text),archived.tokens);
        }
        counts[semantic?'semantic':'blocks']+=entries.length;
    }
    counts.documents++;
}
for(const [key,spec] of Object.entries(registry)) {
    if(spec.fold==='development') continue;
    const folder=spec.fold==='holdout'?join(ranking,'holdout-data'):join(mixtures,spec.fold==='fresh'?'audited-data':'data');
    const {docs}=await read(join(folder,key+'.json'));
    const bank=await openReplay(undefined,join(spec.fold==='holdout'?ranking:bounded,'vectors',key),{lengthSafe:true});
    try {
        for(let i=0;i<docs.length;i++) if(docs[i].format!=='html') await verify(key,i,docs[i],bank);
        console.log(key,counts.documents,'verified');
    } finally {bank.close();}
}
assert.equal(counts.documents,174);
await writeFile(join(cache,'html-parser/control-counts.json'),JSON.stringify(counts));
