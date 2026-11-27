import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hierarchicalBlocks } from '../src/hierarchy.js';
import { directionCosine, vectorDirection } from '../src/similarity.js';
import { tokenBudget } from '../src/token-limit.js';
import { here, sha256 } from './corpora.mjs';
import { model, openReplay } from './encoder.mjs';
import { directory, readJSON, settingsManifest } from './semantic-settings-data.mjs';
import { layout, prepareQuestions, retrieve } from './semantic-settings.mjs';
import { dataDir } from './tree-dataset.mjs';
import { treeLayout } from './tree-policy.mjs';

const protocol = await readJSON(join(here,'matched-count-protocol.json'));

// An uncapped tree can only refine an existing partition when another edge is cut.
// Inspect the two attainable counts bracketing K, including the first and last partitions.
export function nearestPartition(cutoffs, countAt, target) {
    const counts = new Map();
    function count(i) {
        if (!counts.has(i)) counts.set(i,countAt(cutoffs[i]));
        return counts.get(i);
    }
    function firstAtLeast(wanted) {
        let lo=0, hi=cutoffs.length;
        while (lo<hi) {
            const mid=Math.floor((lo+hi)/2);
            if (count(mid)<wanted) lo=mid+1;
            else hi=mid;
        }
        return lo;
    }
    const above=firstAtLeast(target);
    let best=Math.min(above,cutoffs.length-1);
    if (above>0 && target-count(above-1)<=Math.abs(count(best)-target)) best=above-1;
    return cutoffs[firstAtLeast(count(best))];
}

// With a finite token cap, imposing a cut can change which later siblings pack
// together. Inspect cutoffs in order so the closest count and ties are exact.
function nearestCappedPartition(cutoffs, countAt, target) {
    let best=cutoffs[0], bestCount=Infinity, bestError=Infinity;
    for (const cutoff of cutoffs) {
        const n=countAt(cutoff), error=Math.abs(n-target);
        if (error===0) return cutoff;
        if (error<bestError || (error===bestError && n<bestCount)) {
            best=cutoff;
            bestCount=n;
            bestError=error;
        }
    }
    return best;
}

export async function scoredTree(doc, encoder, limit=Infinity, separateSections=false) {
    const budget={maxChunkSize:Infinity,fits:tokenBudget(limit,encoder.countTokens,'')};
    const parents=[], edges=[], inputs=new Map();
    function input(s) {
        if (!inputs.has(s)) inputs.set(s,inputs.size);
        return inputs.get(s);
    }
    // The no-veto traversal exposes all eligible sibling pairs in production order.
    const tree=await treeLayout(doc.raw,doc.format,budget,'tree',undefined,(source,node,children)=>{
        parents.push({node,children,blocked:node.blocked});
        for (let i=1;i<children.length;i++) {
            const left=children[i-1], right=children[i];
            if (left.skip || right.skip || left.blocked || right.blocked) continue;
            const a=source.slice(left.start,left.end), b=source.slice(right.start,right.end);
            // The production traversal installs a mandatory break on unscoreable pairs.
            if (budget.fits && (!budget.fits(a) || !budget.fits(b) || !budget.fits(source.slice(left.start,right.end)))) continue;
            edges.push({right,breakBefore:right.breakBefore,leftInput:input(a),rightInput:input(b)});
        }
    },separateSections);
    assert.equal(tree.source,doc.source);
    const texts=[...inputs.keys()];
    const directions=texts.length ? (await encoder.embed(texts)).map(vectorDirection) : [];
    const cosines=edges.map(e=>directionCosine(directions[e.leftInput],directions[e.rightInput]));
    const scores=[...new Set(cosines)].sort((a,b)=>a-b);
    // With the public strict '<' test these cutoffs cover every attainable partition.
    const cutoffs=[-1];
    for (let i=0;i<scores.length && scores[i]<1;i++) {
        const upper=scores[i+1] ?? 1;
        const mid=(scores[i]+upper)/2;
        cutoffs.push(mid>scores[i] ? mid : upper);
    }
    function partition(threshold, order) {
        for (let i=0;i<edges.length;i++) {
            const e=edges[i];
            e.right.breakBefore=e.breakBefore || order[i]<threshold;
        }
        for (let i=parents.length-1;i>=0;i--) {
            const p=parents[i];
            p.node.blocked=p.blocked || p.children.some(c=>c.breakBefore || c.blocked || c.skip);
        }
        return hierarchicalBlocks(tree.source,[parents[0].node],{...budget,splitLeaf:tree.splitLeaf});
    }
    function match(target, seed) {
        if (!edges.length) return {cutoff:-1,rows:tree.rows};
        let order=cosines;
        if (seed!==undefined) {
            order=cosines.map((value,i)=>({value,key:sha256(JSON.stringify([doc.id,doc.format,seed,i]))}))
                .sort((a,b)=>a.key<b.key ? -1 : a.key>b.key ? 1 : 0).map(x=>x.value);
        }
        const choose=limit===Infinity ? nearestPartition : nearestCappedPartition;
        const cutoff=choose(cutoffs,t=>partition(t,order).length,target);
        return {cutoff,rows:partition(cutoff,order).map(tree.render)};
    }
    function at(threshold) {
        return edges.length ? partition(threshold,cosines).map(tree.render) : tree.rows;
    }
    return {match,at,headings:tree.headings,cutoffs,edges:edges.length,longInputs:texts.filter(t=>encoder.countTokens(t)>8191).length};
}

