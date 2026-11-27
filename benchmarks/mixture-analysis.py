"""Freeze development selections, summarize paired full-source outcomes and export query traces."""
import argparse,collections,gzip,hashlib,json,os,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE/".cache/context-mixtures";RESULT=HERE/"results"
PREFIX="2026-11-27-context-mixtures-"
def load(fold):
    by=collections.defaultdict(list);names=None
    for key,meta in json.loads((ROOT/"data/manifest.json").read_bytes()).items():
        if meta["fold"]!=fold:continue
        rows=json.loads((ROOT/"scores"/(key+".json")).read_bytes());file=np.load(ROOT/"scores"/(key+".npz"))
        if names is None:names=file["names"].tolist()
        assert names==file["names"].tolist()
        by[meta["domain"]].append((rows,file["scores"]))
    return names,{k:([q for rows,_ in v for q in rows],np.concatenate([a for _,a in v],axis=1)) for k,v in by.items()}
def summaries(by):
    return {k:a[:,[q["kind"]=="primary" for q in rows]].mean(axis=1,dtype=np.float64) for k,(rows,a) in by.items()}
def complexity(s):
    weights={"base":0,"mix30":1,"joint":2,"dual":3,"m30j30":4,"both":0,"core":0,"allow":0,"sentence":0,"blocks256":0,"head256":1}
    return (len(s.split("/"))+sum(weights.get(k,2) for k in s.split("/")),s)
def save(name,obj):
    (RESULT/(PREFIX+name+".json")).write_text(json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf8")
def freeze():
    names,by=load("development");av=np.stack(list(summaries(by).values())).mean(axis=0);selected={}
    masks=dict(structural=lambda n:n.startswith(("blocks256/","head256/")),semantic=lambda n:n.startswith(("tree","sent")),
        flat=lambda n:n.startswith("sent"),tree=lambda n:n.startswith("tree"),strict=lambda n:n.startswith("sent55/"))
    for group,f in masks.items():
        cand=[i for i,n in enumerate(names) if f(n)];selected[group]={}
        for label,order in [("five",(1,0,2)),("first",(0,1,2)),("focus",(2,0,1))]:
            i=min(cand,key=lambda i:(*[-round(float(av[i,j]),8) for j in order],complexity(names[i])))
            near=[k for k in cand if all(av[k,j]>=av[i,j]-.01 for j in order[:2])]
            selected[group][label]=names[i];selected[group][label+"Simple"]=names[min(near,key=lambda k:complexity(names[k]))]
    if "--check" in sys.argv:
        assert selected==json.loads((RESULT/(PREFIX+"selections.json")).read_bytes())["methods"]
        print("All frozen development choices reproduced.");return
    save("selections",dict(rule=json.loads((HERE/"mixture-protocol.json").read_bytes())["selection"],development=len(names),methods=selected))
    fixed=["blocks256/core","head256/core","blocksInf/core","blocks256/child50","head256/child50","tree40/core","sent25/core","sent40/core","sent55/core",
        "blocks256/sentence/allow/mix30/both","sent55/sentence/allow/mix30/both","sent25/sentence/allow/dual/both"]
    short=set(fixed)
    for family in selected.values():short.update(family.values())
    for g in ["structural","semantic"]:
        n=selected[g]["five"];p=n.split("/")
        if len(p)==5 and p[1] in ("chunk","sentence"):
            for gate in ["allow","trim","drop","linked"]:short.add("/".join([p[0],p[1],gate,p[3],p[4]]))
    (ROOT/"shortlist.json").write_text(json.dumps(sorted(short)))
    print(json.dumps(selected,indent=2))

def paired(by,ix,iy):
    rng=np.random.default_rng(9152);parts=[];counts={}
    for dom,(rows,a) in sorted(by.items()):
        keep=[i for i,q in enumerate(rows) if q["kind"]=="primary"]
        docs=sorted({rows[i]["doc"] for i in keep});delta=(a[ix,keep,:3]-a[iy,keep,:3]).astype(float)
        groups=[[j for j,i in enumerate(keep) if rows[i]["doc"]==d] for d in docs]
        total=np.array([delta[g].sum(axis=0) for g in groups]);sizes=np.array(list(map(len,groups)))
        draw=rng.integers(0,len(docs),(3000,len(docs)));parts.append(total[draw].sum(axis=1)/sizes[draw].sum(axis=1)[:,None])
        counts[dom]=[[int((delta[:,i]>0).sum()),int((delta[:,i]<0).sum())] for i in (0,1)]
    return {"lowerUpper":np.quantile(np.mean(parts,axis=0),[.025,.975],axis=0).tolist(),"winsLossesFirstFive":counts}
def summarize():
    sel=json.loads((RESULT/(PREFIX+"selections.json")).read_bytes())["methods"];short=json.loads((ROOT/"shortlist.json").read_bytes());out={};allset={}
    comparisons=[(sel["semantic"][k],sel["structural"][k]) for k in ["five","first","focus"]]
    comparisons += [(sel["semantic"]["five"],"blocks256/core"),("blocks256/child50","blocks256/core"),
                    ("sent55/sentence/allow/mix30/both","sent55/core"),(sel["semantic"]["fiveSimple"],sel["structural"]["fiveSimple"])]
    for fold in ["development","confirmation","fresh"]:
        names,by=load(fold);ds=summaries(by);avg=np.stack(list(ds.values())).mean(axis=0)
        out[fold]={"macro":dict(zip(names,avg.tolist())),"domains":{k:{n:s[names.index(n)].tolist() for n in short} for k,s in ds.items()},
            "counts":{d:dict(primary=sum(q["kind"]=="primary" for q in rows),coarse=sum(q["kind"]=="section" for q in rows),answerDocs=len({q["doc"] for q in rows if q["kind"]=="primary"})) for d,(rows,a) in by.items()},
            "paired":{x+" vs "+y:paired(by,names.index(x),names.index(y)) for x,y in comparisons}}
        rr,aa=by["fiction"];cc=[i for i,q in enumerate(rr) if q["kind"]=="section"]
        out[fold]["coarseFiction"]={n:aa[names.index(n),cc].mean(axis=0,dtype=float).tolist() for n in short}
        allset[fold]={}
        for d,(rows,mat) in by.items():allset[fold][d]={"questions":[[q["id"],q["doc"],q["kind"]] for q in rows],"scores":{n:mat[names.index(n)].round(5).tolist() for n in short}}
    # Full macro curves for discovery, paired question-level outcomes for all nominees.
    for suffix,obj in [("results",out),("outcomes",allset)]:
        (RESULT/(PREFIX+suffix+".json.gz")).write_bytes(gzip.compress(json.dumps(obj,separators=(",",":"),allow_nan=False).encode(),mtime=0))
    save("manifest",dict(fictionAudit=json.loads((ROOT/"data/fiction-audit.json").read_bytes()),sets=json.loads((ROOT/"data/manifest.json").read_bytes())))
if __name__=="__main__":
    if sys.argv[1]=="freeze":freeze()
    else:summarize()
