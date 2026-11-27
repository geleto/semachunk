"""Full public-source documents for the three manually annotated fresh domains."""
import html,json,re
from pathlib import Path
HERE=Path(__file__).resolve().parent
URLS={
    "psf":"https://www.python.org/psf/records/board/minutes/2012-11-21/",
    "fed":"https://www.federalreserve.gov/monetarypolicy/fomcminutes20190130.htm",
    "letter77":"https://www.berkshirehathaway.com/letters/1977.html",
    "letter83":"https://www.berkshirehathaway.com/letters/1983.html",
    "prettier":"https://raw.githubusercontent.com/prettier/prettier/497303f63199c530521bb029c274334a2b4ff844/docs/rationale.md",
    "go":"https://raw.githubusercontent.com/golang/website/f9824da7097d4b1780b46fbda5409788a7b5679c/_content/doc/faq.md"}
def prepare(m,preview=False):
    groups={}
    citations={} if preview else json.loads((HERE/"mixture-citations.json").read_bytes())
    for key,url in URLS.items():
        file=m.CACHE/"mixture-sources"/(key+".source")
        blob=m.fetch(file,url)
        try:raw=blob.decode("utf-8-sig")
        except UnicodeDecodeError:raw=blob.decode("windows-1252")
        if key in ("psf","fed"):
            if key=="psf":
                intro=raw.index('<div class="minutes-title line-block">');toc=raw.index('<div class="contents',intro)
                a=raw.index('<div class="section" id="attendance"');b=raw.index("</div>",raw.index('<div class="section" id="adjournment"'))+6
                body=raw[intro:toc]+raw[a:b]
            else:
                body=raw[raw.index('id="article"'):raw.index('id="lastUpdate"')];body=body[body.index(">")+1:body.rfind("<div")]
            reader=m.Paragraphs();reader.feed(body);reader.flush()
            pars=[p.removesuffix(" Return to text") for p in reader.out if p!="Back to Top"]
            terms=set(m.compact(html.unescape(re.sub("<[^>]+>","",s))) for s in re.findall(r"<strong[^>]*>(.*?)</strong>",body,re.I|re.S))
            heads=[i for i,p in enumerate(pars) if re.match(r"^\d+(?:\.\d+)*\s+[A-Z]",p) or any(p.startswith(t) and 8<len(t)<135 for t in terms)]
            doc=m.textdoc(key,pars);domain="boards"
        elif key.startswith("letter"):
            pre=re.search(r"<pre\b[^>]*>(.*?)</pre>",raw,re.I|re.S)
            if pre:body=pre[1]
            else:body=re.sub(r"<script\b.*?</script>","",raw,flags=re.S|re.I).split("<BODY>")[-1]
            body=html.unescape(re.sub(r"<[^>]+>","",body)).replace("\r\n","\n")
            pars=[m.compact(s) for s in re.split(r"\n[ \t]*\n",body) if m.compact(s)]
            if pre:
                # The 1983 archive appends a second HTML fragment after the signed letter.
                pars.extend(m.compact(html.unescape(re.sub(r"<[^>]+>","",p))) for p in
                    re.findall(r"<p\b[^>]*>(.*?)</p>",raw[pre.end():],re.I|re.S))
                pars=[p for p in pars if p and re.search(r"[\w\d]",p.strip("_"))]
            heads=[i for i,p in enumerate(pars) if len(p)<85 and len(p.split())<=9 and not re.search(r"[.;:?]$",p)]
            doc=m.textdoc(key,pars);domain="finance"
        else:
            body=re.sub(r"\A---\r?\n.*?\r?\n---\r?\n","",raw,flags=re.S).strip().replace("\r\n","\n")
            if key=="go":
                tick=chr(96)
                body=re.sub(r"\{\{raw\s*"+tick+r"\s*<pre>(.*?)</pre>\s*"+tick+r"}}",lambda m:"\n"+tick*3+"go\n"+html.unescape(m[1]).strip("\n")+"\n"+tick*3+"\n",body,flags=re.S)
            pars=[];block=[];fence=None
            for line in body.splitlines()+[""]:
                match=re.match(r"^\s*("+chr(96)+r"{3,}|~{3,})",line)
                if match:
                    if fence and match[1][0]==fence[0]:block.append(line);pars.append("\n".join(block));block=[];fence=None;continue
                    if not fence:
                        if block:pars.append(m.compact(" ".join(block)));block=[]
                        fence=match[1]
                if fence:block.append(line)
                elif not line.strip():
                    if block:pars.append(m.compact(" ".join(block)));block=[]
                else:block.append(line)
            s="\n\n".join(pars);doc=dict(id=key,format="markdown",source=s,raw=s,questions=[]);heads=[];domain="faq"
        doc["sectionStarts"]=[m.units("\n\n".join(pars[:i])+("\n\n" if i else "")) for i in heads]
        if preview:
            (m.CACHE/"mixture-sources"/(key+".txt")).write_text("\n".join(f"{i:03} {p}" for i,p in enumerate(pars)),encoding="utf8")
            print(key,len(pars),m.digest(blob));continue
        assert m.digest(blob)==citations[key]["sha256"],key
        for i,(q,alts) in enumerate(citations[key]["queries"]):
            refs=[]
            for alt in alts:
                ranges=[]
                for pi,quote in alt:
                    if pi is None:
                        candidates=[i for i,p in enumerate(pars) if quote in p];assert len(candidates)==1,(key,quote)
                        pi=candidates[0]
                    assert pars[pi].count(quote)==1,(key,pi,quote)
                    start=sum(len(p)+2 for p in pars[:pi])+pars[pi].index(quote)
                    assert doc["source"][start:start+len(quote)]==quote
                    ranges.append(m.span(doc["source"],start,start+len(quote)))
                refs.append(ranges)
            doc["questions"].append(dict(id=key+"/"+str(i+1),text=q,references=refs))
        groups.setdefault(domain,[]).append(doc)
    for domain,docs in groups.items():m.write(domain+"-fresh",domain,"fresh","collection" if domain=="faq" else "document",docs,{d["id"]:URLS[d["id"]] for d in docs})

if __name__=="__main__":
    import runpy
    prepare(runpy.run_path(str(HERE/"mixture-data.py"))["m"],True)
