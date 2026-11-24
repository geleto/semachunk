function primary(task, ranker) { return (task === 'hotpotqa' ? 'pooled/' : 'document/') + ranker; }
export function macro(row, ranker = 'dense') {
    const tasks = Object.keys(row.tasks);
    return tasks.reduce((sum, t) => sum + row.tasks[t].retrieval[primary(t, ranker)][512].complete / row.tasks[t].questions, 0) / tasks.length;
}

export function groupInterval(groups) {
    let seed = 20261123;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const draws = [];
    for (let i = 0; i < 2000; i++) {
        let sum = 0;
        for (const group of groups) {
            let diff = 0, n = 0;
            for (let j = 0; j < group.length; j++) {
                const [d, k] = group[Math.floor(random() * group.length)];
                diff += d; n += k;
            }
            sum += diff / n;
        }
        draws.push(100 * sum / groups.length);
    }
    draws.sort((a, b) => a - b);
    return [draws[50], draws[1949]];
}

// Resample whole contracts, papers, reports or independent question pools,
// paired within task. Each of the four tasks gets the same weight.
export function paired(a, b, data, ranker = 'dense', controlRanker = ranker) {
    const tasks = Object.keys(data);
    const groups = [], perTask = {};
    for (const t of tasks) {
        const x = a.tasks[t].complete512[primary(t, ranker)], y = b.tasks[t].complete512[primary(t, controlRanker)];
        const byGroup = new Map(), wins = [], losses = [];
        data[t].questions.forEach(({ group, id }, i) => {
            if (!byGroup.has(group)) byGroup.set(group, [0, 0]);
            const delta = Number(x[i]) - Number(y[i]), pair = byGroup.get(group);
            pair[0] += delta;
            pair[1] += a.measurements ?? 1;
            if (delta) (delta > 0 ? wins : losses).push(id);
        });
        perTask[t] = { winsPer100: 100 * wins.length / x.length, lossesPer100: 100 * losses.length / x.length, wins, losses };
        groups.push([...byGroup.values()]);
    }
    return { deltaPer100: 100 * (macro(a, ranker) - macro(b, controlRanker)), ci95: groupInterval(groups), perTask };
}

export function selectCombination(report, data) {
    const { policies, fixed, rescore } = report;
    const comparisons = report.comparisons = {};
    let winner = 'pack';
    for (const name of ['pack-lead', fixed, fixed + '-lead', rescore, rescore + '-lead']) {
        const controls = new Set([winner, 'pack']);
        if (name.endsWith('-lead') && name !== 'pack-lead') {
            controls.add('pack-lead');
            controls.add(name.slice(0, -5));
        }
        if (name.startsWith('rescore')) controls.add(name.endsWith('-lead') ? fixed + '-lead' : fixed);
        let passes = true;
        for (const simpler of controls) {
            const comparison = paired(policies[name], policies[simpler], data);
            comparisons[name + ' vs ' + simpler] = comparison;
            if (comparison.ci95[0] <= 0) passes = false;
        }
        if (passes) winner = name;
    }
    report.winner = policies[winner].policy;
    const strongest = Object.keys(policies).filter(k => k.endsWith('-lead')).sort((a, b) => macro(policies[b]) - macro(policies[a]))[0];
    report.shortlist = Object.fromEntries([...new Set(['pack', 'pack-lead', fixed, rescore, strongest, winner])]
        .map(k => [k, policies[k].policy]));
}

