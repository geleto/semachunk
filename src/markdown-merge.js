import { loadMarkdownParser, markdownResult } from './markdown-units.js';
import { chunkHierarchy } from './semantic-blocks.js';
import { packedRanges } from './packing.js';

export async function chunkMarkdown(source, embed, options, capture) {
    const { strategy, maxChunkSize, fits, fitsOverlap } = options;
    const { parseMarkdown, parseMarkdownTree } = await loadMarkdownParser();
    if (strategy === 'blocks' || strategy === 'semantic-blocks') {
        const tree = parseMarkdownTree(source, options);
        capture?.tree?.(tree);
        const { roots, children, splitLeaf, renderUnits } = tree;
        return renderUnits(await chunkHierarchy(source, roots, { ...options, children, splitLeaf }, embed));
    }
    if (capture?.tree) capture.tree(parseMarkdownTree(source, options));
    const units = parseMarkdown(source, options);
    return packMarkdown(source, units, maxChunkSize, fits, fitsOverlap).map(unit => markdownResult(source, unit));
}

export function fitsMarkdownJoin(source, left, right, maxChunkSize, fits, start = left.start) {
    return !left.parts && !right.parts && left.sectionId === right.sectionId && left.run === right.run &&
        right.end - start <= maxChunkSize &&
        !/\S/u.test(source.slice(left.end, right.start)) && (!fits || fits(source.slice(start, right.end)));
}

export function packMarkdown(source, units, maxChunkSize, fits, fitsOverlap) {
    function canAppend(first, next) {
        const left = units[next - 1], right = units[next];
        return left.kind === 'prose' && right.kind === 'prose' &&
            fitsMarkdownJoin(source, left, right, maxChunkSize, fits, units[first].start);
    }
    const ranges = packedRanges(units.length, canAppend,
        fitsOverlap && ((first, last) => fitsOverlap(source.slice(units[first].start, units[last].end))));
    return Array.from(ranges, ([first, last]) => ({ ...units[first], end: units[last].end }));
}
