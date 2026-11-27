import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTextTree } from '../src/sentences.js';
import { sha256 } from './corpora.mjs';
import { model, openReplay } from './encoder.mjs';
import { layout } from './semantic-settings.mjs';
import { directory, readJSON, resultsDir } from './semantic-settings-data.mjs';
import { dataDir, manifestPath, readData } from './tree-dataset.mjs';
import { ordinals, prepareBoundaries } from './tree-evidence.mjs';

const [key,part] = process.argv.slice(2), shard = Number(part);
const wiki = key === 'wiki-confirmation';
assert(wiki || key === 'meetings-confirmation');
assert.equal(model,'text-embedding-3-small');
const dir = join(directory,'topics');
await mkdir(dir,{recursive:true});
const path = join(dir,key+'.'+shard+'.json');
const frozen = JSON.parse(await readFile(join(resultsDir,'2026-11-26-semantic-settings-nominees.json'),'utf8')).selection;
const methods = [...new Set(['blocks','pack',...Object.values(frozen)])];
try {
    await access(path); assert.deepEqual(Object.keys((await readJSON(path)).methods),methods); process.exit(0);
} catch (e) {if (e.code !== 'ENOENT') throw e;}
const all = await readData(key);
assert.equal(sha256(JSON.stringify(all)),(await readJSON(manifestPath)).boundaries[key].sha256);
const width = wiki ? 24 : 5;
const docs=all.toSorted((a,b)=>sha256(a.id).localeCompare(sha256(b.id),'en')).slice(shard*width,(shard+1)*width);
assert(docs.length);
const replay=await openReplay(undefined,join(dataDir,'vectors',model,key+'.'+shard),{concurrency:4});
try {
    for (const doc of docs) {
        prepareBoundaries(doc);
        doc.format='text'; ({source:doc.source}=await parseTextTree(doc.raw,{inputFormat:'text'}));
        doc.ord=ordinals(doc.source);
        assert.equal(doc.source.replace(/\s/gu,''),doc.raw.replace(/\s/gu,''));
    }
    const result = {key,shard,documents:docs.map(d=>d.id),methods:{}};
    for (const method of methods) {
        result.methods[method] = await Promise.all(docs.map(async doc=>{
            const {rows,over} = await layout(doc,method,256,replay);
            assert.equal(over,0);
            const cuts = new Set(rows.slice(1).map(r=>doc.ord[r.sourceRanges[0].start]));
            const predicted = [...cuts].filter(i=>wiki || doc.known.has(i));
            return [predicted.length,predicted.filter(i=>doc.gold.has(i)).length,doc.gold.size,cuts.size-predicted.length];
        }));
    }
    result.newTokens=replay.stats.apiInputTokens;
    await writeFile(path+'.tmp',JSON.stringify(result)); await rename(path+'.tmp',path);
    console.log(key,shard,'complete');
} finally {replay.close();}
