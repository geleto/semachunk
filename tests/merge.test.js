import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText } from '../src/index.js';

const parallel = async texts => texts.map(() => [1]);
const onePass = { maxUncappedPasses: 1, returnEmbedding: false };

test('the strongest disjoint pairs share a batch before their new scores drive the next pass', async () => {
    const texts = ['Alpha.', 'Bravo.', 'Charlie.', 'Delta.', 'Echo.', 'Foxtrot.', 'Golf.', 'Hotel.'];
    const directions = [[1, 0], [0.8, 0.6], [0.8, 0.6], [0, 1], [0, -1], [-0.8, -0.6], [-0.8, -0.6], [-1, 0]];
    const vectors = new Map(texts.map((text, i) => [text, directions[i]]));
    // BC and FG outrank their outer neighbors. Their new embeddings favor D and E.
    const bc = 'Bravo. Charlie.', fg = 'Foxtrot. Golf.';
    const bcd = bc + ' Delta.', efg = 'Echo. ' + fg;
    for (const text of [bc, bcd]) vectors.set(text, [0, 1]);
    for (const text of [fg, efg]) vectors.set(text, [0, -1]);

    const batches = [];
    const embed = async batch => {
        batches.push([...batch]);
        return batch.map(text => vectors.get(text));
    };
    const chunks = await chunkText(texts.join(' '), embed, { maxUncappedPasses: 2 });
    assert.deepEqual(chunks.map(chunk => chunk.text), ['Alpha.', bcd, efg, 'Hotel.']);
    assert.deepEqual(batches, [texts, [bc, fg], [bcd, efg]]);
});

test('reaching the cap with only overlapping candidates still consumes a pass', async () => {
    for (const maxMergesPerPass of [1, 2]) {
        const chunks = await chunkText('One. Two. Red.', parallel, { ...onePass, maxMergesPerPass });
        assert.deepEqual(chunks.map(c => c.text), ['One. Two.', 'Red.']);
    }
});

test('total pass limit counts capped rounds and still batches the final embeddings', async () => {
    const batches = [];
    const embed = async texts => { batches.push([...texts]); return texts.map(() => [1]); };
    const options = { maxPasses: 1, maxMergesPerPass: 1, maxUncappedPasses: Infinity, chunkPrefix: 'T' };
    const chunks = await chunkText('One. Two. Red. Sun. Cat. Dog.', embed, options);
    const expected = ['T: One. Two.', 'T: Red.', 'T: Sun.', 'T: Cat.', 'T: Dog.'];
    assert.deepEqual(chunks.map(c => c.text), expected);
    assert.deepEqual(batches, [['One.', 'Two.', 'Red.', 'Sun.', 'Cat.', 'Dog.'], expected]);
    assert.deepEqual(await chunkText('One. Two.', assert.fail, {
        maxPasses: 0, mergeThresholdMode: 'document', returnEmbedding: false
    }), [{ text: 'One.' }, { text: 'Two.' }]);
});

test('document cutoff uses the eligible original scores once, then stays fixed', async () => {
    const barrier = 'A much longer standalone heading';
    const pairs = [['One', 'Two'], ['Red', 'Sun'], ['Cat', 'Dog'], ['Tin', 'Box']];
    const sources = pairs.map(p => p.join('\n\n')).join('\n\n' + barrier + '\n\n');
    const cosines = [0.2, 0.45, 0.9, 0.95];
    const vectors = new Map();
    pairs.forEach(([a, b], i) => {
        const c = cosines[i];
        vectors.set(a, [1, 0]);
        vectors.set(b, [c, Math.sqrt(1 - c*c)]);
    });
    const options = { maxChunkSize: 7, mergeThresholdMode: 'document', similarityThreshold: 0.98, returnEmbedding: false };
    for (const groupSentences of [false, true]) {
        const batches = [];
        const embed = async texts => { batches.push([...texts]); return texts.map(s => vectors.get(s)); };
        // The original cutoff is about .469. Recalibrating on just the two weak
        // pairs after the initial grouping would incorrectly admit Red + Sun.
        const result = await chunkText(sources, embed, {
            ...options, groupSentences, dynamicThresholdLowerBound: 0.8, dynamicThresholdUpperBound: 0.8
        });
        assert.deepEqual(result.map(c => c.text), ['One', 'Two', barrier, 'Red', 'Sun', barrier, 'Cat Dog', barrier, 'Tin Box']);
        assert.deepEqual(batches, [pairs.flat()]);
    }
    const embed = async texts => texts.map(s => vectors.get(s));
    const forced = await chunkText(sources, embed, { ...options, combineChunksSimilarityThreshold: 0.94 });
    assert.deepEqual(forced.map(c => c.text).slice(-4), ['Cat', 'Dog', barrier, 'Tin Box']);
    const pair = 'Red\n\nSun';
    assert.equal((await chunkText(pair, embed, options)).length, 2);
    assert.equal((await chunkText(pair, embed, { ...options, similarityThreshold: 0.4 })).length, 1);
    const equal = await chunkText('One\n\nRed\n\nCat', parallel, { ...options, maxPasses: 1 });
    assert.deepEqual(equal.map(c => c.text), ['One Red', 'Cat']);
    await assert.rejects(chunkText('', assert.fail, { mergeThresholdMode: 'median' }), /mergeThresholdMode/);
});

