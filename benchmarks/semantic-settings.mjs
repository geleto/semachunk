import assert from 'node:assert/strict';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { denseRanker, vocabulary } from './chunking.mjs';
import { here, sha256 } from './corpora.mjs';
import { deliver, goldReference } from './delivered-context.mjs';
import { dimension, model, openReplay } from './encoder.mjs';
import { directory, readJSON, settingsManifest } from './semantic-settings-data.mjs';
import { adjustBoundaries } from './semantic-boundary.mjs';
import { projectPlain, scores } from './tree-evidence.mjs';
import { dataDir } from './tree-dataset.mjs';
import { treeLayout } from './tree-policy.mjs';

export const protocol = await readJSON(join(here,'semantic-settings-protocol.json'));
async function publish(source, target) {
    for (let attempt = 0;; attempt++) {
        try { await rename(source,target); return; }
        catch (error) {
            if (!['EACCES','EBUSY','EPERM'].includes(error.code) || attempt === 6) throw error;
            await delay(50 * 2**attempt);
        }
    }
}
export function candidates() {
    return [...new Set([...protocol.controls,...['semantic','semantic-blocks'].flatMap(s =>
        [...protocol.thresholds.map(c=>s+'/'+c),s+'/document']),...protocol.alternative])];
}

export async function layout(doc,name,limit,encoder) {
    let calls = 0, inputTokens = 0, moved = 0;
    const count = encoder.countTokens;
    const embed = texts => {
        calls++; inputTokens += texts.reduce((n,s) => n+count(s),0);
        return encoder.embed(texts);
    };
    const [strategy,setting] = name.split('/');
    let rows;
    if (strategy === 'boundary') {
        ({rows,moved} = await adjustBoundaries(doc,limit,count,setting,embed));
    } else if (strategy === 'paragraph') {
        ({rows} = await treeLayout(doc.raw,doc.format,{maxChunkSize:Infinity,fits:s=>count(s)<=limit},name,embed));
    } else {
        const options = {inputFormat:doc.format,chunkingStrategy:strategy,maxChunkSize:Infinity,
            maxChunkTokens:limit,countTokens:count,returnEmbedding:false};
        if (setting === 'document') options.mergeThresholdMode = 'document';
        else if (setting && setting !== 'shipped') options.combineChunksSimilarityThreshold = Number(setting);
        rows = await chunkText(doc.raw,embed,options);
        if (doc.format !== 'markdown') {
            if (strategy === 'blocks' || strategy === 'semantic-blocks') {
                let cursor = 0;
                rows = rows.map(({text}) => {
                    const start = doc.source.indexOf(text,cursor);
                    assert(start >= cursor && !doc.source.slice(cursor,start).trim());
                    cursor = start+text.length;
                    return {text,sourceRanges:[{start,end:cursor,outputStart:0}]};
                });
                assert(!doc.source.slice(cursor).trim());
            } else rows = projectPlain(doc.source,rows);
        }
    }
    const indexable = rows.filter(r=>count(r.text)<=limit);
    return {rows:indexable,over:rows.length-indexable.length,calls,inputTokens,moved};
}

function containsOne(choices, byDoc) {
    return Number(choices.some(ref => byDoc[ref.doc].some(p => {
        const ranges = p.sourceRanges;
        if (!ranges.length || ranges[0].start > ref.first || ranges.at(-1).end < ref.last) return false;
        return ref.ranges.every(([a,b]) => {
            let from = a;
            for (const r of ranges) {
                if (r.end <= from) continue;
                if (r.start > from) return false;
                from = r.end;
                if (from >= b) return true;
            }
            return false;
        });
    })));
}

export function prepareQuestions(docs, encoder) {
    const indices = new Map(docs.map((d,i)=>[d.id,i]));
    const questions = docs.flatMap((d,i)=>d.questions.map(q=>({...q,doc:i,cluster:q.cluster ?? d.group})));
    for (const d of docs) {
        d.offsets=encoder.offsets(d.source);
        d.ends=d.offsets.map(v=>v[1]);
    }
    for (const q of questions) {
        const sources = (q.references ?? [q.ranges]).map(ranges=>({doc:q.doc,ranges}));
        for (const {source,ranges} of q.alternativeSources ?? []) {
            assert(indices.has(source),source);
            sources.push({doc:indices.get(source),ranges});
        }
        q.choices = sources.map(({doc,ranges})=>({doc,ranges,first:Math.min(...ranges.map(v=>v[0])),
            last:Math.max(...ranges.map(v=>v[1])),gold:goldReference(ranges.map(([a,b])=>[doc,a,b]),docs)}));
    }
    return questions;
}

