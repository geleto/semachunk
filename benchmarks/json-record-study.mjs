import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { asset, assets, cache, here, sha256 } from './corpora.mjs';
import { denseRanker } from './chunking.mjs';
import { deliver } from './delivered-context.mjs';
import { dimension, model, openReplay, openTokenizer } from './encoder.mjs';
import { hotpotQuestion, hotpotSource, indexedHits, scoreQuestion, tableQuestions, titleQuery, visibleHits } from './json-evidence.mjs';
import { layouts, measureLayouts, structured } from './json-layouts.mjs';

const { positionals: [task, corpus], values } = parseArgs({ allowPositionals: true, options: {
    start: { type: 'string', default: '0' }, batches: { type: 'string', default: 'Infinity' },
    freeze: { type: 'string' }, layout: { type: 'string' }, concurrency: { type: 'string', default: '4' }
} });
const directory = join(cache, 'json-records'), batchSize = 32;
if (task === 'prepare') {
    for (const key of ['hotpotqa', 'hotpotTrain', 'wikisql', 'finqa']) await asset(assets[key]);
    execFileSync('python', ['-X', 'utf8', join(here, 'json-record-corpora.py'), cache], { stdio: 'inherit', windowsHide: true });
    process.exit(0);
}
assert.ok(['score', 'inventory', 'verify'].includes(task) && ['hotpot', 'confirmation', 'finqa', 'wikisql'].includes(corpus),
    'Use prepare, or score/inventory/verify followed by hotpot, finqa, wikisql or confirmation.');
const frozen = values.freeze && JSON.parse(await readFile(values.freeze));
if (task === 'verify') assert.ok(structured.includes(values.layout), 'Specify the public layout with --layout.');
else if (corpus === 'confirmation') assert.ok(frozen?.candidates && frozen?.reference, 'Freeze the development nominees before confirmation.');
const names = task === 'verify' ? [values.layout] : corpus === 'confirmation' ? [...frozen.candidates, frozen.reference] : [...structured, 'plain', 'record'];
const views = corpus === 'hotpot' ? ['array', 'last', 'text', 'indent', 'ascii', 'size500', 'cap256'] :
    corpus === 'confirmation' ? ['array', 'last', 'text'] : ['table'];
const protocol = JSON.parse(await readFile(join(here, 'json-record-protocol.json'), 'utf8'));
const { topK, budget } = protocol;
const settings = { corpus, names, views, model, dimension, topK, budget, batchSize };
if (task === 'score') {
    for (const [key, expected] of Object.entries(protocol)) {
        assert.equal(settings[key], expected, `JSON record scoring requires ${key}=${expected}.`);
        if (corpus === 'confirmation') assert.equal(frozen.development?.settings?.[key], expected,
            `Frozen development settings must specify ${key}=${expected}.`);
    }
}
const concurrency = Number(values.concurrency);
assert.ok(Number.isSafeInteger(concurrency) && concurrency > 0);
const start = Number(values.start), stop = start + Number(values.batches);
assert.ok(Number.isSafeInteger(start) && start >= 0 && stop > start);
const scoringCode = await Promise.all(['json-record-study.mjs', 'json-evidence.mjs', 'json-layouts.mjs', 'delivered-context.mjs', 'encoder.mjs',
    'chunking.mjs', '../src/index.js', '../src/json.js', '../src/json-records.js', '../src/sentences.js', '../src/abbreviations.js', '../src/packing.js',
    '../src/offsets.js', '../src/token-limit.js']
    .map(f => readFile(join(here, f), 'utf8')));
const version = sha256(JSON.stringify([settings, scoringCode])).slice(0, 16);
const reports = join(directory, 'scores', corpus + '-' + version);
if (task === 'score') await mkdir(reports, { recursive: true });
console.log(task, corpus, 'score directory', reports);

async function prepare(item, encoder) {
    const rendered = [], vocabulary = new Set();
    for (const view of views) {
        const cap = view === 'cap256' ? 256 : 0, size = view === 'size500' ? 500 : 1024;
        const source = item.context ? hotpotSource(item, view) : corpus === 'finqa' ? JSON.stringify(item.data) :
            '[' + item.rows.map(row => '{' + row.map((v, i) => JSON.stringify(item.header[i]) + ':' + JSON.stringify(v)).join(',') + '}').join(',') + ']';
        const { root, results } = await layouts(source, names, size, cap, encoder.countTokens);
        if (task === 'verify') {
            const chunks = await chunkText(source, { inputFormat: 'json', maxChunkSize: size,
                ...(cap && { maxChunkTokens: cap, countTokens: encoder.countTokens }) });
            assert.deepEqual(chunks, results[values.layout], item.id + '/' + view);
            continue;
        }
        const questions = item.context ? [hotpotQuestion(item, source, root, view)] : tableQuestions(item, source, root, corpus);
        const oversized = item.context && root.children.filter(n => n.length > size ||
            (cap && encoder.countTokens(source.slice(n.offset, n.offset + n.length)) > cap));
        const group = !oversized?.length ? 0 : oversized.some(n =>
            item.facts.some(([title]) => root.children[item.context.findIndex(c => c[0] === title)] === n)) ? 2 : 1;
        const extra = {};
        for (const base of ['packed', 'children']) {
            if (!item.context) continue;
            const q = titleQuery(item, source, root, results[base + '-repeat'], results[base + '-omit']);
            if (q) { extra[base] = q; vocabulary.add(q.text); }
        }
        for (const q of questions) vocabulary.add(q.text);
        const variants = measureLayouts(results, cap, encoder.countTokens, vocabulary);
        rendered.push({ view, source, hash: sha256(source), variants, questions, extra, group });
    }
    return { id: item.id, rendered, vocabulary: [...vocabulary] };
}

