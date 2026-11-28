import { structuredResult } from './structured-units.js';
import { chunkHierarchy } from './semantic.js';
import { packedRanges } from './packing.js';

export async function chunkStructured(document, embed, options, capture) {
    const {source} = document;
    const { strategy, maxChunkSize, fits, fitsOverlap } = options;
    const tree = (strategy !== 'pack' || capture) && document.tree(options);
    if (tree) capture?.tree?.(tree);
    let passages;
    if (strategy === 'blocks' || strategy === 'semantic') {
        const { roots, children, splitLeaf, renderUnits } = tree;
        passages = renderUnits(await chunkHierarchy(source, roots, { ...options, children, splitLeaf }, embed));
    } else {
        passages = packStructured(source, document.units(options), maxChunkSize, fits, fitsOverlap).map(unit => structuredResult(source, unit));
    }
    if (capture && !passages.length) passages = tree.standaloneHeadings();
    return document.project ? passages.map(document.project) : passages;
}

export function fitsStructuredJoin(source, left, right, maxChunkSize, fits, start = left.start) {
    return !left.parts && !right.parts && left.sectionId === right.sectionId && left.run === right.run &&
        right.end - start <= maxChunkSize &&
        !/\S/u.test(source.slice(left.end, right.start)) && (!fits || fits(source.slice(start, right.end)));
}

export function packStructured(source, units, maxChunkSize, fits, fitsOverlap) {
    function canAppend(first, next) {
        const left = units[next - 1], right = units[next];
        return left.kind === 'prose' && right.kind === 'prose' &&
            fitsStructuredJoin(source, left, right, maxChunkSize, fits, units[first].start);
    }
    const ranges = packedRanges(units.length, canAppend,
        fitsOverlap && ((first, last) => fitsOverlap(source.slice(units[first].start, units[last].end))));
    return Array.from(ranges, ([first, last]) => ({ ...units[first], end: units[last].end }));
}
