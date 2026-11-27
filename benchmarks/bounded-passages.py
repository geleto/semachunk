"""Exact retrieval on the public parser's bounded cores and actual cited windows."""
import collections
import functools
import gzip
import hashlib
import json
import runpy
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
prior = runpy.run_path(str(HERE / "hierarchy-probes.py"))
report = runpy.run_path(str(HERE / "query-parents-report.py"))
ev, registry = prior["ev"], prior["registry"]
ROOT = HERE / ".cache/bounded-passages"
FIELDS = ["complete1","complete5","evidenceF1","firstTokens","firstSourceFraction","wholeSource1","fiveTokens","wholeSource5"]
PLANS = {p:(p,) for p in ("b256","b512","b1024","s512","s1024","s2048")}
PLANS.update({f"both{c}":("b256",f"s{c}") for c in (512,1024,2048)})
DETAILS = ("paragraph","sentence","pair","triple","cos25","cos40","cos55")


def read(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def shards(key, root=ROOT, extend=None):
    folder = "audited-data" if registry[key]["fold"]=="fresh" else "data"
    original = json.loads((HERE/".cache/context-mixtures"/folder/(key+".json")).read_bytes())
    for i,d in enumerate(original["docs"]):
        stem = root / key / str(i)
        ix = read(stem.with_suffix(".json.gz"))
        assert ix["id"]==d["id"]
        if extend is not None:
            extend(ix, stem)
        o = ev.ordinals(d["source"])
        for view in ix["views"]:
            view["ink"] = ev.union((o[a],o[b]) for a,b in view["ranges"])
            view["size"] = ev.size(view["ink"])
            view["rawSize"] = ev.size(view["raw"])
        yield dict(ix=ix, id=d["id"], o=o, domain=registry[key]["domain"], file=stem.with_suffix(".f32"))


def unit(x):
    x = np.array(x, dtype=np.float64, copy=True)
    x /= np.maximum(np.linalg.norm(x,axis=1,keepdims=True),1e-300)
    return x


def matrix(d):
    blob = d["file"].read_bytes()
    assert hashlib.sha256(blob).hexdigest()==d["ix"]["vectorHash"]
    return np.frombuffer(blob,dtype="<f4").reshape(-1,1536)


def configurations(plan):
    high = max(int(p[1:]) for p in PLANS[plan])
    yield ("paragraph",0,0)
    for cap in (512,1024,2048):
        if cap<high: continue
        yield ("paragraph",cap,0)
    cap = max(1024,high)
    for detail in DETAILS[1:]:
        yield (detail,cap,0)
    for weight in (15,30):
        yield ("paragraph",cap,weight)


def evaluate(group, checked=None, *, plans=PLANS, detail_types=DETAILS, variants=configurations, section_weight=.15, window_cap=None):
    qs = [(d,q) for d in group for q in d["ix"]["qs"]]
    if not qs: return []
    query_vectors = []
    data = {d["id"]:d for d in group}
    for d in group:
        values = matrix(d)
        query_vectors.extend(values[q["v"]].copy() for q in d["ix"]["qs"])
    queries = unit(query_vectors)
    sims = {d["id"]:queries @ unit(matrix(d)).T for d in group}
    all_views = []
    for d in group:
        d["offset"] = len(all_views)
        all_views.extend((d,v) for v in d["ix"]["views"])
    @functools.lru_cache(maxsize=160000)
    def duplicate(a,b):
        left,x = all_views[a]; right,y = all_views[b]
        return left["id"]==right["id"] and ev.size(ev.intersect(x["raw"],y["raw"])) >= .75*min(x["rawSize"],y["rawSize"])
    rows = []
    references = []
    for d,q in qs:
        refs = [(d["id"],r) for r in q.get("references",[q.get("ranges")])]
        refs.extend((a["source"],a["ranges"]) for a in q.get("alternativeSources",[]))
        references.append([(s,ev.union((data[s]["o"][a],data[s]["o"][b]) for a,b in rs)) for s,rs in refs])
        rows.append(dict(doc=d["id"],id=q["id"],domain=d["domain"],sourceTokens=d["ix"]["sourceTokens"],metrics={}))
    @functools.lru_cache(maxsize=120000)
    def grade(qi, hits):
        views = [all_views[i] for i in hits]
        d,v = views[0]
        n = v["size"]; first = five = 0; f1 = 0.
        for source,ref in references[qi]:
            length = ev.size(ref)
            evidence = [ev.intersect(view["ink"],ref) for doc,view in views if doc["id"]==source]
            overlap = ev.size(ev.intersect(v["ink"],ref)) if d["id"]==source else 0
            first=max(first,int(overlap==length))
            five=max(five,int(ev.size(ev.union(s for spans in evidence for s in spans))==length))
            f1=max(f1,2*overlap/(n+length))
        source = qs[qi][0]
        collected = ev.union(r for doc,view in views if doc["id"]==source["id"] for r in view["ink"])
        fraction = n/max(1,d["o"][-1])
        return [first,five,f1,v["tokens"],fraction,int(fraction>=.99),sum(t["tokens"] for _,t in views),
                int(ev.size(collected)>=.99*source["o"][-1])]
    cache_scores = {}
    for family in {p for names in plans.values() for p in names}:
        for d in group:
            ix=d["ix"]; s=sims[d["id"]]; cs=ix["layouts"][family]
            if not cs: continue
            whole=s[:,[c["core"] for c in cs]]
            def best(choices, fallback):
                return np.column_stack([s[:,ids].max(axis=1) if ids else fallback[:,i] for i,ids in enumerate(choices)])
            details={}
            for key in detail_types:
                ids=[c["pa"]+(c["detail"][key] if key!="paragraph" else []) for c in cs]
                base=.5*(whole+best(ids,whole))
                anc=np.column_stack([s[:,c["section"]] if c["section"]>=0 else base[:,i] for i,c in enumerate(cs)])
                details[key]=(1-section_weight)*base+section_weight*anc
            cache_scores[(d["id"],family)] = details
    for plan, families in plans.items():
        parts=[(d,f,d["ix"]["layouts"][f]) for d in group for f in families if d["ix"]["layouts"][f]]
        if not parts: continue
        def display(cap):
            return [d["offset"]+(c["windows"][str(window_cap(f,cap) if window_cap else cap)]["view"] if cap else c["bare"])
                    for d,f,cs in parts for c in cs]
        for detail,cap,w in variants(plan):
            label=f"{plan}/{detail}/{cap}/{w}"
            if checked is not None and label not in checked: continue
            chunks=[]
            for d,f,cs in parts:
                base=cache_scores[(d["id"],f)][detail]
                if w:
                    s=sims[d["id"]]
                    nearby=[c["windows"][str(cap)]["sides"] for c in cs]
                    neighbors=np.column_stack([s[:,ps].mean(axis=1) if ps else base[:,i] for i,ps in enumerate(nearby)])
                    base=(1-w/100)*base+(w/100)*neighbors
                chunks.append(base)
            ordering = np.argsort(-np.concatenate(chunks,axis=1),axis=1,kind="stable")
            window = display(cap)
            for qi,order in enumerate(ordering):
                hits=[]
                for k in order:
                    v=window[k]
                    if not any(duplicate(min(u,v),max(u,v)) for u in hits):
                        hits.append(v)
                        if len(hits)==5: break
                rows[qi]["metrics"][label]=grade(qi,tuple(hits))
                if checked is not None:
                    rows[qi].setdefault("hits",{})[label]=[[all_views[v][0]["id"],v-all_views[v][0]["offset"]] for v in hits]
    return rows


def cost(docs):
    output = {}
    for plan,families in PLANS.items():
        for detail,cap,w in configurations(plan):
            hashes=set(); candidates=0; largest=0; largest_window=0
            for d in docs:
                ix=d["ix"]; ids=set(ix["sections"])
                for f in families:
                    cs=ix["layouts"][f];candidates+=len(cs)
                    for c in cs:
                        ids.add(c["core"]);ids.update(c["pa"])
                        if detail!="paragraph":ids.update(c["detail"][detail])
                        if w:ids.update(c["windows"][str(cap)]["sides"])
                        largest=max(largest,ix["views"][c["bare"]]["tokens"])
                        v=c["windows"][str(cap)]["view"] if cap else c["bare"]
                        largest_window=max(largest_window,ix["views"][v]["tokens"])
                hashes.update(ix["hashes"][i] for i in ids)
            output[f"{plan}/{detail}/{cap}/{w}"]=[len(hashes),candidates,largest,largest_window]
    return output


def summarize(rows,docs):
    groups=collections.defaultdict(list); longer=collections.defaultdict(list)
    for r in rows:
        groups[r["domain"]].append(r)
        if r["sourceTokens"]>2048: longer[r["domain"]].append(r)
    labels=list(rows[0]["metrics"])
    def summary(by):
        return {label:report["macro"](by,lambda r:r["metrics"][label]) for label in labels} if by else {}
    selected=["both1024/paragraph/1024/0","both1024/sentence/1024/0","both1024/pair/1024/0","both1024/cos40/1024/0"]
    comparisons=[(label,selected[1]) for label in selected if label!=selected[1]]
    comparisons.extend([(selected[0],"both1024/paragraph/0/0"),("both1024/paragraph/1024/15",selected[0]),
                        ("both512/paragraph/1024/0",selected[0])])
    reference="both2048/paragraph/2048/0"
    sentences="both2048/sentence/2048/0"
    comparisons.extend([(f"both2048/{detail}/2048/0",sentences) for detail in DETAILS if detail!="sentence"])
    comparisons.extend([(reference,"both2048/paragraph/0/0"),(reference,selected[0]),
                        ("both2048/paragraph/2048/15",reference),("both2048/paragraph/2048/30",reference)])
    def window_sizes(label):
        ordered=sorted((r["metrics"][label][3],1/(len(groups)*len(domain))) for domain in groups.values() for r in domain)
        mass=0; p95=0
        for length,w in ordered:
            mass+=w
            if mass>=.95:
                p95=length
                break
        return dict(p95=p95,max=ordered[-1][0])
    return dict(questions=len(rows),documents=len(docs),longQuestions=sum(map(len,longer.values())),longDomains=list(longer),
                longDocuments=sum(d["ix"]["sourceTokens"]>2048 for d in docs),
                firstHitTokens={label:window_sizes(label) for label in labels},
                rates=summary(groups),longSources=summary(longer),
                perDomain={domain:{label:report["mean"](rs,lambda r:r["metrics"][label]).tolist() for label in labels}
                           for domain,rs in groups.items()},
                ci={a+" vs "+b:report["paired"](groups,a,b,lambda r,k:r["metrics"][k][:3]) for a,b in comparisons})


def verification():
    selected={f"both2048/{detail}/2048/0" for detail in ("paragraph","sentence","triple","cos25")}
    orig=[];all_docs=[]; chosen=set()
    for key,meta in registry.items():
        if meta["fold"]!="fresh":continue
        local=list(shards(key))
        for group in ([local] if meta["pool"]=="collection" else [[d] for d in local]):
            orig.extend(evaluate(group,selected))
        qs=[(d["id"],q["id"]) for d in local for q in d["ix"]["qs"]]
        chosen.update(qs[i] for i in (0,len(qs)//2,len(qs)-1))
        all_docs.extend(local)
    for d in all_docs:
        d["ix"]["qs"]=[q for q in d["ix"]["qs"] if (d["id"],q["id"]) in chosen]
    shared=evaluate(all_docs,selected)
    expected={pool:[{k:r[k] for k in ("doc","id","hits")} for r in rows] for pool,rows in [("original",orig),("shared",shared)]}
    (ROOT/"verify.json.gz").write_bytes(gzip.compress(json.dumps(expected,separators=(",",":")).encode(),mtime=0))


if __name__=="__main__":
    if sys.argv[1:]==["verify"]:
        verification()
        sys.exit(0)
    args=sys.argv[1:] or ["development","confirmation","fresh","shared"]
    for fold in args:
        docs=[];rows=[]
        for key,meta in registry.items():
            if meta["fold"]!= ("fresh" if fold=="shared" else fold):continue
            local=list(shards(key));docs.extend(local)
            if fold=="shared":continue
            for pool in ([local] if meta["pool"]=="collection" else [[d] for d in local]):
                rows.extend(evaluate(pool))
        if fold=="shared":rows=evaluate(docs)
        result=summarize(rows,docs)
        result["cost"]=cost(docs)
        (ROOT/(fold+".json")).write_text(json.dumps(result,separators=(",",":")),encoding="utf-8")
        print(fold,len(rows),flush=True)
