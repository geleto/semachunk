import { appendRange, literal, sliceView } from './citations.js';

// parse5 sometimes appends multiple, noncontiguous source tokens to a DOM
// text node (e.g. table foster parenting). Retain token intervals in DOM order.
export async function locatedHtml(source, adapter) {
    const { DecodingMode, EntityDecoder, htmlDecodeTree } = await import('entities/decode').catch(error => {
        throw new Error('Citable HTML input requires the optional entities package.', {cause:error});
    });
    const locations = new WeakMap();
    const treeAdapter = {
        ...adapter,
        getNodeSourceCodeLocation(node) {
            return node.nodeName === '#text' ? undefined : adapter.getNodeSourceCodeLocation(node);
        },
        setNodeSourceCodeLocation(node, loc) {
            if (node.nodeName !== '#text' || !loc) return adapter.setNodeSourceCodeLocation(node, loc);
            const spans = locations.get(node) ?? [];
            if (spans.length && loc.startOffset <= spans.at(-1)[1]) spans.at(-1)[1] = Math.max(loc.endOffset, spans.at(-1)[1]);
            else spans.push([loc.startOffset, loc.endOffset]);
            locations.set(node, spans);
        }
    };
    function visible(node, replaceNulls = false) {
        const rawText = ['xmp','iframe','noembed','noframes','plaintext'].includes(node.parentNode?.tagName);
        const parts = [], citations = [];
        let output = 0, decoded = '', sawNull = false;
        const decoder = new EntityDecoder(htmlDecodeTree, cp => { decoded += String.fromCodePoint(cp); });
        for (const [start,end] of locations.get(node) ?? []) {
            const raw = source.slice(start,end);
            if (parts.length === 0 && raw === node.value) return literal(raw,start);
            for (let i = 0; i < raw.length;) {
                let value = raw[i], count = 1;
                if (value === '&' && !rawText) {
                    decoded = '';
                    decoder.startEntity(DecodingMode.Legacy);
                    let length = decoder.write(raw,i+1);
                    if (length < 0) length = decoder.end();
                    if (length > 0) { value = decoded; count = length; }
                } else if (value === '\r') { value = '\n'; if (raw[i+1] === '\n') count++; }
                else if (value === '\0') {
                    sawNull = true;
                    value = replaceNulls ? '\uFFFD' : '';
                }
                parts.push(value);
                appendRange(citations,start+i,start+i+count,output,output+value.length);
                output += value.length;
                i += count;
            }
        }
        // Some HTML tree-construction rules discard the first LF in pre/textarea.
        const view = {text:parts.join(''), citations};
        if (view.text !== node.value && view.text.startsWith('\n') && view.text.slice(1) === node.value) {
            return sliceView(view,1,view.text.length);
        }
        if (view.text !== node.value) {
            // The HTML insertion mode can discard NUL or emit U+FFFD. Comparing
            // against the DOM also preserves independently authored U+FFFDs.
            if (sawNull && !replaceNulls) return visible(node,true);
            throw new Error('Could not map visible HTML text to its source.');
        }
        return view;
    }
    return {treeAdapter, visible};
}
