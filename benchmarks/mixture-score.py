"""Rank full pools, then independently score exactly the passages delivered."""
import functools,gzip,hashlib,importlib.util,json,os,sys
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent;ROOT=HERE/".cache/context-mixtures"
spec=importlib.util.spec_from_file_location("evidence",HERE/"context-retrieval-score.py")
ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
proto=json.loads((HERE/"mixture-protocol.json").read_bytes())
def unit(z):
    return z/np.maximum(np.linalg.norm(z,axis=-1,keepdims=True),1e-12)
def dot(a,b):return np.einsum("ij,ij->i",a,b)
def coordinate(a,b):
    # Salience is signed agreement on the union of the strongest coordinates.
    ia=np.argpartition(np.abs(a),-64,axis=1)[:,-64:];ib=np.argpartition(np.abs(b),-64,axis=1)[:,-64:]
    mask=np.zeros(a.shape,bool);np.put_along_axis(mask,ia,True,axis=1);np.put_along_axis(mask,ib,True,axis=1)
    return dot(unit(a*mask),unit(b*mask))
def rotated(a):
    # Fixed signed permutation and orthogonal 2-D rotations mix coefficients and preserve cosine.
    rng=np.random.default_rng(3390)
    y=a[:,rng.permutation(a.shape[1])]*rng.choice(np.array([-1,1],np.float32),a.shape[1])
    for _ in range(6):
        y=y[:,rng.permutation(y.shape[1])];u=y[:,::2].copy();v=y[:,1::2].copy()
        y[:,::2]=(u+v)*np.float32(2**-.5);y[:,1::2]=(u-v)*np.float32(2**-.5)
    return y
