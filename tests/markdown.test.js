import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';

const options = { inputFormat: 'markdown', chunkingStrategy: 'pack', returnEmbedding: false };
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
            const over = extra.countTokens(chunk.text) > extra.maxChunkTokens ||
                extra.countTokens(chunk.embeddingText ?? chunk.text) > extra.maxChunkTokens;
            assert.equal(chunk.tokenLimitExceeded, over ? true : undefined);
        }
    }
    return output;
}

function original(source, output) {
    return output.flatMap(c => c.sourceRanges.map(r => source.slice(r.start, r.end))).join('');
}

test('explicit Markdown strategies keep their distinct boundaries at different sizes', async () => {
    const source = 'Alpha\n\nBeta\n\nOther';
    const asText = rows => rows.map(c => c.text);
    for (const maxChunkSize of [100, 2048]) {
        assert.deepEqual(asText(await chunks(source, { chunkingStrategy: 'blocks', maxChunkSize })), [source]);
        assert.deepEqual(asText(await chunks(source, { chunkingStrategy: 'pack', maxChunkSize })), [source]);
        const batches = [];
        const embed = texts => { batches.push(texts); return texts.map(s => s === 'Other' ? [0, 1] : [1, 0]); };
        const rows = await chunkText(source, embed, { ...options, chunkingStrategy: 'semantic-blocks', maxChunkSize,
            combineChunksSimilarityThreshold: 0.9 });
        assert.deepEqual(asText(rows), ['Alpha\n\nBeta', 'Other']);
        assert.deepEqual(batches, [['Alpha', 'Beta', 'Other']]);
    }
});

test('packed overlap repeats literal source ranges and stops at each Markdown barrier', async () => {
    const table = '| H |\n|---|\n| V |', code = '~~~\ncode\n~~~';
    const source = ['A', 'B', 'C', 'D', 'E', '---', 'F', 'G', table, 'H', 'I', code, 'J', '# S\nK', 'L', '[ref]: /url', 'M'].join('\n\n');
    const rows = await chunks(source, { chunkingStrategy: 'pack', maxChunkSize: 7, chunkOverlap: 1 });
    assert.deepEqual(rows.map(c => c.text), ['A\n\nB\n\nC', 'C\n\nD\n\nE', 'F\n\nG', table, 'H\n\nI', code, 'J', '# S\nK', 'L', 'M']);
    assert.deepEqual(rows.slice(0, 2).map(c => c.sourceRanges),
        [[{ start: 0, end: 7, outputStart: 0 }], [{ start: 6, end: 13, outputStart: 0 }]]);
    assert.deepEqual(rows.at(-1).headingPath, ['S']);
    assert.equal(rows.at(-1).sectionId, source.indexOf('# S'));
});

test('Markdown counts CRLF in the overlap, batches only final bodies and keeps repeated occurrences distinct', async () => {
    const source = ['aa', 'bb', 'aa', 'cc', 'dd'].join('\r\n\r\n');
    const batches = [], countTokens = text => text.match(/\S+/g)?.length ?? 0;
    const embed = texts => { batches.push([...texts]); return texts.map(t => [countTokens(t)]); };
    const rows = await chunkText(source, embed, { inputFormat: 'markdown', chunkingStrategy: 'pack', maxChunkSize: Infinity,
        chunkOverlap: 2, countTokens, maxChunkTokens: 4, chunkPrefix: 'P', maxEmbeddingBatchSize: 2 });
    const expected = [['aa', 'bb', 'aa'], ['bb', 'aa', 'cc'], ['aa', 'cc', 'dd']].map(a => 'P: ' + a.join('\r\n\r\n'));
    assert.deepEqual(rows.map(c => c.text), expected);
    assert.deepEqual(batches, [expected.slice(0, 2), expected.slice(2)]);
    assert.deepEqual(rows.map(c => c.sourceRanges[0].start), [0, 6, 12]);
    for (const { text, sourceRanges: [r] } of rows) assert.equal(text.slice(r.outputStart), source.slice(r.start, r.end));
    const chars = await chunks(source, { chunkingStrategy: 'pack', chunkOverlap: 7, maxChunkSize: 14 });
    assert.deepEqual(chars.map(c => c.sourceRanges[0].start), [0, 12]);
    assert.deepEqual((await chunks(source, { chunkOverlap: 1, maxChunkSize: Infinity, maxChunkTokens: 256, countTokens })).map(c => c.text), [source]);
});

