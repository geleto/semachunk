import { hierarchicalBlocks } from './hierarchy.js';
import { directionCosine, documentMergeThreshold, SimilarityStatistics, vectorDirection } from './similarity.js';

function rejoinParagraphs(source, units, seams, {maxChunkSize,fits,fitsStructure}) {
    const out = [];
    const accepts = fitsStructure ?? fits;
    for (const unit of units) {
        const prev = out.at(-1);
        const end = seams.get(unit.start);
        if (end !== undefined && prev && !prev.parts && !unit.parts && prev.end === end &&
            unit.end-prev.start <= maxChunkSize && (!accepts || accepts(source.slice(prev.start,unit.end)))) {
            // Copy the left occurrence so the original hierarchy stays addressable.
            out[out.length-1] = {...prev,end:unit.end};
        } else out.push(unit);
    }
    return out;
}

export async function chunkHierarchy(source, roots, options, embed) {
    if (!roots.length) return [];

    // The document is the common parent of top-level paragraphs and sections.
    const root = roots.length === 1 ? roots[0] : {
        start: roots[0].start, end: roots.at(-1).end, children: roots, structural:true, headingPath: [], sectionId: null,
        blocked: roots.some(child => child.skip || child.blocked)
    };
    if (options.strategy !== 'semantic') return hierarchicalBlocks(source, [root], options);
    const { children, maxChunkSize, fits } = options;
    const parents = [], stack = [root], edges = [], inputs = new Map();
    const seams = options.joinParagraphs && new Map();
    function input(text) {
        if (!inputs.has(text)) inputs.set(text, inputs.size);
        return inputs.get(text);
    }
    while (stack.length) {
        const node = stack.pop();
        if (node.skip) continue;
        const nested = children(node);
        if (!nested?.length) continue;
        node.children = nested;
        parents.push(node);
        for (let i = nested.length - 1; i >= 0; i--) stack.push(nested[i]);
        for (let i = 1; i < nested.length; i++) {
            const left = nested[i - 1], right = nested[i];
            if (seams && left.kind === 'paragraph' && right.kind === 'paragraph' && !left.skip && !right.skip &&
                !left.blocked && !right.blocked && !/\S/u.test(source.slice(left.end,right.start))) {
                seams.set(right.start,left.end);
            }
            if (left.skip || right.skip || left.blocked || right.blocked || right.end - left.start > maxChunkSize) continue;
            const a = source.slice(left.start, left.end), b = source.slice(right.start, right.end);
            if (fits && (!fits(a) || !fits(b) || !fits(source.slice(left.start, right.end)))) {
                // Token counts need not be additive or monotone. A fitting ancestor
                // cannot bypass a boundary whose inputs could not be scored safely.
                right.breakBefore = true;
                continue;
            }
            edges.push({ right, a: input(a), b: input(b) });
        }
    }

    if (edges.length) {
        const directions = (await embed([...inputs.keys()])).map(vectorDirection);
        const stats = new SimilarityStatistics();
        for (const edge of edges) {
            edge.score = directionCosine(directions[edge.a], directions[edge.b]);
            if (options.calibrate) stats.add(edge.score);
        }
        const cutoff = options.calibrate ? documentMergeThreshold(stats, options.combineChunksSimilarityThreshold)
            : options.combineChunksSimilarityThreshold;
        for (const edge of edges) if (edge.score < cutoff) edge.right.breakBefore = true;
    }

    // Propagate every cut to its ancestors before accepting even a fitting section.
    // The ordinary hierarchy traversal then packs whole siblings on either side.
    for (let i = parents.length - 1; i >= 0; i--) {
        const parent = parents[i];
        if (parent.children.some(child => child.breakBefore || child.blocked || child.skip)) parent.blocked = true;
    }
    const units = hierarchicalBlocks(source, [root], options);
    return seams ? rejoinParagraphs(source,units,seams,options) : units;
}
