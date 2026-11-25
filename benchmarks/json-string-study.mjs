import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTree } from 'jsonc-parser';
import { packedRanges } from '../src/packing.js';
import { sentenceEnds } from '../src/sentences.js';
import { splitSpans } from '../src/token-limit.js';
import { asset, assets, cache, sha256, utf16Offsets } from './corpora.mjs';
import { denseRanker } from './chunking.mjs';
import { deliver } from './delivered-context.mjs';
import { dimension, model, openReplay } from './encoder.mjs';
import { records, queries, proseCount } from './json-field-corpus.mjs';

const size = 1024, topK = 5;
const identifierAudit = process.argv.includes('--identifier-audit');
const output = process.argv.slice(2).find(arg => arg !== '--identifier-audit');
const policies = identifierAudit ? ['linesThenSentences', 'asciiRuns'] :
    ['intact', 'all', 'bodyOnly', 'lines', 'whitespace', 'sentences', 'sentenceThenWhitespace',
    'linesThenSentences', 'hasBoundary'];
const drcd = {
    name: 'drcd-dev.json', checksum: 'e236df03861ba241bd7b29628cd48b3b8e339c60137e041a4358b5320ed61928',
    url: 'https://raw.githubusercontent.com/DRCKnowledgeTeam/DRCD/ed294c593072546c659413e8223feffb857e412e/DRCD_dev.json'
};

// A decoded UTF-16 offset maps to a position inside the original quoted value.
function rawOffsets(source, node) {
    const offsets = [node.offset + 1], end = node.offset + node.length - 1;
    for (let i = offsets[0]; i < end;) {
        i += source[i] === '\\' ? (source[i + 1] === 'u' ? 6 : 2) : 1;
        offsets.push(i);
    }
    assert.equal(offsets.length, node.value.length + 1);
    assert.equal(offsets.at(-1), end);
    return offsets;
}

function cuts(source, field, policy) {
    const { node, offsets, key } = field, start = node.offset, end = start + node.length;
    if (node.length <= size || policy === 'intact' || (policy === 'bodyOnly' && key !== 'body')) return [[start, end]];
    if (policy === 'hasBoundary') {
        const text = node.value.trim();
        if (!/\s/u.test(text) && !Array.from(sentenceEnds(text, 'en')).some(i => i > 0 && i < text.length)) return [[start, end]];
        policy = 'all';
    }
    if (policy === 'all' || policy === 'bodyOnly') {
        const escape = /\\(?:u[dD][89abAB][\da-fA-F]{2}\\u[dD][c-fC-F][\da-fA-F]{2}|u[\da-fA-F]{4}|.)/g;
        const protectedSpans = Array.from(source.slice(start, end).matchAll(escape),
            m => [start + m.index, start + m.index + m[0].length]);
        return splitSpans(source, start, end, (a, b) => b - a <= size, true, protectedSpans, true);
    }
    const value = node.value, edges = [start];
    function boundary(i) {
        if (policy === 'asciiRuns' && i > 0 && i < value.length && /[!-~]/.test(value[i - 1]) && /[!-~]/.test(value[i])) return;
        if (i > 0 && i < value.length && offsets[i] !== edges.at(-1)) edges.push(offsets[i]);
    }
    function gaps(a, b, regex) {
        for (const m of value.slice(a, b).matchAll(regex)) boundary(a + m.index + m[0].length);
    }
    if (policy === 'linesThenSentences' || policy === 'asciiRuns') {
        let a = 0;
        const lineEnds = Array.from(value.matchAll(/[\r\n\u2028\u2029]+/gu), m => m.index + m[0].length);
        for (const b of [...lineEnds, value.length]) {
            const from = a ? offsets[a] : start, to = b === value.length ? end : offsets[b];
            if (to - from > size) for (const i of sentenceEnds(value.slice(a, b), 'en')) boundary(a + i);
            boundary(b);
            a = b;
        }
    } else if (policy === 'lines' || policy === 'whitespace') {
        gaps(0, value.length, policy === 'lines' ? /[\r\n\u2028\u2029]+/gu : /\s+/gu);
    } else {
        let a = 0;
        for (const b of sentenceEnds(value, 'en')) {
            const from = a ? offsets[a] : start, to = b === value.length ? end : offsets[b];
            if (policy === 'sentenceThenWhitespace' && to - from > size) gaps(a, b, /\s+/gu);
            boundary(b);
            a = b;
        }
    }
    edges.push(end);
    return Array.from(packedRanges(edges.length - 1, (a, b) => edges[b + 1] - edges[a] <= size),
        ([a, b]) => [edges[a], edges[b + 1]]);
}

