import { loadMarkdownParser } from '../src/markdown-units.js';
import { parseTextTree } from '../src/sentences.js';
import { chunkHierarchy } from '../src/semantic-blocks.js';
import { hierarchicalBlocks } from '../src/hierarchy.js';

// Experiments use the production parser, rendered citations, size guards and hierarchy packer.
export async function treeLayout(raw, format, budget, method, embed, visit, separateSections = false) {
    const tree = format === 'markdown' ? (await loadMarkdownParser()).parseMarkdownTree(raw,budget)
        : await parseTextTree(raw,{inputFormat:format,...budget});
    const source = tree.source ?? raw;
    let roots = tree.roots;
    const headings = [];
    if (separateSections && roots.length) {
        const root = roots.length === 1 ? roots[0] : {
            start: roots[0].start, end: roots.at(-1).end, children: roots, headingPath: [], sectionId: null
        };
        // A fitting ancestor must respect a boundary between authored sections too.
        function mark(node) {
            if (node.depth && !node.skip) {
                const first = node.children[0];
                const heading = format === 'markdown' ? first?.leading?.find(h => h.start === node.start) : first;
                if (heading) headings.push({ start: node.start, end: heading.end, sectionEnd: node.end });
            }
            for (const [i, child] of (node.children ?? []).entries()) {
                mark(child);
                if (child.depth && i > 0) child.breakBefore = true;
                if (child.breakBefore || child.blocked || child.skip) node.blocked = true;
            }
        }
        mark(root);
        roots = [root];
    }
    const fits = s => s.length <= budget.maxChunkSize && (!budget.fits || budget.fits(s));
    const visited = visit && new WeakSet();
    function children(node) {
        const paragraph = node.lines !== undefined || node.kind === 'paragraph';
        if ((method === 'paragraph' || method.startsWith('paragraph/')) && paragraph && !node.blocked && fits(source.slice(node.start,node.end))) return;
        const nested = tree.children(node);
        if (visit && nested && !visited.has(node)) {
            visited.add(node);
            visit(source,node,nested,paragraph);
        }
        return nested;
    }
    // A constant direction accepts every scoreable pair. Token guards and the shared root are intact.
    const units = method === 'independent-roots' ? hierarchicalBlocks(source,roots,{...budget,children,splitLeaf:tree.splitLeaf})
        : await chunkHierarchy(source,roots,{ ...budget, children, splitLeaf:tree.splitLeaf,
        strategy:method === 'blocks' ? 'blocks' : 'semantic-blocks', calibrate:false,
        combineChunksSimilarityThreshold:method === 'paragraph' ? .15 : method.startsWith('paragraph/') ? Number(method.split('/')[1])
            : method === 'tree' ? -2 : Number(method)
    }, method === 'tree' ? async texts => texts.map(() => [1]) : embed);
    const render = tree.render ?? (({start,end}) => ({text:source.slice(start,end),
        sourceRanges:[{start,end,outputStart:0}]}));
    return {source,rows:units.map(render),render,splitLeaf:tree.splitLeaf,headings};
}

// Join only standalone headings to a body actually inside their source section.
// Flush an empty sibling heading before entering another section.
export function attachHeadings(headings, rows) {
    const byStart = new Map(headings.map(h => [h.start,h])), out = [];
    for (let i=0; i<rows.length; i++) {
        let row = rows[i];
        const heading = byStart.get(row.sourceRanges[0].start);
        while (heading && row.sourceRanges.at(-1).end <= (byStart.get(row.sourceRanges.at(-1).start)?.end ?? heading.end) &&
                i+1 < rows.length && rows[i+1].sourceRanges[0].start < heading.sectionEnd) {
            const next = rows[++i], shift = row.text.length + 2;
            row = {text: row.text + '\n\n' + next.text, sourceRanges: [
                ...row.sourceRanges, ...next.sourceRanges.map(r => ({...r,outputStart:r.outputStart + shift}))]};
        }
        out.push(row);
    }
    return out;
}
