import { macro, paired } from './markdown-decisions.mjs';

const sizes = [
    ['c500', { chars: 500 }], ['t128', { tokens: 128 }],
    ['c1024', { chars: 1024 }], ['t256', { tokens: 256 }],
    ['c2048', { chars: 2048 }], ['t512', { tokens: 512 }],
];
const mixed = [['c500-t256', { chars: 500, tokens: 256 }], ['c1024-t128', { chars: 1024, tokens: 128 }]];
const schedules = { frozen: {}, one: { maxPasses: 1 }, tighten: { schedule: 'tighten' }, live: { schedule: 'live' },
    'density-relax': { density: 'relax' }, 'density-tighten': { density: 'tighten' } };
const budgetRules = ['token-cap', 'medium-budget', 'large-budget'];
const structureRules = {
    'half-eligible': { feature: 'eligible', at: 0.5 }, 'three-quarters-eligible': { feature: 'eligible', at: 0.75 },
    'quarter-competing': { feature: 'competing', at: 0.25 }, 'half-competing': { feature: 'competing', at: 0.5 },
};

export function scoreAtBudget(rule, { chars = Infinity, tokens = Infinity }) {
    if (rule === 'token-cap') return tokens < Infinity;
    const level = rule === 'medium-budget' ? 1 : 2;
    return chars >= 1024 * level && tokens >= 256 * level;
}

// Average a question's outcomes across sizes before resampling its group.
// Its six measurements are repeated observations of one question.
function acrossSizes(rows) {
    const tasks = {};
    let calls = 0, tokens = 0;
    for (const task of Object.keys(rows[0].tasks)) {
        const arm = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
        const { questions } = rows[0].tasks[task], hits = new Uint8Array(questions);
        for (const row of rows) {
            const result = row.tasks[task];
            calls += result.calls;
            tokens += result.embeddedTokens;
            for (let i = 0; i < questions; i++) hits[i] += Number(result.complete512[arm][i]);
        }
        tasks[task] = { questions, complete512: { [arm]: hits },
            retrieval: { [arm]: { 512: { complete: hits.reduce((a, b) => a + b) / rows.length } } } };
    }
    return { tasks, calls, tokens, measurements: rows.length };
}

export async function studyRules({ report, prior, data, run, validation }) {
    if (validation && !prior.shortlist?.budget) throw new Error('Validation needs the frozen heuristic calibration report');
    const configs = validation ? [...sizes, ...mixed] : sizes;
    const grid = report.grid = {}, summaries = report.summaries = {};
    const averages = new Map(), comparisons = report.comparisons = {};

    async function measure(name, options) {
        grid[name] = {};
        for (const [label, size] of configs) {
            const key = name + '/' + label;
            const policy = { ...size, ...options };
            const saved = !validation && prior.experiment === 'rules' && prior.samplesSHA256 === report.samplesSHA256 && prior.policies[key];
            if (saved && JSON.stringify(saved.policy) === JSON.stringify(policy)) {
                report.policies[key] = saved;
                report.reusedConfigurations = (report.reusedConfigurations ?? 0) + 1;
                report.carriedForwardEncoder = prior.encoder;
            }
            else await run(key, policy);
            grid[name][label] = key;
        }
        summarize(name);
    }
    function summarize(name) {
        const row = acrossSizes(sizes.map(([label]) => report.policies[grid[name][label]]));
        averages.set(name, row);
        summaries[name] = { meanComplete512: macro(row), callsAcrossSixSettings: row.calls, embeddedTokensAcrossSixSettings: row.tokens };
    }
    function compare(a, b) {
        const test = paired(averages.get(a), averages.get(b), data);
        comparisons[a + ' vs ' + b] = test;
        return test;
    }
    function best(names) {
        return names.toSorted((a, b) => summaries[b].meanComplete512 - summaries[a].meanComplete512 ||
            summaries[a].embeddedTokensAcrossSixSettings - summaries[b].embeddedTokensAcrossSixSettings)[0];
    }
    const fixed = { method: 'fixed', adaptive: true };
    await measure('pack', { method: 'pack' });
    await measure('frozen', fixed);
    compare('frozen', 'pack');
    const challengers = validation ? [prior.shortlist.pass] : ['one', 'tighten', 'live', 'density-relax', 'density-tighten'];
    for (const id of challengers) {
        await measure(id, { ...fixed, ...schedules[id] });
        compare(id, 'frozen');
    }
    const pass = best(challengers);
    const schedule = validation ? prior.shortlist.schedule :
        (comparisons[pass + ' vs frozen'].ci95[0] > 0 ? pass : 'frozen');
    const budgets = validation ? [prior.shortlist.budget] : budgetRules;
    for (const id of budgets) {
        grid[id] = Object.fromEntries(configs.map(([label, size]) =>
            [label, grid[scoreAtBudget(id, size) ? schedule : 'pack'][label]]));
        summarize(id);
        compare(id, 'pack');
        compare(id, 'frozen');
    }
    const budget = best(budgets);
    const structural = validation ? [prior.shortlist.structure] : Object.keys(structureRules);
    for (const id of structural) {
        await measure(id, { ...fixed, ...schedules[schedule], ...structureRules[id] });
        compare(id, 'pack');
        compare(id, 'frozen');
        compare(id, budget);
    }
    report.shortlist = { schedule, pass, budget, structure: best(structural) };
}
