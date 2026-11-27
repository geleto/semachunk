"""Score source ranges of complete passages. The local index contains the actual embedding texts."""
import argparse
import bisect
import functools
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE/".cache/context-retrieval"
SETTINGS=json.loads((HERE/"context-retrieval-protocol.json").read_bytes())
CONTEXTS=("adjacent","similar","facets","skip","keep")
FIELDS=["complete1","complete5","firstF1","recall5","firstLength","firstCore","topCores"]

def save(path,content):
    raw=json.dumps(content,ensure_ascii=False,separators=(",",":")).encode()
    path.write_bytes(gzip.compress(raw,mtime=0))

def union(parts):
    merged=[]
    for a,b in sorted(parts):
        if a==b: continue
        if merged and a<=merged[-1][1]: merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
        else: merged.append((a,b))
    return merged

def size(spans):return sum(b-a for a,b in spans)

def intersect(spans,ref):
    result=[];i=j=0
    while i<len(spans) and j<len(ref):
        a,b=spans[i];c,d=ref[j]
        if a<d and c<b:result.append((max(a,c),min(b,d)))
        if b<=d:i+=1
        if d<=b:j+=1
    return result

def ordinals(source):
    offsets=[0]
    for c in source:
        for _ in range(2 if ord(c)>65535 else 1):offsets.append(offsets[-1]+int(not c.isspace()))
    return offsets

def nonwhite(s):return sum((2 if ord(c)>65535 else 1) for c in s if not c.isspace())

def parent_ranks(documents,plans,sims,columns,protocol):
    result={};stats={}
    v,view,_=columns["base"]
    for parent in protocol["parents"]:
        ids=np.asarray(plans[parent]);raw=sims[:,v[ids]]
        def rank(values):return ids[np.argsort(-values,axis=1,kind="stable")[:,:5]],view
        result[parent+"/base"]=rank(raw)
        stats[parent]={"count":len(ids),"exhausted":len(ids)<=5,"children":{}}
        for child in protocol["children"]:
            cols=[];v_offset=0;matches=[]
            for d in documents:
                idx=d["idx"];ords=d["ord"]
                def ordinal(r):return union((ords[a],ords[b]) for a,b in r["spans"])
                parts=d["atoms"] if child=="atoms" else [idx["cores"][i] for i in idx["plans"][child]]
                rows=sorted((o[0][0],o[-1][1],size(o),part["v"]+v_offset,o) for part in parts if (o:=ordinal(part)))
                starts=[r[0] for r in rows]
                for i in idx["plans"][parent]:
                    ref=ordinal(idx["cores"][i]);lo=bisect.bisect_left(starts,ref[0][0]);hi=bisect.bisect_left(starts,ref[-1][1])
                    indexes=[j for _,end,length,j,spans in rows[lo:hi] if end<=ref[-1][1] and size(intersect(spans,ref))==length]
                    matches.append(len(indexes))
                    cols.append(sims[:,indexes].max(axis=1) if indexes else raw[:,len(cols)])
                v_offset+=len(d["vec"])
            best=np.asarray(cols).T
            stats[parent]["children"][child]=[sum(bool(n) for n in matches),sum(matches)]
            for w in protocol["weights"]:
                if w:result[f"{parent}/{child}/{w}"]=rank((1-w)*raw+w*best)
    return result,stats