def evaluate(group,trace=None,experiment=None):
    ids=[];srcs=[];passages=[];entries=[];metadata=[];vectors=[];questions=[];locations=[]
    for di,(doc,idx,vec) in enumerate(group):
        o=ev.ordinals(doc["source"]);ids.append(doc["id"]);srcs.append(o)
        base=len(passages);vbase=sum(len(x) for x in vectors);vectors.append(vec)
        passages.extend((di,ev.union((o[a],o[b]) for a,b in p["spans"]),vbase+p["v"]) for p in idx["passages"])
        locations.extend((di,i) for i in range(len(idx["passages"])))
        entries.append((base,idx));questions.extend((di,q,vbase+q["v"]) for q in idx["questions"])
    if not questions:return None
    V=np.concatenate(vectors);Q=V[[v for _,_,v in questions]];S=Q@V.T
    P=np.array([p[2] for p in passages]);nq=len(Q)
    views=[];by_view={}
    def view(parts):
        parts=tuple(int(p) for p in parts if p>=0)
        if parts not in by_view:
            di=passages[parts[0]][0];assert all(passages[p][0]==di for p in parts)
            spans=ev.union(s for p in parts for s in passages[p][1])
            by_view[parts]=len(views);views.append((di,spans,ev.size(spans),parts))
        return by_view[parts]
    metrics=[]
    for di,q,_ in questions:
        choices=[(di,ref) for ref in q.get("references",[q.get("ranges")])]
        choices.extend((ids.index(a["source"]),a["ranges"]) for a in q.get("alternativeSources",[]))
        refs=[(k,ev.union((srcs[k][a],srcs[k][b]) for a,b in rr)) for k,rr in choices]
        def make(refs):
            @functools.lru_cache(None)
            def coverage(vi):
                k,sp,n,_=views[vi];pieces=[ev.intersect(sp,r) if k==d else [] for d,r in refs]
                lens=[ev.size(x) for x in pieces]
                return pieces,any(l==ev.size(r) for l,(_,r) in zip(lens,refs)),max(2*l/(n+ev.size(r)) for l,(_,r) in zip(lens,refs))
            @functools.lru_cache(6000)
            def score(hit):
                first=coverage(hit[0]);rest=[coverage(x) for x in hit]
                whole=any(x[1] for x in rest) or any(ev.size(ev.union(s for x in rest for s in x[0][j]))==ev.size(r) for j,(_,r) in enumerate(refs))
                return int(first[1]),int(whole),first[2],views[hit[0]][2]
            return score
        metrics.append(make(refs))
        metadata.append(dict(id=q["id"],doc=ids[di],q=q["text"],kind="section" if q.get("kind")=="section" else "primary"))
    results={};traces={}
    for plan in entries[0][1]["plans"]:
        if trace and not any(k.split("/")[0]==plan for k in trace):continue
        cores=[];children=[];bridges=[];owners=[];neighbor={}
        for di,(offset,idx) in enumerate(entries):
            local=idx["plans"][plan];base=len(cores)
            for c in local:
                cores.append(c+offset);owners.append(di)
                children.append([p+offset for p in idx["members"][str(c)]])
            config=idx["configs"][plan]
            bridges.extend((base+i,a,d,skip+offset,keep+offset) for i,a,d,skip,keep in config["bridges"])
            for k,rows in config["settings"].items():
                neighbor.setdefault(k,[]).extend([[p+offset if p>=0 else -1 for p in row] for row in rows])
        cores=np.array(cores);owners=np.array(owners);n=len(cores);X=V[P[cores]];sx=S[:,P[cores]]
        Y=np.stack([unit(V[P[cc]].mean(axis=0)) if cc else X[i] for i,cc in enumerate(children)])
        sy=Q@Y.T;best=np.stack([S[:,P[cc]].max(axis=1) if cc else sx[:,i] for i,cc in enumerate(children)],axis=1)
        bare=np.array([view([c]) for c in cores]);rows=np.arange(nq)[:,None]
        def add(tag,score,display,lr=None,diverse=False):
            name=plan+"/"+tag
            if trace and name not in trace:return
            order=np.argsort(-score,axis=1,kind="stable");rank=order[:,:5]
            def sel(q,k):return int(display[k] if display.ndim==1 else display[q,k])
            if diverse:
                kept=[]
                for qi,ordr in enumerate(order):
                    take=[]
                    for k in ordr:
                        di,s,ln,_=views[sel(qi,k)]
                        if any(di==views[sel(qi,j)][0] and ev.size(ev.intersect(s,views[sel(qi,j)][1]))>=.75*min(ln,views[sel(qi,j)][2]) for j in take):continue
                        take.append(k)
                        if len(take)==5:break
                    kept.append(take)
            else:kept=rank
            values=[];tt=[]
            for qi,hit in enumerate(kept):
                shown=tuple(sel(qi,k) for k in hit);values.append(metrics[qi](shown))
                if trace:
                    def loc(p):return list(locations[p]) if p>=0 else None
                    tt.append([dict(c=loc(cores[k]),l=loc(lr[k][0]) if lr is not None else None,r=loc(lr[k][1]) if lr is not None else None,
                        display=[loc(p) for p in views[v][3]],score=float(score[qi,k])) for k,v in zip(hit,shown)])
            results[name]=np.array(values,dtype=np.float32)
            if trace:traces[name]=tt
        if experiment is not None:
            experiment(plan,cores,children,V,P,Q,neighbor,view,bare,add)
            continue
        add("core",sx,bare);add("centroid",sy,bare);add("child50",(best+sx)*.5,bare);add("child100",best,bare)
        for mode,ls in neighbor.items():
            if trace and not any(x.startswith(plan+"/"+mode+"/") for x in trace):continue
            lr=np.asarray(ls);l,r,jp=lr.T;hasl=l>=0;hasr=r>=0;cnt=(hasl.astype(int)+hasr)
            L=V[P[np.where(hasl,l,cores)]];R=V[P[np.where(hasr,r,cores)]]
            N=(L*hasl[:,None]+R*hasr[:,None])/np.maximum(cnt,1)[:,None];N=np.where(cnt[:,None],N,X).astype(np.float32)
            J=V[P[jp]];sn=Q@N.T;sj=S[:,P[jp]];xx=dot(X,X);jj=dot(J,J);nn=dot(N,N);xj=dot(X,J);xn=dot(X,N);nj=dot(N,J)
            def mixture(w,g):
                a=1-w-g;norm=np.sqrt(np.maximum(1e-12,a*a*xx+w*w*nn+g*g*jj+2*a*w*xn+2*a*g*xj+2*w*g*nj))
                return (a*sx+w*sn+g*sj)/norm
            viewmap=np.array([[view([l0 if flag&1 else -1,ci,r0 if flag&2 else -1]) for flag in range(4)] for ci,(l0,r0,_) in zip(cores,lr)])
            lscores=S[:,P[np.where(hasl,l,cores)]];rscores=S[:,P[np.where(hasr,r,cores)]]
            def bycos(threshold):
                flags=((lscores>=threshold)&hasl).astype(int)+2*((rscores>=threshold)&hasr)
                return viewmap[np.arange(n),flags]
            displays={"core":bare,"both":viewmap[:,3],"cos25":bycos(.25),"cos40":bycos(.40),"cos55":bycos(.55)}
            ranks={"base":sx,"centroid":sy,"joint":sj,"dual":np.maximum(sx,sj),"child50":.5*(best+sx)}
            for w in proto["reuseWeight"]:ranks["mix"+str(round(100*w))]=mixture(w,0)
            for g in proto["jointWeight"]:ranks["j"+str(round(100*g))]=mixture(0,g)
            for w in proto["reuseWeight"]:
                for g in proto["jointWeight"]:
                    ranks[f"m{round(w*100)}j{round(g*100)}"]=mixture(w,g)
            ranks["dualMix30"]=np.maximum(sx,mixture(.3,0))
            # Joint embedding, actual centroid of the core units, and immediate neighbors.
            yc=.4*Y+.3*N+.3*J;ranks["centroidHybrid"]=Q@unit(yc).T
            for typ,sc in ranks.items():
                for show,deliv in displays.items():
                    if show!="both" and typ not in ("base","mix30","joint","dual","m30j30"):continue
                    add(mode+"/"+typ+"/"+show,sc,deliv,lr)
                if mode.endswith("/allow") and typ in ("dual","mix30"):
                    add(mode+"/"+typ+"/diverse",sc,displays["both"],lr,True)
        if not trace or any(x.startswith(plan+"/abc/") for x in trace):
            for minimum in proto["bridgeMinimum"]:
                for margin in proto["bridgeMargin"]:
                    matching=[t for t in bridges if t[1]>=minimum and t[2]>=margin]
                    for pattern in ("skip","keep"):
                        for target in ("center","ends","all"):
                            scr=sx.copy();delivery=np.broadcast_to(bare,(nq,n)).copy()
                            for k,_,_,skip,keep in matching:
                                pid=skip if pattern=="skip" else keep
                                key=S[:,P[pid]]
                                for dest in ([k] if target=="center" else [k-1,k+1] if target=="ends" else [k-1,k,k+1]):
                                    improve=key>scr[:,dest];scr[improve,dest]=key[improve];delivery[improve,dest]=view([pid])
                            add(f"abc/{round(100*minimum)}-{round(100*margin)}/{pattern}/{target}",scr,delivery)
            valid=np.flatnonzero((owners[:-2]==owners[2:]))+1
            if len(valid):
                def margins(Z,metric):
                    sim=coordinate if metric=="coord" else dot
                    return sim(Z[valid-1],Z[valid+1])-np.maximum(sim(Z[valid-1],Z[valid]),sim(Z[valid],Z[valid+1]))
                amount=sum(a>=.45 and d>=.10 for _,a,d,_,_ in bridges)
                modes={"cosine":margins(X,"cos"),"coordinates":margins(X,"coord"),"rotated":margins(rotated(X),"coord")}
            else:amount=0;modes={name:[] for name in ("cosine","coordinates","rotated")}
            for how,values in modes.items():
                chosen=valid[np.argsort(-np.asarray(values),kind="stable")[:amount]] if amount else []
                score=sx.copy();dv=np.broadcast_to(bare,(nq,n)).copy()
                for k in chosen:
                    v=unit(.35*X[k-1]+.30*X[k]+.35*X[k+1]);s=Q@v
                    for i in (k-1,k,k+1):
                        better=s>score[:,i];score[better,i]=s[better];dv[better,i]=view(cores[k-1:k+2])
                add("abc/salience/"+how,score,dv)
    return metadata,results,traces

