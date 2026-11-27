"""Build a separate study edition and audit every historical fiction citation."""
import argparse, bisect, importlib.util, io, json, re, tarfile, tempfile, zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
def module(path):
    spec=importlib.util.spec_from_file_location(path,HERE/(path+".py"))
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj)
    return obj
m=module("context-retrieval-data")
ROOT=m.CACHE/"context-mixtures"
OLD=m.OUT
m.OUT=ROOT/"data"
def ordinal(s):
    offsets=[0]
    for c in s:
        for _ in range(2 if ord(c)>65535 else 1):offsets.append(offsets[-1]+int(not c.isspace()))
    return offsets

def audit(legacy):
    log={}
    for fold in ["development","confirmation"]:
        file="fiction-"+fold+".json"
        historical=json.loads((HERE/"results/2026-11-27-context-retrieval-manifest.json").read_bytes())
        blob=(legacy/file).read_bytes();assert m.digest(blob)==historical["fiction-"+fold]["sha256"]
        before=json.loads(blob)["docs"]
        after=json.loads((m.OUT/file).read_bytes())["docs"]
        stats=dict(documents=0,questions=0,primary=0,changed=0,changedPrimary=0)
        for a,b in zip(before,after,strict=True):
            assert a["id"]==b["id"] and "".join(a["source"].split())=="".join(b["source"].split())
            old,new=ordinal(a["source"]),ordinal(b["source"])
            changed=a["source"]!=b["source"];stats["documents"]+=1;stats["changed"]+=changed
            for q,r in zip(a["questions"],b["questions"],strict=True):
                assert {k:v for k,v in q.items() if k!="references"}=={k:v for k,v in r.items() if k!="references"}
                def project(query,mapping):
                    return [[(mapping[x],mapping[y]) for x,y in choice] for choice in query["references"]]
                assert project(q,old)==project(r,new),(a["id"],q["id"])
                stats["questions"]+=1;stats["primary"]+=q["kind"]=="primary"
                stats["changedPrimary"]+=changed and q["kind"]=="primary"
        log[fold]=stats
    return log

def papers(fold="fresh",count=18,exclude=()):
    url="https://qasper-dataset.s3.us-west-2.amazonaws.com/qasper-test-and-evaluator-v0.3.tgz"
    blob=m.fetch(m.CACHE/"qasper-test.tgz",url)
    assert m.digest(blob)=="72a52a41193e2838b8074f80ac074b94f956b84886c36a61c58a7df4171bdd72"
    with tarfile.open(fileobj=io.BytesIO(blob)) as t:rows=json.load(t.extractfile("qasper-test-v0.3.json"))
    docs=[]
    for key in sorted((k for k in rows if k not in exclude),key=lambda k:m.digest(k.encode()))[:count]:
        row=rows[key]; paragraphs=[];pos={}
        def add(value,prefix=""):
            s=m.compact(value or "")
            if not s:return
            a=sum(len(p)+2 for p in paragraphs)+len(prefix);paragraphs.append(prefix+s)
            pos.setdefault(s,[]).append((a,a+len(s)))
        add(row["title"],"# ");add(row["abstract"]);old=[]
        for section in row["full_text"]:
            path=(section["section_name"] or "").split(" ::: ");common=0
            while common<min(len(old),len(path)-1) and old[common]==path[common]:common+=1
            for i in range(common,len(path)):add(path[i],"#"*min(6,i+2)+" ")
            old=path
            for p in section["paragraphs"]:add(p)
        if row["figures_and_tables"]:add("Captions","## ")
        for f in row["figures_and_tables"]:add(f["caption"])
        doc=m.textdoc(key,paragraphs);doc["format"]="markdown";s=doc["source"]
        for qa in row["qas"]:
            refs=[]
            for item in qa["answers"]:
                ans=item["answer"];ev=[pos.get(m.compact(e),[]) for e in ans["evidence"]]
                if ans["unanswerable"] or not ev or not all(len(p)==1 for p in ev):continue
                bounds=[p[0] for p in ev];exact=[]
                for phrase in ans.get("extractive_spans",[]):
                    phrase=m.compact(phrase)
                    if not phrase:continue
                    hits=[(a+match.start(),a+match.end()) for a,b in bounds for match in re.finditer(re.escape(phrase),s[a:b],re.I)]
                    if len(hits)!=1:exact=[];break
                    exact.extend(hits)
                ref=[m.span(s,a,b) for a,b in (exact or bounds)]
                if ref not in refs:refs.append(ref)
            if refs:doc["questions"].append(dict(id=qa["question_id"],text=m.compact(qa["question"]),references=refs))
        docs.append(doc)
    m.write("papers-"+fold,"papers",fold,"document",docs,url)

