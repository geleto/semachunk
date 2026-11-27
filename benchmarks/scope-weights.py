"""Experiments on fixed query pools and complete delivered passages. Use the archived mixture indexes."""
import argparse,concurrent.futures,functools,gzip,hashlib,importlib.util,json,subprocess,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
def module(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+".py"))
    lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib);return lib
engine=module("mixture-score");study=module("mixture-analysis")
ROOT=engine.ROOT;OUT=HERE/".cache/scope-weights";RESULT=HERE/"results";PREFIX="2026-11-27-scope-weights-"
registry=json.loads((ROOT/"data/manifest.json").read_bytes())
def readgz(p):return json.loads(gzip.decompress(p.read_bytes()))
def put(name,data):
    (RESULT/(PREFIX+name+".json")).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf8")
def ranking(plan,cores,children,V,P,Q,neighbor,view,bare,add,diagnostics,records):
    if plan not in ("blocks256","sent25","sent40","sent55"):return
    norm=engine.unit;dot=engine.dot;Q=norm(Q);X=norm(V[P[cores]])
    lr=np.asarray(neighbor["sentence/allow"]);l,r,j=lr.T
    J=norm(V[P[j]])
    maskL=l>=0;maskR=r>=0;cnt=maskL.astype(int)+maskR
    L=norm(V[P[np.where(maskL,l,cores)]]);R=norm(V[P[np.where(maskR,r,cores)]])
    N=np.where(cnt[:,None],(L*maskL[:,None]+R*maskR[:,None])/np.maximum(cnt,1)[:,None],X).astype(np.float32)
    sx=Q@X.T;sn=Q@N.T;sj=Q@J.T
    xx=dot(X,X);nn=dot(N,N);xn=dot(X,N);jn=dot(J,N);jx=dot(J,X);jj=dot(J,J)
    display=np.asarray([view([left,c,right]) for c,(left,right,_) in zip(cores,lr)])
    def blend(w,g):
        a,b=(1-w)*(1-g),w*(1-g)
        length=np.sqrt(np.maximum(1e-12,a*a*xx+b*b*nn+g*g*jj+2*a*b*xn+2*a*g*jx+2*b*g*jn))
        return (a*sx+b*sn+g*sj)/length
    def stored(w,g):return f"w{w:03}-j{g:03}"
    for w in range(0,101,1 if plan=="sent55" else 5):add(stored(w,0),blend(w/100,0),display)
    add("joint",sj,display)
    if plan=="sent55":
        for g in range(5,100,5):
            for w in range(0,101,5):add(stored(w,g),blend(w/100,g/100),display)
        mix=blend(.30,0);u=norm(.7*X+.3*N)
        for g in range(5,100,5):add(f"score{g:03}",(1-g/100)*mix+(g/100)*sj,display)
        best=norm(.3*X+.2*N+.5*J)
        assert np.max(np.abs((Q@best.T)-blend(.4,.5)))<.000008
        included=(cnt>0);diagnostics["keyCosines"].extend(dot(u,J)[included].tolist())
        a=np.argsort(-mix,axis=1,kind="stable");b=np.argsort(-sj,axis=1,kind="stable")
        ar=np.argsort(a,axis=1)+1;br=np.argsort(b,axis=1)+1
        for k in [10,60]:
            for aj in [.5,.65]:
                add(f"rrf{k}-{round(aj*100)}",aj/(k+ar)+(1-aj)/(k+br),display)
        # First-seen order when alternately drawing from the two complete lists.
        add("alternate-add-first",-np.minimum(2*ar-1,2*br),display)
        add("alternate-joint-first",-np.minimum(2*ar,2*br-1),display)
        add("larger-cosine",np.maximum(mix,sj),display)
        for x,y in zip(a[:,:5],b[:,:5]):
            diagnostics["overlap"].append([int(x[0]==y[0]),len(set(x)&set(y)),len(x)])
    if plan=="blocks256":
        contained=[(Q@norm(V[P[cc]]).T) if cc else sx[:,i:i+1] for i,cc in enumerate(children)]
        which=np.stack([m.argmax(axis=1) for m in contained],axis=1)
        bs=np.stack([m.max(axis=1) for m in contained],axis=1);sc=(bs+sx)*.5
        add("whole-parent",sx,bare);add("best-sentence",sc,bare)
        for qi,(old,new) in enumerate(zip(sx.argmax(axis=1),sc.argmax(axis=1))):
            def explain(i):
                atom=children[i][which[qi,i]] if children[i] else cores[i]
                return dict(core=int(cores[i]),atom=int(atom),whole=float(sx[qi,i]),best=float(bs[qi,i]),combined=float(sc[qi,i]))
            records.append([explain(old),explain(new)])
