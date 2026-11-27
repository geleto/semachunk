"""Freeze development winners or summarize the independent ranking and delivery comparisons."""
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE/".cache/context-retrieval"
OUT=HERE/"results"
STEM="2026-11-27-context-retrieval"
MANIFEST=json.loads((ROOT/"data/context-retrieval-manifest.json").read_bytes())
DOMAINS=("fiction","spoken","boards","papers","faq","government","finance")

def write(tag,data):
    (OUT/(STEM+"-"+tag+".json")).write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n",encoding="utf8",newline="\n")

def load(fold,parent=False):
    for key,meta in MANIFEST.items():
        if meta["fold"]!=fold:continue
        doc=json.loads(gzip.decompress((ROOT/("parent-scores" if parent else "scores")/(key+".json.gz")).read_bytes()))
        assert doc["inputSHA256"]==meta["sha256"]
        yield doc

def cohort(shards,kind):
    rows=[];values=[];names=None
    for shard in shards:
        for q in shard["queries"]:
            if q["kind"]!=kind:continue
            if names is None:names=list(q["methods"])
            assert list(q["methods"])==names
            rows.append((shard["domain"],q["doc"],q["id"],shard["key"],q["pool"]))
            values.append([v[:5] for v in q["methods"].values()])
    arr=np.asarray(values,dtype=float)
    groups={d:np.array([i for i,r in enumerate(rows) if r[0]==d],dtype=int) for d in DOMAINS}
    by_domain={k:arr[ix].mean(axis=0) for k,ix in groups.items() if len(ix)}
    macro=np.mean(list(by_domain.values()),axis=0)
    return dict(names=names,rows=rows,arr=arr,groups=groups,domains=by_domain,macro=macro)

def family(name):return "semantic" if name.startswith(("tree","sentence")) else "blocks"

def nominees(c):
    out={}
    for group in ("blocks","semantic","sentence","bare-blocks","bare-semantic","embedding-only-blocks","embedding-only-semantic"):
        candidates=[i for i,n in enumerate(c["names"]) if (n.startswith("sentence") if group=="sentence" else family(n)==group.split("-")[-1])
            and (not group.startswith("bare-") or n.endswith("/base"))
            and (not group.startswith("embedding-only") or n.endswith(("/base","/core")))]
        for metric,j in (("five",1),("focus",2)):
            best=min(candidates,key=lambda i:(-round(c["macro"][i,j],10),not c["names"][i].endswith("/base"),i))
            out[group+"-"+metric]=c["names"][best]
    return out

def paired(c,a,b):
    i=c["names"].index(a);j=c["names"].index(b)
    delta=c["arr"][:,i,:3]-c["arr"][:,j,:3]
    rng=np.random.default_rng(47581);reps=4000
    draws=np.zeros((reps,3)); per={}
    for d,ix in c["groups"].items():
        docs=sorted({c["rows"][n][1] for n in ix})
        groups=[delta[[n for n in ix if c["rows"][n][1]==doc]] for doc in docs]
        picked=rng.integers(len(groups),size=(reps,len(groups)))
        tot=np.asarray([g.sum(axis=0) for g in groups])[picked].sum(axis=1)
        count=np.asarray([len(g) for g in groups])[picked].sum(axis=1)
        draws+=tot/count[:,None]/len(c["groups"])
        per[d]=dict(gain5=int((delta[ix,1]>0).sum()),loss5=int((delta[ix,1]<0).sum()))
    return dict(methods=[a,b],interval95=np.quantile(draws,[.025,.975],axis=0).T.tolist(),domains=per)

def results(c):
    return {name:dict(macro=c["macro"][i].tolist(),domains={d:v[i].tolist() for d,v in c["domains"].items()})
            for i,name in enumerate(c["names"])}

def select():
    c=cohort(load("development"),"primary")
    write("nominees",dict(methods=nominees(c),protocolSHA256=hashlib.sha256((HERE/"context-retrieval-protocol.json").read_bytes()).hexdigest(),
                          shards={k:m["sha256"] for k,m in MANIFEST.items() if m["fold"]=="development"}))
    print(json.dumps(nominees(c)))

