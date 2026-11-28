import {chunk} from '../src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {splitPassages} from '../src/passages.js';
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
const sentenceOptions = { chunkingStrategy: 'pack', maxChunkSize: 0 };
const semantic = { chunkingStrategy: 'semantic' };

test('omitting the strategy uses blocks in every format, with or without an embedder', async () => {
    const paragraphs = sentences.join('\n\n');
    assert.deepEqual(await splitPassages(paragraphs), [{ text: paragraphs }]);
    for (const [inputFormat, source] of [
        ['text', paragraphs], ['html', '<p>First topic.</p><p>Second topic.</p>'],
        ['markdown', paragraphs], ['json', JSON.stringify(sentences)]
    ]) {
        for (const maxChunkSize of [500, 2048]) {
            const options = { inputFormat, maxChunkSize };
            const expected = await splitPassages(source, undefined, { ...options, chunkingStrategy: 'blocks' });
            assert.equal(expected.length, inputFormat === 'json' ? 2 : 1);
            assert.deepEqual(await splitPassages(source, undefined, options), expected);
            assert.deepEqual(await splitPassages(source, undefined, options), expected);
            assert.deepEqual(await splitPassages(source, assert.fail, { ...options, returnEmbedding: false }), expected);
            const { embed, batches } = recordingEmbedder();
            const indexed = await splitPassages(source, embed, options);
            assert.deepEqual(indexed, expected.map(chunk => ({ ...chunk, embedding: [chunk.text.length, 1] })));
            assert.deepEqual(batches, [expected.map(chunk => chunk.text)]);
        }
    }
});

test('explicit semantic scoring and output vectors require an embedding callback', async () => {
    await assert.rejects(splitPassages(pair, undefined, { chunkingStrategy: 'semantic', returnEmbedding: false }), /embedding callback/i);
    await assert.rejects(splitPassages(pair, undefined, { returnEmbedding: true }), /embedding callback/i);
    await assert.rejects(splitPassages(pair, 42), /embedBatchCallback must be a function/);
});

test('omitted size options use the documented target for every format and strategy', async () => {
    const body = ['Autumn', 'Winter', 'Spring'].map(s => s + ' ' + 'again '.repeat(46) + 'ends.').join(' ');
    const embed = async texts => texts.map(() => [1]);
    for (const inputFormat of ['text', 'html', 'markdown']) {
        const source = inputFormat === 'html' ? '<p>' + body + '</p>' : body;
        for (const chunkingStrategy of ['blocks', 'pack', 'semantic']) {
            const run = size => splitPassages(source, embed, { inputFormat, chunkingStrategy, returnEmbedding: false, ...size });
            const smaller = await run({ maxChunkSize: 500 });
            const larger = await run({ maxChunkSize: 1024 });
            assert.equal(smaller.length, 3);
            assert.equal(larger.length, 1);
            const expected = inputFormat === 'text' ? smaller : larger;
            assert.deepEqual(await run(), expected, inputFormat + '/' + chunkingStrategy);
            assert.deepEqual(await run({ maxChunkTokens: 256, countTokens: s => s.trim().split(/\s+/u).length }), expected);
            if (chunkingStrategy === 'blocks') assert.deepEqual(await run({ chunkingStrategy: undefined }), expected);
        }
    }
});

test('a token cap supplements the default character target and can be used on its own', async () => {
    const text = [1, 2, 3].map(i => 'Sentence ' + i + ' ' + 'a'.repeat(250) + '.').join(' ');
    const pack = sizes => splitPassages(text, assert.fail, { chunkingStrategy: 'pack', returnEmbedding: false,
        maxChunkTokens: 9, countTokens: s => s.split(' ').length, ...sizes });
    assert.equal((await pack()).length, 3);
    assert.deepEqual(await pack({ maxChunkSize: Infinity }), [{ text }]);
    assert.equal((await pack({ maxChunkSize: Infinity, maxChunkTokens: 6 })).length, 2);
});

