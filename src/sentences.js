import { abbreviations } from './abbreviations.js';
import { collapseRuns } from './offsets.js';
import { lineChildren, sectionTree } from './hierarchy.js';
import { chunkHierarchy } from './semantic-blocks.js';
import { splitSpans } from './token-limit.js';
import { alignWhitespace, joinViews, literal, sliceView } from './citations.js';

const blockElements = new Set(
    'address article aside blockquote caption dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre section summary table tbody td th tr ul'.split(' ')
);
const hiddenElements = new Set(['head', 'script', 'style', 'template', 'noscript', 'title']);
const htmlContainers = new Set(['article', 'section', 'blockquote', 'ul', 'ol', 'li']);

async function htmlToText(html, blocks, visible) {
    const { parse, defaultTreeAdapter } = await import('parse5').catch(error => {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("package 'parse5'")) {
            throw new Error("HTML input requires the optional parse5 package. Install it with npm install parse5.", { cause: error });
        }
        throw error;
    });
    const locations = visible && await (await import('./html-citations.js')).locatedHtml(html, defaultTreeAdapter);
    const pending = [parse(html, locations ? {treeAdapter: locations.treeAdapter, sourceCodeLocationInfo:true} : {})];
    const parts = [];
    const blockEnd = {}, preEnd = {}, headingEnd = {}, sectionEnd = {};
    let preDepth = 0, headingDepth = 0, scope;

    function flush() {
        const text = parts.join('');
        parts.length = 0;
        if (headingDepth) {
            if (text.trim()) blocks.push({ text: text.trim(), depth: headingDepth, scope });
        } else {
            for (const paragraph of textBlocks(text, '\n')) blocks.push({ text: paragraph, scope });
        }
    }

    while (pending.length) {
        const node = pending.pop();
        if (node === blockEnd || node === preEnd || node === headingEnd || node === sectionEnd) {
            parts.push('\u2029');
            if (node === preEnd) preDepth--;
            if (node === headingEnd || node === sectionEnd) {
                flush();
                if (node === headingEnd) headingDepth = 0;
                else scope = scope.scope;
            }
            continue;
        }
        if (node.nodeName === '#text') {
            if (locations) visible.push(locations.visible(node));
            parts.push(preDepth ? node.value : node.value.replace(/\s+/g, ' '));
            continue;
        }
        if (!node.childNodes || hiddenElements.has(node.tagName) || node.attrs?.some(attr => attr.name === 'hidden')) {
            continue;
        }
        if (node.tagName === 'br') {
            parts.push('\n');
            continue;
        }
        if (blockElements.has(node.tagName)) {
            let close = blockEnd;
            if (node.tagName === 'pre') { preDepth++; close = preEnd; }
            else if (blocks && /^h[1-6]$/.test(node.tagName)) {
                flush();
                headingDepth = Number(node.tagName[1]);
                close = headingEnd;
            } else if (blocks && htmlContainers.has(node.tagName)) {
                flush();
                scope = { scope, kind: ({ol:'list',ul:'list',li:'listItem'})[node.tagName] ?? node.tagName, structural:true, children: [], omitWhenEmpty: true };
                blocks.push(scope);
                close = sectionEnd;
            }
            parts.push('\u2029');
            pending.push(close);
        }
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            pending.push(node.childNodes[i]);
        }
    }
    if (blocks) flush();
    else return parts.join('');
}

// A single newline often wraps prose. Blank lines, explicit headings and new
// list items start units of their own; continuation lines stay with their item.
function* textBlocks(text, joiner = ' ') {
    const lines = [];
    for (const raw of text.replace(/\r\n?|\u2028/g, '\n').replace(/\u2029/g, '\n\n').split('\n')) {
        const line = raw.trim();
        const heading = /^#{1,6}\s/.test(line);
        const item = /^(?:[-*+•‣◦▪]|\d{1,3}[.)]|\(\d{1,3}\))\s/.test(line);
        if ((!line || heading || item) && lines.length) {
            yield lines.join(joiner);
            lines.length = 0;
        }
        if (heading) yield line;
        else if (line) lines.push(line);
    }
    if (lines.length) yield lines.join(joiner);
}

export function sentenceLocale(locale = 'en') {
    if (typeof locale !== 'string') throw new TypeError('locale must be a language tag string.');
    return locale === 'en' ? locale : Intl.getCanonicalLocales(locale)[0];
}

const segmenters = new Map();

export function* sentenceEnds(text, locale = 'en') {
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
        segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
        segmenters.set(locale, segmenter);
    }
    const exceptions = abbreviations[locale];
    // Compact padding before segmentation and restore the original offsets. A BOM is a
    // formatting character for sentence breaks, even though JS counts it as whitespace.
    const compact = collapseRuns(text, /[^\S\r\n\u2028\u2029]{2,}/gu, run => /^\uFEFF+$/u.test(run) ? '\uFEFF' : ' ');
    // Mark the character after a period even across a line break, preserving its UTF-16 width.
    const marked = compact.text.replace(/(\.\s+)([a-z]|[^\x00-\x7f])/gu, (_, gap, c) => gap + c.toLocaleUpperCase().slice(0, c.length));
    let end = 0;
    for (const line of marked.matchAll(/[^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$)/gu)) {
        for (const { index, segment } of segmenter.segment(line[0])) {
            const lastWord = /(?:^|\s)(\S+)\s+$/u.exec(segment)?.[1];
            if (lastWord && (lastWord.endsWith(')') || exceptions?.has(lastWord.toLocaleLowerCase(locale)))) continue;
            end = compact.sourceOffset(line.index + index + segment.length);
            yield end;
        }
    }
    // A trailing abbreviation with whitespace may still be pending.
    if (end < text.length) yield text.length;
}

