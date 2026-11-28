import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

test('a browser consumer can bundle a plain-text install with all optional parsers omitted', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'semachunk-text-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const name of ['src', 'config.js', 'package.json']) {
        await cp(new URL('../' + name, import.meta.url), join(directory, name), { recursive: true });
    }
    const { outputFiles } = await build({
        stdin: { contents: "export { chunk } from '.'", resolveDir: directory },
        bundle: true, platform: 'browser', format: 'esm', write: false
    });
    const { chunk } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
    const doc = await chunk('Dr. Silva left. Next.', {strategy:'pack',maxChunkSize:0});
    assert.deepEqual(doc.chunks.map(c=>c.text), ['Dr. Silva left.','Next.']);
});
