import { alignWhitespace, appendRange, joinViews, sliceView } from './citations.js';
import { readStructuredUnits } from './structured-units.js';

const hidden = new Set(['head','script','style','template','noscript','title']);
const boundaries = new Set('address aside caption dd details dialog div dl dt fieldset figcaption figure footer form header hgroup hr main menu nav p summary'.split(' '));
const containers = new Map(Object.entries({article:'article',section:'section',blockquote:'blockquote',
    ol:'list',ul:'list',li:'listItem',table:'table',tr:'tableRow',th:'tableCell',td:'tableCell'}));

// Normalize a DOM text run once. Inline elements retain ranges in the visible
// string, so a sentence boundary inside a link label or inline code is protected.
function inlineLeaf(type, runs, depth) {
    let value = '';
    const children = [];
    for (const run of runs) {
        let text = run.value;
        if (type !== 'code') {
            text = text.replace(/\s+/gu,' ');
            if (!value || value.endsWith(' ')) text = text.trimStart();
        }
        if (!text && !run.break) continue;
        const start = value.length;
        value += text;
        const previous = children.at(-1);
        if (run.atom && previous?.atom === run.atom) previous.end = value.length;
        else children.push({type:run.break ? 'break' : run.atom?.type ?? 'text',atom:run.atom,start,end:value.length});
    }
    if (type !== 'code') value = value.trimEnd();
    if (!value || (type !== 'code' && !value.trim())) return;
    if (type === 'code') return {type,value,verbatim:true};
    return {type,value,depth,children:children.filter(c => c.start<value.length)};
}

function domBlocks(dom, locations) {
    const root = {type:'root',children:[]}, visible = [];
    let parent = root, mode = 'paragraph', depth, atom, header = false, runs = [];
    function flush() {
        const leaf = inlineLeaf(mode,runs,depth);
        if (leaf) parent.children.push(leaf);
        runs = [];
    }
    const stack = [dom];
    while (stack.length) {
        const node = stack.pop();
        if (node.close) {
            if (node.block) flush();
            ({parent,mode,depth,atom,header} = node);
            continue;
        }
        if (node.nodeName === '#text') {
            if (locations) visible.push(locations.visible(node));
            runs.push({value:node.value,atom});
            continue;
        }
        const tag = node.tagName;
        if (!node.childNodes || hidden.has(tag) || node.attrs?.some(a => a.name==='hidden')) continue;
        if (tag === 'br') {
            if (mode === 'code') runs.push({value:'\n'});
            else {
                let i = runs.length-1;
                while (i>=0 && !runs[i].break && !runs[i].value.trim()) i--;
                if (runs[i]?.break && mode==='paragraph') flush();
                else runs.push({value:' ',break:true});
            }
            continue;
        }
        const heading = /^h([1-6])$/u.exec(tag);
        const block = mode!=='code' && (heading || tag==='pre' || containers.has(tag) || boundaries.has(tag));
        stack.push({close:true,block,parent,mode,depth,atom,header});
        if (block) {
            flush();
            if (tag==='hr') parent.children.push({type:'thematicBreak',value:''});
            mode = heading ? 'heading' : tag==='pre' ? 'code' : 'paragraph';
            depth = heading ? Number(heading[1]) : undefined;
            atom = undefined;
            if (containers.has(tag)) {
                const group = {type:containers.get(tag),children:[]};
                if (tag==='tr') group.header = header;
                if (tag==='th') group.header = true;
                parent.children.push(group);
                parent = group;
            }
        } else if (mode!=='code' && !atom && (tag==='code' || tag==='a' && node.attrs.some(a=>a.name==='href'))) {
            atom = {type:tag==='code' ? 'inlineCode' : 'link'};
        }
        if (tag==='thead') header = true;
        for (let i=node.childNodes.length-1; i>=0; i--) stack.push(node.childNodes[i]);
    }
    flush();
    return {root,visible};
}

