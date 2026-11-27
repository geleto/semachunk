"""Prepare the source-addressable narrative and meeting corpora and reviewed controls."""
import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
import zipfile
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = CACHE / "context-retrieval" / "data"
REV = "5aa19180c83713f41ee30c9f1dd99afc2d65aeac"
QMSUM_REV = "83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e"
BOARD = {
    "psf-2009": ("development","https://www.python.org/psf/records/board/minutes/2009-09-14/"),
    "fed-2020": ("development","https://www.federalreserve.gov/monetarypolicy/fomcminutes20200315.htm"),
    "psf-2012": ("confirmation","https://www.python.org/psf/records/board/minutes/2012-03-26/"),
    "fed-2022": ("confirmation","https://www.federalreserve.gov/monetarypolicy/fomcminutes20220615.htm")}
manifest = {}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def compact(s):
    return " ".join(s.split())

def fetch(path,url):
    if not path.exists():
        path.parent.mkdir(parents=True,exist_ok=True)
        req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
        path.write_bytes(urllib.request.urlopen(req,timeout=60).read())
    return path.read_bytes()

def textdoc(key,paragraphs):
    source="\n\n".join(compact(p) for p in paragraphs if compact(p))
    return dict(id=key,raw=source,source=source,format="text",questions=[])

def units(s):
    return len(s.encode("utf-16-le"))//2

def span(s,a,b):
    return [units(s[:a]),units(s[:b])]

def write(key,domain,fold,pool,docs,source):
    data=json.dumps(dict(key=key,domain=domain,fold=fold,pool=pool,docs=docs),ensure_ascii=False,separators=(",",":")).encode()
    (OUT/(key+".json")).write_bytes(data)
    manifest[key]=dict(domain=domain,fold=fold,pool=pool,sha256=digest(data),source=source,
        documents=[dict(id=d["id"],sha256=digest(d["source"].encode()),questions=len(d["questions"])) for d in docs])

def story_parts(story,legacy=False):
    edges=[(a.strip(),b.strip()) for row in story for a,b in zip(row["text"].splitlines(),row["text"].splitlines()[1:]) if a.strip() and b.strip()]
    wrapped=sum(1 for a,b in edges if 52<=len(a)<=85 and re.search(r"[a-zA-Z,]$",a) and re.match(r"[a-z]",b))>=5
    def paragraphs(s):
        return re.split(r"\n[ \t]*\n","\n".join(s.splitlines())) if wrapped and not legacy else s.splitlines()
    return ["\n\n".join(compact(p) for p in paragraphs(row["text"]) if compact(p)) for row in story]

def fiction(legacy=False,splits=(("val","development",23),("test","confirmation",23)),exclude=()):
    path=CACHE/"fairytaleqa-5aa19180.zip"
    url="https://codeload.github.com/neuhai/FairytaleQA_Dataset/zip/"+REV
    blob=fetch(path,url)
    assert digest(blob)=="464949b74cc558b6a08902cd2342c41f0bd3e9d462f78f66312b4f687771c977"
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode("utf-8-sig"))))
        for split,fold,count in splits:
            docs=[]
            names=sorted(n for n in archive.namelist() if "/FairytaleQA_Dataset/split_for_training/"+split+"/" in n and n.endswith("-story.csv"))
            names=[n for n in names if Path(n).name.removesuffix("-story.csv") not in exclude]
            if len(names)>count:names=sorted(names,key=lambda n:digest(Path(n).name.encode()))[:count]
            for name in names:
                story=rows(name)
                key=Path(name).name.removesuffix("-story.csv")
                parts=story_parts(story,legacy)
                doc=textdoc(key,[p for part in parts for p in part.split("\n\n")])
                source=doc["source"]
                positions={}
                offset=0
                for item,part in zip(story,parts,strict=True):
                    assert source[offset:offset+len(part)]==part
                    positions[item["section"].strip()]=(offset,offset+len(part))
                    offset+=len(part)+2
                for q in rows(name.replace("-story.csv","-questions.csv")):
                    ids=re.findall(r"\d+",q["cor_section"])
                    if not ids or not all(i in positions for i in ids) or not q["question"].strip():
                        continue
                    bounds=[positions[i] for i in dict.fromkeys(ids)]
                    exact=[]
                    for j in range(1,7):
                        answer=compact(q.get("answer"+str(j),"") or "").strip(" .!?\"“”")
                        if len(answer.split())<3: continue
                        rx=re.compile(r"(?<!\w)" + r"\s+".join(re.escape(w) for w in answer.split())+r"(?!\w)",re.I)
                        matches=list(rx.finditer(source))
                        if len(matches)==1 and any(a<=matches[0].start() and matches[0].end()<=b for a,b in bounds):
                            choice=[span(source,*matches[0].span())]
                            if choice not in exact: exact.append(choice)
                    sectionrefs=[[span(source,a,b) for a,b in bounds]]
                    doc["questions"].append(dict(id=key+"/"+q["question_id"],text=compact(q["question"]),
                        references=exact or sectionrefs,kind="primary" if exact else "section",attribute=q["attribute1"]))
                docs.append(doc)
            assert len(docs)==count
            write("fiction-"+fold,"fiction",fold,"document",docs,url)

