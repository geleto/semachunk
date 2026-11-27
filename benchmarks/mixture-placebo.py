import concurrent.futures,gzip,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
def module(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+".py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
engine=module("mixture-score");analysis=module("mixture-analysis");R=engine.ROOT
def gz(p):return json.loads(gzip.decompress(p.read_bytes()))
def score(key):
    data=json.loads((R/"data"/(key+".json")).read_bytes());groups=[];buf=[]
    for i,d in enumerate(data["docs"]):
        a=R/"indexes"/key/str(i);b=R/"placebo"/key/str(i);idx=gz(a.with_suffix(".json.gz"));extra=gz(b.with_suffix(".json.gz"))
        bb=b.with_suffix(".f32").read_bytes();assert hashlib.sha256(bb).hexdigest()==extra["hash"]
        vec=np.concatenate([np.fromfile(a.with_suffix(".f32"),dtype="<f4"),np.frombuffer(bb,dtype="<f4")]).reshape(-1,idx["dimension"])
        idx["passages"]+=extra["passages"];idx["members"].update(extra["members"])
        idx["plans"]={k:v for k,v in idx["plans"].items() if k.startswith("sent")};idx["plans"].update(extra["plans"])
        for k,cs in extra["plans"].items():
            idx["configs"][k]={"bridges":[],"settings":{"chunk/allow":[[cs[j-1] if j else -1,cs[j+1] if j+1<len(cs) else -1,c] for j,c in enumerate(cs)]}}
        buf.append((d,idx,vec))
        if data["pool"]!="collection":groups.append(buf);buf=[]
    if buf:groups.append(buf)
    queries=[];allrows=[]
    for group in groups:
        sel={k+"/"+suffix for k in group[0][1]["plans"] for suffix in ["core","child50","chunk/allow/child50/both"]}
        out=engine.evaluate(group,sel)
        if out:
            rows,rr,_=out;names=sorted(rr);queries+=rows;allrows.append(np.stack([rr[n] for n in names]))
    dest=R/"placebo-scores";dest.mkdir(exist_ok=True);np.savez_compressed(dest/(key+".npz"),x=np.concatenate(allrows,axis=1),names=names)
    (dest/(key+".json")).write_text(json.dumps(queries,ensure_ascii=False),encoding="utf8")
def run():
    meta=json.loads((R/"data/manifest.json").read_bytes())
    def worker(key):
        subprocess.run(["node",str(HERE/"mixture-placebo.mjs"),key],check=True)
        subprocess.run([sys.executable,__file__,key],check=True)
    with concurrent.futures.ThreadPoolExecutor(3) as ex:list(ex.map(worker,meta))
    report={}
    for fold in ["development","confirmation","fresh"]:
        by={};names=None
        for key,m in meta.items():
            if m["fold"]!=fold:continue
            f=np.load(R/"placebo-scores"/(key+".npz"));names=f["names"].tolist();rows=json.loads((R/"placebo-scores"/(key+".json")).read_bytes())
            by.setdefault(m["domain"],[]).append((rows,f["x"]))
        by={k:([q for r,_ in v for q in r],np.concatenate([x for _,x in v],axis=1)) for k,v in by.items()}
        domains=analysis.summaries(by);av=np.stack(list(domains.values())).mean(axis=0)
        comparisons={}
        for t in [25,40,55]:
            for s in ["core","child50","chunk/allow/child50/both"]:
                ids=[names.index(n+"/"+s) for n in [f"sent{t}",f"roll{t}a",f"roll{t}b"]]
                pairs={k:(r,np.stack([x[ids[0]],(x[ids[1]]+x[ids[2]])*.5])) for k,(r,x) in by.items()}
                comparisons[f"{t}/{s}"]=analysis.paired(pairs,0,1)["lowerUpper"]
        report[fold]=dict(macro=dict(zip(names,av.tolist())),domains={d:dict(zip(names,x.tolist())) for d,x in domains.items()},intervals=comparisons)
    analysis.save("matched-boundaries",report)
if __name__=="__main__":
    if len(sys.argv)>1:score(sys.argv[1])
    else:run()
