import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { sha256 } from './corpora.mjs';
import { dimension, encodingName, model, modelInputTokens, openReplay } from './encoder.mjs';
import { studyRules } from './markdown-rules.mjs';
import { macro, paired, selectCombination } from './markdown-decisions.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { budgets } from './rag.mjs';
import { compareRetrieval } from './retrieval-baselines.mjs';
import { prepareDataset, evaluate } from './markdown-evaluation.mjs';

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const [experiment, output, previous, candidate] = process.argv.slice(2);
const ruleStudy = ['rules', 'validate-rules', 'replicate-rules'].includes(experiment);
const baselines = experiment === 'baselines';
const split = ({ 'validate-rules': 'rules-test', 'replicate-rules': 'replication', baselines: 'replication', confirm: 'confirmation', final: 'final' })[experiment] ?? 'calibration';
if (!output || (!ruleStudy && !baselines && !['size', 'compare', 'context', 'final', 'confirm'].includes(experiment))) {
    throw new Error('Supply a Markdown study experiment and a new JSON output path.');
}
if (existsSync(output)) throw new Error('Result already exists: ' + output);
const prior = previous ? await read(previous) : {};
const data = await markdownCorpora(split), samples = manifest(data);
const frozen = await read(new URL('./results/2026-11-23-markdown-samples.json', import.meta.url));
assert.deepEqual(samples, frozen[split]);
const encoder = await openReplay();
const report = { experiment, split, samplesSHA256: sha256(JSON.stringify(samples)), metric: 'literal-context-v1',
    model, dimension, encodingName, budgets, node: process.version, startedUTC: new Date().toISOString(), policies: {} };
const tasks = Object.keys(data);

async function run(name, policy, subset = tasks) {
    const row = { policy, tasks: {} };
    for (const task of subset) row.tasks[task] = await evaluate(task, data[task], policy, encoder, ruleStudy ? 'rules' : experiment);
    if (subset.length === tasks.length) row.macroComplete512 = macro(row);
    report.policies[name] = row;
    console.log(name, row.macroComplete512 ?? subset, encoder.stats.apiRequests, 'paid requests so far');
    return row;
}

async function main() {
    for (const dataset of Object.values(data)) await prepareDataset(dataset, encoder, baselines || experiment === 'size' || experiment === 'final');
    if (baselines) return compareRetrieval(report, data, run);
    if (ruleStudy) return studyRules({ report, prior, data, run, validation: experiment !== 'rules' });
    const tokens = prior.tokens;
    if (experiment === 'size') {
        for (const size of [128, 256, 512]) await run('plain-' + size, { method: 'plain-pack', tokens: size });
        const best = Object.values(report.policies).sort((a, b) => macro(b) - macro(a) || b.policy.tokens - a.policy.tokens)[0];
        report.tokens = best.policy.tokens;
        return;
    }
    if (![128, 256, 512].includes(tokens)) throw new Error('Previous report is missing the selected token budget');
    report.tokens = tokens;
    const pack = { method: 'pack', tokens };
    if (experiment === 'compare') {
        await run('pack', pack);
        for (const method of ['fixed', 'rescore']) {
            const names = [];
            for (const cutoff of [0.3, 0.5, 0.7, 'document']) {
                const name = method + '-' + cutoff;
                await run(name, { method, tokens, ...(cutoff === 'document' ? { adaptive: true } : { cutoff }) });
                names.push(name);
            }
            const best = names.sort((a, b) => macro(report.policies[b]) - macro(report.policies[a]))[0];
            report[method] = best;
        }
        for (const name of ['pack', report.fixed, report.rescore]) {
            await run(name + '-lead', { ...report.policies[name].policy, leadIn: true });
        }
        selectCombination(report, data);
        await run('sentence-units', { ...report.winner, sentences: true }, ['qasper']);
        return;
    }
    assert.ok(prior.winner && prior.shortlist, 'Previous report is missing the calibration shortlist');
    report.winner = candidate ? prior.shortlist[candidate] : prior.winner;
    assert.ok(report.winner, 'Select a candidate from the frozen shortlist');
    report.shortlist = { ...prior.shortlist };
    if (experiment === 'confirm') {
        assert.ok(candidate && report.winner.method === 'fixed');
        for (const size of [{ chars: 500 }, { tokens }]) {
            const suffix = size.chars ? '-chars' : '-tokens';
            const base = await run('pack' + suffix, { method: 'pack', ...size });
            const adaptive = await run('fixed-document' + suffix, { method: 'fixed', adaptive: true, ...size });
            report.comparisons ??= {};
            report.comparisons['adaptive' + suffix] = paired(adaptive, base, data);
            if (size.chars) {
                const fixed = await run('fixed-0.5-chars', { method: 'fixed', cutoff: 0.5, ...size });
                report.comparisons['fixed-0.5-chars'] = paired(fixed, base, data);
            }
        }
        return;
    }
    if (experiment === 'context') {
        const base = await run('baseline', report.winner);
        const frozenWinner = Object.values(prior.policies).find(r => JSON.stringify(r.policy) === JSON.stringify(report.winner));
        for (const t of tasks) assert.equal(base.tasks[t].bodyHash, frozenWinner.tasks[t].bodyHash);
        report.comparisons = {};
        for (const cap of [tokens, modelInputTokens]) {
            let control = base;
            for (const context of ['title', 'headings']) {
                const name = context + '-' + cap;
                const row = await run(name, { ...report.winner, context, contextCap: cap });
                for (const t of tasks) {
                    assert.equal(row.tasks[t].bodyHash, base.tasks[t].bodyHash);
                    for (const key of Object.keys(base.tasks[t].retrieval).filter(s => s.endsWith('bm25'))) {
                        assert.deepEqual(row.tasks[t].retrieval[key], base.tasks[t].retrieval[key]);
                    }
                }
                const test = paired(row, control, data);
                report.comparisons[name] = test;
                if (cap === tokens && test.ci95[0] > 0 && paired(row, base, data).ci95[0] > 0) report.shortlist[name] = row.policy;
                control = row;
            }
        }
        return;
    }
    for (const [name, policy] of Object.entries(report.shortlist)) await run(name, policy);
    const controls = { 'plain-default': { method: 'plain-priority', chars: 500 }, 'markdown-default': { method: 'pack', chars: 500 },
        'plain-pack': { method: 'plain-pack', tokens }, 'plain-priority': { method: 'plain-priority', tokens },
        'window-128': { method: 'window', tokens: 128 } };
    if (tokens !== 128) controls['window-' + tokens] = { method: 'window', tokens };
    for (const [name, policy] of Object.entries(controls)) await run(name, policy);
    report.comparisons = {};
    for (const name of Object.keys(report.policies).filter(n => n !== 'pack')) {
        report.comparisons[name + ' vs pack'] = paired(report.policies[name], report.policies.pack, data);
    }
    const original = Object.keys(report.shortlist).find(k => report.shortlist[k].method === 'fixed' && !report.shortlist[k].leadIn);
    for (const [name, policy] of Object.entries(report.shortlist)) {
        if (original && (policy.method === 'rescore' || (policy.method === 'fixed' && policy.leadIn))) {
            report.comparisons[name + ' vs ' + original] = paired(report.policies[name], report.policies[original], data);
        }
    }
}

try {
    await main();
    report.encoder = encoder.stats;
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { encoder.close(); }