def parent_nominees(c):
    winners={}
    for group in ("structural","atoms","semantic"):
        candidates=[i for i,n in enumerate(c["names"]) if n.endswith("/base") or
                    (group=="atoms" and "/atoms/" in n) or (group=="semantic" and "/sentence" in n)]
        for label,column in (("focus",2),("five",1)):
            i=min(candidates,key=lambda i:(-round(c["macro"][i,column],10),not c["names"][i].endswith("/base"),i))
            winners[group+"-"+label]=c["names"][i]
    return winners

def parent_report(select_only):
    dev=cohort(load("development",True),"primary")
    selected=parent_nominees(dev)
    if select_only:
        write("parent-nominees",dict(methods=selected,protocolSHA256=hashlib.sha256((HERE/"context-parent-protocol.json").read_bytes()).hexdigest()))
        print(json.dumps(selected));return
    assert selected==json.loads((OUT/(STEM+"-parent-nominees.json")).read_bytes())["methods"]
    held=cohort(load("confirmation",True),"primary")
    pairs=[(selected["semantic-"+m],selected[group+"-"+m]) for group in ("structural","atoms") for m in ("focus","five")]
    pairs.extend((selected["atoms-"+m],selected["atoms-"+m].split("/")[0]+"/base") for m in ("focus","five"))
    archive=OUT/(STEM+"-parent-outcomes.jsonl.gz")
    checks=0
    with archive.open("wb") as raw,gzip.GzipFile(fileobj=raw,mode="wb",filename="",mtime=0) as out:
        for fold in ("development","confirmation"):
            for s,original in zip(load(fold,True),load(fold),strict=True):
                assert s["key"]==original["key"]
                for q,old in zip(s["queries"],original["queries"],strict=True):
                    assert q["id"]==old["id"]
                    for method in ("head256/base","blocks256/base"):
                        assert q["methods"][method]==old["methods"][method];checks+=1
                out.write(json.dumps(s,ensure_ascii=False,separators=(",",":")).encode()+b"\n")
    write("parent-results",dict(nominees=selected,dev=results(dev),confirmation=results(held),
        comparisons=[paired(held,a,b) for a,b in dict.fromkeys(pairs) if a!=b],
        unchangedParentChecks=checks,archiveSHA256=hashlib.sha256(archive.read_bytes()).hexdigest()))

