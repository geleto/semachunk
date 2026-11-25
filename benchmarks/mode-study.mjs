import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownText } from '../src/markdown.js';
import { packMarkdown } from '../src/markdown-merge.js';
import { tokenBudget } from '../src/token-limit.js';
import { here, sha256 } from './corpora.mjs';
import { encodingName, model, openReplay } from './encoder.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { prepareDataset, evaluate } from './markdown-evaluation.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { parsedMarkdown } from './markdown-index.mjs';

const deliveries = [['five512', 5, 512], ['three512', 3, 512], ['five1024', 5, 1024], [512, Infinity, 512], ['top5', 5, Infinity]];
const caps = [256, 512], tasks = ['cuad', 'qasper', 'finqa', 'hotpotqa'];
const fixed = ['units', 'pack', 'semantic'], candidates = ['tight', 'target', 'switch', 'structure'];
const controls = ['pack-overlap', 'recursive', 'recursive-capped'];
const splitNames = ['replication', 'modes-a', 'modes-b'], primary = deliveries[0][0];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new JSON result path.');
const history = read(join(here, 'results/2026-11-23-markdown-samples.json'));
const review = read(join(here, 'results/2026-11-24-markdown-review.json'));
const report = { model, encodingName, node: process.version, caps, deliveries: deliveries.map(([name, k, tokens]) =>
    ({ name, maxHits: k === Infinity ? null : k, tokenBudget: tokens === Infinity ? null : tokens })), splits: {} };

// The two delivery limits are supplied by the caller. A token-only retriever
// can take more original units. A hit-only retriever can deliver whole packed hits.
function layoutFor(mode, [, k, tokens]) {
    if (!['tight', 'target', 'switch'].includes(mode)) return mode;
    if (k === Infinity) return 'units';
    if (tokens === Infinity) return 'pack';
    return mode + '/' + Math.floor(tokens / k);
}

const layouts = new Set([...fixed, ...controls, ...candidates].flatMap(mode => deliveries.map(p => layoutFor(mode, p))));

async function measureTask(split, task, dataset, encoder) {
    await prepareDataset(dataset, encoder);
    const ranker = (task === 'hotpotqa' ? 'pooled' : 'document') + '/dense';
    const result = {};
    for (const cap of caps) {
        const features = new Map(), rows = result[cap] = {};
        const markdown = { method: 'public-markdown', tokens: cap };
        const policies = { units: { ...markdown, chunkingStrategy: 'blocks' }, semantic: { ...markdown, chunkingStrategy: 'semantic' },
            pack: { ...markdown, chunkingStrategy: 'pack' }, 'pack-overlap': { ...markdown, chunkingStrategy: 'pack', chunkOverlap: cap / 4 },
            recursive: { method: 'recursive', overlap: 0, tokens: cap },
            'recursive-capped': { method: 'recursive', overlap: 0, tokens: cap, cap: true } };
        for (const doc of dataset.docs) {
            const fits = tokenBudget(cap, encoder.countTokens, doc.chunkPrefix?.trim() ? doc.chunkPrefix + ': ' : '');
            const units = parsedMarkdown(doc, Infinity, cap, fits);
            const mean = list => list.reduce((sum, u) => sum + encoder.countTokens(markdownText(doc.source, u)), 0) / Math.max(1, list.length);
            const packed = packMarkdown(doc.source, units, Infinity, fits);
            features.set(doc, { unitMean: mean(units), packMean: mean(packed),
                structure: units.some(u => u.sectionId !== null || u.kind !== 'prose') });
        }
        for (const layout of layouts) {
            const [name, target] = layout.split('/'), size = Number(target);
            let policy = policies[name], select;
            const choices = {};
            if (name === 'tight') policy = { method: 'public-markdown', tokens: Math.min(cap, size) };
            if (name === 'target') policy = { method: 'pack', tokens: cap, packTarget: size };
            if (name === 'structure' || name === 'switch') {
                policy = policies.semantic;
                select = doc => {
                    const f = features.get(doc);
                    const choice = name === 'structure' ? (f.structure ? 'units' : 'semantic') :
                        f.unitMean >= size ? 'units' : f.packMean <= size ? 'pack' : 'semantic';
                    choices[choice] = (choices[choice] ?? 0) + 1;
                    return policies[choice];
                };
            }
            const row = await evaluate(task, dataset, policy, encoder, 'semantic', { deliveries, select });
            const { bodyHash, embeddedTokens, calls, indexTexts, overTarget } = row;
            const measurements = {};
            for (const [profile] of deliveries) {
                const { complete, deliveredTokens } = row.retrieval[ranker][profile];
                measurements[profile] = { complete, deliveredTokens, hits: row.hits[ranker][profile] };
            }
            rows[layout] = { bodyHash, embeddedTokens, calls, indexTexts, overTarget, ...(select && { choices }), measurements };
            if (name === 'recursive-capped' || name === 'pack-overlap') assert.equal(overTarget, 0);
            if (split === 'replication' && fixed.includes(name)) {
                const oldKey = { units: 'children', pack: 'pack', semantic: 'frozen' }[name] + '/t' + cap;
                const old = review.updated.policies[oldKey].tasks[task];
                assert.equal(bodyHash, old.bodyHash);
                assert.equal(measurements[512].hits, old.complete512);
                assert.equal(measurements.top5.complete, old.retrieval.top5.complete);
            }
        }
        console.log(split, task, cap, 'complete');
    }
    return result;
}

