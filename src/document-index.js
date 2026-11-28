import { covers, sourceSpans } from './citations.js';
import { getChunkContext, passageFits } from './document.js';
import { createBatchEmbedder } from './embeddings.js';
import { vectorDirection } from './similarity.js';
import { adjacentSentences, chunkSentences, sentenceGroups } from './sentence-groups.js';

const branchTypes = new Set(['section','article','list','listItem','blockquote','object','array','footnoteDefinition']);

function unit(vector, dimension) {
    if (!(Array.isArray(vector) || ArrayBuffer.isView(vector)) || !vector.length || vector.length !== dimension) {
        throw new RangeError('Query and index embeddings must have the same nonzero dimension.');
    }
    const {scale,length} = vectorDirection(vector);
    return Float64Array.from(vector, x => {
        if (!Number.isFinite(x)) throw new TypeError('An embedding must contain finite numbers.');
        return (x/scale)/length;
    });
}

function size(spans) { return spans.reduce((n,[a,b])=>n+b-a,0); }

function nearDuplicate(a,b) {
    let i = 0, j = 0, same = 0;
    const target = .75*Math.min(a.length,b.length);
    while (i < a.spans.length && j < b.spans.length) {
        const [x,y] = a.spans[i], [s,t] = b.spans[j];
        same += Math.max(0,Math.min(y,t)-Math.max(x,s));
        if (same >= target) return true;
        if (y <= t) i++; else j++;
    }
    return false;
}

function limitCheck(limit) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('limit must be a nonnegative safe integer.');
}

