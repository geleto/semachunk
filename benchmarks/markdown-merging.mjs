import { markdownText } from '../src/markdown.js';
import { fitsMarkdownJoin, mergePass, packMarkdown } from '../src/markdown-merge.js';
import { directionCosine, documentMergeThreshold, SimilarityStatistics, vectorDirection } from '../src/similarity.js';
import { DEFAULT_CONFIG as defaults } from '../config.js';

// All experiments share the production section, source-gap and budget check.
// The comparison uses a stable sorted list of live boundaries each pass.
export async function combineMarkdown(source, units, embed, options, calibration = {}) {
    const { method, maxChunkSize, fits, leadIn, maxPasses = Infinity, maxUncappedPasses = defaults.MAX_UNCAPPED_PASSES,
        maxMergesPerPass = defaults.MAX_MERGES_PER_PASS, candidateMergesPercentageCap = defaults.MAX_MERGES_PER_PASS_PERCENTAGE,
        uncappedCandidateMerges = defaults.UNCAPPED_CANDIDATE_MERGES } = options;
    calibration.cutoff = options.cutoff ?? 0.5;
    if (method === 'pack' && !leadIn) return packMarkdown(source, units, maxChunkSize, fits);
    let live = units.map((u, i) => ({ ...u, first: i, last: i }));
    function eligible(a, b) {
        const lead = leadIn && a.first === a.last && b.first === b.last && (b.kind === 'code' || b.kind === 'table');
        return a.kind === 'prose' && (b.kind === 'prose' || lead) && fitsMarkdownJoin(source, a, b, maxChunkSize, fits);
    }
    function join(a, b) { return { ...a, last: b.last, end: b.end, kind: b.kind === 'prose' ? 'prose' : 'closed' }; }
    if (method === 'pack') {
        const packed = [];
        for (const unit of live) {
            const last = packed.at(-1);
            if (last && eligible(last, unit)) packed[packed.length - 1] = join(last, unit);
            else packed.push(unit);
        }
        return packed;
    }
    const directions = new WeakMap(), scores = new Map();
    let threshold = calibration.cutoff, initialMean = threshold, uncapped = 0;
    for (let pass = 0; pass < maxPasses && uncapped < maxUncappedPasses && maxMergesPerPass > 0; pass++) {
        const edges = [], missing = new Set();
        for (let i = 0; i + 1 < live.length; i++) {
            const a = live[i], b = live[i + 1];
            if (!eligible(a, b)) continue;
            const fixed = method === 'fixed';
            const key = fixed ? a.last : a.first + '/' + a.last + '/' + b.last;
            const left = fixed ? units[a.last] : a, right = fixed ? units[b.first] : b;
            edges.push({ i, key, left, right });
            if (!scores.has(key)) {
                if (!directions.has(left)) missing.add(left);
                if (!directions.has(right)) missing.add(right);
            }
        }
        if (missing.size) {
            const nodes = [...missing], vectors = await embed(nodes.map(u => markdownText(source, u)));
            nodes.forEach((node, i) => directions.set(node, vectorDirection(vectors[i])));
        }
        for (const edge of edges) {
            if (!scores.has(edge.key)) scores.set(edge.key, directionCosine(directions.get(edge.left), directions.get(edge.right)));
            edge.score = scores.get(edge.key);
        }
        if (!pass || options.schedule === 'live') {
            const stats = new SimilarityStatistics();
            for (const { score } of edges) {
                stats.add(score);
                if (!pass) calibration.scores?.push(score);
            }
            if (options.adaptive) threshold = documentMergeThreshold(stats, calibration.cutoff);
            if (!pass && options.density && stats.boundaryCount >= 2) {
                const fraction = edges.length / (units.length - 1);
                const weight = options.density === 'relax' ? fraction : 1 - fraction;
                threshold = stats.average - weight * Math.sqrt(stats.variance);
            }
            if (!pass) {
                calibration.cutoff = threshold;
                initialMean = stats.boundaryCount >= 2 ? stats.average : threshold;
            }
        } else if (options.schedule === 'tighten') threshold = initialMean;
        const merged = mergePass(live, edges, threshold, { maxMergesPerPass, candidateMergesPercentageCap, uncappedCandidateMerges });
        if (!merged) break;
        live = merged.next;
        if (!merged.capped) uncapped++;
    }
    return live;
}
