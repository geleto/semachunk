"""Measure public API results against the independent audited source references."""
import collections
import gzip
import json
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
prior = runpy.run_path(str(HERE / "hierarchy-probes.py"))
report = runpy.run_path(str(HERE / "query-parents-report.py"))
ev = prior["ev"]
root = HERE / ".cache"
data = json.loads(gzip.decompress((root / "document-routing/public/retrieval.json.gz").read_bytes()))
for file in ("source-headings.json.gz","section-ranges.json.gz"):
    outlines = json.loads(gzip.decompress((root / "document-routing/public" / file).read_bytes()))
    data["counters"].update(outlines["counters"])
    for a,b in zip(data["rows"],outlines["rows"],strict=True):
        assert (a["doc"],a["id"])==(b["doc"],b["id"])
        a["hits"].update(b["hits"])
orders, answers = {}, {}
for key, meta in prior["registry"].items():
    if meta["fold"] != "fresh":
        continue
    for d in json.loads((root / "context-mixtures/audited-data" / (key+".json")).read_bytes())["docs"]:
        orders[d["id"]] = ev.ordinals(d["source"])
        for q in d["questions"]:
            if q.get("kind") == "section":
                continue
            refs = [(d["id"],r) for r in q.get("references",[q.get("ranges")])]
            refs.extend((a["source"],a["ranges"]) for a in q.get("alternativeSources",[]))
            answers[(d["id"],q["id"])] = refs


def ordinals(doc, spans):
    o = orders[doc]
    return ev.union((o[a],o[b]) for a,b in spans)


def score(hits, refs):
    first, five, f1 = 0, 0, 0
    views = [(doc,ordinals(doc,r)) for doc,r in hits]
    first_size = ev.size(views[0][1])
    for doc,r in refs:
        reference = ordinals(doc,r)
        overlap = [ev.intersect(ref,reference) if d==doc else [] for d,ref in views]
        full = ev.size(reference)
        first = max(first, int(ev.size(overlap[0])==full))
        five = max(five, int(ev.size(ev.union(s for pieces in overlap for s in pieces))==full))
        f1 = max(f1, 2*ev.size(overlap[0])/(first_size+full))
    return [first,five,f1,first_size]


groups = collections.defaultdict(list)
for row in data["rows"]:
    refs = answers.pop((row["doc"],row["id"]))
    groups[row["domain"]].append(dict(doc=row["doc"], metrics={k:score(v,refs) for k,v in row["hits"].items()}))
assert not answers
labels = data["rows"][0]["hits"]
metric = lambda r,k: r["metrics"][k]
out = dict(questions=len(data["rows"]),cost=data["counters"],
           rates={k:report["macro"](groups,lambda r:metric(r,k)) for k in labels},
           perDomain={domain:{k:report["mean"](rows,lambda r:metric(r,k)).tolist() for k in labels}
                      for domain,rows in groups.items()},
           sectionVsParagraph={pool:report["paired"](groups,pool+"/bothJoined/0.15",pool+"/bothJoined/0",metric)
                               for pool in ("original","shared")},
           suppliedSectionsVsParagraph={pool:report["paired"](groups,pool+"/routingOutline/0.15",pool+"/bothJoined/0",metric)
                                       for pool in ("original","shared")})
document_groups = collections.defaultdict(list)
for r in json.loads((root / "document-routing/public/documents.json").read_bytes()):
    document_groups[r["domain"]].append(r)
out["sharedDocumentRetrieval"] = report["macro"](document_groups,lambda r:[r["rank"]==1,r["rank"]<=5])
(HERE / "results/2026-11-27-document-api.json").write_text(json.dumps(out,indent=2),encoding="utf-8")
