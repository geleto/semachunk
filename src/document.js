import { covers, joinViews, literal, sliceView, sourceSpans } from './citations.js';
import { DEFAULT_CONFIG } from '../config.js';
import { tokenBudget } from './token-limit.js';

const documentTokenizers = new WeakMap();

export function passageFits(doc, countTokens, upperLimit) {
    if (doc.sizeUnit!==undefined && !['characters','tokens'].includes(doc.sizeUnit)) throw new TypeError('Invalid document sizeUnit.');
    const tokenMode = doc.sizeUnit === 'tokens';
    const ceiling = doc.maxPassageSize ?? (tokenMode ? DEFAULT_CONFIG.DOCUMENT_PASSAGE_TOKENS : DEFAULT_CONFIG.DOCUMENT_PASSAGE_CHARACTERS);
    if (!Number.isSafeInteger(ceiling) || ceiling < 1) throw new RangeError('maxPassageSize must be a positive safe integer.');
    if (upperLimit !== undefined && (!Number.isSafeInteger(upperLimit) || upperLimit < 1)) {
        throw new RangeError('A stored structural limit must be a positive safe integer.');
    }
    const maximum = Math.min(ceiling,upperLimit ?? ceiling);
    if (!tokenMode) return text => text.length <= maximum;
    const count = documentTokenizers.get(doc) ?? countTokens;
    if (typeof count !== 'function') throw new TypeError('Supply countTokens when reading a serialized token-sized document.');
    return tokenBudget(maximum,count,'');
}

function trimmed(view) {
    const start = view.text.length - view.text.trimStart().length;
    return sliceView(view, start, start + view.text.trim().length);
}

