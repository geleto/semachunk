// Parsers provide nodes in source order. A bounded outline ends at its enclosing element.
// Compute subtree spans and propagate omissions once, before a size budget is applied.
export function sectionTree(blocks) {
    const root = {children:[]}, headings = [];
    for (const block of blocks) {
        while (headings.at(-1)?.scopeEnd <= block.start) headings.pop();
        if (block.depth) {
            while (headings.length && headings.at(-1).depth >= block.depth) headings.pop();
        }
        (headings.at(-1) ?? root).children.push(block);
        if (block.depth) headings.push(block);
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
        const node = blocks[i];
        if (!node.children) continue;
        if (node.children.length) node.end = node.children.at(-1).end;
        if (node.omitWhenEmpty && node.children.every(child => child.skip)) node.skip = true;
        if (node.children.some(child => child.skip || child.blocked)) node.blocked = true;
    }
    return root.children;
}

// Roots are independent. Inside a parent, only consecutive whole children can share a passage.
// Skip omitted nodes and descend into blocked nodes, such as a section containing a hidden definition.
// Each contiguous candidate has a constant-time UTF-16 length, including its separators.
// The optional token predicate measures the exact rendered slice.
export function hierarchicalBlocks(source, roots, { maxChunkSize, fits, fitsStructure, children = node => node.children, splitLeaf }) {
    function within(start, end, structural) {
        // Both predicates count the same rendered text and prefix. The branch limit is tighter.
        const accepts = structural && fitsStructure ? fitsStructure : fits;
        return end-start <= maxChunkSize && (!accepts || accepts(source.slice(start,end)));
    }
    const output = [], stack = [{ nodes: roots, index: 0 }];
    let pending;
    function flush() {
        if (!pending) return;
        const { first, last, parent } = pending;
        output.push(first === last ? first : { ...parent, start: first.start, end: last.end, firstChild: first });
        pending = undefined;
    }
    while (stack.length) {
        const frame = stack.at(-1);
        if (frame.index === frame.nodes.length) {
            flush();
            stack.pop();
            continue;
        }
        const node = frame.nodes[frame.index++], parent = frame.parent;
        if (!node.skip && !node.blocked && within(node.start, node.end, node.structural)) {
            if (pending && parent && pending.parent === parent && !parent.separateChildren && !node.breakBefore &&
                within(pending.first.start, node.end, parent.structural)) {
                pending.last = node;
            } else {
                flush();
                pending = { first: node, last: node, parent };
            }
            continue;
        }
        flush();
        if (node.skip) continue;
        const nested = children(node);
        if (nested?.length) stack.push({ nodes: nested, parent: node, index: 0 });
        else for (const part of splitLeaf(node)) output.push(part);
    }
    return output;
}

// A line ending is a stronger cut when it also ends a sentence or an explicit hard break.
// Sentence spans already protect abbreviations, inline markup and wrapped prose.
export function lineChildren(sentences) {
    if (!sentences.some((s, i) => s.endsLine && i + 1 < sentences.length)) return sentences;
    const lines = [];
    let first = 0;
    for (let i = 0; i < sentences.length; i++) {
        if (!sentences[i].endsLine && i + 1 < sentences.length) continue;
        const children = sentences.slice(first, i + 1);
        lines.push(first === i ? sentences[i] : { ...sentences[first], end: sentences[i].end, children,
            skip: children.every(s => s.skip), blocked: children.some(s => s.skip) });
        first = i + 1;
    }
    return lines;
}