def run(key,trace=None,audited=False):
    inputfile=ROOT/("audited-data" if audited else "data")/(key+".json");data=json.loads(inputfile.read_bytes());groups=[];buffer=[]
    for di,doc in enumerate(data["docs"]):
        pre=ROOT/"indexes"/key/str(di);idx=json.loads(gzip.decompress(pre.with_suffix(".json.gz").read_bytes()))
        assert idx["id"]==doc["id"] and idx["model"]==proto["model"]
        if audited:
            for q,correct in zip(idx["questions"],doc["questions"],strict=True):
                assert (q["id"],q["text"])==(correct["id"],correct["text"])
                q.update(correct)
        v=pre.with_suffix(".f32").read_bytes();assert hashlib.sha256(v).hexdigest()==idx["vectorSHA256"]
        vec=np.frombuffer(v,dtype="<f4").reshape(-1,idx["dimension"]);buffer.append((doc,idx,vec))
        if data["pool"]!="collection":groups.append(buffer);buffer=[]
    if buffer:groups.append(buffer)
    allmeta=[];arrays=[];records=[];names=None
    for group in groups:
        out=evaluate(group,trace)
        if out is None:continue
        meta,ranks,hits=out
        if names is None:names=list(ranks)
        assert set(names)==set(ranks)
        arrays.append(np.stack([ranks[k] for k in names]));allmeta+=meta
        if trace:
            for i,q in enumerate(meta):
                records.append({**q,"group":[doc["id"] for doc,_,_ in group],"hits":{k:v[i] for k,v in hits.items()},"metrics":{k:ranks[k][i].tolist() for k in names}})
    d=ROOT/("audited-traces" if audited else "traces" if trace else "scores");d.mkdir(exist_ok=True)
    if trace:(d/(key+".json.gz")).write_bytes(gzip.compress(json.dumps(records,ensure_ascii=False).encode(),mtime=0))
    else:
        np.savez_compressed(d/(key+".npz"),scores=np.concatenate(arrays,axis=1),names=names)
        (d/(key+".json")).write_text(json.dumps(allmeta,ensure_ascii=False),encoding="utf8")
    print(key,len(allmeta),len(names),flush=True)

if __name__=="__main__":
    run(sys.argv[1],set(json.loads(Path(sys.argv[2]).read_bytes())) if len(sys.argv)>2 else None,"--audited" in sys.argv)
