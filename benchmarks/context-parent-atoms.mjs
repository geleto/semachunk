import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cache } from './corpora.mjs';
import { union } from './prose-evidence.mjs';
import { treeLayout } from './tree-policy.mjs';

// Recover the source locations of the exact parser units embedded in the primary study.
const root=join(cache,'context-retrieval');
const manifest=JSON.parse(await readFile(join(root,'data','context-retrieval-manifest.json')));
await mkdir(join(root,'atoms'),{recursive:true});
for (const key of Object.keys(manifest)) {
    const {docs}=JSON.parse(await readFile(join(root,'data',key+'.json')));
    const loc=[];
    for (const [i,doc] of docs.entries()) {
        const idx=JSON.parse(gunzipSync(await readFile(join(root,'indexes',key,i+'.json.gz'))));
        const ids=new Map(idx.texts.map((t,j)=>[t,j]));
        const tree=await treeLayout(doc.raw,doc.format,{maxChunkSize:Infinity},'2',async ts=>ts.map(()=>[1]));
        loc.push(tree.rows.map(row=>{
            assert(ids.has(row.text),doc.id);
            return {v:ids.get(row.text),spans:union(row.sourceRanges.map(r=>[r.start,r.end]))};
        }));
    }
    await writeFile(join(root,'atoms',key+'.json.gz'),gzipSync(JSON.stringify(loc)));
}
