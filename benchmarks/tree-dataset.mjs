import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parse, parseFragment } from 'parse5';
import { parseTextTree } from '../src/sentences.js';
import { loadMarkdownParser } from '../src/markdown-units.js';
import { chunkHierarchy } from '../src/semantic.js';
import { cache, here, sha256 } from './corpora.mjs';

export const dataDir = join(cache, 'tree-corpus');
export const manifestPath = join(here, 'results/2026-11-26-tree-corpus.json');
export const readData = async name => JSON.parse(await readFile(join(dataDir, name + '.json'), 'utf8'));
const fingerprint = value => sha256(JSON.stringify(value));
const nonwhite = text => text.replace(/\s+/gu, '');
const pos = node => [node.position.start.offset, node.position.end.offset];
const words = (text, base = 0) => [...text.matchAll(/\S+/gu)].map(m => [base + m.index, base + m.index + m[0].length]);
const label = node => node.children ? node.children.map(label).join('') : node.value ?? node.alt ?? '';

// The treatment and control see precisely the same evidence, including discontiguous quotations.
export function searchIndex(text) {
    let flat = '';
    const mapping = [];
    for (const m of text.matchAll(/\S+/gu)) {
        if (flat) { flat += ' '; mapping.push(m.index - 1); }
        flat += m[0];
        for (let i = 0; i < m[0].length; i++) mapping.push(m.index + i);
    }
    return function locate(needle) {
        const word = c => c && /[\p{L}\p{N}_]/u.test(c);
        const hits = [];
        for (let i = flat.indexOf(needle); i !== -1; i = flat.indexOf(needle, i + 1)) {
            const end = i + needle.length;
            if (!(word(needle[0]) && word(flat[i - 1])) && !(word(needle.at(-1)) && word(flat[end]))) hits.push(i);
        }
        if (hits.length !== 1) return null;
        return words(needle).map(([a, b]) => [mapping[hits[0] + a], mapping[hits[0] + b - 1] + 1]);
    };
}

// Validate the complete visible character stream against text nodes with raw HTML offsets.
// A second parse decodes each original text-node slice, including its character references.
function verifiedDom(raw) {
    const ignored = new Set(['head', 'script', 'style', 'template', 'noscript', 'title']);
    const stack = [parse(raw, { sourceCodeLocationInfo: true })], parts = [];
    while (stack.length) {
        const node = stack.pop();
        if (ignored.has(node.tagName) || node.attrs?.some(a => a.name === 'hidden')) continue;
        if (node.nodeName === '#text' && nonwhite(node.value)) {
            const loc = node.sourceCodeLocation;
            if (!loc) throw new Error('Visible DOM text has no raw location');
            const original = raw.slice(loc.startOffset, loc.endOffset);
            const decoded = parseFragment(original).childNodes.map(n => n.value ?? '').join('');
            assert.equal(nonwhite(decoded), nonwhite(node.value));
            parts.push(nonwhite(decoded));
        }
        if (node.childNodes) stack.push(...node.childNodes.toReversed());
    }
    return parts.join('');
}

export async function markdownCoverage(source, parser) {
    const options = { maxChunkSize: Infinity, strategy: 'blocks' };
    const tree = parser.parseMarkdownTree(source, options);
    const units = await chunkHierarchy(source, tree.roots, { ...options, ...tree });
    return units.flatMap(u => tree.render(u).sourceRanges).sort((a, b) => a.start - b.start);
}

export async function governmentViews(pages, parser, exclusions) {
    const sets = new Map();
    for (const p of pages) {
        const tree = await parseTextTree(p.raw, { inputFormat: 'html' });
        const source = tree.source;
        assert.equal(nonwhite(source), verifiedDom(p.raw));
        const headings = new Map(), stack = [...tree.roots];
        while (stack.length) {
            const node = stack.pop();
            if (node.depth) headings.set(node.start, node.depth);
            if (node.children) stack.push(...node.children);
        }
        let md = '';
        const mdOffsets = [];
        for (let i = 0; i < source.length; i++) {
            if (headings.has(i)) md += '#'.repeat(headings.get(i)) + ' ';
            mdOffsets.push(md.length);
            md += source[i];
        }
        const plain = await parseTextTree(source, { inputFormat: 'text' });
        // Formatting may shift whitespace in the plain parser. Check each independent projection.
        assert.equal(nonwhite(source), nonwhite(plain.source));
        const locateHtml = searchIndex(source), locateText = searchIndex(plain.source);
        const coverage = await markdownCoverage(md, parser);
        const docs = Object.fromEntries(['html', 'text', 'markdown'].map(format => [format, {
            id: p.id, group: p.group, format, raw: format === 'html' ? p.raw : format === 'markdown' ? md : source,
            source: format === 'html' ? source : format === 'markdown' ? md : plain.source, questions: []
        }]));
        for (const q of p.questions) {
            const html = q.evidence.map(locateHtml), text = q.evidence.map(locateText);
            if ([...html, ...text].includes(null)) { exclusions.unmatchedOrAmbiguous++; continue; }
            const markdown = html.flat().map(([a, b]) => [mdOffsets[a], mdOffsets[b - 1] + 1]);
            if (!markdown.every(([a,b]) => coverage.some(r => r.start <= a && b <= r.end))) {
                exclusions.unindexedMarkdownEvidence++; continue;
            }
            const ranges = { html: html.flat(), text: text.flat(), markdown };
            const gold = nonwhite(q.evidence.join(''));
            for (const [format, doc] of Object.entries(docs)) {
                assert.equal(ranges[format].map(([a,b]) => doc.source.slice(a,b)).join(''), gold);
                doc.questions.push({ id: q.id, text: q.text, ranges: ranges[format] });
            }
        }
        for (const [format, doc] of Object.entries(docs)) {
            const key = ['government', p.split, p.domain, format].join('-');
            if (!sets.has(key)) sets.set(key, []);
            sets.get(key).push(doc);
        }
    }
    return sets;
}