test('blocks, pack and semantic layouts apply different boundaries to the same text and HTML', async () => {
    const source = 'One. Two.\n\nRed. Sun.';
    for (const [inputFormat, text] of [['text', source], ['html', '<p>One. <b>Two.</b></p><p>Red.<br>Sun.</p>']]) {
        const run = (strategy, embed, extra) => splitPassages(text, embed, { inputFormat, maxChunkSize: 14,
            returnEmbedding: false, chunkingStrategy: strategy, ...extra }).then(rows => rows.map(c => c.text));
        assert.deepEqual(await run('blocks', assert.fail), ['One. Two.', 'Red. Sun.']);
        assert.deepEqual(await run('blocks', assert.fail, { maxChunkSize: 5 }), ['One.', 'Two.', 'Red.', 'Sun.']);
        assert.deepEqual(await run('pack', assert.fail), inputFormat === 'html'
            ? ['One. Two.', 'Red. Sun.'] : ['One. Two. Red.', 'Sun.']);
        const { embed, batches } = recordingEmbedder(s => /One|Two/.test(s) ? [1, 0] : [0, 1]);
        assert.deepEqual(await run('semantic', embed, { similarityThreshold: 0.9 }), ['One. Two.', 'Red. Sun.']);
        assert.ok(batches.length);
    }
    const filtered = await splitPassages('42.\n\nDr. Smith signed. Fees apply.', assert.fail, {
        chunkingStrategy: 'blocks', excludeNonLetterSentences: true, returnEmbedding: false
    });
    assert.deepEqual(filtered, [{ text: 'Dr. Smith signed. Fees apply.' }]);
});

test('packing repeats only fitting whole sentences and always advances', async () => {
    const text = 'One. Two. Red. Sun. End.';
    const pack = (chunkOverlap, extra) => splitPassages(text, assert.fail, { maxChunkSize: 14, chunkingStrategy: 'pack',
        returnEmbedding: false, chunkOverlap, ...extra }).then(rows => rows.map(c => c.text));
    assert.deepEqual(await pack(3), ['One. Two. Red.', 'Sun. End.']);
    assert.deepEqual(await pack(4), ['One. Two. Red.', 'Red. Sun. End.']);
    assert.deepEqual(await pack(99), ['One. Two. Red.', 'Two. Red. Sun.', 'Red. Sun. End.']);
    assert.deepEqual(await pack(99, { maxChunkSize: 0 }), ['One.', 'Two.', 'Red.', 'Sun.', 'End.']);
    assert.deepEqual(await pack(99, { maxChunkSize: Infinity }), [text]);
    assert.deepEqual(await splitPassages('', assert.fail, { chunkingStrategy: 'pack', chunkOverlap: 12 }), []);
});

test('token overlap counts the actual suffix and the prefix still fits every final embedding', async () => {
    const text = 'One. Two. Red. Sun. End.';
    const countTokens = s => s === 'Two. Red.' ? 3 : s.split(' ').length;
    const { embed, batches } = recordingEmbedder(s => [s.length]);
    const rows = await splitPassages(text, embed, {
        chunkingStrategy: 'pack', maxChunkSize: Infinity, maxChunkTokens: 4, countTokens, chunkOverlap: 2,
        chunkPrefix: 'P', excludeChunkPrefixInResults: true, maxEmbeddingBatchSize: 2
    });
    const bodies = ['One. Two. Red.', 'Red. Sun. End.'];
    assert.deepEqual(rows.map(c => c.text), bodies);
    assert.deepEqual(batches, [bodies.map(s => 'P: ' + s)]);
    assert.ok(batches.flat().every(s => countTokens(s) <= 4));
    for (const strategy of ['blocks', 'pack']) {
        const chunks = await splitPassages('東京🌍星海雪霞', assert.fail, { chunkingStrategy: strategy, maxChunkTokens: 3,
            countTokens: s => [...s].length, chunkOverlap: strategy === 'pack' ? 1 : 0, returnEmbedding: false });
        assert.equal(chunks.map(c => c.text).join(''), '東京🌍星海雪霞');
        assert.ok(chunks.every(c => c.text.isWellFormed() && [...c.text].length <= 3));
    }
});

