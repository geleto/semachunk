import { fitsMarkdownJoin, markdownText, packMarkdown } from '../src/markdown.js';
import { directionCosine, documentMergeThreshold, SimilarityStatistics, vectorDirection } from '../src/similarity.js';
import { DEFAULT_CONFIG as defaults } from '../config.js';

// All experiments share the production section, source-gap and budget check.
// The comparison uses a stable sorted list of live boundaries each pass.
export async function combineMarkdown(source, units, embed, options, initialScores = []) {
    const { method, maxChunkSize, fits, leadIn, maxPasses = Infinity, maxUncappedPasses = defaults.MAX_UNCAPPED_PASSES,
        maxMergesPerPass = defaults.MAX_MERGES_PER_PASS, candidateMergesPercentageCap = defaults.MAX_MERGES_PER_PASS_PERCENTAGE,
        uncappedCandidateMerges = defaults.UNCAPPED_CANDIDATE_MERGES } = options;
    if (method === 'pack' && !leadIn) return packMarkdown(source, units, maxChunkSize, fits);
    let live = units.map((u, i) => ({ ...u, first: i, last: i }));
    function eligible(a, b) {
        const lead = leadIn && a.first === a.last && (b.kind === 'code' || b.kind === 'table');
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
    let threshold = options.cutoff ?? 0.5, uncapped = 0;
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
        if (!pass) {
            const stats = new SimilarityStatistics();
            for (const { score } of edges) { initialScores.push(score); stats.add(score); }
            if (options.adaptive) threshold = documentMergeThreshold(stats, threshold);
        }
        const candidates = edges.filter(e => e.score >= threshold).sort((a, b) => b.score - a.score);
        const percent = Math.floor(candidates.length * candidateMergesPercentageCap / 100 + 1e-9);
        const cap = Math.min(maxMergesPerPass, Math.max(uncappedCandidateMerges, percent));
        if (!candidates.length || !cap) break;
        const starts = new Set();
        let capped = false;
        for (const { i } of candidates) {
            if (starts.has(i - 1) || starts.has(i + 1)) continue;
            if (starts.size === cap) { capped = true; break; }
            starts.add(i);
        }
        const next = [];
        for (let i = 0; i < live.length; i++) {
            if (starts.has(i)) {
                next.push(join(live[i], live[i + 1]));
                i++;
            } else next.push(live[i]);
        }
        live = next;
        if (!capped) uncapped++;
    }
    return live;
}