function pool(id, rows, questions) {
    const source = JSON.stringify(rows), fields = [], units = [];
    // Every fixture record has only string properties. Construct the historical
    // intact control from source spans independently of the public chunker.
    for (const [i, record] of parseTree(source).children.entries()) {
        const members = new Map();
        const pointer = '/' + i;
        if (record.length <= size) units.push({ node: record, pointer });
        for (const property of record.children) {
            const [name, node] = property.children;
            assert.equal(node.type, 'string');
            const field = { key: name.value, node, offsets: rawOffsets(source, node) };
            members.set(name.value, field);
            if (record.length > size) {
                const key = name.value.replaceAll('~', '~0').replaceAll('/', '~1');
                units.push({ node: property, pointer: pointer + '/' + key, field });
            }
        }
        fields.push(members);
    }
    const gold = questions.map(q => {
        const field = fields[q.record].get(q.key);
        return q.answers.map(([start, answer]) => {
            assert.ok(start >= 0 && answer.length && field.node.value.startsWith(answer, start));
            const a = field.offsets[start], b = field.offsets[start + answer.length];
            assert.equal(JSON.parse('"' + source.slice(a, b) + '"'), answer);
            return [a, b];
        });
    });
    const layouts = new Map();
    for (const policy of policies) {
        const chunks = units.flatMap(({ node, pointer, field }) => {
            const start = node.offset, end = start + node.length;
            const spans = field ? cuts(source, field, policy) : [[start, end]];
            spans[0][0] = start;
            assert.equal(spans.at(-1)[1], end);
            for (let i = 1; i < spans.length; i++) assert.equal(spans[i - 1][1], spans[i][0]);
            return spans.map(([a, b]) => ({ text: source.slice(a, b), jsonPointer: pointer,
                sourceRanges: [{ start: a, end: b, outputStart: 0 }] }));
        });
        const hash = sha256(JSON.stringify(chunks));
        if (!layouts.has(hash)) layouts.set(hash, { hash, policies: [], chunks });
        layouts.get(hash).policies.push(policy);
    }
    return { id, sourceSHA256: sha256(source), questions, gold, layouts: [...layouts.values()] };
}

function casaiPools() {
    const rows = [...records];
    const qs = queries.map(([record, text, answer], i) => {
        const key = i < proseCount ? 'body' : 'integrity', literal = i < proseCount ? answer : text;
        return { id: 'original-' + i, group: i < proseCount ? 'prose' : 'short', text, record, key,
            answers: [[rows[record][key].indexOf(literal), literal]] };
    });
    const original = pool('casai-original', rows, [...qs]);
    for (const group of ['random', 'prefix']) {
        for (const { integrity, package: name } of records.slice(3)) {
            const hash = createHash('shake256', { outputLength: 900 }).update(integrity).digest('base64url');
            const text = group === 'random' ? 'ref-' + hash.slice(0, 1196) : 'scope/'.repeat(192) + hash.slice(0, 48);
            assert.equal(text.length, 1200);
            qs.push({ id: group + '-' + rows.length, group, text, record: rows.length, key: 'integrity', answers: [[0, text]] });
            rows.push({ package: name, integrity: text });
        }
    }
    const identifiers = qs.slice(queries.length);
    const lead = 'Export reference.\n';
    const inline = identifiers.map(q => ({ body: lead + q.text + '\nEnd of reference.' }));
    const inlineQuestions = identifiers.map((q, record) => ({ ...q, record, key: 'body', answers: [[lead.length, q.text]] }));
    return [original, pool('casai-mixed', rows, qs), pool('casai-inline', inline, inlineQuestions)];
}

