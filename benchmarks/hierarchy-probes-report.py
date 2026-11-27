"""Report paired evidence, the number of distinct indexed texts, and matched null controls."""
import collections
import json
import runpy
from pathlib import Path

import numpy as np

HERE=Path(__file__).resolve().parent
study=runpy.run_path(str(HERE/"hierarchy-probes.py"))
earlier=runpy.run_path(str(HERE/"query-parents-report.py"))
OUT,reg,read=study["OUT"],study["registry"],study["read"]
paired,macro=earlier["paired"],earlier["macro"]
SEEDS=study["SEEDS"]


def metric(r,n):return r["metrics"][n]


def vector_cost(docs,plan):
    tables={k:{} for k in ("core","paragraph","middle","leaf","all","routed","frontier")}
    relations=collections.Counter()
    for doc in docs:
        hashes,tokens=doc["hashes"],doc["tokens"]
        group={k:set(v) for k,v in doc["cost"][plan].items()}
        pools=dict(core=group["core"],paragraph=group["core"]|group["paragraph"],middle=group["core"]|group["middle"],
                   leaf=group["core"]|group["leaf"],all=group["core"]|group["leaf"]|group["middle"],
                   routed=set.union(*group.values()),frontier=group["core"]|group["frontier"])
        for k,ids in pools.items():
            tables[k].update((hashes[i],tokens[i]) for i in ids)
        relations.update(doc["roles"][plan])
    return dict(roles=relations,cost={k:dict(uniqueTexts=len(t),inputTokens=sum(t.values()),float32MiB=len(t)*6144/(1024**2))
                                      for k,t in tables.items()})


def bounds(groups,a,b):
    return paired(groups,a,b,metric)


def add_controls(rows):
    for base in ("flat40","joined","tree"):
        for mode in ("inside","lengths"):
            for label in ("core/bare","leaf/bare","core/window","leaf/window"):
                name=f"{base}-{mode}/{label}"
                for r in rows:
                    r["metrics"][name]=np.mean([metric(r,f"{base}-{mode}-{seed}/{label}") for seed in SEEDS],axis=0)


