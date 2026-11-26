import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { nominate, paired } from './json-record-report.mjs';

const protocol = JSON.parse(await readFile(new URL('./json-record-protocol.json', import.meta.url)));

test('development nomination stops at the first failed addition', () => {
    const order = ['children', 'packed', 'packed-repeat', 'packed-omit'];
    for (let stop = 1; stop <= order.length; stop++) {
        // Every addition saves one row except the chosen failure, which ties its parent.
        const measured = [...order, 'record', 'plain'].map((name, i) => {
            const rows = 10 - i + Number(i === stop);
            return { names: [name], cost: [rows, rows, rows, rows, 0], answers: [[3, 3, 1]], titles: {} };
        });
        const entries = [1, 2].map(group => {
            const view = { group, questions: [['q', 1]], measured };
            return { report: { array: view, last: view, text: view } };
        });
        const result = nominate(entries, { settings: protocol });
        assert.deepEqual(result.candidates, order.slice(0, stop));
        assert.deepEqual(result.comparisons.map(c => c.name), order.slice(1, stop + 1));
        assert.equal(result.reference, 'record');
    }
});

test('report rejects a mismatched model, dimension, hit limit or delivery budget in confirmation scores', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'semachunk-report-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const tool = fileURLToPath(new URL('./json-record-report.mjs', import.meta.url));
    const freeze = fileURLToPath(new URL('./results/2026-11-25-json-record-nominees.json', import.meta.url));
    for (const [key, value] of Object.entries({ model: 'text-embedding-3-large', dimension: 768, topK: 6, budget: 1024 })) {
        const settings = { ...protocol, corpus: 'confirmation', [key]: value };
        await writeFile(join(dir, '0000.json.gz'), gzipSync(JSON.stringify({ settings })));
        const args = [tool, 'report', freeze, dir, 'hotpot', 'wikisql', 'finqa', join(dir, 'out')];
        const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp('JSON record study requires ' + key + '='));
    }
});

test('paired confidence bounds reproduce the frozen subgroup, full-frame and adjusted reference intervals', async () => {
    const noChange = paired(Array(151).fill(0), 2);
    assert.ok(Math.abs(noChange.lo + 3.3052) < 0.0001);
    assert.equal(noChange.hi, -noChange.lo);
    const archive = JSON.parse(await readFile(new URL('./results/2026-11-25-json-records.json', import.meta.url)));
    const packing = archive.comparisons[0];
    for (const [expected, alpha] of [
        [packing.affected[1], 0.05], [packing.full.array[0], 0.05],
        [archive.references.packed, 0.05 / archive.candidates.length]
    ]) {
        const width = (expected.counts.length - 1) / 2;
        const changes = expected.counts.flatMap((n, i) => Array(n).fill(i - width));
        const actual = paired(changes, width, alpha);
        assert.deepEqual(actual.counts, expected.counts);
        assert.equal(actual.n, expected.n);
        assert.equal(actual.delta, expected.delta);
        assert.ok(Math.abs(actual.lo - expected.lo) < 1e-8 && Math.abs(actual.hi - expected.hi) < 1e-8);
    }
});
