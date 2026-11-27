import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkText } from '../src/index.js';
import { alignPlain } from './delivered-context.mjs';
import { model, openEncoder, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { evaluateQuality } from './quality.mjs';
import { friendsDialogue, meetings } from './semantic-corpora.mjs';
import { adjustBoundaries } from './semantic-boundary.mjs';
import { directory, readJSON, resultsDir } from './semantic-settings-data.mjs';
import { treeLayout } from './tree-policy.mjs';

const task=process.argv[2], dir=join(directory,'regression'), file=join(dir,task+'.json');
await mkdir(dir,{recursive:true});
const {selection}=await readJSON(join(resultsDir,'2026-11-26-semantic-settings-nominees.json'));
try {await access(file); assert.deepEqual((await readJSON(file)).selection,selection);process.exit(0);}
catch(e){if(e.code!=='ENOENT')throw e;}
assert.equal(model,'text-embedding-3-small');
const original=await readJSON(join(resultsDir,'2026-11-26-semantic-blocks-cutoffs.json'));
const rows={};
function semanticOptions(name) {
    const [chunkingStrategy,setting]=name.split('/');
    if (setting==='document') return {chunkingStrategy,mergeThresholdMode:'document'};
    if (setting==='shipped' || !setting) return {chunkingStrategy};
    return {chunkingStrategy,combineChunksSimilarityThreshold:Number(setting)};
}
if (task==='squad'||task==='wikisection') {
    const encoder=openEncoder();
    try{
        const methods=['blocks',selection.semantic,selection['semantic-blocks'],'semantic/shipped'];
        const plans=Object.fromEntries(methods.map(m=>[m,{...semanticOptions(m),maxChunkSize:500}]));
        const result=await evaluateQuality(task,chunkText,encoder,plans);
        assert.deepEqual(result.documents,original.quality[task].documents);
        for (const m of methods) rows[m]=result.scores[m].heldout;
    } finally{encoder.close();}
} else {
    const old=original.retrieval.heldout[task], format=original.protocol.formats[task];
    const dataset=task==='friendsqa' ? (await friendsDialogue('test')).dataset : task==='qmsum' ? await meetings('test')
        : (await markdownCorpora('replication'))[task];
    assert.deepEqual(JSON.parse(JSON.stringify(manifest({[task]:dataset})[task])),old.sample);
    const encoder=await openReplay(undefined,join(directory,'vectors',model,'historical-'+task),{concurrency:4});
    try {
        await prepareDataset(dataset,encoder);
        const deliveries=[['five512',5,512],['five1024',5,1024]];
        for (const m of ['blocks',...Object.values(selection)]) {
            const experimental=m.startsWith('boundary/')||m.startsWith('paragraph/');
            async function indexer(doc,_policy,work) {
                assert(!doc.chunkPrefix);
                const embed=texts=>{
                    work.calls++; work.texts+=texts.length;
                    work.embeddedTokens+=texts.reduce((n,s)=>n+encoder.countTokens(s),0);
                    return encoder.embed(texts);
                };
                const data={raw:doc.source,format};
                const layout=m.startsWith('boundary/') ? await adjustBoundaries(data,256,encoder.countTokens,m.split('/')[1],embed) :
                    await treeLayout(doc.source,format,{maxChunkSize:Infinity,fits:s=>encoder.countTokens(s)<=256},m,embed);
                const chunks=format==='markdown'?layout.rows:alignPlain(doc.source,layout.rows.map(r=>r.text));
                work.indexTexts=chunks.length;
                work.indexTokens=chunks.reduce((n,r)=>n+encoder.countTokens(r.text),0);
                return chunks;
            }
            const policy=experimental ? {method:m,tokens:256} : {method:format==='markdown'?'public-markdown':'plain-priority',
                ...semanticOptions(m),tokens:256};
            const result=await evaluate(task,dataset,policy,encoder,'semantic',{deliveries,...(experimental&&{indexer})});
            assert.equal(result.overTarget,0);
            rows[m]={chunks:result.indexTexts,retrieval:result.retrieval,hits:result.hits};
        }
        rows['semantic/shipped']={chunks:old.rows.semantic.chunks,retrieval:old.rows.semantic.retrieval,hits:old.rows.semantic.hits};
    } finally {encoder.close();}
}
await writeFile(file,JSON.stringify({selection,task,rows}));
console.log('Historical regression',task);
