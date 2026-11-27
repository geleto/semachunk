import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here } from './corpora.mjs';
import { encodingName, model, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora, unusedMarkdownCorpora } from './markdown-corpora.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { parsedMarkdown } from './markdown-index.mjs';
import { flattenCorpus, meetings } from './semantic-corpora.mjs';
import { choose, layoutPolicy, paragraphLengths, rules } from './auto-rules.mjs';

const [output, developmentFile, scope] = process.argv.slice(2);
if (!output || !developmentFile || existsSync(output)) throw new Error('Supply a new output path and the development report.');
if (scope && !['limits', 'unused'].includes(scope)) throw new Error('The optional scope is limits or unused.');
const read = name => JSON.parse(readFileSync(join(here, 'results', name + '.json'), 'utf8'));
const samples = read('2026-11-23-markdown-samples'), references = read('2026-11-23-semantic-formatting');
const development = JSON.parse(readFileSync(developmentFile, 'utf8')), { nominees } = development;
if (!scope) assert.equal(model, references.model);
const report = { model, encodingName, scope: scope ?? 'history', deliveredTokens: [256, 512, 1024], cohorts: [] };
const deliveries = [...report.deliveredTokens.map(n => [n, Infinity, n]), ['five512', 5, 512], ['five1024', 5, 1024]];
report.deliveries = deliveries;
function scores(row, task, names = report.deliveredTokens) {
    const profiles = row.retrieval[task === 'hotpotqa' ? 'pooled/dense' : 'document/dense'];
    return Object.fromEntries(names.map(n => [n, task === 'qmsum' ? profiles[n].recall : profiles[n].complete / row.questions]));
}

function comparisonPolicies(format, split, view, external) {
    const current = layoutPolicy(format), { method } = current;
    const choices = { default: current, former: layoutPolicy(format, format === 'markdown' ? 'pack/500' : 'semantic/500') };
    if (scope === 'unused') return { ...choices, 'pack/2048': layoutPolicy(format, 'pack/2048') };
    choices.fixed = layoutPolicy(format, nominees[format]);
    if (scope === 'limits') {
        for (const strategy of ['blocks', 'pack', 'semantic']) choices[strategy + '/c1024'] = layoutPolicy(format, strategy + '/1024');
        choices.structure = choices.fixed;
    }
    if (external) for (const name of rules) choices[name] = choices.fixed;
    for (const tokens of external && view === 'original' ? [128, 256, 512] : [256]) {
        choices['default/t' + tokens] = { method, tokens };
        for (const chunkingStrategy of ['blocks', 'pack', 'semantic']) {
            choices[chunkingStrategy + '/t' + tokens] = { method, chunkingStrategy, tokens };
        }
        choices['default/default-chars/t' + tokens] = { method, chars: null, tokens };
    }
    if (format === 'markdown' && view === 'original' && ['replication', 'auto-test'].includes(split)) {
        for (const tokens of [256, 512]) {
            choices['default/default-chars/t' + tokens] = { method, chars: null, tokens };
            for (const chunkingStrategy of ['blocks', 'pack', 'semantic']) {
                choices[chunkingStrategy + '/c1024/t' + tokens] = { method, chunkingStrategy, chars: 1024, tokens };
            }
        }
    }
    return choices;
}

