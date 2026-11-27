import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { asset, assets, cache, here, sha256, tarJSON } from './corpora.mjs';
import { finances, papers } from './markdown-corpora.mjs';
import { manualViews, manifestPath, readData } from './tree-dataset.mjs';
import { loadMarkdownParser } from '../src/markdown-units.js';

export const directory = join(cache,'semantic-settings');
export const resultsDir = join(here,'results');
export const settingsManifest = join(resultsDir,'2026-11-26-semantic-settings-data.json');
export const readJSON = async file => JSON.parse(await readFile(file,'utf8'));
const splitOf = issuer => parseInt(sha256('semachunk/settings/v1/issuer/'+issuer).slice(0,8),16)%2 ? 'confirmation' : 'development';
const ordered = (ids,label) => [...ids].sort((a,b) => sha256(label+a).localeCompare(sha256(label+b),'en'));
const reportId = row => row.filename.slice(0,row.filename.lastIndexOf('/'));
const kind = row => [...new Set(Object.keys(row.qa.gold_inds).map(k => k.split('_')[0]))].sort().join('+');
const paperAsset = {name:'qasper-train-dev-v0.3.tgz',url:'https://qasper-dataset.s3.us-west-2.amazonaws.com/qasper-train-dev-v0.3.tgz',
    checksum:'a28fdf966db827bcee3d873107d6b6669864fb7ca8fbf73a192f5e39191bdb5a'};
const manuals = [
    ['vue','vuejs/docs','f66b5825d64a722ea6abc6eaae9974aa09c0c109','src/about/faq.md','cab87e4c557c665d01db7084dcd3b6965fc88b5f3bfff7af43b597327567e894'],
    ['poetry','python-poetry/poetry','3cc663a738522c90dc2b50fcadc74e39ada4b73a','docs/faq.md','8e79e17fa877e0bbab5b411bd56e729af7868e6ea97f7804af05980973eef277'],
    ['ruff','astral-sh/ruff','8f0189e0e975334474efb938eafc48f22855aadb','docs/faq.md','c79548b4c7674018bcfa5078e4cf45eec3ee7da6fac2440bfa592316af256f6f']
];

