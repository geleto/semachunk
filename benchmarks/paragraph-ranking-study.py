"""Development selection, paired validation and promotion decision for paragraph scoring."""
import collections
import gzip
import itertools
import json
import re
import runpy
import sys
from pathlib import Path

import numpy as np

here=Path(__file__).resolve().parent
lib=runpy.run_path(str(here/"paragraph-ranking.py"))
root,protocol=lib["ROOT"],lib["PROTOCOL"]
profile,sig=lib["profile"],lib["signature"]
B,T=lib["B"],lib["T"]
selection=root/"selection.json"
metrics=lib["FIELDS"]


def unique(configs):
    return list({sig(c):c for c in configs}.values())


def complexity(c):
    if "policy" in c:
        return (2,{"head":0,"rerank":1,"cover":2}[c["policy"]],0)
    return (len(c["layouts"])-1,{"center":0,"top2":1,"parent":1,"mean":2,"max":2,"chunk":2,
             "visible":3,"cross":2,"parentMean":3,"joint":4,"normalized":3,"sentence":5,"triple":4,"group25":5}[c["method"]],int(c["section"]>0))


def best(configs, results):
    configs=unique(configs)
    def quality(c):
        r=results[sig(c)]
        return (r["first"]+r["five"])/2
    maximum=max(map(quality,configs))
    close=[c for c in configs if quality(c)>=maximum-.0035]
    return min(close,key=lambda c:(complexity(c),-results[sig(c)]["f1"],-quality(c),sig(c)))


def leaders(configs, results, n):
    choices, selected=list(configs),[]
    while choices and len(selected)<n:
        winner=best(choices,results)
        selected.append(winner)
        choices=[p for p in choices if p["layouts"]!=winner["layouts"]]
    return selected


class Experiment:
    def __init__(self,fold,small=False):
        self.fold=fold
        self.pools=lib["pools"](fold,small)
        self.results={}
        self.counts=collections.Counter(d["domain"] for p in self.pools for d,q in p.qs)

    def measure(self,c,collect=False):
        key=sig(c)
        if not collect and key in self.results:return
        total=np.zeros(len(metrics))
        all_rows=[]
        for pool in self.pools:
            shown=pool.run(c)
            observations=np.asarray([pool.grade(i,h) for i,h in enumerate(shown)])
            for i,((d,q),values) in enumerate(zip(pool.qs,observations)):
                total+=values/self.counts[d["domain"]]
                if collect:
                    all_rows.append(dict(doc=d["id"],id=q["id"],domain=d["domain"],scores=values,
                                         hits=[(pool.docs[pool.owners[v]]["id"],v-pool.offsets[pool.owners[v]]) for v in shown[i]]))
        self.results[key]=dict(zip(metrics,(total/len(self.counts)).tolist()))
        return all_rows

    def batch(self,configs,label):
        for c in unique(configs):self.measure(c)
        print(label,len(self.results),"distinct trials",flush=True)


