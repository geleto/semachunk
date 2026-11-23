import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chunkText } from '../src/index.js';
import { sha256 } from './corpora.mjs';
import { openTokenizer } from './encoder.mjs';

const workloads = ['long section', 'short sections'];
const count = 2048;
const maxChunkSize = Number(process.argv[3] ?? 500);
if (workloads.includes(process.argv[2])) {
    const many = process.argv[2] === workloads[1];
    const source = Array.from({ length: count }, (_, i) => [
        many ? '## Topic ' + (i % 2 ? i : 'repeated') : i ? '' : '# Topic',
        i % 4 === 0 ? 'An identical paragraph about a recurring topic.' : 'Paragraph ' + i + ' describes one distinct finding.',
        i % 8 === 0 ? '~~~js\nreturn 42\n~~~' : '', i % 8 === 4 ? '| Metric | Value |\n|---|---|\n| Total | 42 |' : '',
    ].filter(Boolean).join('\n\n')).join('\n\n');
    const tokenizer = openTokenizer();
    let batches;
    function embed(texts) {
        batches.push(texts);
        return texts.map(s => [s.length, 1]);
    }
    const times = [];
    let output;
    for (let run = 0; run < 4; run++) {
        batches = [];
        const start = performance.now();
        output = await chunkText(source, embed, { inputFormat: 'markdown', maxChunkSize, maxEmbeddingBatchSize: 256 });
        if (run) times.push(performance.now() - start);
    }
    const peakRSSKiB = process.resourceUsage().maxRSS;
    const sizes = output.map(c => tokenizer.countTokens(c.text)).sort((a, b) => a - b);
    console.log(JSON.stringify({ sections: many ? count : 1, sourceUnits: source.length, chunks: output.length,
        chunkTokens: { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1) },
        milliseconds: times, medianMs: times.toSorted((a, b) => a - b)[1], peakRSSKiB,
        calls: batches.length, singletonCalls: batches.filter(b => b.length === 1).length,
        embeddedTexts: batches.flat().length, embeddedTokens: batches.flat().reduce((n, s) => n + tokenizer.countTokens(s), 0),
        boundariesSHA256: sha256(JSON.stringify(output.map(c => c.sourceRanges))) }));
    tokenizer.close();
} else {
    const results = Object.fromEntries(workloads.map(name => [name, JSON.parse(execFileSync(process.execPath,
        [fileURLToPath(import.meta.url), name, String(maxChunkSize)], { encoding: 'utf8' }))]));
    const report = JSON.stringify({ node: process.version, platform: process.platform, maxChunkSize,
        maxEmbeddingBatchSize: 256, warmups: 1, results }, null, 2) + '\n';
    if (process.argv[2]) await writeFile(process.argv[2], report, { flag: 'wx' });
    console.log(report);
}
