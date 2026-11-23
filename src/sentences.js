import { splitBySentence } from 'string-segmenter';

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

export async function parseSentences(text, { inputFormat, locale = 'en', excludeNonLetterSentences }) {
    if (typeof locale !== 'string') throw new TypeError('locale must be a language tag string.');
    // Preserve the default fast path. Reject invalid tags even for empty input.
    if (locale !== 'en') [locale] = Intl.getCanonicalLocales(locale);
    if (inputFormat === 'html') {
        text = await htmlToText(text);
    } else if (inputFormat !== 'text') {
        throw new TypeError("inputFormat must be 'text' or 'html'.");
    }

    const sentences = [];
    const multiline = /[\r\n\u2028\u2029]/.test(text);
    for (const block of multiline ? textBlocks(text) : [text.trim()]) {
        const normalized = block.replace(/\s+/g, ' ');
        // Mask a numbered list marker's period and preserve source offsets when
        // the segmenter uppercases a character that expands (e.g. ß to SS).
        const marked = multiline ? normalized.replace(/^(\d{1,3})\.(?= )/, '$1)') : normalized;
        const boundaryText = marked.replace(/(?<=\. )[^\x00-\x7f]/gu, char => char.toUpperCase().slice(0, char.length));
        for (const { index, segment } of splitBySentence(boundaryText, locale)) {
            const sentence = normalized.slice(index, index + segment.length).trim();
            if (!excludeNonLetterSentences || /\p{L}/u.test(sentence)) sentences.push(sentence);
        }
    }
    return sentences;
}