test('invalid strategies and unusable overlap settings fail before embedding', async () => {
    for (const value of ['auto', 'recursive', '', null]) {
        await assert.rejects(splitPassages('', assert.fail, { chunkingStrategy: value }), /strategy/);
    }
    for (const value of [-1, 0.5, Infinity, NaN, '4']) {
        await assert.rejects(splitPassages('', assert.fail, { chunkingStrategy: 'pack', chunkOverlap: value }), /chunkOverlap/);
    }
    for (const options of [{}, { chunkingStrategy: 'blocks' }, { chunkingStrategy: 'semantic' }]) {
        await assert.rejects(splitPassages('', assert.fail, { ...options, chunkOverlap: 1 }), /chunkOverlap/);
    }
});

test('the retired strategy name is rejected before embedding', async () => {
    for (const format of ['text', 'html', 'markdown', 'json']) {
        await assert.rejects(chunk('[]', {format, strategy:'semantic-blocks', embedBatch:assert.fail}), /strategy/i);
    }
});

test('invalid character sizes fail before parsing or embedding', async () => {
    for (const maxChunkSize of [NaN, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
        await assert.rejects(splitPassages('', assert.fail, { maxChunkSize }), /maxChunkSize/);
    }
});

test('a finite cache retains only the most recent entries between scoring batches', async () => {
    const { embed, batches } = recordingEmbedder(s => Float32Array.of(s.length));
    const cached = createBatchEmbedder(embed, 2, 1);
    const first = await cached(['A', 'BB', 'CCC', 'A']);
    assert.deepEqual(first.map(v => v[0]), [1, 2, 3, 1]);
    await cached(['CCC', 'BB']);
    await cached(['BB', 'A']);
    assert.deepEqual(batches, [['A', 'BB'], ['CCC'], ['BB'], ['A']]);
    for (const limit of [0, 1, Infinity]) {
        const { embed } = recordingEmbedder(() => Float32Array.of(3, 4));
        const chunks = await splitPassages('One. Two. Red. Sun.', embed, { ...semantic, maxChunkSize: 9, maxCachedEmbeddings: limit });
        assert.deepEqual(chunks.map(c => c.text), ['One. Two.', 'Red. Sun.']);
        assert.deepEqual(chunks.map(c => c.embedding), [Float32Array.of(3, 4), Float32Array.of(3, 4)]);
    }
    await assert.rejects(splitPassages('', embed, { maxCachedEmbeddings: -1 }), /maxCachedEmbeddings/);
});

test('the requested sentence locale controls abbreviation handling', async () => {
    const text = 'Hable con la Sra. García. Vuelva luego.';
    const options = { ...sentenceOptions, returnEmbedding: false };
    const segment = async locale => (await splitPassages(text, assert.fail, { ...options, locale })).map(c => c.text);
    assert.deepEqual(await segment('es'), ['Hable con la Sra. García.', 'Vuelva luego.']);
    assert.deepEqual(await segment('en'), ['Hable con la Sra.', 'García.', 'Vuelva luego.']);
    await assert.rejects(splitPassages('', assert.fail, { locale: 'bad locale' }), RangeError);
});

test('semantic splitting embeds the joined output text', async () => {
    const { embed, batches } = recordingEmbedder();
    const chunks = await splitPassages(pair, embed, semantic);
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
        const chunks = await splitPassages(original.join(' '), embed, {
            ...sentenceOptions, chunkPrefix: prefix, excludeChunkPrefixInResults: hide
        });
        assert.deepEqual(batches, [prefixed]);
        assert.deepEqual(chunks.map(c => c.text), hide ? original : prefixed);
        assert.deepEqual(chunks.map(c => c.embedding), prefixed.map(s => [s.length, 1]));
    }
});

