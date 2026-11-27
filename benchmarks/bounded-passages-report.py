"""Publish the bounded sweep, the old whole-source exposure audit, and parity checks."""
import collections
import gzip
import json
import runpy
from pathlib import Path

HERE=Path(__file__).resolve().parent
study=runpy.run_path(str(HERE/"bounded-passages.py"))
root,reg,ev,report=study["ROOT"],study["registry"],study["ev"],study["report"]
folds={k:json.loads((root/(k+".json")).read_bytes()) for k in ("development","confirmation","fresh","shared")}
parity=json.loads((root/"parity.json").read_bytes())
protocol=json.loads((HERE/"mixture-protocol.json").read_bytes())
encoder={"model":protocol["model"],"dimensions":protocol["dimension"],"tokenizer":"cl100k_base"}
for fold in folds.values():
    for label,(_,_,max_core,max_window) in fold["cost"].items():
        cap=int(label.split("/")[2])
        assert max_window<=cap if cap else max_window==max_core
        assert fold["firstHitTokens"][label]["max"]<=max_window
for profile,stats in parity["poolCounts"].items():
    assert stats["uniqueEmbeddings"]==folds["shared"]["cost"][f"both2048/{profile}/2048/0"][0]

docs={}; refs={}
for key,meta in reg.items():
    if meta["fold"]!="fresh":continue
    for d in study["shards"](key):
        docs[d["id"]]=d
        for q in d["ix"]["qs"]:
            rs=[(d["id"],r) for r in q.get("references",[q.get("ranges")])]
            rs.extend((a["source"],a["ranges"]) for a in q.get("alternativeSources",[]))
            refs[(d["id"],q["id"])]=rs

def ink(owner,spans):
    o=docs[owner]["o"]
    return ev.union((o[a],o[b]) for a,b in spans)

def historical(hits,rs):
    first_id,ranges=hits[0]; first=ink(first_id,ranges)
    first_size=ev.size(first); one=five=0; f1=0
    for owner,rs0 in rs:
        ref=ink(owner,rs0); total=ev.size(ref)
        a=ev.size(ev.intersect(first,ref)) if first_id==owner else 0
        combined=ev.union(x for doc,sp in hits if doc==owner for x in ink(doc,sp))
        one=max(one,int(a==total))
        five=max(five,int(ev.size(ev.intersect(combined,ref))==total))
        f1=max(f1,2*a/(first_size+total))
    fraction=first_size/max(1,docs[first_id]["o"][-1])
    return [one,five,f1,fraction,int(fraction>=.99)]

old=study["read"](HERE/".cache/document-routing/public/section-ranges.json.gz")
verified=study["read"](root/"verify.json.gz")
historical_rates={}
for pool in ("original","shared"):
    groups=collections.defaultdict(list);longer=collections.defaultdict(list)
    verified_queries={(r["doc"],r["id"]):r["hits"]["both2048/paragraph/2048/0"] for r in verified[pool]}
    same_first=same_five=0
    for r in old["rows"]:
        d=docs[r["doc"]]
        key=(r["doc"],r["id"])
        hits=r["hits"][pool+"/routingOutline/0.15"]
        observation=historical(hits,refs[key])
        observation.append(observation[0]*(1-observation[4]))
        groups[d["domain"]].append(observation)
        if d["ix"]["sourceTokens"]>2048:longer[d["domain"]].append(observation)
        if key in verified_queries:
            previous=[(sid,ink(sid,ranges)) for sid,ranges in hits]
            bounded=[(sid,docs[sid]["ix"]["views"][v]["ink"]) for sid,v in verified_queries[key]]
            same_first+=previous[0]==bounded[0]
            same_five+=previous==bounded
    historical_rates[pool]=dict(all=report["macro"](groups,lambda x:x),long=report["macro"](longer,lambda x:x),
                                compared=len(verified_queries),sameFirst=same_first,sameOrderedFive=same_five)
out=dict(encoder=encoder,fields=study["FIELDS"],costFields=["uniqueServingVectors","candidateCount","maxCoreTokens","maxPassageTokens"],
         key="layout/detail/passageCap/neighborScorePercent. A passage cap of 0 denotes display of just the core.",
         longSourceMinimumExclusive=2048,historicalFields=["complete1","complete5","evidenceF1","firstSourceFraction","wholeSource1","complete1ExcludingWholeHits"],
         historical=historical_rates,apiVerification=parity,folds=folds)
(HERE/"results/2026-11-27-bounded-passages.json").write_text(json.dumps(out,separators=(",",":")),encoding="utf-8")
