import { readFile } from 'node:fs/promises';
import { asset, assets, compact, evenly, sha256, tarJSON, utf16Offsets } from './corpora.mjs';

const sampleSeed = 'semachunk-markdown-v1/';
const readJSON = async key => JSON.parse(await readFile(await asset(assets[key]), 'utf8'));
function shuffled(items, key) {
    return items.map(item => [sha256(sampleSeed + key(item)), item])
        .sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}

// Select groups before rendering. Exclude every historical sample and use
// disjoint article titles for the sampled multi-document questions.
function partition(items, key, size, historical = []) {
    const exclude = new Set(historical.map(key));
    const order = shuffled(items.filter(item => !exclude.has(key(item))), key);
    return [...Array.from({ length: 4 }, (_, i) => order.slice(i * size, (i + 1) * size)), order.slice(4 * size, 8 * size)];
}

function corpus() {
    return { docs: [], questions: [], exclusions: {} };
}
function omit(data, reason) { data.exclusions[reason] = (data.exclusions[reason] ?? 0) + 1; }

function contracts(rows) {
    const data = corpus();
    for (const { title, paragraphs: [{ context: source, qas }] } of rows) {
        const d = data.docs.length, utf16 = utf16Offsets(source);
        data.docs.push({ id: title, title: '', source });
        for (const qa of qas) {
            if (qa.is_impossible) { omit(data, 'noAnnotatedClause'); continue; }
            const ref = qa.answers.map(({ text, answer_start }) => {
                const a = utf16(answer_start);
                if (!source.startsWith(text, a) || !text) throw new Error('Invalid CUAD offset ' + qa.id);
                return [d, a, a + text.length];
            });
            data.questions.push({ id: qa.id, group: title, text: qa.question, pool: [d], references: [ref] });
        }
    }
    return data;
}

// Append and label in one pass. Repeated paragraphs, sentences and rows
// retain their own offsets.
function document(id, title) {
    const doc = { id, title, source: '' };
    function add(text, separator = '\n\n') {
        if (doc.source) doc.source += separator;
        const a = doc.source.length;
        doc.source += text;
        return [a, doc.source.length];
    }
    return { doc, add };
}

function papers(rows) {
    const data = corpus();
    for (const [id, row] of rows) {
        const { doc, add } = document(id, row.title), d = data.docs.length;
        data.docs.push(doc);
        const positions = new Map();
        function block(value, prefix = '') {
            const text = compact(value ?? '');
            if (!text) return;
            const [a, b] = add(prefix + text);
            if (!positions.has(text)) positions.set(text, []);
            positions.get(text).push([d, a + prefix.length, b]);
        }
        block(row.title, '# ');
        block(row.abstract);
        let path = [];
        for (const section of row.full_text) {
            const next = (section.section_name ?? '').split(' ::: ').filter(Boolean);
            let common = 0;
            while (common < next.length - 1 && next[common] === path[common]) common++;
            for (let i = common; i < next.length; i++) block(next[i], '#'.repeat(Math.min(6, i + 2)) + ' ');
            path = next;
            section.paragraphs.forEach(p => block(p));
        }
        if (row.figures_and_tables.length) add('## Captions');
        for (const figure of row.figures_and_tables) block(figure.caption);
        for (const qa of row.qas) {
            const references = [];
            for (const { answer } of qa.answers) {
                if (answer.unanswerable) continue;
                const matches = answer.evidence.map(e => positions.get(compact(e)));
                if (matches.length && matches.every(m => m?.length === 1)) references.push(matches.map(m => m[0]));
                else omit(data, 'ambiguousOrNontextAnnotation');
            }
            if (references.length) data.questions.push({ id: qa.question_id, group: id, text: qa.question, pool: [d], references });
            else omit(data, 'noCompleteTextReference');
        }
    }
    return data;
}

const reportId = row => row.filename.split('/').slice(0, -1).join('/');
function finances(rows) {
    const data = corpus(), pages = new Map();
    for (const row of rows) {
        if (!pages.has(row.filename)) {
            const { doc, add } = document(row.filename, ''), d = data.docs.length, spans = new Map();
            data.docs.push(doc);
            function prose(lines, first) {
                lines.forEach((text, i) => { if (compact(text)) spans.set('text_' + (first + i), [d, ...add(compact(text))]); });
            }
            prose(row.pre_text, 0);
            row.table.forEach((cells, i) => {
                const line = '| ' + cells.map(v => compact(v).replaceAll('\\', '\\\\').replaceAll('|', '\\|')).join(' | ') + ' |';
                spans.set('table_' + i, [d, ...add(line, i ? '\n' : '\n\n')]);
                if (!i) add('| ' + cells.map(() => '---').join(' | ') + ' |', '\n');
            });
            prose(row.post_text, row.pre_text.length);
            pages.set(row.filename, { spans, d });
        }
        const { spans, d } = pages.get(row.filename);
        const refs = Object.keys(row.qa.gold_inds).map(key => spans.get(key));
        if (refs.some(s => !s)) { omit(data, 'unmappedRowOrText'); continue; }
        for (const [key, text] of Object.entries(row.qa.gold_inds)) {
            if (key.startsWith('text_') && compact([...row.pre_text, ...row.post_text][Number(key.slice(5))]) !== compact(text)) {
                throw new Error('FinQA text index differs from annotation in ' + row.id);
            }
        }
        data.questions.push({ id: row.id, group: reportId(row), text: row.qa.question, pool: [d], references: [refs] });
    }
    return data;
}