test('a terminal merge embeds only the requested final representation', async () => {
    const { embed, batches } = recordingEmbedder();
    const options = { ...semantic, chunkPrefix: 'Topic', excludeChunkPrefixInResults: true };
    const prefixed = 'Topic: ' + pair;
    assert.deepEqual(await splitPassages(pair, embed, options), [
        { text: pair, embedding: [prefixed.length, 1] }
    ]);
    assert.deepEqual(batches, [sentences, [prefixed]]);

    const textOnly = recordingEmbedder();
    assert.deepEqual(await splitPassages(pair, textOnly.embed, { ...options, returnEmbedding: false }), [{ text: pair }]);
    assert.deepEqual(textOnly.batches, [sentences]);
});

test('size-limited final chunks with a prefix are embedded together', async () => {
    const { embed, batches } = recordingEmbedder();
    const texts = ['One.', 'Two.', 'Red.', 'Sun.'];
    const chunks = await splitPassages(texts.join(' '), embed, { ...semantic, maxChunkSize: 9, chunkPrefix: 'Topic' });
    const finals = ['Topic: One. Two.', 'Topic: Red. Sun.'];
    assert.deepEqual(chunks, finals.map(text => ({ text, embedding: [text.length, 1] })));
    assert.deepEqual(batches, [texts, finals]);
});

test('a repeated sentence and a repeated merged chunk are each embedded once per call', async () => {
    const text = 'An echo. An echo. An echo. An echo.';
    const merged = 'An echo. An echo.';
    const { embed, batches } = recordingEmbedder();
    const options = { ...semantic, maxChunkSize: merged.length };
    for (let call = 0; call < 2; call++) {
        const chunks = await splitPassages(text, embed, options);
        assert.deepEqual(chunks, Array(2).fill({ text: merged, embedding: [merged.length, 1] }));
    }
    assert.deepEqual(batches, [['An echo.'], [merged], ['An echo.'], [merged]]);
});

test('deduplication restores source order and preserves typed vectors', async () => {
    const { embed, batches } = recordingEmbedder(s => new Float32Array([s.length]));
    const chunks = await splitPassages('One. Other. One.', embed, sentenceOptions);
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
        await assert.rejects(splitPassages(pair, async () => result, sentenceOptions), message);
    }
    const changesDimension = async texts => texts.map(() => texts.length === 2 ? [1, 0] : [1]);
    await assert.rejects(splitPassages(pair, changesDimension, semantic), /dimension 1.*Expected 2/);

    const three = 'First topic. Second topic. Third topic.';
    await assert.rejects(splitPassages(three, async texts => texts.length === 3 ? texts.map(() => [1]) : [], semantic), /Expected 1, received 0/);
});

test('the Unicode letter filter is optional and runs before embedding', async () => {
    const text = '123. 東京です。';
    const { embed, batches } = recordingEmbedder();
    const keep = await splitPassages(text, embed, sentenceOptions);
    const filtered = await splitPassages(text, embed, { ...sentenceOptions, excludeNonLetterSentences: true });
    assert.deepEqual(keep.map(c => c.text), ['123.', '東京です。']);
    assert.deepEqual(filtered.map(c => c.text), ['東京です。']);
    assert.deepEqual(batches, [['123.', '東京です。'], ['東京です。']]);

    for (const empty of ['', '  \n ', '123.']) {
        assert.deepEqual(await splitPassages(empty, assert.fail, { excludeNonLetterSentences: true }), []);
    }
});

function embedPairAt(cosine) {
    return async texts => texts.map(text => text.startsWith('First') ? [1, 0] : [cosine, Math.sqrt(1 - cosine ** 2)]);
}
const embedPair = embedPairAt(0.6);

