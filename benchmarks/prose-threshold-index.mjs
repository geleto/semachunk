import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tokenBudget } from '../src/token-limit.js';
import { cache, here, sha256 } from './corpora.mjs';
import { model } from './encoder.mjs';
import { layoutHash, openStudySet, scoredTree } from './matched-count.mjs';
import { dot, union } from './prose-evidence.mjs';
import { repairProseSource } from './prose-revision.mjs';
import { readJSON } from './semantic-settings-data.mjs';
import { layout } from './semantic-settings.mjs';
import { attachHeadings, treeLayout } from './tree-policy.mjs';

const results = join(here, 'results'), directory = join(cache, 'prose-thresholds');
const protocol = await readJSON(join(here, 'prose-threshold-protocol.json'));
const low = process.argv.includes('--low');
const extension = low ? await readJSON(join(here,'prose-low-threshold-protocol.json')) : null;
const manifest = await readJSON(join(results, '2026-11-27-audited-data.json'));
const fingerprint = sha256(JSON.stringify(low ? [protocol,extension] : protocol));
const archived = gunzipSync(await readFile(join(results,'2026-11-27-whole-passage-audited-outcomes.jsonl.gz')))
    .toString().trimEnd().split('\n').map(JSON.parse);
const selected = archived.filter(r => r.key.startsWith('finance-') ? r.queries.some(q => q[2] === 'text') :
    !r.key.startsWith('government-') || r.key.endsWith('-html'));
assert.equal(model, protocol.model);

async function run(ref) {
    const key = ref.key, meta = manifest.sets[key], file = join(directory,key+(low?'.low':'')+'.json.gz');
    assert.equal(meta.sha256,ref.dataSHA256);
    const {docs: original,encoder} = await openStudySet(key,meta);
    try {
        const docs = original.map(repairProseSource);
        const passages = [], textIds = new Map(), documents = [], plans = {};
        function textId(text) {
            if (!textIds.has(text)) textIds.set(text,textIds.size);
            return textIds.get(text);
        }
        for (const [di,doc] of docs.entries()) {
            const positions = new Map(), perDoc = {};
            function addPlan(name,rows) {
                const ids = rows.map(row => {
                    const v = textId(row.text);
                    const spans = union(row.sourceRanges.map(r => [r.start,r.end]));
                    for (const r of row.sourceRanges) assert.equal(doc.source.slice(r.start,r.end),
                        row.text.slice(r.outputStart,r.outputStart+r.end-r.start));
                    const key = JSON.stringify([v,spans]);
                    if (!positions.has(key)) {
                        positions.set(key,passages.length);
                        passages.push({doc:di,v,spans,tokens:encoder.countTokens(row.text)});
                    }
                    return positions.get(key);
                });
                (plans[name] ??= []).push(ids);
                perDoc[name] = ids.length;
            }
            for (const cap of protocol.limits) {
                const limit = cap === 'unlimited' ? Infinity : cap;
                const budget = {maxChunkSize:Infinity,fits:tokenBudget(limit,encoder.countTokens,'')};
                for (const mode of protocol.sectionModes) {
                    const sections = mode === 'sections';
                    const tree = await scoredTree(doc,encoder,limit,sections);
                    const structural = sections ? await treeLayout(doc.raw,doc.format,budget,'blocks',undefined,undefined,true)
                        : await layout(doc,'blocks',limit,encoder);
                    if (!sections && limit===256 && doc===original[di])
                        assert.equal(layoutHash([structural.rows]),ref.documents[di].methods.blocks.layoutSHA256,doc.id);
                    const emit = (name,rows) => addPlan([mode,cap,name].join('/'),sections ? attachHeadings(tree.headings,rows) : rows);
                    emit('blocks',structural.rows);
                    for (const threshold of (extension ?? protocol).thresholds) {
                        const rows = tree.at(threshold);
                        if (!sections && threshold===(low ? 0 : 0.25) && di===0) {
                            const direct = await layout(doc,'semantic-blocks/'+threshold,limit,encoder);
                            assert.equal(layoutHash([rows]),layoutHash([direct.rows]),doc.id);
                        }
                        emit(threshold,rows);
                    }
                }
            }
            documents.push({id:doc.id,sha256:sha256(doc.source),counts:perDoc});
        }
        const queries = docs.flatMap((doc,di) => doc.questions.filter(q =>
            !key.startsWith('finance-') || q.kind==='text').map(q => ({id:q.id,doc:di,text:q.text})));
        const texts = [...textIds.keys()];
        const vectors = await encoder.embed(texts), qvecs = await encoder.embed(queries.map(q => q.text));
        const owners = docs.map((_,i) => new Set(passages.filter(p => p.doc===i).map(p => p.v)));
        for (const [i,q] of queries.entries()) {
            const scores = new Float32Array(texts.length);
            const ids = meta.pool === 'document' ? owners[q.doc] : texts.keys();
            for (const v of ids) scores[v] = dot(qvecs[i],vectors[v]);
            q.scores = Buffer.from(scores.buffer).toString('base64');
        }
        const data = {key,protocolSHA256:fingerprint,dataSHA256:meta.sha256,documents,plans,passages,texts,queries};
        await writeFile(file+'.tmp',gzipSync(JSON.stringify(data)));
        await rename(file+'.tmp',file);
        console.log(key,queries.length,'queries',texts.length,'index texts');
    } finally { encoder.close(); }
}
await mkdir(directory,{recursive:true});
const prefix = process.argv.slice(2).find(v=>v!=='--low') ?? '';
if (prefix==='list') console.log(selected.map(s=>s.key).join('\n'));
else {
    const keys = selected.filter(r => r.key.startsWith(prefix));
    assert(keys.length,'No matching dataset');
    for (const ref of keys) await run(ref);
}
