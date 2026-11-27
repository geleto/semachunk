"""Run restartable, isolated workers. Every document is checkpointed atomically."""
import argparse,concurrent.futures,json,os,subprocess,sys
from pathlib import Path
here=Path(__file__).resolve().parent
root=here/".cache/context-mixtures"
p=argparse.ArgumentParser();p.add_argument("stage",choices=["index","score","trace","audit"]);p.add_argument("--fold");p.add_argument("--jobs",type=int,default=5);p.add_argument("--keys",nargs="*");p.add_argument("--missing",action="store_true");a=p.parse_args()
m=json.loads((root/"data/manifest.json").read_bytes())
jobs=[]
for key,v in m.items():
    if a.fold and v["fold"]!=a.fold or a.keys and key not in a.keys:continue
    if a.stage=="index":
        for i in range(len(v["documents"])):
            if not a.missing or not (root/"indexes"/key/(str(i)+".json.gz")).exists():
                jobs.append((key+"-"+str(i),["node",str(here/"mixture-index.mjs"),key,str(i)]))
    elif a.stage=="trace":
        jobs.append((key,[sys.executable,str(here/"mixture-score.py"),key,str(root/"shortlist.json")]))
    elif a.stage=="audit":
        if v["fold"]=="fresh":jobs.append((key,[sys.executable,str(here/"mixture-score.py"),key,str(root/"shortlist.json"),"--audited"]))
    elif not a.missing or not (root/"scores"/(key+".npz")).exists():
        jobs.append((key,[sys.executable,str(here/"mixture-score.py"),key]))
out=root/"logs";out.mkdir(parents=True,exist_ok=True)
def work(job):
    name,cmd=job;log=out/(a.stage+"-"+name+".log")
    with log.open("wb") as f:
        r=subprocess.run(cmd,stdout=f,stderr=f,env={**os.environ,"OPENBLAS_NUM_THREADS":"1","OMP_NUM_THREADS":"1","PYTHONUTF8":"1"})
    if r.returncode:print("FAILED",name,log.read_text(encoding="utf8",errors="replace")[-800:],flush=True)
    return r.returncode
with concurrent.futures.ThreadPoolExecutor(a.jobs) as ex:
    codes=list(ex.map(work,jobs))
print(a.stage,len(codes),"jobs,",sum(bool(i) for i in codes),"failures",flush=True)
sys.exit(any(codes))
