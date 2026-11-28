import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {getChunkContext} from '../src/index.js';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {sourceSpans} from '../src/citations.js';
import {cache,sha256} from './corpora.mjs';
import {openTokenizer} from './encoder.mjs';
import {canonicalMapper,sourceOptions} from './bounded-source.mjs';

const root=join(cache,'structural-limits'), original=join(cache,'context-mixtures');
const registry=JSON.parse(await readFile(join(original,'data/manifest.json')));
const outlines=JSON.parse(await readFile(join(cache,'scope-weights/source-headings.json')));
const tokenizer=openTokenizer();
try {
    for (const [key,meta] of Object.entries(registry)) {
        const data=JSON.parse(await readFile(join(original,meta.fold==='fresh'?'audited-data':'data',key+'.json')));
        for (const [i,doc] of data.docs.entries()) {
            const stem=join(root,key,String(i));
            const measured=JSON.parse(gunzipSync(await readFile(stem+'.json.gz')));
            const {options,mapping}=await sourceOptions(doc,outlines[key][i].headings,tokenizer.countTokens);
            const canonical=canonicalMapper(mapping), windows={};
            for (const cap of [256,384]) {
                const layout=await chunkDocument(doc.raw,{...options,maxChunkSize:256,maxStructuralSize:256,maxPassageSize:cap});
                assert.equal(layout.chunks.length,measured.layouts.blocks256.length);
                windows[cap]=layout.chunks.map((chunk,j)=>{
                    assert.equal(sha256(chunk.text),measured.hashes[measured.layouts.blocks256[j].core]);
                    const view=getChunkContext(layout,j);
                    const raw=sourceSpans(view), tokens=tokenizer.countTokens(view.text);
                    assert.ok(tokens<=cap);
                    return {raw,ranges:canonical(raw),tokens};
                });
            }
            await writeFile(stem+'.windows.gz',gzipSync(JSON.stringify(windows)));
        }
    }
} finally {tokenizer.close();}
