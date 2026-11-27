import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cache, sha256 } from './corpora.mjs';
import { openReplay, model } from './encoder.mjs';
import { dataDir, readData } from './tree-dataset.mjs';
import { treeLayout } from './tree-policy.mjs';
import { vectorDirection, directionCosine } from '../src/similarity.js';

// Use the predeclared transfer panel and the public-service development pages.
// Recover exact edge scores from replayed inputs. No fresh provider inputs are allowed.
const totals = {};
for (const [key,format] of [['wiki-development','text'],['meetings-development','text'],
    ...['html','text','markdown'].map(f => ['government-development-ssa-'+f,f])]) {
    const isWiki = key.startsWith('wiki'), isMeeting = key.startsWith('meetings'), annotated = isWiki || isMeeting;
    const docs = await readData(key);
    const panel = annotated ? docs.toSorted((a,b) => sha256(a.id).localeCompare(sha256(b.id),'en')).slice(0,isWiki ? 32 : 12) : docs;
    const width = annotated ? isWiki ? 24 : 5 : docs.length;
    const cells = new Map();
    for (let from = 0; from < panel.length; from += width) {
        const cohort = key.replace(/-(html|text|markdown)$/u,'') + '.' + Math.floor(from/width);
        const encoder = await openReplay(undefined,join(dataDir,'vectors',model,cohort),{maxNewTokens:0});
        try {
            const {countTokens} = encoder;
            for (const doc of panel.slice(from,from+width)) {
                const raw = isMeeting ? doc.turns.join('\n\n') : doc.raw, labels = new Map();
                const visible = s => s.replace(/\s/gu,'').length;
                if (isWiki) for (const i of doc.starts) labels.set(visible(raw.slice(0,i)),1);
                if (isMeeting) {
                    let offset = 0;
                    doc.turns.slice(0,-1).forEach((t,i) => { offset += visible(t); labels.set(offset,doc.labels[i]); });
                }
                const directions = new Map(), edges = [], depths = new WeakMap();
                let ord, docLength;
                function visit(source,parent,nested,paragraph) {
                    const depth = depths.get(parent) ?? 0;
                    if (!ord) {
                        ord = new Uint32Array(source.length+1);
                        for (let i = 0; i < source.length; i++) ord[i+1] = ord[i]+Number(!/\s/u.test(source[i]));
                        docLength = countTokens(source) < 2048 ? 'under2048' : '2048plus';
                    }
                    for (const child of nested) depths.set(child,depth+1);
                    for (let i = 1; i < nested.length; i++) {
                        const l = nested[i-1], r = nested[i];
                        if (l.skip || r.skip || l.blocked || r.blocked) continue;
                        const a = source.slice(l.start,l.end), b = source.slice(r.start,r.end);
                        const size = countTokens(source.slice(l.start,r.end));
                        if (size > 256 || countTokens(a) > 256 || countTokens(b) > 256) continue;
                        const kind = paragraph ? 'paragraph' : parent.kind ?? (parent.depth ? 'section' : 'group');
                        const truth = labels.get(ord[r.start]) ?? (isWiki ? 0 : 'unknown');
                        edges.push({a,b,r,kind,depth:Math.min(depth,3),size:Math.ceil(size/64),truth});
                    }
                }
                await treeLayout(raw,format,{maxChunkSize:Infinity,fits:s => countTokens(s) <= 256},'0.15',async texts => {
                    const vectors = await encoder.embed(texts);
                    texts.forEach((t,i) => directions.set(t,vectorDirection(vectors[i])));
                    return vectors;
                },visit);
                for (const {a,b,r,kind,depth,size,truth} of edges) {
                    const cosine = directionCosine(directions.get(a),directions.get(b));
                    assert.equal(Boolean(r.breakBefore),cosine < .15);
                    const band = cosine < .05 ? '<0.05' : cosine < .15 ? '0.05–0.15' : cosine < .30 ? '0.15–0.30' : '>=0.30';
                    const id = [kind,depth,docLength,size,band,truth].join('/');
                    const cell = cells.get(id) ?? [0,0];
                    cell[0]++; cell[1] += cosine; cells.set(id,cell);
                }
            }
            assert.equal(encoder.stats.apiRequests,0);
        } finally { encoder.close(); }
    }
    totals[key] = {documents:panel.length, cells:[...cells].sort(([a],[b]) => a.localeCompare(b,'en'))
        .map(([k,[n,sum]]) => [...k.split('/'),n,Number((sum/n).toFixed(5))])};
}
const dir = join(cache,'tree-corpus','edge-reports');
await mkdir(dir,{recursive:true});
await writeFile(join(dir,model+'.json'),JSON.stringify(totals));
console.log('Replayed edge scores for',model);
