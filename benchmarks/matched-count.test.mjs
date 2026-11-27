import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from './corpora.mjs';
import { dimension } from './encoder.mjs';
import { nearestPartition, scoredTree } from './matched-count.mjs';
import { layout, prepareQuestions, retrieve } from './semantic-settings.mjs';

test('nearest threshold resolves unattainable counts, plateaus and endpoints',()=>{
    const counts=[1,1,4,4,6,8,8], thresholds=counts.map((_,i)=>i);
    const wanted=[0,0,0,2,2,2,4,4,5,5];
    for (const [k,t] of wanted.entries()) assert.equal(nearestPartition(thresholds,i=>counts[i],k),t);
});

test('fitted capped and unlimited layouts match exhaustive public thresholds, including Markdown omissions',async ()=>{
    const encoder={
        countTokens:text=>text.length,
        embed:async texts=>texts.map(t=>[0,2,4].map(i=>parseInt(sha256(t).slice(i,i+2),16)-128))
    };
    const paragraphs=['# Map\n\nSurvey maps show surface elevations. Hikers use them.',
        '## Streets\n\nRoutes change. Keep a current map.\n\n[unseen]: /secret',
        '## Rivers\n\nLevels vary daily. Floods can close paths.\n\nUse posted signs.'];
    for (const [raw,limit] of [[paragraphs.join('\n\n'),Infinity],[paragraphs.join('\n\n'),38],
        ['One paragraph.',Infinity],['| A | B |\n|---|---|\n| First row | Second cell |\n| Second row | Last cell |',34]]) {
        const doc={id:'fixture',format:'markdown',raw,source:raw};
        const tree=await scoredTree(doc,encoder,limit);
        const actual=[];
        for (const cutoff of tree.cutoffs) {
            const result=await layout(doc,'semantic-blocks/'+cutoff,limit,encoder);
            assert.equal(result.over,0);
            actual.push({cutoff,rows:result.rows});
        }
        const counts=actual.map(d=>d.rows.length);
        if (limit===Infinity) assert.deepEqual(counts,counts.toSorted((a,b)=>a-b));
        for (let k=1;k<=Math.max(...counts)+1;k++) {
            const best=actual.toSorted((a,b)=>Math.abs(a.rows.length-k)-Math.abs(b.rows.length-k) ||
                a.rows.length-b.rows.length || a.cutoff-b.cutoff)[0];
            const fitted=tree.match(k);
            assert.deepEqual(fitted,best);
            assert(fitted.rows.every(r=>!r.text.includes('/secret')));
            assert.deepEqual(tree.match(k,42),tree.match(k,42));
        }
    }
});

test('whole-passage retrieval credits evidence at the end of a long result',async ()=>{
    const text='body '.repeat(1500)+'answer';
    const encoder={
        countTokens:s=>s.trim().split(/\s+/u).length,
        embed:async inputs=>inputs.map(()=>new Float32Array(dimension).fill(1,0,1)),
        offsets:()=>{throw new Error('Whole results must never enter the prefix delivery path');}
    };
    const row={doc:0,text,sourceRanges:[{start:0,end:text.length,outputStart:0}]};
    const q={doc:0,text:'What is at the end?',choices:[{doc:0,gold:{tokens:[[[0,text.length-6,text.length]]]}}]};
    const [result]=await retrieve([{group:'source'}],[q],[[row]],'document',encoder,'whole');
    assert.deepEqual(result,[1,1,1,1,1501,1501,1,1]);
});

test('collection retrieval credits a reviewed alternate source and keeps its evidence together', async () => {
    const encoder = {
        countTokens: s => s.length,
        offsets: s => Array.from(s, (_,i) => [i,i+1]),
        embed: async texts => texts.map(() => new Float32Array(dimension).fill(1,0,1))
    };
    const question = {id:'q', text:'When can I apply?', ranges:[[0,1],[2,3]],
        alternativeSources:[{source:'other', ranges:[[4,5],[6,7]]}]};
    const docs = ['first','other','unrelated'].map((id,i) =>
        ({id, source:'a b c d', questions:i === 0 ? [question] : []}));
    const queries = prepareQuestions(docs, encoder);
    const row = (doc,start,end) => ({doc,text:'hit',sourceRanges:[{start,end,outputStart:0}]});
    const complete = await retrieve(docs,queries,[[],[row(1,4,7)],[]],'collection',encoder,'whole');
    assert.equal(complete[0][0],1);
    const mixed = await retrieve(docs,queries,[[row(0,0,1)],[row(1,6,7)],[row(2,0,7)]],'collection',encoder,'whole');
    assert.deepEqual(mixed[0].slice(2,4),[0,0.5]);
});
