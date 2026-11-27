"""Fit on development, freeze nominees, then evaluate separate sources and sizing modes."""
import argparse
import concurrent.futures
import json
import math
import os
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
STORE = HERE / ".cache/semantic-settings"
OUT = HERE / "results"
MANIFEST = OUT / "2026-11-26-semantic-settings-data.json"
FREEZE = OUT / "2026-11-26-semantic-settings-nominees.json"
PROTOCOL = HERE / "semantic-settings-protocol.json"
SMALL, LARGE = "text-embedding-3-small", "text-embedding-3-large"
def read(path):
    return json.loads(path.read_text("utf8"))


def run_job(key, cap, model, methods):
    log = STORE / "runs" / model / str(cap) / (key+".log")
    log.parent.mkdir(parents=True,exist_ok=True)
    cmd = ["node", str(HERE/"semantic-settings.mjs"),key,str(cap),methods if methods == "grid" else json.dumps(methods)]
    with log.open("w",encoding="utf8") as f:
        run = subprocess.run(cmd,stdout=f,stderr=subprocess.STDOUT,cwd=HERE.parent,env={**os.environ,"SEMACHUNK_BENCHMARK_MODEL":model})
    if run.returncode:
        raise RuntimeError(str(log)+"\n"+log.read_text("utf8")[-2300:])
    print(model,cap,key,flush=True)


def execute(jobs, workers):
    # A source family owns its vector store. Size variants and alternate views can replay it.
    groups = defaultdict(list)
    for key, cap, model, methods in jobs:
        group = key.rsplit("-",1)[0] if key.startswith(("government-","faq-")) else key
        groups[model,group].append((key,cap,model,methods))
    def series(group):
        for args in group:
            run_job(*args)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(series, group) for group in groups.values()]
        for f in concurrent.futures.as_completed(futures):
            try: f.result()
            except BaseException:
                for other in futures: other.cancel()
                raise


def primary(key):
    return not key.endswith("-published")


def cohort(key):
    return key.split("-")[0]


def profile(keys, cap, model):
    return [read(STORE/"runs"/model/str(cap)/(k+".json")) for k in keys]


def means(rows, method, metric=0):
    outcomes=defaultdict(dict)
    for r in rows:
        if not primary(r["key"]): continue
        domain=cohort(r["key"])
        values=outcomes[domain]
        for q,v in zip(r["queries"],r["methods"][method]["outcomes"],strict=True):
            values.setdefault(q[0],[]).append(v[metric])
    return {k:statistics.mean(statistics.mean(v) for v in d.values()) for k,d in outcomes.items()}


def nominees(keys):
    rows=profile([k for k in keys if primary(k)],256,SMALL)
    totals={}
    for m in rows[0]["methods"]:
        by=means(rows,m)
        totals[m]={"primary":statistics.mean(by.values()),"domains":by,
                   "selectionTokens":sum(r["methods"][m]["selectionTokens"] for r in rows)}
    groups={"semantic":[m for m in totals if m.startswith("semantic/")],
            "semantic-blocks":[m for m in totals if m.startswith("semantic-blocks/")],
            "alternative":read(PROTOCOL)["alternative"]}
    selected={k:min(v,key=lambda m:(-totals[m]["primary"],totals[m]["selectionTokens"])) for k,v in groups.items()}
    result={"selection":selected,"development":totals}
    if FREEZE.exists():
        assert read(FREEZE)==result, "Development results changed after nomination"
    else:
        FREEZE.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8",newline="\n")
    return selected


def transfer(key):
    return (key.startswith("faq-") or "-ssa-" in key or
            key.startswith(("finance-","papers-")) and key.rsplit("-",1)[1] in {"0","1"})


def run(stage,workers):
    if stage=="topics":
        manifest=read(OUT/"2026-11-26-tree-corpus.json")
        shards=[(k,i) for k,v in manifest["boundaries"].items() if k.endswith("-confirmation")
                for i in range(math.ceil(v["documents"]/(24 if k.startswith("wiki") else 5)))]
        def topic(job):
            key,shard=job
            cmd=["node",str(HERE/"semantic-settings-topics.mjs"),key,str(shard)]
            subprocess.run(cmd,cwd=HERE.parent,env={**os.environ,"SEMACHUNK_BENCHMARK_MODEL":SMALL},check=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            for _ in ex.map(topic,shards): pass
        return
    available=read(MANIFEST)["sets"]
    dev=[k for k in available if "-development-" in k and primary(k)]
    confirmation=[k for k in available if "-development-" not in k]
    if stage in ("development","all"):
        execute([(k,256,SMALL,"grid") for k in dev],workers)
        nominees(dev)
        if stage=="development":return
    selected=list(read(FREEZE)["selection"].values())
    locked=list(dict.fromkeys(read(PROTOCOL)["controls"]+selected))
    if stage=="sizes":
        execute([(k,c,SMALL,locked) for k in dev for c in (128,512)],workers)
        profiles={str(c):{m:statistics.mean(means(rr,m).values()) for m in locked}
                  for c in (128,256,512) for rr in [profile(dev,c,SMALL)]}
        # Keep the established 256-token profile if it falls within one point of a method's best.
        sizes={}
        for m in locked:
            best=max((128,256,512),key=lambda c:profiles[str(c)][m])
            sizes[m]=256 if profiles[str(best)][m]-profiles["256"][m]<=.01 else best
        result={"criterion":"Among 128, 256 and 512 tokens use the best development macro-complete score, retaining 256 when within one percentage point. Use the same five-hit, 512-token delivery objective and the already-frozen methods.",
                "sizes":sizes,"development":profiles}
        path=OUT/"2026-11-26-semantic-settings-sizes.json"
        if path.exists():assert read(path)==result
        else:path.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8",newline="\n")
        return
    jobs=[]
    for k in confirmation:
        jobs.append((k,256,SMALL,"grid" if primary(k) else locked))
        jobs.extend((k,cap,SMALL,locked) for cap in (128,512))
        if transfer(k):jobs.append((k,256,LARGE,locked))
    execute(jobs,workers)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("stage",choices=["development","confirmation","all","topics","sizes"],default="all",nargs="?")
    p.add_argument("--workers",type=int,default=3)
    args=p.parse_args()
    run(args.stage,args.workers)
