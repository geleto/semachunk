"""Score whole documents and multi-paragraph sections without sentence keys."""
import collections
import hashlib
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
prior = runpy.run_path(str(HERE / "hierarchy-probes.py"))
report = runpy.run_path(str(HERE / "query-parents-report.py"))
engine, registry = prior["engine"], prior["registry"]
ROOT = HERE / ".cache/document-routing"
PLANS = ("blocks", "joined", "hybrid")


def extract(key, cost):
    root = ROOT / key
    manifest = json.loads((root / "manifest.json").read_bytes())
    blob = (root / "documents.f32").read_bytes()
    assert hashlib.sha256(blob).hexdigest() == manifest["sha256"]
    docs = np.frombuffer(blob, dtype="<f4").reshape(len(manifest["ids"]), -1)
    for i, (doc, ix, vectors) in enumerate(prior["documents"](key)):
        assert manifest["ids"][i] == doc["id"]
        assert hashlib.sha256(doc["source"].encode()).hexdigest() == manifest["hashes"][i]
        links = prior["relationships"](doc, ix)
        cores = set(c for name in PLANS for c in ix["plans"][name])
        sections = set(ix["levels"].get("section", []))
        paragraphs = sorted(ix["levels"].get("paragraph", []))
        spans = ix["passages"]
        ordinals = prior["ev"].ordinals(doc["source"])
        def ink(p):
            return prior["ev"].union((ordinals[a],ordinals[b]) for a,b in spans[p]["spans"])
        geometry = {p:ink(p) for p in cores | sections | set(paragraphs)}
        def contains(outer, inner):
            return geometry[inner] and all(any(a<=s and t<=b for a,b in geometry[outer]) for s,t in geometry[inner])
        def multiple(p):
            return sum(bool(contains(p,j)) for j in paragraphs) >= 2
        sections = {p for p in sections if multiple(p)}
        ancestor = {}
        eligible = sorted((p for p in sections if geometry[p]!=[(0,ordinals[-1])]),
                          key=lambda p: (prior["ev"].size(geometry[p]),p))
        for c in cores:
            ancestor[c] = next((p for p in eligible if contains(p,c) and geometry[c]!=geometry[p]),None)
        settings = {n: ix["configs"][n]["settings"]["section"] for n in PLANS}
        keys = {c: (links[c][0], sorted(set(links[c][1]) & sections), ancestor[c]) for c in cores}
        for name in PLANS:
            candidates = ix["plans"][name]
            used = set(candidates) | {p for c in candidates for p in keys[c][0]}
            def hashes(ids):
                return {ix["hashes"][spans[p]["v"]] for p in ids}
            cost[name+"/paragraph"].update(hashes(used))
            cost[name+"/withSections"].update(hashes(used|sections))
            cost[name+"/withSectionsAndDocuments"].update(hashes(used|sections)|{manifest["hashes"][i]})
        wanted = sorted(cores | {p for rows in settings.values() for row in rows for p in row if p >= 0}
                        | {p for pa, se, a in keys.values() for p in [*pa, *se, a] if p is not None})
        pm = {p: j for j, p in enumerate(wanted)}
        vids = sorted({spans[p]["v"] for p in wanted} | {q["v"] for q in ix["questions"]})
        vm = {v: j for j, v in enumerate(vids)}
        lean = dict(plans={n: [pm[c] for c in ix["plans"][n]] for n in PLANS},
                    configs={n: dict(bridges=[], settings=dict(section=[[pm.get(p,-1) for p in row] for row in rows]))
                             for n, rows in settings.items()},
                    members={str(pm[c]): [pm[c]] for c in cores},
                    passages=[{**spans[p], "v": vm[spans[p]["v"]]} for p in wanted],
                    questions=[{**q, "v": vm[q["v"]]} for q in ix["questions"]])
        local = {pm[c]: ([pm[p] for p in pa], [pm[p] for p in se], pm.get(a)) for c, (pa, se, a) in keys.items()}
        yield (doc, lean, vectors[vids]), local, docs[i]


