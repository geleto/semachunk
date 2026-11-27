import assert from 'node:assert/strict';
import test from 'node:test';
import {chunkDocument,chunkText,createDocumentIndex,getChunkContext} from '../src/index.js';

const embed = async texts => texts.map(t=>[t.length,1]);
const hierarchy = {includeHierarchy:true};

test('upper branches and paragraph joins have a smaller budget than a single prose block',async()=>{
    const prose='Red beans simmer. They soften slowly.';
    const raw='# Care\n\n'+prose+'\n\nWash rice.\n\nCover pan.';
    const html='<section><h1>Care</h1><p>'+prose+'</p><p>Wash rice.</p><p>Cover pan.</p></section>';
    const characterDefaults=await chunkDocument(raw,hierarchy);
    const tokenDefaults=await chunkDocument(raw,{...hierarchy,sizeUnit:'tokens',countTokens:s=>s.length});
    assert.deepEqual([characterDefaults.maxStructuralSize,characterDefaults.maxPassageSize],[1024,2048]);
    assert.deepEqual([tokenDefaults.maxStructuralSize,tokenDefaults.maxPassageSize],[256,512]);
    for(const strategy of ['blocks','semantic-blocks']) {
        for(const format of ['text','markdown','html']) {
            for(const sizing of [{},{sizeUnit:'tokens',countTokens:s=>s.length}]) {
                const source=format==='html'?html:raw;
                const options={...hierarchy,...sizing,format,strategy,maxChunkSize:100,maxPassageSize:100,maxStructuralSize:18,
                    embedBatch:async ts=>ts.map(()=>[1]),joinParagraphs:strategy==='semantic-blocks',returnEmbedding:false};
                const d=await chunkDocument(source,options);
                assert.deepEqual(d.chunks.map(c=>c.text),[format==='html'?'Care':'# Care',prose,'Wash rice.','Cover pan.']);
                assert.ok(d.chunks.every(c=>c.citations.every(r=>source.slice(r.start,r.end)===c.text.slice(r.outputStart,r.outputEnd))));
                assert.ok(d.chunks.every((_,i)=>getChunkContext(d,i).text.length<=100));
                const relaxed=await chunkDocument(source,{...options,maxStructuralSize:Infinity});
                assert.equal(relaxed.chunks.length,1);
            }
        }
    }
    const nested=await chunkDocument('# A\n\n## B\n\n'+prose,{...hierarchy,format:'markdown',maxChunkSize:100,maxStructuralSize:9});
    assert.deepEqual(nested.chunks.map(c=>c.text),['# A','## B',prose]);
    assert.deepEqual(nested.chunks.map(c=>c.headingPath),[['A'],['A','B'],['A','B']]);
    const json=await chunkDocument('{"a":{"x":111,"y":222},"b":"one value remains long"}',
        {...hierarchy,format:'json',maxChunkSize:80,maxStructuralSize:18});
    assert.deepEqual(json.chunks.map(c=>c.jsonPointer),['/a','/b']);
    const nonadditive=await chunkDocument('Wash rice.\n\nCover pan.',{sizeUnit:'tokens',maxChunkSize:100,
        maxStructuralSize:5,countTokens:s=>s.includes('rice.\n\nCover')?50:s.split(/\s+/u).length});
    assert.equal(nonadditive.length,2);
    for(const bad of [0,-1,NaN,2.5]) await assert.rejects(chunkDocument(raw,{maxStructuralSize:bad}),/maxStructuralSize/);
});