def scope_ranking(plan,cores,children,V,P,Q,neighbor,view,bare,add,*_):
    Q=engine.unit(Q);sx=Q@engine.unit(V[P[cores]]).T
    bs=np.stack([(Q@engine.unit(V[P[cc]]).T).max(axis=1) if cc else sx[:,i] for i,cc in enumerate(children)],axis=1)
    sc=(sx+bs)*.5
    add("core",sc,bare)
    for gate,ls in neighbor.items():
        shown=np.array([view([l,c,r]) for c,(l,r,_) in zip(cores,ls)])
        add(gate,sc,shown)
def load_group(key,stage,extra_root=OUT):
    meta=registry[key];data=json.loads((ROOT/("audited-data" if meta["fold"]=="fresh" else "data")/(key+".json")).read_bytes())
    group=[]
    for i,d in enumerate(data["docs"]):
        p=ROOT/"indexes"/key/str(i);ix=readgz(p.with_suffix(".json.gz"));bb=p.with_suffix(".f32").read_bytes()
        assert hashlib.sha256(bb).hexdigest()==ix["vectorSHA256"]
        V=np.frombuffer(bb,dtype="<f4").reshape(-1,ix["dimension"]);assert len(ix["questions"])==len(d["questions"])
        for q,cor in zip(ix["questions"],d["questions"],strict=True):
            assert q["id"]==cor["id"];q.update(cor)
        if stage=="weights":ix["plans"]={k:v for k,v in ix["plans"].items() if k in ("blocks256","sent25","sent40","sent55")}
        elif stage!="original":
            pre=extra_root/"indexes"/key/str(i);extra=readgz(pre.with_suffix(".json.gz"));file=pre.with_suffix(".f32").read_bytes()
            assert extra["original"]==ix["inputHash"] and hashlib.sha256(file).hexdigest()==extra["vectorSHA256"]
            V=np.concatenate([V,np.frombuffer(file,dtype="<f4").reshape(-1,ix["dimension"])])
            ix["passages"]+=extra["passages"];ix["members"].update(extra["members"]);ix["plans"]=extra["plans"];ix["configs"]=extra["configs"]
        group.append((d,ix,V))
        if meta["pool"]!="collection":yield group;group=[]
    if group:yield group
def score(key,stage):
    arrays=[];meta=[];examples=[];agreement=[];keyCos=[]
    for group in load_group(key,stage):
        diag={"keyCosines":[],"overlap":[]};records=[]
        callback=functools.partial(ranking,diagnostics=diag,records=records) if stage=="weights" else scope_ranking
        vals=engine.evaluate(group,experiment=callback)
        if not vals:continue
        qs,res,_=vals;names=sorted(res);meta+=qs;arrays.append(np.stack([res[n] for n in names]))
        if stage=="weights":
            keyCos+=diag["keyCosines"];agreement+=diag["overlap"]
            def locate(pid):
                for d,ix,_ in group:
                    if pid<len(ix["passages"]):return [d["id"],pid]
                    pid-=len(ix["passages"])
            for q,pair in zip(qs,records,strict=True):
                for hit in pair:
                    for keyname in ["core","atom"]:hit[keyname]=locate(hit[keyname])
                examples.append(pair)
    dest=OUT/stage;dest.mkdir(exist_ok=True,parents=True)
    np.savez_compressed(dest/(key+".npz"),names=names,scores=np.concatenate(arrays,axis=1),overlap=np.array(agreement),keyCos=np.array(keyCos,np.float32))
    (dest/(key+".json")).write_text(json.dumps(meta,ensure_ascii=False),encoding="utf8")
    if examples:(dest/(key+".examples.gz")).write_bytes(gzip.compress(json.dumps(examples).encode(),mtime=0))
def run(stage,jobs):
    def worker(key):
        if stage=="scopes":subprocess.run(["node",str(HERE/"scope-weights-index.mjs"),key],check=True)
        subprocess.run([sys.executable,__file__,stage,key],check=True)
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:list(ex.map(worker,registry))
if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("stage",choices=["weights","scopes"]);parser.add_argument("key",nargs="?");parser.add_argument("--jobs",type=int,default=3);args=parser.parse_args()
    if args.key:score(args.key,args.stage)
    else:run(args.stage,args.jobs)
