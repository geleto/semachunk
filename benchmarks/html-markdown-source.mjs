import assert from 'node:assert/strict';
import TurndownService from './.cache/html-markdown/deps/node_modules/turndown/lib/turndown.cjs.js';
import plugins from './.cache/html-markdown/deps/node_modules/turndown-plugin-gfm/lib/turndown-plugin-gfm.cjs.js';
import {appendRange} from '../src/citations.js';
import {canonicalMapper} from './bounded-source.mjs';

const options={headingStyle:'atx',bulletListMarker:'-',codeBlockStyle:'fenced',emDelimiter:'*'};
const ordinary=new TurndownService(options).use(plugins.gfm);
const annotated=new TurndownService(options).use(plugins.gfm);
const mark='\uE000', white=/\s/u;
const escape=annotated.escape.bind(annotated);

// Trace DOM text through Turndown independently of either retrieval parser.
// Generated Markdown markers receive no source credit. Literal list numbers,
// punctuation and escaped text keep their exact source occurrences.
annotated.escape=input=>{
    const encoded=escape(input);
    let i=0,output='';
    for(const ch of input) {
        if(encoded[i]==='\\' && encoded.startsWith(ch,i+1)) {output+='\\'; i++;}
        assert.ok(encoded.startsWith(ch,i));
        output+=ch+(white.test(ch)?'':mark);
        i+=ch.length;
    }
    assert.equal(i,encoded.length);
    return output;
};

export function convertGovernmentPage(doc) {
    const markdown=ordinary.turndown(doc.raw);
    assert.ok(!doc.raw.includes(mark) && !markdown.includes(mark));
    const trace=annotated.turndown(doc.raw);
    assert.equal(trace.replaceAll(mark,''),markdown,doc.id+' conversion parity');
    const ranges=[];
    let start=0,source=0;
    for(let i=0;i<trace.length;) {
        const ch=String.fromCodePoint(trace.codePointAt(i));
        assert.notEqual(ch,mark);
        i+=ch.length;
        if(trace[i]===mark) {
            i++;
            while(source<doc.source.length && white.test(doc.source[source])) source++;
            assert.ok(doc.source.startsWith(ch,source),doc.id+' source character '+source);
            appendRange(ranges,start,start+ch.length,source,source+ch.length);
            source+=ch.length;
        }
        start+=ch.length;
    }
    assert.equal(doc.source.slice(source).trim(),'');
    assert.equal(start,markdown.length);
    return {markdown,canonical:canonicalMapper(ranges)};
}