test('large routing nodes rank passages and require an explicit full-node lookup',async()=>{
    const raw='# Guide\n\nFirst paragraph.\n\nSecond paragraph.\n\n# End\n\nTiny.\n\nFin.';
    const options={...hierarchy,sourceId:'guide',sizeUnit:'tokens',countTokens:s=>s.length,maxStructuralSize:22,maxPassageSize:45};
    const d=await chunkDocument(raw,options);
    const saved=JSON.parse(JSON.stringify(d));
    const index=await createDocumentIndex([saved],embed,{includeSections:true,includeDocuments:true,countTokens:options.countTokens});
    assert.deepEqual((await index.searchNodes([1,0],{types:['section']})).map(h=>h.node.headingPath),[['End']]);
    assert.deepEqual(await index.searchNodes([1,0],{types:['document']}),[]);
    await assert.rejects(index.searchNodes([1,0],{includeOversized:'false'}),/includeOversized/);
    const [full]=await index.searchNodes([1,0],{types:['document'],includeOversized:true});
    assert.equal(full.node.text,raw);
    const hits=await index.search([1,0],{sectionWeight:.15,documentWeight:.10,useContainedSections:true});
    assert.ok(hits.length && hits.every(h=>h.context.text.length<=45));
    const large=await chunkDocument(raw,{...options,maxStructuralSize:90,maxPassageSize:100});
    for (const docs of [[large,saved],[saved,large]]) {
        const shared=await createDocumentIndex(docs,embed,{includeDocuments:true,countTokens:options.countTokens});
        assert.deepEqual(await shared.searchNodes([1,0],{types:['document']}),[]);
    }
});

test('document strategies preserve legacy text and citation occurrence through normalization', async () => {
    const raw = '  Same.\r\n\r\nSame.\r\n\r\nLast   word.  ';
    for (const strategy of ['blocks','pack','semantic-blocks']) {
        const opts = {strategy,sourceId:'repeat',maxChunkSize:8,embedBatch:embed,returnEmbedding:false};
        const chunks = await chunkDocument(raw,opts);
        const legacy = await chunkText(raw,embed,{chunkingStrategy:strategy,maxChunkSize:8,returnEmbedding:false});
        assert.deepEqual(chunks.map(x=>x.text),legacy.map(x=>x.text));
        assert.deepEqual(chunks.slice(0,2).map(c=>c.citations[0].start),[2,11]);
        assert.ok(chunks.every(c=>c.sourceId==='repeat'));
        const last = chunks.at(-1);
        assert.ok(last.citations.some(r=>raw.slice(r.start,r.end)==='   ' && last.text.slice(r.outputStart,r.outputEnd)===' '));
    }
});

test('overlap, hard token splits and displayed/indexed prefixes retain their own coordinates',async()=>{
    const raw='One. One. One. One.';
    const chunks=await chunkDocument(raw,{strategy:'pack',maxChunkSize:9,chunkOverlap:4,chunkPrefix:'P'});
    assert.deepEqual(chunks.map(c=>c.citations[0].start),[0,5,10]);
    for(const c of chunks) assert.equal(c.citations[0].outputStart,3);
    const small=await chunkDocument('αβγδαβγδ',{strategy:'pack',sizeUnit:'tokens',maxChunkSize:4,countTokens:t=>t.length});
    assert.deepEqual(small.map(c=>c.citations[0].start),[0,4]);
    const [prefixed]=await chunkDocument('Body.',{chunkPrefix:'Heading',excludeChunkPrefixInResults:true});
    assert.equal(prefixed.text,'Body.');
    assert.equal(prefixed.embeddingText,'Heading: Body.');
    await assert.rejects(chunkDocument('body',{sizeUnit:'tokens'}),/countTokens/);
    await assert.rejects(chunkDocument('body',{maxChunkTokens:5}),/sizeUnit/);
});

