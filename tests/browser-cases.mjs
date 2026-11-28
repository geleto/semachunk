export async function exerciseChunker(chunkText,chunkDocument,createDocumentIndex) {
    const sentences = { chunkingStrategy: 'pack', maxChunkSize: 0 };
    const document = await chunkDocument('<h2>A</h2><p>First &amp; second.</p><p>Third.</p>',{
        format:'html',sourceId:'browser',includeHierarchy:true,maxChunkSize:15
    });
    const index = await createDocumentIndex([document],async ts=>ts.map(t=>[t.length,1]),{includeSections:true,includeDocuments:true});
    const sized = await chunkDocument('One. Two. Three.\n\nFour. Five.',{
        includeHierarchy:true,sizeUnit:'tokens',countTokens:s=>s.length,maxChunkSize:18,maxStructuralSize:10,maxPassageSize:24
    });
    const groups = await createDocumentIndex([sized],async ts=>ts.map(t=>[t.length,1]),{
        sentenceGrouping:{maxSentences:2,minSimilarity:0}
    });
    return {
        document, search:await index.search('second'), sections:await index.searchNodes('first'),
        bounded:await groups.search('five'), sentenceGroups:await groups.searchNodes('one',{types:['sentenceGroup']}),
        english: await chunkText('Dr. Silva left. then Ana spoke.', { ...sentences, logging: true }),
        spanish: await chunkText('Hable con la Sra. García. Vuelva luego.', { ...sentences, locale: 'es' }),
        html: await chunkText('<h2>A &amp; B</h2><p>One <em>paragraph</em>.</p>', {
            inputFormat: 'html', chunkingStrategy: 'blocks'
        }),
        htmlStructure: await chunkDocument('<section><h2>Mass</h2><table><tr><th>Fruit</th><th>Weight</th></tr>' +
            '<tr><td>Lime</td><td>130 g</td></tr><tr><td>Pear</td><td>200 g</td></tr></table>' +
            '<pre>  x &lt; y\n    z</pre></section>',{
            format:'html',includeHierarchy:true,sizeUnit:'tokens',maxChunkSize:7,countTokens:t=>t.trim().split(/\s+/u).length
        }),
        markdown: await chunkText('# A &amp; B\n\nFirst. Next.\n\n| X | Y |\n|---|---|\n| 1 | 2 |', {
            inputFormat: 'markdown', chunkingStrategy: 'blocks'
        }),
        json: await chunkText('[{"price":3},{"price":5}]', { inputFormat: 'json' }),
        delimited: await chunkText('red\r\nblue', { separator: '\n', chunkingStrategy: 'blocks' }),
        semanticText: await chunkText('One. Two. Three.', async texts => texts.map(text => [text.length, 1]), {
            chunkingStrategy: 'semantic-blocks', maxChunkSize: 10
        }),
        semanticBlocks: await chunkText('# Keys\n\nRotate keys.\n\n# Tokens\n\nIssue tokens.', async texts => texts.map(() => [1]), {
            inputFormat: 'markdown', chunkingStrategy: 'semantic-blocks', returnEmbedding: false
        })
    };
}