test('semantic splitting uses an inclusive 0.15 cutoff in plain text and HTML', async () => {
    for (const [cosine, expected] of [[0.149, sentences], [0.15, [pair]]]) {
        const embed = embedPairAt(cosine);
        assert.deepEqual((await splitPassages(pair, embed, semantic)).map(c => c.text), expected);
        assert.deepEqual((await splitPassages('<p>' + pair + '</p>', embed, { ...semantic, inputFormat: 'html' })).map(c => c.text), expected);
    }
});

test('document calibration falls back to 0.5 with one eligible pair', async () => {
    const markdown = sentences.join('\n\n'), large = { inputFormat: 'markdown', chunkingStrategy: 'semantic' };
    for (const [text, options] of [[pair, { ...semantic, mergeThresholdMode: 'document' }],
        [markdown, { ...large, mergeThresholdMode: 'document' }]]) {
        assert.equal((await splitPassages(text, embedPairAt(0.49), options)).length, 2);
        assert.equal((await splitPassages(text, embedPairAt(0.5), options)).length, 1);
    }
});

test('the hierarchical cutoff accepts an explicit fixed override', async () => {
    assert.deepEqual((await splitPassages(pair, embedPair, semantic)).map(c => c.text), [pair]);
    assert.deepEqual((await splitPassages(pair, embedPair, { ...semantic, similarityThreshold: 0.7 })).map(c => c.text), sentences);
    const options = { ...semantic, similarityThreshold: 0.7, combineChunksSimilarityThreshold: 0.5 };
    assert.deepEqual((await splitPassages(pair, embedPair, options)).map(c => c.text), [pair]);
    const textOnly = await splitPassages(pair, assert.fail, { ...sentenceOptions, returnEmbedding: false });
    assert.deepEqual(textOnly, sentences.map(text => ({ text })));
});

test('matching outer sentences stay separate across an unrelated middle sentence', async () => {
    const texts = ['First topic.', 'Other subject.', 'First again.'];
    const { embed, batches } = recordingEmbedder(s => s.startsWith('First') ? [1, 0] : [0, 1]);
    const chunks = await splitPassages(texts.join(' '), embed, semantic);
    assert.deepEqual(chunks.map(c => c.text), texts);
    assert.deepEqual(batches, [texts]);
});

test('plain text keeps literal markup, entities and Unicode sentence offsets', async () => {
    const texts = ['Use Array<T> here.', 'Keep <b>these tags</b> &amp; names.', 'ß is a letter.', 'Dr. Jones agrees.'];
    const { embed, batches } = recordingEmbedder();
    const chunks = await splitPassages(texts.join('  \n'), embed, sentenceOptions);
    assert.deepEqual(chunks.map(c => c.text), texts);
    assert.deepEqual(batches, [texts]);
});

test('HTML mode extracts each text node once in document order and separates blocks', async () => {
    const input = '<title>Metadata.</title>Intro.<div>Outer.<div>In<em>ner</em> &amp; more.</div>Tail.</div>' +
        '<script>Noise.</script><p hidden>Hidden.</p><style>CSS.</style><template>Template.</template>' +
        '<ul><li>One.</li><li>Two.</li></ul>Outro<br>line.';
    const texts = ['Intro.', 'Outer.', 'Inner & more.', 'Tail.', 'One.', 'Two.', 'Outro line.'];
    const chunks = await splitPassages(input, assert.fail, { inputFormat: 'html', ...sentenceOptions, returnEmbedding: false });
    assert.deepEqual(chunks.map(c => c.text), texts);
    await assert.rejects(splitPassages(input, assert.fail, { inputFormat: 'xml' }), /inputFormat/);
});

