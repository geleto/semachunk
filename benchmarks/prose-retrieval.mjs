import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cache, here, sha256 } from './corpora.mjs';
import { model } from './encoder.mjs';
import { layoutHash, openStudySet } from './matched-count.mjs';
import { documentContext, sourceUnits } from './prose-context.mjs';
import { citation, covers, dot, ranking, union } from './prose-evidence.mjs';
import { readJSON } from './semantic-settings-data.mjs';
import { layout, prepareQuestions } from './semantic-settings.mjs';

const source = '2026-11-27-whole-passage-audited';
const results = join(here,'results'), output = join(cache,'prose-retrieval');
const archive = await readFile(join(results,source+'-outcomes.jsonl.gz'));
const study = await readJSON(join(results,source+'.json'));
assert.equal(sha256(archive),study.archiveSHA256);
const manifest = await readJSON(join(results,study.protocol.data));
const rows = gunzipSync(archive).toString().trimEnd().split('\n').map(s=>JSON.parse(s));
const methods = Object.keys(study.protocol.limits);
assert.equal(model,study.protocol.model);
await mkdir(output,{recursive:true});

function tokenSummary(values) {
    const sorted=values.toSorted((a,b)=>a-b);
    const at=p=>sorted[Math.floor((sorted.length-1)*p)];
    return {n:values.length, mean:values.reduce((a,b)=>a+b,0)/values.length,
        p10:at(.1), median:at(.5), p90:at(.9), max:sorted.at(-1)};
}

