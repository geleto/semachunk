"""Select weights on development, then report paired differences on both reused replication sets."""
import collections,functools,gzip,json,runpy
from pathlib import Path
import numpy as np
lib=runpy.run_path(str(Path(__file__).with_name("scope-weights.py")))
ROOT,OUT,RESULT,REG=lib["ROOT"],lib["OUT"],lib["RESULT"],lib["registry"]
study=lib["study"]
def load(stage,fold):
    by=collections.defaultdict(list);agree=collections.defaultdict(list);cos=[];docmeta={};names=None
    for k,m in REG.items():
        if m["fold"]!=fold:continue
        p=OUT/stage;rows=json.loads((p/(k+".json")).read_bytes());f=np.load(p/(k+".npz"))
        if names is None:names=f["names"].tolist()
        assert names==f["names"].tolist()
        by[m["domain"]].append((rows,f["scores"]))
        if stage=="weights":
            keep=[q["kind"]=="primary" for q in rows];agree[m["domain"]].extend(f["overlap"][keep]);cos+=f["keyCos"].tolist()
        else:
            for i,d in enumerate(m["documents"]):
                x=lib["readgz"](OUT/"indexes"/k/(str(i)+".json.gz"))
                docmeta[d["id"]]=dict(d,domain=m["domain"],headings=x["headings"],effective=x["sectionLabels"],major=x["majorLabels"],
                    counts={s:len(cs) for s,cs in x["plans"].items()},changes=x["stats"],origin=x["headingOrigin"])
    by={d:([q for rr,_ in v for q in rr],np.concatenate([x for _,x in v],axis=1)) for d,v in by.items()}
    return names,by,agree,cos,docmeta
def macro(by):return np.stack(list(study.summaries(by).values())).mean(axis=0)
def family(n):
    if not n.startswith("sent55/"):return ""
    key=n.split("/")[1]
    if key.startswith("score"):return "score interpolation"
    if key.startswith("w"):return "additive" if key.endswith("-j000") else "vector hybrid"
    return "joint"
def choose(names,x,typ,j):
    eligible=[i for i,n in enumerate(names) if family(n)==typ]
    return min(eligible,key=lambda i:(-x[i,j],-x[i,1 if j!=1 else 0],-x[i,2],names[i]))
