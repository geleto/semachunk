import { loadMarkdownParser } from '../src/markdown-units.js';
import { parseTextTree } from '../src/sentences.js';
import { chunkHierarchy } from '../src/semantic-blocks.js';
import { hierarchicalBlocks } from '../src/hierarchy.js';

// Experiments use the production parser, rendered citations, size guards and hierarchy packer.
export async function treeLayout(raw, format, budget, method, embed, visit) {
    const tree = format === 'markdown' ? (await loadMarkdownParser()).parseMarkdownTree(raw,budget)
        : await parseTextTree(raw,{inputFormat:format,...budget});
    const source = tree.source ?? raw;
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
    const units = method === 'independent-roots' ? hierarchicalBlocks(source,tree.roots,{...budget,children,splitLeaf:tree.splitLeaf})
        : await chunkHierarchy(source,tree.roots,{ ...budget, children, splitLeaf:tree.splitLeaf,
        strategy:method === 'blocks' ? 'blocks' : 'semantic-blocks', calibrate:false,
        combineChunksSimilarityThreshold:method === 'paragraph' ? .15 : method.startsWith('paragraph/') ? Number(method.split('/')[1])
            : method === 'tree' ? -2 : Number(method)
    }, method === 'tree' ? async texts => texts.map(() => [1]) : embed);
    const render = tree.render ?? (({start,end}) => ({text:source.slice(start,end),
        sourceRanges:[{start,end,outputStart:0}]}));
    return {source,rows:units.map(render),render,splitLeaf:tree.splitLeaf};
}
