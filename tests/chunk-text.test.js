import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';
import { createBatchEmbedder } from '../src/embeddings.js';

function recordingEmbedder(vectorFor = text => [text.length, 1]) {
    const batches = [];
    const embed = async texts => {
        batches.push([...texts]);
        return texts.map(vectorFor);
    };
    return { embed, batches };
}

const pair = 'First topic. Second topic.';
const sentences = ['First topic.', 'Second topic.'];

test('auto packs without a callback and can still use semantic scoring when final vectors are disabled', async () => {
    assert.deepEqual(await chunkText(pair), [{ text: pair }]);
    for (const [inputFormat, source] of [
        ['text', pair], ['html', '<p>First topic.</p><p>Second topic.</p>'], ['markdown', sentences.join('\n\n')]
    ]) {
        const options = { inputFormat, maxChunkSize: 2048, combineChunksSimilarityThreshold: 0.9 };
        const packed = await chunkText(source, assert.fail, { ...options, chunkingStrategy: 'pack', returnEmbedding: false });
        assert.equal(packed.length, 1);
        assert.deepEqual(await chunkText(source, options), packed);
        assert.deepEqual(await chunkText(source, undefined, options), packed);
        const { embed } = recordingEmbedder(s => s === sentences[0] ? [1, 0] : [0, 1]);
        assert.deepEqual((await chunkText(source, embed, { ...options, returnEmbedding: false })).map(c => c.text), sentences);
    }
    assert.deepEqual(await chunkText(pair, null, { combineChunks: false }), sentences.map(text => ({ text })));
});

test('explicit semantic scoring and output vectors require an embedding callback', async () => {
    await assert.rejects(chunkText(pair, { chunkingStrategy: 'semantic', returnEmbedding: false }), /embedding callback/i);
    await assert.rejects(chunkText(pair, undefined, { returnEmbedding: true }), /embedding callback/i);
    await assert.rejects(chunkText(pair, 42), /embedBatchCallback must be a function/);
});

test('omitted size options use the documented target for every format and strategy', async () => {
    const body = ['Autumn', 'Winter', 'Spring'].map(s => s + ' ' + 'again '.repeat(46) + 'ends.').join(' ');
    const embed = async texts => texts.map(() => [1]);
    for (const inputFormat of ['text', 'html', 'markdown']) {
        const source = inputFormat === 'html' ? '<p>' + body + '</p>' : body;
        for (const chunkingStrategy of ['auto', 'blocks', 'pack', 'semantic']) {
            const run = size => chunkText(source, embed, { inputFormat, chunkingStrategy, returnEmbedding: false, ...size });
            const smaller = await run({ maxChunkSize: 500 });
            const larger = await run({ maxChunkSize: 1024 });
            assert.equal(smaller.length, 3);
            assert.equal(larger.length, 1);
            const expected = inputFormat === 'markdown' ? larger : smaller;
            assert.deepEqual(await run(), expected, inputFormat + '/' + chunkingStrategy);
            assert.deepEqual(await run({ maxChunkTokens: 256, countTokens: s => s.trim().split(/\s+/u).length }), expected);
            if (chunkingStrategy === 'auto') assert.deepEqual(await run({ chunkingStrategy: undefined }), expected);
        }
    }
});

test('a token cap supplements the default character target and can be used on its own', async () => {
    const text = [1, 2, 3].map(i => 'Sentence ' + i + ' ' + 'a'.repeat(250) + '.').join(' ');
    const pack = sizes => chunkText(text, assert.fail, { chunkingStrategy: 'pack', returnEmbedding: false,
        maxChunkTokens: 9, countTokens: s => s.split(' ').length, ...sizes });
    assert.equal((await pack()).length, 3);
    assert.deepEqual(await pack({ maxChunkSize: Infinity }), [{ text }]);
    assert.equal((await pack({ maxChunkSize: Infinity, maxChunkTokens: 6 })).length, 2);
});

