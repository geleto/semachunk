import { splitBySentence } from 'string-segmenter';
import { packSentences } from './packing.js';

const blockElements = new Set(
    'address article aside blockquote caption dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre section summary table tbody td th tr ul'.split(' ')
);
const hiddenElements = new Set(['head', 'script', 'style', 'template', 'noscript', 'title']);

async function htmlToText(html) {
    const { parse } = await import('parse5').catch(error => {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("package 'parse5'")) {
            throw new Error("HTML input requires the optional parse5 package. Install it with npm install parse5.", { cause: error });
        }
        throw error;
    });
    const pending = [parse(html)];
    const parts = [];
    const blockEnd = {}, preEnd = {};
    let preDepth = 0;

    while (pending.length) {
        const node = pending.pop();
        if (node === blockEnd || node === preEnd) {
            parts.push('\u2029');
            if (node === preEnd) preDepth--;
            continue;
        }
        if (node.nodeName === '#text') {
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
            parts.push('\u2029');
            if (node.tagName === 'pre') preDepth++;
            pending.push(node.tagName === 'pre' ? preEnd : blockEnd);
        }
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            pending.push(node.childNodes[i]);
        }
    }
    return parts.join('');
}

// A single newline often wraps prose. Blank lines, explicit headings and new
// list items start units of their own; continuation lines stay with their item.
function* textBlocks(text) {
    const lines = [];
    for (const raw of text.replace(/\r\n?|\u2028/g, '\n').replace(/\u2029/g, '\n\n').split('\n')) {
        const line = raw.trim();
        const heading = /^#{1,6}\s/.test(line);
        const item = /^(?:[-*+•‣◦▪]|\d{1,3}[.)]|\(\d{1,3}\))\s/.test(line);
        if ((!line || heading || item) && lines.length) {
            yield lines.join(' ');
            lines.length = 0;
        }
        if (heading) yield line;
        else if (line) lines.push(line);
    }
    if (lines.length) yield lines.join(' ');
}

export function sentenceLocale(locale = 'en') {
    if (typeof locale !== 'string') throw new TypeError('locale must be a language tag string.');
    return locale === 'en' ? locale : Intl.getCanonicalLocales(locale)[0];
}

export function* sentenceEnds(text, locale) {
    // The segmenter uppercases the character after a period and whitespace.
    // Keep its offsets valid when uppercasing expands a character (e.g. ß).
    const marked = text.replace(/(?<=\.\s+)[^\x00-\x7f]/gu, c => c.toLocaleUpperCase().slice(0, c.length));
    let end = 0;
    for (const { index, segment } of splitBySentence(marked, locale)) {
        end = index + segment.length;
        yield end;
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

export async function parseText(text, { inputFormat, locale, excludeNonLetterSentences, strategy, maxChunkSize, fits }) {
    locale = sentenceLocale(locale);
    if (inputFormat === 'html') text = await htmlToText(text);
    else if (inputFormat !== 'text') throw new TypeError("inputFormat must be 'text', 'html' or 'markdown'.");

    if (strategy !== 'blocks') return splitSentences(text, locale, excludeNonLetterSentences);
    const paragraphs = text.replace(/\r\n?|\u2028/g, '\n').split(/\n[^\S\n]*\n|\u2029/u);
    return paragraphs.flatMap(paragraph => {
        const body = paragraph.replace(/\s+/gu, ' ').trim();
        if (!body) return [];
        if (!excludeNonLetterSentences && body.length <= maxChunkSize && (!fits || fits(body))) return [body];
        return packSentences(splitSentences(paragraph, locale, excludeNonLetterSentences), maxChunkSize, fits);
    });
}