def refer(by,names,a,b):return study.paired(by,names.index(a),names.index(b))
def weight_report():
    out={};frozen={};examples=[]
    for fold in ["development","confirmation","fresh"]:
        names,by,angles,cos,_=load("weights",fold);ds=study.summaries(by);x=macro(by)
        leaders={t:[names[choose(names,x,t,i)] for i in [0,1,2]] for t in ["additive","vector hybrid","score interpolation"]}
        if fold=="development":frozen=leaders
        def w(i):return f"sent55/w{i:03}-j000"
        j="sent55/joint";g="sent55/score035";a=frozen["additive"][0];h=frozen["vector hybrid"][0]
        alt="sent55/alternate-add-first"
        show=list(dict.fromkeys([w(n) for n in [0,8,15,25,30,35,36,38,40,50,70,85,100]]+[j,g,alt,"sent55/alternate-joint-first","sent55/rrf10-50","sent55/rrf60-50"]+sum(frozen.values(),[])))
        differences={u+" vs "+v:refer(by,names,u,v) for u,v in [(a,w(30)),(a,j),(w(30),j),(g,w(30)),(g,j),(h,a),(h,j),(frozen["additive"][1],j),(alt,j),(alt,w(30)),("sent55/rrf10-50",j)]}
        a30=names.index(w(30));ji=names.index(j)
        def per_domain(d):
            rr,mat=by[d];keep=[q["kind"]=="primary" for q in rr];a=mat[a30,keep];b=mat[ji,keep];over=np.array(angles[d])
            return np.array([over[:,0].mean(),(over[:,1]/over[:,2]).mean(),*((a[:,c]>b[:,c]).mean() for c in [0,1]),
                *((b[:,c]>a[:,c]).mean() for c in [0,1]),np.maximum(a[:,0],b[:,0]).mean()])
        agreement=np.stack([per_domain(d) for d in by]).mean(axis=0)
        leave={dom:names[choose(names,np.stack([v for d,v in ds.items() if d!=dom]).mean(axis=0),"additive",0)] for dom in by}
        within=[[i for i in range(101) if x[names.index(w(i)),j]>=max(x[names.index(w(t)),j] for t in range(101))-.01] for j in (0,1)]
        out[fold]=dict(frozenDevelopment=frozen,foldLeaders=leaders,macro=dict(zip(names,x.tolist())),
            domains={d:{n:v[names.index(n)].tolist() for n in show} for d,v in ds.items()},paired=differences,leaveOneDomainOut=leave,withinOnePoint=within,
            directions=dict(count=len(cos),percentiles10_50_90=np.percentile(cos,[10,50,90]).tolist()),agreement=dict(zip(["sameFirst","top5SetOverlap","addOnlyFirst","addOnlyFive","jointOnlyFirst","jointOnlyFive","eitherFirst"],agreement.tolist())))
    for k,m in REG.items():
        if m["fold"]!="fresh":continue
        p=OUT/"weights";qs=json.loads((p/(k+".json")).read_bytes());f=np.load(p/(k+".npz"));scores=f["scores"];names=f["names"].tolist()
        pairs=lib["readgz"](p/(k+".examples.gz"));docs=json.loads((ROOT/"data"/(k+".json")).read_bytes())["docs"];indices={d["id"]:i for i,d in enumerate(docs)}
        @functools.lru_cache(None)
        def idx(id):return lib["readgz"](ROOT/"indexes"/k/(str(indices[id])+".json.gz"))
        for target in [1,-1]:
            options=[]
            for qi,(q,pair) in enumerate(zip(qs,pairs,strict=True)):
                if q["kind"]!="primary" or scores[names.index("blocks256/best-sentence"),qi,0]-scores[names.index("blocks256/whole-parent"),qi,0]!=target:continue
                desc=[]
                for hit in pair:
                    who,i=hit["atom"];d=idx(who);sentence=d["texts"][d["passages"][i]["v"]]
                    desc.append({**hit,"sentence":sentence,"parentLength":len(d["texts"][d["passages"][hit["core"][1]]["v"]])})
                options.append(dict(domain=m["domain"],id=q["id"],question=q["q"],gain=target,old=desc[0],new=desc[1]))
            if options:examples.append(min(options,key=lambda x:max(len(x[s]["sentence"]) for s in ["old","new"])))
    lib["put"]("weights",out);lib["put"]("examples",examples)
def scope_report():
    out={}
    for fold in ["development","confirmation","fresh"]:
        names,by,_,_,meta=load("scopes",fold);x=macro(by)
        headed={}
        for d,(rows,s) in by.items():
            keep=[i for i,q in enumerate(rows) if q["kind"]=="primary" and meta[q["doc"]]["effective"]>=2]
            if keep:headed[d]=([rows[i] for i in keep],s[:,keep])
        def summarize(b):
            ds=study.summaries(b);avg=macro(b)
            contrasts=[("s25-any/section","s25-any/any"),("s25-section/section","s25-any/any"),("s25-any/section","s25-any/paragraph"),
                ("s25-major/major","s25-any/any"),("s40-section/section","s40-any/any"),("blocks256/section","blocks256/any")]
            return dict(macro=dict(zip(names,avg.tolist())),domains={d:dict(zip(names,v.tolist())) for d,v in ds.items()},
                primary=sum(sum(q["kind"]=="primary" for q in rr) for rr,_ in b.values()),
                paired={a+" vs "+c:refer(b,names,a,c) for a,c in contrasts})
        out[fold]=dict(all=summarize(by),headingSubset=summarize(headed),documents=meta,
            exceptFinance=dict(zip(names,macro({k:v for k,v in by.items() if k!="finance"}).tolist())))
    lib["put"]("scopes",out)
