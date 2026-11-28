// Run the public parser, chunker, retriever and citation renderer on replication
// sources. Cached vectors are looked up by complete input text.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createDocumentIndex} from '../src/index.js';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {parseTextTree} from '../src/sentences.js';
import {sliceView,sourceSpans} from '../src/citations.js';
import {cache,sha256} from './corpora.mjs';
import {dimension,openReplay} from './encoder.mjs';

const root = join(cache,'document-routing','public');
const registry = JSON.parse(await readFile(join(cache,'context-mixtures','data','manifest.json')));
const shards = Object.entries(registry).filter(([,v])=>v.fold==='fresh');
const bank = await openReplay(undefined,join(root,'vectors'),{lengthSafe:true,concurrency:3});
const lookupOnly = process.argv.includes('--documents-only');
const outlinesOnly = process.argv.includes('--source-headings');
const rangesOnly = process.argv.includes('--section-ranges');
const structureStudy = outlinesOnly || rangesOnly;
const outlines = JSON.parse(await readFile(join(cache,'scope-weights','source-headings.json')));
const archive = new Map(), vectors = new Map(), all = [], evidence = new Map(), domains = new Map();
const counters = {};
async function embed(texts) {
    const hashes = texts.map(sha256);
    const missing = [];
    for (const [i,key] of hashes.entries()) {
        if (vectors.has(key)) continue;
        if (archive.has(key)) vectors.set(key,archive.get(key).slice());
        else missing.push(i);
    }
    if (missing.length) {
        const result = await bank.embed(missing.map(i=>texts[i]));
        missing.forEach((i,j)=>vectors.set(hashes[i],result[j]));
    }
    return hashes.map(h=>vectors.get(h));
}

function merge(spans) {
    const out = [];
    for (const [a,b] of spans.sort((p,q)=>p[0]-q[0] || p[1]-q[1])) {
        if (out.length && a<=out.at(-1)[1]) out.at(-1)[1]=Math.max(out.at(-1)[1],b);
        else out.push([a,b]);
    }
    return out;
}
function canonicalSpans(row,view) {
    const spans = sourceSpans(view);
    if (!row.map) return spans;
    const out = [];
    for (const [a,b] of spans) {
        for (const r of row.map) {
            const start=Math.max(a,r.start), end=Math.min(b,r.end);
            if (start>=end) continue;
            const literal=r.end-r.start===r.outputEnd-r.outputStart;
            out.push(literal ? [r.outputStart+start-r.start,r.outputEnd-(r.end-end)] : [r.outputStart,r.outputEnd]);
        }
    }
    return merge(out);
}

async function load(key,i,doc) {
    const base=join(cache,'hierarchy-probes','indexes',key,String(i));
    const ix=JSON.parse(gunzipSync(await readFile(base+'.json.gz')));
    const blob=await readFile(base+'.f32');
    assert.equal(sha256(blob),ix.vectorSHA256);
    archive.clear();
    ix.hashes.forEach((hash,j)=>archive.set(hash,new Float32Array(blob.buffer,blob.byteOffset+j*dimension*4,dimension)));
    // This historical control intentionally permits its original whole windows.
    const opt={format:doc.format,sourceId:doc.id,includeHierarchy:true,returnEmbedding:false,maxPassageSize:Number.MAX_SAFE_INTEGER,maxStructuralSize:Infinity};
    let input=doc.raw, restored;
    const outline=outlines[key][i];
    assert.equal(outline.id,doc.id);
    const flatOutline=doc.format==='text' && outline.headings.length && !/^#{1,6}\s/m.test(input);
    if (rangesOnly && flatOutline) {
        const tree=await parseTextTree(doc.raw,{inputFormat:'text'},true);
        assert.equal(tree.source,doc.source);
        opt.sectionRanges=outline.headings.map(([a,depth],j)=>{
            const end=outline.headings.slice(j+1).find(([,d])=>d<=depth)?.[0]??doc.source.length;
            const spans=sourceSpans(sliceView(tree.view,a,end));
            const title=doc.source.slice(a).split('\n',1)[0];
            return {start:spans[0][0],end:spans.at(-1)[1],headingPath:[title]};
        });
    }
    if (outlinesOnly && flatOutline) {
        // Offsets are in the audited canonical source. Only mark headings that the
        // earlier source audit independently located, and map the inserted markup out.
        const parts=[], map=[];
        let pos=0, offset=0;
        for (const [a,depth] of outline.headings) {
            assert.ok(a>=pos && (a===0 || doc.source[a-1]==='\n'));
            const part=doc.source.slice(pos,a), prefix='#'.repeat(depth)+' ';
            parts.push(part,prefix);
            if (part.length) map.push({start:offset,end:offset+part.length,outputStart:pos,outputEnd:a});
            offset+=part.length+prefix.length;
            pos=a;
        }
        const tail=doc.source.slice(pos);
        parts.push(tail);
        if (tail.length) map.push({start:offset,end:offset+tail.length,outputStart:pos,outputEnd:doc.source.length});
        input=parts.join('');
        restored=map;
        counters.restoredSources=(counters.restoredSources??0)+1;
    }
    const blocks=await chunkDocument(input,{...opt,sizeUnit:'tokens',maxChunkSize:256,countTokens:bank.countTokens});
    const questions=doc.questions.filter(q=>q.kind!=='section');
    if (lookupOnly) {
        await createDocumentIndex([blocks],embed,{includeDocuments:true});
        await embed(questions.map(q=>q.text));
        archive.clear();
        return {doc,blocks,questions};
    }
    const settings={...opt,strategy:'semantic-blocks',maxChunkSize:Infinity,similarityThreshold:.25,joinParagraphs:false,embedBatch:embed};
    const semantic=structureStudy ? undefined : await chunkDocument(input,settings);
    const joined=await chunkDocument(input,{...settings,joinParagraphs:true});
    const row={doc,blocks,semantic,joined};
    if (restored) row.map=restored;
    else if (doc.raw!==doc.source) {
        assert.ok(['html','text'].includes(doc.format));
        const tree=await parseTextTree(doc.raw,{inputFormat:doc.format},true);
        assert.equal(tree.view.text,doc.source);
        row.map=tree.view.citations;
    }
    // Populate only the keys consumed by the public APIs, and retain query vectors.
    await createDocumentIndex([blocks,semantic,joined].filter(Boolean),embed,{includeSections:true,includeDocuments:!structureStudy});
    row.questions=questions;
    await embed(row.questions.map(q=>q.text));
    archive.clear();
    return row;
}