// Headings supply the outline of an authored section. Its wrapper bounds the
// heading's scope but does not introduce a duplicate section around that heading.
function normalize(node) {
    if (node.value !== undefined) return [node];
    const children = node.children.flatMap(normalize);
    node.children = children;
    if (node.type==='listItem' || node.type==='blockquote') {
        for (const child of children) if (child.type==='paragraph') child.prefixedContainer = true;
    }
    if (node.type==='tableCell') return [node]; // Empty cells still have a column.
    if (!children.length) return [];
    if (node.type==='section' || node.type==='article') {
        const headings = children.filter(c=>c.type==='heading');
        if (headings.length || children.length===1) {
            if (children.length>1) for (const h of headings) h.scopeLast ??= children.at(-1);
            return children;
        }
    }
    if (node.type==='table') {
        const groups = [];
        let table;
        for (const child of children) {
            if (child.type!=='tableRow') { groups.push(child); table=undefined; continue; }
            if (!table) { table={type:'table',children:[],headerRows:0}; groups.push(table); }
            if (table.headerRows===table.children.length && (child.header ||
                child.children.some(c=>c.header) && child.children.every(c=>c.header || !c.children.length))) table.headerRows++;
            table.children.push(child);
        }
        return groups;
    }
    return [node];
}

function position(root) {
    const parts = [], boundedHeadings = [];
    let length = 0;
    function append(s) { parts.push(s); length+=s.length; }
    const point = offset => ({offset,column:1});
    function write(node) {
        const start = length;
        if (node.value !== undefined) {
            append(node.value);
            for (const c of node.children ?? []) {
                const end = Math.min(c.end,node.value.length);
                c.position = {start:point(start+c.start),end:point(start+end)};
                c.value = node.value.slice(c.start,end);
            }
        } else {
            const separator = node.type==='tableRow' ? '\t' : node.type==='table' ? '\n' : '\n\n';
            let hasContent = false;
            for (const c of node.children) {
                if (c.type==='thematicBreak') { write(c); continue; }
                if (hasContent) append(separator);
                write(c);
                hasContent = true;
            }
        }
        node.position = {start:point(start),end:point(length)};
        if (node.scopeLast) boundedHeadings.push(node);
        // Block separators in the visible projection belong to neither sibling.
        node.contentEnd = length;
    }
    write(root);
    for (const h of boundedHeadings) {
        h.scopeEnd = h.scopeLast.position.end.offset;
        delete h.scopeLast;
    }
    return parts.join('');
}

export async function parseHtml(raw, locate) {
    const {parse,defaultTreeAdapter} = await import('parse5').catch(error => {
        if (error.code==='ERR_MODULE_NOT_FOUND' && error.message.includes("package 'parse5'")) {
            throw new Error('HTML input requires the optional parse5 package. Install it with npm install parse5.', {cause:error});
        }
        throw error;
    });
    const locations = locate && await (await import('./html-citations.js')).locatedHtml(raw,defaultTreeAdapter);
    const dom = parse(raw,locations ? {treeAdapter:locations.treeAdapter,sourceCodeLocationInfo:true} : {});
    const {root,visible} = domBlocks(dom,locations);
    root.children = root.children.flatMap(normalize);
    const source = position(root);
    const view = locate ? alignWhitespace(joinViews(visible),source) : undefined;
    return {source,view,units:options=>readStructuredUnits(source,options,root,false),
        tree:options=>({...readStructuredUnits(source,options,root,true),source,view}),
        project:passage=>htmlResult(passage,view)};
}

// Structured renderers can repeat a table header. Project each occurrence back
// to its real HTML text and leave generated separators without a source span.
function htmlResult(passage, view) {
    if (!view) return {text:passage.text};
    const citations = [];
    for (const {start,end,outputStart} of passage.sourceRanges) {
        for (const r of sliceView(view,start,end).citations) {
            appendRange(citations,r.start,r.end,outputStart+r.outputStart,outputStart+r.outputEnd);
        }
    }
    return {text:passage.text,citations};
}
