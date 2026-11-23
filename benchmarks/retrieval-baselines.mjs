import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { macro, paired } from './markdown-decisions.mjs';

const reference = createRequire(new URL('./.cache/reference/package.json', import.meta.url));

// A repeated substring can have several local matches. Subsequent chunks
// disambiguate them. Require a single ordered placement covering the document.
export function locateChunks(source, texts, overlap) {
    let positions = [{ start: -1, end: 0, paths: 1 }];
    const spaces = /\s*/uy;
    for (const text of texts) {
        assert.ok(text && text.isWellFormed());
        const next = new Map();
        for (const prev of positions) {
            spaces.lastIndex = prev.end;
            spaces.exec(source);
            const latest = spaces.lastIndex, first = overlap ? Math.max(prev.start + 1, prev.end - text.length) : prev.end;
            const region = source.slice(first, latest + text.length);
            for (let i = region.indexOf(text); i >= 0; i = region.indexOf(text, i + 1)) {
                const start = first + i;
                if (next.has(start)) next.get(start).paths = 2;
                else next.set(start, { start, end: start + text.length, prev, paths: prev.paths });
            }
        }
        assert.ok(next.size, 'Unmapped splitter output after ' + positions[0].end);
        positions = [...next.values()];
    }
    const full = positions.filter(p => !/\S/u.test(source.slice(p.end)));
    assert.ok(full.length, 'Incomplete source coverage');
    assert.ok(full.length === 1 && full[0].paths === 1, 'Ambiguous source occurrence');
    const chunks = new Array(texts.length);
    let p = full[0];
    for (let i = texts.length - 1; i >= 0; i--) {
        const { start, end } = p;
        chunks[i] = { text: texts[i], sourceRanges: [{ start, end, outputStart: 0 }] };
        p = p.prev;
    }
    return chunks;
}

export async function referenceChunks(source, policy, countTokens) {
    const { MarkdownTextSplitter, RecursiveCharacterTextSplitter } = reference('@langchain/textsplitters');
    const Splitter = policy.method === 'recursive-markdown' ? MarkdownTextSplitter : RecursiveCharacterTextSplitter;
    const length = policy.tokens ? countTokens : text => text.length;
    const splitter = new Splitter({ chunkSize: policy.tokens ?? policy.chars, chunkOverlap: policy.overlap, lengthFunction: length });
    return locateChunks(source, await splitter.splitText(source), policy.overlap);
}

// Dense search ranks every passage. Lexical ranks contribute only on a term match.
export function reciprocalRankFusion(dense, lexicalMatches) {
    const scores = new Float64Array(dense.length);
    for (const order of [dense, lexicalMatches]) {
        order.forEach((id, i) => { scores[id] += 1 / (60 + i + 1); });
    }
    return dense.toSorted((a, b) => scores[b] - scores[a] || a - b);
}

export function summarizeRetrieval(report, data) {
    // Questions searching the same HotpotQA pool share its distractors.
    const hotpot = data.hotpotqa.questions.map(q => ({ id: q.id, group: q.pooled.join(',') }));
    const groups = { ...data, hotpotqa: { questions: hotpot } };
    report.bootstrapGroups = Object.fromEntries(Object.entries(groups).map(([task, { questions }]) =>
        [task, new Set(questions.map(q => q.group)).size]));
    report.comparisons = {};
    for (const [key, row] of Object.entries(report.policies)) {
        const [, size] = key.split('/');
        const shipped = report.policies['shipped/' + size];
        row.macroByRanker512 = {};
        for (const ranker of ['dense', 'bm25', 'hybrid']) {
            row.macroByRanker512[ranker] = macro(row, ranker);
            if (row !== shipped) report.comparisons['shipped vs ' + key + '/' + ranker] = paired(shipped, row, groups, ranker);
        }
        report.comparisons[key + '/hybrid vs dense'] = paired(row, row, groups, 'hybrid', 'dense');
    }
}

export async function compareRetrieval(report, data, run) {
    report.references = Object.fromEntries(['@langchain/textsplitters', '@langchain/core'].map(name =>
        [name, reference(name + '/package.json').version]));
    report.fusion = { constant: 60, ranks: 'all dense passages and all positive BM25 matches', tieBreak: 'source order' };
    for (const [label, size, overlap] of [['t256', { tokens: 256 }, 64], ['c500', { chars: 500 }, 125]]) {
        const methods = { shipped: { method: 'public-markdown' }, sentences: { method: 'plain-pack' },
            recursive: { method: 'recursive', overlap: 0 }, 'recursive-overlap': { method: 'recursive', overlap },
            'recursive-markdown': { method: 'recursive-markdown', overlap } };
        if (size.tokens) methods.window = { method: 'window' };
        for (const [name, options] of Object.entries(methods)) {
            await run(name + '/' + label, { ...size, ...options });
        }
    }
    summarizeRetrieval(report, data);
}
