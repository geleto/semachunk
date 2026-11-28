import { splitSpans } from './token-limit.js';
import { sentenceEnds, sentenceLocale } from './sentences.js';
import { lineChildren, sectionTree } from './hierarchy.js';

const containers = new Set(['list', 'listItem', 'blockquote', 'footnoteDefinition', 'article', 'section']);
const inlineAtoms = new Set(['inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'footnoteReference']);
const barriers = new Set(['yaml', 'definition', 'thematicBreak']);

function omitted(node) {
    if (node.type === 'paragraph') return node.children.every(c => c.type === 'text' && !/\S/u.test(c.value));
    if (node.type === 'html') return !node.value.replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim();
    return node.type === 'definition' || (node.type === 'footnoteDefinition' && !node.children.length);
}

function headingText(node) {
    if (node.type === 'html') return '';
    if (node.type === 'break') return ' ';
    return node.children ? node.children.map(headingText).join('') : node.alt ?? node.value ?? node.label ?? '';
}

// Most units are one source slice. Only continuations need a sequence of
// source ranges and generated strings. Generated positions have no source.
function raw(start, end, kind) {
    return { start, end, kind };
}

function partsText(source, parts) {
    return parts.map(p => typeof p === 'string' ? p : source.slice(...p)).join('');
}

export function structuredText(source, unit) {
    return unit.parts ? partsText(source, unit.parts) : source.slice(unit.start, unit.end);
}

export function structuredResult(source, unit) {
    const sourceRanges = [];
    let outputStart = 0;
    for (const part of unit.parts ?? [[unit.start, unit.end]]) {
        if (typeof part === 'string') outputStart += part.length;
        else {
            const [start, end] = part;
            if (end > start) sourceRanges.push({ start, end, outputStart });
            outputStart += end - start;
        }
    }
    return { text: structuredText(source, unit), sectionId: unit.sectionId, headingPath: [...unit.headingPath], sourceRanges };
}

export function readStructuredUnits(source, { maxChunkSize = 500, fits, fitsStructure, locale, excludeNonLetterSentences }, root, hierarchical, bom = 0) {
    locale = sentenceLocale(locale);
    const offset = p => bom + p.offset;
    const lineStart = node => offset(node.position.start) + 1 - node.position.start.column;
    const within = text => !fits || fits(text);
    const wholeFits = (a, b) => b - a <= maxChunkSize && within(source.slice(a, b));

    function continuation(node) {
        return source.slice(lineStart(node), offset(node.position.start))
            .replace(/(?:\d+[.)]|[-+*]|\[\^[^\]]+\]:)(?=[ \t])/g, mark => ' '.repeat(mark.length));
    }

    function leaf(start, end, kind, prefix = '', protectedSpans = [], continuationStart = start) {
        function make(a, b) {
            const unit = raw(a, b, kind);
            if (prefix && a !== continuationStart && !/[\r\n]/.test(source[a - 1])) unit.parts = [prefix, [a, b]];
            return unit;
        }
        const check = (a, b) => within(structuredText(source, make(a, b)));
        if (check(start, end)) return [make(start, end)];
        const spans = splitSpans(source, start, end, check, { protectedSpans });
        if (prefix && spans.some(([a, b]) => !check(a, b))) return leaf(start, end, kind, '', protectedSpans);
        return spans.map(([a, b]) => make(a, b));
    }

    function sentences(node) {
        const a = offset(node.position.start), b = offset(node.position.end), atoms = [], hardBreaks = [];
        function collect(child) {
            if (inlineAtoms.has(child.type)) atoms.push([offset(child.position.start), offset(child.position.end)]);
            else if (hierarchical && child.type === 'break') hardBreaks.push(offset(child.position.end));
            else if (child.children) {
                const all = child.children;
                for (let i = 0; i < all.length; i++) {
                    if (all[i].position) { collect(all[i]); continue; }
                    // A GFM literal autolink transform can replace a run of text
                    // with positionless siblings. Protect its enclosing source gap.
                    const first = i;
                    while (i + 1 < all.length && !all[i + 1].position) i++;
                    if (all.slice(first, i + 1).some(n => inlineAtoms.has(n.type))) {
                        atoms.push([offset(all[first - 1]?.position.end ?? child.position.start),
                            offset(all[i + 1]?.position.start ?? child.position.end)]);
                    }
                }
            }
        }
        collect(node);
        const spans = [];
        let start = a, from = a, atom = 0;
        hardBreaks.push(b);
        for (const stop of hardBreaks) {
            for (const boundary of sentenceEnds(source.slice(from, stop).replace(/[\r\n]/g, ' '), locale)) {
                const end = from + boundary;
                while (atom < atoms.length && atoms[atom][1] <= end) atom++;
                if (atom < atoms.length && atoms[atom][0] < end) continue;
                if (node.contentEnd !== undefined) {
                    const raw = source.slice(start,end);
                    const a = start + raw.length-raw.trimStart().length, b = start+raw.trimEnd().length;
                    if (b>a) spans.push([a,b]);
                } else spans.push([start, end]);
                start = end;
            }
            from = stop;
        }
        return { spans, atoms };
    }

    // A fitting container can stay verbatim unless it contains something we
    // must skip. Never reintroduce a nested definition through a parent slice.
    const descend = new Set(), protectedBlocks = new Set(), prose = new Map();
    function inspect(node) {
        if (omitted(node) || (hierarchical && barriers.has(node.type))) return true;
        if (node.type === 'table' || node.type === 'code') protectedBlocks.add(node);
        if (node.type === 'paragraph' && excludeNonLetterSentences) {
            const parsed = prose.get(node) ?? sentences(node);
            prose.set(node, parsed);
            if (parsed.spans.some(([a, b]) => !/\p{L}/u.test(source.slice(a, b)))) descend.add(node);
        }
        if (containers.has(node.type)) {
            for (const child of node.children) {
                if (inspect(child)) descend.add(node);
                if (protectedBlocks.has(child)) protectedBlocks.add(node);
            }
        }
        return descend.has(node);
    }

    function table(node, start, end) {
        const rows = node.children.slice(node.headerRows ?? 1).map(lineStart);
        if (!rows.length) return leaf(start, end, 'fragment');
        const headerEnd = rows[0], units = [];
        rows.push(end);
        function group(a, b) {
            return a === headerEnd ? raw(start, b, 'rows') :
                { ...raw(a, b, 'rows'), parts: [[start, headerEnd], [a, b]] };
        }
        for (let i = 0; i + 1 < rows.length;) {
            let j = i + 1;
            const a = rows[i];
            if (!within(structuredText(source, group(a, rows[j])))) {
                if (!i) for (const part of leaf(start, headerEnd, 'fragment')) units.push(part);
                for (const part of leaf(a, rows[j], 'fragment')) units.push(part);
            } else {
                while (j + 1 < rows.length && headerEnd - start + rows[j + 1] - a <= maxChunkSize &&
                    within(structuredText(source, group(a, rows[j + 1])))) j++;
                units.push(group(a, rows[j]));
            }
            i = j;
        }
        return units;
    }

    function code(node, start, end) {
        const mark = offset(node.position.start);
        const open = !node.verbatim && /^(`{3,}|~{3,})([^\r\n]*)(\r\n|\r|\n)/.exec(source.slice(mark, end));
        const bodyStart = open ? mark + open[0].length : start;
        let bodyEnd = end, closingMark, closingWidth;
        if (open) {
            const closeStart = offset(node.position.end) - node.position.end.column + 1;
            const closing = /^([>\t ]*)(~{3,}|`{3,})[\t ]*$/.exec(source.slice(closeStart, offset(node.position.end)));
            if (closeStart >= bodyStart && closing?.[2].startsWith(open[1]) &&
                node.position.end.line - node.position.start.line > (node.value ? node.value.split(/\r\n|[\r\n]/).length : 0)) {
                bodyEnd = closeStart;
                closingMark = closeStart + closing[1].length;
                closingWidth = closing[2].length;
            }
        }
        if (bodyStart >= bodyEnd) return leaf(start, end, 'fragment');
        const prefix = continuation(node), indent = node.verbatim ? '' : open ? prefix : source.slice(start, end).match(/^[>\t ]*/)[0];
        const eol = open?.[3];
        function fragment(a, b) {
            const parts = [];
            let fence;
            if (open) {
                const marker = open[1][0];
                let width = open[1].length;
                for (const run of source.slice(a, b).matchAll(marker === '~' ? /~{3,}/g : /`{3,}/g)) {
                    width = Math.max(width, run[0].length + 1);
                }
                fence = marker.repeat(width);
                if (a === bodyStart) parts.push([start, mark], fence.slice(open[1].length), [mark, bodyStart]);
                else parts.push(prefix + fence + open[2] + eol);
            }
            if (a !== bodyStart && !/[\r\n]/.test(source[a - 1])) parts.push(indent);
            parts.push([a, b]);
            if (open) {
                if (!/[\r\n]/.test(source[b - 1])) parts.push(eol);
                if (b === bodyEnd && end > bodyEnd) {
                    parts.push([bodyEnd, closingMark], fence.slice(closingWidth), [closingMark, end]);
                } else parts.push(prefix + fence);
            }
            return { ...raw(a === bodyStart ? start : a, b === bodyEnd ? end : b, 'fragment'), parts };
        }
        const units = [];
        const check = (a, b) => within(structuredText(source, fragment(a, b)));
        let group = bodyStart, line = bodyStart;
        for (const match of source.slice(bodyStart, bodyEnd).matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
            if (!match[0]) continue;
            const startOfLine = line;
            line += match[0].length;
            if (check(group, line)) continue;
            // Keep pending blank lines with the following code when splitting it.
            if (group < startOfLine && /\S/u.test(source.slice(group, startOfLine))) {
                units.push(fragment(group, startOfLine));
                group = startOfLine;
                if (check(group, line)) continue;
            }
            for (const [a, b] of splitSpans(source, group, line, check)) {
                if (!check(a, b)) return leaf(start, end, 'fragment');
                units.push(fragment(a, b));
            }
            group = line;
        }
        if (group < bodyEnd) units.push(fragment(group, bodyEnd));
        return units;
    }

    let run = 0;
    function* blocks(node, start, end) {
        if (omitted(node)) { run++; return; }
        const kind = protectedBlocks.has(node) ? (containers.has(node.type) ? 'container' : node.type) : 'prose';
        if (!descend.has(node) && (node.type === 'code' ? within(source.slice(start, end)) : wholeFits(start, end))) {
            yield raw(start, end, kind);
        } else if (containers.has(node.type)) {
            const children = node.children;
            for (let i = 0; i < children.length; i++) {
                yield* blocks(children[i], i ? lineStart(children[i]) : start,
                    children[i].contentEnd ?? (i + 1 < children.length ? lineStart(children[i + 1]) : end));
            }
        } else if (node.type === 'table') yield* table(node, start, end);
        else if (node.type === 'code') yield* code(node, start, end);
        else if (node.type === 'paragraph') {
            const { spans, atoms } = prose.get(node) ?? sentences(node);
            const prefix = continuation(node);
            for (const [i, [a, b]] of spans.entries()) {
                if (excludeNonLetterSentences && !/\p{L}/u.test(source.slice(a, b))) { run++; continue; }
                yield* leaf(i ? a : start, i + 1 < spans.length ? b : end, 'prose', prefix, atoms, start);
            }
        } else yield* leaf(start, end, kind, continuation(node));
    }

    const units = [], headings = [], outline = [];
    let headingPath = [], sectionId = null, pending = [];
    function attachHeadings(unit, leading) {
        let first = unit.start, adjacent = unit.start;
        const accepts = fitsStructure ?? fits;
        for (let i = leading.length - 1; i >= 0; i--) {
            const h = leading[i];
            if ((!hierarchical && h.run !== run) || /\S/u.test(source.slice(h.end, adjacent))) break;
            adjacent = h.start;
            const body = () => source.slice(h.start, unit.start) + structuredText(source, unit);
            if (hierarchical && (unit.parts ? body().length : unit.end - h.start) > maxChunkSize) break;
            if (!accepts || accepts(body())) first = h.start;
        }
        if (first < unit.start) {
            unit.parts?.unshift([first, unit.start]);
            unit.start = first;
        }
        if (fits && !fits(structuredText(source, unit))) unit.kind = 'fragment';
        return unit;
    }

    for (const node of root.children) {
        const start = lineStart(node), end = offset(node.position.end);
        if (headings.at(-1)?.scopeEnd <= start) {
            while (headings.at(-1)?.scopeEnd <= start) headings.pop();
            while (pending.at(-1)?.scopeEnd <= start) pending.pop();
            headingPath = headings.at(-1)?.path ?? [];
            sectionId = headings.at(-1)?.id ?? null;
        }
        if (node.type === 'heading') {
            while (headings.length && headings.at(-1).depth >= node.depth) headings.pop();
            while (pending.length && pending.at(-1).depth >= node.depth) pending.pop();
            const scopeEnd = node.scopeEnd ?? headings.at(-1)?.scopeEnd;
            const heading = { depth: node.depth, text: headingText(node).replace(/\s+/g, ' ').trim(), start, end, run, scopeEnd,
                id:offset(node.position.start) };
            headings.push(heading);
            headingPath = headings.map(h => h.text);
            heading.path = headingPath;
            sectionId = offset(node.position.start);
            if (hierarchical) outline.push({ start, end, headingEnd: end, depth: node.depth, scopeEnd, kind: 'section', structural:true, sectionId, headingPath,
                leading: pending.slice(), children: [], omitWhenEmpty: true });
            pending.push(heading);
            continue;
        }
        if (hierarchical) {
            const skip = barriers.has(node.type) || omitted(node);
            outline.push({ node, start, end, sectionId, headingPath, kind: node.type, structural:containers.has(node.type), leading: pending,
                skip, blocked: skip || inspect(node) });
            pending = [];
        } else {
            if (barriers.has(node.type)) { pending = []; run++; continue; }
            inspect(node);
            for (const unit of blocks(node, start, end)) {
                units.push(Object.assign(attachHeadings(unit, pending), { headingPath, sectionId, run }));
                pending = [];
            }
        }
    }
    if (!hierarchical) return units;

    function children(entry) {
        if (entry.children || !entry.node) return entry.children;
        const { node, start, end, headingPath, sectionId } = entry;
        if (containers.has(node.type)) {
            return node.children.map((child, i, all) => ({
                node: child, start: i ? lineStart(child) : start, end: child.contentEnd ?? (i + 1 < all.length ? lineStart(all[i + 1]) : end),
                headingPath, sectionId, leading: i ? undefined : entry.leading, kind: child.type, structural:containers.has(child.type),
                skip: barriers.has(child.type) || omitted(child), blocked: descend.has(child)
            }));
        }
        // A split inside a quote or list paragraph may need generated continuation markers.
        // Its leaf renderer measures those markers together with the source text.
        if (node.type !== 'paragraph' || node.prefixedContainer || continuation(node)) return;
        const { spans, atoms } = prose.get(node) ?? sentences(node);
        return lineChildren(spans.map(([a, b], i) => ({
            start: i ? a : start, end: i + 1 === spans.length ? end : b, headingPath, sectionId, kind: 'prose', atoms,
            leading: i ? undefined : entry.leading, endsLine: /[\r\n][^\S\r\n]*$/u.test(source.slice(a, b)),
            skip: excludeNonLetterSentences && !/\p{L}/u.test(source.slice(a, b))
        })));
    }
    function* splitLeaf(entry) {
        const pieces = entry.node ? blocks(entry.node, entry.start, entry.end) :
            leaf(entry.start, entry.end, 'prose', '', entry.atoms);
        let leading = entry.leading;
        for (const piece of pieces) {
            yield { ...piece, leading, headingPath: entry.headingPath, sectionId: entry.sectionId };
            leading = undefined;
        }
    }
    const render = unit => structuredResult(source, attachHeadings(unit, (unit.firstChild ?? unit).leading ?? []));
    function renderUnits(units) {
        if (!fitsStructure) return units.map(render);
        const result = [];
        let previousEnd = 0;
        for (const unit of units) {
            const leading = (unit.firstChild ?? unit).leading ?? [];
            const passage = render(unit);
            // A title detached by the smaller structural limit remains a citable passage.
            let nextStart = unit.start;
            const detached = [];
            for (let i=leading.length-1; i>=0; i--) {
                const h = leading[i];
                if (h.start>=unit.start) continue;
                if (h.start<previousEnd || /\S/u.test(source.slice(h.end,nextStart))) break;
                detached.push(h);
                nextStart = h.start;
            }
            for (const h of detached.reverse()) {
                for (const part of leaf(h.start,h.end,'heading')) {
                    result.push(structuredResult(source,{...part,headingPath:h.path,sectionId:h.start}));
                }
            }
            result.push(passage);
            previousEnd = unit.end;
        }
        return result;
    }
    function standaloneHeadings() {
        return outline.filter(n => n.depth).flatMap(h => leaf(h.start,h.headingEnd,'heading')
            .map(u => structuredResult(source,{...u,headingPath:h.headingPath,sectionId:h.sectionId})));
    }
    return {roots:sectionTree(outline),children,splitLeaf,render,renderUnits,standaloneHeadings};
}
