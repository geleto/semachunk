"""Exact, source-aware retrieval for the paragraph ranking study."""
import collections
import functools
import gzip
import hashlib
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
prior = runpy.run_path(str(HERE/"bounded-passages.py"))
ev, report = prior["ev"], prior["report"]
ROOT = HERE/".cache/paragraph-ranking"
PROTOCOL = json.loads((HERE/"paragraph-ranking-protocol.json").read_bytes())
REG = {**prior["registry"], **json.loads((ROOT/"holdout-data/manifest.json").read_bytes())}
FIELDS = ["first", "five", "f1", "tokens", "fiveTokens", "wholeFirst"]
B = "B256u256"
T = "T512u256t0.15j"
# The same source-free prompt has accepted citations in each of these two papers.
SHARED_HOLDOUT_PROMPTS = {
    "what dataset did they use?": {"1603.08868", "1611.04234"},
    "what is the state-of-the-art?": {"1611.04234", "1910.02001"},
}


def documents(key, small=False):
    meta = REG[key]
    folder = ROOT/"holdout-data" if meta["fold"] == "holdout" else HERE/".cache/context-mixtures"/(
        "audited-data" if meta["fold"] == "fresh" else "data")
    source = json.loads((folder/(key+".json")).read_bytes())
    for i, doc in enumerate(source["docs"]):
        stem = ROOT/key/str(i)
        ix = prior["read"](stem.with_suffix(".json.gz"))
        assert doc["id"] == ix["id"]
        if small:
            extra=prior["read"](stem.with_suffix(".detail.json.gz"))
            ix["small"]=extra["small"]
            ix["detailHash"]=extra["hash"]
            ix["hashes"].extend(extra["hashes"])
        ordinals = ev.ordinals(doc["source"])
        for v in ix["views"]:
            v["ink"] = ev.union((ordinals[a],ordinals[b]) for a,b in v["ranges"])
            v["size"] = ev.size(v["ink"])
            v["length"] = ev.size(v["raw"])
        yield dict(id=doc["id"], domain=meta["domain"], ix=ix, o=ordinals, file=stem.with_suffix(".f32"))


def profile(layouts, detail=.5, section=.15, method="center", weight=0, overlap=.75, window=True):
    if isinstance(layouts,str):
        layouts = [layouts]
    return dict(layouts=list(layouts),detail=detail,section=section,method=method,weight=weight,overlap=overlap,window=window)


def signature(config):
    return json.dumps(config,sort_keys=True,separators=(",",":"))


