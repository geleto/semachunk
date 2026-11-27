// Replay prose through the public parsers after inserting physical line wraps at word boundaries.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cache,here,sha256 } from './corpora.mjs';
import { treeLayout } from './tree-policy.mjs';
const dir=join(cache,'context-mixtures','data'),manifest=JSON.parse(await readFile(join(dir,'manifest.json')));
const corpus={},examples=[],controls={};
const clean=s=>s.replace(/\s+/gu,' ').trim();
function wrap(s,w){
    const lines=[];let current='';
    for(const word of s.split(' ')){
        if(current&&current.length+1+word.length>w){lines.push(current);current='';}
        current+=(current?' ':'')+word;
    }
    return [...lines,current].join('\n');
}
async function atoms(text,format){
    const t=await treeLayout(text,format,{maxChunkSize:Infinity},'2',async ts=>ts.map(()=>[1]));
    return t.rows.map(r=>clean(r.text));
}
const probe='The harbor team checked the replacement pump before the night watch began. The chief recorded the result.';
for(const format of ['text','markdown','html']){
    const render=s=>format==='html'?'<p>'+s+'</p>':s;
    const normal=await atoms(render(probe),format);
    assert.deepEqual(await atoms(render(probe.replace('pump before','pump\nbefore')),format),normal);
    controls[format]={ordinary:normal,blank:await atoms(format==='html'?'<p>The harbor team checked the replacement pump</p><p>before the night watch began.</p>':'The harbor team checked the replacement pump\n\nbefore the night watch began.',format)};
    assert.equal(controls[format].blank.length,2);
}
controls.markdown.hard=await atoms('The crew checked the pump  \nbefore the night watch.', 'markdown');
controls.markdown.table=await atoms('| Team | Result |\n|---|---|\n| Harbor | Ready |','markdown');
controls.markdown.code=await atoms('~~~js\nfunction check() {\n  return true;\n}\n~~~','markdown');
controls.text.list=await atoms('- Check the replacement\n  pump\n- Record the result','text');
assert.equal(controls.markdown.hard.length,2);assert.equal(controls.markdown.table.length,1);assert.equal(controls.markdown.code.length,1);assert.equal(controls.text.list.length,2);
for(const [key,m] of Object.entries(manifest)){
    const docs=JSON.parse(await readFile(join(dir,key+'.json'))).docs;
    for(const doc of docs){
        const paragraphs=doc.source.split(/\n\s*\n/u).map(clean).filter(p=>p.length>=220&&p.length<=6000&&/^[A-Z"'“‘]/u.test(p)&&!/[|<>#{}]/u.test(p));
        paragraphs.sort((a,b)=>sha256(a).localeCompare(sha256(b)));
        const kept=[...new Set(paragraphs)].slice(0,4);
        const counts=corpus[m.domain]??={sources:0,paragraphs:0,trials:0,identical:0};
        if(kept.length)counts.sources++;
        counts.paragraphs+=kept.length;
        const render=s=>doc.format==='html'?'<p>'+s.replaceAll('&','&amp;')+'</p>':s;
        for(const p of kept){
            const before=await atoms(render(p),doc.format);
            for(const width of [60,72,90]){
                const after=await atoms(render(wrap(p,width)),doc.format);
                counts.trials++;
                if(JSON.stringify(before)===JSON.stringify(after))counts.identical++;
                else if(examples.length<12)examples.push({id:doc.id,format:doc.format,width,input:p,before,after});
            }
        }
    }
}
await writeFile(join(here,'results','2026-11-27-scope-weights-wraps.json'),JSON.stringify({corpus,controls,examples},null,2)+'\n');
