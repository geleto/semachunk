"""Summarize paired source-level evidence and real SQLite shortlist checks."""
import collections
import gzip
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
lib = runpy.run_path(str(HERE / "query-parents.py"))
OUT = lib["OUT"]
REG = lib["prior"].registry
PLANS = lib["PLANS"]
RES = HERE / "results"


def read(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def mean(rows, observation):
    return np.mean([observation(row) for row in rows], axis=0)


def macro(groups, observation):
    return np.mean([mean(rows, observation) for rows in groups.values() if rows], axis=0).tolist()


def paired(groups, a, b, observation):
    rng = np.random.default_rng(9152)
    samples = []
    for _, rows in sorted(groups.items()):
        by_doc = collections.defaultdict(list)
        for r in rows:
            by_doc[r["doc"]].append(np.asarray(observation(r, a)) - np.asarray(observation(r, b)))
        docs = [by_doc[d] for d in sorted(by_doc)]
        totals = np.array([np.sum(one, axis=0) for one in docs])
        counts = np.array([len(one) for one in docs])
        draws = rng.integers(0, len(docs), (3000, len(docs)))
        samples.append(totals[draws].sum(axis=1) / counts[draws].sum(axis=1)[:, None])
    ci = np.quantile(np.mean(samples, axis=0), [.025, .975], axis=0)
    return ci.tolist()


def score(r, name):
    return r["metrics"][name]


def containment(r, plan):
    out = []
    for rank in r["support"][plan]:
        out.extend([int(rank > 0), int(rank == 1), int(rank > 1), int(rank == 0)])
    return out


def disagreement(r, p):
    reference = r["support"]["blocks256"][1]
    semantic = r["support"][p][1]
    return [int(reference == 1 and semantic == 0), int(reference == 1 and semantic > 1),
            int(semantic == 1 and reference == 0), int(semantic == 1 and reference > 1)]


def shortlist(rows, lookup):
    by_k = {}
    for k in lib["DEPTHS"]:
        for method in ("parent", "both"):
            name = method + str(k)
            by_k[name] = mean(rows, lambda r: lookup(r)[name]).tolist()
    return dict(queries=len(rows), values=by_k)


def main():
    table = {}
    stats = {}
    structure = {}
    for fold in ("development", "confirmation", "fresh"):
        groups = collections.defaultdict(list)
        edges = []
        formed = collections.Counter()
        for key, meta in REG.items():
            if meta["fold"] != fold:
                continue
            files = [read(OUT / stage / (key + ".json.gz")) for stage in ("query", "paragraphs", "keys", "bridge-support","anchors")]
            for q, paragraph, keys, bridge, anchors in zip(*files, strict=True):
                assert q["id"] == paragraph["id"] == keys["id"] == bridge["id"] == anchors["id"]
                assert q["doc"] == paragraph["doc"] == keys["doc"] == bridge["doc"] == anchors["doc"]
                q["withinOneUnit"] = keys["withinOneUnit"]
                q["metrics"].update(paragraph["metrics"])
                q["metrics"].update(keys["metrics"])
                q["metrics"].update(anchors["metrics"])
                for p, ranks in bridge["support"].items():
                    q["support"][p+"@section"] = ranks
                    assert np.max(np.abs(np.subtract(bridge["metrics"][p+"/both/window"],q["metrics"][p+"/section"]))) < 1e-5
                    if p+"/embed-joined" in anchors["metrics"]:
                        assert np.allclose(anchors["metrics"][p+"/embed-joined"],q["metrics"][p+"/section"], atol=1e-5)
                for k in (25,40,55):
                    name = "tree25-para"+str(k)
                    q["metrics"][name+"-relocated/section"] = np.mean([q["metrics"][name+"-"+roll+"/section"] for roll in ("rollA","rollB")], axis=0)
            groups[meta["domain"]].extend(files[0])
            for di, _ in enumerate(meta["documents"]):
                idx = read(OUT / "indexes" / key / (str(di) + ".json.gz"))
                edges.extend(idx["paragraphSimilarities"])
                formed.update({p:len(cs) for p, cs in idx["plans"].items()})
        rows = sum(groups.values(), [])
        names = sorted(rows[0]["metrics"])
        assert all(set(r["metrics"]) == set(names) for r in rows)
        table[fold] = {n: macro(groups, lambda r: score(r,n)) for n in names}
        structure[fold] = dict(adjacentPairsWithinSection=len(edges), formed=dict(formed),
                               paragraphQuantiles=np.quantile(edges,[.1,.25,.5,.75,.9]).tolist(),
                               passCounts={str(k):int(np.sum(np.asarray(edges) >= k/100)) for k in (25,40,55,70)})
        stats[fold] = dict(queries=len(rows), documents=len({q["doc"] for q in rows}),
                           counts={d:len(rr) for d,rr in groups.items()},
                           containment={p:macro(groups,lambda r: containment(r,p)) for p in rows[0]["support"]},
                           pairedContainment={p:paired(groups,"blocks256",p,containment) for p in PLANS[1:]},
                           disagreements={p:macro(groups,lambda r:disagreement(r,p)) for p in PLANS[1:]})
        def bridge_changes(row):
            old = row["support"]["tree25-any@section"][1]
            new = row["support"]["tree25-para0-bridge@section"][1]
            return [int(old == 0 and new == 1), int(old > 1 and new == 1),
                    int(old == 1 and new == 0), int(old == 1 and new > 1)]
        stats[fold]["paragraphJoinChanges"] = dict(fields=["gainPreviouslyUnavailable","gainPreviouslyRankedLower",
            "lossNowUnavailable","lossNowRankedLower"], macro=macro(groups,bridge_changes), counts=np.sum([bridge_changes(r) for r in rows],axis=0).tolist())
        stats[fold]["anchorTransitions"] = dict(collections.Counter("".join(str(int(r["metrics"][p][0])) for p in
            ("tree25-any/section","tree25-para0-bridge/old-scores","tree25-para0-bridge/embed-joined")) for r in rows))
        key_names = [p+"/both/window" for p in PLANS]
        stats[fold]["domains"] = {d:{n:mean(rr, lambda r:score(r,n)).tolist() for n in key_names} for d,rr in groups.items()}
        stats[fold]["evidenceGroups"] = {}
        for one in (True, False):
            sub = {d:[r for r in rr if r["withinOneUnit"] == one] for d,rr in groups.items()}
            stats[fold]["evidenceGroups"][str(one)] = dict(counts={d:len(rr) for d,rr in sub.items()},
                means={p:macro(sub,lambda r:containment(r,p)) for p in PLANS})
        common = {d:rr for d,rr in groups.items() if min(sum(r["withinOneUnit"] for r in rr),
                  sum(not r["withinOneUnit"] for r in rr)) >= 4}
        stats[fold]["evidenceGroupsCommonDomains"] = {}
        for one in (True,False):
            sub = {d:[r for r in rr if r["withinOneUnit"] == one] for d,rr in common.items()}
            stats[fold]["evidenceGroupsCommonDomains"][str(one)] = dict(counts={d:len(rr) for d,rr in sub.items()},
                metrics={n:macro(sub,lambda r:score(r,n)) for n in key_names},
                paired={p:paired(sub,p+"/both/window","blocks256/both/window",score) for p in PLANS[1:]})
        baselines = [("s25-any/para40", "s25-any/paragraph"), ("s25-any/para40", "s25-any/section"),
                     ("s25-para40-override/section","s25-section/section"),
                     ("tree25-para40-bridge/section","tree25-any/section"),
                     ("tree25-para40-bridge/section","tree25-para0-bridge/section"),
                     ("tree25-para25-bridge/section","tree25-any/section"),
                     ("s25-para25-override/section","s25-section/section")]
        baselines.extend((p+"/both/window",p+"/parent/window") for p in PLANS)
        baselines.extend((p+"/sentence/add36",p+"/sentence/joint") for p in PLANS)
        baselines.extend((p+"/chunk/add36",p+"/chunk/joint") for p in PLANS)
        baselines.extend([("tree25-para0-bridge/section","tree25-any/section"),
                          ("tree25-para0-bridge/section","blocks256/section")])
        baselines.extend((f"tree25-para{k}-bridge/section",f"tree25-para{k}-relocated/section") for k in (25,40,55))
        for k in (0,25):
            p = f"tree25-para{k}-bridge/"
            baselines.extend([(p+"old-scores","tree25-any/section"),(p+"embed-joined",p+"old-scores"),
                              (p+"embed-joined",p+"mean-old-vectors")])
        stats[fold]["paired"] = {a+" minus "+b:paired(groups,a,b,score) for a,b in baselines}
        if fold == "fresh":
            stats[fold]["sqlite"] = {}
            for p in PLANS:
                accessor = lambda r:r["db"][p]["depths"]
                stats[fold]["sqlite"][p] = {name:shortlist(rr,accessor) for name,rr in [
                    ("all",rows),("atLeast100Parents",[r for r in rows if r["db"][p]["size"][0]>=100])]}
            stats[fold]["example"] = next(r["example"] for r in rows if "example" in r)
    comparison = {}
    for p in PLANS:
        data = read(OUT/"global"/(p+".json.gz"))
        global_rows = data["rows"]
        groups = collections.defaultdict(list)
        for r in global_rows:
            groups[r["domain"]].append(r)
        comparison[p] = {**{k:v for k,v in data.items() if k!="rows"},
                         "sqlite":shortlist(global_rows,lambda r:r["depths"]),
                         "metrics":{n:macro(groups,lambda r:score(r,n)) for n in global_rows[0]["metrics"]}}
    shared_sections = {}
    for plan in ("blocks256","tree25-any","tree25-para0-bridge","tree25-para25-bridge"):
        data = read(OUT/"shared-bridges"/(plan+".json.gz"))
        groups = collections.defaultdict(list)
        for r in data["rows"]:
            groups[r["domain"]].append(r)
        shared_sections[plan] = dict(size=data["size"], metrics={k:macro(groups, lambda r:score(r,k)) for k in data["rows"][0]["metrics"]})
    report = dict(evidenceFields=["completeFirst","completeFive","firstEvidenceF1","firstNonwhiteCharacters"],
                  containmentFields=[s+"-"+f for s in ("core","window") for f in ("available","first","rankedBelowFirst","unavailable")],
                  disagreementFields=["blocksFirst-otherUnavailable","blocksFirst-otherAvailable","otherFirst-blocksUnavailable","otherFirst-blocksAvailable"],
                  shortlistFields=["sameFirst","fractionOfReferenceFive","allReferenceFive","meanCandidateParents","meanCandidateUnits"],
                  macro=table, diagnostics=stats, paragraphStructure=structure, sharedPool=comparison, sharedSections=shared_sections)
    (RES/"2026-11-27-query-parents.json").write_text(json.dumps(report,indent=2,allow_nan=False)+"\n",encoding="utf8")


if __name__ == "__main__":
    main()