test('paragraphs, headings and list items become units while soft line wraps stay together', async () => {
    const text = 'Terms\r\n \t\r\n- First condition\r\n  with a continuation\r\n- Second condition\u2029' +
        '# Payment\n1. Due on receipt\n2. Fees waived\n\nProse with a\nsoft wrap.';
    const options = { ...sentenceOptions, returnEmbedding: false };
    assert.deepEqual((await splitPassages(text, assert.fail, options)).map(c => c.text), [
        'Terms', '- First condition with a continuation', '- Second condition', '# Payment',
        '1. Due on receipt', '2. Fees waived', 'Prose with a soft wrap.'
    ]);
    const html = '<h2>Terms</h2><ul><li>First <em>condition</em></li><li>Second condition</li></ul>' +
        '<p>Soft<br>wrap<br><br>New paragraph</p>';
    assert.deepEqual((await splitPassages(html, assert.fail, { ...options, inputFormat: 'html' })).map(c => c.text),
        ['Terms\n\nFirst condition', 'Second condition', 'Soft wrap', 'New paragraph']);
    const pre = '<pre>First <code>line</code>\n\nNext line</pre><p>Soft\n\nHTML whitespace</p>';
    assert.deepEqual((await splitPassages(pre, assert.fail, { ...options, inputFormat: 'html' })).map(c => c.text),
        ['First line\n\nNext line', 'Soft HTML whitespace']);
    const { embed, batches } = recordingEmbedder(() => [1]);
    assert.deepEqual(await splitPassages('Title\n\nRelated details', embed, { ...semantic, returnEmbedding: false }), [{ text: 'Title\n\nRelated details' }]);
    assert.deepEqual(batches, [['Title', 'Related details']]);
});

test('token fallback checks the prefix, preserves every word and batches final vectors', async () => {
    const countTokens = text => text.split(' ').length + 2; // Includes the tokenizer's two special tokens.
    const text = 'red blue green gold silver violet\n\nShort.\n\nEnd.';
    const { embed, batches } = recordingEmbedder(s => [s.length]);
    const chunks = await splitPassages(text, embed, {
        ...semantic, maxChunkTokens: 5, countTokens, chunkPrefix: 'Title', excludeChunkPrefixInResults: true
    });
    assert.deepEqual(chunks.flatMap(c => c.text.split(/\s+/u)), text.split(/\s+/u));
    assert.ok(batches.flat().every(s => countTokens(s) <= 5));
    assert.ok(chunks.every(c => countTokens('Title: ' + c.text) <= 5 && c.embedding[0] === ('Title: ' + c.text).length));
    assert.ok(batches.some(batch => batch.length >= 2));

    const unicode = recordingEmbedder();
    const unbroken = '東京🌍🌗星海雪霞';
    const pieces = await splitPassages(unbroken, unicode.embed, { maxChunkTokens: 3, countTokens: s => [...s].length });
    assert.equal(pieces.map(c => c.text).join(''), unbroken);
    assert.ok(pieces.every(c => c.text.isWellFormed() && [...c.text].length <= 3));
    assert.deepEqual(unicode.batches, [pieces.map(c => c.text)]);
});

test('hierarchical joins enforce the token limit at a scored boundary', async () => {
    const { embed, batches } = recordingEmbedder(() => [1]);
    const chunks = await splitPassages('One. Two. Red.', embed, {
        ...semantic, maxChunkTokens: 3, countTokens: s => s === 'One. Two.' ? 4 : s.split(' ').length, returnEmbedding: false
    });
    assert.deepEqual(chunks, [{ text: 'One.' }, { text: 'Two. Red.' }]);
    assert.deepEqual(batches, [['Two.', 'Red.']]);

    const run = recordingEmbedder(() => [1]);
    const limited = await splitPassages('One. Two. Red.', run.embed, {
        ...semantic, maxChunkSize: Infinity, maxChunkTokens: 2, countTokens: s => s.split(' ').length
    });
    assert.ok(limited.every(c => c.text.split(' ').length <= 2));
    assert.ok(run.batches.flat().every(s => s.split(' ').length <= 2));
});

