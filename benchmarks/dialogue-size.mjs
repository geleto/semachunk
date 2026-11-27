import { existsSync, writeFileSync } from 'node:fs';
import { layoutPolicy } from './auto-rules.mjs';
import { friendsDialogue } from './semantic-corpora.mjs';
import { model, openReplay } from './encoder.mjs';
import { manifest } from './markdown-corpora.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new output path.');
const { release, scenes, references, dataset } = await friendsDialogue();
const { docs, questions } = dataset, sample = manifest({ dialogue: dataset }).dialogue;
const deliveries = [['five512', 5, 512], ['any256', Infinity, 256], ['five1024', 5, 1024]];
const report = { release, model, scenes, references, sample, deliveries, rows: {} };
const encoder = await openReplay(undefined, undefined, { lengthSafe: true });
try {
    await prepareDataset(dataset, encoder);
    for (const layout of ['semantic/500', 'semantic/1024', 'pack/250', 'pack/1024']) {
        const row = await evaluate('dialogue', dataset, layoutPolicy('text', layout), encoder, 'semantic', { deliveries });
        const hits = row.hits['document/dense'];
        const scores = Object.fromEntries(deliveries.map(([p]) => [p, row.retrieval['document/dense'][p].complete / questions.length]));
        report.rows[layout] = { scores, hits, embeddedTokens: row.embeddedTokens, bodyHash: row.bodyHash };
    }
} finally { encoder.close(); }
const groups = new Map();
for (const [i, q] of questions.entries()) {
    const pair = groups.get(q.group) ?? [0, 0];
    pair[0] += Number(report.rows['semantic/1024'].hits.five512[i]) - Number(report.rows['semantic/500'].hits.five512[i]);
    pair[1]++;
    groups.set(q.group, pair);
}
report.largerSemanticInterval95 = groupInterval([[...groups.values()]]);
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(model, 'episodes', docs.length, 'questions', questions.length, 'validated answer spans', references);