function score(pool, vectors, encoder) {
    const words = pool.vocabulary, ids = new Map(words.map((s, i) => [s, i]));
    const matrix = new Float32Array(words.length * dimension);
    words.forEach((s, i) => matrix.set(vectors.get(s), i * dimension));
    const rank = denseRanker(matrix), orders = new Map(), report = {};
    for (const { view, source, hash, variants, questions, extra, group } of pool.rendered) {
        const measured = [];
        for (const { names, hash: layout, rows, cost } of variants) {
            const ceiling = indexedHits(rows, source);
            const indices = rows.map(c => ids.get(c.text)), key = indices.join(',');
            function context(question) {
                const id = ids.get(question), indexKey = id + '/' + key;
                if (!orders.has(indexKey)) orders.set(indexKey, rank(id, indices).slice(0, topK));
                const delivered = deliver(orders.get(indexKey).map(i => rows[i]), budget, encoder, false);
                return { hits: visibleHits(source, delivered.text, delivered.ranges), tokens: encoder.countTokens(delivered.text) };
            }
            const answers = questions.map(q => {
                const { hits, tokens } = context(q.text);
                return [scoreQuestion(q, hits), scoreQuestion(q, ceiling), tokens];
            });
            const titles = {};
            for (const [base, q] of Object.entries(extra)) {
                if (!names.some(n => n === base + '-repeat' || n === base + '-omit')) continue;
                const { hits } = context(q.text);
                titles[base] = Number(hits.some(hit => q.occurrences.some(p => hit.some(r => r.from <= p.a && r.to >= p.b))));
            }
            measured.push({ names, layout, cost, answers, titles });
        }
        report[view] = { hash, group, questions: questions.map(q => [q.id, encoder.countTokens(q.text)]), measured };
    }
    return { id: pool.id, vectors: sha256(matrix), report };
}

async function run(items, index) {
    const input = sha256(JSON.stringify(items)), tag = String(index).padStart(4, '0');
    const file = join(reports, tag + '.json.gz');
    if (task === 'score') {
        try {
            const saved = JSON.parse(gunzipSync(await readFile(file)));
            assert.equal(saved.input, input);
            assert.deepEqual(saved.settings, settings);
            return;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const encoder = task === 'score' ? await openReplay(undefined, join(directory, 'vectors', corpus, tag), { lengthSafe: true, concurrency }) : openTokenizer();
    try {
        const pools = [];
        for (const item of items) pools.push(await prepare(item, encoder));
        if (task === 'verify') {
            console.log('batch', index, 'matched', items.length * views.length, 'public layouts');
            return;
        }
        const words = [...new Set(pools.flatMap(p => p.vocabulary))];
        if (task === 'inventory') {
            console.log('batch', index, items.length, 'pools', words.length, 'inputs', words.reduce((n, s) => n + encoder.countTokens(s), 0), 'tokens');
            return;
        }
        const embedded = await encoder.embed(words), vectors = new Map(words.map((s, i) => [s, embedded[i]]));
        const results = pools.map(p => score(p, vectors, encoder));
        const peakMiB = Math.ceil(process.resourceUsage().maxRSS / 1024);
        const data = { input, settings, results, stats: encoder.stats, peakMiB };
        await writeFile(file + '.tmp', gzipSync(JSON.stringify(data)));
        await rename(file + '.tmp', file);
        console.log('batch', index, 'pools', results.length, 'requests', encoder.stats.apiRequests, 'tokens', encoder.stats.apiInputTokens, 'peak MiB', peakMiB);
    } finally { encoder.close(); }
}
let batch = [], index = 0;
for await (const line of createInterface({ input: createReadStream(join(directory, corpus + '.jsonl'), 'utf8'), crlfDelay: Infinity })) {
    batch.push(JSON.parse(line));
    if (batch.length < batchSize) continue;
    if (index >= start) await run(batch, index);
    batch = [];
    if (++index >= stop) break;
}
if (batch.length && index >= start && index < stop) await run(batch, index);
