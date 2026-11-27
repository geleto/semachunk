"""Compare semantic boundary placement with evenly spaced centres at the same density."""
import argparse
import bisect
import collections
import functools
import gzip
import json
import runpy
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PREV = runpy.run_path(str(HERE / "neighbor-threshold.py"))
PROTOCOL = json.loads((HERE / "passage-placement-protocol.json").read_bytes())
CUTOFFS = [str(x) for x in PROTOCOL["cutoffs"]]
ROOT = HERE / ".cache/passage-placement"
RESULT = HERE / "results/2026-11-27-passage-placement.json.gz"
FOLDS = ("development","confirmation","fresh","shared-fresh","holdout","shared-holdout")
ARMS = ("semantic","even","early","late","lengthMatched","documentEven")
VERSION = 2
FEATURES, EV = PREV["Features"], PREV["EV"]


def packed(path, data):
    path.write_bytes(gzip.compress(json.dumps(data,separators=(",",":"),allow_nan=False).encode(),mtime=0))


def structural_score(f):
    base = .6*f.core+.4*f.paragraph
    return .775*base+.225*np.where(f.has_sec,f.section,base)


def concatenate(parts):
    return np.concatenate(parts,axis=1)


def paired_layout(a_scores, a_views, a_owners, b_scores, b_views, b_owners):
    order = np.argsort(np.concatenate((a_owners,b_owners)),kind="stable")
    return concatenate((a_scores,b_scores))[:,order], np.concatenate((a_views,b_views))[order]


