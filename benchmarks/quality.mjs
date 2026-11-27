import { alignDocument, lowerBound, squad, wikisection } from './corpora.mjs';
import { costs, denseRanker, indexedChunks, internCandidates, measure, split, vocabulary } from './chunking.mjs';

export const qualityTasks = { squad, wikisection };

export function windowDiff(words, reference, predicted) {
    const k = Math.max(1, Math.round(words.length / (2 * (reference.length + 1))));
    let errors = 0;
    const cuts = (list, i) => lowerBound(list, words[i + k], true) - lowerBound(list, words[i], true);
    for (let i = 0; i + k < words.length; i++) if (cuts(reference, i) !== cuts(predicted, i)) errors++;
    return words.length > k ? errors / (words.length - k) : 0;
}

export function segmentation(docs, chunks) {
    const predicted = docs.map(() => []);
    for (const { doc, start } of chunks) if (start) predicted[doc].push(start);
    let matched = 0, count = 0, gold = 0, distance = 0;
    docs.forEach((doc, i) => {
        const exact = new Set(doc.cuts);
        matched += predicted[i].filter(pos => exact.has(pos)).length;
        count += predicted[i].length;
        gold += doc.cuts.length;
        const words = Array.from(doc.text.matchAll(/\S+/gu), match => match.index);
        distance += windowDiff(words, doc.cuts, predicted[i]);
    });
    return { matched, predicted: count, gold, precision: count ? matched / count : 0,
        recall: gold ? matched / gold : 0, f1: count + gold ? 2 * matched / (count + gold) : 0, windowDiff: distance / docs.length };
}

export function retrieval(docs, chunks, vocab, rank, tokenEnds, budget = 256) {
    const indices = chunks.map(c => c.index);
    let questions = 0, hits = 0, top1Hits = 0;
    docs.forEach((doc, d) => {
        for (const [query, spans] of doc.questions ?? []) {
            questions++;
            let remaining = budget;
            const order = rank(vocab.id(query), indices);
            for (let i = 0; i < order.length; i++) {
                const { doc: source, start, index } = chunks[order[i]];
                const ends = tokenEnds.get(index), take = Math.min(ends.length, remaining);
                const end = start + (take === ends.length ? vocab.texts[index].length : ends[take - 1]);
                if (take && source === d && spans.some(([a, b]) => start <= a && b <= end)) {
                    hits++; top1Hits += Number(i === 0); break;
                }
                remaining -= take;
                if (!remaining) break;
            }
        }
    });
    return { questions, hits, hitRate: hits / questions, top1Hits };
}

export async function evaluateQuality(task, chunkText, encoder, plans) {
    const vocab = vocabulary(), docs = [];
    for (const original of await qualityTasks[task]()) {
        const parts = await split(chunkText, original.text);
        // These fixtures flatten paragraphs and score offsets in the sentence-normalized
        // text. Give every strategy that same string, including its sentence separators.
        const aligned = alignDocument(original, parts);
        docs.push({ ...aligned, parts, raw: aligned.text });
        internCandidates(parts, 1000, vocab);
        for (const plan of Object.values(plans)) {
            if (!plan.pack && (plan.chunkingStrategy ?? 'blocks') === 'blocks') {
                (await split(chunkText, aligned.text, plan)).forEach(vocab.intern);
            }
        }
    }
    for (const doc of docs) for (const [query] of doc.questions ?? []) vocab.intern(query);
    const { matrix, vectorsSHA256, textsSHA256, precomputation } = await encoder.vectors(vocab.texts);
    const rank = denseRanker(matrix), scores = {}, tokenEnds = new Map(), documents = {};
    for (const [name, plan] of Object.entries(plans)) {
        scores[name] = {};
        for (const partition of ['calibration', 'heldout']) {
            const group = docs.filter(doc => doc.split === partition);
            documents[partition] ??= group.map(d => d.title);
            const rows = [];
            for (const doc of group) rows.push(await measure(chunkText, doc, plan, vocab, matrix, encoder.countTokens));
            const chunks = indexedChunks(group, rows, vocab.texts);
            if (task === 'squad') {
                const missing = [...new Set(chunks.map(c => c.index))].filter(id => !tokenEnds.has(id));
                for (const id of missing) tokenEnds.set(id, encoder.offsets(vocab.texts[id]).map(([, , visibleEnd]) => visibleEnd));
            }
            const metrics = task === 'squad' ? retrieval(group, chunks, vocab, rank, tokenEnds) : segmentation(group, chunks);
            scores[name][partition] = { ...metrics, chunks: chunks.length, ...costs(rows) };
        }
    }
    const objective = task === 'squad' ? 'hits' : 'f1';
    const calibrationSelection = Object.keys(plans).filter(name => name.startsWith('merge-')).sort((a, b) => {
        const x = scores[a].calibration, y = scores[b].calibration;
        return y[objective] - x[objective] || x.chunks - y.chunks;
    })[0];
    return { documents, sentences: docs.reduce((n, d) => n + d.parts.length, 0), distinctTexts: vocab.texts.length,
        textsSHA256, vectorsSHA256, precomputation, calibrationSelection, scores };
}
