import assert from 'node:assert/strict';
import {MDocument} from './.cache/mastra-comparison/deps/node_modules/@mastra/rag/dist/index.js';
import {sourceSpans} from '../src/citations.js';
import {encodingName} from './encoder.mjs';
import protocol from './mastra-protocol.json' with {type:'json'};

const headers=Array.from({length:6},(_,i)=>['h'+(i+1),'h'+(i+1)]);
const limit=protocol.passageTokens;

function normalized(text) {
    const chars=[], offsets=[];
    for(let i=0;i<text.length;i++) if(!/\s/u.test(text[i])) { chars.push(text[i]); offsets.push(i); }
    return {ink:chars.join(''),offsets};
}

// Match only characters physically present in the returned passage. Splitters
// can reflow whitespace and token decoding can replace a partial Unicode scalar.
function locate(source, chunks, overlap, label) {
    const {ink,offsets}=normalized(source);
    const rows=[];
    let start=-1,end=0;
    for(const {text} of chunks) {
        const needle=text.replace(/\s/gu,'').replace(/^\uFFFD+|\uFFFD+$/gu,'');
        if(!needle.length) continue;
        // Overlap repeats a suffix, but the next ordinary chunk advances the
        // end. A short heading can also occur inside the preceding paragraph.
        const from=overlap?Math.max(0,start+1,end-needle.length+1):end;
        let at=ink.indexOf(needle,from);
        if(at<0 && overlap) at=ink.indexOf(needle,Math.max(0,start));
        assert.ok(at>=0,`Unaligned ${label} after ${end}/${ink.length}: ${needle.slice(0,100)} … ${needle.slice(-45)}`);
        start=at;
        end=at+needle.length;
        rows.push({text,a:offsets[at],b:offsets[end-1]+1});
    }
    return rows;
}

function lowerBound(rows,target,pick) {
    let lo=0,hi=rows.length;
    while(lo<hi) {
        const mid=(lo+hi)>>>1;
        if(pick(rows[mid])<target) lo=mid+1; else hi=mid;
    }
    return lo;
}

async function htmlSections(doc) {
    // Mastra puts headings in metadata and only emits following siblings.
    // Project its heading boundaries onto the visible source so that headings,
    // introductions and nested DOM content all remain searchable and citable.
    const entries=await MDocument.fromHTML(doc.raw).chunk({strategy:'html',headers,returnEachLine:true});
    const {ink,offsets}=normalized(doc.source);
    const starts=[0];
    let next=0;
    for(const {metadata} of entries) {
        const value=headers.map(([h])=>metadata[h]).find(Boolean);
        if(!value) continue;
        const heading=value.replace(/\s/gu,'');
        const at=ink.indexOf(heading,next);
        if(at<0 || !heading) continue;
        if(offsets[at]>starts.at(-1)) starts.push(offsets[at]);
        next=at+heading.length;
    }
    return starts.map((a,j)=>[a,starts[j+1]??doc.source.length]);
}

async function makeLayout(doc,family,size,pct,bank,html) {
    const overlap=Math.round(size*pct/100);
    let kind=family,segments=[[0,doc.source.length]];
    if(family.startsWith('format')) {
        kind=doc.format==='markdown'?(family==='format'?'markdown':'semantic-markdown'):'recursive';
        if(doc.format==='html') segments=html;
    }
    const character=kind==='character';
    const options={strategy:kind,maxSize:character?4*size:size,overlap:character?4*overlap:overlap,
        ...(character?{}:{lengthFunction:bank.countTokens}),separatorPosition:'start',
        ...(['token','semantic-markdown'].includes(kind)?{encodingName}:{}),
        ...(kind==='semantic-markdown'?{joinThreshold:size}:{}),stripWhitespace:kind!=='token'};
    const rows=[];
    let secondary=0;
    for(const [a,b] of segments) {
        const source=doc.source.slice(a,b);
        const parsed=kind.includes('markdown')?MDocument.fromMarkdown(source):MDocument.fromText(source);
        const chunks=await parsed.chunk(options);
        for(const row of locate(source,chunks,overlap,kind)) {
            if(bank.countTokens(row.text)<=Math.min(size,limit)) {
                rows.push({...row,a:a+row.a,b:a+row.b});
                continue;
            }
            secondary++;
            // Splitting a complete oversized passage preserves its tail.
            const sourcePart=source.slice(row.a,row.b);
            const parts=await MDocument.fromText(sourcePart).chunk({strategy:'token',encodingName,maxSize:size,overlap,stripWhitespace:false});
            for(const part of locate(sourcePart,parts,overlap,'secondary '+kind)) {
                if(bank.countTokens(part.text)>limit) throw Error('Oversized secondary passage');
                rows.push({...part,a:a+row.a+part.a,b:a+row.a+part.b});
            }
        }
    }
    assert.ok(rows.length,doc.id+' '+family);
    return {rows,secondary};
}