test('explicit strategies select paragraphs, packing or similarity with either legacy combine setting', async () => {
    const source = 'One. Two.\n\nRed. Sun.';
    for (const [inputFormat, text] of [['text', source], ['html', '<p>One. <b>Two.</b></p><p>Red.<br>Sun.</p>']]) {
        const run = (strategy, embed, extra) => chunkText(text, embed, { inputFormat, maxChunkSize: 14,
            combineChunks: false, returnEmbedding: false, chunkingStrategy: strategy, ...extra }).then(rows => rows.map(c => c.text));
        assert.deepEqual(await run('auto', assert.fail), ['One.', 'Two.', 'Red.', 'Sun.']);
        assert.deepEqual(await run('blocks', assert.fail), ['One. Two.', 'Red. Sun.']);
        assert.deepEqual(await run('blocks', assert.fail, { maxChunkSize: 5 }), ['One.', 'Two.', 'Red.', 'Sun.']);
        assert.deepEqual(await run('pack', assert.fail), ['One. Two. Red.', 'Sun.']);
        const { embed, batches } = recordingEmbedder(s => /One|Two/.test(s) ? [1, 0] : [0, 1]);
        assert.deepEqual(await run('semantic', embed, { similarityThreshold: 0.9 }), ['One. Two.', 'Red. Sun.']);
        assert.ok(batches.length);
    }
    const filtered = await chunkText('42.\n\nDr. Smith signed. Fees apply.', assert.fail, {
        chunkingStrategy: 'blocks', excludeNonLetterSentences: true, returnEmbedding: false
    });
    assert.deepEqual(filtered, [{ text: 'Dr. Smith signed. Fees apply.' }]);
});

test('packing repeats only fitting whole sentences and always advances', async () => {
    const text = 'One. Two. Red. Sun. End.';
    const pack = (chunkOverlap, extra) => chunkText(text, assert.fail, { maxChunkSize: 14, chunkingStrategy: 'pack',
        returnEmbedding: false, chunkOverlap, ...extra }).then(rows => rows.map(c => c.text));
    assert.deepEqual(await pack(3), ['One. Two. Red.', 'Sun. End.']);
    assert.deepEqual(await pack(4), ['One. Two. Red.', 'Red. Sun. End.']);
    assert.deepEqual(await pack(4, { chunkingStrategy: 'auto' }), await pack(4));
    assert.deepEqual(await pack(99), ['One. Two. Red.', 'Two. Red. Sun.', 'Red. Sun. End.']);
    assert.deepEqual(await pack(99, { maxChunkSize: 0 }), ['One.', 'Two.', 'Red.', 'Sun.', 'End.']);
    assert.deepEqual(await pack(99, { maxChunkSize: Infinity }), [text]);
    assert.deepEqual(await chunkText('', assert.fail, { chunkingStrategy: 'pack', chunkOverlap: 12 }), []);
});

test('token overlap counts the actual suffix and the prefix still fits every final embedding', async () => {
    const text = 'One. Two. Red. Sun. End.';
    const countTokens = s => s === 'Two. Red.' ? 3 : s.split(' ').length;
    const { embed, batches } = recordingEmbedder(s => [s.length]);
    const rows = await chunkText(text, embed, {
        chunkingStrategy: 'pack', maxChunkSize: Infinity, maxChunkTokens: 4, countTokens, chunkOverlap: 2,
        chunkPrefix: 'P', excludeChunkPrefixInResults: true, maxEmbeddingBatchSize: 2
    });
    const bodies = ['One. Two. Red.', 'Red. Sun. End.'];
    assert.deepEqual(rows.map(c => c.text), bodies);
    assert.deepEqual(batches, [bodies.map(s => 'P: ' + s)]);
    assert.ok(batches.flat().every(s => countTokens(s) <= 4));
    for (const strategy of ['blocks', 'pack']) {
        const chunks = await chunkText('東京🌍星海雪霞', assert.fail, { chunkingStrategy: strategy, maxChunkTokens: 3,
            countTokens: s => [...s].length, chunkOverlap: strategy === 'pack' ? 1 : 0, returnEmbedding: false });
        assert.equal(chunks.map(c => c.text).join(''), '東京🌍星海雪霞');
        assert.ok(chunks.every(c => c.text.isWellFormed() && [...c.text].length <= 3));
    }
});

