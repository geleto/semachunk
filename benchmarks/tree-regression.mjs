import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkText } from '../src/index.js';
import { tokenBudget } from '../src/token-limit.js';
import { alignPlain } from './delivered-context.mjs';
import { cache, here } from './corpora.mjs';
import { model, openEncoder, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { evaluateQuality } from './quality.mjs';
import { friendsDialogue, meetings } from './semantic-corpora.mjs';
import { treeLayout } from './tree-policy.mjs';

const name = process.argv[2], output = join(cache,'tree-corpus','regression');
assert.equal(model,'text-embedding-3-small');
assert(['squad','wikisection','qasper','finqa','cuad','hotpotqa','qmsum','friendsqa'].includes(name));
await mkdir(output,{recursive:true});
const original = JSON.parse(await readFile(join(here,'results/2026-11-26-semantic-blocks-cutoffs.json'),'utf8'));
const methods = ['tree','paragraph','0.15'], result = {};
if (['squad','wikisection'].includes(name)) {
    const encoder = openEncoder();
    const splitter = async (text,callback,options) => {
        if (!options.experimental) return chunkText(text,callback,options);
        const {rows} = await treeLayout(text,'text',{maxChunkSize:options.maxChunkSize},options.experimental,callback);
        if (options.returnEmbedding && rows.length) await callback([...new Set(rows.map(r => r.text))]);
        return rows;
    };
    try {
        const plans = Object.fromEntries(methods.map(m => [m,{experimental:m,chunkingStrategy:'semantic-blocks',maxChunkSize:500}]));
        const now = await evaluateQuality(name,splitter,encoder,plans), old = original.quality[name];
        assert.deepEqual(now.documents,old.documents);
        for (const m of methods) result[m] = now.scores[m].heldout;
        const field = name === 'squad' ? 'hits' : 'matched';
        assert.equal(result['0.15'][field],old.scores['500/0.15'].heldout[field]);
        for (const m of ['blocks','semantic']) result[m] = old.scores['500/'+m].heldout;
    } finally { encoder.close(); }
} else {
    const old = original.retrieval.heldout[name], format = original.protocol.formats[name];
    const dataset = name === 'qmsum' ? await meetings('test') : name === 'friendsqa' ? (await friendsDialogue('test')).dataset
        : (await markdownCorpora('replication'))[name];
    assert.deepEqual(JSON.parse(JSON.stringify(manifest({[name]:dataset})[name])),old.sample);
    const encoder = await openReplay(undefined,undefined,{concurrency:3});
    try {
        await prepareDataset(dataset,encoder);
        const deliveries = [['five512',5,512],['five1024',5,1024]];
        async function indexer(doc,policy,work) {
            const prefix = doc.chunkPrefix?.trim() ? doc.chunkPrefix + ': ' : '';
            const fits = tokenBudget(256,encoder.countTokens,prefix);
            const embed = texts => {
                work.calls++; work.texts += texts.length; work.singletons += Number(texts.length === 1);
                work.embeddedTokens += texts.reduce((n,s) => n + encoder.countTokens(s),0);
                return encoder.embed(texts);
            };
            const {rows} = await treeLayout(doc.source,format,{maxChunkSize:Infinity,fits},policy.method,embed);
            const chunks = (format === 'markdown' ? rows : alignPlain(doc.source,rows.map(r => r.text))).filter(r => fits(r.text));
            for (const r of chunks) {
                if (prefix) r.embeddingText = prefix + r.text;
                work.indexTexts++; work.indexTokens += encoder.countTokens(r.embeddingText ?? r.text);
            }
            return chunks;
        }
        for (const method of methods) {
            const row = await evaluate(name,dataset,{method,tokens:256},encoder,'semantic',{deliveries,indexer});
            result[method] = {chunks:row.indexTexts,retrieval:row.retrieval,hits:row.hits,...(row.recalls && {recalls:row.recalls})};
        }
        assert.deepEqual(result['0.15'].hits,old.rows['0.15'].hits);
        for (const m of ['blocks','semantic']) result[m] = {chunks:old.rows[m].chunks,retrieval:old.rows[m].retrieval,
            hits:old.rows[m].hits,...(old.rows[m].recalls && {recalls:old.rows[m].recalls})};
    } finally { encoder.close(); }
}
await writeFile(join(output,name+'.json'),JSON.stringify(result));
console.log('Replicated',name);