function multiHop(rows) {
    const data = corpus();
    for (const row of rows) {
        const facts = new Map(), pool = [];
        for (const [title, sentences] of row.context) {
            const { doc, add } = document(title, title), d = data.docs.length;
            data.docs.push(doc);
            pool.push(d);
            add('# ' + title);
            facts.set(title, sentences.map((s, i) => compact(s) ? [d, ...add(compact(s), i ? ' ' : '\n\n')] : null));
        }
        const ref = row.supporting_facts.map(([t, i]) => facts.get(t)[i]);
        if (ref.some(s => !s)) throw new Error('Unmapped supporting sentence ' + row._id);
        data.questions.push({ id: row._id, group: row._id, text: row.question, pool, references: [ref] });
    }
    // Larger replications use independent pools of the original 32-question size.
    if (data.questions.length > 32) for (let i = 0; i < data.questions.length; i += 32) {
        const group = data.questions.slice(i, i + 32), pooled = group.flatMap(q => q.pool);
        for (const q of group) q.pooled = pooled;
    }
    return data;
}

export async function markdownCorpora(split) {
    const i = ['calibration', 'final', 'confirmation', 'rules-test', 'replication'].indexOf(split);
    if (i < 0) throw new Error('Unknown Markdown study split');
    const { data: cuad } = await readJSON('cuad');
    const qasper = Object.entries(await tarJSON(await asset(assets.qasper), 'qasper-test-v0.3.json'));
    function mixedEvidence(row) {
        const ids = Object.keys(row.qa.gold_inds);
        return ids.some(k => k.startsWith('table_')) && ids.some(k => k.startsWith('text_'));
    }
    const development = (await readJSON('finqa')).filter(mixedEvidence);
    const developmentReports = new Set(development.map(reportId));
    const reports = new Set(partition([...developmentReports], r => r, 24)[i]);
    const finance = i === 4 ? (await readJSON('finqaTest')).filter(r => mixedEvidence(r) && !developmentReports.has(reportId(r))) :
        development.filter(r => reports.has(reportId(r)));
    const hotpot = await readJSON('hotpotqa'), selected = [[], [], [], [], []], seen = new Set();
    for (const kind of ['bridge', 'comparison']) {
        const rows = hotpot.filter(r => r.type === kind);
        for (const row of evenly(rows, 32)) for (const [title] of row.context) seen.add(title);
    }
    function pick(kind, count) {
        const rows = shuffled(hotpot.filter(r => r.type === kind), r => r._id);
        const batch = [];
        for (const row of rows) {
            if (row.context.some(([title]) => seen.has(title))) continue;
            batch.push(row);
            for (const [title] of row.context) seen.add(title);
            if (batch.length === count) return batch;
        }
        throw new Error('Insufficient independent multi-hop questions');
    }
    for (const kind of ['bridge', 'comparison']) pick(kind, 32).forEach((row, n) => selected[n % 2].push(row));
    for (let extra = 2; extra <= i; extra++) {
        const count = extra === 4 ? 64 : 16;
        const bridge = pick('bridge', count), comparison = pick('comparison', count);
        for (let n = 0; n < count; n += 16) selected[extra].push(...bridge.slice(n, n + 16), ...comparison.slice(n, n + 16));
    }
    return {
        cuad: contracts(partition(cuad, r => r.title, 6, evenly(cuad, 8))[i]),
        qasper: papers(partition(qasper, ([id]) => id, 12, evenly(qasper, 16))[i]),
        finqa: finances(finance),
        hotpotqa: multiHop(selected[i]),
    };
}

export function manifest(data) {
    return Object.fromEntries(Object.entries(data).map(([name, { docs, questions, exclusions }]) => [name, {
        documents: docs.map(d => d.id), questions: questions.map(q => q.id), exclusions,
        sourceSHA256: sha256(JSON.stringify(docs)), annotationsAndPoolsSHA256: sha256(JSON.stringify(questions)),
    }]));
}