def report():
    lock=json.loads((OUT/(STEM+"-nominees.json")).read_bytes())
    dev=cohort(load("development"),"primary")
    assert nominees(dev)==lock["methods"]
    shards=list(load("confirmation")); held=cohort(shards,"primary");sections=cohort(shards,"section")
    methods=lock["methods"]
    pairs=[(methods["semantic-"+m],methods["blocks-"+m]) for m in ("focus","five")]
    pairs += [(methods["semantic-focus"],methods["bare-semantic-focus"]),
              (methods["embedding-only-semantic-focus"],methods["embedding-only-blocks-focus"])]
    n=methods["semantic-focus"]
    pairs.extend([(n,n.split("/")[0]+"/base"),(n,methods["bare-blocks-focus"])])
    for a,b in (("adjacent/embed/expanded","base"),("adjacent/embed/core","base"),
                ("adjacent/raw/expanded","base"),("keep/embed/expanded","skip/embed/expanded"),
                ("adjacent/guard/expanded","adjacent/embed/expanded"),("facets/embed/expanded","similar/embed/expanded")):
        pairs.append(("sentence55/"+a,"sentence55/"+b))
    totals={"strictCores":0,"adjacentChanges":0,"adjacentGuardFallbacks":0,"bridgeCores":0,"unlimitedExhaustedQueries":0}
    for s in shards:
        for stat in s["stats"].values():
            if stat:
                t=stat["sentence55"]
                totals["strictCores"]+=t["count"]
                totals["adjacentChanges"]+=t["context"]["adjacent"][0]
                totals["adjacentGuardFallbacks"]+=t["context"]["adjacent"][1]
                totals["bridgeCores"]+=t["context"]["skip"][0]
        totals["unlimitedExhaustedQueries"]+=sum(q["kind"]=="primary" and s["stats"][q["pool"]]["blocksInf"]["exhausted"] for q in s["queries"])
    with gzip.open(OUT/"2026-11-27-prose-threshold-outcomes.jsonl.gz","rt",encoding="utf8") as f:
        prev={r["key"]:{q["id"]:q["methods"] for q in r["queries"]} for line in f for r in [json.loads(line)] if r["key"] in MANIFEST}
    control_checks=0; max_f1_difference=0
    archive=OUT/(STEM+"-outcomes.jsonl.gz")
    with archive.open("wb") as raw,gzip.GzipFile(fileobj=raw,mode="wb",filename="",mtime=0) as out:
        for ds in (load("development"),shards):
            for s in ds:
                if s["key"] in prev:
                    for q in s["queries"]:
                        for a,b in (("blocks256","ordinary/256/blocks"),("head256","sections/256/blocks"),
                                    ("blocksInf","ordinary/unlimited/blocks"),("tree40","ordinary/unlimited/0.4")):
                            x,y=q["methods"][a+"/base"],prev[s["key"]][q["id"]][b]
                            assert x[:2]==y[:2],(q["id"],a)
                            max_f1_difference=max(max_f1_difference,abs(x[2]-y[2])); control_checks+=1
                out.write(json.dumps(s,ensure_ascii=False,separators=(",",":")).encode()+b"\n")
    assert max_f1_difference<=.00001,max_f1_difference
    write("results",dict(fields=["complete1","complete5","firstF1","recall5","meanFirstNonwhiteCharacters"],
        dev=results(dev),confirmation=results(held),fictionSectionConfirmation=results(sections),
        nominees=methods,comparisons=[paired(held,a,b) for a,b in dict.fromkeys(pairs) if a!=b],
        confirmationN={d:len(ix) for d,ix in held["groups"].items()},developmentN={d:len(ix) for d,ix in dev["groups"].items()},
        exactOriginalCoverageChecks=control_checks,maxOriginalFocusDifference=max_f1_difference,diagnostics=totals,
        archiveSHA256=hashlib.sha256(archive.read_bytes()).hexdigest()))
    write("manifest",MANIFEST)

def inspect(qid,names):
    for fold in ("development","confirmation"):
        for shard in load(fold,any(n.split("/")[-1] in ("0.5","1") for n in names)):
            qs=[q for q in shard["queries"] if q["id"]==qid]
            if not qs:continue
            q=qs[0]
            docs=json.loads((ROOT/"data"/(shard["key"]+".json")).read_bytes())["docs"]
            choices=[];base=0
            for i,d in enumerate(docs):
                if q["pool"]!="collection" and q["doc"]!=d["id"]:continue
                idx=json.loads(gzip.decompress((ROOT/"indexes"/shard["key"]/(str(i)+".json.gz")).read_bytes()))
                choices.append((base,idx));base+=len(idx["cores"])
            print(q["id"],q["text"])
            for name in names:
                hit=q["methods"][name]
                begin,idx=next((b,k) for b,k in choices if b<=hit[5]<b+len(k["cores"]))
                c=idx["cores"][hit[5]-begin]
                mode=name.split("/")
                shown=c["ext"][mode[1]] if mode[-1]=="expanded" else c
                print("\n",name,idx["id"],"complete1 / complete5 / F1",hit[:3],"nonwhite chars",hit[4])
                print(idx["texts"][shown["v"]])
            return
    raise ValueError("Unknown question: "+qid)

if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf8")
    if sys.argv[1]=="select":select()
    elif sys.argv[1]=="report":report()
    elif sys.argv[1]=="select-parent":parent_report(True)
    elif sys.argv[1]=="report-parent":parent_report(False)
    elif sys.argv[1]=="inspect":inspect(sys.argv[2],sys.argv[3:])
    else:raise SystemExit("Expected select, report or inspect")
