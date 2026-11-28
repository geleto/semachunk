import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {covers, joinViews, sourceSpans} from '../src/citations.js';
import {chunkContextParts, passageFits} from '../src/document.js';
import {canonicalMapper, sourceOptions} from './bounded-source.mjs';
import {cache, sha256} from './corpora.mjs';
import {dimension, model, openReplay} from './encoder.mjs';
import {centeredPassage} from './centered-passage.mjs';
import {placementLattice} from './placement-lattice.mjs';

const placement = process.argv.includes('--placement');
const study = placement ? 'passage-placement' : 'neighbor-threshold';
const root = join(cache, study), ranking = join(cache, 'paragraph-ranking');
const mixtures = join(cache, 'context-mixtures'), bounded = join(cache, 'bounded-passages');
const json = async path => JSON.parse(await readFile(path));
const unzip = async path => JSON.parse(gunzipSync(await readFile(path)));
const registry = {...await json(join(mixtures,'data/manifest.json')), ...await json(join(ranking,'holdout-data/manifest.json'))};
const outlines = await json(join(cache,'scope-weights/source-headings.json'));
const protocol = await json(new URL('./'+study+'-protocol.json',import.meta.url));
const cutoffs = protocol.cutoffs;
const budget = process.argv.includes('--budget');
const wider = budget || process.argv.includes('--windows');
const extension = budget ? '.budget' : '.windows';
const revision = sha256(Buffer.concat(await Promise.all([
    import.meta.url, './bounded-source.mjs', '../src/index.js', '../src/semantic.js',
    '../src/document.js', '../src/hierarchy.js', '../src/citations.js','./centered-passage.mjs',
    ...(placement?['./placement-lattice.mjs']:[])
].map(file => readFile(new URL(file,import.meta.url))))));
const spanLength = spans => spans.reduce((total,[a,b]) => total+b-a,0);

