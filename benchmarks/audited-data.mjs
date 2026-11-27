import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { parseTextTree } from '../src/sentences.js';
import { asset, cache, compact, here, sha256, tarJSON } from './corpora.mjs';
import { papers } from './markdown-corpora.mjs';
import { directory, readJSON, resultsDir, settingsManifest } from './semantic-settings-data.mjs';
import { governmentViews, manualViews, markdownCoverage, readData, searchIndex } from './tree-dataset.mjs';

const results = name => join(resultsDir, name);
const filings = await readJSON(results('2026-11-27-full-filings-data.json'));
const settings = await readJSON(settingsManifest);
const trees = await readJSON(results('2026-11-26-tree-corpus.json'));
const protocol = await readJSON(join(here, 'whole-passage-audited-protocol.json'));
const archiveInfo = await readJSON(results('2026-11-27-whole-passage-filings.json'));
const archive = await readFile(results('2026-11-27-whole-passage-filings-outcomes.jsonl.gz'));
assert.equal(sha256(archive), archiveInfo.archiveSHA256);
const archived = new Map(gunzipSync(archive).toString().trimEnd().split('\n').map(line => {
    const row = JSON.parse(line);
    return [row.key, row];
}));
const manifest = {sources: {}, audit: {}, sets: {}};
const parser = await loadMarkdownParser();
await mkdir(directory, {recursive:true});

async function save(key, docs, pool, vectorBank) {
    const questions = docs.flatMap(d => d.questions), data = JSON.stringify(docs);
    assert.equal(new Set(docs.map(d => d.id)).size, docs.length);
    assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
    manifest.sets[key] = {sources:docs.map(d => d.id), questions:questions.length, format:docs[0].format,
        pool, vectorBank, sha256:sha256(data)};
    const path = join(directory, key + '.json'), temporary = path + '.' + randomUUID();
    await writeFile(temporary, data);
    await rename(temporary, path);
}

