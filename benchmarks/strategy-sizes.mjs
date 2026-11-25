import { existsSync, writeFileSync } from 'node:fs';
import { model, encodingName, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { meetings } from './semantic-corpora.mjs';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new JSON result path.');
const targets = [500, 1024], strategies = ['blocks', 'pack', 'semantic'];
const deliveries = [['five512', 5, 512], ['five1024', 5, 1024], ['unlimited512', Infinity, 512]];
const report = { model, encodingName, characterTargets: targets, maxChunkTokens: null, chunkOverlap: 0,
    deliveries: deliveries.map(([name, hits, tokens]) => ({ name, maxHits: Number.isFinite(hits) ? hits : null, maxRetrievedTokens: tokens })),
    cohorts: [], comparisons: {} };

async function measure(split, task, dataset, formats) {
    const sample = manifest({ [task]: dataset })[task];
    const groups = dataset.questions.map(q => task === 'hotpotqa' ? q.pooled[0] : q.group);
    const ranker = task === 'hotpotqa' ? 'pooled/dense' : 'document/dense';
    const encoder = await openReplay();
    try {
        await prepareDataset(dataset, encoder);
        for (const format of formats) {
            const cohort = { split, task, format, sourceSHA256: sample.sourceSHA256, annotationsSHA256: sample.annotationsAndPoolsSHA256,
                questions: sample.questions, groups, metric: task === 'qmsum' ? 'annotated-token recall' : 'complete evidence', rows: {} };
            report.cohorts.push(cohort);
            for (const strategy of strategies) {
                const rows = cohort.rows[strategy] = {};
                for (const chars of targets) {
                    const policy = { method: format === 'markdown' ? 'public-markdown' : 'plain-priority', chunkingStrategy: strategy, chars };
                    const row = await evaluate(task, dataset, policy, encoder, 'semantic', { deliveries });
                    const { bodyHash, indexTexts, embeddedTokens, overTarget, overEmbeddingLimit, chunkTokens } = row;
                    rows[chars] = { bodyHash, indexTexts, embeddedTokens, overTarget, overEmbeddingLimit, chunkTokens, outcomes: {} };
                    for (const [name] of deliveries) {
                        rows[chars].outcomes[name] = (task === 'qmsum' ? row.recalls : row.hits)[ranker][name];
                    }
                }
                console.log(split, task, format, strategy);
            }
        }
    } finally { encoder.close(); }
}

// Pair the two layouts on each question and resample sources within each task.
function compare(cohorts, strategy, profile) {
    const groups = new Map(), totals = new Map();
    for (const { task, groups: ids, rows } of cohorts) {
        if (!groups.has(task)) { groups.set(task, []); totals.set(task, [0, 0, 0]); }
        const bySource = new Map(), total = totals.get(task);
        const [small, large] = targets.map(t => rows[strategy][t].outcomes[profile]);
        ids.forEach((id, i) => {
            const a = Number(small[i]), b = Number(large[i]);
            if (!bySource.has(id)) bySource.set(id, [0, 0]);
            const source = bySource.get(id);
            source[0] += b - a; source[1]++;
            total[0] += a; total[1] += b; total[2]++;
        });
        groups.get(task).push(...bySource.values());
    }
    const scores = targets.map((_, i) => 100 * [...totals.values()].reduce((sum, row) => sum + row[i] / row[2], 0) / totals.size);
    const result = { scores, deltaPoints: scores[1] - scores[0] };
    if (profile === 'five512') result.adjustedInterval = groupInterval([...groups.values()], 1 - 0.05 / strategies.length);
    return result;
}

for (const split of ['modes-a', 'modes-b']) {
    for (const [task, dataset] of Object.entries(await markdownCorpora(split))) {
        await measure(split, task, dataset, task === 'cuad' ? ['markdown', 'text'] : ['markdown']);
    }
}
await measure('qmsum', 'qmsum', await meetings(), ['text']);
for (const [label, cohorts] of Object.entries({
    markdown: report.cohorts.filter(c => c.format === 'markdown'),
    contracts: report.cohorts.filter(c => c.format === 'text' && c.task === 'cuad'),
    meetings: report.cohorts.filter(c => c.task === 'qmsum')
})) {
    const results = report.comparisons[label] = {};
    for (const s of strategies) {
        results[s] = Object.fromEntries(deliveries.map(([p]) => [p, compare(cohorts, s, p)]));
        results[s].primaryBySplit = Object.fromEntries([...new Set(cohorts.map(c => c.split))]
            .map(split => [split, compare(cohorts.filter(c => c.split === split), s, 'five512').deltaPoints]));
    }
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