async function archivedReports() {
    const ids = new Set();
    for (const name of await readdir(resultsDir)) {
        if (name.includes('semantic-settings') || !/^2026-11-2[3-6]-.*(?:\.json|\.gz)$/u.test(name)) continue;
        const bytes = await readFile(join(resultsDir,name));
        const text = (name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString();
        for (const m of text.matchAll(/([A-Za-z0-9._-]+\/[12]\d{3})\/page_\d+\.pdf/gu)) ids.add(m[1]);
    }
    return [...ids].sort();
}
// Paper annotations can have several independent, valid evidence sets for the same question.
function documents(dataset, category, rowsById) {
    const docs = dataset.docs.map(d => ({id:d.id,raw:d.source,source:d.source,format:'markdown',group:d.id,questions:[]}));
    for (const q of dataset.questions) {
        const [d] = q.pool;
        for (const ref of q.references) for (const [index,a,b] of ref) assert(d === index && b > a);
        const finance = rowsById?.get(q.id);
        docs[d].group = finance ? reportId(finance) : q.group;
        docs[d].questions.push({id:q.id,text:q.text,kind:finance ? kind(finance) : category,
            cluster:finance ? finance.filename.split('/')[0] : q.group,
            references:q.references.map(ref => ref.map(([,a,b]) => [a,b]))});
    }
    return docs;
}

async function prepare() {
    await mkdir(directory,{recursive:true});
    let prior;
    try { await access(settingsManifest); prior = await readJSON(settingsManifest); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const excluded = prior?.excludedReports ?? await archivedReports();
    const manifest = {version:1,excludedReports:excluded, sources:{qasper:paperAsset, manuals, finqa:{}},sets:{}};
    const used = new Set(excluded), financial = [], pages = new Map(), ids = new Set(), reports = new Set();
    for (const key of ['finqa','finqaTest','finqaTrain']) {
        const rows = await readJSON(await asset(assets[key])), strata = {};
        manifest.sources.finqa[key] = {...assets[key],questions:rows.length,evidence:strata};
        for (const row of rows) {
            strata[kind(row)] = (strata[kind(row)] ?? 0)+1;
            if (used.has(reportId(row))) continue;
            const digest = sha256(JSON.stringify([row.pre_text,row.table,row.post_text]));
            if (pages.has(row.filename)) assert.equal(pages.get(row.filename),digest,row.filename);
            pages.set(row.filename,digest);
            assert(!ids.has(row.id),row.id); ids.add(row.id);
            financial.push(row); reports.add(reportId(row));
        }
    }
    const allPapers = await tarJSON(await asset(paperAsset),'qasper-dev-v0.3.json');
    const oldPapers = await tarJSON(await asset(assets.qasper),'qasper-test-v0.3.json');
    const checks = new Set(Object.keys(oldPapers).map(id => id.toLowerCase()));
    const paperOrder = ordered(Object.keys(allPapers).filter(id => !checks.has(id.toLowerCase())),'semantic-settings/paper/');
    const labels = (await readJSON(join(resultsDir,'2026-11-26-tree-labels.json'))).excluded;
    const tree = await readJSON(manifestPath);
    async function save(key, docs, pool) {
        const data = JSON.stringify(docs), questions = docs.flatMap(d => d.questions);
        assert.equal(questions.length,new Set(questions.map(q => q.id)).size);
        manifest.sets[key] = {sources:docs.map(d => d.id),questions:questions.length,format:docs[0].format,pool,
            byEvidence:Object.fromEntries([...new Set(questions.map(q => q.kind ?? 'published'))]
                .map(k => [k,questions.filter(q => (q.kind ?? 'published') === k).length])),sha256:sha256(data)};
        await writeFile(join(directory,key+'.json'),data);
    }
    for (const [index,fold] of ['development','confirmation'].entries()) {
        for (const [key,meta] of Object.entries(tree.retrieval)) {
            if (!key.includes(fold) || !(key.startsWith('government-') || key.endsWith('-masked') || key.endsWith('-published'))) continue;
            const docs = await readData(key);
            assert.equal(sha256(JSON.stringify(docs)),meta.sha256);
            if (key.startsWith('government-')) for (const d of docs) d.questions = d.questions.filter(q => !labels[q.id]);
            await save(key,docs,key.startsWith('government-') ? 'agency' : 'manuals');
        }
        const groups = ordered([...reports].filter(id => splitOf(id.split('/')[0]) === fold),'semantic-settings/finance/').slice(0,64);
        assert.equal(groups.length,64);
        const selected = new Set(groups), rows = financial.filter(r => selected.has(reportId(r)));
        const data = finances(rows), byId = new Map(rows.map(r => [r.id,r]));
        const financeDocs = documents(data,'finance',byId);
        const paperDocs = documents(papers(paperOrder.slice(index*64,(index+1)*64).map(id => [id,allPapers[id]])),'paper');
        assert.equal(paperDocs.length,64);
        manifest[fold] = {reportIds:groups, financialRows:rows.length, mapped: data.questions.length,
            pages:financeDocs.length,tableRows:financeDocs.map(d => rows.find(r => r.filename === d.id).table.length-1)};
        for (const [name, docs, size] of [['finance',financeDocs,32],['papers',paperDocs,8]]) {
            for (let i=0; i<docs.length; i+=size) await save(name+'-'+fold+'-'+i/size,docs.slice(i,i+size),'document');
        }
    }
    const rawManuals = [];
    for (const [id,group,rev,path,checksum] of manuals) {
        const url = 'https://raw.githubusercontent.com/'+group+'/'+rev+'/'+path;
        rawManuals.push({id,group,split:'fresh',raw:await readFile(await asset({name:'semantic-settings-'+id+'.md',url,checksum}),'utf8')});
    }
    for (const [key,docs] of manualViews(rawManuals,await loadMarkdownParser())) {
        for (const d of docs) for (const q of d.questions) q.text = q.text.replace(/\s*\{#[^}]+\}\s*$/u,'');
        await save(key,docs,'manuals');
    }
    if (prior) assert.deepEqual(manifest,prior);
    else await writeFile(settingsManifest,JSON.stringify(manifest,null,2)+'\n');
    console.log(Object.entries(manifest.sets).reduce((n,[,s])=>n+s.questions,0),'question/view combinations prepared');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await prepare();
