import assert from 'node:assert/strict';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cache, here, sha256 } from './corpora.mjs';
import { openStudySet } from './matched-count.mjs';
import { dot, union } from './prose-evidence.mjs';
import { readJSON } from './semantic-settings-data.mjs';
import { ordinals } from './tree-evidence.mjs';

const results = join(here,'results'), local = join(cache,'prose-thresholds');
const protocol = await readJSON(join(here,'prose-threshold-protocol.json'));
const low = process.argv.includes('--low'), suffix = low ? '.low' : '';
const studyHash = sha256(JSON.stringify(low ? [protocol,await readJSON(join(here,'prose-low-threshold-protocol.json'))] : protocol));
const edition = await readJSON(join(results,'2026-11-27-prose-reviewed-data.json'));
const oldManifest = await readJSON(join(results,edition.base));
const archived = gunzipSync(await readFile(join(results,'2026-11-27-prose-traces.jsonl.gz')))
    .toString().trimEnd().split('\n').map(JSON.parse);
const length = spans => spans.reduce((n,[a,b]) => n+b-a,0);
const round = x => Number(x.toFixed(6));
function intersection(a,b) {
    let n=0, i=0, j=0;
    while (i<a.length && j<b.length) {
        const [x,y]=a[i], [z,w]=b[j];
        n += Math.max(0,Math.min(y,w)-Math.max(x,z));
        if (y<=w) i++;
        if (w<=y) j++;
    }
    return n;
}

