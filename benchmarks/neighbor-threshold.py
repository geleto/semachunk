"""Search the full candidate pools for each split threshold and neighbor treatment."""
import argparse
import collections
import functools
import gzip
import hashlib
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
LIB = runpy.run_path(str(HERE / "paragraph-ranking.py"))
EV = LIB["ev"]
ROOT = HERE / ".cache/neighbor-threshold"
PREVIOUS = LIB["ROOT"]
PROTOCOL = json.loads((HERE / "neighbor-threshold-protocol.json").read_bytes())
CUTOFFS = [str(x) for x in PROTOCOL["cutoffs"]]
BASE = ("blocks", "", "core", 0, 0)
TUNED = ("tuned", "", "core", 0, 0)
METRICS = ("first", "five", "f1", "tokens")


def zipped(path):
    with gzip.open(path) as f:
        return json.load(f)


def all_profiles():
    profiles = [BASE, TUNED]
    for cutoff in CUTOFFS:
        for method, weights in PROTOCOL["weights"].items():
            for weight in weights:
                profiles.extend((layout, cutoff, method, weight, 0) for layout in ("semantic", "combined"))
                if (method, weight) in (("core", 0), ("chunk", .30), ("sentence", .30), ("joint", 1)):
                    profiles.extend(("parent", cutoff, method, weight, share) for share in PROTOCOL["parentShares"])
    return profiles


def questions_and_pools(fold, wider=False, index_root=ROOT, layout_labels=None, collection_key=None):
    split = fold.removeprefix("shared-")
    traces = zipped(PREVIOUS / (fold+"-traces.json.gz"))
    traces = {(r["source"], r["question"]):r["hits"] for r in traces}
    needed = collections.defaultdict(set)
    for hits in traces.values():
        for name in ("blocks", "incumbent-blocks", "incumbent-tree", "incumbent-union"):
            for owner, local in hits[name]:
                needed[owner].add(local)
    all_docs, groups = [], []
    for key, spec in LIB["REG"].items():
        if spec["fold"] != split or collection_key is not None and key!=collection_key:
            continue
        folder = PREVIOUS / "holdout-data" if split=="holdout" else HERE / ".cache/context-mixtures" / ("audited-data" if split=="fresh" else "data")
        raw = json.loads((folder / (key+".json")).read_bytes())
        collection = []
        for i, src in enumerate(raw["docs"]):
            stem = index_root / key / str(i)
            ix = zipped(stem.with_suffix(".json.gz"))
            old = zipped((PREVIOUS / key / str(i)).with_suffix(".json.gz"))
            assert ix["id"] == old["id"] == src["id"]
            assert set(ix["layouts"]) == (layout_labels if layout_labels is not None else {"blocks", *CUTOFFS})
            ordinal = EV.ordinals(src["source"])
            remap = {}
            for j in needed[ix["id"]]:
                remap[j] = len(ix["views"])
                ix["views"].append(old["views"][j])
            if wider:
                budget = wider=="budget"
                extra = zipped(stem.with_suffix(".budget.json.gz" if budget else ".windows.json.gz"))
                assert extra["baseStamp"]==ix["stamp"]
                if budget:
                    with stem.with_suffix(".budget.f32").open("rb") as file:
                        assert hashlib.file_digest(file,"sha256").hexdigest()==extra["vectorHash"]
                offset = len(ix["views"])
                ix["views"].extend(extra["views"])
                for label,entries in extra["layouts"].items():
                    for c,wide in zip(ix["layouts"][label],entries,strict=True):
                        for radius,w in wide.items():
                            c["win"+radius] = offset+w["win"]
                            c["near"+radius] = w["near"]
                            if budget:
                                c["budgetKey"] = w["joint"]
            for v in ix["views"]:
                v["ink"] = EV.union((ordinal[a], ordinal[b]) for a,b in v["ranges"])
                v["size"] = EV.size(v["ink"])
                v["length"] = EV.size(v["raw"])
            collection.append(dict(id=ix["id"], domain=spec["domain"], ix=ix, o=ordinal,
                                   file=stem.with_suffix(".f32"), old=remap))
        all_docs.extend(collection)
        groups.extend([collection] if spec["pool"]=="collection" else [[doc] for doc in collection])
    if fold.startswith("shared-"):
        groups = [all_docs]
    def batches():
        for group in groups:
            if not any(d["ix"]["qs"] for d in group):
                continue
            pool = LIB["Pool"](group, accept_shared_holdout_citations=fold=="shared-holdout",
                               stream_vectors=index_root!=ROOT)
            qs, refs, sims = pool.qs, pool.refs, pool.sim
            for start in range(0,len(qs),96):
                section = slice(start,start+96)
                pool.qs, pool.refs, pool.sim = qs[section], refs[section], [s[section] for s in sims]
                for name in ("fraction","evidence","grade","related"):
                    getattr(pool,name).cache_clear()
                yield pool
    return all_docs, traces, batches()


