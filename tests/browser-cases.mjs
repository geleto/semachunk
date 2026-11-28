export async function exerciseChunker(chunk,createDocumentIndex,search) {
    const sentences = { strategy: 'pack', maxChunkSize: 0 };
    const embedBatch = async texts=>texts.map(t=>[t.length,1]);
    const document = await chunk('<h2>A</h2><p>First &amp; second.</p><p>Third.</p>',{
        format:'html',sourceId:'browser',strategy:'semantic',index:true,embedBatch,returnEmbedding:false,maxChunkSize:15
    });
    const index = await createDocumentIndex([document],embedBatch,{includeDocuments:true});
    const sized = await chunk('One. Two. Three.\n\nFour. Five.',{
        sizeUnit:'tokens',countTokens:s=>s.length,maxChunkSize:18,maxStructuralSize:10,maxPassageSize:24,
        index:true,embedBatch,returnEmbedding:false
    });
    const groups = await createDocumentIndex([sized],async ts=>ts.map(t=>[t.length,1]),{
        sentenceGrouping:{maxSentences:2,minSimilarity:0}
    });
    return {
        document, search:await search(document,'second'), sections:await index.searchNodes('first'),
        collection:await search(JSON.parse(JSON.stringify([document,sized])),[6,1],{countTokens:s=>s.length}),
        bounded:await groups.search('five'), sentenceGroups:await groups.searchNodes('one',{types:['sentenceGroup']}),
        english: await chunk('Dr. Silva left. then Ana spoke.', { ...sentences, logging: true }),
        spanish: await chunk('Hable con la Sra. García. Vuelva luego.', { ...sentences, locale: 'es' }),
        html: await chunk('<h2>A &amp; B</h2><p>One <em>paragraph</em>.</p>', {
            format: 'html', strategy: 'blocks'
        }),
        htmlStructure: await chunk('<section><h2>Mass</h2><table><tr><th>Fruit</th><th>Weight</th></tr>' +
            '<tr><td>Lime</td><td>130 g</td></tr><tr><td>Pear</td><td>200 g</td></tr></table>' +
            '<pre>  x &lt; y\n    z</pre></section>',{
            format:'html',sizeUnit:'tokens',maxChunkSize:7,countTokens:t=>t.trim().split(/\s+/u).length
        }),
        markdown: await chunk('# A &amp; B\n\nFirst. Next.\n\n| X | Y |\n|---|---|\n| 1 | 2 |', {
            format: 'markdown', strategy: 'blocks'
        }),
        json: await chunk('[{"price":3},{"price":5}]', { format: 'json' }),
        delimited: await chunk('red\r\nblue', { separator: '\n', strategy: 'blocks' }),
        semanticText: await chunk('One. Two. Three.', { embedBatch:async texts => texts.map(text => [text.length, 1]),
            strategy: 'semantic', maxChunkSize: 10
        }),
        semanticMarkdown: await chunk('# Keys\n\nRotate keys.\n\n# Tokens\n\nIssue tokens.', { embedBatch:async texts => texts.map(() => [1]),
            format: 'markdown', strategy: 'semantic', returnEmbedding: false
        })
    };
}
