import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chunkText } from '../src/index.js';

if (!global.gc) throw new Error('Run this benchmark with node --expose-gc');
const { values } = parseArgs({ options: { output: { type: 'string' }, 'cache-limit': { type: 'string' } } });
const sentences = 4096, dimensions = 1536;
const text = Array.from({ length: sentences }, (_, i) => 'Topic ' + (Math.floor(i / 8) % 8) + ' describes sample ' + i + '.').join(' ');
const vectors = Array.from({ length: 8 }, (_, topic) => {
    const vector = new Float32Array(dimensions);
    vector[topic] = 1;
    return vector;
});

async function measure(limit) {
    async function liveBuffers() {
        global.gc();
        await new Promise(resolve => setImmediate(resolve));
        global.gc();
        return process.memoryUsage().arrayBuffers;
    }
    const baseline = await liveBuffers();
    let providerCalls = 0, providerTexts = 0, singletonCalls = 0, peakAtProviderEntryBytes = 0, lastProviderEntryBytes = 0;
    const chunks = await chunkText(text, async batch => {
        // Sample live vector storage between batches. The provider reuses eight
        // fixed test vectors, so it contributes no growing buffer of its own.
        lastProviderEntryBytes = (await liveBuffers()) - baseline;
        peakAtProviderEntryBytes = Math.max(peakAtProviderEntryBytes, lastProviderEntryBytes);
        providerCalls++; providerTexts += batch.length; singletonCalls += Number(batch.length === 1);
        return batch.map(s => vectors[Number(s[6])]);
    }, { chunkingStrategy: 'semantic-blocks', maxCachedEmbeddings: limit });
    const texts = chunks.map(c => c.text);
    assert.equal(texts.join(' '), text);
    return { maxCachedEmbeddings: Number.isFinite(limit) ? limit : 'Infinity', chunks: texts.length,
        boundariesSHA256: createHash('sha256').update(texts.join('\n')).digest('hex'),
        providerCalls, providerTexts, singletonCalls, peakAtProviderEntryBytes, lastProviderEntryBytes };
}

const startedUTC = new Date().toISOString();
if (values['cache-limit']) {
    console.log(JSON.stringify(await measure(Number(values['cache-limit']))));
    process.exit(0);
}
// Isolate the V8 heap and backing-store accounting for each cache policy.
const results = ['Infinity', '256'].map(limit => JSON.parse(execFileSync(process.execPath,
    ['--expose-gc', fileURLToPath(import.meta.url), '--cache-limit', limit], { encoding: 'utf8' })));
assert.equal(results[0].boundariesSHA256, results[1].boundariesSHA256);
const report = { startedUTC, node: process.version, strategy: 'semantic-blocks', sentences, dimensions, results };
const out = resolve(values.output ?? fileURLToPath(new URL('./results/cache-' + startedUTC.replace(/[-:.]/g, '') + '.json', import.meta.url)));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.table(results.map(({ boundariesSHA256, ...row }) => row));
console.log('Saved', out);