def plot():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import PercentFormatter
    data=json.loads((RESULT/"2026-11-27-scope-weights-weights.json").read_bytes())
    fig,axes=plt.subplots(2,3,figsize=(11.2,5.8),sharex=True,sharey="row",layout="constrained")
    for col,(fold,title) in enumerate([("development","Development"),("confirmation","Earlier confirmation"),("fresh","Reviewed replication")]):
        ds=data[fold]["macro"]
        for row in (0,1):
            ax=axes[row,col];values=[ds[f"sent55/w{w:03}-j000"][row]*100 for w in range(101)]
            lead=data[fold]["foldLeaders"]["additive"][row];w=int(lead.split("/w")[1][:3])
            ax.plot(range(101),values,color="#1a5671",linewidth=1.8,label="Add neighbor vectors")
            ax.axhline(100*ds["sent55/joint"][row],color="#ae531f",ls="--",lw=1.6,label="Re-embed full text")
            ax.scatter(w,values[w],s=25,c="#1a5671",zorder=3)
            ax.annotate(str(w)+"%",(w,values[w]),xytext=(3,5),textcoords="offset points",fontsize=9)
            ax.spines[["top","right"]].set_visible(False);ax.grid(axis="y",alpha=.22)
            ax.yaxis.set_major_formatter(PercentFormatter(100,decimals=0));ax.set_xlim(-1,101);ax.set_xticks([0,25,50,75,100])
        axes[0,col].set_title(title,fontsize=12)
    axes[0,0].set_ylabel("Complete first hit");axes[1,0].set_ylabel("Complete within five")
    axes[0,0].legend(fontsize=8,loc="lower left",frameon=True)
    fig.supxlabel("Total weight allocated to adjacent sentence vectors (%)",fontsize=11)
    fig.suptitle("Uncapped .55 semantic groups with the same displayed sentences",fontsize=14)
    fig.savefig(RESULT/"2026-11-27-scope-weights-curves.png",dpi=150);plt.close(fig)
def verify():
    counts=collections.Counter()
    for key,m in REG.items():
        q1=json.loads((OUT/"weights"/(key+".json")).read_bytes());q2=json.loads((OUT/"scopes"/(key+".json")).read_bytes());assert q1==q2
        w=np.load(OUT/"weights"/(key+".npz"));s=np.load(OUT/"scopes"/(key+".npz"))
        x=w["scores"];y=s["scores"];sn=s["names"].tolist();wn=w["names"].tolist()
        assert np.isfinite(x).all() and np.isfinite(y).all()
        assert (x[:,:,0]<=x[:,:,1]).all() and (y[:,:,0]<=y[:,:,1]).all()
        assert np.array_equal(x[wn.index("sent55/alternate-add-first"),:,0],x[wn.index("sent55/w030-j000"),:,0])
        assert np.array_equal(x[wn.index("sent55/alternate-joint-first"),:,0],x[wn.index("sent55/joint"),:,0])
        for plan in {n.split("/")[0] for n in sn}:
            unrestricted=y[sn.index(plan+"/any")]
            for gate in ["paragraph","section","major","soft40","soft60"]:
                trimmed=y[sn.index(plan+"/"+gate)]
                assert (trimmed[:,:2]<=unrestricted[:,:2]).all() and (trimmed[:,3]<=unrestricted[:,3]).all()
            counts["displaySubsetChecks"]+=5*len(q1)
        for i in range(len(m["documents"])):
            d=lib["readgz"](OUT/"indexes"/key/(str(i)+".json.gz"))
            assert d["plans"]["s40-soft40"]==d["plans"]["s40-any"]
            if d["sectionLabels"]<2:
                for t in [25,40]:assert d["plans"][f"s{t}-section"]==d["plans"][f"s{t}-any"]
            counts["documents"]+=1
        counts["questions"]+=len(q1);counts["primary"]+=sum(z["kind"]=="primary" for z in q1)
    lib["put"]("verification",dict(counts));print(dict(counts))
if __name__=="__main__":
    import sys
    if len(sys.argv)==1 or sys.argv[1]=="weights":weight_report()
    if len(sys.argv)==1 or sys.argv[1]=="scopes":scope_report()
    if len(sys.argv)>1 and sys.argv[1]=="plot":plot()
    if len(sys.argv)>1 and sys.argv[1]=="verify":verify()
