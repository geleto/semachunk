import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { parseTextTree } from '../src/sentences.js';
import { cache, here, sha256 } from './corpora.mjs';
import { dimension, model, openReplay } from './encoder.mjs';
import { union } from './prose-evidence.mjs';

const key = process.argv[2];
const original = join(cache, 'context-mixtures'), out = join(cache, 'hierarchy-probes');
const data = JSON.parse(await readFile(join(original, 'data', key + '.json')));
const sourceHeadings = JSON.parse(await readFile(join(cache, 'scope-weights', 'source-headings.json')))[key];
const version = sha256(await readFile(join(here, 'hierarchy-probes-index.mjs')));
const seeds = [31, 271, 1901];
const readIndex = async path => JSON.parse(gunzipSync(await readFile(path + '.json.gz')));
const kinds = ['paragraph', 'listItem', 'list', 'blockquote', 'container', 'code', 'table', 'heading', 'section', 'line', 'other'];

function permute(items, seed) {
    const shuffled = [...items];
    let state = Number.parseInt(sha256(seed).slice(0, 8), 16);
    for (let i = shuffled.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const j = Math.floor((state / 4294967296) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function boundaryContexts(vectors, tags) {
    const result = new Map();
    function cosine(a,b) {
        let cross=0, aa=0, bb=0;
        for (let j=0;j<a.length;j++) { cross+=a[j]*b[j]; aa+=a[j]*a[j]; bb+=b[j]*b[j]; }
        return cross/Math.sqrt(aa*bb);
    }
    function aggregate(indices) {
        const sum=new Float64Array(dimension);
        for(const i of indices)for(let j=0;j<dimension;j++)sum[j]+=vectors[i][j];
        return sum;
    }
    for(let i=1;i<vectors.length;i++) {
        const same=j=>j>=0&&j<tags.length&&tags[j].para===tags[i].para&&tags[j].section===tags[i].section&&!tags[j].opaque;
        if(tags[i].para<0||!same(i-1)||!same(i))continue;
        const left=[],right=[];
        for(let j=i-1;left.length<3&&same(j);j--)left.push(j);
        for(let j=i;right.length<3&&same(j);j++)right.push(j);
        const cross=cosine(aggregate(left),aggregate(right));
        const internal=[left,right].flatMap(side=>side.slice(1).map((p,j)=>cosine(vectors[p],vectors[side[j]])));
        const cohesion=internal.length?internal.reduce((a,b)=>a+b,0)/internal.length:0;
        result.set(i,{window3:cross,valley:cross-cohesion});
    }
    return result;
}

async function build(di, doc) {
    const oldPath = join(original, 'indexes', key, String(di));
    const extraPath = join(cache, 'query-parents', 'indexes', key, String(di));
    const [old, extra] = await Promise.all([readIndex(oldPath), readIndex(extraPath)]);
    const dir = join(out, 'indexes', key), dest = join(dir, String(di));
    await mkdir(dir, { recursive: true });
    const stamp = sha256(JSON.stringify([version, old.inputHash, extra.stamp]));
    try { if ((await readIndex(dest)).stamp === stamp) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const [baseBytes, extraBytes] = await Promise.all([readFile(oldPath + '.f32'), readFile(extraPath + '.f32')]);
    assert.equal(sha256(baseBytes), old.vectorSHA256); assert.equal(sha256(extraBytes), extra.vectorSHA256);
    const source = doc.source, budget = { maxChunkSize: Infinity };
    const tree = doc.format === 'markdown' ? (await loadMarkdownParser()).parseMarkdownTree(doc.raw, budget)
        : await parseTextTree(doc.raw, { ...budget, inputFormat: doc.format });
    assert.equal(tree.source ?? doc.raw, source);
    const previous = [...old.passages, ...extra.passages], previousMembers = { ...old.members, ...extra.members };
    const previousTexts = [...old.texts];
    const surface = runs => runs.map(([a,b]) => source.slice(a,b)).join('\n\n');
    for (const p of extra.passages) if (previousTexts[p.v] === undefined) previousTexts[p.v] = surface(p.spans);
    const known = new Map(previousTexts.map((s,i) => [s,i]));
    const texts = [], textIds = new Map(), passages = [], byPassage = new Map();
    function vectorId(s) {
        if (!textIds.has(s)) { textIds.set(s, texts.length); texts.push(s); }
        return textIds.get(s);
    }
    function add(s, spans) {
        const v = vectorId(s), signature = JSON.stringify([v, spans]);
        if (!byPassage.has(signature)) { byPassage.set(signature, passages.length); passages.push({v, spans}); }
        return byPassage.get(signature);
    }
    function copy(i) {
        if (i < 0) return -1;
        const p = previous[i];
        return add(previousTexts[p.v], p.spans);
    }
    function combine(items) {
        if (items.length < 2) return items[0] ?? -1;
        const spans = [];
        for (const [a,b] of union(items.flatMap(i => passages[i].spans))) {
            if (spans.length && !source.slice(spans.at(-1)[1], a).trim()) spans.at(-1)[1] = b;
            else spans.push([a,b]);
        }
        return add(surface(spans), spans);
    }
    const atoms = old.atoms.map(copy);
    const first = p => passages[p].spans[0][0], last = p => passages[p].spans.at(-1)[1] - 1;
    const members = {}, plans = {}, configs = {};
    function importPlan(name, ids, settings) {
        plans[name] = ids.map(copy);
        ids.forEach((p,i) => { members[plans[name][i]] = previousMembers[p].map(copy); });
        if (settings) configs[name] = {bridges:[],settings:{section:settings.map(([l,r],i) => [copy(l),copy(r),plans[name][i]])}};
    }
    for (const [name, from] of [['blocks','blocks256'],['tree','tree25-any'],['joined','tree25-para0-bridge']]) {
        importPlan(name, extra.plans[from], extra.configs[from].settings.section);
    }
    importPlan('flat40', old.plans.sent40);

    const levels = Object.fromEntries(kinds.map(k => [k,new Set()]));
    const bounds = [], skipped = [], headings = [];
    function addNode(a,b,kind) {
        const piece = source.slice(a,b), t = piece.trim();
        if (!t) return -1;
        const lo = a + piece.length - piece.trimStart().length;
        const p = add(t, [[lo,lo+t.length]]);
        levels[kind].add(p); return p;
    }
    function visit(node, parentKind, depth) {
        if (node.skip) { skipped.push([node.start,node.end]); return; }
        const kids = tree.children(node) ?? [];
        let kind = node.depth ? 'section' : node.kind;
        if (node.lines !== undefined) kind = 'paragraph';
        if (node.omitWhenEmpty && !kind) kind = 'container';
        if ((!kind || kind === 'prose') && kids.length) kind = 'line';
        if (kind && !kinds.includes(kind) && kind !== 'prose') kind = 'other';
        if (kinds.includes(kind)) {
            const p = node.blocked ? -1 : addNode(node.start,node.end,kind);
            bounds.push({a:node.start,b:node.end,kind,depth,p,parentKind});
        }
        if (node.depth) {
            const child = kids[0];
            const title = child?.leading?.find(h => h.start === node.start) ?? (child?.lines !== undefined ? child : null);
            const h = {a:node.start,b:node.end,depth:node.depth};
            if (title) h.title = addNode(title.start,title.end,'heading');
            headings.push(h);
        }
        for (const c of kids) visit(c,kind ?? parentKind,depth+1);
    }
    tree.roots.forEach(n => visit(n,'root',0));
    const external = sourceHeadings[di]; assert.equal(external.id,doc.id);
    if (!headings.length) for (const [i,[a,depth]] of external.headings.entries()) {
        const b = external.headings.slice(i+1).find(([,d]) => d <= depth)?.[0] ?? source.length;
        const lineEnd = source.indexOf('\n',a);
        const title = addNode(a,Math.min(b,lineEnd < 0 ? b : lineEnd),'heading');
        headings.push({a,b,depth,title});
        if (!skipped.some(([lo,hi]) => lo < b && hi > a)) addNode(a,b,'section');
    }
    const section = pos => headings.findLast(h => h.a <= pos && pos < h.b)?.a ?? -1;
    const sectionParents = new Map(headings.map(h => [h.a,headings.findLast(p => p.depth<h.depth && p.a<=h.a && h.a<p.b)?.a ?? -1]));
    const position = new Map(atoms.map((p,i) => [p,i]));
    const tags = atoms.map(p => {
        const x = last(p), path = bounds.filter(n => n.a <= x && x < n.b);
        const inner = k => path.findLast(n => n.kind === k)?.a ?? -1;
        const body = path.find(n => ['paragraph','list','blockquote','code','table','other'].includes(n.kind));
        return { section:section(x), para:inner('paragraph'), item:inner('listItem'), list:inner('list'),
            body:body?.kind ?? '', opaque:path.some(n => ['code','table'].includes(n.kind)) };
    });
    const counts = {};
    function edgeKind(left,right) {
        const l = members[left].at(-1), r = members[right][0], a = position.get(l), b = position.get(r);
        if (b !== a+1 || skipped.some(([lo,hi]) => lo < first(r) && hi > last(l))) return '';
        const lt = tags[a], rt = tags[b];
        let type = '';
        if (lt.section === rt.section) {
            if (lt.list >= 0 && lt.list === rt.list && lt.item >= 0 && rt.item >= 0 && lt.item !== rt.item) type = 'items';
            else if (lt.body && rt.body && lt.body !== rt.body) type = 'mixed';
        } else if (lt.section >= 0 && rt.section >= 0 && sectionParents.get(lt.section) === sectionParents.get(rt.section)) type = 'siblingSections';
        return type;
    }
    function saveGroup(items) {
        const c = combine(items);
        members[c] ??= items.flatMap(i => members[i] ?? [i]);
        return c;
    }
    for (const base of ['tree','joined']) {
        const cores=plans[base];
        const types=cores.map((c,i)=>i?edgeKind(cores[i-1],c):'');
        for(const k of ['items','mixed','siblingSections'])counts[base+'-'+k]=types.filter(type=>type===k).length;
        for (const [name, allowed] of [['items',['items']],['mixed',['items','mixed']],['sections',['items','mixed','siblingSections']]]) {
            const chunks = [];
            cores.forEach((c,i) => { if (!i || !allowed.includes(types[i])) chunks.push([]); chunks.at(-1).push(c); });
            plans[base==='tree'?'early'+name:name] = chunks.map(saveGroup);
        }
    }
    for (const p of atoms) members[p] ??= [p];
    const atomVectors=old.atoms.map(p=>new Float32Array(baseBytes.buffer,baseBytes.byteOffset+old.passages[p].v*dimension*4,dimension));
    const contexts=boundaryContexts(atomVectors,tags);
    for (const name of ['flat40','joined','tree']) {
        const sizes = plans[name].map(c => members[c].length);
        assert.deepEqual(plans[name].flatMap(c => members[c]),atoms);
        const originalCuts = new Set(); let cursor = 0;
        for (const n of sizes) { if (cursor) originalCuts.add(cursor); cursor += n; }
        // Only permute cuts between complete units in the same prose paragraph.
        const pools = new Map();
        for (let i=1;i<atoms.length;i++) {
            const a=tags[i-1], b=tags[i];
            if (a.para<0 || a.para!==b.para || a.section!==b.section || a.opaque || b.opaque) continue;
            if (!pools.has(a.para)) pools.set(a.para,[]);
            pools.get(a.para).push(i);
        }
        const trials=[...seeds.flatMap(seed=>['inside','lengths'].map(mode=>[seed,mode])),[0,'window3'],[0,'valley']];
        for (const [seed,mode] of trials) {
            const salt = doc.id + '/' + name + '/' + seed;
            const cuts = new Set();
            if (mode === 'lengths') {
                let total = 0;
                for (const n of permute(sizes,salt)) { if (total) cuts.add(total); total+=n; }
            } else {
                for (const i of originalCuts) cuts.add(i);
                for (const [para,edges] of pools) {
                    const n = edges.filter(i => originalCuts.has(i)).length;
                    if (!n || n===edges.length) continue;
                    edges.forEach(i => cuts.delete(i));
                    const ordered=seed ? permute(edges,salt+'/'+para)
                        : edges.toSorted((a,b)=>contexts.get(a)[mode]-contexts.get(b)[mode]||a-b);
                    ordered.slice(0,n).forEach(i => cuts.add(i));
                }
            }
            assert.equal(cuts.size, originalCuts.size);
            const groups=[];
            atoms.forEach((p,i) => { if (!i || cuts.has(i)) groups.push([]); groups.at(-1).push(p); });
            plans[(seed?[name,mode,seed]:[name,mode]).join('-')] = groups.map(items=>{
                const c=combine(items); members[c] ??= items; return c;
            });
        }
    }
    function overlap(a,b) {return passages[a].spans.some(([lo,hi])=>passages[b].spans.some(([s,e])=>lo<e&&s<hi));}
    function side(n, pos, left) {
        if (n<0) return -1;
        const sec=section(pos), kids=members[n] ?? [n];
        if (section(first(n))===sec && section(last(n))===sec && kids.every(p=>section(last(p))===sec)) return n;
        const kept=[];
        for (const p of left?kids.toReversed():kids) { if (section(last(p))!==sec) break; kept.push(p); }
        return combine(left?kept.reverse():kept);
    }
    for (const [name,cs] of Object.entries(plans)) if (!configs[name]) {
        const rows=cs.map((c,i) => {
            let l=cs[i-1]??-1, r=cs[i+1]??-1;
            if(l>=0&&overlap(c,l))l=-1; if(r>=0&&overlap(c,r))r=-1;
            return [side(l,first(c),true),side(r,last(c),false),c];
        });
        configs[name]={settings:{section:rows},bridges:[]};
    }
    plans.hybrid=[...plans.blocks,...plans.joined];
    configs.hybrid={settings:{section:[...configs.blocks.settings.section,...configs.joined.settings.section]},bridges:[]};
    const questions=old.questions.map(q=>({...q,v:vectorId(old.texts[q.v])}));
    const bank=await openReplay(undefined,join(out,'vectors',key,String(di)),{lengthSafe:true,concurrency:3});
    try {
        const missing=texts.filter(s=>!known.has(s));
        const fresh=new Map((await bank.embed(missing)).map((v,i)=>[missing[i],v]));
        const bytes=Buffer.alloc(texts.length*dimension*4), width=dimension*4;
        texts.forEach((s,i)=>{
            const v=known.get(s);
            if(v===undefined){ const a=fresh.get(s); Buffer.from(a.buffer,a.byteOffset,a.byteLength).copy(bytes,i*width); }
            else {
                const original=v<old.texts.length, start=(original?v:v-old.texts.length)*width;
                (original?baseBytes:extraBytes).copy(bytes,i*width,start,start+width);
            }
        });
        const index={stamp,id:doc.id,model,dimension,plans,configs,members,passages,questions,atoms,
            levels:Object.fromEntries(Object.entries(levels).map(([k,v])=>[k,[...v]])),counts,
            hashes:texts.map(sha256),tokens:texts.map(bank.countTokens),vectorSHA256:sha256(bytes)};
        await writeFile(dest+'.f32.tmp',bytes); await rename(dest+'.f32.tmp',dest+'.f32');
        await writeFile(dest+'.json.gz.tmp',gzipSync(JSON.stringify(index))); await rename(dest+'.json.gz.tmp',dest+'.json.gz');
    } finally { bank.close(); }
}
for (const [di,doc] of data.docs.entries()) await build(di,doc);
console.log(key, data.docs.length);