def development(compact=False):
    exp=Experiment("development")
    layouts=list(exp.pools[0].docs[0]["ix"]["layouts"])
    if compact:
        layouts=[name for name in layouts if int(re.search(r"u(\d+)",name)[1])<=256]
        exp.results.update(json.loads(gzip.decompress((root/"development-sweep.json.gz").read_bytes())))
    blocks=[profile(l) for l in layouts if l.startswith("B")]
    trees=[profile(l) for l in layouts if l.startswith("T")]
    exp.batch(blocks+trees,"Geometry")
    bshort=unique(leaders(blocks,exp.results,3)+[profile(B)]+leaders(
        [p for p in blocks if int(p["layouts"][0].split("u")[1])<=256],exp.results,1))
    tshort=unique(leaders(trees,exp.results,3)+[profile(T)])
    incumbents={"blocks":profile(B),"tree":profile(T),"union":profile([B,T])}
    combos=[[b["layouts"][0],t["layouts"][0]] for b,t in itertools.product(bshort,tshort)]
    pairs=[list(z) for z in itertools.combinations([c["layouts"][0] for c in bshort],2)]
    families={"blocks":[p["layouts"] for p in bshort],"tree":[p["layouts"] for p in tshort],"union":combos,"doubleBlocks":pairs}
    all_weights={}
    shortlist={}
    for name,ls in families.items():
        configs=[profile(l,d,s) for l,d,s in itertools.product(ls,protocol["detailShares"],protocol["sectionShares"])]
        exp.batch(configs,"Chunk, paragraph and section weights "+name)
        all_weights[name]=configs
        shortlist[name]=unique(leaders(configs,exp.results,2)+([incumbents[name]] if name in incumbents else []))
    candidates,center_champs={},{}
    for name,bases in shortlist.items():
        configs=list(bases)
        for p in bases:
            configs.extend([{**p,"method":"parent"},{**p,"method":"top2"}])
            for method in ["mean","max","cross","visible","joint","parentMean","chunk"]:
                weights=protocol["paragraphNeighborShares"] if method!="chunk" else [.15,.30,.50]
                configs.extend({**p,"method":method,"weight":w} for w in weights)
        exp.batch(configs,"Neighbor scores "+name)
        center=[c for c in configs if c["method"]=="center"]
        neighborhood=[c for c in configs if c["method"] in ("mean","max","cross","visible","joint","parentMean")]
        bases2=unique(leaders(configs,exp.results,2)+[best(center,exp.results),best(neighborhood,exp.results)])
        dedup=[{**p,"overlap":v} for p in bases2 for v in protocol["overlapCutoffs"]]
        exp.batch(dedup,"Overlap "+name)
        center_champs[name]=best([c for c in dedup if c["method"]=="center"],exp.results)
        candidates[name]=unique(dedup+configs)
    winners={name:best(cs,exp.results) for name,cs in candidates.items()}
    b=winners["blocks"]
    alternatives={"semantic":unique(leaders(candidates["tree"],exp.results,2)+[profile(T)]),
                  "structural":leaders([c for c in candidates["blocks"] if c["layouts"]!=b["layouts"]],exp.results,2)}
    guards={}
    for side,alts in alternatives.items():
        guards[side]=[]
        for alt in alts:
            common=dict(base=b,alt=alt)
            trials=[dict(**common,policy="head")]
            trials.extend(dict(**common,policy="rerank",iou=i,blend=w) for i,w in itertools.product([.25,.5],[.25,.5,.75,1]))
            trials.extend(dict(**common,policy="cover",extra=n,margin=m,firstOnly=f,lengthOnly=False)
                          for n,m,f in itertools.product([32,64,512],[0,.02,None],[False,True]))
            trials.extend(dict(**common,policy="cover",extra=n,margin=None,firstOnly=False,lengthOnly=True) for n in [32,64,512])
            exp.batch(trials,"Guarded "+side+" "+str(alt["layouts"]))
            guards[side].extend(trials)
    nominees={**winners,**{"incumbent-"+k:v for k,v in incumbents.items()}}
    for side,cs in guards.items():
        for kind in ["head","rerank","cover"]:
            eligible=[c for c in cs if c["policy"]==kind and not c.get("lengthOnly")]
            nominees[side+"-"+kind]=best(eligible,exp.results)
        nominees[side+"-length"]=best([c for c in cs if c.get("lengthOnly")],exp.results)
    for name in families:
        nominees[name+"-center"]=center_champs[name]
        eligible=[c for c in candidates[name] if c["method"] in ("mean","max","cross","visible","joint","parentMean")]
        nominees[name+"-paragraph-neighbor"]=best(eligible,exp.results)
    choices=[nominees[k] for k in ("tree","union","semantic-head","semantic-rerank","semantic-cover")]
    nominees["semanticCandidate"]=best(choices,exp.results)
    fitted={k:v for k,v in exp.results.items() if not compact or all(int(x)<=256 for x in re.findall(r"[BT]\d+u(\d+)",k))}
    frozen=dict(nominees=nominees,shortlist=shortlist,uniqueTrials=len(fitted))
    file=root/"compact-selection.json" if compact else selection
    file.write_text(json.dumps(frozen,indent=2),encoding="utf-8")
    (root/("compact-sweep.json.gz" if compact else "development-sweep.json.gz")).write_bytes(gzip.compress(json.dumps(fitted,separators=(",",":")).encode(),mtime=0))
    print("Frozen",json.dumps({k:nominees[k] for k in ("blocks","tree","union","semanticCandidate")}),flush=True)


