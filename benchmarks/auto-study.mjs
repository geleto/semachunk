import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkText } from '../src/index.js';
import { alignDocument, cache, here, sha256 } from './corpora.mjs';
import { denseRanker, indexedChunks, split as sentences, vocabulary } from './chunking.mjs';
import { dimension, model, encodingName, openReplay } from './encoder.mjs';
import { markdownCorpora, manifest } from './markdown-corpora.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { meetings } from './semantic-corpora.mjs';
import { qualityTasks, retrieval, segmentation } from './quality.mjs';
import { choose, layoutPolicy, paragraphLengths, rules } from './auto-rules.mjs';

const [phase, output, developmentFile] = process.argv.slice(2);
if (!['development', 'confirmation', 'transfer'].includes(phase) || !output || existsSync(output)) {
    throw new Error('Supply development, confirmation or transfer and a new output path. The last two need the development report.');
}
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const development = phase !== 'development' && read(developmentFile);
const sizes = [250, 500, 1024, 2048], strategies = ['blocks', 'pack', 'semantic'];
const grid = strategies.flatMap(s => sizes.map(n => s + '/' + n));
const primary = 'five512';
const deliveries = [['five512', 5, 512], ['five1024', 5, 1024], ['three512', 3, 512],
    ['any256', Infinity, 256], ['any512', Infinity, 512], ['any1024', Infinity, 1024], ['top5', 5, Infinity]];
const digest = names => sha256(names.map(n => sha256(readFileSync(join(here, n)))).join('/'));
const implementation = digest(['../config.js', ...readdirSync(join(here, '../src')).filter(n => n.endsWith('.js')).sort().map(n => '../src/' + n)]);
const harness = digest(readdirSync(here).filter(n => n.endsWith('.mjs')).sort());
const report = { phase, model, encodingName, implementation, harness, sizes, deliveries, cohorts: [], nominees: development ? development.nominees : {} };
const directory = join(cache, 'auto-study', model, implementation + '-' + harness);
mkdirSync(directory, { recursive: true });

async function measure(split, format, task, dataset) {
    const sample = manifest({ [task]: dataset })[task];
    const fixed = report.nominees[format], checking = Boolean(development);
    const file = join(directory, [phase, split, format, task, fixed ?? 'grid'].join('-').replaceAll('/', '_') + '.json');
    if (existsSync(file)) {
        const saved = read(file);
        assert.equal(saved.sourceSHA256, sample.sourceSHA256);
        assert.equal(saved.annotationsSHA256, sample.annotationsAndPoolsSHA256);
        return saved;
    }
    const groups = dataset.questions.map(q => task === 'hotpotqa' ? q.pooled[0] : q.group);
    const cohort = { split, format, task, sourceSHA256: sample.sourceSHA256, annotationsSHA256: sample.annotationsAndPoolsSHA256,
        documents: sample.documents, questions: sample.questions, groups, rows: {} };
    const arm = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
    const lengths = new Map(dataset.docs.map(d => [d, paragraphLengths(d.source)]));
    const encoder = await openReplay(undefined, undefined, { lengthSafe: true });
    try {
        await prepareDataset(dataset, encoder);
        const controls = phase === 'transfer' ? [...new Set([fixed, format === 'markdown' ? 'pack/500' : 'semantic/500',
            format === 'markdown' ? 'pack/1024' : 'semantic/500'])] : grid;
        for (const name of [...controls, 'public', ...(checking ? rules : [])]) {
            const choices = {}, picked = new Map();
            const select = rules.includes(name) ? doc => {
                const layout = choose(name, lengths.get(doc), fixed);
                choices[layout] = (choices[layout] ?? 0) + 1;
                picked.set(doc, layout);
                return layoutPolicy(format, layout);
            } : undefined;
            const row = await evaluate(task, dataset, layoutPolicy(format, select ? fixed : name), encoder,
                phase === 'confirmation' ? 'baselines' : 'semantic', { deliveries, select });
            const { bodyHash, embeddedTokens, indexTexts } = row;
            const scores = {};
            for (const [ranker, profiles] of Object.entries(row.retrieval)) {
                scores[ranker] = Object.fromEntries(Object.entries(profiles).map(([p, v]) =>
                    [p, task === 'qmsum' ? v.recall : v.complete / groups.length]));
            }
            const affected = select && dataset.questions.map(q => {
                const pool = task === 'hotpotqa' ? q.pooled : q.pool;
                return Number(pool.some(i => picked.get(dataset.docs[i]) !== fixed));
            }).join('');
            cohort.rows[name] = { bodyHash, embeddedTokens, indexTexts, scores,
                primary: (task === 'qmsum' ? row.recalls : row.hits)[arm][primary], ...(select && { choices, affected }) };
        }
        console.log(split, format, task, groups.length, 'questions', encoder.stats.apiInputTokens, 'new embedding tokens');
    } finally { encoder.close(); }
    writeFileSync(file, JSON.stringify(cohort), { flag: 'wx' });
    return cohort;
}