export async function retrieve(docs, questions, byDoc, pool, encoder, mode='delivered') {
    const all = byDoc.flat(), vocab = vocabulary();
    for (const row of all) row.index=vocab.intern(row.text);
    for (const q of questions) vocab.intern(q.text);
    const vectors = await encoder.embed(vocab.texts), matrix=new Float32Array(vectors.length*dimension);
    vectors.forEach((v,i)=>matrix.set(v,i*dimension));
    const rank=denseRanker(matrix), pools=new Map();
    return questions.map(q=>{
        if (!pools.has(q.doc)) {
            const hits = pool === 'document' ? byDoc[q.doc] : pool === 'agency'
                ? all.filter(p=>p.doc===q.doc || docs[p.doc].group!==docs[q.doc].group) : all;
            pools.set(q.doc,{hits,indices:hits.map(h=>h.index)});
        }
        const {hits,indices} = pools.get(q.doc);
        const top=rank(vocab.id(q.text),indices).slice(0,5).map(i=>hits[i]);
        const score = ranges => {
            let recall=0;
            for (const {doc,gold} of q.choices) recall=Math.max(recall,scores({doc,gold},ranges)[1]);
            return [Number(recall===1),Number(recall.toFixed(6))];
        };
        const evidence = p=>p.sourceRanges.map(r=>({doc:p.doc,from:r.start,to:r.end}));
        const [complete,recall]=score(top.flatMap(evidence));
        if (mode==='whole') {
            return [...score(top.length ? evidence(top[0]) : []),complete,recall,
                encoder.countTokens(top[0]?.text ?? ''),encoder.countTokens(top.map(p=>p.text).join('\n\n')),
                top.length,Number(top.length===hits.length)];
        }
        const delivered = protocol.deliveryTokens.flatMap(b=>score(deliver(top,b,encoder,false).ranges));
        const result=[...delivered,containsOne(q.choices,byDoc),complete];
        if (mode==='diagnostics' || mode===true) {
            result.push(...score(top.length ? evidence(top[0]) : []),recall,
                encoder.countTokens(top.map(p=>p.text).join('\n\n')),
                ...score(deliver(top.slice(0,1),256,encoder,false).ranges),encoder.countTokens(top[0]?.text ?? ''));
        }
        return result;
    });
}

async function main() {
    const [key,cap,plan = 'grid'] = process.argv.slice(2), limit = Number(cap);
    assert([128,256,512].includes(limit));
    const meta = (await readJSON(settingsManifest)).sets[key];
    assert(meta);
    const dir = join(directory,'runs',model,String(limit));
    await mkdir(dir,{recursive:true});
    const path = join(dir,key+'.json'), partial = path+'.partial';
    const methods = plan === 'grid' ? candidates() : JSON.parse(plan);
    assert(methods.every(m=>candidates().includes(m)));
    const protocolHash = sha256(JSON.stringify(protocol));
    let previous;
    for (const filename of [path,partial]) {
        try { await access(filename); previous = await readJSON(filename); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (previous) {
        assert.equal(previous.dataSHA256,meta.sha256); assert.equal(previous.protocolSHA256,protocolHash);
        if (methods.every(m=>previous.methods[m]) && await access(path).then(()=>true,()=>false)) return;
    }
    const raw = await readFile(join(directory,key+'.json'),'utf8');
    assert.equal(sha256(raw),meta.sha256);
    const docs = JSON.parse(raw);
    const known = key.startsWith('government-') || /^faq-(development|confirmation)-/u.test(key);
    const cohort = key.replace(/-(html|text|markdown|published|masked)$/u,'')+'.0';
    const bank = known ? join(dataDir,'vectors',model,cohort) : join(directory,'vectors',model,cohort);
    const encoder = await openReplay(undefined,bank,{concurrency:4});
    try {
        const qs = prepareQuestions(docs,encoder);
        const report = previous ?? {key,limit,model,dataSHA256:meta.sha256,protocolSHA256:protocolHash,
            queries:qs.map(q=>[q.id,q.cluster,q.kind ?? 'published',Math.min(...q.choices.map(r=>r.gold.tokens.length))]),
            methods:{},newTokens:0};
        const cached = new Map(Object.values(report.methods).map(m=>[m.layoutSHA256,m.outcomes]));
        let newTokens = encoder.stats.apiInputTokens;
        for (const name of methods) {
            if (report.methods[name]) continue;
            const layouts = await Promise.all(docs.map(d=>layout(d,name,limit,encoder)));
            const byDoc = layouts.map((l,i)=>l.rows.map(r=>({...r,doc:i}))), all = byDoc.flat();
            const hash = sha256(JSON.stringify(byDoc.map(rows=>rows.map(r=>[r.text,r.sourceRanges]))));
            let outcomes = cached.get(hash);
            if (!outcomes) {
                outcomes = await retrieve(docs,qs,byDoc,meta.pool,encoder);
                cached.set(hash,outcomes);
            }
            report.methods[name] = {layoutSHA256:hash,outcomes,packets:all.length,
                indexTokens:all.reduce((n,r)=>n+encoder.countTokens(r.text),0),
                selectionTokens:layouts.reduce((n,l)=>n+l.inputTokens,0),moved:layouts.reduce((n,l)=>n+l.moved,0),
                overLimit:layouts.reduce((n,l)=>n+l.over,0)};
            report.newTokens += encoder.stats.apiInputTokens-newTokens;
            newTokens=encoder.stats.apiInputTokens;
            await writeFile(partial+'.tmp',JSON.stringify(report)); await publish(partial+'.tmp',partial);
        }
        await publish(partial,path);
        console.log(key,limit,model,qs.length,'questions,',Object.keys(report.methods).length,'methods');
    } finally {encoder.close();}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