def cost(docs, config):
    profiles=[config["base"],config["alt"]] if "policy" in config else [config]
    hashes,layouts=set(),set()
    for d in docs:
        ix=d["ix"]
        for p in profiles:
            keys=set(ix["sectionKeys"]) if p["section"] else set()
            for l in p["layouts"]:
                layouts.add(l)
                for idx,c in enumerate(ix["layouts"][l]):
                    keys.add(c["v"])
                    if not p["detail"]:continue
                    if p["method"] in ("sentence","triple","group25"):keys.update(ix["small"][l][idx][p["method"]])
                    indices=c["pa"] or ([c["same"]] if c["same"]>=0 else [])
                    if not indices and p["method"].startswith("parent") and c["parent"]>=0:indices=[c["parent"]]
                    for i in indices:
                        ps=ix["paragraphs"]; node=ps[i]
                        keys.add(node["v"])
                        if p["method"]=="joint":
                            keys.add(node["joint"])
                        elif p["method"] in ("mean","parentMean","max","visible","cross","normalized"):
                            for j in (i-1,i+1):
                                if not 0<=j<len(ps) or (p["method"]!="cross" and ps[j]["scope"]!=node["scope"]):continue
                                if p["method"]=="visible" and 2*lib["ev"].size(lib["ev"].intersect(ps[j]["raw"],ix["views"][c["win"]]["raw"]))<lib["ev"].size(ps[j]["raw"]):continue
                                keys.add(ps[j]["v"])
            hashes.update(ix["hashes"][k] for k in keys)
    return dict(vectors=len(hashes),chunks=sum(len(d["ix"]["layouts"][l]) for d in docs for l in layouts))


def detail_selection():
    compact=json.loads((root/"compact-selection.json").read_bytes())["nominees"]
    exp=Experiment("development",True)
    winners={}
    for name in ("blocks","tree","union","doubleBlocks"):
        base=compact[name]
        anchors=unique([base,compact[name+"-center"]])
        tested=[]
        for p in anchors:
            center={**p,"method":"center","weight":0}
            tested.extend([p,center])
            tested.extend({**center,"method":"normalized","weight":w} for w in protocol["paragraphNeighborShares"])
            for method,weight,d in itertools.product(["sentence","triple","group25"],[.5,1],[.25,.5,.75,1]):
                tested.append({**center,"method":method,"weight":weight,"detail":d})
        exp.batch(tested,"Optional smaller keys and normalized neighboring paragraphs "+name)
        winners[name+"-extended"]=best(tested,exp.results)
        winners[name+"-normalized"]=best([p for p in tested if p["method"]=="normalized"],exp.results)
        winners[name+"-smallKeys"]=best([p for p in tested if p["method"] in ("sentence","triple","group25")],exp.results)
    (root/"detail-selection.json").write_text(json.dumps(dict(nominees=winners,uniqueTrials=len(exp.results)),indent=2),encoding="utf-8")
    (root/"detail-sweep.json.gz").write_bytes(gzip.compress(json.dumps(exp.results,separators=(",",":")).encode(),mtime=0))


