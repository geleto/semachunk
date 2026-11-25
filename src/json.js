import { parseTree, printParseErrorCode } from 'jsonc-parser';
import { splitSpans } from './token-limit.js';

// On valid JSON a backslash always starts an escape. Match surrogate pairs first.
const escape = /\\(?:u[dD][89abAB][\da-fA-F]{2}\\u[dD][c-fC-F][\da-fA-F]{2}|u[\da-fA-F]{4}|.)/g;

export function chunkJson(source, maxChunkSize, fits) {
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
    const stack = [{ node: root, start: bom + root.offset, pointer: '' }];
    while (stack.length) {
        const { node, start, pointer } = stack.pop();
        const end = bom + node.offset + node.length;
        const children = node.children;
        const descend = children?.length && ((node === root && node.type === 'array') || end - start > maxChunkSize);
        const whole = !descend && (!fits || fits(source.slice(start, end)));
        if (children?.length && !whole) {
            for (let i = children.length - 1; i >= 0; i--) {
                const child = children[i];
                const property = child.type === 'property';
                const key = property ? child.children[0].value.replaceAll('~', '~0').replaceAll('/', '~1') : i;
                stack.push({ node: property ? child.children[1] : child, start: bom + child.offset, pointer: pointer + '/' + key });
            }
            continue;
        }
        let spans = [[start, end]];
        if (!whole) {
            const escapes = Array.from(source.slice(start, end).matchAll(escape), m => [start + m.index, start + m.index + m[0].length]);
            spans = splitSpans(source, start, end, (a, b) => fits(source.slice(a, b)), true, escapes, true);
        }
        for (const [a, b] of spans) {
            chunks.push({ text: source.slice(a, b), jsonPointer: pointer, sourceRanges: [{ start: a, end: b, outputStart: 0 }] });
        }
    }
    return chunks;
}
