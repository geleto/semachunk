import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { splitSpans, TokenLimitError } from './token-limit.js';

const grammar = {
    extensions: [gfm(), frontmatter(['yaml'])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
};
const containers = new Set(['list', 'listItem', 'blockquote', 'footnoteDefinition']);
const inlineAtoms = new Set(['inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'footnoteReference']);

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

export function markdownText(source, unit) {
    return unit.parts ? partsText(source, unit.parts) : source.slice(unit.start, unit.end);
}

export function markdownResult(source, unit) {
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
    return { text: markdownText(source, unit), sectionId: unit.sectionId, headingPath: [...unit.headingPath], sourceRanges };
}

export function canPack(source, left, right, maxChunkSize, fits) {
    return left.kind === 'prose' && right.kind === 'prose' && !left.parts && !right.parts &&
        left.sectionId === right.sectionId && right.end - left.start <= maxChunkSize &&
        !/\S/u.test(source.slice(left.end, right.start)) && (!fits || fits(source.slice(left.start, right.end)));
}

export function packMarkdown(source, units, maxChunkSize, fits) {
    const packed = [];
    for (const unit of units) {
        const last = packed.at(-1);
        if (last && canPack(source, last, unit, maxChunkSize, fits)) last.end = unit.end;
        else packed.push({ ...unit });
    }
    return packed;
}

export function parseMarkdown(source, { maxChunkSize = 500, fits, locale = 'en', excludeNonLetterSentences, sentenceUnits }) {
    if (typeof locale !== 'string') throw new TypeError('locale must be a language tag string.');
    const root = fromMarkdown(source, grammar);
    // micromark consumes a leading BOM before assigning positions.
    const bom = Number(source.startsWith('\uFEFF'));
    const offset = p => bom + p.offset;
    const lineStart = node => offset(node.position.start) + 1 - node.position.start.column;
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
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
        const check = (a, b) => within(markdownText(source, make(a, b)));
        if (check(start, end)) return [make(start, end)];
        try {
            return splitSpans(source, start, end, check, true, protectedSpans).map(([a, b]) => make(a, b));
        } catch (error) {
            if (!(error instanceof TokenLimitError) || !prefix) throw error;
            return leaf(start, end, kind, '', protectedSpans);
        }
    }

    function sentences(node) {
        const a = offset(node.position.start), b = offset(node.position.end), atoms = [];
        function collect(child) {
            if (inlineAtoms.has(child.type)) atoms.push([offset(child.position.start), offset(child.position.end)]);
            else child.children?.forEach(collect);
        }
        collect(node);
        const spans = [];
        let start = a, atom = 0;
        for (const { segment, index } of segmenter.segment(source.slice(a, b).replace(/[\r\n]/g, ' '))) {
            const end = a + index + segment.length;
            while (atom < atoms.length && atoms[atom][1] <= end) atom++;
            if (atom < atoms.length && atoms[atom][0] < end) continue;
            spans.push([start, end]);
            start = end;
        }
        return { spans, atoms };
    }

    // A fitting container can stay verbatim unless it contains something we
    // must skip. Never reintroduce a nested definition through a parent slice.
    const descend = new Set(), protectedBlocks = new Set(), prose = new Map();
    function inspect(node) {
        if (node.type === 'definition') return true;
        if (node.type === 'table' || node.type === 'code') protectedBlocks.add(node);
        if (node.type === 'paragraph' && excludeNonLetterSentences) {
            const parsed = sentences(node);
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
        const rows = node.children.slice(1).map(lineStart);
        if (!rows.length) return leaf(start, end, 'fragment');
        const headerEnd = rows[0], units = [];
        let headerUsed = false;
        rows.push(end);
        function group(a, b) {
            return a === headerEnd ? raw(start, b, 'table') :
                { ...raw(a, b, 'table'), parts: [[start, headerEnd], [a, b]] };
        }
        for (let i = 0; i + 1 < rows.length;) {
            let j = i + 1;
            const a = rows[i];
            if (!within(markdownText(source, group(a, rows[j])))) {
                if (!headerUsed) units.push(...leaf(start, headerEnd, 'fragment'));
                units.push(...leaf(a, rows[j], 'fragment'));
            } else {
                while (j + 1 < rows.length && headerEnd - start + rows[j + 1] - a <= maxChunkSize &&
                    within(markdownText(source, group(a, rows[j + 1])))) j++;
                units.push(group(a, rows[j]));
            }
            headerUsed = true;
            i = j;
        }
        return units;
    }

    function code(node, start, end) {
        const mark = offset(node.position.start);
        const open = /^([\x60]{3,}|~{3,})([^\r\n]*)(\r\n|\r|\n)/.exec(source.slice(mark, end));
        const bodyStart = open ? mark + open[0].length : start;
        let bodyEnd = end;
        if (open) {
            const closeStart = offset(node.position.end) - node.position.end.column + 1;
            const closing = source.slice(closeStart, offset(node.position.end)).match(/^[>\t ]*([\x60~]+)[\t ]*$/);
            if (closeStart >= bodyStart && closing && closing[1][0] === open[1][0] &&
                closing[1] === open[1][0].repeat(closing[1].length) && closing[1].length >= open[1].length &&
                node.position.end.line - node.position.start.line > (node.value ? node.value.split(/\r\n|[\r\n]/).length : 0)) {
                bodyEnd = closeStart;
            }
        }
        if (bodyStart >= bodyEnd) return leaf(start, end, 'fragment');
        const prefix = continuation(node), indent = open ? prefix : source.slice(start, end).match(/^[>\t ]*/)[0];
        const eol = open?.[3];
        function fragment(a, b) {
            const parts = [];
            let fence;
            if (open) {
                const marker = open[1][0];
                let width = open[1].length;
                for (const run of source.slice(a, b).matchAll(marker === '~' ? /~{3,}/g : /[\x60]{3,}/g)) {
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
                    const closing = source.slice(bodyEnd, end);
                    const markerAt = closing.indexOf(open[1]);
                    const length = closing.slice(markerAt).match(/^[\x60~]+/)[0].length;
                    parts.push([bodyEnd, bodyEnd + markerAt], fence.slice(length), [bodyEnd + markerAt, end]);
                } else parts.push(prefix + fence);
            }
            return { ...raw(a === bodyStart ? start : a, b === bodyEnd ? end : b, 'fragment'), parts };
        }
        const units = [];
        const check = (a, b) => within(markdownText(source, fragment(a, b)));
        let group = bodyStart, line = bodyStart;
        try {
            for (const match of source.slice(bodyStart, bodyEnd).matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
                if (!match[0]) continue;
                const next = line + match[0].length;
                if (group < line && !check(group, next)) {
                    units.push(fragment(group, line));
                    group = line;
                }
                if (group === line && !check(line, next)) {
                    for (const [a, b] of splitSpans(source, line, next, check)) units.push(fragment(a, b));
                    group = next;
                }
                line = next;
            }
            if (group < bodyEnd) units.push(fragment(group, bodyEnd));
            return units;
        } catch (error) {
            if (!(error instanceof TokenLimitError)) throw error;
            return leaf(start, end, 'fragment');
        }
    }

    function blocks(node, start, end) {
        if (node.type === 'definition') return [];
        const kind = protectedBlocks.has(node) ? (containers.has(node.type) ? 'container' : node.type) : 'prose';
        if (!descend.has(node) && !(sentenceUnits && node.type === 'paragraph') &&
            (node.type === 'code' ? within(source.slice(start, end)) : wholeFits(start, end))) return [raw(start, end, kind)];
        if (containers.has(node.type)) {
            return node.children.flatMap((child, i, all) => blocks(child, i ? lineStart(child) : start,
                i + 1 < all.length ? lineStart(all[i + 1]) : end));
        }
        if (node.type === 'table') return table(node, start, end);
        if (node.type === 'code') return code(node, start, end);
        if (node.type !== 'paragraph') return leaf(start, end, kind, continuation(node));
        const { spans, atoms } = prose.get(node) ?? sentences(node);
        const prefix = continuation(node);
        return spans.flatMap(([a, b], i) => {
            if (excludeNonLetterSentences && !/\p{L}/u.test(source.slice(a, b))) return [];
            const from = i ? a : start, to = i + 1 < spans.length ? b : end;
            return leaf(from, to, 'prose', prefix, atoms, start);
        });
    }

    const units = [], headings = [];
    let headingPath = [], sectionId = null, pending = [];
    for (const node of root.children) {
        const start = lineStart(node), end = offset(node.position.end);
        if (node.type === 'heading') {
            while (headings.length && headings.at(-1).depth >= node.depth) headings.pop();
            while (pending.length && pending.at(-1).depth >= node.depth) pending.pop();
            const heading = { depth: node.depth, text: headingText(node).replace(/\s+/g, ' ').trim(), start, end };
            headings.push(heading);
            pending.push(heading);
            headingPath = headings.map(h => h.text);
            sectionId = offset(node.position.start);
            continue;
        }
        if (['yaml', 'definition', 'thematicBreak'].includes(node.type)) { pending = []; continue; }
        inspect(node);
        for (const unit of blocks(node, start, end)) {
            const bodyStart = unit.start;
            for (let i = pending.length - 1; i >= 0; i--) {
                const h = pending[i];
                if (/\S/u.test(source.slice(h.end, unit.start))) break;
                const parts = unit.parts && [[h.start, bodyStart], ...unit.parts.slice(unit.start === bodyStart ? 0 : 1)];
                if (fits && !fits(parts ? partsText(source, parts) : source.slice(h.start, unit.end))) break;
                unit.start = h.start;
                if (parts) unit.parts = parts;
            }
            pending = [];
            units.push(Object.assign(unit, { headingPath, sectionId }));
        }
    }
    return units;
}