class UnitRows:
    def __init__(self, file):
        self.raw = np.memmap(file, dtype="<f4", mode="r").reshape(-1,1536)
        squared = np.einsum("ij,ij->i", self.raw, self.raw, dtype=np.float64)
        self.scale = 1 / np.maximum(np.sqrt(squared),1e-100)

    def __getitem__(self, ids):
        return self.raw[ids] * self.scale[ids,None]


@functools.lru_cache(maxsize=80)
def matrix(file):
    return UnitRows(file)


def dot_rows(a, b):
    return np.einsum("ij,ij->i", a, b)


def side_ids(cs, index, kind):
    c = cs[index]
    if kind=="cross":
        return [cs[j]["v"] for j in (index-1,index+1) if 0<=j<len(cs)]
    return c[kind]


def cosine_mix(center, side, dot, weight):
    if np.isscalar(weight) and weight==1:
        return side
    den = np.sqrt(np.maximum(1e-12, (1-weight)**2 + 2*weight*(1-weight)*dot + weight**2))
    return ((1-weight)*center + weight*side)/den


class Features:
    def __init__(self, pool, label):
        self.pool, self.label = pool, label
        self.groups = [d["ix"]["layouts"][label] for d in pool.docs]
        self.entries = [c for cs in self.groups for c in cs]
        self.core = np.concatenate([s[:,[c["v"] for c in cs]] for s,cs in zip(pool.sim,self.groups)], axis=1)
        self.owners = np.repeat(np.arange(len(pool.docs)), [len(cs) for cs in self.groups])
        self.win = np.array([off+c["win"] for off,cs in zip(pool.offsets,self.groups) for c in cs])
        self.bare = np.array([off+c["bare"] for off,cs in zip(pool.offsets,self.groups) for c in cs])
        self.tokens = np.array([pool.views[v]["tokens"] for v in self.bare])
        self.has_pa = np.array([bool(c["pa"]) for c in self.entries])
        self.has_sec = np.array([c["section"]>=0 for c in self.entries])
        self.paragraph = np.column_stack([s[:,c["pa"]].max(axis=1) if c["pa"] else s[:,c["v"]]
                          for s,cs in zip(pool.sim,self.groups) for c in cs])
        self.section = np.concatenate([s[:,[max(0,c["section"]) for c in cs]] for s,cs in zip(pool.sim,self.groups)],axis=1)
        self.side_features = {}
        self.joint_features = None

    def score(self, core):
        base = .5*(core+np.where(self.has_pa,self.paragraph,core))
        return .85*base+.15*np.where(self.has_sec,self.section,base)

    def sides(self, kind):
        if kind in self.side_features:
            return self.side_features[kind]
        parts = collections.defaultdict(list)
        for d,s,cs in zip(self.pool.docs,self.pool.sim,self.groups):
            if not cs:
                continue
            ids = [side_ids(cs,j,kind) for j in range(len(cs))]
            center = np.array([c["v"] for c in cs])
            left = np.array([ne[0] if ne else v for ne,v in zip(ids,center)])
            right = np.array([ne[-1] if ne else v for ne,v in zip(ids,center)])
            m = matrix(d["file"])
            parts["left"].append(s[:,left])
            parts["right"].append(s[:,right])
            parts["cl"].append(dot_rows(m[center],m[left]))
            parts["cr"].append(dot_rows(m[center],m[right]))
            parts["lr"].append(dot_rows(m[left],m[right]))
            parts["fixed"].append((left==center)&(right==center))
            parts["two"].append(np.array([len(ne)==2 for ne in ids]))
            if kind=="chunk":
                joint = np.array([c["joint"] for c in cs])
                parts["nj"].append((dot_rows(m[left],m[joint])+dot_rows(m[right],m[joint]))*.5)
        data = {k:np.concatenate(v,axis=-1) for k,v in parts.items()}
        data["mean"] = .5*(data["left"]+data["right"])
        data["dot"] = .5*(data["cl"]+data["cr"])
        data["norm2"] = .5*(1+data["lr"])
        self.side_features[kind] = data
        return data

    def joint(self):
        if self.joint_features is None:
            scores, dots, fixed = [], [], []
            for d,s,cs in zip(self.pool.docs,self.pool.sim,self.groups):
                if not cs:
                    continue
                core = np.array([c["v"] for c in cs])
                key = np.array([c["joint"] for c in cs])
                m = matrix(d["file"])
                scores.append(s[:,key])
                dots.append(dot_rows(m[core],m[key]))
                fixed.append(core==key)
            self.joint_features = (np.concatenate(scores,axis=1),np.concatenate(dots),np.concatenate(fixed))
        return self.joint_features

    def ranking_key(self, method, weight):
        if method=="core":
            return self.core
        if method=="joint":
            side, dot, fixed = self.joint()
            return np.where(fixed,self.core,cosine_mix(self.core,side,dot,weight))
        data = self.sides(method if method in ("sentence","visible","cross") else "chunk")
        if method=="short":
            weight = weight*np.minimum(1,64/np.maximum(self.tokens,1))
        elif method=="bridge":
            bridge = data["two"] & (data["lr"]>=.45) & (data["lr"]>=np.maximum(data["cl"],data["cr"])+.10)
            weight = np.where(bridge,2*weight,weight)
        if method=="bestSide":
            mix = np.maximum(cosine_mix(self.core,data["left"],data["cl"],weight),
                             cosine_mix(self.core,data["right"],data["cr"],weight))
        elif method=="three":
            joint, cj, same = self.joint()
            a, b, c = .49, .21, .30
            den = np.sqrt(a*a+b*b*data["norm2"]+c*c+2*a*b*data["dot"]+2*a*c*cj+2*b*c*data["nj"])
            mix = (a*self.core+b*data["mean"]+c*joint)/den
            return np.where(data["fixed"]&same,self.core,mix)
        else:
            den = np.sqrt((1-weight)**2 + 2*weight*(1-weight)*data["dot"] + weight**2*data["norm2"])
            mix = ((1-weight)*self.core + weight*data["mean"])/den
            if method=="dual":
                mix = np.maximum(self.core,mix)
        return np.where(data["fixed"],self.core,mix)