test('invalid strategies and unusable overlap settings fail before embedding', async () => {
    for (const value of ['recursive', '', null]) {
        await assert.rejects(chunkText('', assert.fail, { chunkingStrategy: value }), /chunkingStrategy/);
    }
    for (const value of [-1, 0.5, Infinity, NaN, '4']) {
        await assert.rejects(chunkText('', assert.fail, { chunkingStrategy: 'pack', chunkOverlap: value }), /chunkOverlap/);
    }
    for (const options of [{ chunkingStrategy: 'blocks' }, { chunkingStrategy: 'semantic' }, { combineChunks: false }]) {
        await assert.rejects(chunkText('', assert.fail, { ...options, chunkOverlap: 1 }), /chunkOverlap/);
    }
});

test('a finite cache retains only the most recent entries between scoring batches', async () => {
    const { embed, batches } = recordingEmbedder(s => Float32Array.of(s.length));
    const cached = createBatchEmbedder(embed, 2, 1);
    const first = await cached(['A', 'BB', 'CCC', 'A'], ['later']);
    assert.deepEqual(first.map(v => v[0]), [1, 2, 3, 1]);
    await cached(['CCC', 'BB']);
    await cached(['BB', 'A']);
    assert.deepEqual(batches, [['A', 'BB'], ['CCC'], ['BB'], ['A']]);
    for (const limit of [0, 1, Infinity]) {
        const { embed } = recordingEmbedder(() => Float32Array.of(3, 4));
        const chunks = await chunkText('One. Two. Red. Sun.', embed, { maxChunkSize: 9, maxCachedEmbeddings: limit });
        assert.deepEqual(chunks.map(c => c.text), ['One. Two.', 'Red. Sun.']);
        assert.deepEqual(chunks.map(c => c.embedding), [Float32Array.of(3, 4), Float32Array.of(3, 4)]);
    }
    await assert.rejects(chunkText('', embed, { maxCachedEmbeddings: -1 }), /maxCachedEmbeddings/);
});

test('the requested sentence locale controls abbreviation handling', async () => {
    const text = 'Hable con la Sra. García. Vuelva luego.';
    const options = { combineChunks: false, returnEmbedding: false };
    const split = async locale => (await chunkText(text, assert.fail, { ...options, locale })).map(c => c.text);
    assert.deepEqual(await split('es'), ['Hable con la Sra. García.', 'Vuelva luego.']);
    assert.deepEqual(await split('en'), ['Hable con la Sra.', 'García.', 'Vuelva luego.']);
    await assert.rejects(chunkText('', assert.fail, { locale: 'bad locale' }), RangeError);
});

test('the last allowed merge returns a vector for the joined text', async () => {
    const { embed, batches } = recordingEmbedder();
    const chunks = await chunkText(pair, embed, { maxUncappedPasses: 1 });
    assert.deepEqual(chunks, [{ text: pair, embedding: [pair.length, 1] }]);
    assert.deepEqual(batches, [sentences, [pair]]);
});

test('the final batch embeds the prefix even when it is hidden from the output', async () => {
    const prefix = 'Title [v1]';
    // The source already starts with the same prefix and must survive intact.
    const original = [prefix + ': First topic.', 'Second topic.'];
    const prefixed = original.map(text => prefix + ': ' + text);
    for (const hide of [false, true]) {
        const { embed, batches } = recordingEmbedder();
        const chunks = await chunkText(original.join(' '), embed, {
            combineChunks: false, chunkPrefix: prefix, excludeChunkPrefixInResults: hide
        });
        assert.deepEqual(batches, [prefixed]);
        assert.deepEqual(chunks.map(c => c.text), hide ? original : prefixed);
        assert.deepEqual(chunks.map(c => c.embedding), prefixed.map(s => [s.length, 1]));
    }
});

