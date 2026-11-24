import { fitsMarkdownJoin } from '../src/markdown-merge.js';
import { markdownText } from '../src/markdown.js';
import { cosineSimilarity, directionCosine, vectorDirection } from '../src/similarity.js';
import { lowerBound } from './corpora.mjs';

function wholeProse(unit) {
    return unit?.kind === 'prose' && !unit.parts && !unit.overlapBarrier;
}

// The caller shares the embedding cache with ordinary merging and final indexing.
// Hold the frozen direction per core. All other scoring maps last one round.
export async function growMarkdown(source, originals, cores, embed, options, stats) {
    const { cutoff, anchor, coreFloor, sideUnits, sideTokens, limitToCore, countTokens, maxChunkSize, fits, boundaries,
        scoreFromCore = true, reopen = false, indexText = unit => markdownText(source, unit) } = options;
    const spans = cores.slice(), frozen = [], locked = [];
    // A core may already span several turns. Its two outer turns bound further growth.
    const limits = boundaries && cores.map(core => ({
        start: boundaries[lowerBound(boundaries, core.start, true) - 1] ?? 0,
        end: boundaries[lowerBound(boundaries, core.end)] ?? source.length,
    }));
    const guard = coreFloor === undefined ? null : (stats.guard ??= { tried: 0, rejected: 0, reopened: 0 });
    async function directions(texts) {
        const unique = [...new Set(texts)];
        const vectors = unique.length ? await embed(unique) : [];
        return new Map(unique.map((text, i) => [text, vectorDirection(vectors[i])]));
    }
    // A frozen core may already contain a container or a partial sentence.
    let active = cores.flatMap((core, i) => originals.slice(core.first, core.last + 1).every(wholeProse) ? [i] : []);
    for (let round = 0; active.length; round++) {
        const candidates = [], needed = new Set();
        for (const i of active) {
            const span = spans[i], core = cores[i], neighbors = [];
            for (const j of [span.first - 1, span.last + 1]) {
                const unit = originals[j];
                if (j === locked[i] || !wholeProse(unit)) continue;
                const left = j < span.first, a = left ? unit : span, b = left ? span : unit;
                if (limits && (a.start < limits[i].start || b.end > limits[i].end)) continue;
                if (sideUnits !== undefined && (left ? core.first - j : j - core.last) > sideUnits) continue;
                if (!fitsMarkdownJoin(source, a, b, maxChunkSize, fits)) continue;
                if (sideTokens !== undefined && countTokens(left ? source.slice(a.start, core.start) : source.slice(core.end, b.end)) > sideTokens) continue;
                if (limitToCore && countTokens(source.slice(a.start, b.end)) > 2 * countTokens(markdownText(source, core))) continue;
                neighbors.push(j);
                needed.add(indexText(unit));
            }
            if (!neighbors.length) continue;
            if (!frozen[i]) needed.add(indexText(core));
            if (!scoreFromCore && span !== core) needed.add(indexText(span));
            candidates.push({ i, neighbors });
        }
        if (!candidates.length) break;
        const refs = await directions(needed), trials = [];
        for (const { i, neighbors } of candidates) {
            const span = spans[i], core = cores[i];
            frozen[i] ??= refs.get(indexText(core));
            const reference = scoreFromCore || span === core ? frozen[i] : refs.get(indexText(span));
            let best, high = -Infinity, eligible = 0;
            for (const j of neighbors) {
                const neighbor = refs.get(indexText(originals[j]));
                const score = directionCosine(reference, neighbor);
                if (score < cutoff || (anchor && reference !== frozen[i] && directionCosine(frozen[i], neighbor) < cutoff)) continue;
                eligible++;
                if (score > high) { high = score; best = j; } // Equal scores keep the left neighbor.
            }
            if (best === undefined) continue;
            const first = Math.min(span.first, best), last = Math.max(span.last, best);
            const proposed = { ...span, first, last, start: originals[first].start, end: originals[last].end };
            trials.push({ i, neighbor: best, proposed, otherEligible: eligible === 2 });
        }
        const proposedDirections = guard && await directions(trials.map(t => indexText(t.proposed)));
        if (guard) guard.tried += trials.length;
        active = [];
        let grown = 0;
        for (const { i, neighbor, proposed, otherEligible } of trials) {
            if (guard && directionCosine(frozen[i], proposedDirections.get(indexText(proposed))) < coreFloor) {
                guard.rejected++;
                // The other side gets a later round. A second failed side retires this core.
                locked[i] = neighbor;
                if (otherEligible) active.push(i);
                continue;
            }
            spans[i] = proposed;
            grown++;
            if (reopen && locked[i] !== undefined) {
                locked[i] = undefined;
                guard.reopened++;
            }
            active.push(i);
        }
        stats.grewPerRound[round] = (stats.grewPerRound[round] ?? 0) + grown;
    }
    return spans;
}

// Run after indexing, when the changed bodies and their starting cores have vectors.
export async function measureGrowth(indexText, cores, spans, embed, stats) {
    const changed = spans.flatMap((span, i) => span === cores[i] ? [] : [i]);
    const distinct = new Set(spans.map(s => s.first + '/' + s.last));
    stats.duplicateSpans += spans.length - distinct.size;
    if (!changed.length) return;
    const vectors = await embed(changed.flatMap(i => [indexText(cores[i]), indexText(spans[i])]));
    for (const [k, i] of changed.entries()) {
        const core = cores[i], span = spans[i];
        const additions = core.first - span.first + span.last - core.last;
        const cosine = cosineSimilarity(vectors[2 * k], vectors[2 * k + 1]);
        stats.cosines.push(cosine);
        const group = additions === 1 ? stats.oneAddition : stats.multipleAdditions;
        group.count++;
        if (cosine < 0.8) group.below08++;
    }
}
