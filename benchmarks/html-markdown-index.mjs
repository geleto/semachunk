import assert from 'node:assert/strict';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {sourceSpans} from '../src/citations.js';
import {semachunkLayout} from './html-retrieval-layout.mjs';
import {canonicalMapper,sourceOptions} from './bounded-source.mjs';
import {cache,here,sha256} from './corpora.mjs';
import {dimension,model,openReplay} from './encoder.mjs';
import {convertGovernmentPage} from './html-markdown-source.mjs';
import {buildMastraLayouts} from './mastra-layouts.mjs';

const root=join(cache,'html-markdown');
const readJSON=async file=>JSON.parse(await readFile(file));
const unzip=async file=>JSON.parse(gunzipSync(await readFile(file)));
const edition=await readJSON(join(here,'results/2026-11-27-prose-reviewed-data.json'));
const mastra=join(cache,'mastra-comparison');
const protocols=await unzip(join(here,'results/2026-11-27-mastra-comparison.json.gz'));
const labels=protocols.selected.layouts;
assert.equal(model,protocols.protocol.model);
assert.equal(dimension,protocols.protocol.dimensions);
for(const [dir,name,version] of [[root,'turndown','7.2.5'],[root,'turndown-plugin-gfm','1.0.2'],[mastra,'@mastra/rag','2.8.2']]) {
    assert.equal((await readJSON(join(dir,'deps/node_modules',name,'package.json'))).version,version);
}
const revision=sha256(Buffer.concat(await Promise.all([import.meta.url,'./html-markdown-source.mjs','./html-retrieval-layout.mjs','./mastra-layouts.mjs','./mastra-protocol.json',
    './bounded-source.mjs','./centered-passage.mjs','../src/semantic.js','../src/document.js','../src/sentences.js',
    '../src/hierarchy.js','../src/markdown-units.js'].map(f=>readFile(new URL(f,import.meta.url))))));

async function archived(stem) {
    const data=await unzip(stem+'.json.gz'), bytes=await readFile(stem+'.f32');
    assert.equal(sha256(bytes),data.vectorHash);
    return {data,bytes};
}