test('a terminal merge embeds only the requested final representation', async () => {
    const { embed, batches } = recordingEmbedder();
    const options = { chunkPrefix: 'Topic', excludeChunkPrefixInResults: true };
    const prefixed = 'Topic: ' + pair;
    assert.deepEqual(await chunkText(pair, embed, options), [
        { text: pair, embedding: [prefixed.length, 1] }
    ]);
    assert.deepEqual(batches, [sentences, [prefixed]]);

    const textOnly = recordingEmbedder();
    assert.deepEqual(await chunkText(pair, textOnly.embed, { ...options, returnEmbedding: false }), [{ text: pair }]);
    assert.deepEqual(textOnly.batches, [sentences]);
});

test('size-limited final chunks with a prefix are embedded together', async () => {
    const { embed, batches } = recordingEmbedder();
    const texts = ['One.', 'Two.', 'Red.', 'Sun.'];
    const chunks = await chunkText(texts.join(' '), embed, { maxChunkSize: 9, chunkPrefix: 'Topic' });
    const finals = ['Topic: One. Two.', 'Topic: Red. Sun.'];
    assert.deepEqual(chunks, finals.map(text => ({ text, embedding: [text.length, 1] })));
    assert.deepEqual(batches, [texts, finals]);
});

test('a repeated sentence and a repeated merged chunk are each embedded once per call', async () => {
    const text = 'An echo. An echo. An echo. An echo.';
    const merged = 'An echo. An echo.';
    const { embed, batches } = recordingEmbedder();
    const options = { maxChunkSize: merged.length, maxMergesPerPass: 1 };
    for (let call = 0; call < 2; call++) {
        const chunks = await chunkText(text, embed, options);
        assert.deepEqual(chunks, Array(2).fill({ text: merged, embedding: [merged.length, 1] }));
    }
    assert.deepEqual(batches, [['An echo.'], [merged], ['An echo.'], [merged]]);
});

test('deduplication restores source order and preserves typed vectors', async () => {
    const { embed, batches } = recordingEmbedder(s => new Float32Array([s.length]));
    const chunks = await chunkText('One. Other. One.', embed, { combineChunks: false });
    assert.deepEqual(batches, [['One.', 'Other.']]);
    assert.deepEqual(chunks.map(c => c.text), ['One.', 'Other.', 'One.']);
    assert.deepEqual(chunks.map(c => c.embedding), [4, 6, 4].map(n => new Float32Array([n])));
});

test('each callback batch must return complete, finite vectors of a consistent dimension', async () => {
    const invalid = [
        [{ data: [] }, /one vector per text/],
        [[[1, 0]], /Expected 2, received 1/],
        [[[], []], /nonempty/],
        [[[1, 0], [1]], /dimension 1.*Expected 2/],
        [[[1, 0, 0, 0], [1, 0, 0, NaN]], /finite numbers/],
        [[[Infinity], [1]], /finite numbers/],
    ];
    for (const [result, message] of invalid) {
        await assert.rejects(chunkText(pair, async () => result, { combineChunks: false }), message);
    }
    const changesDimension = async texts => texts.map(() => texts.length === 2 ? [1, 0] : [1]);
    await assert.rejects(chunkText(pair, changesDimension), /dimension 1.*Expected 2/);

    const three = 'First topic. Second topic. Third topic.';
    await assert.rejects(chunkText(three, async texts => texts.length === 3 ? texts.map(() => [1]) : []), /Expected 1, received 0/);
});

