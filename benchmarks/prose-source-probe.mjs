import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cache, compact, here } from './corpora.mjs';
import { matchedLayout, openStudySet } from './matched-count.mjs';
import { citation, dot, ranking, union } from './prose-evidence.mjs';
import { proseSourceEdits, repairProseSource } from './prose-revision.mjs';
import { readJSON } from './semantic-settings-data.mjs';
import { layout, prepareQuestions } from './semantic-settings.mjs';

const dir=join(cache,'prose-retrieval'), results=join(here,'results');
const manifest=await readJSON(join(results,'2026-11-27-audited-data.json'));
const stored=async (key,suffix='')=>JSON.parse(gunzipSync(await readFile(join(dir,key+suffix+'.json.gz'))));
const methods=['blocks','semantic512','semanticUnlimited'];
const limits=[256,512,Infinity];

async function measure(doc,qs,encoder,k) {
    const output={};
    for (const [i,name] of methods.entries()) {
        const plan=name==='blocks'?await layout(doc,'blocks',256,encoder):await matchedLayout(doc,encoder,k,limits[i]);
        const rows=plan.rows.map((r,id)=>{
            const spans=union(r.sourceRanges.map(s=>[s.start,s.end]));
            return {doc:0,id,text:r.text,spans,first:spans[0][0],last:spans.at(-1)[1]};
        });
        const vs=await encoder.embed(rows.map(r=>r.text));
        const outcomes={};
        for (const q of qs) {
            const [v]=await encoder.embed([q.text]);
            const sim=vs.map(w=>dot(v,w)), {sorted,ranks}=ranking(rows,sim), c=citation(q,rows);
            outcomes[q.id]={prefix:c.prefix(ranks),minPassages:c.minimum,
                topTokens:encoder.countTokens(sorted[0].text),topSimilarity:sim[sorted[0].id]};
        }
        output[name]={count:rows.length,outcomes};
    }
    return output;
}

async function pepsi(doc, prior, details, encoder) {
    const begin=doc.source.indexOf('PURCHASE, N.Y. - April 25, 2023');
    const datelineEnd=doc.source.indexOf('the first quarter 2023.',begin)+'the first quarter 2023.'.length;
    assert(begin>=0 && datelineEnd>begin);
    const dateline=compact(doc.source.slice(begin,datelineEnd));
    const ablations={};
    for (const q of prior.queries) {
        const [qvec]=await encoder.embed([q.text]);
        const structural=details.plans.blocks[q.methods.blocks.firstFull.id].text;
        const out={};
        for (const m of methods.slice(1)) {
            const rows=details.plans[m],target=q.methods[m].firstFull.id;
            const texts=rows.map(r=>r.text);
            const score=async strings=>(await encoder.embed(strings)).map(v=>dot(qvec,v));
            const originals=await score(texts), contextual=await score(texts.map(t=>dateline+'\n\n'+t));
            const [structuralScore]=await score([structural]);
            function place(value,others) {
                return {score:value,rank:1+others.filter((s,i)=>i!==target&&(s>value||(s===value&&i<target))).length};
            }
            out[m]={original:place(originals[target],originals),addDatelineToTarget:place(contextual[target],originals),
                addDatelineToAll:place(contextual[target],contextual),replaceWithStructural:place(structuralScore,originals)};
            assert.equal(out[m].original.rank,q.methods[m].firstFull.rank);
        }
        ablations[q.id]=out;
    }
    return ablations;
}

const report={};
for (const name of ['PEPSICO_2023Q1_EARNINGS','JOHNSON_JOHNSON_2022Q4_EARNINGS']) {
    const key='finance-confirmation-filing-'+name;
    const {docs:[doc],encoder}=await openStudySet(key,manifest.sets[key]);
    try {
        const prior=await stored(key), details=await stored(key,'.details');
        const k=prior.documents.blocks[0].sizes.n;
        const ablations=name.startsWith('PEPSICO') ? await pepsi(doc,prior,details,encoder) : undefined;
        const repaired=repairProseSource(doc);
        const questions=prepareQuestions([repaired],encoder).filter(q=>q.kind==='text');
        report[name]={originalTarget:k,sourceEdits:proseSourceEdits(doc).length,ablations,
            reflow:await measure(repaired,questions,encoder,k)};
    } finally {encoder.close();}
}
await writeFile(join(results,'2026-11-27-prose-source-probes.json'),JSON.stringify(report,null,2)+'\n');