def parent_groups(pool, blocks, semantic):
    parents = [[] for _ in blocks.win]
    b0 = s0 = 0
    for bs,ss in zip(blocks.groups,semantic.groups):
        j = 0
        for i in range(len(ss)):
            child = pool.views[semantic.bare[s0+i]]["raw"]
            while j<len(bs) and pool.views[blocks.bare[b0+j]]["raw"][-1][1]<=child[0][0]:
                j+=1
            if j<len(bs):
                parent = pool.views[blocks.bare[b0+j]]["raw"]
                if EV.size(EV.intersect(parent,child))==EV.size(child):
                    parents[b0+j].append(s0+i)
        b0+=len(bs)
        s0+=len(ss)
    return parents


def top_views(pool, scores, windows, verify=False, overlap=.75):
    rows = []
    for i,row in enumerate(scores):
        # Partition only identifies a score boundary. Retain every tie there and expand
        # until five distinct hits exist or every candidate has been considered.
        count = min(24,len(row))
        while True:
            if count==len(row):
                order = np.argsort(-row,kind="stable")
            else:
                cutoff = np.partition(row,len(row)-count)[len(row)-count]
                eligible = np.flatnonzero(row>=cutoff)
                order = eligible[np.argsort(-row[eligible],kind="stable")]
            hits = distinct(pool,windows,order,overlap)
            if len(hits)==5 or count==len(row):
                break
            count = min(len(row),count*2)
        if verify and i%31==0:
            assert hits==distinct(pool,windows,np.argsort(-row,kind="stable"),overlap)
        rows.append(hits)
    return rows


def distinct(pool, windows, order, overlap=.75):
    hits = []
    for j in order:
        v = int(windows[j])
        if any(pool.fraction(min(v,h),max(v,h))>=overlap for h in hits):
            continue
        hits.append(v)
        if len(hits)==5:
            break
    return tuple(hits)


def complete_possible(pool, features):
    by_source = collections.defaultdict(list)
    for j in set(features.win.tolist()):
        owner = pool.docs[pool.owners[j]]["id"]
        by_source[owner].append(pool.views[j]["ink"])
    possible = []
    for refs in pool.refs:
        ok = False
        for owner,ref in refs:
            target = EV.size(ref)
            if any(spans[0][0]<=ref[0][0] and spans[-1][1]>=ref[-1][1] and
                   EV.size(EV.intersect(spans,ref))==target for spans in by_source[owner] if spans):
                ok = True
                break
        possible.append(ok)
    return np.array(possible)