def meetings(splits=(("train","development",3),("test","confirmation",3)),exclude=()):
    hashes={"train":"55964a968e4b4c1c9da2434678f213f3b70c0c3d3cf609f5cd4ecd44cc8d2427",
            "test":"6bcd428211260ad2efae3af76cbaf6a7f5ae4bb5e1e59c45a4b8e89539cb9208",
            "val":"fc7444e241bdbe6997c01720d07f1a58b7357284acb73f909766e5a4700db49f"}
    for split,fold,count in splits:
        path=CACHE/("qmsum-"+split+".jsonl")
        url="https://raw.githubusercontent.com/Yale-LILY/QMSum/"+QMSUM_REV+"/data/ALL/jsonl/"+split+".jsonl"
        data=fetch(path,url)
        assert digest(data)==hashes[split]
        eligible=[]
        for i,line in enumerate(data.splitlines()):
            if f"qmsum-{split}-{i}" in exclude:continue
            m=json.loads(line)
            qs=[]
            for j,q in enumerate(m["specific_query_list"]):
                refs=q["relevant_text_span"]
                if len(refs)==1:
                    a,b=map(int,refs[0])
                    if 0<=a<=b<len(m["meeting_transcripts"]) and b-a<3: qs.append((j,q,a,b))
            eligible.append((-len(qs),i,m,qs))
        docs=[]
        for _,i,m,qs in sorted(eligible,key=lambda x:x[:2])[:count]:
            key=f"qmsum-{split}-{i}"
            turns=[compact(t["speaker"])+": "+compact(t["content"]) for t in m["meeting_transcripts"]]
            doc=textdoc(key,turns)
            start=0; offsets=[]
            for text in turns:
                offsets.append((start+text.index(":")+2,start+len(text)));start+=len(text)+2
            for j,q,a,b in qs:
                evidence=[span(doc["source"],*offsets[k]) for k in range(a,b+1) if offsets[k][0]<offsets[k][1]]
                if evidence: doc["questions"].append(dict(id=key+"/"+str(j),text=compact(q["query"]),references=[evidence]))
            docs.append(doc)
        write("spoken-"+fold,"spoken",fold,"document",docs,url)

class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out=[];self.chars=[]
    def flush(self):
        s=compact("".join(self.chars))
        if s:self.out.append(s)
        self.chars=[]
    def handle_starttag(self,tag,attrs):
        if tag in ("p","li","h1","h2","h3","h4","tr","blockquote","br","div"):self.flush()
    def handle_endtag(self,tag):
        if tag in ("p","li","h1","h2","h3","h4","tr","blockquote","div"):self.flush()
    def handle_data(self,s):self.chars.append(s)

def boards(inspect=False):
    groups={}
    annotations={} if inspect else json.loads((HERE/"context-board-citations.json").read_bytes())
    for key,(fold,url) in BOARD.items():
        raw=fetch(CACHE/"context-boards"/(key+".html"),url).decode("utf-8-sig")
        if key.startswith("psf"):
            intro=raw.index('<div class="minutes-title line-block">')
            toc=raw.index('<div class="contents',intro)
            a=raw.index('<div class="section" id="attendance"')
            end=raw.index("</div>",raw.index('<div class="section" id="adjournment"'))+6
            body=raw[intro:toc]+raw[a:end]
        else:
            body=raw[raw.index('id="article"'):raw.index('id="lastUpdate"')]
            body=body[body.index(">")+1:body.rfind("<div")]
        parser=Paragraphs();parser.feed(body);parser.flush()
        paragraphs=[p.removesuffix(" Return to text") for p in parser.out if p!="Back to Top"]
        doc=textdoc(key,paragraphs)
        if inspect:
            (OUT/(key+".txt")).write_text("\n".join(f"{i:03d} {x}" for i,x in enumerate(paragraphs)),encoding="utf8")
            continue
        assert digest(doc["source"].encode())==annotations[key]["sourceSHA256"]
        for j,(question,choices) in enumerate(annotations[key]["queries"]):
            refs=[]
            for quotes in choices:
                choice=[]
                for index,quote in quotes:
                    assert paragraphs[index].count(quote)==1,(key,quote)
                    a=sum(len(p)+2 for p in paragraphs[:index])+paragraphs[index].index(quote)
                    assert doc["source"][a:a+len(quote)]==quote
                    choice.append(span(doc["source"],a,a+len(quote)))
                refs.append(choice)
            doc["questions"].append(dict(id=key+"/"+str(j+1),text=question,references=refs))
        groups.setdefault(fold,[]).append(doc)
    for fold,docs in groups.items():write("boards-"+fold,"boards",fold,"document",docs,{d["id"]:BOARD[d["id"]][1] for d in docs})

def original():
    edition=json.loads((HERE/"results/2026-11-27-prose-reviewed-data.json").read_bytes())
    for key,meta in edition["sets"].items():
        raw=(CACHE/"prose-reviewed"/(key+".json")).read_bytes()
        assert digest(raw)==meta["sha256"]
        docs=json.loads(raw)
        domain,fold=key.split("-")[:2]
        if not (domain=="faq" or key.endswith("-studentaid-html") or domain=="papers" and key.endswith("-0") or
                domain=="finance" and ("EARNINGS" in key or "_8K" in key) and len(docs[0]["source"])<=90000):continue
        write(key,domain,fold,meta["pool"],docs,edition["correctionSHA256"])

if __name__=="__main__":
    OUT.mkdir(parents=True,exist_ok=True)
    if "boards" in sys.argv:
        boards(True)
    else:
        fiction(legacy="--legacy-fiction" in sys.argv);meetings();original()
        if "preliminary" not in sys.argv: boards()
        name="context-retrieval-manifest.json"
        (OUT/name).write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
        print(sum(len(m["documents"]) for m in manifest.values()),"documents in",len(manifest),"shards")
