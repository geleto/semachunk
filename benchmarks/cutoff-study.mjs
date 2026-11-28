import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { assets, here, sha256 } from './corpora.mjs';
import { dimension, model, openEncoder } from './encoder.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { budgets, evaluateRag, ragTasks } from './rag.mjs';

const tasks = Object.keys(ragTasks);
const grid = [-1, ...Array.from({ length: 21 }, (_, i) => i / 20)];
const target = 500;
const seed = 'semachunk-fulltext-budget-v1/';
const rowId = { cuad: row => row.title, qasper: row => row[0], hotpotqa: row => row._id };
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, result) => writeFile(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
const historical = await read(join(here, 'results/2026-11-24-centroid-settings.json'));
const markdown = await read(join(here, 'results/2026-11-23-markdown-samples.json'));
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;

function previouslyScored(task) {
    const prior = [historical.calibration[task], historical.validation[task], ...Object.values(markdown).map(s => s[task])];
    return { sources: new Set(prior.flatMap(s => s.documents)), questions: new Set(prior.flatMap(s => s.questionIds ?? s.questions)) };
}

function freshSample(task, shard) {
    const { sources, questions } = previouslyScored(task);
    const id = rowId[task];
    return ragTasks[task](rows => {
        const sorted = rows.map(row => [sha256(seed + id(row)), row])
            .sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
        if (task !== 'hotpotqa') {
            const count = task === 'cuad' ? 24 : 48;
            const chosen = sorted.filter(row => !sources.has(id(row))).slice(0, count);
            assert.equal(chosen.length, count);
            return chosen.filter((_, i) => i % 2 === shard);
        }
        const chosen = [];
        for (const kind of ['bridge', 'comparison']) {
            let n = 0;
            for (const row of sorted) {
                if (row.type !== kind || questions.has(row._id) || row.context.some(([title]) => sources.has(title))) continue;
                for (const [title] of row.context) sources.add(title);
                if (n % 2 === shard) chosen.push(row);
                if (++n === 64) break;
            }
            assert.equal(n, 64);
        }
        return chosen;
    });
}

async function evaluate(task, sample, cutoffs, { reference, original = false } = {}) {
    const plans = Object.fromEntries(cutoffs.map(t => [t, { maxChunkSize: target, combineChunksSimilarityThreshold: t }]));
    plans.pack = { pack: true, maxChunkSize: target };
    // Reconstruct the historical matrix's vocabulary, including its two extra controls.
    if (original) {
        plans.flat = { flatInput: true, maxChunkSize: target };
        plans.tokenLimit = { maxChunkTokens: 256, maxChunkSize: target };
    }
    const encoder = openEncoder();
    try {
        const run = await evaluateRag(task, chunkText, encoder, plans, { sample, paired: !reference });
        const { documents, questionIds, exclusions, distinctTexts, textsSHA256, vectorsSHA256, precomputation } = run;
        const groups = sample.questions.map(q => task === 'hotpotqa' ? q.id : documents[q.pool[0]]);
        const rows = {};
        for (const id of [...cutoffs, 'pack']) {
            const row = run.scores[id], scores = (row.pooledRetrieval ?? row.retrieval).dense;
            rows[id] = { chunks: row.chunks, calls: row.providerCalls, inputs: row.providerTexts, tokens: row.providerTokens,
                complete: budgets.map(b => scores[b].complete) };
            if (!reference) rows[id].completeIndices = budgets.map(b => (scores[b].completeIndices ?? []).sort((a, b) => a - b));
        }
        if (reference) {
            assert.deepEqual(documents, reference.documents);
            assert.deepEqual(questionIds, reference.questionIds);
            assert.deepEqual([textsSHA256, vectorsSHA256], [reference.textsSHA256, reference.vectorsSHA256]);
            const control = reference.rows['off/full/0.5'];
            assert.deepEqual(rows[0.5].complete, control.dense);
            assert.equal(rows[0.5].tokens, control.tokens);
        }
        console.log(task, documents.length, 'sources,', questionIds.length, 'questions,', precomputation.apiInputTokens, 'new embedding tokens');
        return { documents, questionIds, groups, exclusions, distinctTexts, textsSHA256, vectorsSHA256, precomputation, rows };
    } finally { encoder.close(); }
}

// Pool questions within each task, then give the three tasks equal weight.
function summarize(samples, policy) {
    const scores = budgets.map((_, i) => 100 * mean(tasks.map(task => {
        const count = samples.reduce((n, s) => n + s[task].rows[policy[i]].complete[i], 0);
        return count / samples.reduce((n, s) => n + s[task].questionIds.length, 0);
    })));
    const indexes = [...new Set(policy)], cost = { chunks: 0, calls: 0, inputs: 0, tokens: 0 };
    for (const sample of samples) for (const task of tasks) for (const id of indexes) {
        for (const k of Object.keys(cost)) cost[k] += sample[task].rows[id][k];
    }
    return { scores, average: mean(scores), indexes, cost };
}

const fixed = id => budgets.map(() => id);
function select(samples) {
    const curve = Object.fromEntries([...grid, 'pack'].map(id => [id, summarize(samples, fixed(id))]));
    function best(score) {
        return grid.toSorted((a, b) => score(curve[b]) - score(curve[a]) || curve[a].cost.tokens - curve[b].cost.tokens ||
            Math.abs(a - 0.5) - Math.abs(b - 0.5))[0];
    }
    const shared = best(r => r.average), byBudget = budgets.map((_, i) => best(r => r.scores[i]));
    return { shared, byBudget, curve };
}

function compare(samples, policy, control, columns) {
    const clusters = [], perTask = {};
    for (const task of tasks) {
        const groups = new Map();
        let wins = 0, losses = 0, outcomes = 0;
        for (const sample of samples) {
            const data = sample[task];
            for (const i of columns) {
                const a = new Set(data.rows[policy[i]].completeIndices[i]), b = new Set(data.rows[control[i]].completeIndices[i]);
                data.groups.forEach((group, q) => {
                    if (!groups.has(group)) groups.set(group, [0, 0]);
                    const pair = groups.get(group), diff = Number(a.has(q)) - Number(b.has(q));
                    pair[0] += diff;
                    pair[1]++;
                    wins += Number(diff === 1);
                    losses += Number(diff === -1);
                    outcomes++;
                });
            }
        }
        perTask[task] = { wins, losses, outcomes };
        clusters.push([...groups.values()]);
    }
    return { delta: 100 * mean(Object.values(perTask).map(r => (r.wins - r.losses) / r.outcomes)),
        ci95: groupInterval(clusters), perTask };
}

const [stage, lockPath, output] = process.argv.slice(2);
if (stage === 'calibrate' && lockPath) {
    const samples = [];
    for (const split of ['calibration', 'validation']) {
        const cohort = {};
        for (const task of tasks) {
            const reference = historical[split][task], original = split === 'calibration';
            const ids = task === 'hotpotqa' ? reference.questionIds : reference.documents;
            const sample = original ? await ragTasks[task]() : await ragTasks[task](rows => {
                const byId = new Map(rows.map(row => [rowId[task](row), row]));
                return ids.map(id => byId.get(id));
            });
            cohort[task] = await evaluate(task, sample, grid, { reference, original });
        }
        samples.push(cohort);
    }
    const selection = select(samples);
    await save(lockPath, { samples, selection });
    console.log('Frozen cutoffs', selection.byBudget, 'shared', selection.shared);
} else if (stage === 'confirm' && lockPath && output) {
    const calibration = await read(lockPath);
    assert.deepEqual(calibration.selection, select(calibration.samples));
    const { shared, byBudget } = calibration.selection;
    const policies = { byBudget, shared: fixed(shared), default: fixed(0.5), pack: fixed('pack') };
    const cutoffs = [...new Set([...byBudget, shared, 0.5])];
    const confirmation = [{}, {}];
    for (const task of tasks) {
        const { sources, questions } = previouslyScored(task);
        for (const [shard, cohort] of confirmation.entries()) {
            const data = await freshSample(task, shard);
            for (const [set, values] of [[sources, data.docs.map(d => d.title)], [questions, data.questions.map(q => q.id)]]) {
                for (const id of values) { assert.ok(!set.has(id), 'Reused ' + id); set.add(id); }
            }
            cohort[task] = await evaluate(task, data, cutoffs);
        }
    }
    const comparisons = {};
    for (const [a, b] of [['byBudget', 'shared'], ['shared', 'default'], ['byBudget', 'default'], ['shared', 'pack']]) {
        comparisons[a + 'Vs' + b] = Object.fromEntries([...budgets, 'average'].map((key, i) => [key,
            compare(confirmation, policies[a], policies[b], i === budgets.length ? budgets.map((_, j) => j) : [i])]));
    }
    const summaries = Object.fromEntries(Object.entries(policies).map(([k, p]) => [k, summarize(confirmation, p)]));
    await save(output, { model, dimension, node: process.version, targetUTF16: target, budgets, grid, seed,
        dataSHA256: Object.fromEntries(tasks.map(t => [t, assets[t].checksum])),
        calibrationSHA256: sha256(await readFile(lockPath)), calibration, confirmation, summaries, comparisons });
    console.log(JSON.stringify(summaries));
} else throw new Error('Use calibrate LOCK.json or confirm LOCK.json RESULT.json.');
