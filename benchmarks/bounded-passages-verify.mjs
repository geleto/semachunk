import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chunkDocument,createDocumentIndex} from '../src/index.js';
import {sourceSpans} from '../src/citations.js';
import {cache,sha256} from './corpora.mjs';
import {dimension,openReplay,openTokenizer} from './encoder.mjs';
import {sourceOptions} from './bounded-source.mjs';

const settingsStudy=process.argv.includes('--structural-limits');
const bounded=join(cache,'bounded-passages'), root=settingsStudy?join(cache,'structural-limits'):bounded, original=join(cache,'context-mixtures');
const read=async path=>JSON.parse(gunzipSync(await readFile(path)));
const selected=settingsStudy && JSON.parse(await readFile(join(root,'development-selection.json')));
const expected=settingsStudy ? {original:await read(join(root,'verify-fresh.json.gz')),shared:await read(join(root,'verify-shared.json.gz'))}
    : await read(join(root,'verify.json.gz'));
const registry=JSON.parse(await readFile(join(original,'data','manifest.json')));
const outlines=JSON.parse(await readFile(join(cache,'scope-weights','source-headings.json')));
const known=new Map(), rows=new Map(), tokenizer=openTokenizer();
const options=settingsStudy ? Object.fromEntries(Object.keys(selected.modes).map(k=>[k,{}])) : {paragraph:{},sentence:{detailTypes:['paragraph','sentence']},
    triple:{sentenceGrouping:{maxSentences:3}},cos25:{sentenceGrouping:{maxSentences:3,minSimilarity:.25}}};
const poolCounts={}, compared={};
function loadVectors(map,hashes,blob) {
    hashes.forEach((h,i)=>{map.set(h,new Float32Array(blob.buffer,blob.byteOffset+i*dimension*4,dimension));});
}
async function search(rowsToSearch,queries,pool) {
    if(!queries.length)return;
    const embed=async ss=>ss.map(s=>{
        const v=known.get(sha256(s));
        assert.ok(v,'Serving vector absent from measured index');
        return v;
    });
    for(const [detail,settings] of Object.entries(options)) {
        const docs=rowsToSearch.flatMap(r=>settingsStudy ? r.docs[detail] : r.docs);
        for (const weight of settingsStudy ? [0,.15] : [.15]) {
            const index=weight ? await createDocumentIndex(docs,embed,{includeSections:true,...settings}) :
                await createDocumentIndex(docs,embed);
            if(pool==='shared') poolCounts[(weight?'':'default/')+detail]=index.stats;
            const label=settingsStudy ? selected.modes[detail].replace(/\/15$/,'/'+weight*100) : 'both2048/'+detail+'/2048/0';
            for(const q of queries) {
                const text=rows.get(q.doc).questions.get(q.id);
                const hits=weight ? await index.search(text,{sectionWeight:weight}) : await index.search(text);
                const actual=hits.map(h=>[h.sourceId,sourceSpans(h.context),tokenizer.countTokens(h.context.text)]);
                const target=q.hits[label].map(([source,v])=>{
                    const view=rows.get(source).ix.views[v];
                    return [source,view.raw,view.tokens];
                });
                assert.deepEqual(actual,target,q.doc+' / '+q.id+' / '+label);
                compared[pool]=(compared[pool]??0)+1;
            }
        }
    }
}
try {
    for(const [key,meta] of Object.entries(registry)) {
        if(meta.fold!=='fresh')continue;
        const data=JSON.parse(await readFile(join(original,'audited-data',key+'.json')));
        const bank=await openReplay(undefined,join(bounded,'vectors',key),{lengthSafe:true,concurrency:3});
        const shard=[];
        try {
            for(const [i,doc] of data.docs.entries()) {
                const stem=join(root,key,String(i)), archive=join(cache,'hierarchy-probes','indexes',key,String(i));
                const ix=await read(stem+'.json.gz'), bytes=await readFile(stem+'.f32');
                assert.equal(sha256(bytes),ix.vectorHash);loadVectors(known,ix.hashes,bytes);
                const old=await read(archive+'.json.gz'), blob=await readFile(archive+'.f32'), extra=new Map();
                assert.equal(sha256(blob),old.vectorSHA256);loadVectors(extra,old.hashes,blob);
                const embed=async ss=>{
                    const missing=ss.filter(s=>!known.has(sha256(s))&&!extra.has(sha256(s)));
                    const vs=missing.length?await bank.embed(missing):[];
                    missing.forEach((s,j)=>extra.set(sha256(s),vs[j]));
                    return ss.map(s=>known.get(sha256(s))??extra.get(sha256(s)));
                };
                const {options:opts}=await sourceOptions(doc,outlines[key][i].headings,tokenizer.countTokens);
                if (settingsStudy) {
                    const docs={};
                    for (const strategy of ['blocks','pack','semantic','semantic-blocks']) {
                        const parsed=await chunkDocument(doc.raw,{...opts,strategy,embedBatch:embed});
                        assert.equal(parsed.maxPassageSize,selected.cap);
                        docs[strategy]=[parsed];
                    }
                    docs.combined=[...docs.blocks,...docs['semantic-blocks']];
                    const row={ix,docs,questions:new Map(ix.qs.map(q=>[q.id,q.text]))};
                    rows.set(doc.id,row);shard.push(row);
                    continue;
                }
                const core=await chunkDocument(doc.raw,{...opts,maxChunkSize:256,maxPassageSize:2048,maxStructuralSize:Infinity});
                const sem=await chunkDocument(doc.raw,{...opts,maxChunkSize:2048,maxPassageSize:2048,maxStructuralSize:Infinity,
                    strategy:'semantic-blocks',joinParagraphs:true,similarityThreshold:.25,embedBatch:embed});
                // Similarity grouping can require temporary vectors absent from the serving index.
                const sentences=[...new Set([...core.nodes,...sem.nodes].filter(n=>n.type==='sentence').map(n=>n.text))];
                const transient=await embed(sentences);
                sentences.forEach((s,j)=>{if(!known.has(sha256(s)))known.set(sha256(s),transient[j].slice());});
                const row={ix,docs:[core,sem],questions:new Map(ix.qs.map(q=>[q.id,q.text]))};
                rows.set(doc.id,row);shard.push(row);
            }
        } finally {bank.close();}
        for(const group of (meta.pool==='collection'?[shard]:shard.map(r=>[r]))) {
            const ids=new Set(group.map(r=>r.ix.id));
            await search(group,expected.original.filter(q=>ids.has(q.doc)),'original');
        }
        console.log(key);
    }
    await search([...rows.values()],expected.shared,'shared');
    await writeFile(join(root,settingsStudy?'api-verification.json':'parity.json'),JSON.stringify({compared,poolCounts}));
    console.log(compared);
} finally {tokenizer.close();}