def geometry(docs, label):
    entries = [(d["ix"]["views"][c["bare"]], d["ix"]["views"][c["win"]])
               for d in docs for c in d["ix"]["layouts"][label]]
    return dict(chunks=len(entries), medianCore=float(np.median([v["tokens"] for v,_ in entries])),
                medianWindow=float(np.median([w["tokens"] for _,w in entries])),
                meanWindow=float(np.mean([w["tokens"] for _,w in entries])))


def mean_by_domain(values, groups):
    return np.mean([values[idx].mean(axis=0) for idx in groups.values()],axis=0)


def study(fold, profiles):
    docs, traces, pools = questions_and_pools(fold)
    measurements = collections.defaultdict(list)
    ceilings = collections.defaultdict(list)
    questions = []
    checked = 0
    for pool in pools:
        questions.extend((d["domain"],d["id"],q["id"]) for d,q in pool.qs)
        offsets = {d["id"]:(off,d["old"]) for off,d in zip(pool.offsets,pool.docs)}
        def archived(which):
            return [tuple(offsets[s][0]+offsets[s][1][v] for s,v in traces[d["id"],q["id"]][which]) for d,q in pool.qs]

        def record(p, hits, check=None):
            if check:
                expected = archived(check)
                for got, wanted in zip(hits,expected,strict=True):
                    assert len(got)==len(wanted)
                    assert all(pool.owners[a]==pool.owners[b] and pool.views[a]["raw"]==pool.views[b]["raw"]
                               for a,b in zip(got,wanted)), (fold,p,got,wanted)
            measurements[p].extend(pool.grade(i,row)[:4] for i,row in enumerate(hits))

        blocks = Features(pool,"blocks")
        b_score = blocks.score(blocks.core)
        record(BASE,top_views(pool,b_score,blocks.win,verify=True),"incumbent-blocks")
        record(TUNED,archived("blocks"))
        structural_ceiling = complete_possible(pool,blocks)
        ceilings["blocks"].extend(structural_ceiling)
        for cutoff in CUTOFFS:
            selected = [p for p in profiles if p[1]==cutoff]
            if not selected:
                continue
            sem = Features(pool,cutoff)
            perm = np.argsort(np.concatenate((blocks.owners,sem.owners)),kind="stable")
            combined_views = np.concatenate((blocks.win,sem.win))[perm]
            parents = parent_groups(pool,blocks,sem)
            capacity = complete_possible(pool,sem)
            ceilings["semantic/"+cutoff].extend(capacity)
            ceilings["combined/"+cutoff].extend(capacity|structural_ceiling)
            operations = collections.defaultdict(list)
            for p in selected:
                operations[p[2],p[3]].append(p)
            for (method,weight),trials in operations.items():
                kind = method if method in ("sentence","visible","cross") else "chunk"
                # Release large query-by-candidate arrays before changing neighbor granularity.
                for old in list(sem.side_features):
                    if old!=kind:
                        del sem.side_features[old]
                semantic_score = sem.score(sem.ranking_key(method,weight))
                child_score = None
                for p in trials:
                    if p[0]=="semantic":
                        scores, windows = semantic_score, sem.win
                    elif p[0]=="combined":
                        scores = np.concatenate((b_score,semantic_score),axis=1)[:,perm]
                        windows = combined_views
                    else:
                        if child_score is None:
                            child_score = np.column_stack([semantic_score[:,children].max(axis=1) if children else b_score[:,j]
                                                          for j,children in enumerate(parents)])
                        scores = (1-p[4])*b_score+p[4]*child_score
                        windows = blocks.win
                    check = None
                    if p[1:4]==("0.15","core",0) and p[0] in ("semantic","combined"):
                        check = "incumbent-tree" if p[0]=="semantic" else "incumbent-union"
                    hits = top_views(pool,scores,windows,verify=bool(check) or cutoff=="0.55" and method=="chunk" and weight==.30)
                    record(p,hits,check)
            del sem
        checked += len(pool.qs)*3
        for name in ("fraction","evidence","grade","related"):
            getattr(pool,name).cache_clear()
    groups = {domain:np.array([i for i,q in enumerate(questions) if q[0]==domain]) for domain in sorted({q[0] for q in questions})}
    values = {p:np.asarray(rows) for p,rows in measurements.items()}
    common = {p:mean_by_domain(x,groups) for p,x in values.items()}
    published = json.loads((HERE/"results/2026-11-27-paragraph-ranking.json").read_bytes())["folds"][fold]["nominees"]
    for p,name in [(BASE,"incumbent-blocks"),(TUNED,"blocks"),(("combined","0.15","core",0,0),"incumbent-union")]:
        assert np.allclose(common[p], [published[name]["rates"][k] for k in METRICS],atol=1e-8,rtol=0)
    costs = {l:geometry(docs,l) for l in ["blocks",*CUTOFFS]}
    for k,rows in ceilings.items():
        ceilings[k] = float(mean_by_domain(np.array(rows),groups))
    return questions,groups,values,common,dict(geometry=costs,singlePassageCeiling=ceilings,orderedArchiveChecks=checked)


