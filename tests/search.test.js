import assert from 'node:assert/strict';
import test from 'node:test';
import {chunk, createDocumentIndex, search} from '../src/index.js';

function vectorFor(text) {
    return Float32Array.of(1 + (text.match(/pump/gi)?.length ?? 0) * 4,
        1 + (text.match(/rose/gi)?.length ?? 0) * 4, text.length / 100);
}

test('prepared documents can be appended and reordered with one query embedding for the entire collection',async()=>{
    const calls = [];
    const embedBatch = async texts=>{calls.push(...texts); return texts.map(vectorFor);};
    const options = {index:true,embedBatch,maxCachedEmbeddings:0};
    const garden = await chunk('Water the rose.\n\nPrune the rose.',{...options,sourceId:'garden'});
    assert.ok(garden.chunks[0].embedding instanceof Float32Array);
    assert.deepEqual(new Set(calls),new Set(garden.index.embeddings.map(([input])=>input)));
    assert.equal(calls.length,garden.index.embeddings.length);
    assert.ok(garden.index.embeddings.every(([,vector])=>Array.isArray(vector)));
    const restored = JSON.parse(JSON.stringify(garden));
    assert.deepEqual(restored.chunks[0].embedding,Array.from(garden.chunks[0].embedding));
    const docs = [garden];
    const question = 'Start the pump?';
    const query = vectorFor(question);
    calls.length = 0;
    assert.deepEqual(await search(garden,query),await search(docs,query));
    assert.equal((await search(restored,query))[0].score,(await search(garden,query))[0].score);
    assert.deepEqual(calls,[]);
    const manual = await chunk('Start the pump.\n\nStop the pump.',{...options,sourceId:'manual',returnEmbedding:false});
    assert.ok(manual.chunks.every(c=>c.embedding===undefined));
    assert.ok(calls.every(text=>!text.includes('rose')));
    docs.push(manual);
    calls.length = 0;
    const hits = await search(docs,question);
    assert.deepEqual(calls,[question]);
    assert.deepEqual(hits.map(h=>[h.sourceId,h.documentIndex]),[['manual',1],['garden',0]]);
    assert.ok(hits.every(h=>h.chunk===docs[h.documentIndex].chunks[h.chunkIndex]));
    docs.reverse();
    const [best] = await search(docs,query,{limit:1});
    assert.equal(best.sourceId,'manual');
    assert.equal(best.documentIndex,0);
    assert.equal(best.score,hits[0].score);
    assert.deepEqual(calls,[question]);
});

test('saved semantic documents reproduce custom-index scores and citations for both layouts and reading windows',async()=>{
    const raw = '# Repair\n\nReset the fuse.\n\nStart the pump.\n\n# Garden\n\nWater the rose.\n\nPrune the rose.';
    const countTokens = s=>s.length;
    const embedBatch = async texts=>texts.map(vectorFor);
    const options = {format:'markdown',strategy:'semantic',sourceId:'guide',sizeUnit:'tokens',countTokens,
        maxChunkSize:38,maxStructuralSize:40,maxPassageSize:60,embedBatch,returnEmbedding:false};
    const plain = await chunk(raw,options);
    const reference = await createDocumentIndex(plain,embedBatch);
    const doc = JSON.parse(JSON.stringify(await chunk(raw,{...options,index:true})));
    assert.ok(doc.index.embeddings.some(([text])=>text==='Garden\n\nWater the rose.'));
    assert.ok(doc.index.embeddings.some(([text])=>text.includes('Water the rose.') && text.includes('Prune the rose.')));
    await assert.rejects(search(doc,[1,2,3]),/countTokens/);
    const query = vectorFor('pump');
    for (const neighbors of [0,1]) {
        for (const distinct of [true,false]) {
            const selection = {limit:20,neighbors,distinct};
            const expected = await reference.search(query,selection);
            const hits = await search(doc,query,{countTokens,...selection});
            assert.deepEqual(hits,expected);
            if (!distinct) assert.deepEqual(new Set(hits.map(h=>h.chunk.layout)),new Set(['blocks','semantic']));
        }
    }
    const reopened = await createDocumentIndex(doc,undefined,{countTokens});
    assert.deepEqual(await reopened.search(query),await reference.search(query));
    await assert.rejects(search(doc,'pump',{countTokens}),/text query/);
    const calls = [];
    const ask = async ts=>{calls.push(...ts); return ts.map(vectorFor);};
    assert.deepEqual(await search(doc,'pump',{embedBatch:ask,countTokens}),await reference.search(query));
    assert.deepEqual(calls,['pump']);
});

