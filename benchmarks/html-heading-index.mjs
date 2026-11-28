// Benchmark an HTML outline using Semachunk's native parser and source citations.
import assert from 'node:assert/strict';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {studyLayout as chunkDocument} from './study-layouts.mjs';
import {parseTextTree} from '../src/sentences.js';
import {sliceView, sourceSpans} from '../src/citations.js';
import {canonicalMapper} from './bounded-source.mjs';
import {cache, here, sha256} from './corpora.mjs';
import {dimension, model, openReplay} from './encoder.mjs';

const root = join(cache, 'html-heading');
const previous = join(cache, 'html-markdown');
const edition = JSON.parse(await readFile(join(here, 'results/2026-11-27-prose-reviewed-data.json')));
const revision = sha256(Buffer.concat(await Promise.all([
    import.meta.url, '../src/index.js', '../src/sentences.js', '../src/hierarchy.js',
    '../src/citations.js', '../src/html-citations.js', '../src/semantic.js', './bounded-source.mjs'
].map(file => readFile(new URL(file, import.meta.url))))));
const limit = 512;
const groupingTarget = 256;
const ink = text => text.replace(/\s/gu, '');
const unzip = async file => JSON.parse(gunzipSync(await readFile(file)));

async function headingPassages(doc, countTokens) {
    const tree = await parseTextTree(doc.raw, {inputFormat:'html'}, true);
    assert.equal(tree.source, doc.source);
    const canonical = canonicalMapper(tree.view.citations);
    const starts = new Set([0, doc.source.length]);
    const stack = [...tree.roots];
    while (stack.length) {
        const node = stack.pop();
        if (node.headingEnd !== undefined || node.kind === 'heading') starts.add(node.start);
        if (node.children) stack.push(...node.children);
    }
    const offsets = [...starts].sort((a,b) => a-b);
    const passages = [];
    let oversized = 0;
    function passage(a, b) {
        const original = doc.source.slice(a,b);
        const left = a + original.length - original.trimStart().length;
        const right = a + original.trimEnd().length;
        if (left >= right) return;
        const view = sliceView(tree.view, left, right);
        const tokens = countTokens(view.text);
        const raw = sourceSpans(view);
        const ranges = canonical(raw);
        assert.ok(tokens > 0 && tokens <= limit && raw.length > 0);
        assert.ok(raw.every(([start,end]) => start >= 0 && end <= doc.raw.length));
        assert.equal(ink(ranges.map(([x,y]) => doc.source.slice(x,y)).join('')), ink(view.text));
        return {text:view.text, raw, ranges, tokens, start:left, end:right};
    }
    for (let i=0; i+1<offsets.length; i++) {
        const a = offsets[i], b = offsets[i+1], section = doc.source.slice(a,b);
        if (countTokens(section.trim()) <= limit) {
            const p = passage(a,b);
            if (p) passages.push(p);
            continue;
        }
        oversized++;
        const parts = await chunkDocument(section, {format:'text', strategy:'blocks', sizeUnit:'tokens',
            maxChunkSize:limit, maxStructuralSize:limit, maxPassageSize:limit, countTokens, excludeNonLetterSentences:false});
        for (const part of parts) {
            const spans = sourceSpans(part);
            const left = a+spans[0][0], right = a+spans.at(-1)[1];
            assert.equal(ink(doc.source.slice(left,right)), ink(part.text));
            passages.push(passage(left,right));
        }
    }
    assert.equal(ink(passages.map(p => p.text).join('')), ink(doc.source));
    const packed = [];
    for (let i=0; i<passages.length;) {
        const from = i++;
        while (i<passages.length && countTokens(doc.source.slice(passages[from].start,passages[i].end)) <= groupingTarget) i++;
        const group = i===from+1 ? passages[from] : passage(passages[from].start,passages[i-1].end);
        packed.push({...group, members:passages.slice(from,i)});
    }
    assert.equal(ink(packed.map(p => p.text).join('')), ink(doc.source));
    return {passages, packed, sections:offsets.length-1, oversized};
}

async function build(key, i, doc, bank) {
    const stem = join(root,key,String(i));
    const old = join(previous,key,String(i));
    const archive = await unzip(old+'.json.gz');
    assert.equal(archive.id,doc.id);
    assert.equal(archive.sourceHash,sha256(doc.source));
    assert.equal(archive.htmlHash,sha256(doc.raw));
    assert.equal(archive.model,model);
    assert.equal(archive.dimension,dimension);
    const stamp = sha256(JSON.stringify([revision,archive.stamp,archive.vectorHash,limit]));
    try {
        const saved = await unzip(stem+'.json.gz');
        if (saved.stamp === stamp && sha256(await readFile(stem+'.f32')) === saved.vectorHash) return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const {passages, packed, sections, oversized} = await headingPassages(doc,bank.countTokens);
    const oldBytes = await readFile(old+'.f32');
    assert.equal(archive.vectorHash,sha256(oldBytes));
    const rows = archive.qs.map(q => oldBytes.subarray(q.v*dimension*4,(q.v+1)*dimension*4));
    const qs = archive.qs.map((q,v) => ({...q,v}));
    const texts = [...new Set([...passages,...packed].map(p => p.text))];
    const keys = new Map(texts.map((text,v) => [text,v+rows.length]));
    const vectors = await bank.embed(texts);
    for (const v of vectors) rows.push(Buffer.from(v.buffer,v.byteOffset,v.byteLength));
    const bytes = Buffer.concat(rows);
    const views = [...passages,...packed].map(({tokens,raw,ranges}) => ({tokens,raw,ranges}));
    const layouts = {headings:passages.map((p,j) => ({v:keys.get(p.text),bare:j})),
        packed:packed.map((p,j) => ({v:keys.get(p.text),bare:passages.length+j,members:p.members.map(m => keys.get(m.text))}))};
    const ix = {id:doc.id, model, dimension, stamp, sourceHash:archive.sourceHash, htmlHash:archive.htmlHash,
        vectorHash:sha256(bytes), qs, views, layouts, sections, oversized};
    await writeFile(stem+'.f32.tmp', bytes);
    await rename(stem+'.f32.tmp', stem+'.f32');
    await writeFile(stem+'.json.gz.tmp', gzipSync(JSON.stringify(ix)));
    await rename(stem+'.json.gz.tmp', stem+'.json.gz');
}

for (const [key, spec] of Object.entries(edition.sets)) {
    if (!/^government-(development|confirmation)-reviewed-\w+-html$/u.test(key)) continue;
    const data = await readFile(join(cache,'prose-reviewed',key+'.json'));
    assert.equal(spec.sha256,sha256(data));
    const docs = JSON.parse(data);
    await mkdir(join(root,key),{recursive:true});
    const bank = await openReplay(undefined,join(previous,'vectors',key),{lengthSafe:true,concurrency:3});
    try {
        for (let i=0; i<docs.length; i+=3) {
            await Promise.all(docs.slice(i,i+3).map((doc,j) => build(key,i+j,doc,bank)));
        }
        console.log(key,docs.length,'pages;',bank.stats.apiInputTokens,'new embedding tokens');
    } finally { bank.close(); }
}