def government():
    url="https://raw.githubusercontent.com/doc2dial/doc2dial.github.io/30fa02bacefca711cc4503f118cc50365225e9b9/file/doc2dial_v1.0.1.zip"
    blob=m.fetch(m.CACHE/"doc2dial-v1.0.1.zip",url)
    assert m.digest(blob)=="94499fa5259f69018d2458cb948552e7a05f424711a95a562bb9e816a515dc23"
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        pages=json.loads(z.read("doc2dial_doc.json"))["doc_data"]
        dialogues=json.loads(z.read("doc2dial_dial_validation.json"))["dial_data"]
    docs=[]
    for agency in ["ssa","va","dmv"]:
        used=set()
        for key in sorted(dialogues[agency],key=lambda k:m.digest(k.encode())):
            title=key.split("#")[0]
            if title in used:continue
            page=pages[agency][key];s=page["doc_text"];doc=m.textdoc(key,s.splitlines())
            old,new=ordinal(s),ordinal(doc["source"])
            assert "".join(s.split())=="".join(doc["source"].split())
            for conv in dialogues[agency][key]:
                if len(conv["turns"])<2:continue
                q,a=conv["turns"][:2]
                if q["role"]!="user" or a["da"]!="respond_solution" or len(q["utterance"].split())<5:continue
                spans=[page["spans"][r["sp_id"]] for r in a["references"] if r["label"]=="solution"]
                if not spans or not all(s[t["start_sp"]:t["end_sp"]]==t["text_sp"] for t in spans):continue
                # Keep the annotated visible solution, excluding outer whitespace.
                bounds=[m.span(s,t["start_sp"]+len(t["text_sp"])-len(t["text_sp"].lstrip()),t["start_sp"]+len(t["text_sp"].rstrip())) for t in spans if t["text_sp"].strip()]
                bounds=[[bisect.bisect_right(new,old[a])-1,bisect.bisect_left(new,old[b])] for a,b in bounds]
                if bounds:doc["questions"].append(dict(id=conv["dial_id"],text=q["utterance"],references=[bounds]))
            if doc["questions"]:
                docs.append(doc);used.add(title)
            if len(used)==5:break
    # Review is based on the utterance and annotated response. Keep all fifteen
    # original pages as search candidates, including pages with no usable query.
    unspecified={"e6e7406882ff44ee12c2c9f5d638af42","d3d0da70b19d88ac7215e2ee02909f81",
                 "ea559c251050aba66145ed885fc95dc1","cf19e7f490fc982157685b9da264b6cd"}
    for doc in docs:
        unique={}
        for q in sorted(doc["questions"],key=lambda x:(len(x["text"]),x["id"])):
            if q["id"] not in unspecified:unique.setdefault(str(q["references"]),q)
        doc["questions"]=sorted(unique.values(),key=lambda q:q["id"])
    m.write("government-fresh","government","fresh","collection",docs,url)

def run(curated):
    m.OUT.mkdir(parents=True,exist_ok=True)
    if curated:
        import runpy
        runpy.run_path(str(HERE/"mixture-curated.py"))["prepare"](m)
        manifest=json.loads((m.OUT/"manifest.json").read_bytes())
        manifest.update(m.manifest);m.manifest=manifest
    else:
        m.fiction(splits=(("val","development",23),("test","confirmation",23),("train","fresh",24)))
        m.meetings(splits=(("train","development",3),("test","confirmation",3),("val","fresh",6)))
        m.original();m.boards();papers();government()
        with tempfile.TemporaryDirectory() as tmp:
            output,registry=m.OUT,m.manifest
            try:
                m.OUT,m.manifest=Path(tmp),{};m.fiction(legacy=True)
            finally:m.OUT,m.manifest=output,registry
            (m.OUT/"fiction-audit.json").write_text(json.dumps(audit(Path(tmp)),indent=2)+"\n")
    ids={}; hashes={}
    for key,entry in m.manifest.items():
        for doc in entry["documents"]:
            existing=hashes.setdefault(doc["sha256"],entry["fold"])
            assert existing==entry["fold"],(doc["id"],existing,entry["fold"])
            if entry["domain"] in ("fiction","spoken","papers"):
                prior=ids.setdefault(doc["id"],entry["fold"])
                assert prior==entry["fold"]
    (m.OUT/"manifest.json").write_text(json.dumps(m.manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(len(m.manifest),"pools",sum(len(x["documents"]) for x in m.manifest.values()),"documents",flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--curated",action="store_true");run(p.parse_args().curated)