test('HTML citations refer to visible original text, normalized whitespace and complete entities',async()=>{
    const html='<p hidden>A &amp; B</p><p>A &amp; B</p><p>A &amp; B</p>';
    for (const strategy of ['blocks','semantic-blocks','pack']) {
        const doc=await chunkDocument(html,{...hierarchy,format:'html',strategy,embedBatch:embed,maxChunkSize:5,returnEmbedding:false});
        assert.deepEqual(doc.chunks.map(c=>c.text),['A & B','A & B']);
        const offsets=doc.chunks.map(c=>c.citations.find(r=>r.outputStart===2));
        assert.deepEqual(offsets.map(r=>[r.start,r.end,r.outputEnd]),[[28,33,3],[44,49,3]]);
    }
    const foster=await chunkDocument('<table>First<tr><td>Cell</td></tr>Second</table>',{...hierarchy,format:'html'});
    assert.equal(foster.nodes[0].text,'FirstSecond\n\nCell');
    assert.equal(foster.nodes[0].citations.length,3);
    const [body]=await chunkDocument('<p>X\0\uFFFD</p>',{format:'html'});
    assert.equal(body.text,'X\uFFFD');
    assert.equal(body.citations.at(-1).start,5);
    const [area]=await chunkDocument('<textarea>\0\uFFFD</textarea>',{format:'html'});
    assert.equal(area.text,'\uFFFD\uFFFD');
});

test('Markdown exposes nested authored sections, headings, list introductions and hidden-source gaps',async()=>{
    const raw='---\nsecret: private\n---\n\n# Topic\n\nItems:\n\n- Red\n- Blue\n\n## Nested\n\nBody.\n\n[unused]: /hidden\n';
    const d=await chunkDocument(raw,{...hierarchy,sourceId:'notes',format:'markdown',maxChunkSize:11});
    const [topic,nested]=d.nodes.filter(n=>n.type==='section');
    assert.equal(nested.parentId,topic.id);
    assert.deepEqual(nested.headingPath,['Topic','Nested']);
    assert.equal(d.nodes[nested.introducedBy].text,'## Nested');
    const list=d.nodes.find(n=>n.type==='list');
    assert.equal(d.nodes[list.introducedBy].text,'Items:');
    const items=d.nodes.filter(n=>n.type==='listItem');
    assert.ok(items.every(n=>n.parentId===list.id && n.introducedBy===list.introducedBy));
    assert.doesNotMatch(d.nodes[0].text,/private|hidden/);
    assert.ok(d.nodes.every(n=>n.sourceId==='notes'));
    assert.ok(d.chunks.every(c=>c.nodeIds.every(i=>d.nodes[i])));
    const index=d.chunks.findIndex(c=>c.text.includes('Red'));
    assert.ok(getChunkContext(d,index).introductions.some(n=>n.id===list.introducedBy));
});

