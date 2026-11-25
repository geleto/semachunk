import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { model, encodingName, openReplay } from './encoder.mjs';
import { markdownCorpora, manifest } from './markdown-corpora.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { meetings } from './semantic-corpora.mjs';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new JSON result path.');
const deliveries = [['five512', 5, 512], [512, Infinity, 512], ['top5', 5, Infinity]];
const modes = { semantic: { method: 'plain-priority', chunkingStrategy: 'semantic' }, sentences: { method: 'plain-priority', combineChunks: false },
    paragraph: { method: 'plain-priority', chunkingStrategy: 'blocks' }, pack: { method: 'plain-pack' }, recursive: { method: 'recursive', overlap: 0 },
    'recursive-capped': { method: 'recursive', overlap: 0, cap: true } };
const report = { model, encodingName, bodyTokens: 256, cohorts: {} };
for (const name of ['modes-a', 'modes-b', 'qmsum']) {
    const meeting = name === 'qmsum', task = meeting ? 'qmsum' : 'cuad';
    const dataset = meeting ? await meetings() : (await markdownCorpora(name)).cuad;
    const m = manifest({ [task]: dataset })[task], groups = dataset.questions.map(q => q.group);
    const cohort = report.cohorts[name] = { sourceSHA256: m.sourceSHA256, annotationsSHA256: m.annotationsAndPoolsSHA256,
        questions: m.questions, groups, metric: meeting ? 'annotated-token recall' : 'complete evidence', modes: {} };
    const encoder = await openReplay();
    try {
        await prepareDataset(dataset, encoder);
        for (const [mode, settings] of Object.entries(modes)) {
            const row = await evaluate(task, dataset, { ...settings, tokens: 256 }, encoder, 'semantic', { deliveries });
            const { bodyHash, embeddedTokens, indexTexts, overTarget } = row;
            if (mode === 'recursive-capped') assert.equal(overTarget, 0);
            const scores = cohort.modes[mode] = { bodyHash, embeddedTokens, indexTexts, overTarget, profiles: {} };
            for (const [profile] of deliveries) {
                const queryScores = (meeting ? row.recalls : row.hits)['document/dense'][profile];
                const values = Array.from(queryScores, Number), mean = values.reduce((s, n) => s + n, 0) / values.length;
                assert.equal(values.length, groups.length);
                const { deliveredTokens } = row.retrieval['document/dense'][profile];
                const measurement = scores.profiles[profile] = { mean, deliveredTokens, queryScores };
                if (mode === 'semantic') continue;
                const control = cohort.modes.semantic.profiles[profile], byGroup = new Map();
                groups.forEach((id, i) => {
                    const pair = byGroup.get(id) ?? [0, 0];
                    pair[0] += values[i] - Number(control.queryScores[i]); pair[1]++;
                    byGroup.set(id, pair);
                });
                measurement.deltaPoints = 100 * (mean - control.mean);
                measurement.ci95 = groupInterval([[...byGroup.values()]]);
            }
            console.log(name, mode, (100 * scores.profiles.five512.mean).toFixed(2));
        }
    } finally { encoder.close(); }
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
