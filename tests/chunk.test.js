import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../src/index.js';

const {chunk,createDocumentIndex,getChunkContext} = api;
const topics = async texts=>texts.map(t=>t==='B.' || t==='D.' ? [1,0] : [0,1]);

test('one chunk API returns a cited document for all formats and keeps both semantic layouts addressable',async()=>{
    assert.ok(!('chunkDocument' in api) && !('chunkText' in api));
    for (const [format,text] of [['text','First.'],['markdown','# First'],['html','<p>First.</p>'],['json','["First."]']]) {
        const doc=await chunk(text,{format,sourceId:'source'});
        assert.equal(doc.strategy,'blocks');
        assert.equal(doc.format,format);
        assert.ok(doc.nodes.length && doc.chunks.length);
        assert.ok(doc.chunks.every(c=>c.layout==='blocks' && c.sourceId==='source' && c.citations.length && doc.nodes[c.parentId]));
    }
    const empty=await chunk('',{strategy:'semantic',embedBatch:assert.fail});
    assert.deepEqual(empty.chunks,[]);
    assert.equal(empty.nodes[0].type,'document');
    const emptyIndex=await createDocumentIndex([empty],assert.fail);
    assert.equal(emptyIndex.stats.layouts,2);
    assert.deepEqual(await emptyIndex.search('unused'),[]);
    await assert.rejects(chunk('abc',topics),/options/);
    await assert.rejects(chunk('abc',{chunkingStrategy:'semantic'}),/strategy/);
});

test('semantic search uses within-layout neighbors, bounded reading windows and one source after serialization',async()=>{
    const text='A.\n\nB.\n\nC.\n\nD.\n\nE.';
    const countTokens=s=>s.length;
    const options={strategy:'semantic',embedBatch:topics,returnEmbedding:false,sizeUnit:'tokens',countTokens,
        maxChunkSize:2,maxStructuralSize:2,maxPassageSize:24};
    const doc=await chunk(text,options);
    const saved=JSON.parse(JSON.stringify(doc));
    assert.deepEqual(doc.chunks.map(c=>c.layout),[...Array(5).fill('blocks'),...Array(5).fill('semantic')]);
    for (const d of [doc,saved]) {
        const index=await createDocumentIndex([d],topics,{countTokens});
        assert.deepEqual(index.stats,{documents:1,layouts:2,chunks:10,uniqueEmbeddings:5});
        const hits=await index.search([1,0],{distinct:false,limit:10});
        const at=i=>hits.find(h=>h.chunkIndex===i);
        assert.ok(hits.every(h=>h.documentIndex===0 && h.chunk===d.chunks[h.chunkIndex]));
        assert.equal(at(2).score,0);
        assert.ok(Math.abs(at(7).score-.3/Math.hypot(.7,.3))<1e-12);
        assert.equal(at(2).context.text,text);
        assert.equal(at(7).context.text,text);
        assert.equal(getChunkContext(d,7,{countTokens,neighbors:0}).text,'C.');
        assert.equal(at(4).context.text,text);
        assert.deepEqual(at(7).context,getChunkContext(d,7,{countTokens}));
        const distinct=await index.search([1,0]);
        assert.ok(distinct.length<hits.length);
    }
});

test('the two layouts share provider requests and output vectors remain independently mutable',async()=>{
    const calls=[];
    const embedBatch=async texts=>{calls.push(...texts);return texts.map(()=>Float32Array.of(1));};
    const doc=await chunk('Only.',{strategy:'semantic',embedBatch});
    assert.deepEqual(calls,['Only.']);
    const [a,b]=doc.chunks;
    assert.notEqual(a.embedding,b.embedding);
    a.embedding[0]=0;
    assert.equal(b.embedding[0],1);
    const zero=async texts=>texts.map(()=>[0,0]);
    const repeated=await chunk('A.\n\nB.\n\nA.',{strategy:'semantic',embedBatch:zero,maxChunkSize:2});
    const index=await createDocumentIndex([repeated],zero);
    assert.ok((await index.search([0,0],{distinct:false})).every(h=>h.score===0));
});