function meanScore(split, name, profile) {
    let score = 0, tokens = 0;
    for (const task of tasks) for (const cap of caps) {
        const row = split.tasks[task][cap][layoutFor(name, profile)];
        score += row.measurements[profile[0]].complete / split.groups[task].length;
        tokens += row.embeddedTokens;
    }
    return { score: 100 * score / (tasks.length * caps.length), tokens };
}

function nominee(choices, split) {
    return choices.map(name => ({ name, ...meanScore(split, name, deliveries[0]) }))
        .sort((a, b) => b.score - a.score || a.tokens - b.tokens)[0].name;
}

// Pair both body caps for a question and resample complete source groups.
function compare(name, control, splits, profile, sizes = caps, adjusted = false) {
    const groups = [], means = [];
    for (const task of tasks) {
        const sources = [];
        let total = 0, count = 0;
        for (const split of splits) {
            const byGroup = new Map();
            const hits = mode => sizes.map(cap => split.tasks[task][cap][layoutFor(mode, profile)].measurements[profile[0]].hits);
            const a = hits(name), b = hits(control);
            split.groups[task].forEach((id, i) => {
                const d = a.reduce((sum, str, j) => sum + Number(str[i]) - Number(b[j][i]), 0) / sizes.length;
                const pair = byGroup.get(id) ?? [0, 0];
                pair[0] += d; pair[1]++;
                byGroup.set(id, pair);
                total += d; count++;
            });
            sources.push(...byGroup.values());
        }
        groups.push(sources);
        means.push(total / count);
    }
    return { deltaPoints: 100 * means.reduce((a, b) => a + b) / tasks.length, ci95: groupInterval(groups),
        ...(adjusted && { ci97_5: groupInterval(groups, 0.975) }) };
}

const seen = Object.fromEntries(tasks.map(t => [t, new Set(Object.values(history).flatMap(s => s[t].documents))]));
const seenQueries = new Set(Object.values(history).flatMap(s => tasks.flatMap(t => s[t].questions)));
for (const name of splitNames) {
    const data = await markdownCorpora(name), sample = manifest(data);
    if (name === 'replication') assert.deepEqual(sample, history.replication);
    else for (const task of tasks) {
        for (const id of sample[task].documents) { assert.ok(!seen[task].has(id), id); seen[task].add(id); }
        for (const id of sample[task].questions) { assert.ok(!seenQueries.has(id), id); seenQueries.add(id); }
    }
    const split = report.splits[name] = { samplesSHA256: sha256(JSON.stringify(sample)), questions: {}, groups: {}, tasks: {} };
    const encoder = await openReplay();
    try {
        for (const task of tasks) {
            const { questions } = data[task];
            split.questions[task] = questions.map(q => q.id);
            split.groups[task] = questions.map(q => task === 'hotpotqa' ? q.pooled[0] : q.group);
            split.tasks[task] = await measureTask(name, task, data[task], encoder);
            delete data[task];
        }
        split.provider = { ...encoder.stats };
    } finally { encoder.close(); }
    if (name === 'replication') {
        const baseline = meanScore(split, 'semantic', deliveries[0]);
        const cheaper = candidates.filter(name => {
            const result = meanScore(split, name, deliveries[0]);
            return result.tokens <= 0.85 * baseline.tokens && result.score >= baseline.score - 1;
        });
        report.nominees = { fixed: nominee(fixed, split), rule: nominee(candidates, split),
            cost: cheaper.length ? nominee(cheaper, split) : null };
        console.log('Frozen development nominees', report.nominees);
    }
}
const fresh = splitNames.slice(1).map(n => report.splits[n]);
report.confirmation = {};
for (const profile of deliveries) {
    const comparisons = report.confirmation[profile[0]] = {};
    for (const name of [...fixed, ...controls, ...candidates]) {
        comparisons[name] = {};
        const baselines = new Set(['semantic', report.nominees.fixed]);
        if (name === 'pack-overlap') baselines.add('pack');
        for (const control of baselines) {
            const decision = profile[0] === primary && [report.nominees.rule, report.nominees.cost].includes(name);
            comparisons[name][control] = compare(name, control, fresh, profile, caps, decision);
            if (decision) comparisons[name][control].byWave = fresh.map(split => compare(name, control, [split], profile));
            if (decision || (profile[0] === 512 && name === 'units')) {
                comparisons[name][control].byCap = caps.map(cap => compare(name, control, fresh, profile, [cap]));
            }
        }
    }
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