// An exact in-memory reference retriever. Logical occurrences always retain
// their source and layout, even when they share one physical embedding.
export async function createDocumentIndex(documents, embedBatch, {
    detailTypes = ['paragraph'], includeSections = false, includeDocuments = false, maxEmbeddingBatchSize = Infinity,
    countTokens, sentenceGrouping
} = {}) {
    const embed = createBatchEmbedder(embedBatch,maxEmbeddingBatchSize,0);
    if (!embed) throw new TypeError('A document index requires an embedding callback.');
    const texts = new Map(), details = new Set(detailTypes), entries = [], nodeEntries = [];
    let grouping;
    if (sentenceGrouping !== undefined) {
        if (!sentenceGrouping || typeof sentenceGrouping !== 'object' || Array.isArray(sentenceGrouping)) {
            throw new TypeError('sentenceGrouping must specify sentence group options.');
        }
        const {maxSentences = 3,minSimilarity} = sentenceGrouping;
        if (!Number.isSafeInteger(maxSentences) || maxSentences < 1) throw new RangeError('maxSentences must be a positive integer.');
        if (minSimilarity !== undefined && (!Number.isFinite(minSimilarity) || Math.abs(minSimilarity)>1)) {
            throw new RangeError('minSimilarity must be between -1 and 1.');
        }
        grouping = {maxSentences,threshold:minSimilarity};
        details.delete('sentence');
    }
    const sentenceDirections = new Map();
    const occurrences = new Map(), identities = new Map();
    let nextIdentity = 0;
    function intern(text) {
        if (!texts.has(text)) texts.set(text,texts.size);
        return texts.get(text);
    }
    for (const [documentIndex,doc] of documents.entries()) {
        if (!doc.nodes || !doc.chunks) throw new TypeError('Index documents created with includeHierarchy: true.');
        const identity = doc.sourceId ?? doc;
        if (!identities.has(identity)) identities.set(identity,nextIdentity++);
        const source = identities.get(identity);
        const spans = doc.nodes.map(sourceSpans);
        const paragraphCounts = new Uint32Array(doc.nodes.length);
        for (const n of doc.nodes) {
            if (n.type !== 'paragraph') continue;
            for (let p=n.parentId; p !== null; p=doc.nodes[p].parentId) paragraphCounts[p]++;
        }
        const paragraphs = doc.nodes.filter(n=>n.type==='paragraph');
        const sections = doc.nodes.filter(n=>{
            if (!includeSections || !['section','article'].includes(n.type) || !n.text) return false;
            if (!n.retrievalOnly) return paragraphCounts[n.id] >= 2;
            let inside = 0;
            for (const p of paragraphs) if (covers(spans[n.id],spans[p.id]) && ++inside === 2) return true;
            return false;
        }).sort((a,b)=>size(spans[a.id])-size(spans[b.id]));
        const sectionKeys = new Map(sections.map(n=>[n.id,intern(n.text)]));
        const docKey = includeDocuments && doc.nodes[0].text ? intern(doc.nodes[0].text) : undefined;
        const fits = passageFits(doc,countTokens);
        const fitsStructure = passageFits(doc,countTokens,doc.maxStructuralSize);
        function nodeEntry(node,key,oversized=false) {
            const signature = JSON.stringify([source,node.type,spans[node.id] ?? sourceSpans(node)]);
            const existing = occurrences.get(signature);
            if (existing) {
                // Direct lookups honor the smallest limit among layouts of the same source.
                if (oversized) existing.oversized = true;
                return;
            }
            const entry = {node,key,documentIndex,sourceId:doc.sourceId,oversized};
            occurrences.set(signature,entry);
            nodeEntries.push(entry);
        }
        for (const n of sections) nodeEntry(n,sectionKeys.get(n.id),!fitsStructure(n.text));
        if (docKey !== undefined) nodeEntry(doc.nodes[0],docKey,!fitsStructure(doc.nodes[0].text));
        for (const chunk of doc.chunks) {
            if (!chunk.sizeLimitExceeded && !chunk.tokenLimitExceeded && chunk.text && !fits(chunk.text)) {
                throw new RangeError('A core exceeds the passage budget. Rechunk the source before indexing it.');
            }
        }
        const sentences = grouping && doc.chunks.map(c=>c.sizeLimitExceeded || c.tokenLimitExceeded ? [] : chunkSentences(doc,c));
        if (grouping?.threshold !== undefined && grouping.maxSentences>1) {
            const missing = new Set();
            for (const [i,list] of sentences.entries()) {
                for (let j=1;j<list.length;j++) {
                    if (!adjacentSentences(doc.chunks[i],list[j-1],list[j])) continue;
                    for (const {node} of [list[j-1],list[j]]) if (!sentenceDirections.has(node.text)) missing.add(node.text);
                }
            }
            const inputs = [...missing];
            const vectors = inputs.length ? await embed(inputs) : [];
            inputs.forEach((s,i)=>sentenceDirections.set(s,vectorDirection(vectors[i])));
        }
        for (const [chunkIndex,chunk] of doc.chunks.entries()) {
            if (chunk.sizeLimitExceeded || chunk.tokenLimitExceeded || !chunk.text) continue;
            const key = intern(chunk.embeddingText ?? chunk.text), chunkSpans = sourceSpans(chunk);
            const children = [];
            for (const id of chunk.nodeIds) {
                const node = doc.nodes[id];
                if ((!details.has(node.type) && !sectionKeys.has(id)) || !node.text ||
                    covers(spans[id],chunkSpans) || !fits(node.text)) continue;
                if (branchTypes.has(node.type) && !fitsStructure(node.text)) continue;
                const heading = node.type === 'paragraph' ? node.headingPath?.at(-1)?.trim() : undefined;
                const childKey = intern(heading ? heading + '\n\n' + node.text : node.text);
                children.push({node,key:childKey,upper:sectionKeys.has(id) && !details.has(node.type)});
                nodeEntry(node,childKey);
            }
            if (grouping) {
                const groups = sentenceGroups(chunk,sentences[chunkIndex],grouping,s=>sentenceDirections.get(s));
                for (const node of groups) {
                    if (covers(sourceSpans(node),chunkSpans) || !fits(node.text)) continue;
                    const childKey = intern(node.text);
                    children.push({node,key:childKey,upper:false});
                    nodeEntry(node,childKey);
                }
            }
            // A section coextensive with the document is scored via the document option.
            const ancestor = sections.find(n=>covers(spans[n.id],chunkSpans) && !covers(chunkSpans,spans[n.id]) &&
                !covers(spans[n.id],spans[0]));
            entries.push({doc,documentIndex,source,chunkIndex,chunk,key,children,docKey,
                sectionKey:ancestor && sectionKeys.get(ancestor.id),contexts:[]});
        }
    }
    const keys = [...texts.keys()];
    const missing = keys.filter(s=>!sentenceDirections.has(s));
    const fresh = missing.length ? await embed(missing) : [];
    let position = 0;
    const vectors = keys.map(s=>sentenceDirections.get(s)?.vector ?? fresh[position++]);
    sentenceDirections.clear();
    const dimension = vectors[0]?.length;
    const directions = vectors.map(v=>unit(v,dimension));
    async function queryDirection(query) {
        const vector = typeof query === 'string' ? (await embed([query]))[0] : query;
        return unit(vector,dimension);
    }
    function similarity(q,v) {
        let dot = 0;
        for (let i=0; i<dimension; i++) dot += q[i]*v[i];
        return dot;
    }
    function reading(e,neighbors) {
        if (!e.contexts[neighbors]) {
            const view = getChunkContext(e.doc,e.chunkIndex,{neighbors,countTokens});
            const spans = sourceSpans(view);
            e.contexts[neighbors] = {view,spans,length:size(spans)};
        }
        return e.contexts[neighbors];
    }
    return {
        stats:{documents:identities.size,layouts:documents.length,chunks:entries.length,uniqueEmbeddings:texts.size},
        async search(query,{limit=5,neighbors=1,distinct=true,sectionWeight=0,documentWeight=0,useContainedSections=false}={}) {
            limitCheck(limit);
            if (neighbors !== 0 && neighbors !== 1) throw new RangeError('neighbors must be 0 or 1.');
            if (![sectionWeight,documentWeight].every(w=>Number.isFinite(w) && w>=0) || sectionWeight+documentWeight>1) {
                throw new RangeError('Routing weights must be nonnegative and sum to at most one.');
            }
            if ((sectionWeight || useContainedSections) && !includeSections || documentWeight && !includeDocuments) {
                throw new TypeError('Enable the requested section or document keys when creating the index.');
            }
            if (!limit || !entries.length) return [];
            const q = await queryDirection(query);
            const sims = directions.map(v=>similarity(q,v));
            const ranking = entries.map(e=>{
                let best;
                for (const d of e.children) {
                    if ((!d.upper || useContainedSections) && (!best || sims[d.key]>sims[best.key])) best=d;
                }
                const base = .5*(sims[e.key]+sims[best?.key ?? e.key]);
                const score = (1-sectionWeight-documentWeight)*base + sectionWeight*(sims[e.sectionKey] ?? base) +
                    documentWeight*(sims[e.docKey] ?? base);
                return {e,score,best};
            }).sort((a,b)=>b.score-a.score);
            const hits = [], kept = new Map();
            for (const {e,score,best} of ranking) {
                const shown = reading(e,neighbors);
                const prior = kept.get(e.source) ?? [];
                if (distinct && prior.some(v=>nearDuplicate(v,shown))) continue;
                prior.push(shown);
                kept.set(e.source,prior);
                hits.push({sourceId:e.doc.sourceId,documentIndex:e.documentIndex,chunkIndex:e.chunkIndex,score,
                    match:best?.node ?? e.chunk,chunk:e.chunk,context:shown.view});
                if (hits.length === limit) break;
            }
            return hits;
        },
        async searchNodes(query,{types=['section','article','document'],limit=5,includeOversized=false}={}) {
            limitCheck(limit);
            if (typeof includeOversized !== 'boolean') throw new TypeError('includeOversized must be a boolean.');
            if (!limit) return [];
            const selected = new Set(types), eligible = nodeEntries.filter(e=>selected.has(e.node.type) && (includeOversized || !e.oversized));
            if (!eligible.length) return [];
            const q = await queryDirection(query), scores = new Map();
            return eligible.map(({node,key,documentIndex,sourceId})=>{
                if (!scores.has(key)) scores.set(key,similarity(q,directions[key]));
                return {node,documentIndex,sourceId,score:scores.get(key)};
            }).sort((a,b)=>b.score-a.score).slice(0,limit);
        }
    };
}
