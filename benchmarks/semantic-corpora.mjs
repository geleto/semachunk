import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { asset, compact } from './corpora.mjs';

export async function friendsDialogue(split = 'test') {
    const files = {
        dev: ['dev', '3a85d3fcb175589ffd050fb4bf431da77a6e12589c8ec03f1d54060ce33ec703'],
        test: ['tst', 'a98f24d4b04ac9f8d9468088febf304bd90eada134537277c1a425e31c0372bc']
    };
    const [suffix, checksum] = files[split];
    const release = { name: 'friendsqa-' + split + '.json', checksum,
        url: 'https://raw.githubusercontent.com/emorynlp/FriendsQA/9ce6c98a6acf13c87d96b6811e4409b5de43bdfe/dat/friendsqa_' + suffix + '.json' };
    const { data } = JSON.parse(await readFile(await asset(release), 'utf8'));
    const docs = [], questions = [];
    let references = 0;
    for (const { title, paragraphs } of data.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }))) {
        const id = title.match(/^s\d+_e\d+/)[0];
        if (docs.at(-1)?.id !== id) docs.push({ id, source: '' });
        const d = docs.length - 1, doc = docs[d];
        for (const scene of paragraphs) {
            const turns = scene['utterances:'].map(({ uid, speakers, utterance }, i) => {
                assert.equal(uid, i);
                const label = speakers.join(', ');
                if (doc.source) doc.source += '\n';
                const start = doc.source.length, body = start + label.length + 2;
                doc.source += label + ': ' + utterance;
                return { start, label, body, words: [...utterance.matchAll(/\S+/gu)] };
            });
            for (const q of scene.qas) {
                const alternatives = q.answers.map(a => {
                    const t = turns[a.utterance_id];
                    const at = a.is_speaker ? t.label.indexOf(a.answer_text) : t.words[a.inner_start].index;
                    assert.ok(at >= 0);
                    const start = (a.is_speaker ? t.start : t.body) + at;
                    const end = a.is_speaker ? start + a.answer_text.length : t.body + t.words[a.inner_end].index + t.words[a.inner_end][0].length;
                    assert.equal(doc.source.slice(start, end), a.answer_text);
                    references++;
                    return [[d, start, end]];
                });
                assert.ok(alternatives.length);
                questions.push({ id: q.id, group: id, text: q.question, pool: [d], references: alternatives });
            }
        }
    }
    return { release, scenes: data.length, references, dataset: { docs, questions } };
}

export async function meetings(split = 'test') {
    const checksum = { test: '6bcd428211260ad2efae3af76cbaf6a7f5ae4bb5e1e59c45a4b8e89539cb9208',
        val: 'fc7444e241bdbe6997c01720d07f1a58b7357284acb73f909766e5a4700db49f' }[split];
    if (!checksum) throw new Error('Unknown QMSum split');
    const file = await asset({ name: 'qmsum-' + split + '.jsonl', checksum,
        url: 'https://raw.githubusercontent.com/Yale-LILY/QMSum/83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e/data/ALL/jsonl/' + split + '.jsonl' });
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