def nominate(common):
    priority = {m:i for i,m in enumerate(("core","chunk","sentence","visible","cross","short","bestSide","dual","bridge","joint","three"))}
    selected = {}
    for layout in ("semantic","combined","parent"):
        for regime in ("any","strict"):
            eligible = [p for p in common if p[0]==layout and (regime=="any" or float(p[1])>=.40)]
            for target in ("balanced","first","five"):
                def quality(p):
                    scores = common[p]
                    return (scores[0]+scores[1])/2 if target=="balanced" else scores[int(target=="five")]
                top = max(map(quality,eligible))
                close = [p for p in eligible if quality(p)>=top-.0035]
                winner = min(close,key=lambda p:(priority[p[2]],p[3],-common[p][2],-quality(p),p))
                selected["/".join((layout,regime,target))] = winner
    return selected


def observed_profiles(selected):
    frozen = {tuple(p) for p in selected.values()}
    for p in list(frozen):
        layout,cutoff,method,weight,share = p
        frozen.update([(layout,cutoff,"core",0,share),(layout,"0.15",method,weight,share)])
    for p in all_profiles():
        layout,cutoff,method,weight,share = p
        if layout in ("blocks","tuned"):
            frozen.add(p)
        elif layout=="parent":
            if share==.50 and (method,weight) in (("core",0),("chunk",.30)):
                frozen.add(p)
        elif (method=="core" or method=="chunk" and weight in (.15,.30,.36,.50,.70)
              or method=="sentence" and weight==.36 or method=="joint" and weight==1):
            frozen.add(p)
    return [p for p in all_profiles() if p in frozen]


def bootstrap_weights(questions, groups):
    rng = np.random.default_rng(56291)
    out = np.zeros((3000,len(questions)))
    for indices in groups.values():
        sources = sorted({questions[i][1] for i in indices})
        ids = np.array([sources.index(questions[i][1]) for i in indices])
        sample = rng.multinomial(len(sources),np.full(len(sources),1/len(sources)),size=len(out))
        draws = sample[:,ids]
        out[:,indices] = draws/(draws.sum(axis=1)[:,None]*len(groups))
    return out


def save(fold, selected, measurements):
    questions, groups, values, averages, extra = measurements
    def key(p):
        return "/".join(map(str,p))
    result = dict(sourcesWithQuestions=len({q[1] for q in questions}),questions=len(questions),
                  domains={d:len(idx) for d,idx in groups.items()},**extra)
    result["rates"] = {key(p):x.tolist() for p,x in averages.items()}
    inspect = dict(selected)
    for layout in ("semantic","combined"):
        for cutoff in ("0.15","0.4","0.55","0.75"):
            inspect[layout+"/"+cutoff] = (layout,cutoff,"chunk",.30,0)
    result["comparisons"] = {}
    weights = bootstrap_weights(questions,groups)
    def intervals(diff):
        return (100*np.quantile(weights@diff[:,:2],[.025,.975],axis=0).T).tolist()
    for name,p in inspect.items():
        layout,cutoff,method,weight,share = p
        refs = dict(sameCutoff=(layout,cutoff,"core",0,share), current=("combined","0.15","core",0,0), tunedBlocks=TUNED)
        if cutoff!="0.15":
            refs["sameMethodLoose"] = (layout,"0.15",method,weight,share)
        result["comparisons"][name] = dict(profile=key(p),rates=averages[p].tolist(),
            domains={d:values[p][idx].mean(axis=0).tolist() for d,idx in groups.items()},
            paired95pp={k:intervals(values[p]-values[ref]) for k,ref in refs.items()})
    result["interaction"] = {}
    for layout in ("semantic","combined"):
        def gain(t):
            return values[layout,t,"chunk",.30,0]-values[layout,t,"core",0,0]
        delta = gain("0.55")-gain("0.15")
        result["interaction"][layout] = dict(deltaPoints=(100*mean_by_domain(delta,groups)[:2]).tolist(),paired95pp=intervals(delta))
    result["selection"] = {name:key(p) for name,p in selected.items()}
    (ROOT/(fold+"-scores.json.gz")).write_bytes(gzip.compress(json.dumps(result,separators=(",",":")).encode(),mtime=0))
    return result


