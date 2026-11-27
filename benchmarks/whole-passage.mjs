import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { here, sha256 } from './corpora.mjs';
import { model } from './encoder.mjs';
import { layoutHash, matchedLayout, openStudySet } from './matched-count.mjs';
import { directory, readJSON, settingsManifest } from './semantic-settings-data.mjs';
import { layout, prepareQuestions, retrieve } from './semantic-settings.mjs';

const key=process.argv[2];
const protocol=await readJSON(join(here,'whole-passage-protocol.json'));
if (key.includes('-filing-')) Object.assign(protocol,await readJSON(join(here,'whole-passage-filings-protocol.json')));
if (key.includes('-reviewed')) Object.assign(protocol,await readJSON(join(here,'whole-passage-audited-protocol.json')));
const manifest=protocol.data ? join(here,'results',protocol.data) : settingsManifest;
const meta=(await readJSON(manifest)).sets[key];
assert.equal(model,protocol.model);
assert(meta && !key.endsWith('-published'));
const folder=join(directory,'whole-passage',model), file=join(folder,key+'.json');
const protocolSHA256=sha256(JSON.stringify(protocol));
await mkdir(folder,{recursive:true});
try {
    const prior=await readJSON(file);
    if (prior.dataSHA256===meta.sha256 && prior.protocolSHA256===protocolSHA256) process.exit(0);
} catch (e) { if (e.code!=='ENOENT') throw e; }

const {docs,encoder}=await openStudySet(key,meta);
try {
    const plans=await Promise.all(docs.map(async doc=>{
        const blocks=await layout(doc,'blocks',protocol.limits.blocks,encoder);
        assert.equal(blocks.over,0);
        const k=blocks.rows.length;
        const methods={blocks};
        for (const name of ['semantic512','semanticUnlimited']) {
            const limit=Number(protocol.limits[name]);
            const {rows,cutoff}=await matchedLayout(doc,encoder,k,limit);
            methods[name]={rows,cutoff};
        }
        return methods;
    }));
    const queries=prepareQuestions(docs,encoder);
    const report={key,dataSHA256:meta.sha256,protocolSHA256,
        queries:queries.map(q=>[q.id,q.cluster,q.kind ?? 'published',q.doc]),
        documents:docs.map((d,i)=>({id:d.id,methods:Object.fromEntries(Object.entries(plans[i]).map(([m,v])=>[
            m,{cutoff:v.cutoff,layoutSHA256:layoutHash([v.rows]),sizes:v.rows.map(r=>encoder.countTokens(r.text))}
        ]))})),methods:{}};
    for (const name of Object.keys(protocol.limits)) {
        const byDoc=plans.map((p,i)=>p[name].rows.map(r=>({...r,doc:i})));
        report.methods[name]={layoutSHA256:layoutHash(byDoc),
            outcomes:await retrieve(docs,queries,byDoc,meta.pool,encoder,'whole')};
    }
    report.newTokens=encoder.stats.apiInputTokens;
    await writeFile(file+'.tmp',JSON.stringify(report));
    await rename(file+'.tmp',file);
    console.log(key,docs.length,'documents',queries.length,'questions');
} finally { encoder.close(); }