// Six product queries were written from the three pinned guides before scoring.
const product = {
    'retrieval-to-grounded-answers': [
        ['How many combined hits actually reach reranking, and what ordering do the inputs need?', [
            'The example removes duplicate passages and sends at most twenty candidates to the reranker.',
            'Because it keeps only the first twenty, both search functions should return their best results first.']],
        ['What can execute while the question embedding is still being computed?', [
            "The keyword search doesn't need the vector, so it starts without waiting for the semantic search."]]],
    'change-implementation-keep-workflow': [
        ['Which categories may a ticket classifier return?', [
            'The classifier returns `{ category }`, where the category is `billing`, `account` or `other`.']],
        ['When rules and a model are combined, which decision takes precedence?', [
            'the hybrid version always trusts a rule when one matches']]],
    'draft-review-revise': [
        ['How do I cap retries on a failed model request separately from successful editorial rounds?', [
            '`maxRetries` is how many times the AI SDK retries a single provider call that fails.',
            '`maxRevisions` is how many successful rounds your editing loop can run.']],
        ['What should the review step hand back for the revision step?', [
            'The **reviewer** returns a score and a list of suggestions as structured output.']]]
};

export function manualViews(rows, parser) {
    const sets = new Map();
    function add(key, doc) {
        if (!sets.has(key)) sets.set(key, []);
        sets.get(key).push(doc);
    }
    for (const { id, raw, group, split } of rows) {
        const doc = { id, raw, source: raw, group, format: 'markdown', questions: [] };
        if (split === 'product') {
            for (const [i, [text, excerpts]] of product[id].entries()) {
                const ranges = excerpts.flatMap(s => {
                    const a = raw.indexOf(s);
                    assert(a >= 0 && a === raw.lastIndexOf(s), id);
                    return words(s, a);
                });
                doc.questions.push({ id: id + '-' + i, text, ranges });
            }
            add('casai-product', doc);
            continue;
        }
        const nodes = fromMarkdown(raw, parser.markdownGrammar).children, masks = [];
        for (const [i, heading] of nodes.entries()) {
            if (heading.type !== 'heading') continue;
            const question = label(heading).replace(/\s+/gu, ' ').trim();
            if (!/\?|\b^(?:why|what|how|can|do|does|is|are|will|should|where|when)\b/iu.test(question)) continue;
            masks.push(pos(heading));
            const body = [];
            for (let j = i + 1; j < nodes.length && !(nodes[j].type === 'heading' && nodes[j].depth <= heading.depth); j++) {
                const node = nodes[j];
                if (['heading','definition','html','thematicBreak','yaml'].includes(node.type)) continue;
                const [a,b] = pos(node), literal = raw.slice(a,b);
                if (!/^:::\s*$/u.test(literal)) body.push(...words(literal, a));
            }
            if (body.length) doc.questions.push({ id: id + '-' + i, text: question, ranges: body });
        }
        assert(doc.questions.length, 'No published answers in ' + id);
        let masked = raw;
        const edits = [];
        for (const [a,b] of masks.toReversed()) {
            const neutral = (raw.slice(a,b).match(/^#{1,6}/u)?.[0] ?? '##') + ' FAQ';
            assert(neutral.length <= b - a);
            masked = masked.slice(0,a) + neutral + masked.slice(b);
            edits.push([b, neutral.length - (b-a)]);
        }
        const offset = i => edits.reduce((n,[end,delta]) => n + (end <= i ? delta : 0), i);
        const questions = doc.questions.map(q => ({ ...q, ranges: q.ranges.map(([a,b]) => {
            const start = offset(a), end = offset(b);
            assert.equal(masked.slice(start,end), raw.slice(a,b));
            return [start,end];
        }) }));
        add('faq-' + split + '-published', doc);
        add('faq-' + split + '-masked', { ...doc, source: masked, raw: masked, questions });
    }
    return sets;
}

async function prepare() {
    const parser = await loadMarkdownParser(), manual = await readData('manuals');
    const exclusions = { unmatchedOrAmbiguous: 0, unindexedMarkdownEvidence: 0 };
    const sets = await governmentViews(await readData('government'), parser, exclusions);
    for (const [k,v] of manualViews(manual, parser)) sets.set(k,v);
    const manifest = { version: 1, manuals: manual.map(({raw,...s}) => s), exclusions, retrieval: {}, boundaries: {} };
    for (const [key, docs] of sets) {
        const data = JSON.stringify(docs);
        await writeFile(join(dataDir, key + '.json'), data);
        manifest.retrieval[key] = { documents: docs.length, groups: new Set(docs.map(d => d.group)).size,
            questions: docs.reduce((n,d) => n + d.questions.length, 0), sha256: sha256(data) };
    }
    for (const name of ['wiki','meetings']) for (const fold of ['development','confirmation']) {
        const key = name + '-' + fold, docs = await readData(key);
        manifest.boundaries[key] = { documents: docs.length, sha256: fingerprint(docs),
            positives: docs.reduce((n,d) => n + (d.starts?.length ?? d.labels.filter(x => x === 1).length), 0) };
    }
    await mkdir(join(here,'results'), {recursive:true});
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    try { assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), manifest, 'Frozen dataset changed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(manifestPath, serialized); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await prepare();