test('genuinely deferred pairs survive a capped pass and win equal-score ties with new pairs', async () => {
    const chunks = await chunkText('One. Two. Red. Sun.', parallel, { ...onePass, maxMergesPerPass: 1 });
    assert.deepEqual(chunks.map(c => c.text), ['One. Two.', 'Red. Sun.']);

    const independent = await chunkText('One. Two. Red. Sun. Cat. Dog.', parallel, {
        ...onePass, maxChunkSize: 9, maxMergesPerPass: 1
    });
    assert.deepEqual(independent.map(c => c.text), ['One. Two.', 'Red. Sun.', 'Cat. Dog.']);
});

test('disabled merge settings skip scoring, and both spellings of the percentage cap work', async () => {
    const text = 'One. Two.';
    const separate = [{ text: 'One.' }, { text: 'Two.' }];
    for (const options of [
        { similarityThreshold: 1.01 }, { maxMergesPerPass: 0 }, { maxUncappedPasses: 0 },
        { candidateMergesPercentageCap: 40, uncappedCandidateMerges: 0 },
        { candiateMergesPercentageCap: 40, uncappedCandidateMerges: 0 }
    ]) {
        assert.deepEqual(await chunkText(text, assert.fail, { ...onePass, ...options }), separate);
    }
    assert.deepEqual(await chunkText(text, parallel, {
        ...onePass, candidateMergesPercentageCap: 100, candiateMergesPercentageCap: 0, uncappedCandidateMerges: 0
    }), [{ text }]);
});