test('invalid token budgets fail and indivisible text stays available without a vector', async () => {
    for (const n of [0, -1, 0.5, NaN, null]) {
        await assert.rejects(splitPassages('', assert.fail, { maxChunkTokens: n }), /maxChunkTokens/);
    }
    await assert.rejects(splitPassages('', assert.fail, { maxChunkTokens: 4 }), /countTokens/);
    for (const count of [NaN, -1, 1.5, '2', Promise.resolve(2)]) {
        await assert.rejects(splitPassages(pair, assert.fail, { maxChunkTokens: 4, countTokens: () => count }), /countTokens/);
    }
    assert.deepEqual(await splitPassages('🌍', assert.fail, {
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
        const chunks = await splitPassages(texts.join(' '), embed, { ...sentenceOptions, maxEmbeddingBatchSize: 2 });
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
        const chunks = await splitPassages(texts.join(' '), embed, { ...sentenceOptions, maxEmbeddingBatchSize: 1 });
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
        const chunks = await splitPassages(pair, async () => [a, b], { ...semantic, similarityThreshold: threshold, returnEmbedding: false });
        assert.deepEqual(chunks.map(c => c.text), joins ? [pair] : sentences);
    }
});

test('invalid thresholds and provider limits fail before embedding', async () => {
    for (const key of ['similarityThreshold', 'combineChunksSimilarityThreshold']) {
        for (const value of [NaN, Infinity, -Infinity]) {
            await assert.rejects(splitPassages(pair, assert.fail, { [key]: value }), new RegExp(key));
        }
    }
    for (const value of [0, -1, 1.5, NaN]) {
        await assert.rejects(splitPassages(pair, assert.fail, { maxEmbeddingBatchSize: value }), /maxEmbeddingBatchSize/);
    }
    const changing = async ([text]) => [text === sentences[0] ? [1] : [1, 1]];
    await assert.rejects(splitPassages(pair, changing, { ...semantic, maxEmbeddingBatchSize: 1 }), /dimension 2.*Expected 1/);
});

test('initial merge scoring requests only endpoints of size-eligible boundaries', async () => {
    const texts = ['A long opening.', 'One.', 'Two.', 'A long middle.', 'Red.', 'Sun.', 'A long ending.'];
    const { embed, batches } = recordingEmbedder();
    const options = { ...semantic, maxChunkSize: 9, returnEmbedding: false };
    const chunks = await splitPassages(texts.join(' '), embed, options);
    assert.deepEqual(chunks.map(c => c.text), [texts[0], 'One. Two.', texts[3], 'Red. Sun.', texts[6]]);
    assert.deepEqual(batches, [['One.', 'Two.', 'Red.', 'Sun.']]);
    const isolated = { ...options, maxChunkSize: 4 };
    await splitPassages(texts.join(' '), assert.fail, isolated);
    const final = recordingEmbedder();
    await splitPassages(texts.join(' '), final.embed, { ...isolated, chunkPrefix: 'Doc', returnEmbedding: true });
    assert.deepEqual(final.batches, [texts.map(t => 'Doc: ' + t)]);
});

test('the provider limit applies to boundary and output vectors with balanced batches', async () => {
    const texts = Array.from({ length: 65 }, (_, i) => 'Item ' + String(i).padStart(2, '0') + '.');
    const options = { ...semantic, maxChunkSize: 4 * texts[0].length + 3, chunkPrefix: 'Doc' };
    const unbounded = recordingEmbedder(() => [1]);
    const expected = await splitPassages(texts.join(' '), unbounded.embed, options);
    assert.deepEqual(unbounded.batches.map(batch => batch.length), [65, 17]);
    for (const cap of [3, 32]) {
        const bounded = recordingEmbedder(() => [1]);
        const chunks = await splitPassages(texts.join(' '), bounded.embed, { ...options, maxEmbeddingBatchSize: cap });
        assert.deepEqual(chunks, expected);
        assert.deepEqual(bounded.batches.flat(), unbounded.batches.flat());
        assert.ok(bounded.batches.every(batch => batch.length >= 2 && batch.length <= cap));
    }
});