test('the Unicode letter filter is optional and runs before embedding', async () => {
    const text = '123. 東京です。';
    const { embed, batches } = recordingEmbedder();
    const keep = await chunkText(text, embed, { combineChunks: false });
    const filtered = await chunkText(text, embed, { combineChunks: false, excludeNonLetterSentences: true });
    assert.deepEqual(keep.map(c => c.text), ['123.', '東京です。']);
    assert.deepEqual(filtered.map(c => c.text), ['東京です。']);
    assert.deepEqual(batches, [['123.', '東京です。'], ['東京です。']]);

    for (const empty of ['', '  \n ', '123.']) {
        assert.deepEqual(await chunkText(empty, assert.fail, { excludeNonLetterSentences: true }), []);
    }
});

function embedPairAt(cosine) {
    return async texts => texts.map(text => text.startsWith('First') ? [1, 0] : [cosine, Math.sqrt(1 - cosine ** 2)]);
}
const embedPair = embedPairAt(0.6);

test('ordinary text and HTML merges default to an inclusive 0.05 cutoff', async () => {
    for (const [cosine, expected] of [[0.049, sentences], [0.05, [pair]]]) {
        const embed = embedPairAt(cosine);
        assert.deepEqual((await chunkText(pair, embed)).map(c => c.text), expected);
        assert.deepEqual((await chunkText('<p>' + pair + '</p>', embed, { inputFormat: 'html' })).map(c => c.text), expected);
    }
});

test('document fallback and Markdown scoring use a 0.5 base', async () => {
    const markdown = sentences.join('\n\n'), large = { inputFormat: 'markdown', chunkingStrategy: 'semantic' };
    for (const [text, options] of [[pair, { mergeThresholdMode: 'document' }],
        [markdown, large], [markdown, { ...large, mergeThresholdMode: 'fixed' }]]) {
        assert.equal((await chunkText(text, embedPairAt(0.49), options)).length, 2);
        assert.equal((await chunkText(text, embedPairAt(0.5), options)).length, 1);
    }
});

test('the base cutoff controls the priority merge and its explicit override wins', async () => {
    assert.deepEqual((await chunkText(pair, embedPair)).map(c => c.text), [pair]);
    assert.deepEqual((await chunkText(pair, embedPair, { similarityThreshold: 0.7 })).map(c => c.text), sentences);
    const options = { similarityThreshold: 0.7, combineChunksSimilarityThreshold: 0.5 };
    assert.deepEqual((await chunkText(pair, embedPair, options)).map(c => c.text), [pair]);
    const textOnly = await chunkText(pair, assert.fail, { combineChunks: false, returnEmbedding: false });
    assert.deepEqual(textOnly, sentences.map(text => ({ text })));
});

test('matching outer sentences stay separate across an unrelated middle sentence', async () => {
    const texts = ['First topic.', 'Other subject.', 'First again.'];
    const { embed, batches } = recordingEmbedder(s => s.startsWith('First') ? [1, 0] : [0, 1]);
    const chunks = await chunkText(texts.join(' '), embed);
    assert.deepEqual(chunks.map(c => c.text), texts);
    assert.deepEqual(batches, [texts]);
});

test('plain text keeps literal markup, entities and Unicode sentence offsets', async () => {
    const texts = ['Use Array<T> here.', 'Keep <b>these tags</b> &amp; names.', 'ß is a letter.', 'Dr. Jones agrees.'];
    const { embed, batches } = recordingEmbedder();
    const chunks = await chunkText(texts.join('  \n'), embed, { combineChunks: false });
    assert.deepEqual(chunks.map(c => c.text), texts);
    assert.deepEqual(batches, [texts]);
});

test('HTML mode extracts each text node once in document order and separates blocks', async () => {
    const input = '<title>Metadata.</title>Intro.<div>Outer.<div>In<em>ner</em> &amp; more.</div>Tail.</div>' +
        '<script>Noise.</script><p hidden>Hidden.</p><style>CSS.</style><template>Template.</template>' +
        '<ul><li>One.</li><li>Two.</li></ul>Outro<br>line.';
    const texts = ['Intro.', 'Outer.', 'Inner & more.', 'Tail.', 'One.', 'Two.', 'Outro line.'];
    const chunks = await chunkText(input, assert.fail, { inputFormat: 'html', combineChunks: false, returnEmbedding: false });
    assert.deepEqual(chunks.map(c => c.text), texts);
    await assert.rejects(chunkText(input, assert.fail, { inputFormat: 'xml' }), /inputFormat/);
});

