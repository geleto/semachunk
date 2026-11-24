import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { asset, compact } from './corpora.mjs';

const meetingChecksums = { test: '6bcd428211260ad2efae3af76cbaf6a7f5ae4bb5e1e59c45a4b8e89539cb9208',
    val: 'fc7444e241bdbe6997c01720d07f1a58b7357284acb73f909766e5a4700db49f' };

export async function meetings(split = 'test') {
    if (!Object.hasOwn(meetingChecksums, split)) throw new Error('Unknown meeting split');
    const file = await asset({ name: 'qmsum-' + split + '.jsonl',
        url: 'https://raw.githubusercontent.com/Yale-LILY/QMSum/83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e/data/ALL/jsonl/' + split + '.jsonl',
        checksum: meetingChecksums[split] });
    const docs = [], questions = [];
    for (const line of (await readFile(file, 'utf8')).trim().split('\n')) {
        const meeting = JSON.parse(line), d = docs.length, id = 'qmsum-' + split + '/' + d;
        const spans = [];
        let source = '';
        for (const turn of meeting.meeting_transcripts) {
            source += (source ? '\n' : '') + turn.speaker + ': ';
            const start = source.length;
            source += compact(turn.content);
            spans.push([d, start, source.length]);
        }
        docs.push({ id, source });
        for (const [i, q] of meeting.specific_query_list.entries()) {
            const turns = new Set();
            for (const [a, b] of q.relevant_text_span) {
                assert.ok(+a >= 0 && +a <= +b && +b < spans.length);
                for (let j = +a; j <= +b; j++) turns.add(j);
            }
            const ref = [...turns].sort((a, b) => a - b).map(j => spans[j]).filter(([, a, b]) => a < b);
            assert.ok(ref.length);
            questions.push({ id: id + '/' + i, group: id, text: q.query, pool: [d], references: [ref] });
        }
    }
    return { docs, questions };
}

// Map every original UTF-16 boundary, including occurrences of repeated text.
export function flattenSource(original) {
    const cleaned = original.replace(/^ {0,3}#{1,6}(?=[ \t])/gm, s => ' '.repeat(s.length));
    const offsets = new Uint32Array(cleaned.length + 1);
    let source = '';
    for (const { index, 0: part } of cleaned.matchAll(/\s+|\S+/gu)) {
        const start = source.length, end = index + part.length;
        if (/^\s/u.test(part)) {
            if (start && end < cleaned.length) source += ' ';
            offsets.fill(source.length, index + 1, end + 1);
        } else {
            source += part;
            for (let j = 1; j <= part.length; j++) offsets[index + j] = start + j;
        }
    }
    return { source, offsets };
}

export function flattenCorpus({ docs, questions }) {
    const flat = docs.map(doc => flattenSource(doc.source));
    return { docs: docs.map((doc, i) => ({ ...doc, source: flat[i].source })),
        questions: questions.map(q => ({ ...q, references: q.references.map(ref => ref.map(([d, a, b]) => {
            const { offsets } = flat[d];
            assert.ok(offsets[a] < offsets[b]);
            return [d, offsets[a], offsets[b]];
        })) })) };
}
