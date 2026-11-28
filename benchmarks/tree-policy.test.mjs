import assert from 'node:assert/strict';
import test from 'node:test';
import {studyPassages as chunkText} from './study-layouts.mjs';
import { treeLayout } from './tree-policy.mjs';

const texts = rows => rows.map(r => r.text);
const embed = batch => batch.map(s => [/pear/iu.test(s) ? 1 : 0,/engine/iu.test(s) ? 1 : 0]);
const examples = {
    text:'Pears ripen. Engine runs.\n\nEngines need oil.',
    html:'<section><h2>Engines</h2><p>Pears ripen. Engine runs.</p><p>Engines need oil.</p></section>',
    markdown:'## Engines\n\nPears ripen. Engine runs.\n\nEngines need oil.'
};

test('authored heading boundaries survive a fitting document and preserve Setext source spans', async () => {
    const raw='First entry\n===========\n\nFirst answer.\n\n## Second entry\n\nSecond answer.';
    const budget={maxChunkSize:Infinity};
    for (const method of ['blocks','0.15']) {
        const result=await treeLayout(raw,'markdown',budget,method,async texts=>texts.map(()=>[1]),undefined,true);
        assert.equal(result.headings.length,2);
        assert.equal(raw.slice(result.headings[0].start,result.headings[0].end),'First entry\n===========');
        assert.deepEqual(result.rows.map(r=>r.text),['First entry\n===========\n\nFirst answer.','## Second entry\n\nSecond answer.']);
    }
});

test('benchmark controls replay the public structural and fixed-cutoff layouts and Markdown citations', async () => {
    for (const [format,source] of Object.entries(examples)) {
        for (const [method,strategy] of [['0.15','semantic-blocks'],['blocks','blocks']]) {
            const countTokens = s => s.trim().split(/\s+/u).length;
            const options = {inputFormat:format,chunkingStrategy:strategy,combineChunksSimilarityThreshold:.15,
                returnEmbedding:false,maxChunkSize:Infinity,maxChunkTokens:6,countTokens};
            const actual = await chunkText(source,embed,options);
            const {rows} = await treeLayout(source,format,{maxChunkSize:Infinity,fits:s => countTokens(s) <= 6},method,embed);
            assert.deepEqual(texts(rows),texts(actual));
            if (format === 'markdown') assert.deepEqual(rows.map(r => r.sourceRanges),actual.map(r => r.sourceRanges));
        }
    }
});

test('no-cut control keeps the document root and paragraph protection still descends past either limit', async () => {
    const raw = 'Pears ripen. Engine runs.';
    const fail = () => assert.fail('No-cut control requested selection embeddings');
    const control = await treeLayout('Pears ripen.\n\nPears fall.','text',{maxChunkSize:80},'tree',fail);
    assert.equal(control.rows.length,1);
    assert.equal((await treeLayout(raw,'text',{maxChunkSize:80},'0.15',embed)).rows.length,2);
    for (const budget of [{maxChunkSize:80},{maxChunkSize:Infinity,fits:s => s.length < 80}]) {
        assert.deepEqual(texts((await treeLayout(raw,'text',budget,'paragraph',embed)).rows),[raw]);
    }
    for (const budget of [{maxChunkSize:16},{maxChunkSize:Infinity,fits:s => s.length <= 16}]) {
        assert.deepEqual(texts((await treeLayout(raw,'text',budget,'paragraph',embed)).rows),['Pears ripen.','Engine runs.']);
    }
});