test('paragraphs, headings and list items become units while soft line wraps stay together', async () => {
    const text = 'Terms\r\n \t\r\n- First condition\r\n  with a continuation\r\n- Second condition\u2029' +
        '# Payment\n1. Due on receipt\n2. Fees waived\n\nProse with a\nsoft wrap.';
    const options = { combineChunks: false, returnEmbedding: false };
    assert.deepEqual((await chunkText(text, assert.fail, options)).map(c => c.text), [
        'Terms', '- First condition with a continuation', '- Second condition', '# Payment',
        '1. Due on receipt', '2. Fees waived', 'Prose with a soft wrap.'
    ]);
    const html = '<h2>Terms</h2><ul><li>First <em>condition</em></li><li>Second condition</li></ul>' +
        '<p>Soft<br>wrap<br><br>New paragraph</p>';
    assert.deepEqual((await chunkText(html, assert.fail, { ...options, inputFormat: 'html' })).map(c => c.text),
        ['Terms', 'First condition', 'Second condition', 'Soft wrap', 'New paragraph']);
    const pre = '<pre>First <code>line</code>\n\nNext line</pre><p>Soft\n\nHTML whitespace</p>';
    assert.deepEqual((await chunkText(pre, assert.fail, { ...options, inputFormat: 'html' })).map(c => c.text),
        ['First line', 'Next line', 'Soft HTML whitespace']);
    const { embed, batches } = recordingEmbedder(() => [1]);
    assert.deepEqual(await chunkText('Title\n\nRelated details', embed, { returnEmbedding: false }), [{ text: 'Title Related details' }]);
    assert.deepEqual(batches, [['Title', 'Related details']]);
});

test('token fallback checks the prefix, preserves every word and batches final vectors', async () => {
    const countTokens = text => text.split(' ').length + 2; // Includes the tokenizer's two special tokens.
    const text = 'red blue green gold silver violet\n\nShort.\n\nEnd.';
    const { embed, batches } = recordingEmbedder(s => [s.length]);
    const chunks = await chunkText(text, embed, {
        maxChunkTokens: 5, countTokens, chunkPrefix: 'Title', excludeChunkPrefixInResults: true
    });
    assert.equal(chunks.map(c => c.text).join(' '), text.replaceAll('\n\n', ' '));
    assert.ok(batches.flat().every(s => countTokens(s) <= 5));
    assert.ok(chunks.every(c => countTokens('Title: ' + c.text) <= 5 && c.embedding[0] === ('Title: ' + c.text).length));
    assert.ok(batches.some(batch => batch.length >= 2));

    const unicode = recordingEmbedder();
    const unbroken = '東京🌍🌗星海雪霞';
    const pieces = await chunkText(unbroken, unicode.embed, { maxChunkTokens: 3, countTokens: s => [...s].length });
    assert.equal(pieces.map(c => c.text).join(''), unbroken);
    assert.ok(pieces.every(c => c.text.isWellFormed() && [...c.text].length <= 3));
    assert.deepEqual(unicode.batches, [pieces.map(c => c.text)]);
});

test('token-limited joins recheck the actual text and batch a newly eligible neighbor', async () => {
    const { embed, batches } = recordingEmbedder(() => [1]);
    const chunks = await chunkText('One. Two. Red.', embed, {
        maxChunkTokens: 3, countTokens: s => s === 'One. Two.' ? 4 : s.split(' ').length, returnEmbedding: false
    });
    assert.deepEqual(chunks, [{ text: 'One. Two. Red.' }]);
    assert.deepEqual(batches, [['Two.', 'Red.'], ['Two. Red.', 'One.']]);

    const run = recordingEmbedder(() => [1]);
    const limited = await chunkText('One. Two. Red.', run.embed, {
        maxChunkSize: Infinity, maxChunkTokens: 2, countTokens: s => s.split(' ').length
    });
    assert.ok(limited.every(c => c.text.split(' ').length <= 2));
    assert.ok(run.batches.flat().every(s => s.split(' ').length <= 2));
});

