import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {cache, sha256} from './corpora.mjs';
import {dimension, openReplay} from './encoder.mjs';

// Add a complete document direction to each archived hierarchy. Reuse only
// vectors whose full input hash and original vector-file checksum match.
async function indexShard(key) {
    const root = join(cache, 'document-routing', key);
    await mkdir(root, {recursive:true});
    const data = JSON.parse(await readFile(join(cache,'context-mixtures','data',key+'.json')));
    const sources = data.docs.map(d=>d.source), hashes = sources.map(sha256);
    const bank = await openReplay(undefined,join(root,'vectors'),{lengthSafe:true,concurrency:3});
    try {
        const vectors = [];
        for (const [i,hash] of hashes.entries()) {
            const stem = join(cache,'hierarchy-probes','indexes',key,String(i));
            const idx = JSON.parse(gunzipSync(await readFile(stem+'.json.gz')));
            const row = idx.hashes.indexOf(hash);
            if (row < 0) continue;
            const bytes = await readFile(stem+'.f32');
            assert.equal(sha256(bytes),idx.vectorSHA256);
            vectors[i] = bytes.subarray(row*dimension*4,(row+1)*dimension*4);
        }
        const missing = sources.flatMap((_,i)=>vectors[i] ? [] : [i]);
        const fresh = await bank.embed(missing.map(i=>sources[i]));
        missing.forEach((i,j)=>{
            const v = fresh[j];
            vectors[i] = Buffer.from(v.buffer,v.byteOffset,v.byteLength);
        });
        const bytes = Buffer.concat(vectors);
        await writeFile(join(root,'documents.f32.tmp'),bytes);
        await rename(join(root,'documents.f32.tmp'),join(root,'documents.f32'));
        const manifest = {ids:data.docs.map(d=>d.id),hashes,tokens:sources.map(bank.countTokens),sha256:sha256(bytes)};
        await writeFile(join(root,'manifest.json.tmp'),JSON.stringify(manifest));
        await rename(join(root,'manifest.json.tmp'),join(root,'manifest.json'));
    } finally {bank.close();}
}

const argv = process.argv.slice(2);
const manifest = JSON.parse(await readFile(join(cache,'context-mixtures','data','manifest.json')));
for (const key of argv.length ? argv : Object.keys(manifest)) await indexShard(key);
