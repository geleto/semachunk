import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const here = fileURLToPath(new URL('./', import.meta.url));
export const cache = join(here, '.cache');
export const assets = {
    squad: {
        name: 'squad.json',
        url: 'https://raw.githubusercontent.com/rajpurkar/SQuAD-explorer/eee5fdbf62f8613a7812b03419e6b29617b74fd1/dataset/dev-v1.1.json',
        checksum: '95aa6a52d5d6a735563366753ca50492a658031da74f301ac5238b03966972c9',
    },
    wikisection: {
        name: 'wikisection.tar.gz',
        url: 'https://raw.githubusercontent.com/sebastianarnold/WikiSection/9d1bd55da4bc2dc985b5f4493e8214caa86100b8/wikisection_dataset_json.tar.gz',
        checksum: 'f37810a95702737b153a3034dbb877d08ecc699900f1a01c70110d47a5a016b8',
    },
    cuad: {
        name: 'cuad-test.json',
        url: 'https://raw.githubusercontent.com/Break-Through-Tech/Accenture-1T-contract-review-challenge/06410c6b3cdb2c0cf80a0a3dc9b6bb64c85338e4/data/test.json',
        checksum: '007b6a40b0c65247f881627375c3d2e9b6aeeb5dfa89957494feed0765a1a073',
    },
    qasper: {
        name: 'qasper-test.tgz',
        url: 'https://qasper-dataset.s3.us-west-2.amazonaws.com/qasper-test-and-evaluator-v0.3.tgz',
        checksum: '72a52a41193e2838b8074f80ac074b94f956b84886c36a61c58a7df4171bdd72',
    },
    hotpotqa: {
        name: 'hotpot-dev-distractor.json',
        url: 'https://huggingface.co/datasets/namlh2004/hotpotqa/resolve/7e54db4656209750ff487f6fdf8e39a66dba136b/hotpot_dev_distractor_v1.json',
        checksum: 'e3da074df24e8369009918aa5cdbdd254dadcde4c63f7569d36afd6f2268caa8',
    },
    finqa: {
        name: 'finqa-dev.json',
        url: 'https://raw.githubusercontent.com/czyssrs/FinQA/0f16e2867befa6840783e58be38c9efb9229d742/dataset/dev.json',
        checksum: 'a847fb7e0d61a3125a1e2909852df6b89f1ee64d2c5ff1bf689e332214deee51',
    },
};

export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