async function score(row) {
    const {key} = row, meta = edition.sets[key];
    const data = JSON.parse(gunzipSync(await readFile(join(local,key+suffix+'.json.gz'))));
    assert.equal(data.protocolSHA256,studyHash);
    assert.equal(data.dataSHA256,meta.baseSHA256);
    const raw = await readFile(join(cache,'prose-reviewed',key+'.json'),'utf8');
    assert.equal(sha256(raw),meta.sha256);
    const docs = JSON.parse(raw), indices = new Map(docs.map((d,i)=>[d.id,i]));
    const maps = docs.map(d=>ordinals(d.source));
    const project = (doc,spans) => union(spans.map(([a,b])=>[maps[doc][a],maps[doc][b]]));
    const sizes = data.texts.map(t=>t.replace(/\s/gu,'').length);
    const passages = data.passages.map(p=>({...p, ord:project(p.doc,p.spans)}));
    const questions = new Map(docs.flatMap(d=>d.questions.map(q=>[q.id,q])));
    const names = Object.keys(data.plans);
    const stats = Object.fromEntries(names.map(name=>{
        const ids = data.plans[name].flat();
        return [name,{count:ids.length,short:ids.filter(i=>passages[i].tokens<=32).length,
            max:ids.reduce((m,i)=>Math.max(m,passages[i].tokens),0)}];
    }));
    const out = {version:2,key,dataSHA256:meta.sha256,protocolSHA256:data.protocolSHA256,
        editionSHA256:edition.correctionSHA256,stats,queries:[]};
    let encoder, newVectors;
    try {
        for (const [qi,item] of data.queries.entries()) {
            const {doc,id}=item, q=questions.get(id);
            const old = row.queries[qi];
            assert.equal(old.id,id);
            assert.equal(data.documents[doc].sha256,sha256(docs[doc].source));
            const refs = [...(q.references ?? [q.ranges]).map(ranges=>({doc,ranges})),
                ...(q.alternativeSources ?? []).map(a=>({doc:indices.get(a.source),ranges:a.ranges}))].map(ref=>{
                const spans=project(ref.doc,ref.ranges);
                return {doc:ref.doc,spans,n:length(spans)};
            });
            const bytes = Buffer.from(item.scores,'base64');
            const sim = new Float32Array(bytes.buffer,bytes.byteOffset,data.texts.length);
            if (q.text!==item.text) {
                if (!encoder) ({encoder}=await openStudySet(key,oldManifest.sets[key]));
                newVectors ??= await encoder.embed(data.texts);
                const [questionVector]=await encoder.embed([q.text]);
                for (let i=0;i<sim.length;i++) sim[i]=dot(questionVector,newVectors[i]);
            }
            const shortestByChoice = refs.map(()=>Infinity);
            const scores = passages.map(p=>{
                let recall=0, f1=0;
                const full=[];
                for (const [j,r] of refs.entries()) if (p.doc===r.doc) {
                    const overlap=intersection(p.ord,r.spans);
                    recall=Math.max(recall,overlap/r.n);
                    f1=Math.max(f1,2*overlap/(r.n+sizes[p.v]));
                    if (overlap===r.n) {
                        full.push(j);
                        shortestByChoice[j]=Math.min(shortestByChoice[j],p.tokens);
                    }
                }
                return {recall,f1,full};
            });
            const entry = {id,doc:docs[doc].id,cluster:old.cluster,text:q.text,shortestByChoice,methods:{}};
            for (const name of names) {
                const pool = meta.pool==='document' ? data.plans[name][doc] : data.plans[name].flat();
                const ranked = pool.toSorted((a,b)=>sim[passages[b].v]-sim[passages[a].v]);
                const top=ranked.slice(0,5), first=top[0];
                const firstFull=ranked.findIndex(i=>scores[i].recall===1);
                let best=first, bestRank=1;
                for (let j=1;j<ranked.length;j++) if (scores[ranked[j]].recall>scores[best].recall) {
                    best=ranked[j]; bestRank=j+1;
                }
                const recall5=Math.max(...refs.map(r=>{
                    const spans=union(top.filter(i=>passages[i].doc===r.doc).flatMap(i=>passages[i].ord));
                    return intersection(r.spans,spans)/r.n;
                }));
                let prefix=Infinity;
                for (const r of refs) {
                    let merged=[];
                    for (let j=0;j<ranked.length && j+1<prefix;j++) {
                        const index=ranked[j], p=passages[index];
                        if (p.doc!==r.doc || !scores[index].recall) continue;
                        merged=union([...merged,...p.ord]);
                        if (intersection(r.spans,merged)===r.n) {prefix=j+1; break;}
                    }
                }
                assert.equal(recall5===1,prefix<=5);
                const hit=[Number(scores[first].recall===1),Number(recall5===1),round(scores[first].f1),
                    round(recall5),firstFull+1,bestRank,round(scores[best].recall),ranked.length,passages[first].tokens,
                    top.reduce((n,i)=>n+passages[i].tokens,0),first,top,round(sim[passages[first].v]),scores[first].full,
                    round(Math.max(...top.map(i=>scores[i].f1))),Number.isFinite(prefix)?prefix:null];
                entry.methods[name]=hit;
                if (name==='ordinary/256/blocks' && !meta.revised.includes(id) &&
                    !['PEPSICO_2023Q1_EARNINGS','JOHNSON_JOHNSON_2022Q4_EARNINGS'].includes(docs[doc].id)) {
                    const prior=old.methods.blocks;
                    assert.deepEqual(hit.slice(0,2),[Number(prior.prefix===1),Number(prior.prefix!==null && prior.prefix<=5)],id);
                    assert.equal(hit[8],prior.top[0].tokens,id);
                }
            }
            out.queries.push(entry);
        }
    } finally {encoder?.close();}
    const file=join(local,key+suffix+'.scores.gz');
    await writeFile(file+'.tmp',gzipSync(JSON.stringify(out)));
    await rename(file+'.tmp',file);
}
const prefix=process.argv.slice(2).find(v=>v!=='--low')??'';
const keys=archived.filter(r=>prefix==='available' || r.key.startsWith(prefix));
assert(keys.length);
for (const row of keys) {
    if (prefix==='available') {
        try { await access(join(local,row.key+suffix+'.json.gz')); }
        catch (e) { if (e.code==='ENOENT') continue; throw e; }
        try {
            const prior=JSON.parse(gunzipSync(await readFile(join(local,row.key+suffix+'.scores.gz'))));
            if (prior.version===2 && prior.protocolSHA256===studyHash &&
                prior.dataSHA256===edition.sets[row.key].sha256) continue;
        } catch (e) { if (e.code!=='ENOENT') throw e; }
    }
    await score(row);
    console.log(row.key);
}
