import assert from 'node:assert/strict';
import test from 'node:test';
import {chunkDocument,chunkText,createDocumentIndex} from '../src/index.js';

const words = text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const countTokens = text => words(text).length;
const topics = texts => texts.map(t => [/key|token/i.test(t) ? 1 : 0, /plant|crop/i.test(t) ? 1 : 0, .1]);
const shape = d => d.nodes.map(n => [n.type,n.parentId,n.headingPath,n.introducedBy]);

test('HTML and Markdown build the same authored outline through presentational wrappers',async()=>{
    const markdown = '## Guide\n\n### Keys\n\nRotate keys.\n\n- Issue one.\n  - Store it.\n\n> Keep a copy.\n\n' +
        '| Name | Value |\n| --- | --- |\n| Type | Token |\n\n```\nkey = 1\n```\n\n### Crops\n\nPlant barley.';
    const html = '<article><header><h2>Guide</h2></header><section><div><h3>Keys</h3><p>Rotate <em>keys</em>.</p></div>' +
        '<ul><li>Issue one.<ul><li>Store it.</li></ul></li></ul><blockquote><p>Keep a copy.</p></blockquote>' +
        '<table><tr><th>Name</th><th>Value</th></tr><tr><td>Type</td><td>Token</td></tr></table>' +
        '<pre><code>key = 1</code></pre></section><section><h3>Crops</h3><p>Plant barley.</p></section></article>';
    const opts = {includeHierarchy:true,sizeUnit:'tokens',countTokens,maxChunkSize:100};
    const a = await chunkDocument(html,{...opts,format:'html'}), b = await chunkDocument(markdown,{...opts,format:'markdown'});
    assert.deepEqual(shape(a),shape(b));
    assert.deepEqual(words(a.chunks[0].text),words(b.chunks[0].text));
    assert.deepEqual(a.nodes.filter(n=>n.type==='section').map(n=>n.headingPath),[['Guide'],['Guide','Keys'],['Guide','Crops']]);
});

test('equivalent headed prose uses the same three strategies, budgets and retrieval',async()=>{
    const markdown = '# Guide\n\n## Keys\n\nRotate keys.\n\nIssue tokens.\n\n## Crops\n\nPlant barley.\n\nPlant corn.';
    const html = '<div><h1>Guide</h1><section><h2>Keys</h2><p>Rotate keys.</p><p>Issue tokens.</p></section>' +
        '<section><h2>Crops</h2><p>Plant barley.</p><p>Plant corn.</p></section></div>';
    for (const strategy of ['blocks','semantic-blocks','pack']) {
        const results=[];
        for (const [format,text] of [['html',html],['markdown',markdown]]) {
            const opts={format,strategy,includeHierarchy:true,sizeUnit:'tokens',countTokens,maxChunkSize:6,
                maxStructuralSize:6,maxPassageSize:8,embedBatch:topics,returnEmbedding:false};
            const doc=await chunkDocument(text,opts);
            assert.ok(doc.chunks.every(c=>countTokens(c.text)<=8 && c.citations.length));
            const index=await createDocumentIndex([doc],topics,{includeSections:true});
            const hits=await index.search('Which keys?',{sectionWeight:.15});
            results.push([doc.chunks.map(c=>words(c.text)),hits.map(h=>words(h.context.text))]);
        }
        assert.deepEqual(results[0],results[1],strategy);
    }
});

test('page headings have a bounded scope, thematic breaks separate runs and entities cite the visible occurrence',async()=>{
    const html='<h1>Guide</h1><section><h2>A &amp; B</h2><p hidden>same</p><p>same</p></section>' +
        '<p>Outside.</p><hr><p>After the rule.</p>';
    for (const strategy of ['blocks','semantic-blocks','pack']) {
        const d=await chunkDocument(html,{format:'html',strategy,includeHierarchy:true,embedBatch:topics,returnEmbedding:false});
        const heading=d.nodes.find(n=>n.type==='heading' && n.text.includes('&'));
        assert.deepEqual(heading.headingPath,['Guide','A & B']);
        const amp=heading.citations.find(r=>html.slice(r.start,r.end)==='&amp;');
        assert.equal(heading.text.slice(amp.outputStart,amp.outputEnd),'&');
        const same=d.nodes.find(n=>n.type==='paragraph' && n.text==='same');
        assert.equal(same.citations[0].start,html.lastIndexOf('same'));
        assert.deepEqual(d.nodes.find(n=>n.type==='paragraph' && n.text==='Outside.').headingPath,['Guide']);
        assert.ok(d.chunks.every(c=>!(c.text.includes('Outside.') && c.text.includes('After the rule.'))));
    }
});

test('HTML tables keep row boundaries, repeat true column headers and cite the original header each time',async()=>{
    const html='<table><caption>Measurements</caption><tr><td></td><th scope="col">Mass &amp; unit</th></tr>' +
        '<tbody><tr><th scope="row">Lime</th><td>130 grams</td></tr><tr><th scope="row">Pear</th><td>200 grams</td></tr></tbody></table>';
    const opts={format:'html',sizeUnit:'tokens',countTokens,maxChunkSize:5,maxPassageSize:5,maxStructuralSize:5};
    const rows=await chunkDocument(html,opts);
    assert.ok(rows.some(c=>c.text.includes('Measurements')));
    for (const fruit of ['Lime','Pear']) {
        const c=rows.find(c=>c.text.includes(fruit));
        assert.ok(c.text.includes('Mass & unit') && countTokens(c.text)<=5);
        assert.ok(c.citations.some(r=>html.slice(r.start,r.end)==='&amp;'));
    }
    const plain='<table><tr><td>one alpha</td></tr><tr><td>two beta</td></tr><tr><td>three gamma</td></tr></table>';
    assert.deepEqual((await chunkDocument(plain,{...opts,maxChunkSize:2,maxPassageSize:2})).map(c=>c.text.trim()),['one alpha','two beta','three gamma']);
});

test('links and inline code protect sentence punctuation inside their labels',async()=>{
    for (const span of ['<a href="/guide">Keys. Crops.</a>','<code>Keys. Crops.</code>']) {
        const raw='<p>Lead. '+span+' Tail.</p>';
        const rows=await chunkDocument(raw,{format:'html',maxChunkSize:1,maxPassageSize:64});
        assert.deepEqual(rows.map(c=>c.text),['Lead.','Keys. Crops.','Tail.']);
        assert.ok(rows[1].citations.every(r=>raw.slice(r.start,r.end)===rows[1].text.slice(r.outputStart,r.outputEnd)));
    }
});

test('code retains significant whitespace and document titles survive tight budgets in both formats',async()=>{
    const raw='<pre><code>  a &lt; b\n\n    return a</code></pre>';
    const [code]=await chunkDocument(raw,{format:'html'});
    assert.equal(code.text,'  a < b\n\n    return a');
    assert.ok(code.citations.some(r=>raw.slice(r.start,r.end)==='&lt;'));
    for (const strategy of ['blocks','semantic-blocks','pack']) {
        for (const [format,input] of [['html','<h1>Only title</h1>'],['markdown','# Only title']]) {
            const doc=await chunkDocument(input,{format,strategy,maxChunkSize:3,maxPassageSize:6,embedBatch:topics,returnEmbedding:false});
            assert.deepEqual(words(doc.map(c=>c.text).join(' ')),['only','title']);
            assert.ok(doc.every(c=>c.text.length<=6 && c.citations.length));
        }
    }
    assert.deepEqual(await chunkText('<script>noise</script>',{inputFormat:'html'}),[]);
});
