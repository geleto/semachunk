import { fromMarkdown } from 'mdast-util-from-markdown';
import { chunkText } from '../src/index.js';
import { createBatchEmbedder } from '../src/embeddings.js';
import { markdownResult, parseMarkdown } from '../src/markdown.js';
import { fitsMarkdownJoin } from '../src/markdown-merge.js';
import { splitSpans, tokenBudget } from '../src/token-limit.js';
import { alignPlain, tokenWindows } from './delivered-context.mjs';
import { combineMarkdown } from './markdown-merging.mjs';
import { referenceChunks } from './retrieval-baselines.mjs';
import { modelInputTokens } from './encoder.mjs';

export function parsedMarkdown(doc, size, tokens, fits) {
    const key = [size, tokens].join('/');
    if (!doc.parsed.has(key)) doc.parsed.set(key, parseMarkdown(doc.source, { maxChunkSize: size, fits }));
    return doc.parsed.get(key);
}

export function boundaryFractions(source, units, maxChunkSize, fits) {
    let eligible = 0, competing = 0, previous = false;
    for (let i = 1; i < units.length; i++) {
        const left = units[i - 1], right = units[i];
        const joins = left.kind === 'prose' && right.kind === 'prose' && fitsMarkdownJoin(source, left, right, maxChunkSize, fits);
        if (joins) { eligible++; if (previous) competing++; }
        previous = joins;
    }
    return { eligible: eligible / Math.max(1, units.length - 1), competing: competing / Math.max(1, units.length - 2) };
}

export function documentRule(doc, policy, countTokens) {
    if (!policy.feature) return policy;
    const { feature, at, ...scoring } = policy;
    const size = policy.chars ?? Infinity, tokens = policy.tokens ?? Infinity;
    const key = [size, tokens].join('/');
    doc.fractions ??= new Map();
    if (!doc.fractions.has(key)) {
        const fits = tokenBudget(tokens, countTokens, doc.chunkPrefix?.trim() ? doc.chunkPrefix + ': ' : '');
        const units = parsedMarkdown(doc, size, tokens, fits);
        doc.fractions.set(key, boundaryFractions(doc.source, units, size, fits));
    }
    return doc.fractions.get(key)[feature] >= at ? scoring : { method: 'pack', chars: policy.chars, tokens: policy.tokens };
}

// Only the indexing input changes across context arms. Drop the outermost
// heading first, then the title. An existing caller prefix is always required.
function contextualize(body, headingPath, doc, policy, counts, countTokens, required) {
    const path = policy.context === 'headings' ? [...(headingPath ?? [])] : [];
    let title = doc.title;
    if (title && path[0] === title) path.shift();
    if (title || path.length) {
        const leading = /^ {0,3}#|^[^\r\n]+\r?\n[=-]+\s*(?:\r?\n|$)/.test(body) ? fromMarkdown(body).children : [];
        const visible = n => n.children ? n.children.map(visible).join('') : n.alt ?? (n.type === 'html' ? '' : n.value ?? '');
        for (const head of leading) {
            if (head.type !== 'heading') break;
            const name = visible(head).trim();
            if (title === name) title = '';
            const i = path.indexOf(name);
            if (i >= 0) path.splice(i, 1);
        }
    }
    const available = Boolean(title || path.length);
    let shortened = false;
    while (title || path.length) {
        const index = required + [title, ...path].filter(Boolean).join(' > ') + ': ' + body;
        if (countTokens(index) <= policy.contextCap) {
            counts[shortened ? 'shortened' : 'retained']++;
            return index;
        }
        if (path.length) path.shift();
        else title = '';
        shortened = true;
    }
    counts[available ? 'omitted' : 'alreadyPresentOrUnavailable']++;
    return required + body;
}