test('section occurrences, active heading text and omitted blocks use original UTF-16 positions', async () => {
    const source = '\uFEFF---\r\ninvalid: [:\r\n---\r\nPre 🌍.\r\n\r\n# Root\r\n## Old\r\n## [New][p]\r\n\r\nBody [policy][p] and [^f].\r\n' +
        '\r\n[p]: /private\r\n\r\nBody two.\r\n\r\n---\r\n\r\nNext.\r\n\r\nMore *here*\r\n===\r\n\r\n[^f]: A footnote.\r\n\r\n# Tail';
    const rows = await chunks(source);
    assert.deepEqual(rows.map(c => c.text), ['Pre 🌍.', '## [New][p]\r\n\r\nBody [policy][p] and [^f].', 'Body two.', 'Next.',
        'More *here*\r\n===\r\n\r\n[^f]: A footnote.']);
    assert.deepEqual(rows.map(c => c.sectionId), [null, ...Array(3).fill(source.indexOf('## [New]')), source.indexOf('More')]);
    assert.deepEqual(rows.map(c => c.headingPath), [[], ['Root', 'New'], ['Root', 'New'], ['Root', 'New'], ['More here']]);
    assert.equal((await chunks('# A\n## B\nBody'))[0].text, '# A\n## B\nBody');
    const duplicates = await chunks('# A\nBody\n\n# A\nBody');
    assert.deepEqual(duplicates.map(c => c.text), ['# A\nBody', '# A\nBody']);
    assert.deepEqual(duplicates.map(c => c.sectionId), [0, 10]);
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
    assert.deepEqual((await chunks(s, { chunkingStrategy: 'blocks' })).map(c => c.text), [s]);
    const bodies = ['Lead.', '| A |\n|---|\n| 1 |', 'Middle.', '    code', 'End.', '<div>literal</div>'];
    assert.deepEqual((await chunks(bodies.join('\n\n'))).map(c => c.text), [...bodies.slice(0, 4), bodies.slice(4).join('\n\n')]);
    await assert.rejects(chunks('', { locale: 'bad tag' }), RangeError);
});

test('Markdown packing respects character and token limits across sections', async () => {
    const units = ['A', 'B', 'C', 'D', '# Next\nA', 'B', 'C', 'D'];
    const source = units.join('\n\n');
    const greedy = [units.slice(0, 4).join('\n\n'), units.slice(4).join('\n\n')];
    assert.deepEqual((await chunks(source)).map(c => c.text), greedy);
    for (const [maxChunkSize, maxChunkTokens] of [[500, 256], [1024, Infinity], [1024, 256], [1024, 128], [Infinity, 255]]) {
        const rows = await chunks(source, { maxChunkSize, maxChunkTokens, countTokens: length });
        assert.deepEqual(rows.map(c => c.text), greedy);
    }
});

test('hard splits prefer whole inline links and code, keep whitespace, and advance by code point', async () => {
    const link = '[See. Here](url)', code = '\x60x. Y\x60';
    const s = 'Some words before ' + link + ' and ' + code + '. Next sentence. ' + '🌍'.repeat(30);
    for (const settings of [{ maxChunkSize: 12 }, { maxChunkSize: Infinity, maxChunkTokens: 19, countTokens: length }]) {
        const rows = await chunks(s, { ...settings, chunkingStrategy: 'blocks' });
        assert.equal(original(s, rows), s);
        for (const atom of [link, code]) assert.ok(rows.some(c => c.text.includes(atom)));
    }
    const wrapped = await chunks('> In a quote. A second sentence with words.', { maxChunkTokens: 15, countTokens: length });
    assert.ok(wrapped.every(c => c.text.startsWith('> ')));
    const [over] = await chunks('🌍', { maxChunkTokens: 2, countTokens: length, chunkPrefix: 'X' });
    assert.equal(over.text, 'X: 🌍');
    assert.equal(over.tokenLimitExceeded, true);
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

test('Markdown sentence boundaries honor the locale and preserve literal UTF-16 slices', async () => {
    for (const [locale, expected] of [
        ['en', ['Dr. Smith signed. \t', 'ßeta.\r\n', 'See [Fig. One](url) and `x. Y` with Mr. Jones. ', 'Final Inc.  ']],
        ['es', ['Hable con la Sra. García. ', 'Vuelva luego.']],
        ['zh', ['他说。', '她答。']],
    ]) {
        const source = expected.join('');
        const rows = await chunks(source, { locale, maxChunkSize: 1 });
        assert.deepEqual(rows.map(c => c.text), expected);
        assert.equal(original(source, rows), source);
    }
});

test('blank paragraphs and standalone comments are barriers, including inside containers', async () => {
    const source = '# A\n\n\u00a0\n\nFirst.\n\n<!-- lint\r\non -->\n\n12\n\n&nbsp;\n\nSecond.';
    for (const extra of [{}, { maxChunkSize: Infinity }]) {
        const rows = await chunks(source, extra);
        assert.deepEqual(rows.map(c => c.text), ['First.', '12', 'Second.']);
        assert.ok(rows.every(c => c.headingPath[0] === 'A'));
    }
    const list = '- before\n- <!-- first --> <!-- second -->\n- &#160;\n- after';
    assert.deepEqual((await chunks(list)).map(c => c.text), ['- before\n', '- after']);
    const quote = '> before\n>\n> <!-- hidden\n> more -->\n>\n> after';
    assert.deepEqual((await chunks(quote)).map(c => c.text), ['> before\n>\n', '> after']);
    for (const literal of ['`<!-- example -->`', '~~~html\n<!-- example -->\n~~~', 'a <!-- inline --> b',
        '<!-- comment --> visible text', '<div>visible</div>']) {
        assert.deepEqual((await chunks(literal)).map(c => c.text), [literal]);
    }
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
    assert.equal(original(long, await chunks(long, { maxChunkTokens: 3, countTokens: length })), long);
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
    const line = '    ' + 'alpha '.repeat(8) + 'omega';
    const spaced = line + '\r\n'.repeat(4) + line;
    const fragments = await chunks(spaced, { maxChunkTokens: 23, countTokens: length });
    assert.equal(original(spaced, fragments), spaced);
    assert.ok(fragments.every(c => c.text.trim()));
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
