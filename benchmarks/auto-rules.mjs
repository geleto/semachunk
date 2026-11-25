export const rules = ['mode', 'size', 'both', 'paragraphs'];

export function layoutPolicy(format, name = 'public') {
    const method = format === 'markdown' ? 'public-markdown' : 'plain-priority';
    if (name === 'public') return { method };
    const [chunkingStrategy, size] = name.split('/');
    return { method, chunkingStrategy, chars: Number(size) };
}

export function paragraphLengths(source) {
    return source.split(/(?:\r?\n[^\S\r\n]*){2,}/u).map(s => s.trim().length).filter(Boolean).sort((a, b) => a - b);
}

export function choose(rule, lengths, fixed) {
    const [strategy, target] = fixed.split('/');
    if (rule === 'paragraphs') return strategy + '/' + (lengths.length < 2 ? Math.min(500, Number(target)) : target);
    const median = lengths[Math.floor(lengths.length / 2)];
    let size = Number(target);
    if (rule !== 'mode' && median) size = median <= 500 ? 500 : median <= 1024 ? 1024 : 2048;
    const fitting = lengths.filter(n => n >= size / 2 && n <= size).length;
    const blocks = rule !== 'size' && lengths.length >= 4 && fitting * 2 > lengths.length;
    return (blocks ? 'blocks' : strategy) + '/' + size;
}
