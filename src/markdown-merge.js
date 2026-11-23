import { markdownResult, markdownText, parseMarkdown } from './markdown.js';
import { mergeLimit } from './merge.js';
import { directionCosine, documentMergeThreshold, SimilarityStatistics, vectorDirection } from './similarity.js';

export async function chunkMarkdown(source, embed, options) {
    const { maxChunkSize, maxChunkTokens, fits, combineChunks } = options;
    let units = parseMarkdown(source, options);
    if (combineChunks) {
        // Both limits must leave room for scoring to pay off (benchmarks/LOG.md).
        units = maxChunkSize >= 1024 && maxChunkTokens >= 256
            ? await mergeOriginalBoundaries(source, units, embed, options)
            : packMarkdown(source, units, maxChunkSize, fits);
    }
    return units.map(unit => markdownResult(source, unit));
}

export function fitsMarkdownJoin(source, left, right, maxChunkSize, fits) {
    return !left.parts && !right.parts && left.sectionId === right.sectionId && left.run === right.run &&
        right.end - left.start <= maxChunkSize &&
        !/\S/u.test(source.slice(left.end, right.start)) && (!fits || fits(source.slice(left.start, right.end)));
}

export function packMarkdown(source, units, maxChunkSize, fits) {
    const packed = [];
    for (const unit of units) {
        const last = packed.at(-1);
        if (last?.kind === 'prose' && unit.kind === 'prose' && fitsMarkdownJoin(source, last, unit, maxChunkSize, fits)) last.end = unit.end;
        else packed.push({ ...unit });
    }
    return packed;
}

// Live edges are in source order, so a stable sort breaks cosine ties by
// occurrence. A pass is capped only when it defers another disjoint pair.
export function mergePass(live, edges, cutoff, options) {
    const candidates = edges.filter(e => e.score >= cutoff).sort((a, b) => b.score - a.score);
    const cap = mergeLimit(candidates.length, options);
    if (!candidates.length || !cap) return null;
    const selected = new Set();
    let capped = false;
    for (const { i } of candidates) {
        if (selected.has(i - 1) || selected.has(i + 1)) continue;
        if (selected.size === cap) { capped = true; break; }
        selected.add(i);
    }
    const next = [];
    for (let i = 0; i < live.length; i++) {
        const left = live[i];
        if (selected.has(i)) {
            const right = live[i + 1];
            next.push({ ...left, end: right.end, last: right.last, kind: right.kind });
            i++;
        } else next.push(left);
    }
    return { next, capped };
}

export async function mergeOriginalBoundaries(source, units, embed, options) {
    const { maxChunkSize, fits, maxPasses, maxUncappedPasses, calibrate } = options;
    let cutoff = options.combineChunksSimilarityThreshold;
    if (!maxPasses || !maxUncappedPasses || (!calibrate && cutoff > 1) || units.length < 2 ||
        !mergeLimit(units.length - 1, options)) return units;

    const scores = [], directions = [], checks = [];
    let live = units.map((unit, last) => ({ ...unit, last }));
    let uncapped = 0;
    for (let pass = 0; pass < maxPasses && uncapped < maxUncappedPasses; pass++) {
        const edges = [], missing = new Set();
        for (let i = 0; i + 1 < live.length; i++) {
            const a = live[i], b = live[i + 1], gap = a.last;
            if (a.kind !== 'prose' || b.kind !== 'prose') continue;
            // Only the two outer endpoints can change the exact joined slice.
            let check = checks[gap];
            if (!check || check.start !== a.start || check.end !== b.end) {
                check = checks[gap] = { start: a.start, end: b.end, fits: fitsMarkdownJoin(source, a, b, maxChunkSize, fits) };
            }
            if (!check.fits) continue;
            edges.push({ i, gap });
            if (scores[gap] === undefined) {
                if (!directions[gap]) missing.add(gap);
                if (!directions[gap + 1]) missing.add(gap + 1);
            }
        }
        if (!edges.length || !mergeLimit(edges.length, options)) break;
        if (missing.size) {
            const ids = [...missing], vectors = await embed(ids.map(i => markdownText(source, units[i])));
            ids.forEach((id, i) => { directions[id] = vectorDirection(vectors[i]); });
        }
        const stats = !pass && calibrate ? new SimilarityStatistics() : null;
        for (const edge of edges) {
            const gap = edge.gap;
            edge.score = scores[gap] ??= directionCosine(directions[gap], directions[gap + 1]);
            stats?.add(edge.score);
        }
        if (stats) cutoff = documentMergeThreshold(stats, cutoff);
        const merged = mergePass(live, edges, cutoff, options);
        if (!merged) break;
        live = merged.next;
        if (!merged.capped) uncapped++;
    }
    return live;
}