test('context clips a neighbor that spans a sibling heading, and keeps whole center passages',async()=>{
    const raw='# A\n\nAlpha one.\n\nAlpha two.\n\n# B\n\nBeta one.\n\nBeta two.';
    const d=await chunkDocument(raw,{...hierarchy,strategy:'pack',maxChunkSize:21});
    const crossing=d.chunks.findIndex(c=>c.text.includes('Alpha two.') && c.text.includes('# B'));
    assert.ok(crossing>=0);
    const left=getChunkContext(d,crossing-1), center=getChunkContext(d,crossing);
    assert.match(left.text,/Alpha two\./); assert.doesNotMatch(left.text,/# B|Beta/);
    assert.match(center.text,/# B/); assert.match(center.text,/Alpha two\./);
    assert.equal(getChunkContext(d,crossing,{neighbors:0}).text,d.chunks[crossing].text);
    for (const [format,source,opts] of [['json','[{"v":1},{"v":2}]',{}],['text','red|blue',{separator:'|'}]]) {
        const doc=await chunkDocument(source,{...hierarchy,format,...opts});
        assert.equal(getChunkContext(doc,0).text,doc.chunks[0].text);
        assert.equal(getChunkContext(doc,1).text,doc.chunks[1].text);
    }
});

test('the index deduplicates vectors, keeps citations for each source, and embeds a query once',async()=>{
    const raw='Iris grows. Roses bloom.\n\nWater the iris.';
    const a=await chunkDocument(raw,{...hierarchy,sourceId:'a'});
    const b=await chunkDocument(raw,{...hierarchy,sourceId:'b'});
    const values=new Map([[a.chunks[0].text,[0,1]],['Water the iris.',[1,0]],['which?',[1,0]]]);
    const calls=[];
    const provider=async ts=>{calls.push(...ts);return ts.map(t=>values.get(t)??[-1,0]);};
    const index=await createDocumentIndex([a,b,a],provider);
    assert.equal(index.stats.uniqueEmbeddings,3);
    const hits=await index.search('which?');
    assert.equal(calls.filter(x=>x==='which?').length,1);
    assert.deepEqual(hits.map(h=>h.sourceId),['a','b']);
    assert.equal(hits[0].score,.5);
    assert.equal(hits[0].match.text,'Water the iris.');
    assert.equal(raw.slice(hits[0].match.citations[0].start,hits[0].match.citations[0].end),'Water the iris.');
    assert.equal(hits[0].chunk.text,raw); assert.equal(hits[0].context.text,raw);
    assert.equal((await index.search([1,0],{distinct:false})).length,3);
    assert.equal(calls.length,4);
    await assert.rejects(index.search([1,2,3]),/dimension/);
});

test('section and whole-document keys can be searched directly or used to rank cited passages',async()=>{
    const d=await chunkDocument('# First\n\nRed.\n\nBlue.\n\n# Second\n\nWhite.\n\nBlack.',{...hierarchy,maxChunkSize:8});
    const index=await createDocumentIndex([d],embed,{includeSections:true,includeDocuments:true});
    const sections=await index.searchNodes([1,0],{types:['section']});
    assert.equal(sections.length,2);
    assert.equal((await index.searchNodes([1,0],{types:['document']})).length,1);
    assert.equal((await index.search([1,0],{sectionWeight:.15,documentWeight:.3,useContainedSections:true})).length>0,true);
    const bare=await createDocumentIndex([d],embed);
    await assert.rejects(bare.search('q',{sectionWeight:.15}),/Enable/);
    assert.deepEqual(await bare.searchNodes('q',{types:['sentence']}),[]);
    assert.deepEqual(await bare.search('q',{limit:0}),[]);
});

test('semantic paragraph joins preserve internal cuts, section boundaries, source positions and both budget modes',async()=>{
    const input = '# A\n\nAlpha. Berry.\n\nCedar. Delta.\n\n# B\n\nElm.';
    const directions = async ts=>ts.map((_,i)=>Array.from({length:ts.length},(_,j)=>Number(i===j)));
    const opts={...hierarchy,strategy:'semantic-blocks',embedBatch:directions,similarityThreshold:1,
        maxChunkSize:Infinity,returnEmbedding:false};
    for (const format of ['text','markdown']) {
        const base=await chunkDocument(input,{...opts,format,joinParagraphs:false});
        assert.ok(base.chunks.every(c=>!c.text.includes('Berry.\n\nCedar.')));
        const d=await chunkDocument(input,{...opts,format,joinParagraphs:true});
        const joined=d.chunks.find(c=>c.text.includes('Berry.\n\nCedar.'));
        assert.ok(joined); assert.doesNotMatch(joined.text,/Alpha|Delta|# B/);
        assert.equal(input.slice(joined.citations[0].start,joined.citations.at(-1).end),joined.text);
        assert.ok(d.nodes.some(n=>n.type==='paragraph' && n.text==='Alpha. Berry.'));
        for (const sizing of [{maxChunkSize:10},{sizeUnit:'tokens',countTokens:s=>s.length,maxChunkSize:10}]) {
            const limited=await chunkDocument(input,{...opts,format,joinParagraphs:true,...sizing});
            assert.ok(limited.chunks.every(c=>!c.text.includes('Berry.\n\nCedar.')));
        }
    }
    await assert.rejects(chunkDocument(input,{joinParagraphs:true}),/semantic-blocks/);
});

test('source-outline ranges rank original chunks independently of chunk and reading boundaries',async()=>{
    const raw='Forecast.\r\n\r\nInsurance\r\n\r\nAuto cover.\r\n\r\nLife cover.';
    const plain=await chunkDocument(raw,{...hierarchy,maxChunkSize:9});
    const start=raw.indexOf('Insurance');
    const range={start,end:raw.length,headingPath:['Insurance']};
    const doc=await chunkDocument(raw,{...hierarchy,maxChunkSize:9,sectionRanges:[range,range]});
    assert.deepEqual(doc.chunks.map(c=>c.text),plain.chunks.map(c=>c.text));
    for(const [i] of doc.chunks.entries()) assert.deepEqual(getChunkContext(doc,i),getChunkContext(plain,i));
    const section=doc.nodes.find(n=>n.retrievalOnly);
    assert.equal(doc.nodes.filter(n=>n.retrievalOnly).length,1);
    assert.deepEqual(section.headingPath,['Insurance']);
    assert.equal(section.citations[0].start,start);
    const provider=async ts=>ts.map(t=>t===section.text || t==='Forecast.'?[0,1]:[1,0]);
    const index=await createDocumentIndex([doc],provider,{includeSections:true});
    assert.equal((await index.searchNodes([1,0],{types:['section']}))[0].node.id,section.id);
    const baseline=await index.search([1,0],{distinct:false,neighbors:0});
    const routed=await index.search([1,0],{sectionWeight:.15,distinct:false,neighbors:0});
    assert.equal(baseline.find(h=>h.chunk.text==='Auto cover.').score,1);
    assert.equal(routed.find(h=>h.chunk.text==='Auto cover.').score,.85);
    await assert.rejects(chunkDocument(raw,{...hierarchy,sectionRanges:[{start:0,end:15},{start:10,end:20}]}),/disjoint or nested/);
    await assert.rejects(chunkDocument(raw,{sectionRanges:[range]}),/includeHierarchy/);
});

test('a shared hard passage budget keeps both the complete core and the cited part of each neighbor',async()=>{
    const raw='Left far. Left near.\n\nCenter here.\n\nRight near. Right far.';
    const countTokens=s=>s.length;
    for (const strategy of ['blocks','semantic-blocks','pack']) {
        const d=await chunkDocument(raw,{...hierarchy,strategy,embedBatch:embed,returnEmbedding:false,
            similarityThreshold:-1,sizeUnit:'tokens',countTokens,maxChunkSize:21,maxPassageSize:37});
        const index=await createDocumentIndex([d],embed);
        const hits=await index.search('near',{limit:100,distinct:false});
        assert.equal(hits.length,d.chunks.length);
        for(const h of hits) {
            assert.ok(h.chunk.text.length<=21 && h.context.text.length<=37);
            assert.ok(h.context.text.includes(h.chunk.text));
            assert.equal(getChunkContext(d,h.chunkIndex,{neighbors:0}).text,h.chunk.text);
            for(const r of h.context.citations) assert.equal(raw.slice(r.start,r.end),h.context.text.slice(r.outputStart,r.outputEnd));
        }
        if(strategy==='blocks') {
            const h=hits.find(h=>h.chunk.text==='Center here.');
            assert.equal(h.context.text,'Left near.\n\nCenter here.\n\nRight near.');
        }
        const restored=JSON.parse(JSON.stringify(d));
        await assert.rejects(createDocumentIndex([restored],embed),/countTokens/);
        const reopened=await createDocumentIndex([restored],embed,{countTokens});
        assert.deepEqual(await reopened.search('near'),await index.search('near'));
    }
});

test('large unbroken text, prefixes and nonadditive tokenizers respect the finite passage ceiling',async()=>{
    const raw='ab'.repeat(6000);
    for(const strategy of ['blocks','semantic-blocks','pack']) {
        const d=await chunkDocument(raw,{...hierarchy,strategy,embedBatch:embed,returnEmbedding:false,
            maxChunkSize:Infinity,maxPassageSize:220,chunkPrefix:'Title'});
        assert.ok(d.chunks.length>1);
        assert.equal(d.chunks.map(c=>c.text.slice('Title: '.length)).join(''),raw);
        assert.ok(d.chunks.every(c=>c.text.length<=220));
        assert.ok(d.chunks.every((_,i)=>getChunkContext(d,i).text.length<=220));
    }
    await assert.rejects(chunkDocument('X',{maxPassageSize:Infinity}),/maxPassageSize/);
    const tiny=await chunkDocument('😀',{...hierarchy,maxPassageSize:1});
    assert.equal(tiny.chunks[0].sizeLimitExceeded,true);
    assert.deepEqual(await (await createDocumentIndex([tiny],embed)).search('x'),[]);
    assert.throws(()=>getChunkContext(tiny,0),/budget/);
    const countTokens=s=>s.length+(s.includes('One.\n\nTwo.')?100:0);
    const doc=await chunkDocument('One.\n\nTwo.\n\nThree.',{...hierarchy,sizeUnit:'tokens',countTokens,maxChunkSize:6,maxPassageSize:20});
    for(const [i] of doc.chunks.entries()) assert.ok(countTokens(getChunkContext(doc,i).text)<=20);
    const legacy=await chunkDocument('Old passage.',hierarchy);
    delete legacy.maxPassageSize;
    delete legacy.sizeUnit;
    const legacyIndex=await createDocumentIndex([legacy],embed);
    assert.equal((await legacyIndex.search('Old.'))[0].context.text,'Old passage.');
});

test('sentence keys are optional, and grouped keys preserve paragraph, chunk and citation identity',async()=>{
    const text='Green one. Green two. Blue one. Blue two.\n\nBlue three. Blue four.';
    const docs=await Promise.all(['blocks','semantic-blocks'].map(strategy=>chunkDocument(text,{...hierarchy,
        sourceId:'colors',strategy,embedBatch:embed,returnEmbedding:false,similarityThreshold:-1,maxChunkSize:1000})));
    const ask=async texts=>texts.map(t=>t.startsWith('Green')?[1,0]:[0,1]);
    const defaults=await createDocumentIndex(docs,ask);
    assert.deepEqual(await defaults.searchNodes([1,0],{types:['sentence','sentenceGroup']}),[]);
    const calls=[];
    const semantic=await createDocumentIndex(docs,async ts=>{calls.push(...ts);return ask(ts);},{
        sentenceGrouping:{maxSentences:3,minSimilarity:.8}
    });
    const groups=(await semantic.searchNodes([1,0],{types:['sentenceGroup']})).map(h=>h.node);
    assert.deepEqual(groups.map(g=>g.text),['Green one. Green two.','Blue one. Blue two.','Blue three. Blue four.']);
    assert.ok(groups.every(g=>g.sourceId==='colors' && g.nodeIds.length===2 &&
        g.text===text.slice(g.citations[0].start,g.citations.at(-1).end)));
    assert.equal(calls.filter(s=>s==='Green one.').length,1);
    assert.ok(semantic.stats.uniqueEmbeddings<calls.length);
    const fixedCalls=[];
    const fixed=await createDocumentIndex(docs,async ts=>{fixedCalls.push(...ts);return ask(ts);},{sentenceGrouping:{}});
    assert.ok(!fixedCalls.includes('Green one.'));
    assert.ok((await fixed.searchNodes([1,0],{types:['sentenceGroup']})).some(h=>h.node.nodeIds.length===3));
    const individual=await createDocumentIndex(docs,ask,{detailTypes:['paragraph','sentence']});
    assert.equal((await individual.searchNodes([1,0],{types:['sentence'],limit:10})).length,6);
    const small=await chunkDocument(text,{...hierarchy,maxChunkSize:22});
    const short=await createDocumentIndex([small],ask,{sentenceGrouping:{maxSentences:3}});
    assert.ok((await short.searchNodes([1,0],{types:['sentenceGroup']})).every(h=>small.chunks.some(c=>c.text.includes(h.node.text))));
    await assert.rejects(createDocumentIndex(docs,ask,{sentenceGrouping:{minSimilarity:1.1}}),/minSimilarity/);
});