def evaluate(documents, pool, key, parent_protocol=None):
    queries=[(d,q) for d in documents for q in d["idx"]["questions"]]
    if not queries:return [],{}
    query_vectors=np.stack([d["vec"][q["v"]] for d,q in queries])
    scores=[];plans={};states=[];sources={d["id"]:d for d in documents}
    # Each ranking candidate is an original core. Display variants resolve to independently scored source ranges.
    display=[];display_ids={};core_offset=0;vector_offset=0
    def delivery(doc,p):
        marker=(doc["id"],tuple(map(tuple,p["spans"])),p["v"])
        if marker not in display_ids:
            ix=doc["ord"]
            spans=union((ix[a],ix[b]) for a,b in p["spans"])
            display_ids[marker]=len(display)
            display.append((doc["id"],spans,nonwhite(doc["idx"]["texts"][p["v"]])))
        return display_ids[marker]
    for d in documents:
        idx=d["idx"]
        scores.append(query_vectors @ d["vec"].T)
        for name,ids in idx["plans"].items():plans.setdefault(name,[]).extend(core_offset+i for i in ids)
        for c in idx["cores"]:
            state={"base":(vector_offset+c["v"],delivery(d,c),1.)}
            for mode,p in c["ext"].items():state[mode]=(vector_offset+p["v"],delivery(d,p),p["drift"])
            states.append(state)
        core_offset+=len(idx["cores"]);vector_offset+=len(d["vec"])
    sims=np.concatenate(scores,axis=1)
    columns={mode:tuple(np.array(x) for x in zip(*(s[mode] for s in states))) for mode in ("base",*CONTEXTS)}
    ranks={};stats={}
    for layout,ids in ({} if parent_protocol else plans).items():
        candidates=np.asarray(ids,dtype=int)
        base,plain,_=columns["base"]
        raw=sims[:,base[candidates]]
        def top(matrix):
            return candidates[np.argsort(-matrix,axis=1,kind="stable")[:,:5]]
        plain_rank=top(raw)
        ranks[layout+"/base"]=(plain_rank,plain)
        stats[layout]={"count":len(ids),"exhausted":len(ids)<=5,"context":{}}
        for mode in CONTEXTS:
            v,extended,drift=columns[mode]
            contextual=sims[:,v[candidates]]
            guarded=drift[candidates]>=SETTINGS["guardMinimum"]
            changed=v[candidates]!=base[candidates]
            stats[layout]["context"][mode]=[int(changed.sum()),int((changed & ~guarded).sum())]
            orderings={"raw":plain_rank,"embed":top(contextual),"guard":top(np.where(guarded,contextual,raw)),
                       "dual":top(np.maximum(raw,contextual))}
            for rank,ordering in orderings.items():
                if rank!="raw":ranks["/".join((layout,mode,rank,"core"))]=(ordering,plain)
                ranks["/".join((layout,mode,rank,"expanded"))]=(ordering,extended)
    if parent_protocol:
        ranks,stats=parent_ranks(documents,plans,sims,columns,parent_protocol)
    rows=[]
    for qi,(doc,q) in enumerate(queries):
        choices=[(doc["id"],ref) for ref in q.get("references",[q.get("ranges")])]
        choices.extend((a["source"],a["ranges"]) for a in q.get("alternativeSources",[]))
        refs=[]
        for which,r in choices:
            m=sources[which]["ord"]
            spans=union((m[a],m[b]) for a,b in r);assert size(spans)>0
            refs.append((which,spans,size(spans)))
        @functools.lru_cache(None)
        def coverage(i):
            who,sp,n=display[i]
            pieces=[intersect(sp,r) if who==target else [] for target,r,_ in refs]
            lengths=[size(x) for x in pieces]
            f1=max(2*l/(n+ref[2]) for l,ref in zip(lengths,refs))
            return pieces,any(l==ref[2] for l,ref in zip(lengths,refs)),round(f1,6)
        @functools.lru_cache(None)
        def metrics(hit):
            first=hit[0]
            selected=[coverage(i) for i in hit]
            recall=max(size(union(p for c in selected for p in c[0][j]))/n for j,(_,_,n) in enumerate(refs))
            return [int(selected[0][1]),int(recall==1),selected[0][2],round(recall,6),display[first][2]]
        results={}
        for name,(orders,view) in ranks.items():
            hit=orders[qi]
            ids=tuple(view[hit])
            results[name]=[*metrics(ids),int(hit[0]),hit.tolist()]
        rows.append(dict(id=q["id"],doc=doc["id"],text=q["text"],pool=pool,
                         kind="section" if q.get("kind")=="section" else "primary",methods=results))
        metrics.cache_clear();coverage.cache_clear()
    return rows,stats

def run(key,parent=False):
    raw=(ROOT/"data"/(key+".json")).read_bytes();data=json.loads(raw)
    source_hash=hashlib.sha256(raw).hexdigest()
    documents=[]
    protocol=json.loads((HERE/"context-parent-protocol.json").read_bytes()) if parent else None
    atoms=json.loads(gzip.decompress((ROOT/"atoms"/(key+".json.gz")).read_bytes())) if parent else None
    for di,doc in enumerate(data["docs"]):
        prefix=ROOT/"indexes"/key/str(di)
        idx=json.loads(gzip.decompress(prefix.with_suffix(".json.gz").read_bytes()))
        assert idx["inputSHA256"]==source_hash and idx["id"]==doc["id"]
        vect=prefix.with_suffix(".f32").read_bytes()
        assert hashlib.sha256(vect).hexdigest()==idx["vectorSHA256"]
        matrix=np.frombuffer(vect,dtype="<f4").reshape(len(idx["texts"]),idx["dimension"])
        documents.append(dict(id=doc["id"],ord=ordinals(doc["source"]),idx=idx,vec=matrix,atoms=atoms[di] if parent else None))
    groups=[documents] if data["pool"]=="collection" else [[d] for d in documents]
    rows=[];stats={}
    for group in groups:
        name="collection" if data["pool"]=="collection" else group[0]["id"]
        group_rows,group_stats=evaluate(group,name,key,protocol)
        rows.extend(group_rows);stats[name]=group_stats
    out=ROOT/("parent-scores" if parent else "scores");out.mkdir(exist_ok=True)
    path=out/(key+".json.gz")
    save(path.with_suffix(".tmp"),dict(key=key,domain=data["domain"],fold=data["fold"],inputSHA256=source_hash,
                                      stats=stats,fields=FIELDS,queries=rows))
    path.with_suffix(".tmp").replace(path)
    print(key,len(rows),"questions",flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("key");parser.add_argument("--parent",action="store_true");args=parser.parse_args()
    run(args.key,args.parent)