test('size and merge limits reject invalid values before parsing or calling the provider', async () => {
    const counts = ['maxChunkSize', 'maxPasses', 'maxUncappedPasses', 'maxMergesPerPass', 'uncappedCandidateMerges'];
    for (const key of counts) {
        for (const value of [NaN, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
            await assert.rejects(chunkText('', assert.fail, { [key]: value }), { name: 'RangeError', message: new RegExp(key) });
        }
    }
    for (const key of ['candidateMergesPercentageCap', 'candiateMergesPercentageCap']) {
        for (const value of [NaN, Infinity, -1, 100.01, '50', null]) {
            await assert.rejects(chunkText('', assert.fail, { [key]: value }), { name: 'RangeError', message: new RegExp(key) });
        }
    }
    const text = 'One. Two.';
    const unlimited = Object.fromEntries(counts.map(key => [key, Infinity]));
    assert.deepEqual(await chunkText(text, parallel, {
        ...unlimited, returnEmbedding: false, candidateMergesPercentageCap: 0.5, candiateMergesPercentageCap: -1
    }), [{ text }]);
    assert.deepEqual(await chunkText(text, assert.fail, {
        groupSentences: true, maxChunkSize: 0, returnEmbedding: false
    }), [{ text: 'One.' }, { text: 'Two.' }]);
});

test('fractional percentage caps floor the allowed number of merges', async () => {
    const doc = Array.from({ length: 376 }, (_, i) => 'Entry ' + i + '.').join(' ');
    for (const [percent, expected] of [[18.4, 69], [18.3, 68]]) {
        const batches = [];
        const embed = async texts => {
            batches.push(texts.length);
            return texts.map(() => [1]);
        };
        await chunkText(doc, embed, {
            ...onePass, maxChunkSize: Infinity, candidateMergesPercentageCap: percent, uncappedCandidateMerges: 0
        });
        // There are 375 valid boundaries. Each new pair needs an embedding in the next pass.
        assert.deepEqual(batches.slice(0, 2), [376, expected]);
    }
});

// Give every distinct text a reproducible direction, including joined chunks.
function vectorFor(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return Array.from({ length: 5 }, () => {
        hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
        return hash / 2147483648 - 1;
    });
}

// Deliberately recompute every boundary and rebuild the text array on each pass.
function fullRescan(texts, options) {
    let remaining = options.maxUncappedPasses;
    let cutoff = options.similarityThreshold;
    let pass = 0;
    while (remaining > 0 && pass++ < (options.maxPasses ?? Infinity)) {
        const vectors = texts.map(vectorFor);
        const boundaries = [];
        for (let i = 0; i < texts.length - 1; i++) {
            if (texts[i].length + 1 + texts[i + 1].length > options.maxChunkSize) continue;
            const a = vectors[i], b = vectors[i + 1];
            const dot = a.reduce((sum, value, j) => sum + value * b[j], 0);
            const score = dot / (Math.hypot(...a) * Math.hypot(...b));
            boundaries.push({ i, score });
        }
        if (pass === 1 && options.mergeThresholdMode === 'document' && boundaries.length >= 2) {
            const mean = boundaries.reduce((sum, b) => sum + b.score, 0) / boundaries.length;
            const variance = boundaries.reduce((sum, b) => sum + (b.score - mean) ** 2, 0) / boundaries.length;
            cutoff = mean - 0.5 * Math.sqrt(variance);
        }
        const candidates = boundaries.filter(b => b.score >= cutoff);
        candidates.sort((a, b) => b.score - a.score);

        const percent = Math.floor(candidates.length * options.candidateMergesPercentageCap / 100);
        const limit = Math.min(options.maxMergesPerPass, Math.max(percent, options.uncappedCandidateMerges));
        const joins = new Set();
        let deferred = false;
        for (const { i } of candidates) {
            if (joins.has(i - 1) || joins.has(i + 1)) continue;
            if (joins.size >= limit) {
                deferred = true;
                break;
            }
            joins.add(i);
        }
        if (!joins.size) break;
        const next = [];
        for (let i = 0; i < texts.length; i++) {
            if (joins.has(i)) {
                next.push(texts[i] + ' ' + texts[i + 1]);
                i++;
            } else {
                next.push(texts[i]);
            }
        }
        texts = next;
        if (!deferred) remaining--;
    }
    return texts;
}

test('priority merging agrees with a full rescan across 1,000 seeded documents and cap settings', async () => {
    let seed = 7919;
    function random() {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    }

    const embed = async texts => texts.map(vectorFor);
    for (let doc = 0; doc < 1000; doc++) {
        const count = 2 + Math.floor(random() * 24);
        const texts = Array.from({ length: count }, (_, i) => 'Entry ' + doc + ' item ' + i + '.');
        const options = {
            maxChunkSize: 25 + Math.floor(random() * 160),
            similarityThreshold: random() - 0.45,
            maxUncappedPasses: doc % 6,
            maxMergesPerPass: 1 + Math.floor(random() * 8),
            candidateMergesPercentageCap: Math.floor(random() * 101),
            uncappedCandidateMerges: Math.floor(random() * 5),
            returnEmbedding: false
        };
        const chunks = await chunkText(texts.join(' '), embed, options);
        assert.deepEqual(chunks.map(c => c.text), fullRescan(texts, options), 'document ' + doc);
        const adaptive = { ...options, mergeThresholdMode: 'document', maxPasses: doc % 8 };
        const calibrated = await chunkText(texts.join(' '), embed, adaptive);
        assert.deepEqual(calibrated.map(c => c.text), fullRescan(texts, adaptive), 'document cutoff ' + doc);
    }
});