def wider_key(features, radius, weight):
    columns = []
    for doc,s,cs in zip(features.pool.docs,features.pool.sim,features.groups):
        m = matrix(doc["file"])
        for c in cs:
            near = c["near"+str(radius)]
            if not near:
                columns.append(s[:,c["v"]])
                continue
            ids, distances = zip(*near)
            weights = 1/np.array(distances)
            weights /= weights.sum()
            neighbor = weights @ m[list(ids)]
            direction = (1-weight)*m[[c["v"]]][0]+weight*neighbor
            norm = np.linalg.norm(direction)
            columns.append(((1-weight)*s[:,c["v"]]+weight*(s[:,ids]@weights))/norm)
    return np.column_stack(columns)


def budget_joint(features):
    pool = features.pool
    queries = np.vstack([matrix(d["file"])[[q["v"]]][0] for d,q in pool.qs])
    scores, dots = [], []
    for doc,cs in zip(pool.docs,features.groups):
        if not cs:
            continue
        keys = [c["budgetKey"] for c in cs]
        vectors = matrix(doc["file"].with_suffix(".budget.f32"))[keys]
        scores.append(queries@vectors.T)
        dots.append(dot_rows(matrix(doc["file"])[[c["v"] for c in cs]],vectors))
    return np.concatenate(scores,axis=1),np.concatenate(dots)