// Give each task equal weight. Within a task, pair questions on their source and
// keep whole multi-hop pools together. IDs for a pool are local to each split.
function compare(cohorts, name, control) {
    const tasks = [...new Set(cohorts.map(c => c.task))], groups = [];
    let score = 0, base = 0, embeddedTokens = 0;
    const perTask = {};
    for (const task of tasks) {
        const sources = [];
        let sum = 0, other = 0, count = 0;
        for (const c of cohorts.filter(c => c.task === task)) {
            const a = c.rows[name], b = c.rows[control], bySource = new Map();
            embeddedTokens += a.embeddedTokens;
            c.groups.forEach((id, i) => {
                const x = Number(a.primary[i]), y = Number(b.primary[i]);
                const pair = bySource.get(id) ?? [0, 0];
                pair[0] += x - y; pair[1]++;
                bySource.set(id, pair);
                sum += x; other += y; count++;
            });
            sources.push(...bySource.values());
        }
        groups.push(sources);
        perTask[task] = 100 * (sum - other) / count;
        score += 100 * sum / count / tasks.length;
        base += 100 * other / count / tasks.length;
    }
    return { score, deltaPoints: score - base, embeddedTokens, perTask,
        ...(development && { interval: groupInterval(groups, rules.includes(name) ? 1 - 0.05 / rules.length : 0.95) }) };
}

async function quality(task) {
    const originals = (await qualityTasks[task]()).filter(d => d.split === 'heldout');
    const docs = await Promise.all(originals.map(async d => ({ ...alignDocument(d, await sentences(chunkText, d.text)),
        raw: d.text, lengths: paragraphLengths(d.text) })));
    const fixed = report.nominees.text, rows = {}, vocab = vocabulary();
    const encoder = await openReplay();
    try {
        for (const name of [...(phase === 'transfer' ? new Set([fixed, 'semantic/500', 'pack/250']) : grid), 'public', ...rules]) {
            rows[name] = await Promise.all(docs.map(async d => {
                const key = rules.includes(name) ? choose(name, d.lengths, fixed) : name;
                const { chunkingStrategy, chars } = layoutPolicy('text', key);
                const chunks = await chunkText(d.raw, encoder.embed, { chunkingStrategy, maxChunkSize: chars, returnEmbedding: false });
                return { ids: chunks.map(c => vocab.intern(c.text)) };
            }));
        }
        for (const d of docs) for (const [query] of d.questions ?? []) vocab.intern(query);
        let rank, ends;
        if (task === 'squad') {
            const vectors = await encoder.embed(vocab.texts), matrix = new Float32Array(vectors.length * dimension);
            vectors.forEach((v, i) => matrix.set(v, i * dimension));
            rank = denseRanker(matrix);
            ends = new Map(vocab.texts.map((s, i) => [i, encoder.offsets(s).map(o => o[2])]));
        }
        return Object.fromEntries(Object.entries(rows).map(([name, byDoc]) => {
            const chunks = indexedChunks(docs, byDoc, vocab.texts);
            return [name, task === 'squad' ? retrieval(docs, chunks, vocab, rank, ends) : segmentation(docs, chunks)];
        }));
    } finally { encoder.close(); }
}

const splits = development ? ['auto-test'] : ['modes-a', 'modes-b'];
const historical = read(join(here, 'results/2026-11-23-markdown-samples.json'));
for (const split of splits) {
    for (const [task, dataset] of Object.entries(await markdownCorpora(split))) {
        const sample = manifest({ [task]: dataset })[task];
        if (development) {
            const previous = [...Object.values(historical).map(s => s[task]), ...development.cohorts.filter(c => c.task === task)];
            for (const field of ['documents', 'questions']) {
                const seen = new Set(previous.flatMap(s => s[field]));
                assert.ok(sample[field].every(id => !seen.has(id)), 'Overlapping ' + task + ' ' + field);
            }
        }
        for (const format of ['markdown', 'text']) {
            // The evaluator annotates documents and questions in place.
            report.cohorts.push(await measure(split, format, task, structuredClone(dataset)));
        }
    }
}
const meetingSplit = development ? 'val' : 'test';
const meetingData = await meetings(meetingSplit);
if (development) {
    const seen = new Set((await meetings()).docs.map(d => sha256(d.source)));
    assert.ok(meetingData.docs.every(d => !seen.has(sha256(d.source))), 'Overlapping meeting transcript');
}
report.cohorts.push(await measure('qmsum-' + meetingSplit, 'text', 'qmsum', meetingData));
report.comparisons = {};
for (const format of ['markdown', 'text', 'meetings']) {
    const cohorts = report.cohorts.filter(c => format === 'meetings' ? c.task === 'qmsum' : c.format === format && c.task !== 'qmsum');
    const baseline = format === 'markdown' ? 'pack/500' : 'semantic/500';
    const gridScores = Object.fromEntries(grid.filter(name => cohorts[0].rows[name]).map(name => [name, compare(cohorts, name, baseline)]));
    const best = Math.max(...Object.values(gridScores).map(r => r.score));
    if (!development && format !== 'meetings') report.nominees[format] = grid.filter(n => gridScores[n].score >= best - 1)
        .sort((a, b) => gridScores[a].embeddedTokens - gridScores[b].embeddedTokens || gridScores[b].score - gridScores[a].score)[0];
    const fixed = report.nominees[format === 'meetings' ? 'text' : format];
    report.comparisons[format] = { grid: gridScores, fixed, public: compare(cohorts, 'public', baseline),
        ...(development && { rules: Object.fromEntries(rules.map(name => [name, compare(cohorts, name, fixed)])) }) };
}
if (development) {
    report.quality = {};
    for (const task of Object.keys(qualityTasks)) report.quality[task] = await quality(task);
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log('Fixed choices', report.nominees);