async function measure(split, view, task, data, formats, external) {
    const sample = manifest({ [task]: data })[task], ref = references.samples[task];
    const cohort = { split, view, task, questions: sample.questions.length, sourceSHA256: sample.sourceSHA256, rows: {} };
    if (scope === 'unused') Object.assign(cohort, { documents: sample.documents, questionIds: sample.questions,
        groups: data.questions.map(q => task === 'hotpotqa' ? q.pooled[0] : q.group) });
    if (external) {
        assert.equal(sample.sourceSHA256, ref[view].sourceSHA256);
        assert.equal(sample.annotationsAndPoolsSHA256, ref[view].annotationsAndPoolsSHA256);
        assert.deepEqual(sample.questions, ref.questions);
        cohort.published = {};
        for (const name of ['recursive', 'recursive-zero', 'semantic-default', 'semantic-count', 'semantic-capped']) {
            const row = references.runs[view + '/' + name][task];
            cohort.published[name] = { bodyHash: row.bodyHash, scores: scores(row, task), embeddedTokens: row.embeddedTokens };
        }
    }
    const encoder = await openReplay(undefined, undefined, { lengthSafe: true });
    try {
        await prepareDataset(data, encoder);
        for (const format of formats) {
            const policies = comparisonPolicies(format, split, view, external);
            const rows = cohort.rows[format] = {};
            for (const [name, p] of Object.entries(policies)) {
                let select;
                if (rules.includes(name)) select = doc => layoutPolicy(format, choose(name, paragraphLengths(doc.source), nominees[format]));
                if (name === 'structure') select = doc => {
                    const units = parsedMarkdown(doc, 1024, Infinity);
                    return layoutPolicy(format, units.some(u => u.sectionId !== null || u.kind !== 'prose') ? 'blocks/1024' : 'semantic/1024');
                };
                const row = await evaluate(task, data, p, encoder, 'semantic', { deliveries, select });
                rows[name] = { bodyHash: row.bodyHash, embeddedTokens: row.embeddedTokens, scores: scores(row, task, deliveries.map(p => p[0])) };
                if (scope === 'unused') rows[name].hits = row.hits[task === 'hotpotqa' ? 'pooled/dense' : 'document/dense'].five512;
                if (p.tokens) assert.equal(row.overTarget, 0);
            }
        }
        if (external) {
            const row = await evaluate(task, data, { method: 'recursive', overlap: 0, tokens: 256 }, encoder, 'semantic', { deliveries });
            assert.equal(row.bodyHash, cohort.published['recursive-zero'].bodyHash);
            assert.deepEqual(scores(row, task), cohort.published['recursive-zero'].scores);
        }
    } finally { encoder.close(); }
    report.cohorts.push(cohort);
    console.log(split, view, task);
}

async function unused() {
    const sets = Object.fromEntries(['cuad', 'qasper', 'finqa', 'hotpotqa'].map(task => [task, new Set()]));
    const prior = read('2026-11-24-retrieval-budget-cutoffs');
    const history = [...Object.values(samples), read('2026-11-23-node-rag').tasks, ...prior.calibration.samples,
        ...prior.confirmation, ...read('2026-11-24-centroid-fresh-confirmation').results.fresh.refs];
    for (const cohort of history) for (const [task, ids] of Object.entries(sets)) {
        for (const id of cohort[task]?.documents ?? []) ids.add(id);
    }
    for (const cohort of [...development.cohorts, ...read('2026-11-24-auto-transfer').cohorts]) {
        if (cohort.format === 'markdown') for (const id of cohort.documents) sets[cohort.task].add(id);
    }
    const data = await unusedMarkdownCorpora(sets);
    for (const [task, dataset] of Object.entries(data)) assert.ok(dataset.docs.every(d => !sets[task].has(d.id)));
    return data;
}

for (const split of scope ? [scope === 'unused' ? 'unused' : 'auto-test'] : [...Object.keys(samples), 'auto-test', 'qmsum']) {
    const data = split === 'qmsum' ? { qmsum: await meetings() } : split === 'unused' ? await unused() : await markdownCorpora(split);
    if (samples[split]) assert.deepEqual(manifest(data), samples[split]);
    const external = split === 'replication' || split === 'qmsum';
    for (const [task, dataset] of Object.entries(data)) {
        const flat = external && flattenCorpus(dataset);
        await measure(split, 'original', task, dataset, external ? ['text', 'markdown'] : ['markdown'], external);
        if (flat) await measure(split, 'flat', task, flat, ['text', 'markdown'], true);
    }
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