class Pool:
    def __init__(self, docs, accept_shared_holdout_citations=False, stream_vectors=False):
        self.docs = docs
        self.qs = [(d,q) for d in docs for q in d["ix"]["qs"]]
        self.views, self.owners, self.offsets, self.sim = [], [], [], []
        self.features, self.details, self.pair_tables = {}, {}, {}
        self.orders, self.searches = {}, {}
        self.shared = len(docs)>20 and len(self.qs)>250
        by_id = {d["id"]:d for d in docs}
        equivalent = collections.defaultdict(list)
        if accept_shared_holdout_citations:
            for d, q in self.qs:
                prompt = q["text"].casefold().strip()
                if d["id"] in SHARED_HOLDOUT_PROMPTS.get(prompt, ()):
                    equivalent[prompt].extend((d["id"], ref) for ref in q["references"])
            assert {p: {s for s, _ in group} for p, group in equivalent.items()} == SHARED_HOLDOUT_PROMPTS
        self.refs = []
        for d,q in self.qs:
            refs = [(d["id"],s) for s in q.get("references",[q.get("ranges")])]
            refs.extend((a["source"],a["ranges"]) for a in q.get("alternativeSources",[]))
            prompt = q["text"].casefold().strip()
            if d["id"] in SHARED_HOLDOUT_PROMPTS.get(prompt, ()):
                refs.extend((s, r) for s, r in equivalent.get(prompt, ()) if s != d["id"])
            self.refs.append([(owner,ev.union((by_id[owner]["o"][a],by_id[owner]["o"][b]) for a,b in spans)) for owner,spans in refs])
        matrices = []
        for k,d in enumerate(docs):
            ix = d["ix"]
            self.offsets.append(len(self.views))
            self.views.extend(ix["views"])
            self.owners.extend([k]*len(ix["views"]))
            if stream_vectors:
                with d["file"].open("rb") as file:
                    assert hashlib.file_digest(file,"sha256").hexdigest()==ix["vectorHash"]
                assert "small" not in ix
                matrices.append(np.memmap(d["file"],mode="r",dtype="<f4").reshape(-1,1536))
                continue
            raw = d["file"].read_bytes()
            assert hashlib.sha256(raw).hexdigest() == ix["vectorHash"]
            if "small" in ix:
                detail=d["file"].with_suffix(".detail.f32").read_bytes()
                assert hashlib.sha256(detail).hexdigest()==ix["detailHash"]
                raw+=detail
            matrices.append(np.frombuffer(raw,dtype="<f4").reshape(-1,1536))
            if "small" in ix:
                ps=ix["paragraphs"]
                if ps:
                    centers=prior["unit"](matrices[-1][[p["v"] for p in ps]])
                    for i,p in enumerate(ps):
                        neighbors=[j for j in (i-1,i+1) if 0<=j<len(ps) and ps[j]["scope"]==p["scope"]]
                        mean=centers[neighbors].mean(axis=0) if neighbors else centers[i]
                        p["dotMean"]=float(centers[i]@mean)
                        p["meanNorm"]=float(mean@mean)
        if self.qs:
            queries = prior["unit"](np.stack([m[q["v"]] for m,d in zip(matrices,docs) for q in d["ix"]["qs"]]))
            if stream_vectors:
                for mat in matrices:
                    scores=np.empty((len(queries),len(mat)))
                    for start in range(0,len(mat),2048):
                        indices=slice(start,start+2048)
                        scores[:,indices]=queries @ prior["unit"](mat[indices]).T
                    self.sim.append(scores)
            else:
                self.sim = [queries @ prior["unit"](mat).T for mat in matrices]
        self.fraction = functools.lru_cache(maxsize=100000)(self._fraction)
        self.evidence = functools.lru_cache(maxsize=100000)(self._evidence)
        self.grade = functools.lru_cache(maxsize=20000)(self._grade)
        self.related = functools.lru_cache(maxsize=18000)(self._related)

    def _fraction(self, a, b):
        if self.owners[a] != self.owners[b]:
            return 0
        x,y = self.views[a],self.views[b]
        return ev.size(ev.intersect(x["raw"],y["raw"]))/min(x["length"],y["length"])

    def _evidence(self, qi, view):
        v = self.views[view]
        owner = self.docs[self.owners[view]]["id"]
        result = []
        for source,ref in self.refs[qi]:
            mask = offset = 0
            if source == owner:
                for a,b in ref:
                    for c,d in ev.intersect(v["ink"],[(a,b)]):
                        mask |= ((1 << (d-c))-1) << (offset+c-a)
                    offset += b-a
            result.append(mask)
        return result

    def _grade(self, qi, shown):
        head = self.views[shown[0]]
        masks = [self.evidence(qi,v) for v in shown]
        first = five = 0
        f1 = 0.
        for j,(_,ref) in enumerate(self.refs[qi]):
            length = ev.size(ref)
            one = masks[0][j].bit_count()
            covered = 0
            for group in masks:
                covered |= group[j]
            first = max(first,int(one==length))
            five = max(five,int(covered.bit_count()==length))
            f1 = max(f1,2*one/(length+head["size"]))
        total = self.docs[self.owners[shown[0]]]["o"][-1]
        return (first,five,f1,head["tokens"],sum(self.views[v]["tokens"] for v in shown),int(head["size"]>=.99*total))

    def features_for(self, layout):
        if layout in self.features:
            return self.features[layout]
        whole, section, owners, wins, bares, has_section, near = [], [], [], [], [], [], []
        for k,d in enumerate(self.docs):
            cs, s, off = d["ix"]["layouts"][layout], self.sim[k], self.offsets[k]
            for j,c in enumerate(cs):
                whole.append(s[:,c["v"]])
                section.append(s[:,max(0,c["section"])])
                has_section.append(c["section"]>=0)
                owners.append(k)
                wins.append(off+c["win"])
                bares.append(off+c["bare"])
                sides = [other["v"] for n in (j-1,j+1) if 0<=n<len(cs) for other in [cs[n]]
                         if ev.size(ev.intersect(d["ix"]["views"][other["bare"]]["raw"],d["ix"]["views"][c["win"]]["raw"]))>0]
                near.append(s[:,sides].mean(axis=1) if sides else s[:,c["v"]])
        f = dict(core=np.array(whole).T,sec=np.array(section).T,has=np.array(has_section),owner=np.array(owners),
                 win=np.array(wins),bare=np.array(bares),near=np.array(near).T)
        self.features[layout] = f
        return f

    def paragraph_pairs(self, layout, method):
        # Each candidate has one or more paragraph occurrences, or one fallback to its core.
        key=(layout,method)
        if key in self.pair_tables:
            return self.pair_tables[key]
        centers,neighbors,starts = [],[],[]
        for k,d in enumerate(self.docs):
            ix,s = d["ix"],self.sim[k]
            ps = ix["paragraphs"]
            for c in ix["layouts"][layout]:
                starts.append(len(centers))
                indices = c["pa"] or ([c["same"]] if c["same"]>=0 else [])
                if not indices and method.startswith("parent") and c["parent"]>=0:
                    indices = [c["parent"]]
                if not indices:
                    centers.append(s[:,c["v"]])
                    neighbors.append(s[:,c["v"]])
                    continue
                for i in indices:
                    p = ps[i]
                    center = s[:,p["v"]]
                    centers.append(center)
                    if method in ("center","parent","top2"):
                        neighbors.append(center)
                        continue
                    if method=="joint":
                        neighbors.append(s[:,p["joint"]])
                        continue
                    near = [ps[j] for j in (i-1,i+1) if 0<=j<len(ps) and (method=="cross" or ps[j]["scope"]==p["scope"])]
                    if method=="visible":
                        win = ix["views"][c["win"]]["raw"]
                        near = [n for n in near if 2*ev.size(ev.intersect(n["raw"],win))>=ev.size(n["raw"])]
                    ns = [n["v"] for n in near]
                    value = center if not ns else (s[:,ns].max(axis=1) if method=="max" else s[:,ns].mean(axis=1))
                    neighbors.append(value)
        result = (np.array(centers).T,np.array(neighbors).T,np.array(starts))
        if self.shared and len(self.pair_tables)>=3:self.pair_tables.pop(next(iter(self.pair_tables)))
        self.pair_tables[key]=result
        return result

    def detail_for(self, layout, method, w):
        key = (layout,method,w)
        if key in self.details:
            return self.details[key]
        if self.shared and len(self.details)>=8:self.details.pop(next(iter(self.details)))
        if method in ("sentence","triple","group25"):
            columns=[]
            for k,d in enumerate(self.docs):
                ix,s=d["ix"],self.sim[k]
                for c,extra in zip(ix["layouts"][layout],ix["small"][layout],strict=True):
                    pa=[ix["paragraphs"][i]["v"] for i in c["pa"]]
                    all_keys=pa+extra[method]
                    columns.append(s[:,all_keys].max(axis=1) if all_keys else s[:,c["v"]])
            centers=self.detail_for(layout,"center",0)
            value=(1-w)*centers+w*np.array(columns).T
            self.details[key]=value
            return value
        pair_method = "center" if method=="chunk" else "mean" if method=="normalized" else method
        center,near,starts = self.paragraph_pairs(layout,pair_method)
        mixed = (1-w)*center+w*near if w and method!="chunk" else center
        if method=="normalized":
            norms=[]
            for d in self.docs:
                ix=d["ix"]
                for c in ix["layouts"][layout]:
                    indices=c["pa"] or ([c["same"]] if c["same"]>=0 else [])
                    if not indices:norms.append(1.)
                    for i in indices:
                        p=ix["paragraphs"][i]
                        norms.append(max(1e-30,((1-w)**2+2*w*(1-w)*p["dotMean"]+w*w*p["meanNorm"])**.5))
            mixed=mixed/np.array(norms)
        if method=="top2":
            ends = [*starts[1:],center.shape[1]]
            value = np.column_stack([np.sort(center[:,a:b],axis=1)[:,-2:].mean(axis=1) for a,b in zip(starts,ends)])
        else:
            value = np.maximum.reduceat(mixed,starts,axis=1)
        self.details[key] = value
        return value

    def ranking(self, p):
        # Search all candidates. Stable ties follow source, layout, then chunk order, like the public API.
        key = (tuple(p["layouts"]),p["detail"],p["section"],p["method"],p["weight"])
        if key in self.orders:
            return self.orders[key]
        values, windows, bares, owners = [], [], [], []
        for layout in p["layouts"]:
            f = self.features_for(layout)
            local = self.detail_for(layout,p["method"],p["weight"])
            base = (1-p["detail"])*f["core"]+p["detail"]*local
            value = (1-p["section"])*base+p["section"]*np.where(f["has"],f["sec"],base)
            if p["method"]=="chunk":
                value=(1-p["weight"])*value+p["weight"]*f["near"]
            values.append(value)
            windows.extend(f["win"])
            bares.extend(f["bare"])
            owners.extend(f["owner"])
        perm = np.argsort(owners,kind="stable")
        scores = np.concatenate(values,axis=1)[:,perm]
        order = np.argsort(-scores,axis=1,kind="stable").astype(np.int32)
        result = scores, order, np.asarray(windows)[perm], np.asarray(bares)[perm]
        # Sweeps revisit the same few rankings at different duplicate thresholds.
        if len(self.orders)>=(3 if self.shared else 12):
            self.orders.pop(next(iter(self.orders)))
        self.orders[key] = result
        return result

    def ordinary(self, p):
        sig = signature(p)
        if sig in self.searches:
            return self.searches[sig]
        scores,order,wins,bares = self.ranking(p)
        views = wins if p["window"] else bares
        output = []
        for qi, row in enumerate(order):
            hits, positions = [], []
            for i in row:
                v = int(views[i])
                if any(self.fraction(min(u,v),max(u,v))>=p["overlap"] for u in hits):
                    continue
                hits.append(v)
                positions.append(int(i))
                if len(hits)==5:
                    break
            output.append((tuple(hits),positions))
        if len(self.searches)>=12:
            self.searches.pop(next(iter(self.searches)))
        self.searches[sig] = output
        return output

    def _related(self, v, layout, kind):
        x = self.views[v]
        f = self.features_for(layout)
        result = []
        for j in np.where(f["owner"]==self.owners[v])[0]:
            u = int(f["win"][j])
            y = self.views[u]
            intersection = ev.size(ev.intersect(x["raw"],y["raw"]))
            if kind=="contains":
                if intersection==x["length"] and y["size"]>x["size"]:
                    result.append((int(j),u))
            elif intersection/(x["length"]+y["length"]-intersection)>=kind:
                result.append((int(j),u))
        return result

    def guarded(self, p):
        base, alt = p["base"],p["alt"]
        structural = self.ordinary(base)
        bs,_,_,_ = self.ranking(base)
        ss,order,wins,_ = self.ranking(alt)
        layout = alt["layouts"][0]
        assert len(alt["layouts"])==len(base["layouts"])==1 and base["window"] and alt["window"]
        output = []
        for qi,(original,positions) in enumerate(structural):
            hits = list(original)
            if p["policy"]=="rerank":
                values = []
                for v,j in zip(hits,positions):
                    choices = self.related(v,layout,p["iou"])
                    other = max((ss[qi,k] for k,_ in choices),default=bs[qi,j])
                    values.append((1-p["blend"])*bs[qi,j]+p["blend"]*other)
                hits = [hits[j] for j in sorted(range(len(hits)),key=lambda k:-values[k])]
            elif p["policy"]=="head":
                j = order[qi,0]
                if ss[qi,j]>bs[qi,positions[0]]:
                    hits = [int(wins[j])]
                    _,br,bw,_=self.ranking(base)
                    for n in br[qi]:
                        v=int(bw[n])
                        if all(self.fraction(min(u,v),max(u,v))<base["overlap"] for u in hits):
                            hits.append(v)
                            if len(hits)==5:break
            else:
                for i,v in enumerate(original):
                    if p["firstOnly"] and i:break
                    eligible = []
                    for k,u in self.related(v,layout,"contains"):
                        if self.views[u]["tokens"]-self.views[v]["tokens"]>p["extra"]:continue
                        if p["margin"] is not None and ss[qi,k]<bs[qi,positions[i]]-p["margin"]:continue
                        if any(self.fraction(min(z,u),max(z,u))>=base["overlap"] for j,z in enumerate(hits) if j!=i):continue
                        value = self.views[u]["size"] if p["lengthOnly"] else ss[qi,k]
                        eligible.append((value,-k,u))
                    if eligible:hits[i]=max(eligible)[2]
            output.append(tuple(hits))
        return output

    def run(self, config):
        return self.guarded(config) if "policy" in config else [h for h,_ in self.ordinary(config)]


def pools(fold, small=False):
    shared = fold.startswith("shared-")
    split = fold.removeprefix("shared-")
    docs, result = [], []
    for key,meta in REG.items():
        if meta["fold"]!=split:continue
        local = list(documents(key,small))
        docs.extend(local)
        if not shared:
            for group in ([local] if meta["pool"]=="collection" else [[d] for d in local]):
                if any(d["ix"]["qs"] for d in group):result.append(Pool(group))
    return [Pool(docs, accept_shared_holdout_citations=split=="holdout")] if shared else result
