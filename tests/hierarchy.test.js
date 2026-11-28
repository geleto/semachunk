import assert from 'node:assert/strict';
import test from 'node:test';
import {splitPassages} from '../src/passages.js';
import { loadMarkdownParser } from '../src/markdown-units.js';

const blocks = (source, inputFormat, options) => splitPassages(source, undefined, { inputFormat, chunkingStrategy: 'blocks', ...options });
const bodies = chunks => chunks.map(chunk => chunk.text);

test('the parser supplies nested spans before the traversal measures any token candidate', async () => {
    const source = '# Manual\n\nIntroduction.\n\n## Keys\n\nIssue. Revoke.\n\n# Next\n\nDone.';
    const { parseMarkdownTree } = await loadMarkdownParser();
    const { roots, children } = parseMarkdownTree(source, { maxChunkSize: 1, fits: assert.fail });
    assert.equal(roots.length, 2);
    const [manual] = roots;
    assert.equal(manual.end - manual.start, source.indexOf('\n\n# Next'));
    const [intro, keys] = children(manual);
    assert.equal(source.slice(intro.start, intro.end), 'Introduction.');
    assert.equal(source.slice(keys.start, keys.end), '## Keys\n\nIssue. Revoke.');
    assert.deepEqual(children(children(keys)[0]).map(n => source.slice(n.start, n.end)), ['Issue. ', 'Revoke.']);
});

test('Markdown selects the largest fitting section and checks each size limit on the rendered passage', async () => {
    const keys = '## Keys\r\n\r\n### Issue\r\n\r\nMint.\r\n\r\n### Revoke\r\n\r\nDrop.';
    const source = '\uFEFF# Manual\r\n\r\n' + keys + '\r\n\r\n## More\r\n\r\n' + 'word '.repeat(20) + 'end.';
    const maxChunkSize = keys.length;
    const [whole] = await blocks(source, 'markdown', { maxChunkSize });
    assert.equal(whole.text, keys);
    assert.deepEqual(whole.headingPath, ['Manual', 'Keys']);
    assert.equal(whole.sectionId, source.indexOf('## Keys'));
    assert.deepEqual(whole.sourceRanges, [{ start: whole.sectionId, end: whole.sectionId + keys.length, outputStart: 0 }]);

    const countTokens = text => text.startsWith('P: ') && text.includes('Mint.') && text.includes('Drop.') ? 9 : 1;
    for (const options of [
        { maxChunkSize: keys.slice(0, keys.indexOf('### Revoke')).length, maxChunkTokens: 20, countTokens },
        { maxChunkSize, maxChunkTokens: 4, countTokens, chunkPrefix: 'P', excludeChunkPrefixInResults: true }
    ]) {
        const rows = await blocks(source, 'markdown', options);
        assert.deepEqual(rows.slice(0, 2).map(c => c.headingPath.at(-1)), ['Issue', 'Revoke']);
        for (const row of rows) assert.ok(countTokens(row.embeddingText ?? row.text) <= options.maxChunkTokens);
    }
});

test('the recursive merge joins fitting siblings under their common parent and respects omissions', async () => {
    const siblings = '### One\n\nA.\n\n### Two\n\nB.';
    const source = '# Parent\n\n' + siblings + '\n\n### Three\n\n' + 'C'.repeat(40);
    const [joined, last] = await blocks(source, 'markdown', { maxChunkSize: siblings.length });
    assert.equal(joined.text, siblings);
    assert.deepEqual(joined.headingPath, ['Parent']);
    assert.equal(joined.sectionId, 0);
    assert.deepEqual(last.headingPath, ['Parent', 'Three']);

    const filtered = '# P\n\nA.\n\n<!-- hide -->\n\nB.\n\n## Q\n\nKeep. 123. Again.\n\n## Empty';
    const rows = await blocks(filtered, 'markdown', { excludeNonLetterSentences: true });
    assert.deepEqual(bodies(rows), ['# P\n\nA.', 'B.', '## Q\n\nKeep. ', 'Again.']);
    for (const row of rows) {
        const [{ start, end }] = row.sourceRanges;
        assert.equal(filtered.slice(start, end), row.text);
    }
});

test('blank lines, wrapped prose and sentence-aligned lines have distinct roles in text and Markdown', async () => {
    const source = 'A small\nwrapped phrase. Go.\nStop. Now.\n\nOther.';
    for (const inputFormat of ['text', 'markdown']) {
        const rows = await blocks(source, inputFormat, { maxChunkSize: 29 });
        assert.deepEqual(bodies(rows).map(s => s.trim().replace(/\s+/gu, ' ')),
            ['A small wrapped phrase. Go.', 'Stop. Now.', 'Other.']);
    }
    assert.deepEqual(bodies(await blocks('Ask Dr.\nSmith tomorrow.\n\nNext.', 'text')), ['Ask Dr. Smith tomorrow.\n\nNext.']);
    assert.deepEqual(bodies(await blocks('first row  \nsecond row', 'markdown', { maxChunkSize: 12 })), ['first row  \n', 'second row']);
});

test('plain headings and HTML scopes supply hierarchy without promoting ordinary paragraphs', async () => {
    const section = '# Procedure\n\n## Add\n\nMint.\n\n## Remove\n\nDrop.';
    assert.deepEqual(bodies(await blocks(section + '\n\n# Other\n\nAfter.', 'text')), [section + '\n\n# Other\n\nAfter.']);
    const html = '<article><h1>Keys</h1><section><h2>A &amp; B</h2><p>Issue.</p></section>' +
        '<section><h2>Remove</h2><p hidden>Secret.</p><p>Revoke.</p></section></article><p>After.</p>';
    assert.deepEqual(bodies(await blocks(html, 'html')), ['Keys\n\nA & B\n\nIssue.\n\nRemove\n\nRevoke.\n\nAfter.']);
    const small = bodies(await blocks(html, 'html', { maxChunkSize: 20 }));
    assert.deepEqual(small, ['Keys\n\nA & B\n\nIssue.', 'Remove\n\nRevoke.', 'After.']);
    assert.deepEqual(bodies(await blocks('<ul><li>One</li><li>Two</li></ul><p>After.</p>', 'html')), ['One\n\nTwo\n\nAfter.']);
});

test('top-level siblings share the document root and retain their citations and omission barriers', async () => {
    const source = '# A\n\nOne.\n\n# B\n\nTwo.\n\n# C\n\nThree.';
    const pair = source.slice(0, source.indexOf('\n\n# C'));
    for (const options of [{ maxChunkSize: pair.length }, { maxChunkTokens: pair.length, countTokens: s => s.length }]) {
        const [joined, last] = await blocks(source, 'markdown', options);
        assert.equal(joined.text, pair);
        assert.equal(joined.sectionId, null);
        assert.deepEqual(joined.headingPath, []);
        assert.deepEqual(joined.sourceRanges, [{start:0, end:pair.length, outputStart:0}]);
        assert.deepEqual(last.headingPath, ['C']);
    }
    assert.deepEqual(bodies(await blocks('One.\n\n<!-- hidden -->\n\nTwo.', 'markdown')), ['One.', 'Two.']);
    assert.deepEqual(bodies(await blocks('One.\n\n123.\n\nTwo.', 'text', {excludeNonLetterSentences:true})), ['One.','Two.']);
});
