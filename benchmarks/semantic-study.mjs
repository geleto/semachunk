import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { here } from './corpora.mjs';
import { dimension, encodingName, model, openReplay } from './encoder.mjs';
import { manifest, markdownCorpora } from './markdown-corpora.mjs';
import { summarizeSemantic } from './markdown-decisions.mjs';
import { evaluate, prepareDataset } from './markdown-evaluation.mjs';
import { flattenCorpus, meetings } from './semantic-corpora.mjs';

const [output, python = 'python'] = process.argv.slice(2);
if (!output || existsSync(output)) throw new Error('Supply a new JSON output path and optionally the reference Python executable.');
const read = async name => JSON.parse(await readFile(join(here, 'results', name + '.json'), 'utf8'));
const data = await markdownCorpora('replication');
assert.deepEqual(manifest(data), (await read('2026-11-23-markdown-samples')).replication);
const previous = await read('2026-11-23-retrieval-baselines');
data.qmsum = await meetings();
const methods = { markdown: { method: 'public-markdown' }, text: { method: 'plain-priority' },
    recursive: { method: 'recursive', overlap: 64 }, 'recursive-zero': { method: 'recursive', overlap: 0 }, 'semantic-default': { method: 'semantic-reference' },
    'semantic-count': { method: 'semantic-reference', chunkCount: true },
    'semantic-capped': { method: 'semantic-reference', chunkCount: true, cap: true } };
const report = { model, dimension, encodingName, target: 256, budgets: [256, 512, 1024], metric: 'literal-context-v1',
    node: process.version, startedUTC: new Date().toISOString(), samples: {}, runs: {}, comparisons: {} };
const runFile = promisify(execFile);

async function nativeLayouts(docs, encoder) {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-semantic-'));
    const input = join(dir, 'documents.json'), matrix = join(dir, 'windows.f32');
    async function call(...args) {
        const { stdout } = await runFile(python, [join(here, 'semantic-reference.py'), ...args],
            { encoding: 'utf8', maxBuffer: 64 * 1024 ** 2, windowsHide: true });
        return JSON.parse(stdout);
    }
    try {
        await writeFile(input, JSON.stringify(docs.map(d => [d.source, Math.ceil(encoder.countTokens(d.source) / report.target)])));
        const windows = await call('windows', input);
        const vectors = await encoder.embed(windows.flat());
        await writeFile(matrix, Buffer.concat(vectors.map(v => Buffer.from(v.buffer, v.byteOffset, v.byteLength))));
        const { layouts, versions } = await call('split', input, matrix, String(dimension));
        assert.equal(layouts.length, docs.length);
        if (report.versions) assert.deepEqual(versions, report.versions);
        report.versions = versions;
        for (const [i, doc] of docs.entries()) doc.breakpoints = { layouts: layouts[i], windows: windows[i].length,
            windowTokens: windows[i].reduce((sum, text) => sum + encoder.countTokens(text), 0) };
    } finally {
        await rm(input, { force: true });
        await rm(matrix, { force: true });
        await rmdir(dir);
    }
}

async function measure(task, view, dataset) {
    const encoder = await openReplay(undefined, undefined, { lengthSafe: true });
    try {
        const { docs, questions } = dataset, sample = report.samples[task];
        const hash = manifest({ [task]: dataset })[task];
        sample[view] = { sourceSHA256: hash.sourceSHA256, annotationsAndPoolsSHA256: hash.annotationsAndPoolsSHA256,
            underTarget: docs.filter(d => encoder.countTokens(d.source) <= report.target).length,
            withHeadings: docs.filter(d => /^#{1,6} /m.test(d.source)).length,
            withBlankLines: docs.filter(d => /\n\s*\n/.test(d.source)).length,
            withTables: docs.filter(d => /^\|[^\n]*\n\|[ :|-]*---[ :|-]*\|/m.test(d.source)).length };
        await prepareDataset(dataset, encoder);
        if (task === 'qmsum') sample[view].goldTokens = questions.map(q => Math.min(...q.gold.map(g => g.tokens.length)));
        await nativeLayouts(docs, encoder);
        for (const [name, options] of Object.entries(methods)) {
            const row = await evaluate(task, dataset, { ...options, tokens: report.target }, encoder, 'semantic');
            const arm = (task === 'hotpotqa' ? 'pooled/' : 'document/') + 'dense';
            const reference = { recursive: 'recursive-overlap', 'recursive-zero': 'recursive' }[name];
            if (task !== 'qmsum' && view === 'original' && reference) {
                const old = previous.policies[reference + '/t256'].tasks[task];
                for (const key of ['bodyHash', 'calls', 'embeddedTokens', 'indexTexts', 'indexTokens', 'chunkTokens']) assert.deepEqual(row[key], old[key]);
                for (const key of Object.keys(row.retrieval)) assert.deepEqual(row.retrieval[key], old.retrieval[key]);
                assert.equal(row.complete512[arm], old.complete512[arm]);
            }
            (report.runs[view + '/' + name] ??= {})[task] = row;
            console.log(task, view, name, row.retrieval[arm][512].complete + '/' + questions.length, 'complete');
        }
        sample[view].encoder = { ...encoder.stats };
    } finally { encoder.close(); }
}

for (const [task, original] of Object.entries(data)) {
    const groups = original.questions.map(q => task === 'hotpotqa' ? q.pooled[0] : q.group);
    report.samples[task] = { documents: original.docs.length, questions: original.questions.map(q => q.id), groups };
    const flat = flattenCorpus(original);
    await measure(task, 'original', original);
    await measure(task, 'flat', flat);
}
summarizeSemantic(report);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
