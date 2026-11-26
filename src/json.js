import { parseTree, printParseErrorCode } from 'jsonc-parser';
import { packedRanges } from './packing.js';
import { sentenceEnds, sentenceLocale } from './sentences.js';
import { splitSpans } from './token-limit.js';

// On valid JSON a backslash always starts an escape. Match surrogate pairs first.
const escape = /(?:\\u[dD][89abAB][\da-fA-F]{2}|[\uD800-\uDBFF])(?:\\u[dD][c-fC-F][\da-fA-F]{2}|[\uDC00-\uDFFF])|\\(?:u[\da-fA-F]{4}|.)/g;

export function splitJsonSpans(source, spans, fits) {
    if (!fits || spans.every(([a, b]) => fits(a, b))) return spans;
    const start = spans[0][0], end = spans.at(-1)[1];
    const escapes = Array.from(source.slice(start, end).matchAll(escape),
        m => [start + m.index, start + m.index + m[0].length]);
    return splitSpans(source, start, end, fits, { protectedSpans: escapes, indivisible: true, softSpans: spans });
}

// Pack lines of the decoded value, splitting an oversized line at sentence
// boundaries. Measure and return offsets in the original JSON spelling.
export function jsonValueSpans(source, node, memberStart, bom, size, locale) {
    const start = bom + node.offset, end = start + node.length;
    if (node.type !== 'string' || !size || node.length <= size) return [[memberStart, end]];
    const value = node.value, edges = [start], escaped = node.length > value.length + 2;
    function advance(raw, units) {
        if (!escaped) return raw + units;
        for (let i = 0; i < units; i++) raw += source[raw] === '\\' ? (source[raw + 1] === 'u' ? 6 : 2) : 1;
        return raw;
    }
    let from = 0, raw = start + 1;
    for (const line of value.matchAll(/[^\r\n\u2028\u2029]*[\r\n\u2028\u2029]+|[^\r\n\u2028\u2029]+$/gu)) {
        const to = from + line[0].length, next = advance(raw, to - from);
        const lineEnd = to === value.length ? end : next;
        if (lineEnd - (from ? raw : start) > size) {
            let cursor = raw, previous = 0;
            for (const cut of sentenceEnds(line[0], locale)) {
                // The line boundary below includes the entire trailing run of breaks.
                if (cut === line[0].length || /[\r\n\u2028\u2029]/u.test(line[0][cut])) break;
                if (/[!-~]/.test(value[from + cut - 1]) && /[!-~]/.test(value[from + cut])) continue;
                cursor = advance(cursor, cut - previous);
                edges.push(cursor);
                previous = cut;
            }
        }
        edges.push(lineEnd);
        from = to;
        raw = next;
    }
    if (edges.length < 3) return [[memberStart, end]];
    return Array.from(packedRanges(edges.length - 1, (a, b) => edges[b + 1] - edges[a] <= size),
        ([a, b]) => [a ? edges[a] : memberStart, edges[b + 1]]);
}

export function chunkJson(source, maxChunkSize, fits, locale) {
    locale = sentenceLocale(locale);
    const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    const errors = [];
    let root;
    try {
        root = parseTree(source.slice(bom), errors, {
            disallowComments: true, allowTrailingComma: false, allowEmptyContent: true
        });
    } catch (error) {
        if (error instanceof RangeError && /call stack/i.test(error.message)) {
            throw new SyntaxError('JSON nesting exceeds the parser stack.', { cause: error });
        }
        throw error;
    }
    if (errors.length) {
        const { error, offset } = errors[0];
        throw new SyntaxError('Invalid JSON at offset ' + (bom + offset) + ' (' + printParseErrorCode(error) + ').');
    }
    if (!root) return [];

    const chunks = [];
    const within = fits && ((a, b) => fits(source.slice(a, b)));
    const stack = [{ node: root, start: bom + root.offset, pointer: '' }];
    let previousGroup;
    while (stack.length) {
        const { node, start, pointer, group } = stack.pop();
        const end = bom + node.offset + node.length;
        const children = node.children;
        const separateRecords = node === root && node.type === 'array';
        const intact = !separateRecords && end - start <= maxChunkSize && (!within || within(start, end));
        if (children?.length && !intact) {
            // Root-array items are separate records. Other children share their parent's identity and pointer.
            const siblings = separateRecords ? undefined : { pointer };
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                const property = child.type === 'property';
                const key = property ? child.children[0].value.replaceAll('~', '~0').replaceAll('/', '~1') : i;
                stack.push({ node: property ? child.children[1] : child, start: bom + child.offset, pointer: pointer + '/' + key, group: siblings });
            }
            continue;
        }
        if (intact && group && group === previousGroup) {
            const previous = chunks.at(-1), range = previous.sourceRanges[0];
            if (end - range.start <= maxChunkSize) {
                const joined = source.slice(range.start, end);
                if (!fits || fits(joined)) {
                    previous.text = joined;
                    previous.jsonPointer = group.pointer;
                    range.end = end;
                    continue;
                }
            }
        }
        previousGroup = intact ? group : undefined;
        const spans = jsonValueSpans(source, node, start, bom, maxChunkSize, locale);
        for (const [from, to] of splitJsonSpans(source, spans, intact ? undefined : within)) {
            chunks.push({ text: source.slice(from, to), jsonPointer: pointer, sourceRanges: [{ start: from, end: to, outputStart: 0 }] });
        }
    }
    return chunks;
}
