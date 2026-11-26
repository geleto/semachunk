import assert from 'node:assert/strict';

export function hotpotSource(item, view) {
    const records = item.context.map(([title, sentences]) => view === 'text' ? { title, text: sentences.map(s => s.trim()).join(' ') } :
        view === 'last' ? { sentences, title } : { title, sentences });
    const source = JSON.stringify(records, null, view === 'indent' ? 2 : undefined);
    return view === 'ascii' ? source.replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : source;
}

// Each non-whitespace code point counts only if its whole raw spelling is in one hit.
function field(source, node) {
    const quoted = node.type === 'string', value = quoted ? node.value : source.slice(node.offset, node.offset + node.length);
    const offsets = [node.offset + Number(quoted)];
    for (let i = 0; i < value.length; i++) {
        const raw = offsets[i];
        offsets.push(raw + (quoted && source[raw] === '\\' ? (source[raw + 1] === 'u' ? 6 : 2) : 1));
    }
    assert.equal(offsets.at(-1), node.offset + node.length - Number(quoted));
    return { value, phrase(from = 0, to = value.length) {
        const atoms = [];
        for (const m of value.slice(from, to).matchAll(/\S/gu)) atoms.push([offsets[from + m.index], offsets[from + m.index + m[0].length]]);
        assert.ok(atoms.length);
        return { a: atoms[0][0], b: atoms.at(-1)[1], atoms };
    } };
}

const members = n => Object.fromEntries(n.children.map(p => [p.children[0].value, p.children[1]]));
const asFact = phrase => ({ phrase, titles: [] });

function articleFields(source, node, title, originals) {
    const nodes = members(node);
    const sentences = (nodes.text ? [nodes.text] : nodes.sentences.children).map(n => field(source, n));
    const titles = [field(source, nodes.title).phrase()];
    const words = title.trim().split(/\s+/u).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const literal = new RegExp('(?<![\\p{L}\\p{M}\\p{N}_])' + words.join('\\s+') + '(?![\\p{L}\\p{M}\\p{N}_])', 'gu');
    let offset = 0;
    originals.forEach((original, i) => {
        const sentence = nodes.text ? sentences[0] : sentences[i], body = nodes.text ? original.trim() : original;
        const start = nodes.text ? offset : 0;
        for (const match of body.matchAll(literal)) titles.push(sentence.phrase(start + match.index, start + match.index + match[0].length));
        offset += body.length + 1;
    });
    return { sentences, titles };
}

export function hotpotQuestion(item, source, root, view) {
    const indices = new Map(item.context.map(([title], i) => [title, i]));
    const facts = [], articles = new Map();
    for (const [title, i] of new Map(item.facts.map(f => [JSON.stringify(f), f])).values()) {
        let article = articles.get(title);
        if (!article) {
            const record = indices.get(title);
            article = { record, ...articleFields(source, root.children[record], title, item.context[record][1]) };
            articles.set(title, article);
        }
        let phrase;
        if (view === 'text') {
            const originals = item.context[article.record][1].map(s => s.trim());
            const a = originals.slice(0, i).reduce((n, s) => n + s.length + 1, 0);
            phrase = article.sentences[0].phrase(a, a + originals[i].length);
        } else phrase = article.sentences[i].phrase();
        facts.push({ phrase, titles: article.titles });
    }
    return { id: item.id, text: item.question, facts };
}

export function tableQuestions(item, source, root, corpus) {
    if (corpus === 'wikisql') return item.questions.map(([id, text, row, columns]) => ({
        id, text, facts: columns.flatMap(i => root.children[row].children[i].children.map(n => asFact(field(source, n).phrase())))
    }));
    const { pre_text, post_text, table } = members(root), body = [...pre_text.children, ...post_text.children];
    return item.questions.map(([id, text, gold]) => {
        const required = new Set(), labels = new Set();
        for (const ref of gold) {
            const [kind, num] = ref.split('_'), i = Number(num);
            if (kind === 'text') { required.add(body[i]); continue; }
            assert.equal(kind, 'table');
            table.children[i].children.forEach((cell, j) => {
                if (!String(cell.value).trim()) return;
                required.add(cell);
                const label = table.children[0].children[j];
                if (label && String(label.value).trim()) labels.add(label);
            });
        }
        const facts = [...required].filter(n => String(n.value).trim()).map(n => asFact(field(source, n).phrase()));
        return { id, text, facts, labels: [...labels].map(n => field(source, n).phrase()) };
    });
}

// Ranges can only form one visible phrase when they touch in both coordinate
// systems, or a real source whitespace gap corresponds to visible whitespace.
export function visibleHits(source, text, ranges) {
    const hits = [];
    for (const r of ranges) {
        const hit = hits[r.hit ?? 0] ??= [], prev = hit.at(-1);
        if (prev && ((r.a === prev.b && r.from === prev.to) ||
            (r.a > prev.b && r.from > prev.to && !/\S/u.test(text.slice(prev.b, r.a)) && !/\S/u.test(source.slice(prev.to, r.from))))) {
            prev.b = r.b;
            prev.to = r.to;
        } else hit.push({ ...r });
    }
    return hits;
}

const contains = (ranges, a, b) => ranges.some(r => r.from <= a && r.to >= b);
export function scoreQuestion(q, hits) {
    const all = hits.flat();
    function covered(phrase) {
        return contains(all, phrase.a, phrase.b) || phrase.atoms.every(([a, b]) => contains(all, a, b));
    }
    const ordinary = q.facts.every(f => covered(f.phrase));
    const attributed = ordinary && (q.labels ? q.labels.every(covered) : q.facts.every(({ phrase, titles }) =>
        !titles.length || hits.some(hit => contains(hit, phrase.a, phrase.b) && titles.some(t => contains(hit, t.a, t.b)))));
    return Number(ordinary) + 2 * Number(attributed);
}

export function indexedHits(rows, source) {
    return rows.map(c => visibleHits(source, c.text, c.sourceRanges.map(r => ({ a: r.outputStart,
        b: r.outputStart + (r.outputLength ?? r.end - r.start), from: r.start, to: r.end })))[0] ?? []);
}

export function titleQuery(item, source, root, kept, omitted) {
    if (!kept || !omitted || kept.length === omitted.length) return;
    const surviving = new Set(omitted.map(c => c.sourceRanges[0].start + '/' + c.sourceRanges[0].end + '/' + c.text));
    for (const [record, node] of root.children.entries()) {
        const property = node.children.find(p => p.children[0].value === 'title');
        const start = property.offset, end = start + property.length, body = source.slice(start, end);
        if (!kept.some(c => c.sourceRanges.length === 1 && c.sourceRanges[0].start === start && c.sourceRanges[0].end === end) ||
            surviving.has(start + '/' + end + '/' + body)) continue;
        const title = item.context[record][0];
        return { text: title, occurrences: articleFields(source, node, title, item.context[record][1]).titles };
    }
}