async function finance() {
    const root = 'https://raw.githubusercontent.com/patronus-ai/financebench/' + filings.release;
    const name = 'financebench_document_information.jsonl';
    const url = root + '/data/' + name, checksum = filings.assetSHA256[name];
    await mkdir(join(cache, 'financebench'), {recursive:true});
    const metadata = (await readFile(await asset({name:'financebench/' + name, url, checksum}), 'utf8'))
        .trimEnd().split('\n').map(line => JSON.parse(line));
    const byId = new Map(metadata.map(v => [v.doc_name, v]));
    const documents = {};
    for (const [id, doc] of Object.entries(filings.documents)) {
        const publisher = byId.get(id).doc_link;
        assert(/^https?:\/\//u.test(publisher), id);
        documents[id] = {publisher, pdf:root + '/pdfs/' + encodeURIComponent(id + '.pdf'), sha256:doc.pdfSHA256};
    }
    manifest.sources.finance = {metadata:url, sha256:checksum, release:filings.release, documents};
    manifest.audit.finance = {manifest:'2026-11-27-full-filings-data.json', outcomeArchiveSHA256:archiveInfo.archiveSHA256};
    for (const [key, meta] of Object.entries(filings.sets)) if (key.startsWith('finance-')) manifest.sets[key] = meta;
}

async function government() {
    const review = await readJSON(join(here, 'government-citations.json'));
    const navigation = new Set(review.navigationOnlyEvidence), omitted = {}, aliases = {}, restoredTitles = {};
    const previous = new Set([...archived].filter(([k]) => k.startsWith('government-') && k.endsWith('-html'))
        .flatMap(([,r]) => r.queries.map(q => q[0])));
    const raw = await readData('government');
    const byContent = new Map(), canonical = new Map(), pages = [], folds = new Map();
    const source = (await readJSON(results('2026-11-26-semantic-blocks-corpus-audit.json'))).sources['doc2dial-v1.0.1.zip'];
    manifest.sources.government = {url:source[0], sha256:source[1], member:'doc2dial_doc.json'};
    for (const p of raw) {
        const group = p.domain + '/' + p.id.replace(/#\d+(?:_\d+)*$/u, '').trim().toLowerCase();
        assert(!folds.has(group) || folds.get(group) === p.split, group);
        folds.set(group, p.split);
        const visible = compact((await parseTextTree(p.raw, {inputFormat:'html'})).source);
        const fingerprint = sha256(visible);
        if (!byContent.has(fingerprint)) {
            const doc = {...p, group, questions:[]};
            const title = p.title.replace(/#\d+(?:_\d+)*$/u, '').replace(/\s*\|\s*Social Security Administration$/iu, '').trim();
            const normalize = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
            if (!/<h1\b/iu.test(p.raw) && !normalize(visible).startsWith(normalize(title))) {
                const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
                doc.raw = '<h1>' + escaped + '</h1>\n' + p.raw;
                restoredTitles[p.id] = title;
            }
            pages.push(doc);
            byContent.set(fingerprint, doc);
        }
        const doc = byContent.get(fingerprint);
        assert.equal(doc.split, p.split);
        assert.equal(doc.domain, p.domain);
        canonical.set(p.id, doc);
        if (p.id !== doc.id) aliases[p.id] = doc.id;
    }
    const accepted = new Set(), alternatives = new Map();
    for (const p of raw) for (const q of p.questions) {
        if (!previous.has(q.id)) continue;
        const why = review.excludedQuestions[q.id] ?? (navigation.has(q.evidence.join(' ')) && 'navigationOnly');
        if (why) { omitted[q.id] = why; continue; }
        assert(!accepted.has(q.id));
        accepted.add(q.id);
        const doc = canonical.get(p.id);
        doc.questions.push(q);
        for (const target of review.alternativeSources[q.id] ?? []) {
            const other = canonical.get(target);
            assert(other && other !== doc && other.split === doc.split && other.domain === doc.domain);
            const id = 'alternative/' + q.id;
            other.questions.push({...q, id});
            alternatives.set(id, q.id);
        }
    }
    assert.equal(accepted.size + Object.keys(omitted).length, previous.size);
    assert.deepEqual([...alternatives.values()].sort(), Object.keys(review.alternativeSources).sort());
    const misses = {unmatchedOrAmbiguous:0, unindexedMarkdownEvidence:0};
    const sets = await governmentViews(pages, parser, misses);
    assert.equal(misses.unmatchedOrAmbiguous + misses.unindexedMarkdownEvidence, 0);
    for (const [key, docs] of sets) {
        const questions = new Map(docs.flatMap(d => d.questions.filter(q => accepted.has(q.id)).map(q => [q.id,q])));
        for (const d of docs) {
            for (const q of d.questions.filter(q => alternatives.has(q.id))) {
                const parent = questions.get(alternatives.get(q.id));
                (parent.alternativeSources ??= []).push({source:d.id, ranges:q.ranges});
            }
            d.questions = d.questions.filter(q => accepted.has(q.id));
        }
        await save(key.replace(/-(development|confirmation)-/u, '-$1-reviewed-'), docs, 'collection',
            key.replace(/-(html|text|markdown)$/u, '') + '.0');
    }
    manifest.audit.government = {originalPages:raw.length, distinctPages:pages.length, pageFamilies:folds.size, aliases, restoredTitles,
        previousQuestions:previous.size, scored:accepted.size, questionsWithAlternativeSources:alternatives.size, omitted};
}

// Every highlighted span must resolve in the same annotator's cited paragraphs.
// QASPER selections can run through a section heading into the following paragraph.
function highlightSelector(stats) {
    let lastSource, locate;
    return (answer, parents, source) => {
        const highlights = answer.highlighted_evidence?.map(compact);
        const reject = reason => { stats[reason] = (stats[reason] ?? 0) + 1; return null; };
        if (!highlights?.length || highlights.some(s => !s)) return reject('missingHighlights');
        if (answer.extractive_spans.length && answer.extractive_spans.every(s =>
            /^(?:(?:BIBREF|FIGREF|TABREF|SECREF|EQREF|INLINEFORM|DISPLAYFORM)\d+[\s,;.]*)+$/u.test(s.trim())))
            return reject('placeholderOnlyAnswer');
        if (source !== lastSource) {
            lastSource = source;
            locate = searchIndex(source.replace(/^#{1,6} /gmu, s => ' '.repeat(s.length)));
        }
        const ref = [];
        for (const text of highlights) {
            if (text.startsWith('FLOAT SELECTED:')) return reject('visualHighlight');
            const local = parents.flatMap(([,a,b]) => {
                const hits = searchIndex(source.slice(a,b))(text);
                return hits ? [hits.map(([from,to]) => [from+a,to+a])] : [];
            });
            const ranges = local.length === 1 ? local[0] : locate(text);
            if (!ranges || !ranges.some(([a,b]) => parents.some(([,lo,hi]) => lo <= a && b <= hi)))
                return reject('unresolvedHighlight');
            ref.push(...ranges);
        }
        if (!parents.every(([,lo,hi]) => ref.some(([a,b]) => lo <= a && b <= hi))) return reject('uncitedParent');
        return ref.map(([a,b]) => [parents[0][0],a,b]);
    };
}

async function research() {
    const source = settings.sources.qasper, member = 'qasper-dev-v0.3.json';
    const all = await tarJSON(await asset(source), member), audit = {}, seen = new Set(), titles = new Set();
    manifest.sources.papers = {url:source.url, sha256:source.checksum, member};
    for (const [key, meta] of Object.entries(settings.sets).filter(([k]) => k.startsWith('papers-'))) {
        const stats = {}, eligible = new Set(archived.get(key).queries.map(q => q[0]));
        const rows = meta.sources.map(id => {
            const row = all[id], title = compact(row.title).toLowerCase();
            assert(!seen.has(id) && !titles.has(title), id);
            seen.add(id); titles.add(title);
            return [id, {...row, qas:row.qas.filter(q => eligible.has(q.question_id))}];
        });
        const data = papers(rows, highlightSelector(stats));
        const docs = data.docs.map(d => ({id:d.id, group:d.id, format:'markdown', raw:d.source, source:d.source, questions:[]}));
        const indexed = await Promise.all(docs.map(d => markdownCoverage(d.source, parser)));
        for (const q of data.questions) {
            const [i] = q.pool;
            const refs = [];
            for (const ref of q.references) {
                if (ref.every(([,a,b]) => indexed[i].some(r => r.start <= a && b <= r.end))) {
                    refs.push(ref.map(([,a,b]) => [a,b]));
                } else {
                    stats.unindexedHighlight = (stats.unindexedHighlight ?? 0) + 1;
                }
            }
            if (!refs.length) continue;
            docs[i].questions.push({id:q.id, text:q.text, kind:'paper', references:refs});
            eligible.delete(q.id);
        }
        audit[key] = {excludedQuestions:[...eligible], rejectedAnnotations:{...data.exclusions,...stats}};
        await save(key.replace(/-(\d+)$/u, '-reviewed-$1'), docs, 'document', key + '.0');
    }
    manifest.audit.papers = audit;
}

async function faqs() {
    const sources = trees.manuals.filter(d => d.split !== 'product').map(d => ({...d,
        name:'tree-corpus/' + d.id + '-' + d.url.split('/')[5] + '.md'}));
    for (const [id,group,rev,path,sha256] of settings.sources.manuals) {
        sources.push({id, group, split:'confirmation', url:'https://raw.githubusercontent.com/' + group + '/' + rev + '/' + path,
            sha256, name:'semantic-settings-' + id + '.md'});
    }
    const review = await readJSON(join(here,'faq-citations.json')), seen = new Set(), omitted = {};
    manifest.sources.faq = sources.map(({name,...s}) => s);
    const groups = new Map();
    for (const meta of sources) {
        const raw = await readFile(await asset({name:meta.name, url:meta.url, checksum:meta.sha256}), 'utf8');
        const key = 'faq-' + meta.split;
        const [doc] = manualViews([{...meta,raw}], parser).get(key + '-published');
        assert.equal(doc.source, raw);
        const lines = [...raw.matchAll(/[^\n]*(?:\n|$)/gu)];
        const coverage = await markdownCoverage(raw, parser);
        doc.questions = doc.questions.flatMap(q => {
            const entry = review[q.id];
            assert(entry && !seen.has(q.id), q.id);
            seen.add(q.id);
            if (entry.exclude) { omitted[q.id] = entry.exclude; return []; }
            assert(!compact(raw).toLowerCase().includes(compact(entry.question).toLowerCase()), q.id);
            const references = entry.lines.map(spec => {
                const ranges = [];
                for (const bounds of spec.split(',')) {
                    assert(/^\d+(?:-\d+)?$/u.test(bounds), q.id);
                    const [start, end = start] = bounds.split('-').map(Number);
                    assert(start >= 1 && end >= start && end <= lines.length, q.id);
                    for (const line of lines.slice(start-1, end)) {
                        if (!line[0].trim() || /^\s*(?:```|~~~)/u.test(line[0])) continue;
                        const words = q.ranges.filter(([a,b]) => line.index <= a && b <= line.index + line[0].length
                            && coverage.some(r => r.start <= a && b <= r.end));
                        assert(words.length, q.id + ' line ' + (lines.indexOf(line)+1));
                        ranges.push(...words);
                    }
                }
                assert(ranges.length, q.id);
                return ranges;
            });
            return [{id:q.id, text:entry.question, references}];
        });
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(doc);
    }
    assert.deepEqual([...seen].sort(), Object.keys(review).sort());
    manifest.audit.faq = {originalEntries:seen.size, omitted};
    for (const [key,docs] of groups) await save(key + '-reviewed', docs, 'collection', key + '-natural.0');
}

await finance();
await research();
await faqs();
await government();
const file = results(protocol.data);
try { assert.deepEqual(manifest, await readJSON(file)); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(file, JSON.stringify(manifest,null,2) + '\n');
}
console.log('Verified', Object.keys(manifest.sets).length, 'whole-passage search sets.');
