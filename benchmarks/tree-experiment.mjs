import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkText } from '../src/index.js';
import { ordinals, prepareBoundaries, projectPlain, scores } from './tree-evidence.mjs';
import { treeLayout } from './tree-policy.mjs';
import { deliver, goldReference } from './delivered-context.mjs';
import { denseRanker, vocabulary } from './chunking.mjs';
import { sha256 } from './corpora.mjs';
import { openReplay, model, dimension } from './encoder.mjs';
import { dataDir, manifestPath, readData } from './tree-dataset.mjs';

const file = JSON.parse(await readFile(manifestPath,'utf8'));
const [key, mode = 'tokens', shardArg = '0'] = process.argv.slice(2);
const boundary = Object.hasOwn(file.boundaries,key);
assert(boundary || Object.hasOwn(file.retrieval,key), 'Supply a dataset key from the corpus manifest');
assert(['tokens','chars'].includes(mode));
const shard = Number(shardArg), limit = mode === 'tokens' ? 256 : 1024;
const format = key.startsWith('government-') ? key.split('-').at(-1) : boundary ? 'text' : 'markdown';
const dir = join(dataDir, 'runs', model, mode);
await mkdir(dir,{recursive:true});
const output = join(dir, key + '.' + shard + '.json');
try { await access(output); process.exit(0); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const full = await readData(key);
assert.equal(sha256(JSON.stringify(full)), (boundary ? file.boundaries : file.retrieval)[key].sha256);
const ordered = boundary ? full.toSorted((a,b) => sha256(a.id).localeCompare(sha256(b.id),'en')) : full;
const wiki = key.startsWith('wiki-'), panel = model.endsWith('large') || mode === 'chars';
const eligible = boundary && panel ? ordered.slice(0,wiki ? 32 : 12) : ordered;
const width = boundary ? wiki ? 24 : 5 : eligible.length;
const docs = eligible.slice(shard * width,(shard + 1)*width);
assert(docs.length > 0);
const cohort = key.replace(/-(html|markdown|text|masked|published)$/u,'') + '.' + shard;
const encoder = await openReplay(undefined, join(dataDir,'vectors',model,cohort), {concurrency:5});
const methods = ['blocks','tree','0.05','0.15','0.30','paragraph'];
if (!boundary && !panel) methods.push('semantic');
const queries = docs.flatMap((d,i) => (d.questions ?? []).map(q => ({...q,doc:i})));
const results = {}, cacheScores = new Map();
const count = encoder.countTokens;
const budget = mode === 'tokens' ? { maxChunkSize: Infinity, fits: s => count(s) <= limit } : {maxChunkSize:limit};
const fits = s => s.length <= budget.maxChunkSize && (!budget.fits || budget.fits(s));
const canonical = text => text.replace(/\s/gu,'');

if (boundary) docs.forEach(prepareBoundaries);
else {
    for (const doc of docs) {
        doc.offsets = encoder.offsets(doc.source);
        doc.ends = doc.offsets.map(x => x[1]);
    }
    for (const q of queries) q.gold = goldReference(q.ranges.map(([a,b]) => [q.doc,a,b]),docs);
    await encoder.embed(queries.map(q => q.text));
}

async function layout(doc,method) {
    let selectionTokens = 0, selectionInputs = 0;
    async function embed(texts) {
        selectionTokens += texts.reduce((n,s) => n + count(s),0);
        selectionInputs += texts.length;
        return encoder.embed(texts);
    }
    let rows, source = doc.source, edges = [];
    if (method === 'semantic') {
        rows = await chunkText(doc.raw, embed, { inputFormat:format, chunkingStrategy:'semantic', returnEmbedding:false,
            maxChunkSize:budget.maxChunkSize, maxChunkTokens:mode === 'tokens' ? limit : Infinity, countTokens:count });
        if (format !== 'markdown') rows = projectPlain(source,rows);
    } else {
        function observe(body,node,nested,paragraph) {
            for (let j = 1; j < nested.length; j++) {
                const left = nested[j-1], right = nested[j];
                if (left.skip || right.skip || left.blocked || right.blocked) continue;
                const span = body.slice(left.start,right.end);
                if (!fits(span) || !fits(body.slice(left.start,left.end)) || !fits(body.slice(right.start,right.end))) continue;
                const half = (mode === 'tokens' ? count(span) : span.length) <= limit/2;
                const role = paragraph ? 'paragraph' : node.kind ?? (node.depth ? 'section' : 'group');
                edges.push({right,bin:role + (half ? '/small' : '/large')});
            }
        }
        // This archived study compared the original independent roots to the shared document root.
        ({source,rows} = await treeLayout(doc.raw,format,budget,method === 'blocks' ? 'independent-roots' : method,embed,
            method === '0.15' ? observe : undefined));
        if (boundary && !doc.ord) {
            assert.equal(canonical(source),canonical(doc.raw));
            doc.ord = ordinals(source);
        } else if (!boundary) assert.equal(source, doc.source);
    }
    const edgeBins = {};
    for (const {right,bin} of edges) {
        const g = edgeBins[bin] ??= [0,0,0,0];
        g[0]++;
        if (right.breakBefore) g[1]++;
        if (boundary) {
            const k = doc.ord[right.start];
            if (doc.gold.has(k)) {g[2]++; if (right.breakBefore) g[3]++;}
        }
    }
    return {rows,selectionTokens,selectionInputs,edgeBins};
}

async function retrieve(layouts) {
    const vocab = vocabulary(), passages = [];
    layouts.forEach(({rows},d) => rows.forEach(r => passages.push({...r,doc:d,index:vocab.intern(r.text)})));
    for (const q of queries) vocab.intern(q.text);
    const hit = sha256(JSON.stringify(passages.map(r => [r.doc,r.text,r.sourceRanges])));
    if (cacheScores.has(hit)) return cacheScores.get(hit);
    const vectors = await encoder.embed(vocab.texts), matrix = new Float32Array(vectors.length*dimension);
    vectors.forEach((v,i) => matrix.set(v,i*dimension));
    const dense = denseRanker(matrix), pools = new Map();
    const values = queries.map(q => {
        if (!pools.has(q.doc)) {
            const eligible = passages.filter(r => r.doc === q.doc || !key.startsWith('government-') || docs[r.doc].group !== docs[q.doc].group);
            pools.set(q.doc,{eligible,indices:eligible.map(r => r.index)});
        }
        const {eligible,indices} = pools.get(q.doc);
        const top = dense(vocab.id(q.text),indices).slice(0,5).map(i => eligible[i]);
        return [512,1024].flatMap(b => scores(q,deliver(top,b,encoder,false).ranges));
    });
    cacheScores.set(hit,values);
    return values;
}

let noCuts;
for (const method of methods) {
    const layouts = await Promise.all(docs.map(d => layout(d, method)));
    const row = {selectionTokens:0,selectionInputs:0,packets:0,indexTokens:0,overLimit:0, edgeBins:{}};
    for (const l of layouts) {
        row.selectionTokens += l.selectionTokens; row.selectionInputs += l.selectionInputs;
        row.packets += l.rows.length;
        for (const r of l.rows) {
            if (!boundary) row.indexTokens += count(r.text);
            if (!fits(r.text)) row.overLimit++;
        }
        for (const [k, bins] of Object.entries(l.edgeBins)) {
            const t = row.edgeBins[k] ??= [0,0,0,0];
            bins.forEach((x,i) => t[i] += x);
        }
    }
    if (boundary) {
        const cuts = layouts.map((l,i) => new Set(l.rows.slice(1).map(r => docs[i].ord[r.sourceRanges[0].start])));
        if (method === 'tree') noCuts = cuts;
        row.boundaries = cuts.map((positions,i) => {
            const d = docs[i], evaluable = k => wiki || d.known.has(k), gold = k => d.gold.has(k);
            const scored = [...positions].filter(evaluable), added = scored.filter(k => noCuts && !noCuts[i].has(k));
            const lost = noCuts ? [...noCuts[i]].filter(k => !positions.has(k) && evaluable(k)) : [];
            return [scored.length,scored.filter(gold).length,d.gold.size,added.length,added.filter(gold).length,
                lost.length,lost.filter(gold).length,positions.size-scored.length];
        });
    } else row.values = await retrieve(layouts);
    results[method] = row;
}
const report = {key,format,mode,limit,model,shard, datasetSHA256:(boundary ? file.boundaries : file.retrieval)[key].sha256,
    documents:docs.map(d => d.id), queries:queries.map(q => [q.id,q.doc,docs[q.doc].group,q.gold.tokens.length]),
    results,provider:encoder.stats};
await writeFile(output + '.tmp',JSON.stringify(report));
await rename(output + '.tmp',output);
encoder.close();
console.log(model, mode, key, shard, 'documents',docs.length,'questions',queries.length,'new tokens',report.provider.apiInputTokens);