// Snapshot parser structure before the semantic traversal marks weak edges.
// Materialize once for the document, independently of the chosen chunk layout.
export function documentNodes(raw, tree, format) {
    const source = tree.view ?? literal(raw);
    const root = {id:0, parentId:null, type:'document', headingPath:[]};
    const nodes = [root], hidden = [];
    const entries = [{node:root, start:0, end:source.text.length}];
    function visit(unit, parent, previous, attachment) {
        if (unit.skip && !unit.depth) { hidden.push([unit.start,unit.end]); return; }
        const nested = tree.children(unit) ?? [];
        let type = unit.kind ?? unit.node?.type ?? (nested.length ? 'line' : 'sentence');
        if (type === 'prose') type = nested.length ? 'line' : 'sentence';
        const headingPath = unit.headingPath ?? (unit.depth ? [...parent.headingPath,unit.text.replace(/^#{1,6}\s+/u,'')] : parent.headingPath);
        const node = {id:nodes.length, parentId:parent.id, type, headingPath:[...headingPath]};
        if (unit.pointer !== undefined) node.jsonPointer = unit.pointer;
        if (format === 'json' && parent.type === 'array' && parent.jsonPointer === '') node.record = true;
        let intro = attachment;
        if ((type === 'list' || type === 'listItem') && previous?.type === 'paragraph' &&
            /[:：]\s*$/u.test(source.text.slice(entries[previous.id].start,entries[previous.id].end))) intro = previous.id;
        if (type === 'listItem' && previous?.type === 'listItem') intro = previous.introducedBy ?? intro;
        if (intro !== undefined) node.introducedBy = intro;
        nodes.push(node);
        entries.push({node,start:unit.start,end:unit.end});
        if (unit.headingEnd !== undefined) {
            const heading = visit({kind:'heading',start:unit.start,end:unit.headingEnd,headingPath},node);
            node.introducedBy = heading.id;
        }
        let prior;
        for (const child of nested) {
            const next = visit(child,node,prior, type === 'list' || type === 'listItem' ? intro : undefined);
            if (next?.type === 'heading') node.introducedBy = next.id;
            prior = next;
        }
        return node;
    }
    let previous;
    for (const unit of tree.roots) previous = visit(unit,root,previous);
    hidden.sort((a,b)=>a[0]-b[0]);
    for (const {node,start,end} of entries) {
        let pos = start;
        const parts = [];
        for (const [a,b] of hidden) {
            if (a >= end) break;
            if (b <= pos) continue;
            if (a > pos) parts.push(sliceView(source,pos,a));
            pos = Math.max(pos,b);
        }
        if (pos < end) parts.push(sliceView(source,pos,end));
        Object.assign(node,trimmed(joinViews(parts)));
    }
    return nodes;
}

export function orderedSectionRanges(ranges, inputLength) {
    if (!Array.isArray(ranges)) throw new TypeError('sectionRanges must be an array of source ranges.');
    const ordered = ranges.map(({start,end,headingPath=[]})=>{
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<=start || end>inputLength) {
            throw new RangeError('A section range must be a nonempty interval in the original input.');
        }
        if (!Array.isArray(headingPath) || headingPath.some(s=>typeof s!=='string')) throw new TypeError('Invalid section heading path.');
        return {start,end,headingPath:[...headingPath]};
    }).sort((a,b)=>a.start-b.start || b.end-a.end);
    const parents = [], sections = [];
    for (const range of ordered) {
        while (parents.length && range.start>=parents.at(-1).end) parents.pop();
        const parent = parents.at(-1);
        if (parent && range.end>parent.end) throw new RangeError('Section ranges must be disjoint or nested.');
        if (parent && range.start===parent.start && range.end===parent.end) continue;
        range.parent = parent;
        sections.push(range);
        parents.push(range);
    }
    return sections;
}

export function finishDocument(sourceId, format, chunks, nodes, sections, sizeUnit, maxPassageSize, countTokens, maxStructuralSize, strategy) {
    const document = {format, strategy, nodes, chunks, sizeUnit, maxPassageSize, maxStructuralSize};
    if (sizeUnit === 'tokens') documentTokenizers.set(document,countTokens);
    for (const section of sections) {
        const view = clip(nodes[0],section.start,section.end);
        if (!view.text) continue;
        section.id = nodes.length;
        nodes.push({...view,id:section.id,parentId:section.parent?.id ?? 0,type:'section',
            headingPath:section.headingPath,retrievalOnly:true});
    }
    if (sourceId !== undefined) {
        document.sourceId = sourceId;
        for (const n of nodes) n.sourceId = sourceId;
    }
    const geometry = nodes.map(sourceSpans);
    for (const chunk of chunks) {
        chunk.nodeIds = [];
        const spans = sourceSpans(chunk);
        let parentId = 0;
        for (const node of nodes) {
            if (!node.id) continue;
            const within = geometry[node.id];
            if (!within.length || !spans.length || within[0][0] > spans.at(-1)[1] || spans[0][0] > within.at(-1)[1]) continue;
            if (covers(spans,within)) chunk.nodeIds.push(node.id);
            if (!node.retrievalOnly && covers(within,spans)) parentId = node.id;
        }
        chunk.parentId = parentId;
    }
    return document;
}

const documentScopes = new WeakMap();
function scopesFor(doc) {
    if (documentScopes.has(doc)) return documentScopes.get(doc);
    const events = [];
    for (const node of doc.nodes) {
        if (node.retrievalOnly) continue;
        if (!(node.type === 'section' || node.type === 'article' || node.record || node.type === 'record')) continue;
        const spans = sourceSpans(node);
        if (!spans.length) continue;
        events.push([spans[0][0],node.id,1],[spans.at(-1)[1],node.id,0]);
    }
    events.sort((a,b)=>a[0]-b[0] || a[2]-b[2] || a[1]-b[1]);
    const active = new Set(), runs = [];
    let start = -Infinity, owner = 0;
    for (const [position,id,opening] of events) {
        if (position > start) runs.push({start,end:position,owner});
        if (opening) active.add(id); else active.delete(id);
        owner = 0;
        for (const id of active) owner = Math.max(owner,id);
        start = position;
    }
    runs.push({start,end:Infinity,owner});
    documentScopes.set(doc,runs);
    return runs;
}

// Intersect a neighbor's *source* citations with the allowed interval. This
// also removes previously displayed overlap from pack and synthetic prefixes.
function clip(view, lo, hi) {
    const pieces = [];
    for (const r of view.citations) {
        const a = Math.max(lo,r.start), b = Math.min(hi,r.end);
        if (a >= b) continue;
        const linear = r.end-r.start === r.outputEnd-r.outputStart;
        const start = linear ? r.outputStart+a-r.start : r.outputStart;
        const end = linear ? r.outputEnd-(r.end-b) : r.outputEnd;
        const last = pieces.at(-1);
        if (last && start >= last[1] && !/\S/u.test(view.text.slice(last[1],start))) last[1] = end;
        else if (!last || start >= last[1]) pieces.push([start,end]);
    }
    return trimmed(joinViews(pieces.map(([a,b])=>sliceView(view,a,b)),'\n\n'));
}

// A neighbor can contribute a suffix on the left or a prefix on the right.
// Use the parser's unit boundaries, preserving source spelling between them.
function contextEdges(doc, chunk, view, left) {
    const cuts = new Set([left ? 0 : view.text.length]);
    const visible = sourceSpans(view);
    for (const id of chunk.nodeIds) {
        const n = doc.nodes[id];
        if (n.retrievalOnly || !n.citations.length || !covers(visible,sourceSpans(n))) continue;
        const edge = left ? n.citations[0].start : n.citations.at(-1).end;
        for (const r of view.citations) {
            if (left ? !(r.start<=edge && edge<r.end) : !(r.start<edge && edge<=r.end)) continue;
            const linear = r.end-r.start === r.outputEnd-r.outputStart;
            cuts.add(linear ? r.outputStart+edge-r.start : left ? r.outputStart : r.outputEnd);
            break;
        }
    }
    return [...cuts].sort((a,b)=>left ? b-a : a-b);
}

function boundedWindow(doc, before, after, core, left, right, fits) {
    const sides = [left,right].map((view,i)=>view?.text ? {
        view, cuts:contextEdges(doc,i ? after : before,view,!i), next:0, text:''
    } : null);
    // Grow from the center. Give the shorter accepted side the next unit.
    for (;;) {
        const [l,r] = sides;
        const hasLeft = l && l.next<l.cuts.length, hasRight = r && r.next<r.cuts.length;
        if (!hasLeft && !hasRight) break;
        const takeLeft = hasLeft && (!hasRight || l.text.length<=r.text.length);
        const side = takeLeft ? l : r, cut = side.cuts[side.next++];
        const text = takeLeft ? side.view.text.slice(cut) : side.view.text.slice(0,cut);
        if (fits([takeLeft ? text : l?.text,core.text,takeLeft ? r?.text : text].filter(Boolean).join('\n\n'))) {
            side.text = text;
            side.cut = cut;
        } else side.next = side.cuts.length;
    }
    const [l,r] = sides;
    return [l?.text ? sliceView(left,l.cut,left.text.length) : undefined,core,
        r?.text ? sliceView(right,0,r.cut) : undefined];
}

function neighbor(doc,index,step,measure) {
    const first = index+step, adjacent = doc.chunks[first], layout = doc.chunks[index].layout;
    if (!adjacent || adjacent.layout !== layout) return;
    if (!measure) return adjacent;
    let last = first, length = measure(adjacent.text);
    while (length < doc.maxPassageSize && doc.chunks[last+step] && doc.chunks[last+step].layout === layout) {
        last += step;
        length += measure(doc.chunks[last].text);
    }
    if (first===last) return adjacent;
    const run = doc.chunks.slice(Math.min(first,last), Math.max(first,last)+1);
    return {...joinViews(run,'\n\n'),nodeIds:[...new Set(run.flatMap(c=>c.nodeIds))]};
}

export function chunkContextParts(doc, chunkIndex, neighbors, fits, measure) {
    if (neighbors !== 0 && neighbors !== 1) throw new RangeError('neighbors must be 0 or 1.');
    const chunk = doc.chunks[chunkIndex];
    if (!chunk) throw new RangeError('Unknown chunk index.');
    if (chunk.sizeLimitExceeded || chunk.tokenLimitExceeded || !fits(chunk.text)) {
        throw new RangeError('The core exceeds its passage budget. Rechunk the original input with a fitting maxChunkSize and prefix.');
    }
    const spans = sourceSpans(chunk);
    let before, after, beforeView, afterView;
    if (neighbors && spans.length) {
        const left = spans[0][0], right = spans.at(-1)[1], runs = scopesFor(doc);
        before = neighbor(doc,chunkIndex,-1,measure);
        after = neighbor(doc,chunkIndex,1,measure);
        if (before) {
            const scope = runs.find(r=>r.start<=left && left<r.end);
            beforeView = clip(before,scope.start,left);
        }
        if (after) {
            const scope = runs.find(r=>r.start<right && right<=r.end);
            afterView = clip(after,right,scope.end);
        }
    }
    const full = [beforeView,chunk,afterView].filter(v=>v?.text);
    return full.length===1 || fits(full.map(v=>v.text).join('\n\n')) ? [beforeView,chunk,afterView] :
        boundedWindow(doc,before,after,chunk,beforeView,afterView,fits);
}

export function getChunkContext(doc, chunkIndex, {neighbors = 1, countTokens} = {}) {
    const wide = doc.strategy === 'semantic' && doc.chunks[chunkIndex]?.layout === 'semantic';
    const measure = doc.sizeUnit === 'tokens' ? documentTokenizers.get(doc) ?? countTokens : s=>s.length;
    const parts = chunkContextParts(doc,chunkIndex,neighbors,passageFits(doc,countTokens),wide ? measure : undefined);
    const result = joinViews(parts.filter(v=>v?.text),'\n\n');
    const chunk = doc.chunks[chunkIndex];
    if (doc.sourceId !== undefined) result.sourceId = doc.sourceId;
    const introductions = new Set();
    for (let id = chunk.parentId; id != null; id = doc.nodes[id].parentId) {
        if (doc.nodes[id].introducedBy !== undefined) introductions.add(doc.nodes[id].introducedBy);
    }
    for (const id of chunk.nodeIds) {
        if (doc.nodes[id].introducedBy !== undefined) introductions.add(doc.nodes[id].introducedBy);
    }
    const fitsIntro = passageFits(doc,countTokens,doc.maxStructuralSize);
    result.introductions = [...introductions].sort((a,b)=>a-b).map(id=>doc.nodes[id]).filter(node=>fitsIntro(node.text));
    return result;
}