export function layoutHash(byDoc) {
    return sha256(JSON.stringify(byDoc.map(rows=>rows.map(r=>[r.text,r.sourceRanges]))));
}

export async function matchedLayout(doc, encoder, target, limit) {
    const tree=await scoredTree(doc,encoder,limit);
    const fitted=tree.match(target);
    const actual=await layout(doc,'semantic-blocks/'+fitted.cutoff,limit,encoder);
    assert.equal(actual.over,0);
    assert.equal(layoutHash([actual.rows]),layoutHash([fitted.rows]),doc.id);
    return {tree,rows:actual.rows,cutoff:fitted.cutoff};
}

export async function openStudySet(key, meta) {
    const raw=await readFile(join(directory,key+'.json'),'utf8');
    assert.equal(sha256(raw),meta.sha256);
    const docs=JSON.parse(raw);
    const known=key.startsWith('government-') || /^faq-(development|confirmation)-/u.test(key);
    const cohort=key.replace(/-(html|text|markdown|masked)$/u,'')+'.0';
    const bank=join(known ? dataDir : directory,'vectors',model,meta.vectorBank ?? cohort);
    return {docs,encoder:await openReplay(undefined,bank,{lengthSafe:true,concurrency:4})};
}

async function run(key) {
    assert.equal(model,protocol.model);
    const meta=(await readJSON(settingsManifest)).sets[key];
    assert(meta && !key.endsWith('-published'));
    const folder=join(directory,'matched-count',model), file=join(folder,key+'.json');
    const protocolSHA256=sha256(JSON.stringify(protocol));
    await mkdir(folder,{recursive:true});
    let prior;
    try {
        prior=await readJSON(file);
        assert.equal(prior.dataSHA256,meta.sha256);
        assert.equal(prior.protocolSHA256,protocolSHA256);
        if (prior.version===2) return;
    } catch (e) { if (e.code!=='ENOENT') throw e; }
    const {docs,encoder}=await openStudySet(key,meta);
    try {
        const plans=await Promise.all(docs.map(async doc=>{
            const base=await layout(doc,'blocks',protocol.blockTokens,encoder);
            assert.equal(base.over,0);
            const k=base.rows.length;
            const {tree,cutoff,rows}=await matchedLayout(doc,encoder,k,Infinity);
            const methods={blocks:{rows:base.rows},semantic:{cutoff,rows}};
            for (const seed of protocol.shuffles) methods['shuffle'+seed]=tree.match(k,seed);
            return {id:doc.id,edges:tree.edges,longInputs:tree.longInputs,methods};
        }));
        const qs=prepareQuestions(docs,encoder);
        const report={version:2,key,dataSHA256:meta.sha256,protocolSHA256,
            queries:qs.map(q=>[q.id,q.cluster,q.kind ?? 'published',q.doc]),documents:plans.map(p=>({
                id:p.id,edges:p.edges,longInputs:p.longInputs,methods:Object.fromEntries(Object.entries(p.methods).map(
                    ([m,v])=>[m,{cutoff:v.cutoff,layoutSHA256:layoutHash([v.rows]),sizes:v.rows.map(r=>encoder.countTokens(r.text))}]))})),methods:{}};
        for (const name of Object.keys(plans[0].methods)) {
            const byDoc=plans.map((p,i)=>p.methods[name].rows.map(r=>({...r,doc:i})));
            report.methods[name]={layoutSHA256:layoutHash(byDoc),outcomes:await retrieve(docs,qs,byDoc,meta.pool,encoder,'diagnostics')};
            if (prior) {
                assert.equal(report.methods[name].layoutSHA256,prior.methods[name].layoutSHA256);
                const previous=prior.methods[name].outcomes;
                assert.deepEqual(report.methods[name].outcomes.map((v,i)=>v.slice(0,previous[i].length)),previous);
            }
        }
        report.newTokens=(prior?.newTokens ?? 0)+encoder.stats.apiInputTokens;
        await writeFile(file+'.tmp',JSON.stringify(report));
        await rename(file+'.tmp',file);
        console.log(key,docs.length,'documents',qs.length,'questions');
    } finally { encoder.close(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await run(process.argv[2]);