def window_study(fold, budget=False):
    docs,traces,pools = questions_and_pools(fold,wider="budget" if budget else True)
    observations, ceilings = collections.defaultdict(list),collections.defaultdict(list)
    competition = collections.defaultdict(list)
    questions = []
    cutoffs = ("0.15","0.55") if budget else ("0.15","0.4","0.55","0.75")
    radii = (1,"budget") if budget else (1,2,4)
    for pool in pools:
        questions.extend((d["domain"],d["id"],q["id"]) for d,q in pool.qs)
        offsets = {d["id"]:(off,d["old"]) for off,d in zip(pool.offsets,pool.docs)}
        base_hits = [tuple(offsets[s][0]+offsets[s][1][v] for s,v in traces[d["id"],q["id"]]["blocks"]) for d,q in pool.qs]
        observations["tuned"].extend(pool.grade(i,row)[:4] for i,row in enumerate(base_hits))
        blocks = Features(pool,"blocks")
        baseline = blocks.score(blocks.core)
        structural_first = np.array([pool.grade(i,(int(blocks.win[j]),))[0] for i,j in enumerate(baseline.argmax(axis=1))])
        for t in cutoffs:
            sem = Features(pool,t)
            permutation = np.argsort(np.concatenate((blocks.owners,sem.owners)),kind="stable")
            windows = {1:sem.win}
            for r in radii[1:]:
                windows[r] = np.array([off+c["win"+str(r)] for off,cs in zip(pool.offsets,sem.groups) for c in cs])
            for r,win in windows.items():
                sem.win = win
                ceilings[f"{t}/{r}"].extend(complete_possible(pool,sem))
            sem.win = windows[1]
            if budget:
                full, dot = budget_joint(sem)
            methods = ("core","one","full","joint","jointHalf") if budget else ("core","one","four")
            for method in methods:
                if method=="core": vec = sem.core
                elif method=="one": vec = sem.ranking_key("chunk",.30)
                elif method=="joint": vec = full
                elif method=="jointHalf": vec = cosine_mix(sem.core,full,dot,.5)
                else: vec = wider_key(sem,radii[-1],.30)
                scores = sem.score(vec)
                merged = np.concatenate((baseline,scores),axis=1)[:,permutation]
                semantic_first = permutation[merged.argmax(axis=1)] >= len(blocks.win)
                for r,win in windows.items():
                    both = np.concatenate((blocks.win,win))[permutation]
                    for name,vals,view in [("semantic",scores,win),("combined",merged,both)]:
                        hits = top_views(pool,vals,view)
                        trial = f"{name}/{t}/{method}/{r}"
                        grades = [pool.grade(i,row)[:4] for i,row in enumerate(hits)]
                        observations[trial].extend(grades)
                        if name=="combined" and r in (1,radii[-1]):
                            first = np.array([g[0] for g in grades])
                            competition[trial].extend(zip(semantic_first,first>structural_first,first<structural_first))
            del sem
    groups = {k:np.array([i for i,q in enumerate(questions) if q[0]==k]) for k in sorted({q[0] for q in questions})}
    values = {k:np.array(v) for k,v in observations.items()}
    rates = {k:mean_by_domain(v,groups) for k,v in values.items()}
    selection = ROOT/"window-selection.json"
    if budget:
        winners = {}
    elif fold=="development":
        winners = {}
        for family in ("semantic","combined"):
            for strict in ("any","strict"):
                keys = [k for k in rates if k.startswith(family+"/") and (strict=="any" or float(k.split("/")[1])>=.4)]
                best = max(rates[k][:2].mean() for k in keys)
                close = [k for k in keys if rates[k][:2].mean()>=best-.0035]
                winners[family+"/"+strict] = min(close,key=lambda k:({"core":0,"one":1,"four":2}[k.split("/")[2]],
                                                                      int(k.split("/")[3]),-rates[k][2],k))
        selection.write_text(json.dumps(winners,indent=2))
    else:
        winners = json.loads(selection.read_bytes())
    weights = bootstrap_weights(questions,groups)
    def paired(a,b):
        return (100*np.quantile(weights@(values[a][:,:2]-values[b][:,:2]),[.025,.975],axis=0).T).tolist()
    checked = {k:k for k in rates if k.startswith("combined/")} if budget else {
        **winners, "strict one":"combined/0.55/one/1","strict wider":"combined/0.55/one/4","strict wider ranking":"combined/0.55/four/4"}
    intervals = {}
    for label,k in checked.items():
        mode,t,method,r = k.split("/")
        intervals[label] = dict(profile=k,versusCurrent=paired(k,"combined/0.15/core/1"),versusTunedBlocks=paired(k,"tuned"),
                                versusMatchedCore=paired(k,f"{mode}/{t}/core/{r}"),versusNarrow=paired(k,f"{mode}/{t}/{method}/1"))
        if budget:
            intervals[label]["versusSameMethodAtLooseCutoff"] = paired(k,f"{mode}/0.15/{method}/{r}")
    sizes = {}
    for t in cutoffs:
        for radius in radii:
            key = "win" if radius==1 else f"win{radius}"
            lengths = [d["ix"]["views"][c[key]]["tokens"] for d in docs for c in d["ix"]["layouts"][t]]
            sizes[f"{t}/{radius}"] = float(np.median(lengths))
    result = dict(selection=winners,comparisons=intervals,questions=len(questions),medianWindow=sizes,
                  firstHitChangesVsBlocks={k:mean_by_domain(np.asarray(v),groups).tolist() for k,v in competition.items()},
                  semanticSinglePassageCeiling={k:float(mean_by_domain(np.array(v),groups)) for k,v in ceilings.items()},
                  rates={k:v.tolist() for k,v in rates.items()})
    study_name = "budget" if budget else "windows"
    (ROOT/(fold+"-"+study_name+".json.gz")).write_bytes(gzip.compress(json.dumps(result,separators=(",",":")).encode(),mtime=0))
    print(fold,study_name,len(rates)-1,winners,flush=True)