async function build(key,i,doc,bank,isStudentAid) {
    const stem=join(root,key,String(i)),stamp=sha256(JSON.stringify([revision,doc,labels,model]));
    try {
        const previous=await unzip(stem+'.json.gz');
        if(previous.stamp===stamp && sha256(await readFile(stem+'.f32'))===previous.vectorHash) return;
    } catch(error) {if(error.code!=='ENOENT') throw error;}
    const converted=convertGovernmentPage(doc);
    const bytesPerRow=dimension*4;
    const known=new Map(), rows=[], pending=new Map(), contentKeys=new Map();
    const queryData=isStudentAid?await archived(join(cache,'paragraph-ranking',key,String(i))):null;
    if(queryData) {
        const {data,bytes}=queryData;
        assert.equal(data.id,doc.id);
        data.hashes.forEach((h,j)=>known.set(h,bytes.subarray(j*bytesPerRow,(j+1)*bytesPerRow)));
    }
    async function embed(texts) {
        const missing=[...new Set(texts)].filter(t=>!known.has(sha256(t)));
        if(missing.length) {
            const fetched=await bank.embed(missing);
            missing.forEach((t,j)=>known.set(sha256(t),Buffer.from(fetched[j].buffer,fetched[j].byteOffset,fetched[j].byteLength)));
        }
        return texts.map(t=>{
            const b=known.get(sha256(t));
            return new Float32Array(b.buffer,b.byteOffset,dimension);
        });
    }
    function keyFor(text) {
        if(contentKeys.has(text)) return contentKeys.get(text);
        const index=rows.length,bytes=known.get(sha256(text));
        contentKeys.set(text,index); rows.push(bytes);
        if(!bytes) pending.set(index,text);
        return index;
    }
    const original=doc.questions.filter(q=>q.kind!=='section');
    if(queryData) assert.deepEqual(original,queryData.data.qs.map(({v,...q})=>q));
    const qs=original.map(q=>({...q,v:keyFor(q.text)}));
    const views=[], viewIds=new Map(), layouts={}, tree={};
    function view(raw,ranges,tokens) {
        assert.ok(tokens>0 && tokens<=512 && raw.length);
        assert.ok(ranges.every(([a,b])=>a>=0 && b<=doc.source.length && b>a));
        const name=JSON.stringify([raw,ranges,tokens]);
        if(!viewIds.has(name)) {viewIds.set(name,views.length); views.push({raw,ranges,tokens});}
        return viewIds.get(name);
    }
    function archivedRow(bytes) {
        const keys=new Map();
        return j=>{
            if(j<0) return -1;
            if(!keys.has(j)) {
                const b=bytes.subarray(j*bytesPerRow,(j+1)*bytesPerRow);
                assert.equal(b.length,bytesPerRow);
                keys.set(j,rows.length);rows.push(b);
            }
            return keys.get(j);
        };
    }
    async function studentAidHtml() {
        const cv=v=>view(v.raw,v.ranges,v.tokens);
        const source=join(cache,'neighbor-threshold',key,String(i));
        const sem=await archived(source), wide=await unzip(source+'.budget.json.gz');
        const ma=await archived(join(mastra,key,String(i)));
        assert.equal(wide.baseStamp,sem.data.stamp);
        for(const archive of [sem,ma]) {
            assert.equal(archive.data.id,doc.id);
            archive.data.qs.forEach((q,j)=>{
                assert.equal(q.id,qs[j].id);
                assert.deepEqual(rows[qs[j].v],archive.bytes.subarray(q.v*bytesPerRow,(q.v+1)*bytesPerRow));
            });
        }
        const sv=archivedRow(sem.bytes),mv=archivedRow(ma.bytes);
        for(const [name,label] of [['blocks','blocks'],['semantic','0.15']]) {
            const entries=sem.data.layouts[label];
            layouts['html/'+name]=entries.map((c,j)=>{
                const options=[j-1,j+1].filter(n=>n>=0 && n<entries.length);
                const near=(c.chunk??[]).map(v=>{
                    const n=options.findIndex(id=>entries[id].v===v);assert.ok(n>=0);return options.splice(n,1)[0];
                });
                return {v:sv(c.v),pa:c.pa.map(sv),section:sv(c.section),near,bare:cv(sem.data.views[c.bare]),
                    win:cv(name==='semantic'?wide.views[wide.layouts[label][j].budget.win]:sem.data.views[c.win])};
            });
        }
        for(const label of labels) layouts['html/'+label]=ma.data.layouts[label].map(c=>({
            v:mv(c.v),pa:c.pa.map(mv),section:mv(c.section),near:c.near,bare:cv(ma.data.views[c.bare]),win:cv(ma.data.views[c.win])}));
    }
    for(const format of ['html','markdown','text']) {
        const input=format==='html'?doc:{...doc,format,raw:format==='markdown'?converted.markdown:doc.source,
            source:format==='markdown'?converted.markdown:doc.source};
        const {options,mapping}=await sourceOptions(input,[],bank.countTokens);
        const local=canonicalMapper(mapping),gold=format==='markdown'?converted.canonical:local;
        const blocks=await chunkDocument(input.raw,{...options,strategy:'blocks',maxChunkSize:256,maxStructuralSize:256,maxPassageSize:512});
        const types={};
        for(const node of blocks.nodes) types[node.type]=(types[node.type]??0)+1;
        tree[format]=types;
        if(format==='html' && isStudentAid) { await studentAidHtml();continue; }
        function addView(v) {const spans=sourceSpans(v);return view(spans,gold(spans),bank.countTokens(v.text));}
        layouts[format+'/blocks']=semachunkLayout(blocks,blocks,keyFor,addView,bank.countTokens,false);
        const sem=await chunkDocument(input.raw,{...options,strategy:'semantic-blocks',maxChunkSize:512,maxStructuralSize:256,
            maxPassageSize:512,similarityThreshold:.15,joinParagraphs:true,embedBatch:embed});
        layouts[format+'/semantic']=semachunkLayout(sem,blocks,keyFor,addView,bank.countTokens,true);
        if(format==='text') continue;
        const projected=(a,b,tokens)=>view([[a,b]],format==='markdown'?converted.canonical([[a,b]]):[[a,b]],tokens);
        const out=await buildMastraLayouts(input,blocks,local,bank,labels,projected,keyFor);
        for(const [l,cs] of Object.entries(out.layouts)) layouts[format+'/'+l]=cs;
    }
    if(pending.size) {
        const vectors=await embed([...pending.values()]);
        [...pending.keys()].forEach((k,j)=>rows[k]=Buffer.from(vectors[j].buffer,vectors[j].byteOffset,vectors[j].byteLength));
    }
    const bytes=Buffer.concat(rows),index={id:doc.id,model,dimension,stamp,vectorHash:sha256(bytes),sourceHash:sha256(doc.source),
        htmlHash:sha256(doc.raw),markdownHash:sha256(converted.markdown),views,qs,layouts,tree};
    await writeFile(stem+'.f32.tmp',bytes);await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(index)));await rename(stem+'.json.gz.tmp',stem+'.json.gz');
}

const [fold,agency]=process.argv.slice(2);
assert.ok(!fold || ['development','confirmation'].includes(fold));
assert.ok(!agency || ['studentaid','dmv','ssa','va'].includes(agency));
for(const [key,record] of Object.entries(edition.sets)) {
    const match=/^government-(development|confirmation)-reviewed-(\w+)-html$/u.exec(key);
    if(!match || (fold && match[1]!==fold) || (agency && match[2]!==agency)) continue;
    const raw=await readFile(join(cache,'prose-reviewed',key+'.json'));
    assert.equal(sha256(raw),record.sha256);
    const docs=JSON.parse(raw);
    await mkdir(join(root,key),{recursive:true});
    const bank=await openReplay(undefined,join(root,'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        for(let i=0;i<docs.length;i+=3) {
            await Promise.all(docs.slice(i,i+3).map((d,j)=>build(key,i+j,d,bank,match[2]==='studentaid')));
        }
        console.log(key,docs.length,'documents;',bank.stats.apiInputTokens,'new embedding tokens');
    } finally {bank.close();}
}
