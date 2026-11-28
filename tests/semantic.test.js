import assert from 'node:assert/strict';
import test from 'node:test';
import {splitPassages} from '../src/passages.js';

const settings = { chunkingStrategy: 'semantic', combineChunksSimilarityThreshold: 0.5, returnEmbedding: false };
const parallel = texts => texts.map(() => [1]);
const topics = texts => texts.map(s => [/keys|tokens/i.test(s) ? 1 : 0, /crops|barley/i.test(s) ? 1 : 0]);
const bodies = rows => rows.map(row => row.text);

test('siblings in separate subsections can join while an unrelated fitting subsection stays separate', async () => {
    const related = '# Guide\n\n## Keys\n\nMint keys. Rotate keys.\n\n## Tokens\n\nIssue tokens.';
    const other = '## Crops\n\nPlant barley.', source = related + '\n\n' + other;
    const options = { ...settings, inputFormat: 'markdown' };
    const rows = await splitPassages(source, topics, options);
    assert.deepEqual(bodies(rows), [related, other]);
    assert.deepEqual(rows.map(c => c.headingPath), [['Guide'], ['Guide', 'Crops']]);
    assert.deepEqual(rows.map(c => c.sectionId), [0, source.indexOf(other)]);
    for (const c of rows) {
        const [{ start, end, outputStart }] = c.sourceRanges;
        assert.equal(outputStart, 0);
        assert.equal(source.slice(start, end), c.text);
    }
    assert.equal((await splitPassages(source, undefined, { inputFormat: 'markdown' })).length, 1);
});

test('a weak sentence boundary splits even a fitting paragraph and its ancestors in all prose formats', async () => {
    for (const [inputFormat, source] of [['text', 'Rotate keys. Plant barley.'], ['markdown', '# Guide\n\nRotate keys. Plant barley.'],
        ['html', '<article><p>Rotate keys. Plant barley.</p></article>']]) {
        const rows = await splitPassages(source, topics, { ...settings, inputFormat });
        assert.deepEqual(bodies(rows).map(s => s.trim()), [inputFormat === 'markdown' ? '# Guide\n\nRotate keys.' : 'Rotate keys.', 'Plant barley.']);
    }
});

test('the document can join top-level siblings and Markdown code and tables can join related prose', async () => {
    const first = '# One\n\nKeys.', second = '# Two\n\nMore keys.';
    const [both] = await splitPassages(first + '\n\n' + second, parallel, { ...settings, inputFormat: 'markdown' });
    assert.equal(both.text, first + '\n\n' + second);
    assert.deepEqual(both.headingPath, []);
    assert.equal(both.sectionId, null);
    const source = '# Report\n\nCrop totals.\n\n| Crop | Count |\n|---|---|\n| Barley | 5 |\n\n~~~text\nBarley: 5\n~~~';
    assert.deepEqual(bodies(await splitPassages(source, parallel, { ...settings, inputFormat: 'markdown' })), [source]);
    for (const [inputFormat, text] of [['text', 'Keys.\n\nMore keys.'], ['html', '<section>Keys.</section><section>More keys.</section>']]) {
        assert.deepEqual(bodies(await splitPassages(text, parallel, { ...settings, inputFormat })), ['Keys.\n\nMore keys.']);
    }
});

test('hard token limits apply to scoring and indexed text and excluded content cannot reappear in a parent', async () => {
    const calls = [];
    const embed = texts => { calls.push(...texts); return parallel(texts); };
    const text = '# First\n\nKeys.\n\n<!-- Hidden -->\n\n## Next\n\nMore keys.\n\n🌍';
    const countTokens = s => s.includes('🌍') ? 99 : s.length;
    const rows = await splitPassages(text, embed, { ...settings, inputFormat: 'markdown', maxChunkSize: 30,
        maxChunkTokens: 21, countTokens, chunkPrefix: 'P', excludeChunkPrefixInResults: true, returnEmbedding: true });
    assert.ok(calls.length);
    assert.ok(calls.every(s => countTokens(s) <= 21 && !s.includes('Hidden')));
    assert.ok(rows.every(c => !c.text.includes('Hidden')));
    assert.ok(rows.find(c => c.text === '🌍').tokenLimitExceeded);
    for (const c of rows.filter(c => !c.tokenLimitExceeded)) {
        assert.ok(c.text.length <= 30 && countTokens(c.embeddingText) <= 21);
        assert.deepEqual(c.embedding, [1]);
    }
});

test('semantic splitting uses the same fixed default in text, Markdown and HTML', async () => {
    for (const inputFormat of ['text', 'markdown', 'html']) {
        const source = inputFormat === 'html' ? '<p>First. Second.</p>' : 'First. Second.';
        const options = { inputFormat, chunkingStrategy: 'semantic', returnEmbedding: false };
        for (const [cosine, expected] of [[0.14, ['First.', 'Second.']], [0.16, ['First. Second.']]]) {
            const embed = texts => texts.map(text => text.trim() === 'First.' ? [1, 0] : [cosine, Math.sqrt(1 - cosine ** 2)]);
            assert.deepEqual(bodies(await splitPassages(source, embed, options)).map(text => text.trim()), expected);
        }
    }
});

test('document calibration and an explicit fixed cutoff apply to tree edges', async () => {
    const source = 'A\n\nB\n\nC', embed = texts => texts.map(t => t === 'A' ? [0, 1] : [1, 0]);
    const options = { inputFormat: 'markdown', chunkingStrategy: 'semantic', mergeThresholdMode: 'document', returnEmbedding: false };
    assert.deepEqual(bodies(await splitPassages(source, embed, options)), ['A', 'B\n\nC']);
    assert.deepEqual(bodies(await splitPassages(source, embed, { ...options, combineChunksSimilarityThreshold: 0 })), [source]);
    assert.deepEqual(bodies(await splitPassages('Only.', assert.fail, options)), ['Only.']);
    await assert.rejects(splitPassages(source, undefined, options), /embedding callback/i);
    for (const extra of [{ inputFormat: 'json' }, { inputFormat: 'text', separator: '\n' }, { chunkOverlap: 1 }]) {
        await assert.rejects(splitPassages('', assert.fail, { ...options, ...extra }), /JSON|separator|chunkOverlap/);
    }
});
