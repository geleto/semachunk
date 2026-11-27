import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {chunkDocument,createDocumentIndex,getChunkContext} from '../src/index.js';
import {covers,sourceSpans} from '../src/citations.js';
import {cache,sha256} from './corpora.mjs';
import {dimension,openReplay,openTokenizer} from './encoder.mjs';
import {sourceOptions} from './bounded-source.mjs';

const root=join(cache,'paragraph-ranking'), previous=join(cache,'structural-limits');
const read=async f=>JSON.parse(await readFile(f));
const unzip=async f=>JSON.parse(gunzipSync(await readFile(f)));
const historical=await read(join(cache,'context-mixtures/data/manifest.json'));
const held=await read(join(root,'holdout-data/manifest.json'));
const counts={archived:0,publicOriginal:0,publicShared:0,scalarParagraphOriginal:0,scalarParagraphShared:0};
const signature=(source,view)=>[source,view.raw,view.tokens];
const models={'incumbent-blocks':'blocks','incumbent-tree':'semantic-blocks','incumbent-union':'combined'};
const pastLabels={'incumbent-blocks':'blocks256/512/15','incumbent-tree':'tree512u256low/512/15','incumbent-union':'both-tree512u256low/512/15'};

async function archiveCheck() {
    const archives=new Map();
    for(const [key,meta] of Object.entries(historical)) {
        if(meta.fold!=='fresh')continue;
        for(const [i,{id}] of meta.documents.entries()) {
            const archived=await unzip(join(previous,key,i+'.json.gz')), current=await unzip(join(root,key,i+'.json.gz'));
            archives.set(id,[archived,current]);
        }
    }
    for(const [pool,old] of [['fresh','fresh'],['shared-fresh','shared']]) {
        const checked=await unzip(join(previous,'verify-'+old+'.json.gz'));
        const measured=new Map((await unzip(join(root,pool+'-traces.json.gz'))).map(q=>[JSON.stringify([q.source,q.question]),q]));
        for(const row of checked) {
            const now=measured.get(JSON.stringify([row.doc,row.id]));
            for(const [name,label] of Object.entries(pastLabels)) {
                const a=row.hits[label].map(([s,v])=>signature(s,archives.get(s)[0].views[v]));
                const b=now.hits[name].map(([s,v])=>signature(s,archives.get(s)[1].views[v]));
                assert.deepEqual(b,a);
                counts.archived++;
            }
        }
    }
}
await archiveCheck();
const local=await unzip(join(root,'holdout-traces.json.gz')), shared=await unzip(join(root,'shared-holdout-traces.json.gz'));
const tok=openTokenizer(), vectors=new Map(), directions=new Map(), documents=new Map();
const norm=rs=>rs.reduce((n,[a,b])=>n+b-a,0);
function intersection(a,b) {
    let i=0,j=0,size=0;
    while(i<a.length&&j<b.length) {
        size+=Math.max(0,Math.min(a[i][1],b[j][1])-Math.max(a[i][0],b[j][0]));
        if(a[i][1]<=b[j][1])i++;else j++;
    }
    return size;
}
function storeHashes(ix,bytes) {
    assert.equal(sha256(bytes),ix.vectorHash);
    ix.hashes.forEach((h,i)=>vectors.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+i*dimension*4,dimension)));
}
function unit(text) {
    if(!directions.has(text)) {
        const raw=vectors.get(sha256(text));assert.ok(raw,'Missing verification vector');
        const length=Math.sqrt(raw.reduce((n,x)=>n+x*x,0));
        directions.set(text,Float64Array.from(raw,x=>x/length));
    }
    return directions.get(text);
}
function candidates(d) {
    const spans=d.nodes.map(sourceSpans);
    const ps=d.nodes.filter(n=>n.type==='paragraph'&&n.text).sort((a,b)=>spans[a.id][0][0]-spans[b.id][0][0]);
    const scopes=ps.map(n=>{
        for(let p=n.parentId;p!==null;p=d.nodes[p].parentId) {
            if(['section','article','record'].includes(d.nodes[p].type)||d.nodes[p].record)return p;
        }
        return 0;
    });
    const ordinal=new Map(ps.map((n,i)=>[n.id,i]));
    const sections=d.nodes.filter(n=>['section','article'].includes(n.type)&&n.text&&
        ps.filter(p=>covers(spans[n.id],spans[p.id])).length>=2).sort((a,b)=>norm(spans[a.id])-norm(spans[b.id]));
    return d.chunks.map((c,j)=>{
        const geo=sourceSpans(c), read=getChunkContext(d,j), raw=sourceSpans(read);
        const members=c.nodeIds.filter(k=>ordinal.has(k));
        let para=members.filter(k=>!covers(spans[k],geo));
        if(!para.length)para=members.filter(k=>covers(spans[k],geo)&&d.nodes[k].text===c.text).slice(0,1);
        const detail=para.map(k=>{
            const i=ordinal.get(k);
            return [ps[i].text,[i-1,i+1].filter(a=>a>=0&&a<ps.length&&scopes[a]===scopes[i]).map(a=>ps[a].text)];
        });
        const section=sections.find(n=>covers(spans[n.id],geo)&&!covers(geo,spans[n.id])&&!covers(spans[n.id],spans[0]));
        return {text:c.text,detail,section:section?.text,source:d.sourceId,raw,tokens:tok.countTokens(read.text)};
    });
}
function paragraphSearch(text,cs) {
    const q=unit(text), scores=new Map();
    function sim(t) {
        if(!scores.has(t)) {
            const v=unit(t);let dot=0;
            for(let i=0;i<dimension;i++)dot+=v[i]*q[i];
            scores.set(t,dot);
        }
        return scores.get(t);
    }
    const rank=cs.map(c=>{
        const ds=c.detail.map(([t,nears])=>.8*sim(t)+.2*(nears.length?nears.reduce((s,n)=>s+sim(n),0)/nears.length:sim(t)));
        const base=.5*(sim(c.text)+(ds.length?Math.max(...ds):sim(c.text)));
        return {c,value:.85*base+.15*(c.section?sim(c.section):base)};
    }).sort((a,b)=>b.value-a.value);
    const hits=[];
    for(const {c} of rank) {
        if(hits.some(h=>h.source===c.source&&intersection(h.raw,c.raw)>=.75*Math.min(norm(c.raw),norm(h.raw))))continue;
        hits.push(c);
        if(hits.length===5)break;
    }
    return hits.map(h=>[h.source,h.raw,h.tokens]);
}
function expected(row,model) {
    return row.hits[model].map(([s,v])=>signature(s,documents.get(s).ix.views[v]));
}
const sample=new Set();
async function search(group,queries,global) {
    if(!queries.length)return;
    const embed=async texts=>texts.map(t=>{const v=vectors.get(sha256(t));assert.ok(v);return v;});
    for(const [label,mode] of Object.entries(models)) {
        const docs=group.flatMap(d=>mode==='combined'?d.layout:[d.layout[Number(mode==='semantic-blocks')]]);
        const index=await createDocumentIndex(docs,embed,{includeSections:true});
        for(const row of queries) {
            const text=documents.get(row.source).queries.get(row.question);
            const hits=await index.search(text,{sectionWeight:.15});
            assert.deepEqual(hits.map(h=>[h.sourceId,sourceSpans(h.context),tok.countTokens(h.context.text)]),expected(row,label));
            counts[global?'publicShared':'publicOriginal']++;
        }
    }
    const cs=group.flatMap(d=>d.scalar);
    for(const row of queries.filter(q=>sample.has(JSON.stringify([q.source,q.question])))) {
        const text=documents.get(row.source).queries.get(row.question);
        assert.deepEqual(paragraphSearch(text,cs),expected(row,'incumbent-mean20'));
        counts[global?'scalarParagraphShared':'scalarParagraphOriginal']++;
    }
}
try {
    for(const [key] of Object.entries(held)) {
        const data=await read(join(root,'holdout-data',key+'.json'));
        const bank=await openReplay(undefined,join(root,'vectors',key),{lengthSafe:true});
        try {
            for(const [i,doc] of data.docs.entries()) {
                const ix=await unzip(join(root,key,i+'.json.gz'));
                storeHashes(ix,await readFile(join(root,key,i+'.f32')));
                const embed=async texts=>{
                    const missing=texts.filter(t=>!vectors.has(sha256(t)));
                    const vs=missing.length?await bank.embed(missing):[];
                    missing.forEach((t,j)=>vectors.set(sha256(t),vs[j]));
                    return texts.map(t=>vectors.get(sha256(t)));
                };
                const {options}=await sourceOptions(doc,[],tok.countTokens);
                const layout=[await chunkDocument(doc.raw,{...options,maxChunkSize:256,maxStructuralSize:256,maxPassageSize:512}),
                    await chunkDocument(doc.raw,{...options,strategy:'semantic-blocks',maxChunkSize:512,maxStructuralSize:256,maxPassageSize:512,
                        joinParagraphs:true,similarityThreshold:.15,embedBatch:embed})];
                documents.set(doc.id,{ix,layout,scalar:layout.flatMap(candidates),queries:new Map(doc.questions.map(q=>[q.id,q.text]))});
            }
            const ids=new Set(data.docs.map(d=>d.id));
            const qs=local.filter(q=>ids.has(q.source)).sort((a,b)=>sha256(a.source+a.question).localeCompare(sha256(b.source+b.question)));
            qs.slice(0,12).forEach(q=>sample.add(JSON.stringify([q.source,q.question])));
        } finally {bank.close();}
    }
    for(const [s,d] of documents)await search([d],local.filter(q=>q.source===s),false);
    await search([...documents.values()],shared.filter(q=>sample.has(JSON.stringify([q.source,q.question]))),true);
    await writeFile(join(root,'verification.json'),JSON.stringify(counts));
    console.log(counts);
} finally {tok.close();}
