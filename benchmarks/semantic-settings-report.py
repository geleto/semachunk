"""Paired threshold curves, source-clustered uncertainty and retrieval failure analysis."""
import gzip
import hashlib
import json
import random
import runpy
import statistics
from collections import defaultdict
from pathlib import Path

HERE=Path(__file__).resolve().parent
run=runpy.run_path(str(HERE/"semantic-settings-run.py"))
OUT,STORE,read=run["OUT"],run["STORE"],run["read"]
SMALL,LARGE=run["SMALL"],run["LARGE"]
METRICS=["complete512","recall512","complete1024","recall1024","completeInOnePassage","completeInFiveUnclipped"]


def paired(rows,method,control="blocks",label=None):
    """Collapse multiple views of a question before clustering all its outcomes under the source."""
    domains=defaultdict(dict)
    for r in rows:
        domain=run["cohort"](r["key"])
        for q,a,b in zip(r["queries"],r["methods"][method]["outcomes"],r["methods"][control]["outcomes"],strict=True):
            if label and q[2]!=label:continue
            row=domains[domain].setdefault(q[0],(q[1],[],[]))
            assert row[0]==q[1]
            row[1].append(a);row[2].append(b)
    result={}
    for domain,obs in domains.items():
        result[domain]=[(cluster,[statistics.mean(v) for v in zip(*a)],[statistics.mean(v) for v in zip(*b)])
                        for cluster,a,b in obs.values()]
    return result


def interval(domains, confidence):
    rng=random.Random(20261126)
    clusters=[]
    for rows in domains.values():
        sums=defaultdict(lambda:[0,0])
        for group,a,b in rows:
            sums[group][0]+=a[0]-b[0]
            sums[group][1]+=1
        clusters.append(list(sums.values()))
    samples=[]
    for _ in range(4000):
        deltas=[]
        for groups in clusters:
            draw=rng.choices(groups,k=len(groups))
            deltas.append(sum(t[0] for t in draw)/sum(t[1] for t in draw))
        samples.append(100*statistics.mean(deltas))
    samples.sort()
    tail=(1-confidence)/2
    return [round(samples[int((len(samples)-1)*p)],3) for p in (tail,1-tail)]


def group_score(obs):
    return {name:round(statistics.mean(a[i] for _,a,_ in obs),6) for i,name in enumerate(METRICS)}


def summarize(rows,method):
    groups=paired(rows,method)
    metrics={domain:group_score(obs) for domain,obs in groups.items()}
    return {"macro":{key:round(statistics.mean(v[key] for v in metrics.values()),6) for key in METRICS},
            "domains":metrics,"chunkCount":sum(r["methods"][method]["packets"] for r in rows),
            "selectionTokens":sum(r["methods"][method]["selectionTokens"] for r in rows),
            "indexTokens":sum(r["methods"][method]["indexTokens"] for r in rows),
            "oversizedOmitted":sum(r["methods"][method]["overLimit"] for r in rows),
            "boundariesMoved":sum(r["methods"][method]["moved"] for r in rows)}


def cell(rows,method,kind=None):
    q=next(iter(paired(rows,method,label=kind).values()))
    gains=sum(a[0]==1 and b[0]==0 for _,a,b in q)
    losses=[(a,b) for _,a,b in q if a[0]==0 and b[0]==1]
    return {"questions":len(q),"clusters":len({r[0] for r in q}),
            "complete":round(sum(a[0] for _,a,_ in q)),"gains":gains,"losses":len(losses),
            "lossesMissingFromTopFive":sum(a[5]==0 for a,b in losses),
            "lossesClippedAt512":sum(a[5]==1 for a,b in losses),
            "lossesAlsoLosingOnePassageCoverage":sum(a[4]==0 and b[4]==1 for a,b in losses),**group_score(q)}


def detail(rows,names):
    groups=defaultdict(list)
    for r in rows:
        key=r["key"]; kind=run["cohort"](key)
        if kind=="government": groups["government-"+key.rsplit("-",1)[1]].append(r)
        elif kind=="faq":groups[key].append(r)
        else:groups[kind].append(r)
    by={k:{m:cell(rr,m) for m in names} for k,rr in groups.items()}
    for k in ("table","text","table+text"):
        by["finance-"+k]={m:cell(groups["finance"],m,k) for m in names}
    return by


def previous_finance():
    original=read(OUT/"2026-11-26-semantic-blocks-cutoffs.json")["retrieval"]["heldout"]["finqa"]
    replay=read(HERE/".cache/tree-corpus/regression/finqa.json")
    files=set(original["sample"]["documents"])
    raw=read(HERE/".cache/finqa-test.json")
    lengths={r["filename"]:len(r["table"])-1 for r in raw if r["filename"] in files}
    base=replay["tree"]["hits"]["document/dense"]["five512"]
    candidate=replay["0.15"]["hits"]["document/dense"]["five512"]
    assert len(base)==len(candidate)==len(original["groups"])
    return {"questions":len(base),"pages":len(files),"reports":len(set(original["groups"])),
            "dataRowsPerTable":[min(lengths.values()),statistics.median(lengths.values()),max(lengths.values())],
            "blocks":base.count("1"),"semanticBlocks015":candidate.count("1"),
            "gains":sum(x=="1" and y=="0" for x,y in zip(candidate,base)),
            "losses":sum(x=="0" and y=="1" for x,y in zip(candidate,base))}


