import { covers, sourceSpans } from './citations.js';
import { chunkContextParts, getChunkContext, passageFits } from './document.js';
import { createBatchEmbedder } from './embeddings.js';
import { vectorDirection } from './similarity.js';
import { adjacentSentences, chunkSentences, sentenceGroups } from './sentence-groups.js';

const branchTypes = new Set(['section','article','list','listItem','blockquote','object','array','footnoteDefinition']);
const providers = new WeakMap();
const compiledDocuments = new WeakMap();

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

function documentList(input) {
    const documents = Array.isArray(input) ? input.slice() : [input];
    for (const doc of documents) {
        if (!Array.isArray(doc?.nodes) || !Array.isArray(doc.chunks) || !doc.nodes.length) {
            throw new TypeError('Expected a chunked document with nodes and chunks, or an array of documents.');
        }
    }
    return documents;
}

function documentProvider(doc) {
    return providers.get(doc)?.embedBatch ?? compiledDocuments.get(doc)?.provider;
}

function storedProvider(documents) {
    for (const doc of documents) {
        const provider = documentProvider(doc);
        if (provider) return provider;
    }
}

function queryVector(query, embed) {
    if (typeof query !== 'string') return query;
    if (!embed) throw new TypeError('Supply embedBatch to search with a text query, or pass a query embedding.');
    return embed([query]).then(vectors=>vectors[0]);
}

function documentEmbeddings(documents,embed,provider) {
    const available = new Map();
    let storedDimension;
    function reuse(text,vector) {
        storedDimension ??= vector?.length;
        if (!storedDimension || vector?.length !== storedDimension) {
            throw new RangeError('Stored embeddings must have the same nonzero dimension.');
        }
        available.set(text,vector);
    }
    for (const doc of documents) {
        if (doc.index !== undefined) {
            if (!Array.isArray(doc.index?.embeddings)) throw new TypeError('Invalid document index embeddings.');
            for (const [text,vector] of doc.index.embeddings) reuse(text,vector);
        } else if (!embed || providers.get(doc)?.embedBatch === provider) {
            for (const c of doc.chunks) {
                if (Array.isArray(c.embedding) || ArrayBuffer.isView(c.embedding)) {
                    reuse(c.embeddingText ?? c.text,c.embedding);
                }
            }
        }
    }
    return async function vectorsFor(inputs) {
        const missing = inputs.filter(text=>!available.has(text));
        if (missing.length) {
            if (!embed) throw new TypeError('Missing document embeddings. Supply embedBatch here or use chunk with index: true and embedBatch.');
            const fresh = await embed(missing);
            missing.forEach((text,i)=>available.set(text,fresh[i]));
        }
        return inputs.map(text=>available.get(text));
    };
}