def summarize():
    output={}; chosen={}
    for fold in ("development","confirmation","fresh"):
        groups=collections.defaultdict(list); docs=[]; domain_by_id={}
        for key,meta in reg.items():
            if meta["fold"]!=fold:continue
            rows=read(OUT/"scores"/(key+".json.gz")); layouts=read(OUT/"cost"/(key+".json.gz"))
            add_controls(rows)
            groups[meta["domain"]].extend(rows); docs.extend(layouts)
            domain_by_id.update((d["id"],meta["domain"]) for d in layouts)
        rows=sum(groups.values(),[]); names=sorted(rows[0]["metrics"])
        assert all(set(r["metrics"])==set(names) for r in rows)
        rates={n:macro(groups,lambda r:metric(r,n)) for n in names}
        rankers=["core","paragraph","frontier","middle","leaf","leafPara","all","balanced","routed"]
        if fold=="development":
            families=dict(blocks=["blocks"],joined=["joined"],hierarchy=["tree","joined","items","mixed","sections","earlyitems","earlymixed","earlysections"])
            for family,plans in families.items():
                entries=[f"{p}/{m}/window" for p in plans for m in rankers]
                chosen[family]={}
                for label,(a,b) in {"first":(0,1),"five":(1,0)}.items():
                    chosen[family][label]=min(entries,key=lambda n:(-rates[n][a],-rates[n][b],entries.index(n)))
        comparisons=[]
        for p in ("blocks","tree","joined"):
            comparisons.extend((f"{p}/{m}/window",f"{p}/leaf/window") for m in ("paragraph","middle","all","balanced","routed","frontier"))
            comparisons.append((f"{p}/all/window",f"{p}/paragraph/window"))
            comparisons.extend([(f"{p}/paragraph/window",f"{p}/displacedParagraph/window"),(f"{p}/all/window",f"{p}/displacedMiddle/window")])
        comparisons += [("joined/all/window","blocks/all/window"),("joined/all/window","blocks/paragraph/window"),
                        ("sections/all/window","joined/all/window"),("earlymixed/leaf/window","tree/leaf/window"),
                        ("earlysections/leaf/window","tree/leaf/window"),("hybrid/all/distinct","blocks/all/distinct"),
                        ("hybrid/all/distinct","joined/all/distinct")]
        for label in ("first","five"):
            comparisons.append((chosen["hierarchy"][label],chosen["blocks"][label]))
        moved={}
        for base in ("flat40","tree","joined"):
            for mode in ("inside","lengths","window3","valley"):
                ids=[f"{base}-{mode}-{s}" for s in SEEDS] if mode in ("inside","lengths") else [f"{base}-{mode}"]
                counts=np.array([[d["moved"][n] for n in ids] for d in docs])
                changed={d["id"] for d,cc in zip(docs,counts) if cc[:,0].sum()}
                moved[f"{base}-{mode}"]=dict(changesPerTrial=counts[:,:,0].sum(axis=0).tolist(),totalBaselineCuts=int(counts[:,0,1].sum()),
                    changedDocuments=len(changed),affectedQuestions=sum(r["doc"] in changed for r in rows))
                for label in ("core/bare","leaf/window"):
                    comparisons.append((f"{base}/{label}",f"{base}-{mode}/{label}"))
        simple=[f"{p}/{m}/window" for p in ("blocks","tree","joined","sections") for m in ("core","leaf","paragraph","frontier","all")]
        simple+=["joined-inside/leaf/window","joined-lengths/leaf/window","tree-inside/core/bare","tree-lengths/core/bare"]
        def oracle(a,b):
            return macro(groups,lambda r:[max(metric(r,a)[0],metric(r,b)[0]),int(metric(r,a)[0]>metric(r,b)[0]),
                                          int(metric(r,a)[0]<metric(r,b)[0])])
        eligibility=collections.Counter();changed_docs=collections.Counter()
        for doc in docs:
            eligibility.update(doc["eligible"])
            changed_docs.update({k:1 for k,v in doc["eligible"].items() if v})
        pure={d:rr for d,rr in groups.items() if d in ("fiction","spoken")}
        out=dict(questions=len(rows),documents=len(docs),domainCounts={d:len(rr) for d,rr in groups.items()},
                 formats=dict(collections.Counter(d["format"] for d in docs)),rates=rates,developmentSelections=chosen,
                 paired={a+" minus "+b:bounds(groups,a,b) for a,b in dict.fromkeys(comparisons)},
                 cost={p:vector_cost(docs,p) for p in ("blocks","tree","joined","hybrid")},
                 counts={p:sum(d["sizes"][p] for d in docs) for p in study["MAIN"]},
                 typedEdges=eligibility,docsWithEdges=changed_docs,cutControls=moved,
                 questionWeightedRates={n:np.mean([metric(r,n) for r in rows],axis=0).tolist() for n in simple},
                 perDomain={d:{n:np.mean([metric(r,n) for r in rr],axis=0).tolist() for n in simple} for d,rr in groups.items()},
                 fictionAndSpoken={n:macro(pure,lambda r:metric(r,n)) for n in names if n.startswith(("joined","tree","flat40"))},
                 oracleFirst_blocksOnly_joinedOnly=oracle("blocks/paragraph/window","joined/all/window"))
        output[fold]=out
    glob={}
    fresh_ids={d["id"]:meta["domain"] for meta in reg.values() if meta["fold"]=="fresh" for d in meta["documents"]}
    for p in ("blocks","tree","joined","items","mixed","sections","hybrid"):
        groups=collections.defaultdict(list)
        for r in read(OUT/"global"/(p+".json.gz")):groups[fresh_ids[r["doc"]]].append(r)
        glob.update({n:macro(groups,lambda r:metric(r,n)) for n in next(iter(groups.values()))[0]["metrics"]})
    result=dict(fields=["completeFirst","completeWithinFive","firstEvidenceF1","firstNonwhiteCharacters"],
                folds=output,shared69Documents=glob)
    path=HERE/"results/2026-11-27-hierarchy-probes.json"
    path.write_text(json.dumps(result,indent=2,allow_nan=False)+"\n",encoding="utf8")


if __name__=="__main__":summarize()
