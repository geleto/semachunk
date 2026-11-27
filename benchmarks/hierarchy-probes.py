"""Evaluate structural keys, logical joins and sentence-only boundary controls."""
import argparse
import bisect
import collections
import concurrent.futures
import gzip
import hashlib
import json
import runpy
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
prior = runpy.run_path(str(HERE/"scope-weights.py"))
engine, registry = prior["engine"], prior["registry"]
ev, original = engine.ev, engine.ROOT
OUT = HERE/".cache/hierarchy-probes"
MAIN = ("blocks","tree","joined","items","mixed","sections","earlyitems","earlymixed","earlysections","hybrid")
SEEDS = (31,271,1901)


def read(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def write(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(data,separators=(",",":"),allow_nan=False).encode(),mtime=0))


def documents(key):
    directory = "audited-data" if registry[key]["fold"]=="fresh" else "data"
    source = json.loads((original/directory/(key+".json")).read_bytes())
    for i,doc in enumerate(source["docs"]):
        stem = OUT/"indexes"/key/str(i)
        idx = read(stem.with_suffix(".json.gz"))
        blob = stem.with_suffix(".f32").read_bytes()
        assert idx["id"]==doc["id"] and hashlib.sha256(blob).hexdigest()==idx["vectorSHA256"]
        primary = []
        for cached,q in zip(idx["questions"],doc["questions"],strict=True):
            assert (cached["id"],cached["text"])==(q["id"],q["text"])
            if q.get("kind")!="section":
                primary.append({**cached,**q})
        idx["questions"] = primary
        yield doc,idx,np.frombuffer(blob,dtype="<f4").reshape(-1,idx["dimension"])


def relationships(doc,idx):
    o = ev.ordinals(doc["source"])
    spans = [ev.union((o[a],o[b]) for a,b in p["spans"]) for p in idx["passages"]]
    roles = collections.defaultdict(set)
    for kind,pids in idx["levels"].items():
        for pid in pids:
            roles[pid].add(kind)
    nodes = sorted((spans[p][0][0],spans[p][-1][1],p) for p in roles if spans[p])
    starts = [a for a,_,_ in nodes]
    sections = [(a,b,p) for a,b,p in nodes if "section" in roles[p] and (a,b)!=(0,o[-1])]
    out = {}
    for c in {c for name in MAIN for c in idx["plans"][name]}:
        scoped = set()
        for a,b in spans[c]:
            start = bisect.bisect_left(starts,a)
            end = bisect.bisect_left(starts,b)
            scoped.update(p for lo,hi,p in nodes[start:end] if hi<=b and spans[p]!=spans[c])
        para = sorted(p for p in scoped if "paragraph" in roles[p])
        ancestors = [(hi-lo,p) for lo,hi,p in sections if spans[c] and lo<=spans[c][0][0]
                     and spans[c][-1][1]<=hi and spans[c]!=spans[p]]
        ancestor = min(ancestors)[1] if ancestors else None
        def contained(pid,outer):
            return all(any(x<=a and b<=y for x,y in spans[outer]) for a,b in spans[pid])
        # Index the broadest strict children plus any leaf whose source would be uncovered.
        cover=[]
        for pid in sorted(scoped,key=lambda p:(-ev.size(spans[p]),p)):
            if not any(contained(pid,outer) for outer in cover):cover.append(pid)
        frontier=cover+[u for u in idx["members"][str(c)] if not any(contained(u,outer) for outer in cover)]
        out[c] = (para,sorted(scoped),ancestor,frontier)
    return out