def verify_vectors():
    _,_,pools = questions_and_pools("development")
    domains, checks = set(), collections.Counter()
    max_error = 0.
    for pool in pools:
        domain = pool.docs[0]["domain"]
        if domain in domains:
            continue
        domains.add(domain)
        qdoc,query = pool.qs[0]
        q = matrix(qdoc["file"])[[query["v"]]][0]
        for t in ("0.15","0.55","0.75"):
            f = Features(pool,t)
            for method,ws in PROTOCOL["weights"].items():
                w = ws[len(ws)//2]
                scores = f.ranking_key(method,w)
                off = 0
                for d,cs in zip(pool.docs,f.groups):
                    m = matrix(d["file"])
                    for j in sorted({0,len(cs)//2,len(cs)-1}) if cs else ():
                        c = cs[j]
                        center = m[[c["v"]]][0]
                        kind = method if method in ("sentence","visible","cross") else "chunk"
                        side = side_ids(cs,j,kind)
                        vectors = m[side] if side else center[None,:]
                        mean = vectors.mean(axis=0)
                        joint = m[[c["joint"]]][0]
                        share = w
                        if method=="short":
                            share *= min(1,64/max(1,d["ix"]["views"][c["bare"]]["tokens"]))
                        if method=="bridge" and len(side)==2:
                            lr = vectors[0]@vectors[1]
                            if lr>=.45 and lr>=max(vectors@center)+.1: share*=2
                        keys = [(1-share)*center+share*mean]
                        if method=="core": keys = [center]
                        if method=="three": keys = [.49*center+.21*mean+.30*joint]
                        if method=="joint": keys = [(1-w)*center+w*joint]
                        if method=="bestSide": keys = [(1-w)*center+w*v for v in vectors]
                        if method=="dual": keys.append(center)
                        expected = max(q@v/np.linalg.norm(v) for v in keys)
                        error = abs(expected-scores[0,off+j])
                        assert error<1e-10,(domain,t,method,error)
                        max_error = max(max_error,error)
                        checks[method]+=1
                    off+=len(cs)
    assert len(domains)==7
    verification = dict(directChecks=dict(checks),maxCosineError=max_error,domains=sorted(domains))
    (ROOT/"verification.json").write_text(json.dumps(verification,indent=2))
    print(verification,flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--windows",action="store_true",help="Cross neighbor radius at ranking with radius at display")
    parser.add_argument("--budget",action="store_true",help="Grow the reading window to the same token budget at both cutoffs")
    parser.add_argument("folds",nargs="+",choices=("development","confirmation","fresh","shared-fresh","holdout","shared-holdout","verify","publish"))
    args = parser.parse_args()
    for fold in args.folds:
        if fold=="verify":
            verify_vectors()
            continue
        if fold=="publish":
            folds = ["development","confirmation","fresh","shared-fresh","holdout","shared-holdout"]
            results = {f:zipped(ROOT/(f+"-scores.json.gz")) for f in folds}
            if args.windows:
                for fold,data in results.items():
                    data["windows"] = zipped(ROOT/(fold+"-windows.json.gz"))
                    for layout in ("semantic","combined"):
                        for cutoff in ("0.15","0.4","0.55","0.75"):
                            for method,reference in (("core","core/0"),("one","chunk/0.3")):
                                assert np.allclose(data["windows"]["rates"][f"{layout}/{cutoff}/{method}/1"],
                                                   data["rates"][f"{layout}/{cutoff}/{reference}/0"],rtol=0,atol=1e-8)
            if args.budget:
                for fold,data in results.items():
                    data["budget"] = zipped(ROOT/(fold+"-budget.json.gz"))
                    for layout in ("semantic","combined"):
                        for cutoff in ("0.15","0.55"):
                            for method,reference in (("core","core/0"),("one","chunk/0.3")):
                                assert np.allclose(data["budget"]["rates"][f"{layout}/{cutoff}/{method}/1"],
                                                   data["rates"][f"{layout}/{cutoff}/{reference}/0"],rtol=0,atol=1e-8)
            out = HERE/"results/2026-11-27-neighbor-threshold.json.gz"
            data = dict(metrics=METRICS,protocol=PROTOCOL,folds=results)
            if args.windows:
                data["verification"] = json.loads((ROOT/"verification.json").read_bytes())
            out.write_bytes(gzip.compress(json.dumps(data,separators=(",",":")).encode(),mtime=0))
            print(out,flush=True)
            continue
        if args.windows or args.budget:
            window_study(fold,budget=args.budget)
            matrix.cache_clear()
            continue
        if fold=="development":
            measured = study(fold,all_profiles())
            selected = nominate(measured[3])
            (ROOT/"selection.json").write_text(json.dumps(selected,indent=2))
        else:
            selected = {k:tuple(v) for k,v in json.loads((ROOT/"selection.json").read_bytes()).items()}
            measured = study(fold,observed_profiles(selected))
        result = save(fold,selected,measured)
        print(fold,result["questions"],len(result["rates"]),"profiles",flush=True)
        for name in ("combined/any/balanced","combined/strict/balanced","parent/strict/balanced"):
            trial = result["comparisons"][name]
            print(name,trial["profile"],[round(100*x,2) for x in trial["rates"][:2]],flush=True)
        matrix.cache_clear()


if __name__=="__main__":
    main()