function articlePool(id, article, separator) {
    let body = '';
    const qs = [];
    for (const p of article.paragraphs) {
        if (body) body += separator;
        const at = body.length, utf16 = utf16Offsets(p.context);
        for (const q of p.qas) {
            const answers = q.answers.map(a => [utf16(a.answer_start), a.text])
                .filter(([i, text]) => i >= 0 && text && p.context.startsWith(text, i))
                .map(([i, text]) => [at + i, text]);
            assert.ok(answers.length);
            qs.push({ id: q.id, group: 'prose', text: q.question, record: 0, key: 'body', answers });
        }
        body += p.context;
    }
    return pool(id, [{ title: article.title, body }], qs);
}

function urlPool() {
    const rows = records.slice(3).map(({ package: name, integrity }) => {
        const hash = createHash('sha256').update(integrity).digest('base64url');
        const base = 'https://example.org/catalog?scope=';
        const url = base + 'scope/'.repeat(240).slice(0, 1200 - base.length - hash.length) + hash;
        return { package: name, url };
    });
    return pool('casai-url', rows, rows.map(({ url }, i) => ({
        id: 'url-' + i, group: 'url', text: url, record: i, key: 'url', answers: [[0, url]]
    })));
}

// Each measured chunk has one contiguous source range. Only the actually
// delivered prefix of a ranked hit can identify a record or expose its answer.
function evaluate(p, layout, ids, rank, encoder, budgets) {
    const rows = layout.chunks.map((c, doc) => ({ ...c, doc, record: Number(c.jsonPointer.split('/')[1]) }));
    const vectors = rows.map(c => ids.get(c.text));
    const ranks = p.questions.map(q => rank(ids.get(q.text), vectors).slice(0, topK));
    const hits = {};
    for (const budget of budgets) {
        const cache = new Map();
        function visible(order) {
            const key = order.join(',');
            if (!cache.has(key)) {
                const spans = new Map();
                for (const t of deliver(order.map(i => rows[i]), budget, encoder).projected) {
                    for (const [i, a, b] of t) {
                        if (!spans.has(i)) spans.set(i, { record: rows[i].record, a, b });
                        else spans.get(i).b = Math.max(spans.get(i).b, b);
                    }
                }
                cache.set(key, [...spans.values()]);
            }
            return cache.get(key);
        }
        const first = rows.flatMap((_, i) => visible([i]));
        hits[budget] = p.questions.map((q, i) => {
            const got = visible(ranks[i]);
            const answer = span => span.record === q.record && p.gold[i].some(([a, b]) => span.a <= a && b <= span.b);
            return Number(got.some(s => s.record === q.record)) + 2 * Number(got.some(answer)) + 4 * Number(first.some(answer));
        }).join('');
    }
    const count = text => encoder.countTokens(text);
    const cold = [...new Set(rows.map(c => c.text))].map(count);
    return { policies: layout.policies, layoutSHA256: layout.hash, rows: rows.length,
        rankedRecord: ranks.map((order, i) => Number(order.some(j => rows[j].record === p.questions[i].record))).join(''),
        rowTokens: rows.reduce((n, c) => n + count(c.text), 0),
        coldTokens: cold.reduce((a, b) => a + b, 0), pooledInputs: cold.filter(n => n > 8191).length, hits };
}

const articles = JSON.parse(await readFile(await asset(drcd), 'utf8')).data.filter(a =>
    JSON.stringify(a.paragraphs.map(p => p.context).join('\n\n')).length > size);
assert.equal(articles.length, 136);
const english = JSON.parse(await readFile(await asset(assets.squad), 'utf8')).data;
let datasets = [...casaiPools(), ...articles.flatMap(a =>
    [articlePool('drcd-' + a.id, a, '\n\n'), articlePool('flat-' + a.id, a, '')]),
    ...english.flatMap(a => [articlePool('squad-' + a.title, a, '\n\n'), articlePool('squadflat-' + a.title, a, ' ')])];