// Keep versions of each question paired and groups from separate samples independent.
export function contrast(samples, tasks, terms) {
    const reports = Array.isArray(samples) ? samples : [samples];
    const groups = [], means = [];
    for (const task of tasks) {
        const arm = (task === 'hotpotqa' ? 'pooled/' : 'document/') + 'dense';
        const byGroup = [];
        let sum = 0, count = 0;
        for (const report of reports) {
            const scores = terms.map(([key, sign]) => [report.runs[key][task][task === 'qmsum' ? 'recall512' : 'complete512'][arm], sign]);
            const totals = new Map();
            report.samples[task].groups.forEach((group, i) => {
                const diff = scores.reduce((v, [series, sign]) => v + sign * Number(series[i]), 0);
                const pair = totals.get(group) ?? [0, 0];
                pair[0] += diff; pair[1]++;
                totals.set(group, pair);
                sum += diff; count++;
            });
            byGroup.push(...totals.values());
        }
        groups.push(byGroup);
        means.push(sum / count);
    }
    return { deltaPoints: 100 * means.reduce((s, v) => s + v) / means.length, ci95: groupInterval(groups) };
}

export function summarizeOverlap(report) {
    const splits = Object.values(report.splits);
    if (report.study === 'side-locks') {
        report.comparisons = {};
        for (const [label, tasks] of [['documents', ['cuad', 'qasper', 'finqa', 'hotpotqa']], ['meetings', ['qmsum']]]) {
            const outcomes = report.comparisons[label] = {};
            for (const name of ['frozenLock', 'frozenReopen', 'liveLock', 'liveReopen']) {
                const gain = prefix => [[prefix + name, 1], [prefix + 'core256', -1]];
                for (const prefix of ['', 'flat/']) outcomes[prefix + name + ' vs core'] = contrast(splits, tasks, gain(prefix));
                outcomes[name + ' change after flattening'] = contrast(splits, tasks, [...gain('flat/'), [name, -1], ['core256', 1]]);
            }
            for (const prefix of ['', 'flat/']) {
                for (const [a, b] of [['frozenReopen', 'frozenLock'], ['liveReopen', 'liveLock'], ['frozenLock', 'liveLock']]) {
                    outcomes[prefix + a + ' vs ' + b] = contrast(splits, tasks, [[prefix + a, 1], [prefix + b, -1]]);
                }
            }
            if (label === 'meetings') for (const control of ['core256', 'frozenLock']) {
                outcomes['frozenLockTurns vs ' + control] = contrast(splits, tasks, [['frozenLockTurns', 1], [control, -1]]);
            }
        }
        return;
    }
    const controls = (report.study === 'embedding-context' ? ['core256', 'live512', 'guard512'] : ['core256', 'live320'])
        .filter(name => report.policies[name]);
    for (const result of [...splits, report]) {
        const samples = result === report ? splits : result;
        const comparisons = result.comparisons = {};
        for (const [label, tasks] of [['documents', ['cuad', 'qasper', 'finqa', 'hotpotqa']], ['meetings', ['qmsum']]]) {
            const outcomes = comparisons[label] = {};
            for (const name of Object.keys(report.policies)) {
                for (const control of controls) {
                    if (name !== control) outcomes[name + '/' + control] = contrast(samples, tasks, [[name, 1], [control, -1]]);
                }
            }
        }
    }
}

export function summarizeSemantic(report) {
    for (const [label, tasks] of [['documents', Object.keys(report.samples).filter(t => t !== 'qmsum')], ['meetings', ['qmsum']]]) {
        const comparisons = report.comparisons[label] = {};
        for (const name of ['markdown', 'text', 'semantic-default', 'semantic-count', 'semantic-capped']) {
            const terms = view => [[view + '/' + name, 1], [view + '/recursive', -1]];
            for (const view of ['original', 'flat']) comparisons[view + '/' + name + ' vs recursive'] = contrast(report, tasks, terms(view));
            comparisons['change in ' + name + ' lead'] = contrast(report, tasks, [...terms('flat'), ...terms('original').map(([k, s]) => [k, -s])]);
        }
        for (const view of ['original', 'flat']) {
            for (const name of ['markdown', 'text']) {
                comparisons[view + '/' + name + ' vs semantic-capped'] = contrast(report, tasks, [[view + '/' + name, 1], [view + '/semantic-capped', -1]]);
            }
            comparisons[view + '/semantic-capped vs recursive-zero'] = contrast(report, tasks,
                [[view + '/semantic-capped', 1], [view + '/recursive-zero', -1]]);
        }
    }
}