function describe(doc, passages) {
    const short=passages.filter(r=>r.tokens<=32);
    const structural=short.filter(r=>r.text.trim().split('\n').every(line=>
        /^\s*(?:#{1,6}\s.*|[\p{P}\p{S}\d\s]*)$/u.test(line)));
    return {id:doc.id,sizes:tokenSummary(passages.map(r=>r.tokens)),short:short.length,
        shortHeadingOrNumeric:structural.length,over256:passages.filter(r=>r.tokens>256).length};
}

const round=n=>Number(n.toFixed(6));
function retrieve(q, pool, sim, expected) {
    const evidence=citation(q,pool), {sorted,ranks}=ranking(pool,sim);
    const hits=sorted.slice(0,5);
    const result=[evidence.fraction(hits.slice(0,1)),evidence.fraction(hits)];
    const prefix=evidence.prefix(ranks);
    assert.deepEqual([Number(prefix===1),round(result[0]),Number(prefix<=5),round(result[1])],expected.slice(0,4),q.id);
    const position=id=>ranks.get(id);
    function detail(row) {
        return {id:row.id,rank:position(row.id),tokens:row.tokens,sim:round(sim[row.id]),
            recall:round(evidence.fraction([row]))};
    }
    const support=sorted.filter(r=>evidence.any.has(r.id));
    const firstFull=sorted.find(r=>evidence.full.has(r.id));
    const best=support.map(detail).sort((a,b)=>b.recall-a.recall || a.rank-b.rank)[0];
    const out={top:hits.map(detail),prefix:Number.isFinite(prefix)?prefix:null,
        minPassages:Number.isFinite(evidence.minimum)?evidence.minimum:null,
        firstAny:support.length?detail(support[0]):null, firstFull:firstFull?detail(firstFull):null,
        best:best??null,top5Recall:round(result[1]), indexedSupport:support.map(r=>r.id)};
    return {out,evidence,sorted,ranks,sim};
}

// Hold the semantic competitors fixed. Replace exactly one fully supporting parent
// with a fully supporting structural child, using literal source containment. This is
// a gold-informed attribution check, never an input to the retrieval benchmarks.
function nestedCounterfactual(q, base, semantic) {
    const candidates=[];
    for (const parent of semantic.sorted.filter(r=>semantic.evidence.full.has(r.id))) {
        for (const child of base.sorted.filter(r=>base.evidence.full.has(r.id))) {
            if (parent.doc!==child.doc || child.tokens>=parent.tokens || child.first<parent.first || parent.last<child.last ||
                !child.spans.every(([a,b])=>covers(parent.spans,a,b))) continue;
            const sameRef=q.choices.some((c,i)=>c.doc===child.doc && base.evidence.refs[i].every(g=>g.includes(child.id)) &&
                semantic.evidence.refs[i].every(g=>g.includes(parent.id)));
            if (!sameRef) continue;
            const score=base.sim[child.id];
            const rank=1+semantic.sorted.filter(r=>r.id!==parent.id && (semantic.sim[r.id]>score ||
                (semantic.sim[r.id]===score && r.id<parent.id))).length;
            candidates.push({child:child.id,parent:parent.id,childTokens:child.tokens,parentTokens:parent.tokens,
                childSim:round(score),parentSim:round(semantic.sim[parent.id]),childRank:base.ranks.get(child.id),
                parentRank:semantic.ranks.get(parent.id),replacementRank:rank});
        }
    }
    return candidates.sort((a,b)=>a.childRank-b.childRank || a.parentRank-b.parentRank)[0]??null;
}

async function trace(stored) {
    const {key}=stored, domain=key.split('-')[0], finance=domain==='finance', meta=manifest.sets[key];
    assert.equal(stored.dataSHA256,meta.sha256);
    const {docs,encoder}=await openStudySet(key,meta);
    try {
        const questions=prepareQuestions(docs,encoder);
        assert.deepEqual(questions.map(q=>q.id),stored.queries.map(q=>q[0]));
        const plans={}, docMetrics={}, documentUnits=docs.map(d=>sourceUnits(d.source,encoder.countTokens,d.format));
        for (const name of methods) {
            const byDoc=[]; let next=0;
            for (const [di,doc] of docs.entries()) {
                const ref=stored.documents[di].methods[name], which=name==='blocks'?'blocks':'semantic-blocks/'+ref.cutoff;
                const {rows,over}=await layout(doc,which,Number(study.protocol.limits[name]),encoder);
                assert.equal(over,0); assert.equal(layoutHash([rows]),ref.layoutSHA256,doc.id);
                byDoc.push(rows.map((r,i)=>{
                    const spans=union(r.sourceRanges.map(({start,end})=>[start,end]));
                    return {id:next++,doc:di,text:r.text,tokens:ref.sizes[i],spans,first:spans[0][0],last:spans.at(-1)[1]};
                }));
            }
            plans[name]=byDoc.flat();
            docMetrics[name]=byDoc.map((p,i)=>describe(docs[i],p));
        }
        const contexts=await Promise.all(docs.map((_,i)=>documentContext(documentUnits[i],i,
            Object.fromEntries(methods.map(m=>[m,plans[m].filter(r=>r.doc===i)])),encoder)));
        const parents=new Map();
        for (const m of methods.slice(1)) for (const row of plans[m]) {
            if (row.tokens>64) continue;
            const enclosing=plans.blocks.filter(p=>p.doc===row.doc && row.tokens<=p.tokens &&
                p.first<=row.first && row.last<=p.last && row.spans.every(([a,b])=>covers(p.spans,a,b)));
            if (enclosing.length) parents.set(row,enclosing.sort((a,b)=>a.tokens-b.tokens)[0]);
        }
        const selected=questions.map((q,i)=>({q,i})).filter(({q})=>!finance || q.kind==='text');
        const unique=[...new Set([...Object.values(plans).flat().map(r=>r.text),...selected.map(({q})=>q.text)])];
        const vectors=await encoder.embed(unique);
        const lookup=new Map(unique.map((s,i)=>[s,vectors[i]]));
        const records=[];
        for (const {q,i} of selected) {
            const qvec=lookup.get(q.text), evaluated={}, scoresByText=new Map();
            const probes=contexts.flatMap((c,di)=>meta.pool==='document' && di!==q.doc ? [] : [c.forQuery(q,qvec)]);
            const citationChars=q.choices.map(c=>union(c.ranges).reduce((n,[a,b])=>
                n+docs[c.doc].source.slice(a,b).replace(/\s/gu,'').length,0));
            const data={id:q.id,doc:docs[q.doc].id,cluster:q.cluster,text:q.text,
                goldTokens:Math.min(...q.choices.map(c=>c.gold.tokens.length)),
                sourceSentences:Math.min(...q.choices.map(c=>documentUnits[c.doc].filter(u=>u.prose &&
                    c.ranges.some(([a,b])=>a<u.b && u.a<b)).length)), methods:{}};
            for (const name of methods) {
                const all=plans[name], pool=meta.pool==='document'?all.filter(r=>r.doc===q.doc):all;
                const sim=new Float32Array(all.length);
                for (const r of pool) {
                    if (!scoresByText.has(r.text)) scoresByText.set(r.text,dot(qvec,lookup.get(r.text)));
                    sim[r.id]=scoresByText.get(r.text);
                }
                const trace=retrieve(q,pool,sim,stored.methods[name].outcomes[i]);
                const top=trace.sorted.slice(0,5), original=stored.methods[name].outcomes[i];
                assert.deepEqual([top[0].tokens,encoder.countTokens(top.map(r=>r.text).join('\n\n')),top.length],
                    original.slice(4,7),q.id);
                data.methods[name]=trace.out; evaluated[name]=trace;
                const sentences=sim.slice(), combined=sim.slice(), bridgeGold=[0,0,0];
                for (const apply of probes) apply(name,sentences,combined,bridgeGold);
                for (const row of pool) combined[row.id]=Math.max(combined[row.id],sentences[row.id]);
                trace.out.probe={bridgeGold};
                for (const [label,s] of [['sentences',sentences],['sentencesAndBridges',combined]]) {
                    const rank=trace.evidence.prefix(ranking(pool,s).ranks);
                    trace.out.probe[label]=Number.isFinite(rank)?rank:null;
                }
                const shortestByChoice=trace.evidence.refs.map(ref=>{
                    const eligible=ref[0].filter(id=>ref.every(g=>g.includes(id))).map(id=>all[id]);
                    const shortest=eligible.sort((a,b)=>a.tokens-b.tokens || trace.ranks.get(a.id)-trace.ranks.get(b.id))[0];
                    return shortest?{id:shortest.id,tokens:shortest.tokens,rank:trace.ranks.get(shortest.id)}:null;
                });
                const completeChoices=trace.evidence.refs.flatMap((ref,j)=>ref.every(g=>g.includes(top[0].id))?[j]:[]);
                const focus=completeChoices.length?Math.max(...completeChoices.map(j=>citationChars[j]))/
                    top[0].text.replace(/\s/gu,'').length:null;
                assert.equal(Boolean(completeChoices.length),original[0]===1);
                assert(focus===null || (focus>0 && focus<=1),q.id);
                const delivered=[...new Set(top.map(r=>parents.get(r)??r))];
                const full=trace.evidence.fraction(delivered);
                assert(full+0.000001>=original[3],q.id);
                trace.out.fit={shortestByChoice,completeChoices,focus,top5Tokens:original[5],
                    expand:{first:trace.evidence.fraction(delivered.slice(0,1)),five:full,
                        firstTokens:delivered[0].tokens,fiveTokens:encoder.countTokens(delivered.map(r=>r.text).join('\n\n'))}};
            }
            for (const name of methods.slice(1)) data.methods[name].nested=nestedCounterfactual(q,evaluated.blocks,evaluated[name]);
            records.push(data);
        }
        const result={key,dataSHA256:stored.dataSHA256,baselineSHA256:study.archiveSHA256,
            fold:key.split('-')[1],domain,documents:docMetrics,queries:records,
            contextByDocument:contexts.map(c=>c.stats)};
        const local={plans:Object.fromEntries(methods.map(m=>[m,plans[m].map(({doc,text,spans})=>({doc,text,spans}))])),
            gold:Object.fromEntries(selected.map(({q})=>[q.id,q.choices.map(c=>({doc:docs[c.doc].id,
                ranges:c.ranges,text:c.ranges.map(([a,b])=>docs[c.doc].source.slice(a,b)).join(' ')}))]))};
        for (const [suffix,value] of [['.details',local],['',result]]) {
            const file=join(output,key+suffix+'.json.gz');
            await writeFile(file+'.tmp',gzipSync(JSON.stringify(value))); await rename(file+'.tmp',file);
        }
        console.log(key,records.length,'questions');
    } finally {encoder.close();}
}

const eligible=rows.filter(r=>r.key.startsWith('finance-')?r.queries.some(q=>q[2]==='text'):
    !r.key.startsWith('government-') || r.key.endsWith('-html'));
const selection=process.argv[2];
if (selection==='archive') {
    const verified=[];
    for (const r of eligible) {
        const saved=JSON.parse(gunzipSync(await readFile(join(output,r.key+'.json.gz'))));
        assert.equal(saved.key,r.key);
        assert.equal(saved.dataSHA256,r.dataSHA256);
        assert.equal(saved.baselineSHA256,study.archiveSHA256);
        assert.deepEqual(saved.queries.map(q=>q.id),r.queries.filter(q=>!r.key.startsWith('finance-') || q[2]==='text').map(q=>q[0]));
        verified.push(saved);
    }
    await writeFile(join(results,'2026-11-27-prose-traces.jsonl.gz'),gzipSync(verified.map(v=>JSON.stringify(v)).join('\n')+'\n'));
} else {
    const chosen=eligible.filter(r=>r.key.startsWith(selection??''));
    assert(chosen.length,'Unknown study subset');
    for (const r of chosen) await trace(r);
}