assert.equal(datasets.filter(p => p.id.startsWith('drcd-')).reduce((n, p) => n + p.questions.length, 0), 2436);
assert.equal(datasets.filter(p => p.id.startsWith('squad-')).reduce((n, p) => n + p.questions.length, 0), 10570);
if (identifierAudit) {
    const reference = fileURLToPath(new URL('./results/2026-11-25-json-string-policies.json', import.meta.url));
    if (output && !relative(reference, output)) throw new Error('The identifier audit needs a separate output file.');
    const saved = JSON.parse(await readFile(reference, 'utf8'));
    for (const [k, v] of Object.entries({ model, dimension, size, topK, drcdSHA256: drcd.checksum, squadSHA256: assets.squad.checksum })) {
        assert.equal(saved.settings[k], v);
    }
    const pilot = JSON.parse(await readFile(new URL('./results/2026-11-25-json-fields.json', import.meta.url)));
    assert.deepEqual(queries.map(q => q[1]), pilot.queries);
    const originals = new Map(saved.pools.map(p => [p.id, p]));
    assert.equal(datasets.length, originals.size);
    for (const p of datasets) {
        const old = originals.get(p.id);
        assert.equal(p.sourceSHA256, old.sourceSHA256);
        assert.equal(sha256(JSON.stringify(p.gold)), old.referenceSHA256);
        assert.deepEqual(p.questions.map(q => [q.id, q.group]), old.questions);
        assert.equal(p.layouts[0].hash, old.layouts.find(l => l.policies.includes('linesThenSentences')).layoutSHA256);
    }
    datasets = [...datasets.filter(p => p.layouts.length > 1), urlPool()];
}
function vocabulary(p) {
    return [...new Set([...p.questions.map(q => q.text), ...p.layouts.flatMap(l => l.chunks.map(c => c.text))])];
}
const results = [];
let requests = 0, inputTokens = 0;
for (let i = 0; i < datasets.length; i += 12) {
    const batch = datasets.slice(i, i + 12);
    const encoder = await openReplay(undefined, join(cache, 'json-string-embeddings'), { lengthSafe: true });
    try {
        const texts = [...new Set(batch.flatMap(vocabulary))];
        const embedded = await encoder.embed(texts), vectors = new Map(texts.map((t, j) => [t, embedded[j]]));
        for (const p of batch) {
            const words = vocabulary(p), ids = new Map(words.map((t, j) => [t, j]));
            const matrix = new Float32Array(words.length * dimension);
            words.forEach((t, j) => matrix.set(vectors.get(t), j * dimension));
            const rank = denseRanker(matrix), budgets = p.id.startsWith('casai') ? [512, 1024] : [512];
            results.push({ id: p.id, sourceSHA256: p.sourceSHA256, vectorsSHA256: sha256(matrix),
                referenceSHA256: sha256(JSON.stringify(p.gold)), questions: p.questions.map(q => [q.id, q.group]),
                layouts: p.layouts.map(l => evaluate(p, l, ids, rank, encoder, budgets)) });
        }
        requests += encoder.stats.apiRequests;
        inputTokens += encoder.stats.apiInputTokens;
    } finally { encoder.close(); }
    console.log('Scored', results.length, 'of', datasets.length, 'pools');
}
const settings = { model, dimension, size, topK, policies, drcdSHA256: drcd.checksum, squadSHA256: assets.squad.checksum,
    hits: 'One digit per question. Bits 1, 2, 4 denote correct delivered record, complete delivered answer and answer visible with an ideal first hit.' };
if (output) {
    const pools = results.map(p => '    ' + JSON.stringify(p)).join(',\n');
    await writeFile(output, '{\n  "settings": ' + JSON.stringify(settings) + ',\n  "pools": [\n' + pools + '\n  ]\n}\n');
}
console.log('Provider usage', requests, 'requests,', inputTokens, 'tokens');
