import { parseTree } from 'jsonc-parser';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { jsonValueSpans, splitJsonSpans } from '../src/json.js';
import { splitSpans } from '../src/token-limit.js';
import { sha256 } from './corpora.mjs';
import { alignPlain } from './delivered-context.mjs';

export const structured = ['children', 'packed', 'children-repeat', 'packed-repeat', 'packed-omit', 'children-omit'];

export function measureLayouts(results, cap, countTokens, vocabulary) {
    const variants = new Map();
    for (const [name, all] of Object.entries(results)) {
        const rows = cap ? all.filter(c => countTokens(c.text) <= cap) : all;
        const rejected = all.length - rows.length;
        const hash = sha256(JSON.stringify(rows.map(r => [r.text, r.sourceRanges])));
        // Keep the archived index fingerprint separate from the cost of rejected fragments.
        const key = hash + '/' + rejected;
        const existing = variants.get(key);
        if (existing) { existing.names.push(name); continue; }
        const distinct = [...new Set(rows.map(r => r.text))], counts = distinct.map(countTokens);
        for (const text of distinct) vocabulary.add(text);
        const cost = [rows.length, rows.reduce((sum, row) => sum + countTokens(row.text), 0),
            counts.reduce((a, b) => a + b, 0), counts.filter(n => n > 8191).length, rejected];
        variants.set(key, { names: [name], hash, rows, cost });
    }
    return [...variants.values()];
}

export function layoutJson(source, root, layout, size, fits) {
    const pack = layout.startsWith('packed'), repeat = layout.includes('-'), omit = layout.endsWith('-omit');
    const chunks = [], standalone = new Map(), omitted = new Set();
    const raw = (a, b) => source.slice(a, b);
    const contextText = ctx => ctx ? raw(...ctx) + '\n' : '';
    function emit(a, b, pointer, ctx) {
        const prefix = contextText(ctx);
        const ranges = ctx ? [{ start: ctx[0], end: ctx[1], outputStart: 0 }] : [];
        ranges.push({ start: a, end: b, outputStart: prefix.length });
        const text = prefix + raw(a, b);
        const chunk = { text, jsonPointer: pointer, sourceRanges: ranges };
        if (fits && !fits(text)) chunk.tokenLimitExceeded = true;
        chunks.push(chunk);
    }
    function walk(node, start, pointer, ctx) {
        const end = node.offset + node.length;
        const legal = (a, b) => !fits || fits(raw(a, b));
        const withContext = (a, b) => !fits || fits(contextText(ctx) + raw(a, b));
        if (!node.children?.length) {
            const spans = jsonValueSpans(source, node, start, 0, size, 'en');
            const split = test => splitJsonSpans(source, spans, fits && test);
            let pieces = split(withContext);
            if (ctx && pieces.some(([a, b]) => !withContext(a, b))) { ctx = null; pieces = split(legal); }
            for (const [a, b] of pieces) emit(a, b, pointer, ctx);
            return;
        }
        if (end - start <= size && legal(start, end)) {
            emit(start, end, pointer, withContext(start, end) ? ctx : null);
            return;
        }
        const members = node.children.map((member, i) => {
            const [key, value] = member.type === 'property' ? member.children : [];
            const path = value ? key.value.replaceAll('~', '~0').replaceAll('/', '~1') : i;
            return { node: value ?? member, a: member.offset, b: member.offset + member.length, pointer: pointer + '/' + path };
        });
        function preceding(i) {
            if (!repeat || node.type !== 'object' || !i) return null;
            const end = members[i - 1].b;
            let j = i;
            while (j && !['array', 'object'].includes(members[j - 1].node.type) && end - members[j - 1].a <= 128) j--;
            return j < i ? [members[j].a, end] : null;
        }
        function detached(m) {
            return !legal(m.a, m.b) || (m.node.children?.length ? m.b - m.a > size :
                jsonValueSpans(source, m.node, m.a, 0, size, 'en').length > 1);
        }
        for (let i = 0; i < members.length;) {
            const first = members[i], local = preceding(i), context = local ?? ctx, at = chunks.length;
            let j = i + 1;
            if (pack && !detached(first)) {
                while (j < members.length && members[j].b - first.a <= size && !detached(members[j]) &&
                    (!fits || fits(contextText(context) + raw(first.a, members[j].b)))) j++;
            }
            if (j === i + 1) walk(first.node, first.a, first.pointer, context);
            else emit(first.a, members[j - 1].b, pointer, context);
            if (omit && size && local && standalone.has(local[0])) {
                const title = standalone.get(local[0]);
                if (title.sourceRanges[0].end === local[1] && at < chunks.length && chunks.slice(at).every(c =>
                    c.sourceRanges.length > 1 && c.sourceRanges[0].start === local[0] && c.sourceRanges[0].end === local[1])) omitted.add(title);
            }
            if (omit && j === i + 1 && chunks.length === at + 1 && chunks[at].sourceRanges.length === 1 &&
                chunks[at].sourceRanges[0].start === first.a && chunks[at].sourceRanges[0].end === first.b) standalone.set(first.a, chunks[at]);
            i = j;
        }
    }
    if (root.type === 'array' && root.children.length) {
        root.children.forEach((node, i) => walk(node, node.offset, '/' + i, null));
    } else walk(root, root.offset, '', null);
    return chunks.filter(c => !omitted.has(c));
}

export async function layouts(source, names, size, cap, countTokens) {
    const root = parseTree(source), results = {}, fits = cap && (s => countTokens(s) <= cap);
    for (const name of names) {
        let rows;
        if (name === 'plain') {
            const chunks = await chunkText(source, { chunkingStrategy: 'pack', maxChunkSize: size,
                ...(cap && { maxChunkTokens: cap, countTokens }) });
            rows = alignPlain(source, chunks.map(c => c.text));
        } else if (name === 'record') {
            const records = root.type === 'array' && root.children.length ? root.children : [root];
            rows = records.flatMap(n => {
                const a = n.offset, b = a + n.length;
                const pieces = fits ? splitSpans(source, a, b, (i, j) => fits(source.slice(i, j))) : [[a, b]];
                return pieces.map(([start, end]) => ({ text: source.slice(start, end), sourceRanges: [{ start, end, outputStart: 0 }] }));
            });
        } else rows = layoutJson(source, root, name, size, fits);
        results[name] = rows;
    }
    return { root, results };
}
