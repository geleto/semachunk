// Measure the public chunkText path with cheap, deterministic batched vectors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { compare: { type: 'string' }, output: { type: 'string' } } });
const now = new Date().toISOString();
const out = values.output || join(here, 'results', 'merge-' + now.replaceAll(':', '-') + '.json');
if (existsSync(out)) throw new Error('Result already exists: ' + out);
const roots = { current: resolve(here, '..') };
if (values.compare) roots.reference = resolve(values.compare);
const implementations = {};
const sourceHashes = {};
for (const [label, root] of Object.entries(roots)) {
    implementations[label] = (await import(pathToFileURL(join(root, 'src/index.js')))).chunkText;
    const hash = createHash('sha256');
    const files = readdirSync(join(root, 'src')).filter(s => s.endsWith('.js')).map(s => 'src/' + s);
    for (const path of ['config.js', ...files.sort()]) {
        hash.update(path + '\0').update(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')).update('\0');
    }
    sourceHashes[label] = hash.digest('hex');
}

const cases = [
    { sentences: 2048, topicLength: 8, maxChunkSize: 500 },
    { sentences: 16384, topicLength: 8, maxChunkSize: 500 },
    { sentences: 16384, topicLength: 8, maxChunkSize: 250 },
    { sentences: 16384, topicLength: 1, maxChunkSize: 500 },
    { sentences: 4096, topicLength: 8, maxChunkSize: 500, dimensions: 384 },
];
const oneHot = Array.from({ length: 8 }, (_, i) => Float32Array.from({ length: 8 }, (_, j) => Number(i === j)));
const trials = 7;
const results = [];
for (const item of cases) {
    // Eight orthogonal sign patterns exercise every coordinate of a dense vector.
    const vectors = item.dimensions ? Array.from({ length: 8 }, (_, topic) => Float32Array.from({ length: item.dimensions }, (_, j) => {
        const x = topic & j;
        return ((x ^ (x >> 1) ^ (x >> 2)) & 1 ? -1 : 1) / Math.sqrt(item.dimensions);
    })) : oneHot;
    const doc = Array.from({ length: item.sentences }, (_, i) => {
        const topic = String.fromCharCode(65 + Math.floor(i / item.topicLength) % 8);
        return 'Subject ' + topic + ' discusses sample ' + String(i).padStart(5, '0') + '.';
    }).join(' ');
    const options = {
        chunkingStrategy: 'semantic-blocks', maxChunkSize: item.maxChunkSize, similarityThreshold: 0.5, returnEmbedding: true
    };
    const scores = {};
    for (let trial = 0; trial <= trials; trial++) {
        const order = Object.keys(implementations);
        if (trial % 2) order.reverse();
        for (const label of order) {
            let calls = 0, inputs = 0, singletons = 0;
            const embed = async batch => {
                calls++;
                inputs += batch.length;
                if (batch.length === 1) singletons++;
                return batch.map(text => vectors[text.charCodeAt(8) - 65]);
            };
            const start = performance.now();
            const chunks = await implementations[label](doc, embed, options);
            const ms = performance.now() - start;
            const texts = chunks.map(c => c.text);
            assert.equal(texts.join(' '), doc, 'Chunker lost or reordered source text');
            const boundaries = createHash('sha256').update(texts.join('\n')).digest('hex');
            if (trial === 0) {
                scores[label] = { chunks: chunks.length, providerCalls: calls, providerTexts: inputs, singletonCalls: singletons,
                    boundariesSHA256: boundaries, samplesMs: [] };
            } else {
                assert.equal(boundaries, scores[label].boundariesSHA256);
                scores[label].samplesMs.push(Number(ms.toFixed(2)));
            }
        }
    }
    for (const score of Object.values(scores)) score.medianMs = score.samplesMs.toSorted((a, b) => a - b)[Math.floor(trials / 2)];
    results.push({ ...item, scores });
    console.log(item, Object.fromEntries(Object.entries(scores).map(([label, s]) => [label, s.medianMs])));
}
const report = { startedUTC: now, node: process.version, strategy: 'semantic-blocks', cpu: cpus()[0].model, platform: process.platform, trials,
    implementationSHA256: sourceHashes, results };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log('Saved ' + out);
