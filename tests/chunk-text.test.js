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

// The two initial vectors have cosine 0.6.
const embedPair = async texts => texts.map(text => text.startsWith('First') ? [1, 0] : [0.6, 0.8]);

test('the base cutoff controls the priority merge and its explicit override wins', async () => {
    assert.deepEqual((await chunkText(pair, embedPair)).map(c => c.text), [pair]);
    assert.deepEqual((await chunkText(pair, embedPair, { similarityThreshold: 0.7 })).map(c => c.text), sentences);
    const options = { similarityThreshold: 0.7, combineChunksSimilarityThreshold: 0.5 };
    assert.deepEqual((await chunkText(pair, embedPair, options)).map(c => c.text), [pair]);
    const textOnly = await chunkText(pair, assert.fail, { combineChunks: false, returnEmbedding: false });
    assert.deepEqual(textOnly, sentences.map(text => ({ text })));
});

test('one eligible boundary uses the inclusive base cutoff clamped to the configured bounds', async () => {
    const options = { groupSentences: true, combineChunks: false, similarityThreshold: 0.6 };
    const grouped = await chunkText(pair, embedPair, { ...options, maxChunkSize: pair.length });
    assert.deepEqual(grouped, [{ text: pair, embedding: [1, 0] }]);
    for (const changes of [
        { similarityThreshold: 0.65 },
        { dynamicThresholdLowerBound: 0.61 },
        { dynamicThresholdLowerBound: 0.61, dynamicThresholdUpperBound: 0.61 },
        { maxChunkSize: pair.length - 1 }
    ]) {
        assert.deepEqual((await chunkText(pair, embedPair, { ...options, ...changes })).map(c => c.text), sentences);
    }
    const clamped = { ...options, similarityThreshold: 0.95, dynamicThresholdUpperBound: 0.59 };
    assert.deepEqual((await chunkText(pair, embedPair, clamped)).map(c => c.text), [pair]);
});

test('the adjusted grouping cutoff includes equal scores and respects higher bounds', async () => {
    const texts = ['First topic.', 'Second topic.', 'First again.'];
    const embed = async batch => batch.map(s => s.startsWith('First') ? [10, 0, 0, 0] : [7, 7, 1, 1]);
    // Both original boundaries score exactly 0.7. Low variance subtracts 0.1.
    const options = { groupSentences: true, combineChunks: false, returnEmbedding: false, similarityThreshold: 0.8 };
    const run = async changes => (await chunkText(texts.join(' '), embed, { ...options, ...changes })).map(c => c.text);
    assert.deepEqual(await run({}), [texts.join(' ')]);
    assert.deepEqual(await run({ similarityThreshold: 0.81 }), texts);
    assert.deepEqual(await run({ dynamicThresholdLowerBound: 0.71 }), texts);
});

test('grouping batches eligible endpoints and excludes an unjoinable boundary between two embedded sentences', async () => {
    const texts = ['Oversized opening sentence.', 'One.', 'Longleft.', 'Longright.', 'Two.', 'Oversized closing sentence.'];
    const vectors = new Map([['One.', [8, 15]], ['Longleft.', [1, 0]], ['Longright.', [-1, 0]], ['Two.', [-8, 15]]]);
    const { embed, batches } = recordingEmbedder(s => vectors.get(s));
    // The two eligible scores are 8/17. Counting the middle score (-1) would raise the cutoff.
    const chunks = await chunkText(texts.join(' '), embed, {
        groupSentences: true, combineChunks: false, returnEmbedding: false, maxChunkSize: 15
    });
    assert.deepEqual(chunks.map(c => c.text), [texts[0], 'One. Longleft.', 'Longright. Two.', texts[5]]);
    assert.deepEqual(batches, [texts.slice(1, 5)]);
});

test('matching outer sentences stay separate across an unrelated middle sentence', async () => {
    const texts = ['First topic.', 'Other subject.', 'First again.'];
    for (const combineChunks of [false, true]) {
        const { embed, batches } = recordingEmbedder(s => s.startsWith('First') ? [1, 0] : [0, 1]);
        const chunks = await chunkText(texts.join(' '), embed, { groupSentences: true, combineChunks });
        assert.deepEqual(chunks.map(c => c.text), texts);
        assert.deepEqual(batches, [texts]);
    }
});