def layout_stats(doc,idx,links):
    stats = dict(id=doc["id"],format=doc["format"],eligible=idx["counts"],sizes={p:len(v) for p,v in idx["plans"].items()},
                 moved={},cost={},hashes=idx["hashes"],tokens=idx["tokens"],roles={})
    for plan in MAIN:
        cs = idx["plans"][plan]
        roots = {idx["passages"][p]["v"] for p in cs}
        parts = {k:set() for k in ("leaf","paragraph","middle","ancestor","frontier")}
        eligible = collections.Counter()
        for c in cs:
            pa,mid,anc,front = links[c]
            leaves = idx["members"][str(c)]
            for k,ids in [("leaf",leaves),("paragraph",pa),("middle",mid),("ancestor",[] if anc is None else [anc]),("frontier",front)]:
                parts[k].update(idx["passages"][p]["v"] for p in ids)
            if mid: eligible["parentsWithMiddle"]+=1
            if pa: eligible["parentsWithParagraph"]+=1
            for k,ps in idx["levels"].items():
                eligible[k]+=len(set(mid).intersection(ps))
        stats["roles"][plan] = dict(eligible)
        stats["cost"][plan] = dict(core=sorted(roots),**{k:sorted(v) for k,v in parts.items()})
    def cuts(cs):
        return set(np.cumsum([len(idx["members"][str(c)]) for c in cs])[:-1].tolist())
    for name,ids in idx["plans"].items():
        if "-" not in name: continue
        reference=cuts(idx["plans"][name.split("-")[0]])
        actual=cuts(ids)
        assert len(reference)==len(actual)
        stats["moved"][name]=[len(reference-actual),len(actual)]
    return stats


def run_group(group,by_doc):
    links_by_plan=collections.defaultdict(list)
    def displaced(rows):
        flat=[p for row in rows for p in row]
        cut=(len(flat)+1)//2
        order=flat[cut:]+flat[:cut];start=0;out=[]
        for row in rows:
            end=start+len(row);out.append(order[start:end]);start=end
        return out
    for name in group[0][1]["plans"]:
        if name not in MAIN: continue
        offset=0
        for doc,idx,_ in group:
            links=by_doc[doc["id"]]
            local=[]
            for c in idx["plans"][name]:
                pa,mid,anc,front=links[c]
                local.append(([p+offset for p in pa],[p+offset for p in mid],None if anc is None else anc+offset,
                              [p+offset for p in front]))
            if local:
                null_pa=displaced([r[0] for r in local]);null_mid=displaced([r[1] for r in local])
                links_by_plan[name].extend([(*r,a,b) for r,a,b in zip(local,null_pa,null_mid,strict=True)])
            offset+=len(idx["passages"])
    similarity=None
    def rank(plan,cores,children,V,P,Q,neighbors,view,bare,add):
        nonlocal similarity
        if similarity is None: similarity=engine.unit(Q)@engine.unit(V).T
        whole=similarity[:,P[cores]]
        def best(rows,fallback):
            return np.stack([similarity[:,P[ps]].max(axis=1) if ps else fallback[:,i] for i,ps in enumerate(rows)],axis=1)
        leaf=best(children,whole)
        combined=(whole+leaf)*.5
        window=np.array([view([l,c,r]) for c,(l,r,_) in zip(cores,neighbors["section"],strict=True)])
        for label,sc in [("core",whole),("leaf",combined)]:
            add(label+"/bare",sc,bare); add(label+"/window",sc,window)
        if plan not in MAIN:return
        pa,mid,anc,front,null_pa,null_mid=zip(*links_by_plan[plan])
        # With no additional node use the existing score for the corresponding comparison.
        paragraph=best(pa,whole); middle=best(mid,whole)
        leaf_or_para=np.maximum(leaf,best(pa,leaf))
        mid_for_leaves=best(mid,leaf)
        all_levels=.5*(whole+np.maximum(leaf,mid_for_leaves))
        enclosing=np.stack([similarity[:,P[a]] if a is not None else all_levels[:,i] for i,a in enumerate(anc)],axis=1)
        scores={"paragraph":.5*(whole+paragraph),"middle":.5*(whole+middle),
                "leafPara":.5*(whole+leaf_or_para),"all":all_levels,
                "balanced":.5*whole+.25*leaf+.25*mid_for_leaves,"routed":.85*all_levels+.15*enclosing,
                "frontier":.5*(whole+best(front,whole)),"displacedParagraph":.5*(whole+best(null_pa,whole)),
                "displacedMiddle":.5*(whole+np.maximum(leaf,best(null_mid,leaf)))}
        for label,sc in scores.items():
            add(label+"/bare",sc,bare); add(label+"/window",sc,window)
        if plan in ("blocks","joined","hybrid"):
            for label,sc in [("leaf",combined),("all",all_levels),("paragraph",scores["paragraph"])]:
                add(label+"/distinct",sc,window,diverse=True)
    outcome=engine.evaluate(group,experiment=rank)
    if outcome is None:return []
    qs,scores,_=outcome
    return [dict(doc=q["doc"],id=q["id"],metrics={k:v[i].tolist() for k,v in scores.items()}) for i,q in enumerate(qs)]


