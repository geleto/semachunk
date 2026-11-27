// Compare neighboring complete source paragraphs using the same encoder as the chunks.
// Preserve the original paragraphs and offsets. Only group membership can change.
export const paragraphCutoffs = [0, 25, 40, 55, 70];

export async function paragraphRegions({ source, starts, atomStarts, atomParagraphs, sections, vectorForTexts, dot }) {
    const ends = new Map(starts.map((start, i) => [start, starts[i + 1] ?? source.length]));
    const used = [...new Set(atomParagraphs)];
    const texts = used.map(start => source.slice(start, ends.get(start)).trim());
    const vectors = await vectorForTexts(texts);
    const byStart = new Map(used.map((start, i) => [start, vectors[i]]));
    const regions = Object.fromEntries(paragraphCutoffs.map(t => ['para' + t, [0]]));
    const similarities = [];
    for (let i = 1; i < atomParagraphs.length; i++) {
        const newSection = sections[i] !== sections[i - 1];
        const newParagraph = atomParagraphs[i] !== atomParagraphs[i - 1];
        if (!newSection && !newParagraph) continue;
        const similarity = newParagraph ? dot(byStart.get(atomParagraphs[i - 1]), byStart.get(atomParagraphs[i])) : 0;
        if (!newSection && newParagraph) similarities.push(similarity);
        for (const t of paragraphCutoffs) {
            if (newSection || (t > 0 && similarity < t / 100)) regions['para' + t].push(newSection ? atomStarts[i] : atomParagraphs[i]);
        }
    }
    for (const bounds of Object.values(regions)) bounds.sort((a, b) => a - b);
    return { regions, similarities };
}

// Rejoin only a cut at the exact transition between adjacent source paragraphs.
// Existing semantic cuts inside either paragraph survive, also when joins chain.
export function bridgeTreeCores(cores, members, atomOrder, paragraphs, sections, labels, combine, rotate = 0) {
    const eligible = new Map(), selected = new Set();
    let left = -1;
    for (const [i, core] of cores.entries()) {
        const kids = members[core];
        const right = atomOrder.get(kids[0]);
        if (left >= 0 && right === left + 1 && paragraphs[right] !== paragraphs[left] && sections[right] === sections[left]) {
            const section = sections[right];
            if (!eligible.has(section)) eligible.set(section, []);
            eligible.get(section).push(i);
            if (labels[right] === labels[left]) selected.add(i);
        }
        left = atomOrder.get(kids.at(-1)) ?? -1;
    }
    // Move the same acceptance mask within each section for a same-count control.
    const accepted = new Set();
    for (const positions of eligible.values()) {
        const shift = Math.round(rotate * positions.length);
        for (const [j, i] of positions.entries()) {
            if (selected.has(i)) accepted.add(positions[(j + shift) % positions.length]);
        }
    }
    const groups = [];
    for (const [i, core] of cores.entries()) {
        if (!accepted.has(i)) groups.push([]);
        groups.at(-1).push(core);
    }
    return groups.map(group => {
        const c = combine(group);
        members[c] ??= group.flatMap(i => members[i]);
        return c;
    });
}