def validation(fold):
    compact=json.loads((root/"compact-selection.json").read_bytes())["nominees"]
    wide=json.loads(selection.read_bytes())["nominees"]
    extended=json.loads((root/"detail-selection.json").read_bytes())["nominees"]
    nominees={**compact,**{"wide-"+k:wide[k] for k in ("blocks","tree","union","doubleBlocks","semanticCandidate","semantic-cover","structural-cover")},
              **extended}
    for name in ("blocks","tree","union"):
        trial=nominees[name+"-paragraph-neighbor"]
        nominees[name+"-isolated-center"]={**trial,"method":"parent" if trial["method"]=="parentMean" else "center","weight":0}
        nominees[name+"-geometry-only"]=profile(nominees[name]["layouts"])
    nominees["incumbent-mean20"]={**nominees["incumbent-union"],"method":"mean","weight":.2}
    exp=Experiment(fold,True)
    rows={}
    for k,c in nominees.items():
        signature=sig(c)
        if signature not in rows:rows[signature]=exp.measure(c,True)
    target=rows[sig(nominees["blocks"])]
    groups=collections.defaultdict(list)
    for i,r in enumerate(target):groups[r["domain"]].append(dict(doc=r["doc"],i=i))
    all_docs=[d for pool in exp.pools for d in pool.docs]
    results={}
    for name,c in nominees.items():
        rr=rows[sig(c)]
        referenceName="wide-blocks" if name.startswith("wide-") else "blocks-extended" if name.endswith(("-extended","-smallKeys","-normalized")) else "blocks"
        reference=rows[sig(nominees[referenceName])]
        assert [(r["doc"],r["id"]) for r in rr]==[(r["doc"],r["id"]) for r in reference]
        delta=np.array([r["scores"]-b["scores"] for r,b in zip(rr,reference)])
        ci=lib["report"]["paired"](groups,1,0,lambda row,mode:delta[row["i"]][:4]*mode)
        distribution=sorted((r["scores"][3],1/(len(groups)*len(groups[r["domain"]]))) for r in rr)
        mass=0
        for p95,w in distribution:
            mass+=w
            if mass>=.95:break
        results[name]=dict(rates=exp.results[sig(c)],p95=p95,maxFirst=max(r["scores"][3] for r in rr),
            cost=cost(all_docs,c),reference=referenceName,pairedAgainstBlocks=ci,firstGainsLosses=[int(np.sum(delta[:,0]>0)),int(np.sum(delta[:,0]<0))],
            fiveGainsLosses=[int(np.sum(delta[:,1]>0)),int(np.sum(delta[:,1]<0))],
            perDomain={dom:np.mean([rr[row["i"]]["scores"] for row in rs],axis=0).tolist() for dom,rs in groups.items()})
        if name in ("blocks","tree","union","semanticCandidate","incumbent-mean20") or name.endswith("-paragraph-neighbor") and not name.startswith("double"):
            reference_key=(name.split("-")[0]+"-isolated-center" if name.endswith("-paragraph-neighbor") else
                           "incumbent-"+name if name in ("blocks","tree","union") else "incumbent-union")
            before=rows[sig(nominees[reference_key])]
            diff=np.array([r["scores"]-b["scores"] for r,b in zip(rr,before)])
            results[name]["pairedAblation"]={"reference":reference_key,"intervals":lib["report"]["paired"](
                groups,1,0,lambda row,mode:diff[row["i"]][:4]*mode),"firstGainsLosses":[int(sum(diff[:,0]>0)),int(sum(diff[:,0]<0))],
                "fiveGainsLosses":[int(sum(diff[:,1]>0)),int(sum(diff[:,1]<0))]}
        if c.get("policy")=="cover":assert np.all(delta[:,:2]>=0)
        if c.get("policy")=="rerank":assert np.all(delta[:,1]==0)
    curve={}
    for name in ["incumbent-blocks","incumbent-tree","incumbent-union"]:
        base=nominees[name]
        cases=[base]+[{**base,"method":"mean","weight":w} for w in protocol["paragraphNeighborShares"]]
        cases.extend({**base,"method":method,"weight":.2} for method in ["max","joint","visible","cross","parentMean","chunk"])
        cases.extend([{**base,"method":"parent"},{**base,"window":False}])
        curve[name]={}
        for c in cases:
            exp.measure(c)
            curve[name][sig(c)]=exp.results[sig(c)]
    if fold in ["development","confirmation","fresh","shared-fresh"]:
        old=json.loads((here/"results/2026-11-27-structural-limits.json").read_bytes())["folds"][fold.replace("shared-fresh","shared")]["rates"]
        for label,old_name in [("incumbent-blocks","blocks256"),("incumbent-tree","tree512u256low"),("incumbent-union","both-tree512u256low")]:
            expected=old[old_name+"/512/15"]
            actual=results[label]["rates"]
            assert np.allclose([actual[x] for x in metrics],[expected[x] for x in ["complete1","complete5","evidenceF1","firstTokens","fiveTokens","wholeSource1"]],rtol=0,atol=1e-8),(fold,label,actual,expected)
    keys=["blocks","tree","union","semanticCandidate","semantic-cover","structural-cover","incumbent-blocks","incumbent-tree","incumbent-union","incumbent-mean20","blocks-extended","tree-extended","union-extended"]
    traces=[dict(source=r["doc"],question=r["id"],hits={k:rows[sig(nominees[k])][i]["hits"] for k in keys},
                 scores={k:rows[sig(nominees[k])][i]["scores"].tolist() for k in keys}) for i,r in enumerate(target)]
    (root/(fold+"-traces.json.gz")).write_bytes(gzip.compress(json.dumps(traces,separators=(",",":")).encode(),mtime=0))
    result=dict(sources=len(all_docs),questions=len(target),domains=dict(exp.counts),nominees=results,paragraphCurves=curve)
    if fold == "shared-holdout":
        reviewed = lib["SHARED_HOLDOUT_PROMPTS"]
        repeated = {(d["id"], q["id"]) for pool in exp.pools for d, q in pool.qs
                    if d["id"] in reviewed.get(q["text"].casefold().strip(), ())}
        assert len(repeated) == 4
        retained = {domain: [v["i"] for v in group
                             if (target[v["i"]]["doc"], target[v["i"]]["id"]) not in repeated]
                    for domain, group in groups.items()}
        sensitivity = {}
        for name in ("incumbent-blocks", "incumbent-union", "incumbent-mean20", "blocks", "tree", "union"):
            values = np.array([r["scores"] for r in rows[sig(nominees[name])]])
            rates = np.mean([values[indices].mean(axis=0) for indices in retained.values()], axis=0)
            sensitivity[name] = dict(zip(metrics, rates.tolist()))
        result["citationAudit"] = dict(prompts={q: sorted(ids) for q, ids in reviewed.items()},
                                       records=sorted(repeated), withoutFourRecords=sensitivity)
    (root/(fold+"-validation.json")).write_text(json.dumps(result,separators=(",",":")),encoding="utf-8")
    print("Validated",fold,len(target),flush=True)


