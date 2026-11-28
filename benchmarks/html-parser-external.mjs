import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {parse} from 'parse5';
import {cache,here,sha256} from './corpora.mjs';

const manifest=JSON.parse(await readFile(join(here,'html-parser-external.json')));
const root=join(cache,'html-parser'),sources=join(root,'external-sources');
await mkdir(sources,{recursive:true});
const rev=manifest.baseRevision;
const files=execFileSync('git',['ls-tree','-r','--name-only',rev,'--','src','config.js','package.json'],{cwd:join(here,'..'),encoding:'utf8'});
for (const file of files.trim().split('\n')) {
    const destination=join(root,'base',file);
    await mkdir(dirname(destination),{recursive:true});
    await writeFile(destination,execFileSync('git',['show',rev+':'+file],{cwd:join(here,'..')}));
}
const {parseTextTree}=await import('./.cache/html-parser/base/src/sentences.js');
const docs=[];
for (const {id,url,elementId,htmlHash,sourceHash,questions} of manifest.sources) {
    const path=join(sources,id+'.html');
    let page;
    try {page=await readFile(path,'utf8');}
    catch(e) {
        if (e.code!=='ENOENT') throw e;
        const response=await fetch(url);
        if (!response.ok) throw new Error(url+' '+response.status);
        page=await response.text();
        await writeFile(path,page);
    }
    const stack=[parse(page,{sourceCodeLocationInfo:true})];
    let element;
    while (stack.length) {
        const n=stack.pop();
        if (elementId ? n.attrs?.some(a=>a.name==='id' && a.value===elementId) : n.tagName==='body') {element=n;break;}
        stack.push(...(n.childNodes??[]));
    }
    assert.ok(element,id);
    const loc=element.sourceCodeLocation, raw=loc?page.slice(loc.startOffset,loc.endOffset):page;
    assert.equal(sha256(raw),htmlHash,id+' article markup changed');
    const {source}=await parseTextTree(raw,{inputFormat:'html'});
    assert.equal(sha256(source),sourceHash,id+' evidence coordinates changed');
    docs.push({id,source,raw,format:'html',questions});
}
await writeFile(join(root,'external-html.json'),JSON.stringify(docs));
