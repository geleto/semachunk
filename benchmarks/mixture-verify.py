"""Independent checks of the corpus, controls, vector arithmetic and display scoring."""
import collections,gzip,hashlib,importlib.util,json,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;R=HERE/".cache/context-mixtures";OUT=HERE/"results"
def gz(p):return json.loads(gzip.decompress(p.read_bytes()))
def sha(b):return hashlib.sha256(b).hexdigest()
def check():
    registry=json.loads((R/"data/manifest.json").read_bytes());old=json.loads((OUT/"2026-11-27-context-retrieval-manifest.json").read_bytes())
    checks=collections.Counter();changes=collections.Counter();trials=[];editions={}
    for k,m in registry.items():
        buf=(R/"data"/(k+".json")).read_bytes();assert sha(buf)==m["sha256"];docs=json.loads(buf)["docs"]
        rows=json.loads((R/"scores"/(k+".json")).read_bytes());f=np.load(R/"scores"/(k+".npz"));names=f["names"].tolist();matrix=f["scores"]
        assert len(names)==len(set(names)) and len(rows)==sum(len(d["questions"]) for d in docs)
        assert np.isfinite(matrix).all() and (matrix[:,:,1]>=matrix[:,:,0]).all() and (matrix[:,:,:3]>=0).all() and (matrix[:,:,:3]<=1.000001).all()
        checks["scored_questions"]+=len(rows);checks["layouts_times_documents"]+=9*len(docs)
        editions[k]=(rows,names,matrix)
        for j,d in enumerate(docs):
            pre=R/"indexes"/k/str(j);idx=gz(pre.with_suffix(".json.gz"))
            assert idx["id"]==d["id"] and [q["id"] for q in idx["questions"]]==[q["id"] for q in d["questions"]]
            assert sha(d["source"].encode())==m["documents"][j]["sha256"]
            raw=d["source"].encode("utf-16-le");plan=idx["plans"];ps=idx["passages"]
            for q in d["questions"]:
                for alt in q.get("references",[q.get("ranges")]):
                    for a,b in alt:assert 0<=a<b<=len(raw)//2 and raw[2*a:2*b].decode("utf-16-le").strip()
            for lo,hi in ((25,40),(40,55)):
                assert len(plan[f"sent{lo}"])<=len(plan[f"sent{hi}"])
                flat=lambda t:[(a,b) for i in plan[f"sent{t}"] for a,b in ps[i]["spans"]]
                def visible(spans):return "".join("".join(raw[2*a:2*b].decode("utf-16-le").split()) for a,b in spans)
                assert visible(flat(lo))==visible(flat(hi)),d["id"]
            for setting in ["blocks256","head256","sent40","tree40"]:
                c=idx["configs"][setting]
                for mode in ["sentence","chunk"]:
                    for g in ["drop","trim","linked"]:
                        changes[mode+"/"+g]+=sum(v[:2]!=w[:2] for v,w in zip(c["settings"][mode+"/allow"],c["settings"][mode+"/"+g]))
            if j==0 and idx["questions"]:
                vv=np.fromfile(pre.with_suffix(".f32"),dtype='<f4').reshape(-1,idx["dimension"])
                assert np.max(np.abs(np.linalg.norm(vv,axis=1)-1))<.001
                qv=vv[idx["questions"][0]["v"]]
                for i,(l,r,joint) in zip(plan["sent40"][:12],idx["configs"]["sent40"]["settings"]["chunk/allow"]):
                    X=vv[ps[i]["v"]];J=vv[ps[joint]["v"]];ns=[vv[ps[n]["v"]] for n in (l,r) if n>=0]
                    N=np.mean(ns,axis=0) if ns else X
                    for w,g in [(.3,0),(.15,.50),(.5,.3),(0,1)]:
                        a=1-w-g;y=a*X+w*N+g*J;direct=qv@y/np.linalg.norm(y)
                        norm=np.sqrt(a*a*(X@X)+w*w*(N@N)+g*g*(J@J)+2*a*w*(X@N)+2*a*g*(X@J)+2*w*g*(N@J))
                        other=(a*(qv@X)+w*(qv@N)+g*(qv@J))/norm
                        trials.append(abs(float(other-direct)))
    comparisons=collections.Counter();diff=collections.Counter()
    with gzip.open(OUT/"2026-11-27-context-retrieval-outcomes.jsonl.gz","rt",encoding="utf8") as f:
        for line in f:
            s=json.loads(line);k=s["key"];rows,names,mat=editions[k];qmap={q["id"]:i for i,q in enumerate(rows)}
            olddocs={d["id"]:d["sha256"] for d in old[k]["documents"]};newdocs={d["id"]:d["sha256"] for d in registry[k]["documents"]}
            for q in s["queries"]:
                if olddocs[q["doc"]]!=newdocs[q["doc"]]:continue
                for key,new in [("blocks256","blocks256"),("head256","head256"),("blocksInf","blocksInf"),("tree40","tree40"),("sentence40","sent40")]:
                    a=q["methods"][key+"/base"];b=mat[names.index(new+"/core"),qmap[q["id"]]]
                    comparisons[key]+=1
                    if not np.allclose(a[:3],b[:3],atol=2e-5):diff[key]+=1
    assert not diff,dict(diff)
    assert max(trials)<1e-5
    result=dict(checks=dict(checks),fixedControls=dict(comparisons),changedControls=dict(diff),mixtureChecks=len(trials),worstAbsoluteCosineError=max(trials),changedNeighborSelections=dict(changes))
    (OUT/"2026-11-27-context-mixtures-verification.json").write_text(json.dumps(result,indent=2)+"\n")
    print(result)
if __name__=="__main__":check()
