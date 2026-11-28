import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { chunk, createDocumentIndex, search } from '../src/index.js';
import { exerciseChunker } from './browser-cases.mjs';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const expected = await exerciseChunker(chunk,createDocumentIndex,search);

async function browserBundle(worker) {
    const result = await build({
        stdin: {
            resolveDir: fileURLToPath(root),
            contents: `import { chunk, createDocumentIndex, search } from '.';
                import { exerciseChunker } from './tests/browser-cases.mjs';
                export const chunks = await exerciseChunker(chunk,createDocumentIndex,search);
                ${worker ? 'postMessage(chunks);' : ''}`
        },
        platform: 'browser', conditions: worker ? ['worker'] : [],
        bundle: true, format: 'esm', target: 'es2024', minify: true, write: false
    });
    return result.outputFiles[0].text;
}

const windowBundle = await browserBundle(false);
const workerBundle = await browserBundle(true);
const server = createServer((request, response) => {
    if (request.url === '/') response.end('<!doctype html><title>Browser test</title>');
    else if (request.url === '/window.js' || request.url === '/worker.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(request.url === '/worker.js' ? workerBundle : windowBundle);
    } else response.writeHead(404).end();
});

async function verifyBrowser(engine) {
    const browser = await engine.launch();
    try {
        const page = await browser.newPage();
        const messages = [];
        page.on('console', message => messages.push(message.text()));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        assert.deepEqual(await page.evaluate(async () => (await import('/window.js')).chunks), expected);
        assert.ok(messages.some(message => message.includes(`-- semachunk v${version} --`)));
        const chunks = await page.evaluate(() => new Promise((resolve, reject) => {
            const worker = new Worker('/worker.js', { type: 'module' });
            worker.onmessage = event => resolve(event.data);
            worker.onerror = event => reject(new Error(event.message || 'Worker failed to load'));
        }));
        assert.deepEqual(chunks, expected);
        console.log(`${engine.name()} window and worker match Node`);
    } finally {
        await browser.close();
    }
}

server.listen(0, '127.0.0.1');
try {
    await once(server, 'listening');
    for (const engine of [chromium, firefox]) await verifyBrowser(engine);
} finally {
    server.close();
}