async function build(key, doc, i, bank, originalEdges=false) {
    const stem = join(root,key,String(i)), archive = join(ranking,key,String(i));
    const previous = await unzip(archive+'.json.gz');
    const stamp = sha256(JSON.stringify([revision, cutoffs, previous.stamp, previous.vectorHash, model, dimension]));
    try {
        const found = await unzip(stem+(wider ? extension+'.json.gz' : '.json.gz'));
        if (found.stamp===stamp) {
            if (wider && found.baseStamp===(await unzip(stem+'.json.gz')).stamp &&
                (!budget || found.vectorHash===sha256(await readFile(stem+'.budget.f32')))) return;
            if (!wider && sha256(await readFile(stem+'.f32'))===found.vectorHash) return;
        }
    } catch (error) { if (error.code!=='ENOENT') throw error; }
    assert.equal(previous.id,doc.id);
    assert.equal(previous.model,model);
    const memory = new Map();
    async function reuse(prefix, hashes, expected) {
        const bytes = await readFile(prefix+'.f32');
        assert.equal(sha256(bytes),expected);
        assert.equal(bytes.length,hashes.length*dimension*4);
        hashes.forEach((h,j) => memory.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension)));
    }
    const detail = await unzip(archive+'.detail.json.gz');
    await reuse(archive,previous.hashes,previous.vectorHash);
    await reuse(archive+'.detail',detail.hashes,detail.hash);
    async function embed(texts) {
        const hashes = texts.map(sha256), missing = new Map();
        texts.forEach((s,j) => { if (!memory.has(hashes[j])) missing.set(hashes[j],s); });
        if (missing.size) {
            const vectors = await bank.embed([...missing.values()]);
            [...missing.keys()].forEach((h,j) => memory.set(h,vectors[j]));
        }
        return hashes.map(h => memory.get(h));
    }
    // Some older corpora have multiple model responses for identical input.
    // If a split differs from the archived document, replay its original edge
    // vectors for every cutoff. Retrieval vectors and queries stay identical.
    let edgeEmbed=embed;
    if (originalEdges) {
        const edges=new Map();
        for (const folder of [join(cache,'hierarchy-probes','indexes'),bounded,join(cache,'structural-limits')]) {
            const prefix=join(folder,key,String(i)), ix=await unzip(prefix+'.json.gz');
            const bytes=await readFile(prefix+'.f32');
            assert.equal(sha256(bytes),ix.vectorHash??ix.vectorSHA256);
            ix.hashes.forEach((h,j)=>edges.set(h,new Float32Array(bytes.buffer,bytes.byteOffset+j*dimension*4,dimension)));
        }
        edgeEmbed=async texts=>{
            const missing=[...new Set(texts.filter(s=>!edges.has(sha256(s))))];
            const extra=missing.length ? await bank.embed(missing) : [];
            missing.forEach((s,j)=>edges.set(sha256(s),extra[j]));
            return texts.map(s=>edges.get(sha256(s)));
        };
    }
    const {options,mapping} = await sourceOptions(doc,outlines[key]?.[i]?.headings ?? [],bank.countTokens);
    const canonical = canonicalMapper(mapping), keys = new Map(), views = [], ids = new Map();
    function keyFor(text) {
        if (!keys.has(text)) keys.set(text,keys.size);
        return keys.get(text);
    }
    function viewFor(view) {
        const raw = sourceSpans(view), tokens = bank.countTokens(view.text);
        assert.ok(tokens<=512);
        const name = JSON.stringify([tokens,raw]);
        if (!ids.has(name)) {
            ids.set(name,views.length);
            views.push({raw,ranges:canonical(raw),tokens});
        }
        return ids.get(name);
    }
    if (wider) {
        const saved = await unzip(stem+'.json.gz'), layoutWindows = {};
        for (const cutoff of budget ? [.15,.55] : [.15,.40,.55,.75]) {
            const docView = await chunkDocument(doc.raw,{...options,strategy:'semantic-blocks',maxChunkSize:512,maxStructuralSize:256,
                maxPassageSize:512,similarityThreshold:cutoff,joinParagraphs:true,embedBatch:embed});
            const entries = saved.layouts[String(cutoff)];
            const centered = centeredPassage(docView,entries.map(c=>saved.views[c.bare].tokens));
            assert.equal(entries.length,docView.chunks.length);
            layoutWindows[String(cutoff)] = docView.chunks.map((core,j) => {
                assert.deepEqual(saved.views[entries[j].bare].raw,sourceSpans(core));
                const windows = {};
                for (const radius of budget ? [1,'budget'] : [1,2,4]) {
                    const {lo,hi,parts} = centered(j,radius);
                    const view = joinViews(parts.filter(p => p?.text),'\n\n');
                    if (radius===1) {
                        assert.deepEqual(views[viewFor(view)],saved.views[entries[j].win]);
                        continue;
                    }
                    const near = [];
                    for (const side of [0,2]) {
                        if (!parts[side]?.text) continue;
                        const spans = sourceSpans(parts[side]);
                        for (let dist=1;dist<=(side===0 ? j-lo : hi-j-1);dist++) {
                            const other = j+(side===0 ? -dist : dist);
                            if (!entries[other]) continue;
                            const bare = saved.views[entries[other].bare].raw;
                            if (spans.some(([a,b]) => bare.some(([c,d]) => a<d && c<b))) near.push([entries[other].v,dist]);
                        }
                    }
                    windows[radius] = {win:viewFor(view),near};
                    if (budget) windows[radius].joint = keyFor(view.text);
                }
                return windows;
            });
        }
        const report = {stamp,baseStamp:saved.stamp,views,layouts:layoutWindows};
        if (budget) {
            const vectors = await embed([...keys.keys()]);
            const bytes = Buffer.concat(vectors.map(v => Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
            report.vectorHash = sha256(bytes);
            await writeFile(stem+'.budget.f32.tmp',bytes);
            await rename(stem+'.budget.f32.tmp',stem+'.budget.f32');
        }
        await writeFile(stem+extension+'.json.gz.tmp',gzipSync(JSON.stringify(report)));
        await rename(stem+extension+'.json.gz.tmp',stem+extension+'.json.gz');
        return;
    }
    const layouts = {};
    let spans, paragraphs, sections, structure;
    for (const cutoff of [null,...(placement?['tuned']:[]),...cutoffs]) {
        const structural = cutoff===null || cutoff==='tuned';
        const opts = structural ? {strategy:'blocks',maxChunkSize:cutoff===null?256:512} :
            {strategy:'semantic-blocks',maxChunkSize:512,similarityThreshold:cutoff,joinParagraphs:true};
        const layout = cutoff===null ? 'blocks' : String(cutoff);
        const d = await chunkDocument(doc.raw,{...options,...opts,maxPassageSize:512,maxStructuralSize:256,embedBatch:edgeEmbed});
        if (!spans) {
            structure = d;
            spans = d.nodes.map(sourceSpans);
            paragraphs = new Set(d.nodes.filter(n => n.type==='paragraph' && n.text && spans[n.id].length).map(n => n.id));
            const counts = new Uint32Array(d.nodes.length);
            for (const id of paragraphs) {
                for (let p=d.nodes[id].parentId;p!==null;p=d.nodes[p].parentId) counts[p]++;
            }
            sections = d.nodes.filter(n => ['section','article'].includes(n.type) && n.text &&
                (n.retrievalOnly ? [...paragraphs].filter(p => covers(spans[n.id],spans[p])).length>=2 : counts[n.id]>=2))
                .sort((a,b) => spanLength(spans[a.id])-spanLength(spans[b.id]));
        }
        assert.equal(spans.length,d.nodes.length);
        const fits = passageFits(d);
        const centered = placement&&!structural ? centeredPassage(d,d.chunks.map(c=>bank.countTokens(c.text))) : null;
        layouts[layout] = d.chunks.map((c,j) => {
            assert.ok(fits(c.text) && !c.tokenLimitExceeded);
            const core = sourceSpans(c);
            const section = sections.find(n => covers(spans[n.id],core) && !covers(core,spans[n.id]) && !covers(spans[n.id],spans[0]));
            const parts = chunkContextParts(d,j,1,fits);
            const window = joinViews(parts.filter(p => p?.text),'\n\n');
            const entry = {v:keyFor(c.text),pa:c.nodeIds.filter(n => paragraphs.has(n) && !covers(spans[n],core)).map(n => keyFor(d.nodes[n].text)),
                section:section ? keyFor(section.text) : -1,bare:viewFor(c),win:viewFor(window)};
            if (structural) return entry;
            if (placement) {
                entry.start=core[0][0]; entry.end=core.at(-1)[1];
                const full=joinViews(centered(j,'budget').parts.filter(p=>p?.text),'\n\n');
                entry.budgetKey=keyFor(full.text);
                entry.budgetView=viewFor(full);
            }
            entry.joint = keyFor(window.text);
            entry.chunk = []; entry.sentence = []; entry.visible = [];
            for (const side of [0,2]) {
                const part = parts[side];
                if (!part?.text) continue;
                const neighbor = d.chunks[j+side-1], visible = sourceSpans(part);
                entry.chunk.push(keyFor(neighbor.text));
                if (placement) continue;
                entry.visible.push(keyFor(part.text));
                const sentences = neighbor.nodeIds.filter(n => d.nodes[n].type==='sentence' && spans[n].length && covers(visible,spans[n]))
                    .sort((a,b) => spans[a][0][0]-spans[b][0][0]);
                const nearest = side===0 ? sentences.at(-1) : sentences[0];
                if (nearest!==undefined) entry.sentence.push(keyFor(d.nodes[nearest].text));
            }
            return entry;
        });
        const existing = previous.layouts[structural ? (cutoff===null ? 'B256u256' : 'B512u256') : 'T512u256t'+cutoff+'j'];
        if (existing) {
            if (placement && !structural && !originalEdges && registry[key].fold!=='holdout' &&
                (existing.length!==d.chunks.length || d.chunks.some((c,j)=>sha256(c.text)!==previous.hashes[existing[j].v]))) {
                console.log(key,doc.id,layout,'replaying original split vectors');
                return build(key,doc,i,bank,true);
            }
            assert.equal(existing.length,d.chunks.length);
            for (const [j,c] of layouts[layout].entries()) {
                assert.equal(sha256(d.chunks[j].text),previous.hashes[existing[j].v],key+' '+doc.id+' '+layout+' chunk '+j);
                for (const k of ['win','bare']) assert.deepEqual(views[c[k]],previous.views[existing[j][k]]);
            }
        }
    }
    const lattice = placement ? placementLattice(structure,layouts,bank,keyFor,viewFor) : undefined;
    const qs = previous.qs.map(q => ({...q,v:keyFor(q.text)}));
    const inputs = [...keys.keys()], vectors = await embed(inputs);
    const bytes = Buffer.concat(vectors.map(v => Buffer.from(v.buffer,v.byteOffset,v.byteLength)));
    const index = {id:doc.id,stamp,vectorHash:sha256(bytes),layouts,views,qs,lattice,originalEdges:originalEdges||undefined};
    await writeFile(stem+'.f32.tmp',bytes);
    await rename(stem+'.f32.tmp',stem+'.f32');
    await writeFile(stem+'.json.gz.tmp',gzipSync(JSON.stringify(index)));
    await rename(stem+'.json.gz.tmp',stem+'.json.gz');
}

const args = process.argv.slice(2).filter(s => !['--placement','--windows','--budget'].includes(s));
for (const [key,meta] of Object.entries(registry)) {
    if (args.length && !args.includes(meta.fold) && !args.includes(key)) continue;
    const folder = meta.fold==='holdout' ? join(ranking,'holdout-data') : join(mixtures,meta.fold==='fresh' ? 'audited-data' : 'data');
    const {docs} = await json(join(folder,key+'.json'));
    const bank = await openReplay(undefined,join(meta.fold==='holdout' ? ranking : bounded,'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        await mkdir(join(root,key),{recursive:true});
        for (let i=0;i<docs.length;i+=3) await Promise.all(docs.slice(i,i+3).map((d,j) => build(key,d,i+j,bank)));
        console.log(key,docs.length,'documents;',bank.stats.apiInputTokens,'new embedding tokens');
    } finally { bank.close(); }
}