test('invalid token budgets fail and indivisible text stays available without a vector', async () => {
    for (const n of [0, -1, 0.5, NaN, null]) {
        await assert.rejects(chunkText('', assert.fail, { maxChunkTokens: n }), /maxChunkTokens/);
    }
    await assert.rejects(chunkText('', assert.fail, { maxChunkTokens: 4 }), /countTokens/);
    for (const count of [NaN, -1, 1.5, '2', Promise.resolve(2)]) {
        await assert.rejects(chunkText(pair, assert.fail, { maxChunkTokens: 4, countTokens: () => count }), /countTokens/);
    }
    assert.deepEqual(await chunkText('🌍', assert.fail, {
        maxChunkTokens: 2, countTokens: s => [...s].length, chunkPrefix: 'Title'
    }), [{ text: 'Title: 🌍', tokenLimitExceeded: true }]);
});

test('callbacks can consume or edit their input array without changing cache keys', async () => {
    const texts = ['Echo.', 'A longer echo.', 'Last.', 'Echo.'];
    for (const consume of [true, false]) {
        const batches = [];
        const embed = async batch => {
            batches.push([...batch]);
            if (consume) return batch.splice(0).map(s => [s.length]);
            return batch.map((s, i) => {
                batch[i] = s.toLowerCase();
                return [s.length];
            });
        };
        const chunks = await chunkText(texts.join(' '), embed, { combineChunks: false, maxEmbeddingBatchSize: 2 });
        assert.deepEqual(chunks, texts.map(text => ({ text, embedding: [text.length] })));
        assert.deepEqual(batches.flat(), texts.slice(0, 3));
    }
});

test('duplicate outputs own their vectors, including Buffers and provider scratch space', async () => {
    for (const make of [n => [n], n => Float32Array.of(n), n => Float64Array.of(n), n => Int8Array.of(n), n => Buffer.from([n])]) {
        const scratch = make(0);
        const embed = async ([text]) => {
            scratch[0] = text.length;
            return [scratch];
        };
        const texts = ['Echo.', 'Echo.', 'Different.'];
        const chunks = await chunkText(texts.join(' '), embed, { combineChunks: false, maxEmbeddingBatchSize: 1 });
        assert.deepEqual(chunks.map(c => c.embedding), texts.map(s => make(s.length)));
        chunks[0].embedding[0] = 42;
        assert.deepEqual(chunks[1].embedding, make(texts[1].length));
        assert.deepEqual(scratch, make(texts[2].length));
    }
});

test('cosine cutoffs include parallel vectors at any finite scale and handle zero vectors', async () => {
    for (const [a, b, threshold, joins] of [
        [[1e200, 0], [-1e200, 0], 0.5, false],
        [[Number.MAX_VALUE, Number.MAX_VALUE], [1e-200, 1e-200], 1, true],
        [[Number.MIN_VALUE, 0], [Number.MIN_VALUE, 0], 1, true],
        [[1e-100, 0], [-1e-230, 1], 0, false],
        [[1, 1], [1, 1], 1, true],
        [[1, 0], [1, 0.0001], 1, false],
        [[0, 0], [0, 0], 0.5, false],
        [[0, 0], [1, 1], 0, true],
    ]) {
        const chunks = await chunkText(pair, async () => [a, b], { similarityThreshold: threshold, returnEmbedding: false });
        assert.deepEqual(chunks.map(c => c.text), joins ? [pair] : sentences);
    }
});