function reader(doc,core,before,after,tree,tokenizer) {
    const {a,b}=core;
    const near=[];
    const scope=tree.scopes.find(s=>s.a<=a && b<=s.b);
    const min=Math.max(before?.a??a, scope?.a??0);
    const max=Math.min(after?.b??b, scope?.b??doc.source.length);
    if(before && min<a && before.b>=(scope?.a??0)) near.push(-1);
    if(after && max>b && after.a<=(scope?.b??doc.source.length)) near.push(1);
    const remaining=limit-tokenizer.countTokens(core.text);
    if(remaining<=1 || !near.length) return {a,b,tokens:limit-remaining,near};
    const left=near.includes(-1)?doc.source.slice(min,a):'',right=near.includes(1)?doc.source.slice(b,max):'';
    const ls=tokenizer.offsets(left),rs=tokenizer.offsets(right);
    let l=Math.min(ls.length,Math.floor(remaining/2)),r=Math.min(rs.length,remaining-l);
    l=Math.min(ls.length,remaining-r);
    for(;;) {
        const start=l?min+ls[ls.length-l][0]:a,end=r?b+rs[r-1][1]:b;
        const text=doc.source.slice(start,a)+core.text+doc.source.slice(b,end);
        const n=tokenizer.countTokens(text);
        if(n<=limit) return {a:start,b:end,tokens:n,near};
        if(l>=r && l>0) l--; else r--;
    }
}

export async function buildMastraLayouts(doc,structure,canonical,bank,labels,view,keyFor) {
    const nodes=structure.nodes.map(n=>{
        const spans=canonical(sourceSpans(n));
        return {node:n,a:spans[0]?.[0],b:spans.at(-1)?.[1]};
    }).filter(n=>n.b>n.a);
    const ps=nodes.filter(n=>n.node.type==='paragraph').sort((x,y)=>x.a-y.a);
    const scopes=nodes.filter(n=>['section','article','record'].includes(n.node.type)||n.node.record).sort((x,y)=>(x.b-x.a)-(y.b-y.a));
    const sections=scopes.filter(n=>(n.a!==nodes[0].a||n.b!==nodes[0].b) && ['section','article'].includes(n.node.type)
        && ps.filter(p=>p.a>=n.a&&p.b<=n.b).length>=2);
    const tree={scopes};
    const layouts={},geometry={},built=new Map();
    const html=doc.format==='html'?await htmlSections(doc):[];
    for(const label of labels) {
        const [family,s,p]=label.split('/'),size=Number(s),pct=Number(p);
        const actual=family.startsWith('format')&&doc.format==='text'?'recursive':family==='format-semantic'&&doc.format==='html'?'format':family;
        const recipe=[actual,size,pct].join('/');
        if(!built.has(recipe)) {
            let split;
            try { split=await makeLayout(doc,actual,size,pct,bank,html); }
            catch(e) {throw new Error([doc.id,label,e.message].join(' '),{cause:e});}
            const cores=split.rows;
            let covered=0,end=0;
            for(const c of cores) {
                covered+=Math.max(0,c.b-Math.max(end,c.a));end=Math.max(end,c.b);
            }
            const entries=cores.map((c,j)=>{
                const w=reader(doc,c,cores[j-1],cores[j+1],tree,bank);
                const section=sections.find(n=>n.a<=c.a&&c.b<=n.b&&(n.a<c.a||c.b<n.b));
                const para=[];
                for(let h=lowerBound(ps,c.a,n=>n.a);h<ps.length&&ps[h].a<c.b;h++) {
                    if(ps[h].b<=c.b && (ps[h].a!==c.a||ps[h].b!==c.b)) para.push(keyFor(ps[h].node.text));
                }
                return {v:keyFor(c.text),pa:para,section:section?keyFor(section.node.text):-1,
                    bare:view(c.a,c.b,bank.countTokens(c.text)),win:view(w.a,w.b,w.tokens),near:w.near.map(delta=>j+delta)};
            });
            built.set(recipe,{entries,stats:{secondary:split.secondary,chunks:cores.length,covered,sourceUnits:doc.source.length}});
        }
        const {entries,stats}=built.get(recipe);
        layouts[label]=entries;geometry[label]=stats;
    }
    return {layouts,geometry};
}
