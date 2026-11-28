import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { hotpotQuestion, hotpotSource, indexedHits, scoreQuestion, visibleHits } from './json-evidence.mjs';
import { layouts, measureLayouts } from './json-layouts.mjs';

test('JSON release scoring rejects a conflicting embedding model', () => {
    const study = fileURLToPath(new URL('./json-record-study.mjs', import.meta.url));
    // Start beyond the pinned corpus so a regression cannot issue a provider request.
    const result = spawnSync(process.execPath, [study, 'score', 'hotpot', '--start', '1000'], {
        encoding: 'utf8', windowsHide: true, env: { ...process.env, SEMACHUNK_BENCHMARK_MODEL: 'text-embedding-3-large' }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JSON record scoring requires model=text-embedding-3-small/);
});

test('candidate layouts keep parent context inside its record and drop it when the body fits alone', async () => {
    const source = '[{"title":"Q","data":["aaaa","bbbb","cccc"]},{"later":["zzzz","yyyy"],"title":"R"}]';
    const { results } = await layouts(source, ['children', 'packed', 'packed-repeat', 'packed-omit'], 13, 0);
    assert.deepEqual(results.packed, await chunkText(source, { inputFormat: 'json', maxChunkSize: 13 }));
    for (const c of results['packed-repeat']) {
        for (const r of c.sourceRanges) assert.equal(c.text.slice(r.outputStart, r.outputStart + r.end - r.start), source.slice(r.start, r.end));
        if (c.jsonPointer.startsWith('/1')) assert.ok(!c.text.includes('"Q"'));
    }
    assert.ok(results['packed-repeat'].some(c => c.text === '"title":"Q"'));
    assert.ok(results['packed-omit'].every(c => c.text !== '"title":"Q"'));
    const nested = '[{"name":"X","inner":{"id":1,"body":["aaaa","bbbb","cccc"]}}]';
    const got = (await layouts(nested, ['children-repeat'], 14, 0)).results['children-repeat'];
    assert.ok(got.some(c => c.text.startsWith('"id":1\n') && !c.text.includes('"name"')));
    const rows = (await layouts('[{"x":1,"y":[0]}]', ['children-repeat'], 20, 10, s => s.length)).results['children-repeat'];
    assert.ok(rows.some(c => c.text === '"y":[0]'));
    const uneven = (await layouts('[{"n":"X","body":"abc😀"}]', ['children-repeat'], 10, 11,
        s => s.includes('"n"') && s.includes('😀') ? 99 : s.length)).results['children-repeat'];
    assert.ok(uneven.some(c => c.jsonPointer.endsWith('/body') && !c.text.includes('"n"')));
});

test('clipped JSON evidence requires complete spellings and visible title occurrences in the same hit', async () => {
    const item = { id: 'q', question: 'q', context: [['Ç (film)', ['It was a hit.', 'Ç (film) won.']], ['Other', ['It was a hit.']]],
        facts: [['Ç (film)', 0]] };
    const source = hotpotSource(item, 'ascii');
    const { root, results } = await layouts(source, ['children'], 0, 0);
    const q = hotpotQuestion(item, source, root, 'ascii');
    const hits = indexedHits(results.children, source);
    assert.equal(scoreQuestion(q, hits), 1);
    assert.equal(scoreQuestion(q, [[{ from: root.children[0].offset, to: root.children[0].offset + root.children[0].length }]]), 3);
    assert.equal(scoreQuestion(q, [[{ from: root.children[1].offset, to: source.length }]]), 0);
    const a = source.indexOf('\\u00c7');
    const maps = visibleHits(source, 'abc\nxyz', [{ hit: 0, a: 0, b: 3, from: a, to: a + 3 },
        { hit: 0, a: 4, b: 7, from: a + 3, to: a + 6 }]);
    assert.equal(maps[0].length, 2);
    assert.equal(scoreQuestion({ facts: [{ phrase: { a, b: a + 6, atoms: [[a, a + 6]] }, titles: [] }] }, maps), 0);
    assert.equal(scoreQuestion(q, [hits.find(h => h.some(r => r.from >= root.children[1].offset))]), 0);
});

test('the benchmark reference marks an indivisible JSON escape and matches the complete public objects', async () => {
    const source = '"\\u00e9"', count = s => s.length;
    const { results } = await layouts(source, ['packed'], 1024, 1, count);
    assert.deepEqual(results.packed.map(c => [c.text, c.tokenLimitExceeded]), [
        ['"', undefined], ['\\u00e9', true], ['"', undefined]
    ]);
    assert.deepEqual(await chunkText(source, { inputFormat: 'json', maxChunkTokens: 1, countTokens: count }), results.packed);
});

test('identical indexes preserve each layout’s rejected-fragment count', async () => {
    const countTokens = () => 2, vocabulary = new Set();
    const { results } = await layouts('["a","b"]', ['packed', 'children', 'plain'], 1024, 1, countTokens);
    const variants = measureLayouts(results, 1, countTokens, vocabulary);
    assert.deepEqual(variants.map(v => [v.names, v.cost]), [
        [['packed', 'children'], [0, 0, 0, 0, 2]], [['plain'], [0, 0, 0, 0, 1]]
    ]);
    assert.equal(variants[0].hash, variants[1].hash);
    assert.equal(vocabulary.size, 0);
});

test('attribution respects word boundaries, exact occurrences and sentence boundaries in a flattened record', async () => {
    const item = { id: 'id', question: 'lookup', context: [['Small Art', ['Small', 'Art appears.', 'Small Artwork sold.',
        'Small Art sold.', 'Small Art sold.']]], facts: [['Small Art', 2]] };
    const source = hotpotSource(item, 'text'), { root } = await layouts(source, ['children'], 1024, 0);
    const [fact] = hotpotQuestion(item, source, root, 'text').facts;
    assert.equal(fact.titles.length, 3); // The title field and the two whole mentions.
    assert.equal(scoreQuestion({ facts: [fact] }, [[{ from: fact.phrase.a, to: fact.phrase.b }]]), 1);
    const [last] = hotpotQuestion({ ...item, facts: [['Small Art', 4]] }, source, root, 'text').facts;
    const earlier = source.indexOf('Small Art sold.');
    assert.equal(scoreQuestion({ facts: [last] }, [[{ from: earlier, to: earlier + 'Small Art sold.'.length }]]), 0);
    assert.equal(scoreQuestion({ facts: [last] }, [[{ from: last.phrase.a, to: last.phrase.b - 1 }]]), 0);
});
