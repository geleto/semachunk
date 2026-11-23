import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';

const options = { inputFormat: 'markdown', returnEmbedding: false };
const length = text => [...text].length;

async function chunks(source, extra = {}) {
    const output = await chunkText(source, assert.fail, { ...options, ...extra });
    for (const chunk of output) {
        assert.ok(chunk.text.isWellFormed());
        let previous = 0;
        for (const { start, end, outputStart } of chunk.sourceRanges) {
            assert.ok(start >= 0 && end > start && end <= source.length && outputStart >= previous);
            assert.equal(chunk.text.slice(outputStart, outputStart + end - start), source.slice(start, end));
            previous = outputStart + end - start;
        }
        if (extra.maxChunkTokens) {
            assert.ok(extra.countTokens(chunk.text) <= extra.maxChunkTokens);
            assert.ok(extra.countTokens(chunk.embeddingText ?? chunk.text) <= extra.maxChunkTokens);
        }
    }
    return output;
}

function original(source, output) {
    return output.flatMap(c => c.sourceRanges.map(r => source.slice(r.start, r.end))).join('');
}

test('section occurrences, active heading text and omitted blocks use original UTF-16 positions', async () => {
    const source = '\uFEFF---\r\ninvalid: [:\r\n---\r\nPre 🌍.\r\n\r\n# Root\r\n## Old\r\n## [New][p]\r\n\r\nBody [policy][p] and [^f].\r\n' +
        '\r\n[p]: /private\r\n\r\nBody two.\r\n\r\n---\r\n\r\nNext.\r\n\r\nMore *here*\r\n===\r\n\r\n[^f]: A footnote.\r\n\r\n# Tail';
    const rows = await chunks(source);
    assert.deepEqual(rows.map(c => c.text), ['Pre 🌍.', '## [New][p]\r\n\r\nBody [policy][p] and [^f].', 'Body two.', 'Next.',
        'More *here*\r\n===\r\n\r\n[^f]: A footnote.']);
    assert.deepEqual(rows.map(c => c.sectionId), [null, ...Array(3).fill(source.indexOf('## [New]')), source.indexOf('More')]);
    assert.deepEqual(rows.map(c => c.headingPath), [[], ['Root', 'New'], ['Root', 'New'], ['Root', 'New'], ['More here']]);
    assert.equal((await chunks('# A\n## B\nBody'))[0].text, '# A\n## B\nBody');
    assert.equal((await chunks('---\nnot closed\nstill prose'))[0].text, 'not closed\nstill prose');
    for (const input of ['', ' \r\n', '\uFEFF---\ninvalid: [:\n---', '# A\n## B', '[p]: /private', '[^empty]:']) {
        assert.deepEqual(await chunkText(input, assert.fail, { inputFormat: 'markdown' }), []);
    }
    const nonadditive = await chunks('# A\n## B\nBody', { maxChunkTokens: 1, countTokens: t => t === '## B\nBody' ? 2 : 1 });
    assert.equal(nonadditive[0].text, '# A\n## B\nBody');
});

test('greedy joins count actual separators, recheck hard caps and protect tables and code on both sides', async () => {
    const s = 'One.\r\n\r\nTwo.';
    assert.deepEqual((await chunks(s, { maxChunkSize: s.length - 1 })).map(c => c.text), ['One.', 'Two.']);
    assert.equal((await chunks(s, { maxChunkSize: s.length }))[0].text, s);
    assert.equal((await chunks(s, { maxChunkTokens: 2, countTokens: t => t === s ? 3 : 1 })).length, 2);
    assert.equal((await chunks(s, { combineChunks: false })).length, 2);
    const bodies = ['Lead.', '| A |\n|---|\n| 1 |', 'Middle.', '    code', 'End.', '<div>literal</div>'];
    assert.deepEqual((await chunks(bodies.join('\n\n'))).map(c => c.text), [...bodies.slice(0, 4), bodies.slice(4).join('\n\n')]);
    await assert.rejects(chunks('', { groupSentences: true }), /groupSentences/);
    await assert.rejects(chunks('', { locale: 'bad tag' }), RangeError);
});

test('hard splits prefer whole inline links and code, keep whitespace, and advance by code point', async () => {
    const link = '[See. Here](url)', code = '\x60x. Y\x60';
    const s = 'Some words before ' + link + ' and ' + code + '. Next sentence. ' + '🌍'.repeat(30);
    for (const settings of [{ maxChunkSize: 12 }, { maxChunkSize: Infinity, maxChunkTokens: 19, countTokens: length }]) {
        const rows = await chunks(s, { ...settings, combineChunks: false });
        assert.equal(original(s, rows), s);
        for (const atom of [link, code]) assert.ok(rows.some(c => c.text.includes(atom)));
    }
    const wrapped = await chunks('> In a quote. A second sentence with words.', { maxChunkTokens: 15, countTokens: length });
    assert.ok(wrapped.every(c => c.text.startsWith('> ')));
    await assert.rejects(chunks('🌍', { maxChunkTokens: 2, countTokens: length, chunkPrefix: 'X' }), /one Unicode code point/);
});

