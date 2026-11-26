// Each match becomes one UTF-16 unit. Translate offsets back in source order.
export function collapseRuns(source, pattern, replacement) {
    const text = source.replace(pattern, replacement);
    const gaps = source.matchAll(pattern);
    let gap = text.length < source.length ? gaps.next().value : undefined;
    let removed = 0;
    function sourceOffset(offset) {
        while (gap && gap.index < offset + removed) {
            removed += gap[0].length - 1;
            gap = gaps.next().value;
        }
        return offset + removed;
    }
    return { text, sourceOffset };
}