export async function fileDigest(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

export async function asset({ name, url, checksum }) {
    const path = join(cache, name);
    await mkdir(cache, { recursive: true });
    try {
        if (await fileDigest(path) === checksum) return path;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const temp = path + '.' + randomUUID();
    try {
        console.log('Downloading', name);
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error('Download failed for ' + name + ' (HTTP ' + response.status + ')');
        await pipeline(response.body, createWriteStream(temp, { flags: 'wx' }));
        if (await fileDigest(temp) !== checksum) throw new Error('Checksum mismatch for ' + name);
        await rename(temp, path);
    } finally {
        await rm(temp, { force: true });
    }
    return path;
}

const runFile = promisify(execFile);

export async function tarJSON(archive, member) {
    // The largest pinned JSON member is 33 MB. Read it directly from stdout.
    const { stdout } = await runFile('tar', ['-xOzf', archive, member], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
    return JSON.parse(stdout);
}

// Dataset annotations from SQuAD and CUAD count Unicode
// code points. Convert once per source; all JS slicing below uses UTF-16.
export function utf16Offsets(text) {
    if (!/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text)) return i => i;
    const positions = [0];
    for (const char of text) positions.push(positions.at(-1) + char.length);
    return i => positions[i];
}

export function lowerBound(values, x, inclusive = false) {
    let lo = 0, hi = values.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (values[mid] < x || (inclusive && values[mid] === x)) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export function compact(text) {
    return text.replace(/[\p{White_Space}\u001c-\u001f]+/gu, ' ').replace(/^ | $/g, '');
}

export function alignDocument(doc, parts) {
    const starts = [], joined = [];
    let cursor = 0, offset = 0;
    for (const part of parts) {
        const start = doc.text.indexOf(part, cursor);
        if (start < 0 || compact(doc.text.slice(cursor, start))) throw new Error('Missing source text in ' + doc.title);
        starts.push(start);
        joined.push(offset);
        cursor = start + part.length;
        offset += part.length + 1;
    }
    if (!parts.length || compact(doc.text.slice(cursor))) throw new Error('Incomplete source coverage in ' + doc.title);
    const translate = position => {
        const i = lowerBound(starts, position, true) - 1;
        if (i < 0 || position >= starts[i] + parts[i].length) throw new Error('Annotation outside source text in ' + doc.title);
        return joined[i] + position - starts[i];
    };
    return { ...doc, translate, text: parts.join(' '), cuts: doc.cuts?.map(translate),
        questions: doc.questions?.map(([q, spans]) => [q, spans.map(([a, b]) => [translate(a), translate(b - 1) + 1])]) };
}

export function answerSpan(raw, flat, answer, toUtf16 = utf16Offsets(raw)) {
    const start = toUtf16(answer.answer_start), literal = answer.text, clean = compact(literal);
    if (!clean || !raw.startsWith(literal, start)) return null;
    const prefix = raw.slice(0, start + literal.length - literal.trimStart().length);
    const begin = compact(prefix).length + Number(Boolean(compact(prefix) && /\s$/u.test(prefix)));
    return flat.startsWith(clean, begin) ? [begin, begin + clean.length] : null;
}

function answerSpans(raw, flat, answers, toUtf16, requireAll) {
    const spans = new Map();
    for (const answer of answers) {
        const span = answerSpan(raw, flat, answer, toUtf16);
        if (span) spans.set(span.join(','), span);
        else if (requireAll) throw new Error('Invalid source answer offset');
    }
    if (!spans.size) throw new Error('No aligned reference for an answerable question');
    return [...spans.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function evenly(items, count) {
    if (items.length < count) throw new Error('Sample exceeds source partition');
    return Array.from({ length: count }, (_, i) => items[Math.floor(i * items.length / count)]);
}

export async function squad() {
    const { data } = JSON.parse(await readFile(await asset(assets.squad), 'utf8'));
    return data.filter((_, i) => i % 3 === 0).map((article, i) => {
        const paragraphs = [], questions = [];
        let offset = 0;
        for (const { context: raw, qas } of article.paragraphs.slice(0, 8)) {
            const flat = compact(raw), positions = utf16Offsets(raw);
            for (const q of qas) {
                const spans = answerSpans(raw, flat, q.answers, positions, false);
                questions.push([q.question, spans.map(([a, b]) => [a + offset, b + offset])]);
            }
            paragraphs.push(flat);
            offset += flat.length + 1;
        }
        return { title: article.title, split: i % 2 ? 'heldout' : 'calibration', text: paragraphs.join(' '), questions };
    });
}

export async function wikisection() {
    const names = ['wikisection_en_city_validation.json', 'wikisection_en_city_test.json'];
    const archive = await asset(assets.wikisection);
    const partitions = await Promise.all(names.map(name => tarJSON(archive, name)));
    return partitions.flatMap((articles, i) => evenly(articles, 8).map(article => {
        const cuts = [], sections = [];
        let offset = 0;
        for (const annotation of article.annotations) {
            // WikiSection publishes UTF-16 offsets directly.
            const text = compact(article.text.slice(annotation.begin, annotation.begin + annotation.length));
            if (!text) throw new Error('Empty section in ' + article.id);
            cuts.push(offset);
            sections.push(text);
            offset += text.length + 1;
        }
        const text = sections.join(' ');
        if (text !== compact(article.text)) throw new Error('Incomplete section annotations');
        return { title: article.id, split: i ? 'heldout' : 'calibration', text, cuts: cuts.slice(1) };
    }));
}

export function joinParts(parts) {
    const blocks = [], spans = [];
    let offset = 0;
    for (const part of parts) {
        const block = compact(part || '');
        spans.push(block ? [offset, offset + block.length] : null);
        if (block) {
            blocks.push(block);
            offset += block.length + 1;
        }
    }
    return { text: blocks.join(' '), spans };
}

function increment(counts, name) { counts[name] = (counts[name] ?? 0) + 1; }

export async function cuad() {
    const { data } = JSON.parse(await readFile(await asset(assets.cuad), 'utf8'));
    const docs = [], questions = [], exclusions = {};
    for (const row of evenly(data, 8)) {
        const [{ context: raw, qas }] = row.paragraphs;
        const text = compact(raw), positions = utf16Offsets(raw), d = docs.length;
        docs.push({ title: row.title, text, raw });
        for (const qa of qas) {
            if (qa.is_impossible) { increment(exclusions, 'noAnnotatedClause'); continue; }
            const spans = answerSpans(raw, text, qa.answers, positions, true);
            questions.push({ id: qa.id, text: qa.question, pool: [d], references: [spans.map(([a, b]) => [d, a, b])] });
        }
    }
    return { docs, questions, exclusions };
}

export async function qasper() {
    const rows = await tarJSON(await asset(assets.qasper), 'qasper-test-v0.3.json');
    const docs = [], questions = [], exclusions = {};
    for (const [paper, row] of evenly(Object.entries(rows), 16)) {
        const parts = [row.title, row.abstract, ...row.full_text.flatMap(s => [s.section_name, ...s.paragraphs]),
            ...row.figures_and_tables.map(f => f.caption)];
        const { text, spans } = joinParts(parts), d = docs.length, positions = new Map();
        docs.push({ title: paper, text, raw: parts.filter(Boolean).join('\n\n') });
        parts.forEach((part, i) => {
            if (!spans[i]) return;
            const key = compact(part);
            if (!positions.has(key)) positions.set(key, []);
            positions.get(key).push([d, ...spans[i]]);
        });
        for (const qa of row.qas) {
            const references = [];
            for (const { answer } of qa.answers) {
                if (answer.unanswerable) continue;
                const matches = answer.evidence.map(p => positions.get(compact(p)));
                if (matches.length && matches.every(m => m?.length === 1)) references.push(matches.map(m => m[0]));
                else increment(exclusions, 'unmappedOrNontextAnnotations');
            }
            if (references.length) questions.push({ id: qa.question_id, text: qa.question, pool: [d], references });
            else increment(exclusions, qa.answers.every(a => a.answer.unanswerable) ? 'unanswerableQuestions' : 'noCompleteTextReference');
        }
    }
    return { docs, questions, exclusions };
}

export async function hotpotqa() {
    const rows = JSON.parse(await readFile(await asset(assets.hotpotqa), 'utf8'));
    const indices = ['bridge', 'comparison'].flatMap(kind =>
        evenly(rows.flatMap((row, i) => row.type === kind ? [i] : []), 32)).sort((a, b) => a - b);
    const docs = [], questions = [], docIds = new Map();
    for (const index of indices) {
        const row = rows[index], pool = [], facts = new Map();
        for (const [title, sentences] of row.context) {
            const { text, spans } = joinParts([title + '.', ...sentences]);
            if (!docIds.has(title)) {
                docIds.set(title, docs.length);
                docs.push({ title, text, raw: title + '.\n\n' + sentences.filter(Boolean).join(' ') });
            }
            const d = docIds.get(title);
            if (docs[d].text !== text || pool.includes(d)) throw new Error('Ambiguous HotpotQA source ' + title);
            pool.push(d);
            facts.set(title, spans.slice(1).map(span => span && [d, ...span]));
        }
        const reference = row.supporting_facts.map(([title, sentence]) => facts.get(title)?.[sentence]);
        if (!reference.length || reference.some(s => !s)) throw new Error('Invalid supporting facts for ' + row._id);
        questions.push({ id: row._id, text: row.question, kind: row.type, pool, references: [reference] });
    }
    return { docs, questions, exclusions: {} };
}