// Keep every cited occurrence, even when multiple passages share one embedding input.
async function compileIndex(documents, embed, provider, {
    detailTypes = ['paragraph'], includeSections, includeDocuments = false,
    countTokens, sentenceGrouping
} = {}, saveEmbeddings) {
    const vectorsFor = documentEmbeddings(documents,embed,provider);
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
    let layouts = 0;
    function intern(text) {
        if (!texts.has(text)) texts.set(text,texts.size);
        return texts.get(text);
    }
    for (const [documentIndex,doc] of documents.entries()) {
        const combined = doc.strategy === 'semantic';
        layouts += combined ? 2 : 1;
        const identity = doc.sourceId ?? doc;
        if (!identities.has(identity)) identities.set(identity,identities.size);
        const source = identities.get(identity);
        const spans = doc.nodes.map(sourceSpans);
        const paragraphCounts = new Uint32Array(doc.nodes.length);
        for (const n of doc.nodes) {
            if (n.type !== 'paragraph') continue;
            for (let p=n.parentId; p !== null; p=doc.nodes[p].parentId) paragraphCounts[p]++;
        }
        const paragraphs = doc.nodes.filter(n=>n.type==='paragraph');
        const sections = doc.nodes.filter(n=>{
            if (!(includeSections ?? combined) || !['section','article'].includes(n.type) || !n.text) return false;
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
            const vectors = await vectorsFor(inputs);
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
            let sides;
            if (combined && chunk.layout==='semantic') {
                const parts = chunkContextParts(doc,chunkIndex,1,fits);
                const neighbors = [];
                for (const side of [0,2]) {
                    const other = doc.chunks[chunkIndex+side-1];
                    if (parts[side]?.text && !other.sizeLimitExceeded && !other.tokenLimitExceeded) {
                        neighbors.push(intern(other.embeddingText ?? other.text));
                    }
                }
                if (neighbors.some(neighbor=>neighbor!==key)) sides = {left:neighbors[0],right:neighbors.at(-1)};
            }
            entries.push({doc,documentIndex,chunkIndex,chunk,key,sides,children,docKey,
                sectionKey:ancestor && sectionKeys.get(ancestor.id),contexts:[]});
        }
    }
    const keys = [...texts.keys()];
    const vectors = await vectorsFor(keys);
    sentenceDirections.clear();
    const dimension = vectors[0]?.length;
    const directions = vectors.map(v=>unit(v,dimension));
    if (saveEmbeddings) {
        const embeddings = [];
        for (const [i,key] of keys.entries()) embeddings.push([key,Array.from(vectors[i])]);
        saveEmbeddings(embeddings);
    }
    // Norm of 70% center plus 30% mean neighbor. Queries reuse these three cosine scores.
    for (const e of entries) {
        if (!e.sides) continue;
        const center = directions[e.key], left = directions[e.sides.left], right = directions[e.sides.right];
        let squared = 0;
        for (let i=0;i<dimension;i++) squared += (.7*center[i]+.15*(left[i]+right[i]))**2;
        e.sides.norm = Math.sqrt(squared) || 1;
    }
    function similarity(q,v) {
        let dot = 0;
        for (let i=0; i<dimension; i++) dot += q[i]*v[i];
        return dot;
    }
    return {
        dimension,
        stats:{documents:identities.size,layouts,chunks:entries.length,uniqueEmbeddings:texts.size},
        rank(q,{sectionWeight,documentWeight,useContainedSections},offset) {
            const sims = directions.map(v=>similarity(q,v));
            return entries.map(e=>{
                let best;
                for (const d of e.children) {
                    if ((!d.upper || useContainedSections) && (!best || sims[d.key]>sims[best.key])) best=d;
                }
                const sides = e.sides;
                const center = sides ? (.7*sims[e.key]+.15*(sims[sides.left]+sims[sides.right]))/sides.norm : sims[e.key];
                const base = best ? .5*(center+sims[best.key]) : center;
                const weight = sectionWeight ?? (e.doc.strategy==='semantic' && includeSections!==false ? Math.min(.15,1-documentWeight) : 0);
                const score = (1-weight-documentWeight)*base + weight*(sims[e.sectionKey] ?? base) + documentWeight*(sims[e.docKey] ?? base);
                return {e,score,best,documentIndex:e.documentIndex+offset};
            });
        },
        async searchNodes(query,queryEmbed,{types=['section','article','document'],limit=5,includeOversized=false}={}) {
            limitCheck(limit);
            if (typeof includeOversized !== 'boolean') throw new TypeError('includeOversized must be a boolean.');
            if (!limit) return [];
            const selected = new Set(types), eligible = nodeEntries.filter(e=>selected.has(e.node.type) && (includeOversized || !e.oversized));
            if (!eligible.length) return [];
            const q = unit(await queryVector(query,queryEmbed),dimension), scores = new Map();
            return eligible.map(({node,key,documentIndex,sourceId})=>{
                if (!scores.has(key)) scores.set(key,similarity(q,directions[key]));
                return {node,documentIndex,sourceId,score:scores.get(key)};
            }).sort((a,b)=>b.score-a.score).slice(0,limit);
        }
    };
}

function passageOptions({limit=5,neighbors=1,distinct=true,sectionWeight,documentWeight=0,useContainedSections=false}={}) {
    limitCheck(limit);
    if (neighbors !== 0 && neighbors !== 1) throw new RangeError('neighbors must be 0 or 1.');
    const requested = sectionWeight === undefined ? 0 : sectionWeight;
    if (![requested,documentWeight].every(w=>Number.isFinite(w) && w>=0) || requested+documentWeight>1) {
        throw new RangeError('Routing weights must be nonnegative and sum to at most one.');
    }
    return {limit,neighbors,distinct,sectionWeight,documentWeight,useContainedSections};
}

async function searchIndexes(indexes,query,embed,options,countTokens) {
    const {limit,neighbors,distinct} = options;
    const first = indexes.find(index=>index.stats.chunks);
    if (!limit || !first) return [];
    if (indexes.some(index=>index.stats.chunks && index.dimension!==first.dimension)) {
        throw new RangeError('All documents must use embeddings of the same dimension.');
    }
    const q = unit(await queryVector(query,embed),first.dimension);
    const ranking = indexes.flatMap((index,offset)=>index.rank(q,options,offset)).sort((a,b)=>b.score-a.score);
    const hits = [], kept = new Map();
    for (const {e,score,best,documentIndex} of ranking) {
        if (!e.contexts[neighbors]) {
            const view = getChunkContext(e.doc,e.chunkIndex,{neighbors,countTokens});
            const spans = sourceSpans(view);
            e.contexts[neighbors] = {view,spans,length:size(spans)};
        }
        const shown = e.contexts[neighbors];
        if (distinct) {
            const source = e.doc.sourceId ?? e.doc;
            const prior = kept.get(source) ?? [];
            if (prior.some(v=>nearDuplicate(v,shown))) continue;
            prior.push(shown);
            kept.set(source,prior);
        }
        hits.push({sourceId:e.doc.sourceId,documentIndex,chunkIndex:e.chunkIndex,score,
            match:best?.node ?? e.chunk,chunk:e.chunk,context:shown.view});
        if (hits.length === limit) break;
    }
    return hits;
}

/** Keep provider functions in memory and portable retrieval vectors on indexed documents. */
export async function prepareDocument(doc,{index,embed,embedBatch,maxEmbeddingBatchSize}) {
    if (embedBatch) providers.set(doc,{embedBatch,maxEmbeddingBatchSize});
    if (index) {
        const includeSections = doc.strategy === 'semantic';
        const compiled = await compileIndex([doc],embed,embedBatch,{includeSections},
            embeddings=>{doc.index = {embeddings};});
        compiledDocuments.set(doc,{provider:embedBatch,includeSections,includeDocuments:false,compiled});
        if (doc.chunks.some(c=>ArrayBuffer.isView(c.embedding))) {
            // JSON otherwise turns typed core vectors into objects with numeric property names.
            Object.defineProperty(doc,'toJSON',{value() {
                return {...this,chunks:this.chunks.map(c=>ArrayBuffer.isView(c.embedding) ?
                    {...c,embedding:Array.from(c.embedding)} : c)};
            }});
        }
    }
    return doc;
}

function indexForSearch(doc,provider,options,countTokens) {
    const includeSections = doc.strategy === 'semantic' || Boolean(options.sectionWeight || options.useContainedSections);
    const includeDocuments = options.documentWeight > 0;
    const tokenizer = doc.sizeUnit==='tokens' ? countTokens : undefined;
    // A prepared document already fixes its embedding space. For a plain document,
    // an explicitly different provider can request a different space.
    const prepared = doc.index && !includeDocuments && includeSections===(doc.strategy==='semantic');
    const cached = compiledDocuments.get(doc);
    if (cached && (prepared || cached.provider===provider) && cached.tokenizer===tokenizer &&
        cached.includeSections===includeSections && cached.includeDocuments===includeDocuments) return cached.compiled;
    const embed = createBatchEmbedder(provider,providers.get(doc)?.maxEmbeddingBatchSize,0);
    const compiled = compileIndex([doc],embed,provider,{includeSections,includeDocuments,countTokens});
    const entry = {provider,tokenizer,includeSections,includeDocuments,compiled};
    compiledDocuments.set(doc,entry);
    return compiled.catch(error=>{
        if (compiledDocuments.get(doc)===entry) compiledDocuments.delete(doc);
        throw error;
    });
}

/** Search one chunked document or a collection with one query and one global result limit. */
export async function search(input,query,{embedBatch,countTokens,...options}={}) {
    const documents = documentList(input);
    const settings = passageOptions(options);
    if (!settings.limit || !documents.length) return [];
    const provider = embedBatch ?? storedProvider(documents);
    const queryEmbed = createBatchEmbedder(provider,Infinity,0);
    const indexes = [];
    for (const doc of documents) {
        indexes.push(await indexForSearch(doc,embedBatch ?? documentProvider(doc) ?? provider,settings,countTokens));
    }
    return searchIndexes(indexes,query,queryEmbed,settings,countTokens);
}

/** Build a shared index for custom retrieval keys, direct node searches and statistics. */
export async function createDocumentIndex(input,embedBatch,options={}) {
    const documents = documentList(input);
    const provider = embedBatch ?? storedProvider(documents);
    const embed = createBatchEmbedder(provider,options.maxEmbeddingBatchSize,0);
    const index = await compileIndex(documents,embed,provider,options);
    const sections = options.includeSections ?? documents.some(doc=>doc.strategy==='semantic');
    return {
        stats:index.stats,
        async search(query,overrides) {
            const settings = passageOptions(overrides);
            if ((settings.sectionWeight || settings.useContainedSections) && !sections ||
                settings.documentWeight && !options.includeDocuments) {
                throw new TypeError('Enable the requested section or document keys when creating the index.');
            }
            return searchIndexes([index],query,embed,settings,options.countTokens);
        },
        searchNodes:(query,overrides)=>index.searchNodes(query,embed,overrides)
    };
}