function splitSentences(text, locale, excludeNonLetterSentences) {
    const sentences = [];
    const multiline = /[\r\n\u2028\u2029]/.test(text);
    for (const block of multiline ? textBlocks(text) : [text.trim()]) {
        const normalized = block.replace(/\s+/g, ' ');
        // Keep a numbered list marker with its item.
        const marked = multiline ? normalized.replace(/^(\d{1,3})\.(?= )/, '$1)') : normalized;
        let start = 0;
        for (const end of sentenceEnds(marked, locale)) {
            const sentence = normalized.slice(start, end).trim();
            start = end;
            if (!excludeNonLetterSentences || /\p{L}/u.test(sentence)) sentences.push(sentence);
        }
    }
    return sentences;
}

function textHierarchy(blocks, locale, filter) {
    const parts = [];
    let position = 0;
    function children(node) {
        if (node.children || node.lines === undefined) return node.children;
        const marked = node.lines.replaceAll('\n', ' ').replace(/^(\d{1,3})\.(?= )/, '$1)');
        const sentences = [];
        let from = 0;
        for (const to of sentenceEnds(marked, locale)) {
            const raw = node.lines.slice(from, to), text = raw.trim();
            const start = node.start + to - raw.trimStart().length;
            if (text) sentences.push({ start, end: start + text.length, endsLine: raw.endsWith('\n'),
                skip: filter && !/\p{L}/u.test(text) });
            from = to;
        }
        return lineChildren(sentences);
    }
    for (const block of blocks) {
        block.start = block.end = position;
        if (block.text === undefined) continue; // An explicit HTML section starts at its first content.
        const lines = block.text.split(/[\r\n\u2028\u2029]+/u).map(line => line.trim().replace(/\s+/gu, ' ')).filter(Boolean).join('\n');
        const body = lines.replaceAll('\n', ' ');
        block.end += body.length;
        const paragraph = { start: block.start, end: block.end, lines, kind: block.depth ? 'heading' :
            /^(?:[-*+•‣◦▪]|\d{1,3}[.)]|\(\d{1,3}\))\s/u.test(body) ? 'listItem' : 'paragraph' };
        if (filter) {
            paragraph.children = children(paragraph);
            paragraph.skip = paragraph.children.every(child => child.skip);
            paragraph.blocked = paragraph.children.some(child => child.skip || child.blocked);
        }
        if (block.depth) {
            block.structural = true;
            block.kind = 'section';
            block.children = [paragraph];
            block.omitWhenEmpty = true;
        } else Object.assign(block, paragraph);
        parts.push(body);
        position = block.end + 2;
    }
    return { source: parts.join('\n\n'), roots: sectionTree(blocks), children };
}

export async function parseText(text, options, embed, capture) {
    const { inputFormat, excludeNonLetterSentences, strategy } = options;
    if (inputFormat !== 'text' && inputFormat !== 'html') throw new TypeError("inputFormat must be 'text', 'html', 'markdown' or 'json'.");
    if (strategy === 'pack') {
        const locale = sentenceLocale(options.locale);
        const body = inputFormat === 'html' ? await htmlToText(text) : text;
        if (!capture) return splitSentences(body, locale, excludeNonLetterSentences);
        const tree = await parseTextTree(text, options, true);
        capture.tree?.(tree);
        const all = splitSentences(body, locale, false).filter(Boolean);
        const flat = alignWhitespace(tree.view, all.join(' '));
        let offset = 0;
        capture.sentences = [];
        for (const sentence of all) {
            if (!excludeNonLetterSentences || /\p{L}/u.test(sentence)) capture.sentences.push(sliceView(flat,offset,offset+sentence.length));
            offset += sentence.length + 1;
        }
        capture.flat = capture.sentences.length === all.length ? flat : joinViews(capture.sentences,' ');
        return capture.sentences.map(s=>s.text);
    }
    const tree = await parseTextTree(text, options, !!capture);
    capture?.tree?.(tree);
    const { source, roots, children, splitLeaf } = tree;
    const units = await chunkHierarchy(source, roots, { ...options, children, splitLeaf }, embed);
    if (capture) capture.chunks = units.map(({start,end})=>sliceView(tree.view,start,end));
    return units.map(({ start, end }) => source.slice(start, end));
}

export async function parseTextTree(text, { inputFormat, excludeNonLetterSentences, locale: tag, fits }, locate = false) {
    const locale = sentenceLocale(tag);
    const blocks = [];
    const visible = locate && inputFormat === 'html' ? [] : undefined;
    if (inputFormat === 'html') {
        await htmlToText(text, blocks, visible);
    } else {
        for (const body of textBlocks(text, '\n')) {
            blocks.push({ text: body, depth: /^(#{1,6})\s/u.exec(body)?.[1].length });
        }
    }
    const { source, roots, children } = textHierarchy(blocks, locale, excludeNonLetterSentences);
    function splitLeaf(node) {
        if (!fits) return [node];
        return splitSpans(source, node.start, node.end, (a, b) => fits(source.slice(a, b)), { keepWhitespace: false })
            .map(([start, end]) => ({ start, end }));
    }
    return { source, roots, children, splitLeaf, view: locate ? alignWhitespace(visible ? joinViews(visible) : literal(text), source) : undefined };
}