def publish():
    folds=["development","confirmation","fresh","shared-fresh","holdout","shared-holdout"]
    result=dict(protocol=protocol,encoder=dict(model="text-embedding-3-small",dimensions=1536,tokenizer="cl100k_base"),
        perDomainFields=metrics,intervalFields=metrics[:4],selection=json.loads((root/"compact-selection.json").read_bytes()),
        widerSelection=json.loads(selection.read_bytes()),detailSelection=json.loads((root/"detail-selection.json").read_bytes()),
        holdoutManifest=json.loads((root/"holdout-data/manifest.json").read_bytes()),
        verification=json.loads((root/"verification.json").read_bytes()),
        diagnosticCandidateCoverage=json.loads((root/"complement.json").read_bytes()),
        exploratoryShortlist=dict(selection=json.loads((root/"shortlist-selection.json").read_bytes()),
                                  folds=json.loads((root/"shortlist-validation.json").read_bytes())),
        folds={f:json.loads((root/(f+"-validation.json")).read_bytes()) for f in folds})
    sweeps={name:json.loads(gzip.decompress((root/(name+".json.gz")).read_bytes())) for name in ["development-sweep","compact-sweep","detail-sweep"]}
    all_results={k:v for part in sweeps.values() for k,v in part.items()}
    result["uniqueDevelopmentProfiles"]=len(all_results)
    (here/"results/2026-11-27-paragraph-ranking.json").write_text(json.dumps(result,separators=(",",":")),encoding="utf-8")
    (here/"results/2026-11-27-paragraph-ranking-development.json.gz").write_bytes(
        gzip.compress(json.dumps(all_results,separators=(",",":")).encode(),mtime=0))


if __name__=="__main__":
    for task in sys.argv[1:]:
        if task=="select":development()
        elif task=="compact":development(True)
        elif task=="details":detail_selection()
        elif task=="publish":publish()
        else:validation(task)