test('invalid thresholds and provider limits fail before embedding', async () => {
    for (const key of ['similarityThreshold', 'combineChunksSimilarityThreshold']) {
        for (const value of [NaN, Infinity, -Infinity]) {
            await assert.rejects(chunkText(pair, assert.fail, { [key]: value }), new RegExp(key));
        }
    }
    for (const value of [0, -1, 1.5, NaN]) {
        await assert.rejects(chunkText(pair, assert.fail, { maxEmbeddingBatchSize: value }), /maxEmbeddingBatchSize/);
    }
    const changing = async ([text]) => [text === sentences[0] ? [1] : [1, 1]];
    await assert.rejects(chunkText(pair, changing, { maxEmbeddingBatchSize: 1 }), /dimension 2.*Expected 1/);
});

test('initial merge scoring requests only endpoints of size-eligible boundaries', async () => {
    const texts = ['A long opening.', 'One.', 'Two.', 'A long middle.', 'Red.', 'Sun.', 'A long ending.'];
    const { embed, batches } = recordingEmbedder();
    const options = { maxChunkSize: 9, returnEmbedding: false };
    const chunks = await chunkText(texts.join(' '), embed, options);
    assert.deepEqual(chunks.map(c => c.text), [texts[0], 'One. Two.', texts[3], 'Red. Sun.', texts[6]]);
    assert.deepEqual(batches, [['One.', 'Two.', 'Red.', 'Sun.']]);
    const isolated = { ...options, maxChunkSize: 4 };
    await chunkText(texts.join(' '), assert.fail, isolated);
    const final = recordingEmbedder();
    await chunkText(texts.join(' '), final.embed, { ...isolated, chunkPrefix: 'Doc', returnEmbedding: true });
    assert.deepEqual(final.batches, [texts.map(t => 'Doc: ' + t)]);
});

test('the provider limit applies to initial, intermediate and final vectors with balanced batches', async () => {
    const texts = Array.from({ length: 65 }, (_, i) => 'Item ' + String(i).padStart(2, '0') + '.');
    const options = { maxChunkSize: 4 * texts[0].length + 3, candiateMergesPercentageCap: 100, chunkPrefix: 'Doc' };
    const unbounded = recordingEmbedder(() => [1]);
    const expected = await chunkText(texts.join(' '), unbounded.embed, options);
    assert.deepEqual(unbounded.batches.map(batch => batch.length), [65, 32, 17]);
    for (const cap of [3, 32]) {
        const bounded = recordingEmbedder(() => [1]);
        const chunks = await chunkText(texts.join(' '), bounded.embed, { ...options, maxEmbeddingBatchSize: cap });
        assert.deepEqual(chunks, expected);
        assert.deepEqual(bounded.batches.flat(), unbounded.batches.flat());
        assert.ok(bounded.batches.every(batch => batch.length >= 2 && batch.length <= cap));
    }
});

test('known final vectors share spare scoring capacity using their exact output prefix', async () => {
    const short = ['One.', 'Two.'];
    const isolated = ['Long isolated first.', 'Long isolated second.', 'Long isolated third.'];
    const all = [...short, ...isolated];
    const prefixed = all.map(text => 'Doc: ' + text);
    const vector = text => text === 'Two.' ? [0, 1] : [text.length, 0];
    const options = { maxChunkSize: 9, maxEmbeddingBatchSize: 3, chunkPrefix: 'Doc', excludeChunkPrefixInResults: true };
    const { embed, batches } = recordingEmbedder(vector);
    const chunks = await chunkText(all.join(' '), embed, options);
    assert.deepEqual(chunks, all.map((text, i) => ({ text, embedding: vector(prefixed[i]) })));
    assert.deepEqual(batches, [[...short, prefixed[2]], prefixed.slice(0, 2), prefixed.slice(3)]);

    const full = recordingEmbedder(vector);
    await chunkText(all.join(' '), full.embed, { ...options, maxEmbeddingBatchSize: 2 });
    assert.deepEqual(full.batches[0], short);
    const textOnly = recordingEmbedder(vector);
    await chunkText(all.join(' '), textOnly.embed, { ...options, returnEmbedding: false });
    assert.deepEqual(textOnly.batches, [short]);
});