test('nested lists preserve repeated markers, indentation and internal headings; definitions and filtered prose are barriers', async () => {
    const s = '> 1. # Internal\n>    Line.\n>    Continuation.\n> 1. Another.\n> 1. Last.';
    const rows = await chunks(s, { maxChunkSize: 15 });
    assert.equal(original(s, rows), s);
    assert.ok(rows.every(c => c.sectionId === null && !c.headingPath.length));
    const input = '- First.\n- [p]: /omitted\n- Last.\n\nKeep. 123. Again.\n\n| 1 |\n|---|\n| 2 |\n\n    123';
    const kept = await chunks(input, { excludeNonLetterSentences: true });
    assert.ok(kept.every(c => !c.text.includes('/omitted') && !c.text.includes('123.')));
    assert.ok(kept.some(c => c.text.includes('| 2 |')));
    assert.ok(kept.some(c => c.text === '    123'));
});

test('literal autolinks with parser-generated children keep their original source offsets', async () => {
    const source = 'A citation. «a href="http%3A//www.example.com/person.asp%3Fx">Name here</ref> More prose.';
    const rows = await chunks(source, { maxChunkSize: 10 });
    assert.equal(original(source, rows), source);
    assert.ok(rows.some(c => c.text.includes('www.example.com/person.asp%3Fx')));
});

test('split tables repeat the literal header and delimiter, oversized rows retain values without a misleading header', async () => {
    const h = '> | a | b |\r\n> |---|---|\r\n', first = '> | 1 | x\\|y |\r\n', last = '> | 2 | 🌍 |';
    const s = h + first + last;
    const rows = await chunks(s, { maxChunkSize: 20 });
    assert.deepEqual(rows.map(c => c.text), [h + first, h + last]);
    assert.equal(rows[1].sourceRanges[0].start, 0);
    assert.equal(rows[1].sourceRanges[0].end, h.length);
    const long = h + first + '> | 2 | ' + '🌍'.repeat(60) + ' |';
    const split = await chunks(long, { maxChunkSize: Infinity, maxChunkTokens: 44, countTokens: length });
    assert.equal(original(long, split), long);
    assert.ok(split.slice(1).every(c => !c.text.includes('---')));
});

test('fenced and indented continuations retain source, line endings and container syntax under hard budgets', async () => {
    const s = '> 1. ~~~ js info\r\n>    alpha beta gamma delta epsilon zeta\r\n>      ~~~ literal\r\n>    last\r\n>    ~~~';
    assert.equal((await chunks(s, { maxChunkSize: 1 }))[0].text, s);
    const rows = await chunks(s, { maxChunkSize: Infinity, maxChunkTokens: 46, countTokens: length });
    assert.equal(original(s, rows), s);
    assert.ok(rows.length > 1);
    for (const [i, row] of rows.entries()) {
        assert.match(row.text, i ? /^> +~{3,} js info\r\n/ : /^> 1\. ~{3,} js info\r\n/);
        assert.match(row.text, /\r\n> +~{3,}$/);
    }
    const raw = await chunks(s, { maxChunkTokens: 4, countTokens: length });
    assert.equal(original(s, raw), s);
    const indented = '    abcdefghijklmnop\r\n    歲🌍月\r\n    last';
    assert.equal(original(indented, await chunks(indented, { maxChunkTokens: 14, countTokens: length })), indented);
});

test('prefix visibility, batching and vector ownership preserve identical occurrences at different offsets', async () => {
    const source = '# A long heading\nsame\n\n---\n\nsame\n\n---\n\nlast';
    for (const hidden of [false, true]) {
        const limits = { chunkPrefix: 'P', excludeChunkPrefixInResults: hidden, maxChunkTokens: 7, countTokens: length,
            maxCachedEmbeddings: 0, maxEmbeddingBatchSize: 2, maxPasses: 0 };
        const rows = await chunks(source, limits);
        const batches = [];
        const result = await chunkText(source, texts => { batches.push(texts); return texts.map(t => [t.length]); },
            { inputFormat: 'markdown', ...limits });
        assert.deepEqual(batches, [['P: same', 'P: last']]);
        assert.deepEqual(result.map(({ embedding, ...chunk }) => chunk), rows);
        assert.deepEqual(rows.map(c => c.embeddingText ?? c.text), ['P: same', 'P: same', 'P: last']);
        assert.ok(rows.every(c => c.headingPath[0] === 'A long heading'));
        assert.deepEqual(rows.map(c => c.sourceRanges[0].start), [source.indexOf('same'), source.lastIndexOf('same'), source.indexOf('last')]);
        assert.notEqual(result[0].embedding, result[1].embedding);
    }
});