export async function indexDocument(doc, policy, costs, initial, context, encoder) {
    const { countTokens } = encoder;
    const required = doc.chunkPrefix?.trim() ? doc.chunkPrefix + ': ' : '';
    const maxChunkSize = policy.chars ?? Infinity, maxChunkTokens = policy.tokens ?? Infinity;
    const fits = tokenBudget(maxChunkTokens, countTokens, required);
    const nativeSplitter = policy.method === 'recursive' || policy.method === 'recursive-markdown';
    const publicAPI = ['public-markdown', 'plain-priority', 'plain-pack'].includes(policy.method);
    const semanticReference = policy.method === 'semantic-reference';
    const semanticLimit = semanticReference && !policy.cap ? Infinity : maxChunkTokens;
    const inputLimit = policy.contextCap ?? (nativeSplitter ? modelInputTokens : semanticLimit);
    function record(texts) {
        costs.calls++;
        costs.texts += texts.length;
        costs.singletons += Number(texts.length === 1);
        for (const text of texts) {
            costs.embeddedTokens += countTokens(text);
            if (countTokens(text) > inputLimit) throw new Error('Index input exceeds cap');
        }
        return encoder.embed(texts);
    }
    const embed = createBatchEmbedder(record, 256);
    let chunks;
    if (publicAPI) {
        const markdown = policy.method === 'public-markdown';
        const output = await chunkText(doc.source, record, { inputFormat: markdown ? 'markdown' : 'text',
            maxChunkSize: policy.chars === null || (policy.chars === undefined && policy.tokens === undefined) ? undefined : maxChunkSize,
            combineChunks: policy.combineChunks,
            chunkingStrategy: policy.method === 'plain-pack' ? 'pack' : policy.chunkingStrategy, chunkOverlap: policy.chunkOverlap,
            maxChunkTokens, countTokens, maxEmbeddingBatchSize: 256, chunkPrefix: doc.chunkPrefix, excludeChunkPrefixInResults: true });
        chunks = markdown ? output.map(({ embedding, ...chunk }) => chunk) : alignPlain(doc.source, output.map(c => c.text));
    } else if (nativeSplitter) {
        chunks = await referenceChunks(doc.source, policy, countTokens);
        if (policy.cap && fits) chunks = chunks.flatMap(chunk => {
            if (fits(chunk.text)) return [chunk];
            const [{ start, end }] = chunk.sourceRanges;
            const spans = splitSpans(doc.source, start, end, (a, b) => fits(doc.source.slice(a, b)));
            return spans.map(([a, b]) => ({ text: doc.source.slice(a, b), sourceRanges: [{ start: a, end: b, outputStart: 0 }] }));
        });
    } else if (semanticReference) {
        const { windows, windowTokens, layouts } = doc.breakpoints;
        costs.calls += Number(windows > 0);
        costs.singletons += Number(windows === 1);
        costs.texts += windows;
        costs.embeddedTokens += windowTokens;
        let texts = layouts[policy.chunkCount ? 1 : 0];
        if (policy.cap) texts = texts.flatMap(text => {
            const spans = splitSpans(text, 0, text.length, (a, b) => fits(text.slice(a, b)));
            return spans.map(([a, b]) => text.slice(a, b));
        });
        chunks = alignPlain(doc.source, texts.filter(s => s.trim()));
    } else if (policy.method === 'window') {
        chunks = tokenWindows(doc, doc.offsets, policy.tokens, policy.tokens / 4);
    } else {
        const input = parsedMarkdown(doc, maxChunkSize, maxChunkTokens, fits);
        const joinFits = policy.packTarget ? text => (!fits || fits(text)) && countTokens(text) <= policy.packTarget : fits;
        const units = await combineMarkdown(doc.source, input, embed, { ...policy, maxChunkSize, fits: joinFits }, initial);
        chunks = units.map(unit => markdownResult(doc.source, unit));
    }
    // Align every plain-text occurrence before removing rows that cannot be indexed.
    // Uncapped external controls keep their native size overruns for measurement.
    if (fits && (policy.cap || (!nativeSplitter && !semanticReference))) chunks = chunks.filter(c => fits(c.text));
    if (required || policy.context) {
        for (const chunk of chunks) chunk.embeddingText = policy.context
            ? contextualize(chunk.text, chunk.headingPath, doc, policy, context, countTokens, required)
            : required + chunk.text;
    }
    const inputs = chunks.map(c => c.embeddingText ?? c.text);
    costs.indexTexts += chunks.length;
    costs.indexTokens += inputs.reduce((n, s) => n + countTokens(s), 0);
    if (!publicAPI) await embed(inputs);
    return chunks;
}