test('the adaptive cutoff uses the distribution of adjacent sentence scores', async () => {
    const texts = ['Alpha one.', 'Beta one.', 'Alpha two.', 'Beta two.'];
    // Every boundary has cosine 8/17. Zero variance lowers the default cutoff to 0.4.
    const { embed, batches } = recordingEmbedder(s => s.startsWith('Alpha') ? [1, 0] : [8, 15]);
    const chunks = await chunkText(texts.join(' '), embed, {
        groupSentences: true, combineChunks: false, returnEmbedding: false
    });
    assert.deepEqual(chunks, [{ text: texts.join(' ') }]);
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
    for (const groupSentences of [false, true]) {
        const { embed, batches } = recordingEmbedder(s => [s.length]);
        const chunks = await chunkText(text, embed, {
            groupSentences, maxChunkTokens: 5, countTokens, chunkPrefix: 'Title', excludeChunkPrefixInResults: true
        });
        assert.equal(chunks.map(c => c.text).join(' '), text.replaceAll('\n\n', ' '));
        assert.ok(batches.flat().every(s => countTokens(s) <= 5));
        assert.ok(chunks.every(c => countTokens('Title: ' + c.text) <= 5 && c.embedding[0] === ('Title: ' + c.text).length));
        assert.ok(batches.some(batch => batch.length >= 2));
    }
    const { embed, batches } = recordingEmbedder();
    const unbroken = '東京🌍🌗星海雪霞';
    const chunks = await chunkText(unbroken, embed, { maxChunkTokens: 3, countTokens: s => [...s].length });
    assert.equal(chunks.map(c => c.text).join(''), unbroken);
    assert.ok(chunks.every(c => c.text.isWellFormed() && [...c.text].length <= 3));
    assert.deepEqual(batches, [chunks.map(c => c.text)]);
});

test('token-limited joins recheck the actual text and batch a newly eligible neighbor', async () => {
    const { embed, batches } = recordingEmbedder(() => [1]);
    const chunks = await chunkText('One. Two. Red.', embed, {
        maxChunkTokens: 3, countTokens: s => s === 'One. Two.' ? 4 : s.split(' ').length, returnEmbedding: false
    });
    assert.deepEqual(chunks, [{ text: 'One. Two. Red.' }]);
    assert.deepEqual(batches, [['Two.', 'Red.'], ['Two. Red.', 'One.']]);

    for (const groupSentences of [false, true]) {
        const run = recordingEmbedder(() => [1]);
        const chunks = await chunkText('One. Two. Red.', run.embed, {
            groupSentences, maxChunkSize: Infinity, maxChunkTokens: 2, countTokens: s => s.split(' ').length
        });
        assert.ok(chunks.every(c => c.text.split(' ').length <= 2));
        assert.ok(run.batches.flat().every(s => s.split(' ').length <= 2));
    }
});

test('invalid token budgets and unrepresentable input fail before embedding', async () => {
    for (const n of [0, -1, 0.5, NaN, null]) {
        await assert.rejects(chunkText('', assert.fail, { maxChunkTokens: n }), /maxChunkTokens/);
    }
    await assert.rejects(chunkText('', assert.fail, { maxChunkTokens: 4 }), /countTokens/);
    for (const count of [NaN, -1, 1.5, '2', Promise.resolve(2)]) {
        await assert.rejects(chunkText(pair, assert.fail, { maxChunkTokens: 4, countTokens: () => count }), /countTokens/);
    }
    await assert.rejects(chunkText('🌍', assert.fail, {
        maxChunkTokens: 2, countTokens: s => [...s].length, chunkPrefix: 'Title'
    }), /cannot fit one Unicode code point/);
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

test('invalid thresholds, reversed bounds and invalid provider limits fail before embedding', async () => {
    for (const key of ['similarityThreshold', 'combineChunksSimilarityThreshold', 'dynamicThresholdLowerBound', 'dynamicThresholdUpperBound']) {
        for (const value of [NaN, Infinity, -Infinity]) {
            await assert.rejects(chunkText(pair, assert.fail, { [key]: value }), new RegExp(key));
        }
    }
    await assert.rejects(chunkText(pair, assert.fail, {
        dynamicThresholdLowerBound: 0.7, dynamicThresholdUpperBound: 0.6
    }), /dynamicThresholdLowerBound/);
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
    for (const groupSentences of [true, false]) {
        const isolated = { ...options, maxChunkSize: 4, groupSentences };
        await chunkText(texts.join(' '), assert.fail, isolated);
        const final = recordingEmbedder();
        await chunkText(texts.join(' '), final.embed, { ...isolated, chunkPrefix: 'Doc', returnEmbedding: true });
        assert.deepEqual(final.batches, [texts.map(t => 'Doc: ' + t)]);
    }
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

test('adaptive grouping rejects gradual topic drift using the existing sentence batch', async () => {
    const texts = ['East.', 'Northeast.', 'Northwest.', 'West.'];
    const vectors = [[1e-200, 0], [1e200, Math.sqrt(3) * 1e200], [-1, Math.sqrt(3)], [-1, 0]];
    const { embed, batches } = recordingEmbedder(s => vectors[texts.indexOf(s)]);
    const chunks = await chunkText(texts.join(' '), embed, { groupSentences: true, combineChunks: false, returnEmbedding: false });
    assert.deepEqual(chunks.map(c => c.text), ['East. Northeast.', 'Northwest. West.']);
    assert.deepEqual(batches, [texts]);
});
