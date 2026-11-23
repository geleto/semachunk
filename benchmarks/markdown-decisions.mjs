function primary(task) { return task === 'hotpotqa' ? 'pooled/dense' : 'document/dense'; }
export function macro(row) {
    const tasks = Object.keys(row.tasks);
    return tasks.reduce((sum, t) => sum + row.tasks[t].retrieval[primary(t)][512].complete / row.tasks[t].questions, 0) / tasks.length;
}

// Resample whole contracts, papers, reports or independent question pools,
// paired within task. Each of the four tasks gets the same weight.
export function paired(a, b, data) {
    const tasks = Object.keys(data);
    let seed = 20261123;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const groups = [], perTask = {};
    for (const t of tasks) {
        const x = a.tasks[t].complete512[primary(t)], y = b.tasks[t].complete512[primary(t)];
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
    return { deltaPer100: 100 * (macro(a) - macro(b)), ci95: [draws[50], draws[1949]], perTask };
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
