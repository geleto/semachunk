import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { layoutPolicy } from './auto-rules.mjs';
import { asset } from './corpora.mjs';
import { model, openReplay } from './encoder.mjs';
import { manifest } from './markdown-corpora.mjs';
import { groupInterval } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('Supply a new output path.');
const release = { name: 'friendsqa-test.json', checksum: 'a98f24d4b04ac9f8d9468088febf304bd90eada134537277c1a425e31c0372bc',
    url: 'https://raw.githubusercontent.com/emorynlp/FriendsQA/9ce6c98a6acf13c87d96b6811e4409b5de43bdfe/dat/friendsqa_tst.json' };
const { data } = JSON.parse(readFileSync(await asset(release), 'utf8'));
const docs = [], questions = [];
let references = 0;
for (const { title, paragraphs } of data.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }))) {
    const id = title.match(/^s\d+_e\d+/)[0];
    if (docs.at(-1)?.id !== id) docs.push({ id, source: '' });
    const d = docs.length - 1, doc = docs[d];
    for (const scene of paragraphs) {
        const turns = scene['utterances:'].map(({ uid, speakers, utterance }, i) => {
            assert.equal(uid, i);
            const label = speakers.join(', ');
            if (doc.source) doc.source += '\n';
            const start = doc.source.length, body = start + label.length + 2;
            doc.source += label + ': ' + utterance;
            return { start, label, body, words: [...utterance.matchAll(/\S+/gu)] };
        });
        for (const q of scene.qas) {
            const alternatives = q.answers.map(a => {
                const t = turns[a.utterance_id];
                const at = a.is_speaker ? t.label.indexOf(a.answer_text) : t.words[a.inner_start].index;
                assert.ok(at >= 0);
                const start = (a.is_speaker ? t.start : t.body) + at;
                const end = a.is_speaker ? start + a.answer_text.length : t.body + t.words[a.inner_end].index + t.words[a.inner_end][0].length;
                assert.equal(doc.source.slice(start, end), a.answer_text);
                references++;
                return [[d, start, end]];
            });
            assert.ok(alternatives.length);
            questions.push({ id: q.id, group: id, text: q.question, pool: [d], references: alternatives });
        }
    }
}

const dataset = { docs, questions }, sample = manifest({ dialogue: dataset }).dialogue;
const deliveries = [['five512', 5, 512], ['any256', Infinity, 256], ['five1024', 5, 1024]];
const report = { release, model, scenes: data.length, references, sample, deliveries, rows: {} };
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