def verify_archive(rows, historic):
    n=0
    for r in rows:
        if r["key"] not in historic:continue
        old=historic[r["key"]]
        previous={q[0]:i for i,q in enumerate(old["queries"])}
        for new,original in [("semantic/shipped","semantic"),("semantic-blocks/0.15","0.15"),("blocks","tree")]:
            for q,v in zip(r["queries"],r["methods"][new]["outcomes"],strict=True):
                ref=old["results"][original]["values"][previous[q[0]]]
                assert v[:4]==[round(x,6) for x in ref],(r["key"],new,q[0],v,ref)
                n+=1
    return n


def main():
    protocol=read(run["PROTOCOL"]); manifest=read(run["MANIFEST"]); fit=read(run["FREEZE"])
    keys=list(manifest["sets"])
    confirmed=[k for k in keys if "-development-" not in k]
    dev=[k for k in keys if "-development-" in k and run["primary"](k)]
    methods=list(fit["development"])
    locked=list(dict.fromkeys(protocol["controls"]+list(fit["selection"].values())))
    size_fit=read(OUT/"2026-11-26-semantic-settings-sizes.json")
    report={"protocol":protocol,"model":SMALL,"developmentNominees":fit["selection"],"sizeSelection":size_fit,
            "previousFinQA":previous_finance(),"profiles":{},"grid":{},"comparisons":{}}
    archive=OUT/"2026-11-26-semantic-settings-outcomes.jsonl.gz"
    tmp=archive.with_suffix(".tmp")
    checked=0; new_tokens=0; rawcount=0
    oldpath=OUT/"2026-11-26-tree-outcomes.jsonl.gz"
    with gzip.open(oldpath,"rt",encoding="utf8") as f:
        historic={r["key"]:r for line in f if (r:=json.loads(line))["model"]==SMALL and r["mode"]=="tokens" and r["queries"]}
    with tmp.open("wb") as out,gzip.GzipFile(filename="",fileobj=out,mode="wb",mtime=0) as gz:
        for phase,model,cap,group in [("development",SMALL,128,dev),("development",SMALL,256,dev),("development",SMALL,512,dev),("confirmation",SMALL,256,confirmed),
                ("confirmation",SMALL,128,confirmed),("confirmation",SMALL,512,confirmed),
                ("transfer",LARGE,256,[k for k in confirmed if run["transfer"](k)])]:
            rows=run["profile"](group,cap,model)
            for r in rows:
                assert r["dataSHA256"]==manifest["sets"][r["key"]]["sha256"]
                assert all(len(v["outcomes"])==len(r["queries"]) for v in r["methods"].values())
                gz.write((json.dumps(r,separators=(",",":"),ensure_ascii=False)+"\n").encode())
                rawcount+=1;new_tokens+=r["newTokens"]
            primary=[r for r in rows if run["primary"](r["key"])]
            field=f"{phase}/{model}/{cap}"
            names=methods if phase in ("development","confirmation") and cap==256 else locked
            report["profiles"][field]={"questionsByDomain":{k:len(v) for k,v in paired(primary,"blocks").items()},
                "methods":{m:summarize(primary,m) for m in names},"subgroups":detail(rows,locked)}
            if phase=="confirmation" and cap!=256:
                methods_at_size=report["profiles"][field]["methods"]
                report.setdefault("sizeComparisons",{})[str(cap)]={m:{
                    "deltaPoints":round(100*(methods_at_size[m]["macro"]["complete512"]-methods_at_size["blocks"]["macro"]["complete512"]),3),
                    "descriptiveInterval":interval(paired(primary,m),.95)} for m in locked if m!="blocks"}
            if model==SMALL and cap==256:
                checked+=verify_archive(rows,historic)
            if phase=="confirmation" and cap==256:
                result=report["profiles"][field]["methods"]
                flat=fit["selection"]["semantic"]
                report["withinSemantic"]={"nominee":flat,"control":"semantic/shipped",
                    "deltaPoints":round(100*(result[flat]["macro"]["complete512"]-result["semantic/shipped"]["macro"]["complete512"]),3),
                    "paired95":interval(paired(primary,flat,"semantic/shipped"),.95)}
                for m in set(locked)-{"blocks"}:
                    group_obs=paired(primary,m)
                    delta=100*(result[m]["macro"]["complete512"]-result["blocks"]["macro"]["complete512"])
                    report["comparisons"][m]={"deltaPoints":round(delta,3),
                                              "adjustedInterval":interval(group_obs,1-.05/3)}
                # The government and original FAQ confirmation folds had appeared in the previous report.
                fresh=[r for r in primary if r["key"].startswith(("finance-","papers-","faq-fresh-"))]
                report["previouslyUnused"]={m:summarize(fresh,m) for m in locked}
                report["matchedSmallTransfer"]={m:summarize([r for r in primary if run["transfer"](r["key"])],m) for m in locked}
                report["financialCutoffs"]={c:{m:cell([r for r in primary if r["key"].startswith("finance-")],m,c)
                                         for m in names} for c in ["text","table","table+text"]}
                for family in ("semantic","semantic-blocks"):
                    grid=[m for m in names if m.startswith(family+"/")]
                    report["grid"][family]={}
                    for domain in result["blocks"]["domains"]:
                        choice=min(grid,key=lambda m:(-fit["development"][m]["domains"][domain],
                                                      fit["development"][m]["selectionTokens"]))
                        obs=paired([r for r in primary if run["cohort"](r["key"])==domain],choice)
                        report["grid"][family][domain]={"developmentChoice":choice,
                            "heldoutScore":result[choice]["domains"][domain]["complete512"],
                            "blocksScore":result["blocks"]["domains"][domain]["complete512"],
                            "descriptiveInterval":interval(obs,.95)}
                dev_rows=run["profile"](dev,256,SMALL)
                by_format={}
                for fmt in ("html","text","markdown"):
                    rr=[r for r in rows if r["key"].startswith("government-") and r["key"].endswith("-"+fmt)]
                    dd=[r for r in dev_rows if r["key"].startswith("government-") and r["key"].endswith("-"+fmt)]
                    by_format[fmt]={}
                    for family in ("semantic","semantic-blocks"):
                        grid=[m for m in names if m.startswith(family+"/")]
                        choice=min(grid,key=lambda m:(-run["means"](dd,m)["government"],sum(r["methods"][m]["selectionTokens"] for r in dd)))
                        by_format[fmt][family]={"developmentChoice":choice,"outcome":cell(rr,choice),
                                                "descriptiveInterval":interval(paired(rr,choice),.95)}
                    for m in locked:
                        by_format[fmt][m]={"outcome":cell(rr,m),"descriptiveInterval":interval(paired(rr,m),.95)}
                report["governmentByFormat"]=by_format
        topics={}
        for key,n,width in [("wiki-confirmation",718,24),("meetings-confirmation",162,5)]:
            shards=[read(STORE/"topics"/f"{key}.{i}.json") for i in range((n+width-1)//width)]
            assert n==len({doc for r in shards for doc in r["documents"]})
            for r in shards:
                gz.write((json.dumps(r,separators=(",",":"))+"\n").encode())
                new_tokens+=r["newTokens"]
            topics[key]={}
            for name in shards[0]["methods"]:
                pred,tp,gold,unknown=map(sum,zip(*(v for r in shards for v in r["methods"][name])))
                topics[key][name]={"documents":n,"gold":gold,"predicted":pred,"hits":tp,"unscored":unknown,
                    "precision":tp/pred if pred else 0,"recall":tp/gold,"f1":2*tp/(gold+pred)}
        report["topics"]=topics
        regressions={}
        for task in ("squad","wikisection","finqa","qasper","cuad","hotpotqa","friendsqa","qmsum"):
            original=read(STORE/"regression"/(task+".json"))
            assert original["selection"]==fit["selection"]
            gz.write((json.dumps(original,separators=(",",":"))+"\n").encode())
            regressions[task]={}
            for m,row in original["rows"].items():
                if task in ("squad","wikisection"):
                    metric="answerHit256" if task=="squad" else "boundaryF1"
                    value=row["hitRate" if task=="squad" else "f1"]
                else:
                    metric="tokenRecall512" if task=="qmsum" else "complete512"
                    value=statistics.mean(v["five512"]["recall"] if task=="qmsum" else
                        v["five512"]["complete"]/len(row["hits"][pool]["five512"]) for pool,v in row["retrieval"].items())
                regressions[task][m]={"metric":metric,"score":round(value,6),"chunks":row["chunks"]}
        report["historicalRegression"]=regressions
    sizes=size_fit["sizes"]
    base_rows=run["profile"]([k for k in confirmed if run["primary"](k)],sizes["blocks"],SMALL)
    report["tunedSizes"]={}
    for m in locked:
        rows=run["profile"]([k for k in confirmed if run["primary"](k)],sizes[m],SMALL)
        compared=[]
        for r,b in zip(rows,base_rows,strict=True):
            assert r["queries"]==b["queries"] and r["key"]==b["key"]
            compared.append({**r,"methods":{m:r["methods"][m],"sizeTunedBlocks":b["methods"]["blocks"]}})
        obs=paired(compared,m,"sizeTunedBlocks")
        delta=statistics.mean(statistics.mean(a[0]-b[0] for _,a,b in v) for v in obs.values())
        report["tunedSizes"][m]={"size":sizes[m],"deltaPoints":100*delta,
                                 "pairedInterval":interval(obs,1-.05/3)}
    tmp.replace(archive)
    report.update(retrievalRuns=rawcount,previousOutcomesReproduced=checked,newEmbeddingTokens=new_tokens,
                  archiveSHA256=hashlib.sha256(archive.read_bytes()).hexdigest())
    (OUT/"2026-11-26-semantic-settings.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf8",newline="\n")
    print(rawcount,"retrieval runs,",checked,"archived outcomes verified,",new_tokens,"new embedding tokens")


if __name__=="__main__":main()