test('global overlap suppression respects source identity and can fill the limit after duplicate hits',async()=>{
    const settings = {index:true,embedBatch:async texts=>texts.map(()=>[1]),maxChunkSize:0,strategy:'pack'};
    const named = await chunk('A. B. C.',{...settings,sourceId:'record'});
    const copy = JSON.parse(JSON.stringify(named));
    const other = await chunk('A. B. C.',settings);
    const docs = [named,copy,other];
    const reference = await createDocumentIndex(docs);
    for (const limit of [1,4,9]) {
        for (const distinct of [true,false]) {
            const options = {limit,neighbors:0,distinct};
            assert.deepEqual(await search(docs,[1],options),await reference.search([1],options));
        }
    }
    const hits = await search(docs,[1],{limit:4,neighbors:0});
    assert.deepEqual(hits.map(h=>h.documentIndex),[0,0,0,2]);
    assert.equal(hits[3].chunk.text,'A.');
});

test('plain documents share in-flight preparation, retry a failed request and reuse successful vectors',async()=>{
    const doc = await chunk('Spring tides.\n\nNeap tides.');
    assert.equal(doc.index,undefined);
    const query = [1,0,0];
    let calls = 0;
    const provider = async ts=>{
        if (++calls === 1) throw new Error('Provider unavailable');
        return ts.map(vectorFor);
    };
    await assert.rejects(search(doc,query),/embedBatch/);
    const attempt = ()=>search(doc,query,{embedBatch:provider});
    const failures = await Promise.allSettled([attempt(),attempt()]);
    assert.equal(calls,1);
    assert.ok(failures.every(f=>f.status==='rejected' && /Provider unavailable/.test(f.reason.message)));
    const [first,second] = await Promise.all([attempt(),attempt()]);
    assert.deepEqual(first,second);
    assert.deepEqual(await search([doc],query),first);
    assert.equal(calls,2);
    await search(doc,'tide');
    assert.equal(calls,3);
    const alternate = async ts=>ts.map(()=>[1,0]);
    assert.ok((await search(doc,[0,1],{embedBatch:alternate})).every(h=>h.score===0));
});

test('prepared search validates dimensions, skips empty sources, and supports additional routing keys',async()=>{
    await assert.rejects(chunk('one',{index:true}),/embedBatch/);
    await assert.rejects(chunk('one',{index:'yes'}),/boolean/);
    const embedBatch = async ts=>ts.map(vectorFor);
    const options = {index:true,embedBatch,returnEmbedding:false,maxChunkSize:9};
    const raw = '# One\n\nWater.\n\nRose.\n\n# Two\n\nPump.\n\nOil.';
    const doc = await chunk(raw,options);
    const empty = await chunk('',{index:true,embedBatch:assert.fail});
    const other = await chunk('two',{index:true,embedBatch:async ts=>ts.map(()=>[1])});
    assert.deepEqual(await search([],'unused',{embedBatch:assert.fail}),[]);
    assert.deepEqual(await search(empty,'unused',{embedBatch:assert.fail}),[]);
    assert.deepEqual(await search([doc,other],'unused',{limit:0,embedBatch:assert.fail}),[]);
    await assert.rejects(search([doc,other],'unused',{embedBatch:assert.fail}),/dimension/);
    const sameText = await chunk('two',options);
    await assert.rejects(createDocumentIndex([sameText,other]),/dimension/);
    await assert.rejects(search(doc,[0]),/dimension/);
    await assert.rejects(search(doc,[0,0,NaN]),/finite/);
    await assert.rejects(search(doc,[1,2,3],{limit:-1}),/limit/);
    await assert.rejects(search(doc.chunks,[1,2,3]),/chunked document/);
    const reference = await createDocumentIndex([empty,doc],embedBatch,{includeSections:true,includeDocuments:true});
    const scoring = {sectionWeight:.2,documentWeight:.1,useContainedSections:true};
    const hits = await search([empty,doc],[0,1,0],scoring);
    assert.ok(hits.every(h=>h.documentIndex===1));
    assert.deepEqual(hits,await reference.search([0,1,0],scoring));
});