def evaluate(rows):
    group, parents, whole_docs = zip(*rows)
    doc_scores, similarity = None, None
    def rank(plan, cores, children, V, P, Q, neighbors, view, bare, add):
        nonlocal doc_scores, similarity
        if similarity is None:
            query = engine.unit(Q)
            similarity = query @ engine.unit(V).T
            doc_scores = query @ engine.unit(np.stack(whole_docs)).T
        whole = similarity[:, P[cores]]
        owners, paras, upper, enclosing = [], [], [], []
        offset = 0
        for i, ((_, ix, _), links) in enumerate(zip(group, parents)):
            for c in ix["plans"][plan]:
                pa, se, a = links[c]
                owners.append(i)
                paras.append([offset+p for p in pa])
                upper.append([offset+p for p in se])
                enclosing.append(None if a is None else offset+a)
            offset += len(ix["passages"])
        def best(keys, fallback):
            return np.stack([similarity[:, P[ps]].max(axis=1) if ps else fallback[:, j]
                             for j, ps in enumerate(keys)], axis=1)
        base = .5*(whole+best(paras, whole))
        plus = .5*(whole+best([a+b for a,b in zip(paras,upper)], whole))
        window = np.array([view([l,c,r]) for c,(l,r,_) in zip(cores,neighbors["section"])])
        section = np.stack([similarity[:, P[a]] if a is not None else base[:, j] for j,a in enumerate(enclosing)],axis=1)
        doc = doc_scores[:, owners]
        add("paragraph", base, window, diverse=True)
        add("containedSection", plus, window, diverse=True)
        for s, d in ((.15,0),(0,.05),(0,.15),(0,.30),(.15,.15)):
            add(f"s{round(100*s)}d{round(100*d)}", (1-s-d)*base+s*section+d*doc, window, diverse=True)
    result = engine.evaluate(group, experiment=rank)
    if result is None:
        return []
    qs, metrics, _ = result
    indices = np.argsort(-doc_scores, kind="stable")
    ids = [doc["id"] for doc, _, _ in group]
    answer_docs = [{ids[i], *(a["source"] for a in q.get("alternativeSources", []))}
                   for i, (_, ix, _) in enumerate(group) for q in ix["questions"]]
    return [dict(doc=q["doc"], id=q["id"], metrics={k:v[j].tolist() for k,v in metrics.items()},
                 documentRank=next(k+1 for k,i in enumerate(indices[j]) if ids[i] in answer_docs[j]))
            for j,q in enumerate(qs)]


def summarize(rows, domains):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[domains[row["doc"]]].append(row)
    macro, paired = report["macro"], report["paired"]
    metric = lambda row, name: row["metrics"][name]
    return dict(questions=len(rows), domains=len(groups),
                documentRetrieval=macro(groups,lambda r: [r["documentRank"]==1,r["documentRank"]<=5]),
                rates={n:macro(groups,lambda r:r["metrics"][n]) for n in rows[0]["metrics"]},
                hybridByDomain={d:{n:report["mean"](rs,lambda r:metric(r,n)).tolist()
                                   for n in ("hybrid/paragraph","hybrid/s15d0","hybrid/s0d15")}
                                for d,rs in groups.items()},
                intervalVsParagraph={n:paired(groups,n,n.split("/")[0]+"/paragraph",metric)
                                     for n in rows[0]["metrics"] if not n.endswith("/paragraph")})


if __name__ == "__main__":
    results = {}
    for fold in ("development", "confirmation", "fresh"):
        shared, rows, domains = [], [], {}
        cost = collections.defaultdict(set)
        for key, meta in registry.items():
            if meta["fold"] != fold:
                continue
            shard = list(extract(key,cost))
            domains.update({d["id"]:meta["domain"] for (d,_,_),_,_ in shard})
            if meta["pool"] == "collection":
                rows.extend(evaluate(shard))
            else:
                for d in shard:
                    rows.extend(evaluate([d]))
            if fold=="fresh":
                shared.extend(shard)
            print(key, flush=True)
        results[fold] = summarize(rows, domains)
        results[fold]["documents"] = len(domains)
        results[fold]["uniqueVectors"] = {n:len(keys) for n,keys in cost.items()}
        if shared:
            results["shared"] = summarize(evaluate(shared), domains)
            results["shared"]["documents"] = len(domains)
    path = HERE / "results/2026-11-27-document-routing.json"
    path.write_text(json.dumps(results, indent=2), encoding="utf-8")