def score_shard(key):
    groups=[]; current=[]; links={}; stats=[]; rows=[]
    for doc,idx,V in documents(key):
        links[doc["id"]]=relationships(doc,idx)
        stats.append(layout_stats(doc,idx,links[doc["id"]]))
        current.append((doc,idx,V))
        if registry[key]["pool"]!="collection":groups.append(current);current=[]
    if current:groups.append(current)
    for group in groups:rows.extend(run_group(group,links))
    write(OUT/"scores"/(key+".json.gz"),rows)
    write(OUT/"cost"/(key+".json.gz"),stats)
    print(key,len(rows),flush=True)


def compact(doc,idx,V,plan):
    links=relationships(doc,idx)
    cs=idx["plans"][plan]; conf=idx["configs"][plan]["settings"]["section"]
    wanted=set(cs)
    wanted.update(u for c in cs for u in idx["members"][str(c)])
    wanted.update(p for lr in conf for p in lr if p>=0)
    for c in cs:
        a,b,s,front=links[c];wanted.update(a);wanted.update(b);wanted.update(front)
        if s is not None:wanted.add(s)
    ids=sorted(wanted); pmap={p:i for i,p in enumerate(ids)}
    vids=sorted({idx["passages"][p]["v"] for p in ids}|{q["v"] for q in idx["questions"]})
    vmap={v:i for i,v in enumerate(vids)}
    lean=dict(plans={plan:[pmap[c] for c in cs]},passages=[{**idx["passages"][p],"v":vmap[idx["passages"][p]["v"]]} for p in ids],
              questions=[{**q,"v":vmap[q["v"]]} for q in idx["questions"]],
              members={str(pmap[c]):[pmap[u] for u in idx["members"][str(c)]] for c in cs},
              configs={plan:dict(bridges=[],settings={"section":[[pmap.get(l,-1),pmap.get(r,-1),pmap[c]] for l,r,c in conf]})})
    local={pmap[c]:([pmap[p] for p in links[c][0]],[pmap[p] for p in links[c][1]],pmap.get(links[c][2]),
                    [pmap[p] for p in links[c][3]]) for c in cs}
    return (doc,lean,V[vids]),local


def score_global():
    for plan in ("blocks","tree","joined","items","mixed","sections","hybrid"):
        group=[];links={}
        for key,meta in registry.items():
            if meta["fold"]!="fresh":continue
            for doc,idx,V in documents(key):
                row,local=compact(doc,idx,V,plan)
                group.append(row);links[doc["id"]]=local
        rows=run_group(group,links)
        write(OUT/"global"/(plan+".json.gz"),rows)
        print("global",plan,len(rows),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("stage",choices=["index","score","global","study"])
    parser.add_argument("key",nargs="?")
    parser.add_argument("--jobs",type=int,default=3)
    args=parser.parse_args()
    if args.stage=="global":score_global()
    elif args.key and args.stage=="score":score_shard(args.key)
    else:
        def worker(key):
            if args.stage in ("index","study"):
                subprocess.run(["node",str(HERE/"hierarchy-probes-index.mjs"),key],check=True)
            if args.stage in ("score","study"):
                subprocess.run([sys.executable,__file__,"score",key],check=True)
        keys=[args.key] if args.key else sorted(registry,key=lambda k:registry[k]["fold"]!="fresh")
        with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:list(pool.map(worker,keys))
