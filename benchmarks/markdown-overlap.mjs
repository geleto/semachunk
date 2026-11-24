import { fitsMarkdownJoin } from '../src/markdown-merge.js';
import { markdownText } from '../src/markdown.js';
import { cosineSimilarity, directionCosine, vectorDirection } from '../src/similarity.js';

// The frozen cores and every live span use inclusive original-unit indices.
export async function growMarkdown(source, originals, cores, embed, options, stats) {
    const { cutoff, anchor, coreFloor, sideUnits, sideTokens, limitToCore, countTokens, maxChunkSize, fits,
        indexText = unit => markdownText(source, unit) } = options;
    const spans = cores.slice(), directions = new Map();
    const guard = coreFloor === undefined ? null : (stats.guard ??= {
        preferred: { tried: 0, rejected: 0 }, fallback: { tried: 0, rejected: 0 },
    });
    async function loadDirections(texts) {
        const missing = [...new Set(texts)].filter(text => !directions.has(text));
        if (!missing.length) return;
        const batch = await embed(missing);
        missing.forEach((text, i) => directions.set(text, vectorDirection(batch[i])));
    }
    let active = cores.map((_, i) => i).filter(i => cores[i].kind === 'prose' && !cores[i].parts);
    for (let round = 0; active.length; round++) {
        const proposals = [], needed = [];
        for (const i of active) {
            const span = spans[i], core = cores[i], neighbors = [];
            for (const j of [span.first - 1, span.last + 1]) {
                const unit = originals[j];
                if (unit?.kind !== 'prose') continue;
                const left = j < span.first, a = left ? unit : span, b = left ? span : unit;
                if (sideUnits !== undefined && (left ? core.first - j : j - core.last) > sideUnits) continue;
                if (!fitsMarkdownJoin(source, a, b, maxChunkSize, fits)) continue;
                if (sideTokens !== undefined && countTokens(left ? source.slice(a.start, core.start) : source.slice(core.end, b.end)) > sideTokens) continue;
                if (limitToCore && countTokens(source.slice(a.start, b.end)) > 2 * countTokens(markdownText(source, core))) continue;
                neighbors.push(j);
                needed.push(indexText(unit));
            }
            if (!neighbors.length) continue;
            const text = indexText(span);
            needed.push(text);
            proposals.push({ i, text, neighbors });
        }
        if (!proposals.length) break;
        await loadDirections(needed);
        let choices = [];
        for (const { i, text, neighbors } of proposals) {
            const span = spans[i], core = cores[i], sides = [];
            for (const j of neighbors) {
                const neighbor = directions.get(indexText(originals[j]));
                const score = directionCosine(directions.get(text), neighbor);
                if (score < cutoff) continue;
                if (anchor && span !== core && directionCosine(directions.get(indexText(core)), neighbor) < cutoff) continue;
                const first = Math.min(span.first, j), last = Math.max(span.last, j);
                sides.push({ score, span: { ...span, first, last, start: originals[first].start, end: originals[last].end } });
            }
            // Left was inserted first, so a stable sort preserves the tie break.
            if (sides.length) choices.push({ i, sides: sides.sort((a, b) => b.score - a.score) });
        }
        active = [];
        // Only a rejected first choice can require a second batch. Accepted
        // vectors stay cached for the next round and for the final index.
        for (let side = 0; choices.length; side++) {
            const checks = guard && (side === 0 ? guard.preferred : guard.fallback);
            if (checks) {
                checks.tried += choices.length;
                await loadDirections(choices.map(p => indexText(p.sides[side].span)));
            }
            const retries = [];
            for (const choice of choices) {
                const { i, sides } = choice, span = sides[side].span;
                if (checks && directionCosine(directions.get(indexText(cores[i])), directions.get(indexText(span))) < coreFloor) {
                    checks.rejected++;
                    if (sides[side + 1]) retries.push(choice);
                    continue;
                }
                spans[i] = span;
                active.push(i);
            }
            choices = retries;
        }
        stats.grewPerRound[round] = (stats.grewPerRound[round] ?? 0) + active.length;
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