async function documentLookup(rows) {
    const index=await createDocumentIndex(rows.map(r=>r.blocks),embed,{includeDocuments:true});
    const result=[];
    for (const row of rows) for (const q of row.questions) {
        const sources=new Set([row.doc.id,...(q.alternativeSources??[]).map(s=>s.source)]);
        const hits=await index.searchNodes(vectors.get(sha256(q.text)),{types:['document'],limit:rows.length});
        const rank=hits.findIndex(h=>sources.has(h.sourceId))+1;
        assert.ok(rank>0);
        result.push({doc:row.doc.id,id:q.id,domain:domains.get(row.doc.id),rank});
    }
    await writeFile(join(root,'documents.json'),JSON.stringify(result));
}

async function score(rows,pool) {
    const byId=new Map(rows.map(r=>[r.doc.id,r]));
    const layouts=structureStudy ? [[rangesOnly?'routingOutline':'withOutline',rows.flatMap(r=>[r.blocks,r.joined])]] :
        [['blocks',rows.map(r=>r.blocks)],['semantic',rows.map(r=>r.semantic)],
        ['joined',rows.map(r=>r.joined)],['both',rows.flatMap(r=>[r.blocks,r.semantic])],
        ['bothJoined',rows.flatMap(r=>[r.blocks,r.joined])]];
    for (const [name,docs] of layouts) {
        const combined = structureStudy || name.startsWith('both');
        const index=await createDocumentIndex(docs,embed,{includeSections:combined});
        if (pool==='shared') counters[name]=index.stats;
        for (const row of rows) for (const q of row.questions) {
            const key=row.doc.id+'\t'+q.id;
            if (!evidence.has(key)) evidence.set(key,{doc:row.doc.id,id:q.id,domain:domains.get(row.doc.id),hits:{}});
            for (const w of rangesOnly?[.15]:combined?[0,.15]:[0]) {
                const hits=await index.search(vectors.get(sha256(q.text)),{sectionWeight:w});
                evidence.get(key).hits[[pool,name,w].join('/')]=hits.map(h=>[h.sourceId,canonicalSpans(byId.get(h.sourceId),h.context)]);
            }
        }
    }
}

try {
    await mkdir(root,{recursive:true});
    for (const [key,meta] of shards) {
        const data=JSON.parse(await readFile(join(cache,'context-mixtures','audited-data',key+'.json')));
        const rows=[];
        for (const [i,doc] of data.docs.entries()) {
            const row=await load(key,i,doc);
            domains.set(doc.id,meta.domain);
            rows.push(row);
        }
        if (!lookupOnly) {
            if (meta.pool==='collection') await score(rows,'original');
            else for (const row of rows) await score([row],'original');
        }
        all.push(...rows);
        console.log(key,rows.length,'documents');
    }
    if (!structureStudy) await documentLookup(all);
    if (!lookupOnly) {
        if (!structureStudy) {
            const paragraphIndex=await createDocumentIndex(all.flatMap(r=>[r.blocks,r.joined]),embed);
            counters.bothParagraphOnly=paragraphIndex.stats;
        }
        await score(all,'shared');
        const file=rangesOnly ? 'section-ranges.json.gz' : outlinesOnly ? 'source-headings.json.gz' : 'retrieval.json.gz';
        await writeFile(join(root,file),gzipSync(JSON.stringify({counters,rows:[...evidence.values()]})));
    }
} finally {bank.close();}
