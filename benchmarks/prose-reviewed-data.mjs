import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { here, cache, sha256 } from './corpora.mjs';
import { repairProseSource } from './prose-revision.mjs';
import { directory, readJSON } from './semantic-settings-data.mjs';

const results = join(here,'results'), output = join(cache,'prose-reviewed');
const corrections = await readJSON(join(here,'prose-citations.json'));
const registry = new Map(corrections.flatMap(change => change.ids.map(id => [id,change])));
assert.equal(registry.size,corrections.reduce((n,r)=>n+r.ids.length,0));
const input = await readJSON(join(results,'2026-11-27-audited-data.json'));
const trace = gunzipSync(await readFile(join(results,'2026-11-27-prose-traces.jsonl.gz'))).toString().trimEnd().split('\n').map(JSON.parse);
const seen = new Set();
const manifest = { base:'2026-11-27-audited-data.json', corrections:'../prose-citations.json',
    correctionSHA256:sha256(JSON.stringify(corrections)), sets:{} };

function expression(text) {
    return new RegExp(text.split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+'),'gu');
}
function locate(source, fragment, id) {
    const [first,last] = Array.isArray(fragment) ? fragment : [fragment];
    const starts = [...source.matchAll(expression(first))];
    assert.equal(starts.length,1,id+' start: '+first);
    let end = starts[0].index + starts[0][0].length;
    if (last) {
        const tail = expression(last).exec(source.slice(end));
        assert(tail,id+' end: '+last);
        end += tail.index + tail[0].length;
    }
    const begin = starts[0].index;
    return [...source.slice(begin,end).matchAll(/\S+/gu)].map(m => [begin+m.index,begin+m.index+m[0].length]);
}
await mkdir(output,{recursive:true});
for (const row of trace) {
    const {key}=row, raw = await readFile(join(directory,key+'.json'),'utf8');
    assert.equal(sha256(raw),input.sets[key].sha256);
    const keep = new Set(row.queries.map(q=>q.id));
    const docs = JSON.parse(raw).map(repairProseSource);
    for (const d of docs) d.questions = d.questions.filter(q => keep.has(q.id)).map(q => {
        const change = registry.get(q.id);
        if (!change) return q;
        assert(!seen.has(q.id)); seen.add(q.id);
        const choices = (change.choices ?? []).map(parts => parts.flatMap(part => locate(d.source,part,q.id)));
        const refs = change.keep ? [...(q.references ?? [q.ranges]),...choices] : choices;
        assert(refs.length && refs.every(ref=>ref.length));
        const {ranges,alternativeSources,...base} = q;
        return {...base,text:change.question ?? q.text,references:refs,
            ...(change.keep && alternativeSources ? {alternativeSources} : {})};
    });
    const data = JSON.stringify(docs);
    await writeFile(join(output,key+'.json'),data);
    manifest.sets[key] = {baseSHA256:row.dataSHA256,sha256:sha256(data),pool:input.sets[key].pool,
        sources:docs.map(d=>d.id),questions:keep.size,revised:row.queries.filter(q=>registry.has(q.id)).map(q=>q.id)};
}
assert.deepEqual([...seen].sort(),[...registry.keys()].sort());
await writeFile(join(results,'2026-11-27-prose-reviewed-data.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Verified',seen.size,'revised questions and',trace.length,'corpus shards.');