class PassageBank:
    def __init__(self, pool):
        self.pool = pool
        self.sources = [d["ix"]["lattice"] for d in pool.docs]
        sizes = [len(s["rows"]) for s in self.sources]
        self.offsets = np.cumsum([0,*sizes[:-1]])
        self.owners = np.repeat(np.arange(len(sizes)),sizes)
        self.views = np.array([off+r["win"] for off,s in zip(pool.offsets,self.sources) for r in s["rows"]])
        self.scores = concatenate([sim[:,[r["v"] for r in s["rows"]]] for sim,s in zip(pool.sim,self.sources)])
        self.per_source = []
        self.unique_runs = []
        for s,off in zip(self.sources,self.offsets):
            pairs = sorted((pool.views[v]["raw"][0][0],j) for j in range(off,off+len(s["rows"])) for v in [self.views[j]])
            self.per_source.append(([a for a,j in pairs],[j for a,j in pairs]))
            runs = collections.defaultdict(lambda:collections.defaultdict(list))
            for j,r in enumerate(s["rows"]):
                runs[r["scope"]][r["win"]].append(j)
            unique = {}
            rows=s["rows"]
            for scope,windows in runs.items():
                representatives=sorted(ids[(len(ids)-1)//2] for ids in windows.values())
                positions=[rows[j]["pos"] for j in representatives]
                bounds=[rows[j]["pos"] for ids in windows.values() for j in (ids[0],ids[-1])]
                unique[scope]=(representatives,positions,min(bounds),max(bounds))
            self.unique_runs.append(unique)

    def selected(self, cutoff, arm):
        if arm=="distinctEven":
            chosen=[]
            for s,off,runs in zip(self.sources,self.offsets,self.unique_runs):
                counts=collections.defaultdict(set)
                for j in s["selections"][cutoff]["picks"]["semantic"]:
                    r=s["rows"][j]
                    counts[r["scope"]].add(r["win"])
                local=[]
                for scope,windows in counts.items():
                    reps,positions,lo,hi=runs[scope]
                    k=len(windows)
                    last=-1
                    for i in range(k):
                        target=lo+(hi-lo)*(i+.5)/k
                        ix=bisect.bisect_left(positions,target)
                        if ix and (ix==len(positions) or target-positions[ix-1]<=positions[ix]-target):
                            ix-=1
                        last=max(last+1,min(ix,len(reps)-k+i))
                        local.append(reps[last])
                assert len({s["rows"][j]["win"] for j in local})==sum(map(len,counts.values()))
                chosen.extend(off+j for j in sorted(local))
            return np.asarray(chosen,dtype=int)
        return np.concatenate([off+np.asarray(s["selections"][cutoff]["picks"][arm],dtype=int)
                               for s,off in zip(self.sources,self.offsets)])

    @functools.cached_property
    def cover_map(self):
        return {}

    def covering(self, v):
        if v in self.cover_map:
            return self.cover_map[v]
        pool = self.pool
        starts, indices = self.per_source[pool.owners[v]]
        original = pool.views[v]
        lo,hi = original["raw"][0][0],original["raw"][-1][1]
        choices = []
        for j in indices[:bisect.bisect_right(starts,lo)]:
            other = pool.views[self.views[j]]
            if other["raw"][-1][1]<hi or other["length"]<=original["length"]:
                continue
            if EV.size(EV.intersect(original["raw"],other["raw"]))==original["length"]:
                choices.append(j)
        self.cover_map[v] = np.array(choices,dtype=int)
        return self.cover_map[v]

    def guarded(self, baseline, selected):
        eligible = np.zeros(len(self.views),dtype=bool)
        eligible[selected] = True
        result = []
        for qi,row in enumerate(baseline):
            shown = list(row)
            for k,v in enumerate(row):
                candidates = self.covering(v)
                candidates = candidates[eligible[candidates]]
                for j in candidates[np.argsort(-self.scores[qi,candidates],kind="stable")]:
                    w = int(self.views[j])
                    if all(i==k or self.pool.fraction(min(w,u),max(w,u))<.85 for i,u in enumerate(shown)):
                        shown[k] = w
                        break
            result.append(tuple(shown))
        return result


def geometry(docs):
    result = {}
    for t in CUTOFFS:
        count = different = distance = unique_sem = unique_even = shared_views = 0
        length, native_core, native_window = [],[],[]
        for d in docs:
            ix = d["ix"]
            lattice = ix["lattice"]
            selection = lattice["selections"][t]
            picks = selection["picks"]
            n = len(ix["layouts"][t])
            assert all(len(picks[a])==len(set(picks[a]))==n for a in ARMS)
            sem,even = (set(picks[a]) for a in ("semantic","even"))
            rows = lattice["rows"]
            assert collections.Counter(rows[i]["scope"] for i in sem)==collections.Counter(rows[i]["scope"] for i in even)
            bins = lambda ids:collections.Counter((rows[i]["scope"],(rows[i]["tokens"]-1)//64) for i in ids)
            assert bins(sem)==bins(picks["lengthMatched"])
            sv,ev = ({rows[i]["win"] for i in ids} for ids in (sem,even))
            unique_sem+=len(sv); unique_even+=len(ev); shared_views+=len(sv&ev)
            count+=n; different+=len(sem-even); distance+=selection["projectionTokenDistance"]
            length.extend(rows[i]["tokens"] for i in sem)
            native_core.extend(ix["views"][c["bare"]]["tokens"] for c in ix["layouts"][t])
            native_window.extend(ix["views"][c["budgetView"]]["tokens"] for c in ix["layouts"][t])
        result[t] = dict(centres=count, differentPositions=different/count,meanProjectionTokens=distance/count,
                         uniqueSemanticWindows=unique_sem,uniqueEvenWindows=unique_even,sharedWindows=shared_views,
                         medianCommonTokens=float(np.median(length)),medianCore=float(np.median(native_core)),
                         medianNativeTokens=float(np.median(native_window)))
    return result


def score(fold, collection=None):
    docs,traces,pools = PREV["questions_and_pools"](fold,index_root=ROOT,layout_labels={"blocks","tuned",*CUTOFFS},collection_key=collection)
    observed = collections.defaultdict(list)
    questions = []
    guard_changes = collections.Counter()
    for pool in pools:
        questions.extend((d["domain"],d["id"],q["id"]) for d,q in pool.qs)
        offsets = {d["id"]:(off,d["old"]) for off,d in zip(pool.offsets,pool.docs)}
        def record(label, hits, check=None):
            if check:
                for (d,q),row in zip(pool.qs,hits,strict=True):
                    ref=traces[d["id"],q["id"]][check]
                    actual=tuple((pool.docs[pool.owners[v]]["id"],pool.views[v]["raw"]) for v in row)
                    expected=tuple((owner,pool.views[offsets[owner][0]+offsets[owner][1][local]]["raw"]) for owner,local in ref)
                    assert actual==expected,(fold,d["id"],q["id"],label)
            observed[label].extend(pool.grade(i,row)[:4] for i,row in enumerate(hits))
        def run(label, scores, windows, overlap=.85):
            hits = PREV["top_views"](pool,scores,windows,overlap=overlap)
            record(label,hits)
        b, tuned = FEATURES(pool,"blocks"), FEATURES(pool,"tuned")
        bs, ts = b.score(b.core), structural_score(tuned)
        base = PREV["top_views"](pool,ts,tuned.win,verify=True,overlap=.85)
        record("tuned",base,"blocks")
        record("blocks",PREV["top_views"](pool,bs,b.win),"incumbent-blocks")
        bank = PassageBank(pool)
        run("lattice/all",bank.scores,bank.views)
        for t in CUTOFFS:
            f=FEATURES(pool,t)
            full=concatenate([s[:,[c["budgetKey"] for c in cs]] for s,cs in zip(pool.sim,f.groups)])
            win=np.array([off+c["budgetView"] for off,cs in zip(pool.offsets,f.groups) for c in cs])
            for method,vec in (("core",f.core),("one",f.ranking_key("chunk",.30)),("joint",full)):
                scores=f.score(vec)
                run(f"semantic/{t}/{method}",scores,win,.75)
                for family,structural,struct_score,overlap in (("combined",b,bs,.75),("tunedUnion",tuned,ts,.85)):
                    pair=paired_layout(struct_score,structural.win,structural.owners,scores,win,f.owners)
                    run(f"{family}/{t}/{method}",*pair,overlap)
            child=f.score(concatenate([s[:,[c["joint"] for c in cs]] for s,cs in zip(pool.sim,f.groups)]))
            for family,structural,ss,overlap,shares in (("parent",b,bs,.75,(.5,)),
                                                         ("tunedParent",tuned,ts,.85,(.15,.3,.5))):
                parents=PREV["parent_groups"](pool,structural,f)
                best=np.column_stack([child[:,ids].max(axis=1) if ids else ss[:,i] for i,ids in enumerate(parents)])
                for weight in shares:
                    run(f"{family}/{t}/{weight}",(1-weight)*ss+weight*best,structural.win,overlap)
            for arm in (*ARMS,"distinctEven"):
                ids=bank.selected(t,arm)
                scores,windows=bank.scores[:,ids],bank.views[ids]
                run(f"lattice/{t}/{arm}",scores,windows)
                if arm in ("semantic","even","lengthMatched"):
                    pair=paired_layout(ts,tuned.win,tuned.owners,scores,windows,bank.owners[ids])
                    run(f"latticeUnion/{t}/{arm}",*pair)
                if arm in ("semantic","even"):
                    hits=bank.guarded(base,ids)
                    label=f"guard/{t}/{arm}"
                    record(label,hits)
                    guard_changes[label]+=sum(a[0]!=b[0] for a,b in zip(base,hits))
        for name in ("fraction","evidence","grade","related"):
            getattr(pool,name).cache_clear()
    data={k:np.asarray(v) for k,v in observed.items()}
    assert len(set(questions))==len(questions)
    for k,v in data.items():
        if k.startswith("guard/"):
            assert np.all(v[:,:2]>=data["tuned"][:,:2]),(fold,k)
    stem=ROOT/("collections/"+collection if collection else fold)
    np.savez_compressed(str(stem)+"-questions.npz",**data)
    meta=dict(version=VERSION,questions=questions,geometry=geometry(docs),guardChanges=guard_changes,sources=len(docs),
              latticeCentres=sum(len(d["ix"]["lattice"]["rows"]) for d in docs),
              refinements=sum(d["ix"]["lattice"]["refinements"] for d in docs))
    packed(Path(str(stem)+"-meta.json.gz"),meta)
    PREV["matrix"].cache_clear()
    return data,meta


def read_scores(fold):
    with np.load(ROOT/(fold+"-questions.npz")) as f:
        data={k:f[k] for k in f.files}
    return data,PREV["zipped"](ROOT/(fold+"-meta.json.gz"))


def local_collections(fold, wait):
    registry=PREV["LIB"]["REG"]
    keys=[key for key,spec in registry.items() if spec["fold"]==fold]
    (ROOT/"collections").mkdir(exist_ok=True)
    def complete(key):
        p=ROOT/"collections"/(key+"-meta.json.gz")
        return p.exists() and PREV["zipped"](p).get("version")==VERSION
    remaining=[key for key in keys if not complete(key)]
    while remaining:
        for key in list(remaining):
            files=list((PREV["PREVIOUS"]/key).glob("*.detail.json.gz"))
            if not files or any(not (ROOT/key/p.name.replace(".detail","")).exists() for p in files):
                continue
            score(fold,key)
            remaining.remove(key)
            print(fold,key,"scored",flush=True)
            break
        else:
            if not wait:
                raise RuntimeError("Missing completed document indexes for "+", ".join(remaining))
            time.sleep(10)
    chunks=[read_scores("collections/"+key) for key in keys]
    data={k:np.concatenate([d[k] for d,m in chunks]) for k in chunks[0][0]}
    qs=[q for d,m in chunks for q in m["questions"]]
    changes=collections.Counter()
    for d,m in chunks:
        changes.update(m["guardChanges"])
    docs=[dict(ix=PREV["zipped"](p)) for key in keys for p in (ROOT/key).glob("*.json.gz")]
    meta=dict(version=VERSION,questions=qs,geometry=geometry(docs),guardChanges=changes,sources=len(docs),
              latticeCentres=sum(m["latticeCentres"] for d,m in chunks),refinements=sum(m["refinements"] for d,m in chunks))
    assert len(set(tuple(q) for q in qs))==len(qs)
    np.savez_compressed(ROOT/(fold+"-questions.npz"),**data)
    packed(ROOT/(fold+"-meta.json.gz"),meta)
    return data,meta


def by_domain(questions):
    return {d:np.array([i for i,q in enumerate(questions) if q[0]==d]) for d in sorted({q[0] for q in questions})}


def rates(data, groups):
    return {k:PREV["mean_by_domain"](v,groups) for k,v in data.items()}


def nominate(averages):
    choices={}
    for group in ("semantic","combined","tunedUnion","parent","tunedParent","lattice","latticeUnion","guard"):
        keys=[k for k in averages if k.startswith(group+"/") and len(k.split("/"))==3]
        if group in ("lattice","latticeUnion","guard"):
            keys=[k for k in keys if k.endswith("/semantic")]
        gains={k:averages[k][:2]-averages["tuned"][:2] for k in keys}
        best=max(v.min() for v in gains.values())
        close=[k for k in keys if gains[k].min()>=best-.0035]
        mean=max(gains[k].mean() for k in close)
        close=[k for k in close if gains[k].mean()>=mean-.0035]
        def preference(k):
            _,t,method=k.split("/")
            return ({"core":0,"joint":1,"one":2}.get(method,0),float(t),method)
        choices[group]=min(close,key=preference)
    return choices


def publish():
    selected=json.loads((ROOT/"selection.json").read_bytes())
    archive=PREV["zipped"](HERE/"results/2026-11-27-neighbor-threshold.json.gz")
    folds={}
    question_dominance=domain_dominance=None
    for fold in FOLDS:
        data,meta=read_scores(fold)
        qs=meta.pop("questions")
        groups=by_domain(qs)
        avg=rates(data,groups)
        earlier=archive["folds"][fold]["budget"]["rates"]
        for family in ("semantic","combined"):
            for t in ("0.15","0.55"):
                for m in ("core","one","joint"):
                    label=f"{family}/{t}/{m}"
                    assert np.allclose(avg[label],earlier[label+"/budget"],rtol=0,atol=1e-8),(fold,label,avg[label],earlier[label+"/budget"])
        weights=PREV["bootstrap_weights"](qs,groups)
        def compare(a,b):
            diff=data[a]-data[b]
            return dict(delta=(avg[a]-avg[b]).tolist(),paired95pp=(100*np.quantile(weights@diff[:,:2],[.025,.975],axis=0).T).tolist(),
                        gained=(diff[:,:2]>0).sum(axis=0).tolist(),lost=(diff[:,:2]<0).sum(axis=0).tolist(),
                        domainDelta={d:diff[ids].mean(axis=0).tolist() for d,ids in groups.items()})
        contrasts={}
        for t in CUTOFFS:
            for family,arms in (("lattice",(*ARMS[1:],"distinctEven")),("latticeUnion",("even","lengthMatched")),("guard",("even",))):
                a=f"{family}/{t}/semantic"
                for arm in arms:
                    b=f"{family}/{t}/{arm}"
                    contrasts[a+"-"+arm]=compare(a,b)
        for k in {*selected.values(),"lattice/all","lattice/0.55/semantic","lattice/0.15/semantic","tunedParent/0.175/0.5"}:
            contrasts[k+"-blocks"]=compare(k,"tuned")
        for t in CUTOFFS:
            for method in ("one","joint"):
                k=f"combined/{t}/{method}"
                for anchor in ("0.15","0.55"):
                    contrasts[k+"-cutoff"+anchor]=compare(k,f"combined/{anchor}/{method}")
        if fold!="development":
            safe={k for k,v in data.items() if k!="tuned" and np.all(v[:,:2]>=data["tuned"][:,:2])}
            question_dominance=safe if question_dominance is None else question_dominance&safe
            safe_domains={k for k,v in data.items() if k!="tuned" and all(
                np.all(v[ids,:2].sum(axis=0)>=data["tuned"][ids,:2].sum(axis=0)) for ids in groups.values())}
            domain_dominance=safe_domains if domain_dominance is None else domain_dominance&safe_domains
        density={}
        for t in CUTOFFS:
            for arm in ("even","lengthMatched","documentEven","distinctEven"):
                sem=data[f"lattice/{t}/semantic"]-data["lattice/0.15/semantic"]
                ordinary=data[f"lattice/{t}/{arm}"]-data[f"lattice/0.15/{arm}"]
                additional=sem-ordinary
                density[t+"/"+arm]=dict(semanticChange=PREV["mean_by_domain"](sem,groups).tolist(),
                    ordinaryChange=PREV["mean_by_domain"](ordinary,groups).tolist(),
                    additionalChange=PREV["mean_by_domain"](additional,groups).tolist(),
                    paired95pp=(100*np.quantile(weights@additional[:,:2],[.025,.975],axis=0).T).tolist())
        folds[fold]=dict(**meta,count=len(qs),domains={d:len(i) for d,i in groups.items()},
                         rates={k:v.tolist() for k,v in avg.items()},comparisons=contrasts,changesFromLooseDensity=density,
                         tunedBlocksByDomain={d:data["tuned"][ids].mean(axis=0).tolist() for d,ids in groups.items()})
    keys=folds["development"]["rates"].keys()
    def clears(k,fold,strict,reference="tuned"):
        values=folds[fold]["rates"]
        diff=np.array(values[k][:2])-values[reference][:2]
        return bool(np.all(diff>(1e-12)) if strict else np.all(diff>=-1e-12))
    retrospective={s:[k for k in keys if k!="tuned" and all(clears(k,f,strict) for f in FOLDS[1:])]
                   for s,strict in (("strict",True),("tiesAllowed",False))}
    retrospective["strictVersusBothBlocks"]=[k for k in retrospective["strict"] if all(clears(k,f,True,"blocks") for f in FOLDS[1:])]
    retrospective["strictIncludingDevelopment"]=[k for k in retrospective["strict"] if clears(k,"development",True)]
    retrospective["noIndividualCoverageLossVersusTuned"]=sorted(question_dominance)
    retrospective["noDomainCoverageLossVersusTuned"]=sorted(domain_dominance)
    packed(RESULT,dict(protocol=PROTOCOL,metrics=PREV["METRICS"],selected=selected,folds=folds,
                       retrospectiveAcrossFiveValidationSettings=retrospective))
    print(RESULT,flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--await-index",action="store_true",help="Score local collections as their indexes finish")
    parser.add_argument("folds",nargs="+",choices=(*FOLDS,"publish"))
    args=parser.parse_args()
    for fold in args.folds:
        if fold=="publish":
            publish()
            continue
        freeze=ROOT/"selection.json"
        if fold!="development" and not freeze.exists():
            raise RuntimeError("Run development to freeze the settings before evaluating the other search pools")
        data,meta=score(fold) if fold.startswith("shared-") else local_collections(fold,args.await_index)
        if fold=="development":
            freeze.write_text(json.dumps(nominate(rates(data,by_domain(meta["questions"]))),indent=2))
        print(fold,len(meta["questions"]),len(data),"settings scored",flush=True)
