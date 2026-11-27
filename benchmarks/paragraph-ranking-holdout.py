"""Freeze new sources and references before selecting any retrieval configuration."""
import json
import runpy
from pathlib import Path

here = Path(__file__).resolve().parent
data = runpy.run_path(str(here/"mixture-data.py"))
m = data["m"]
old = m.CACHE/"context-mixtures"
m.OUT = m.CACHE/"paragraph-ranking/holdout-data"
m.OUT.mkdir(parents=True, exist_ok=True)
m.manifest = {}
source_ids, contents, questions = set(), set(), set()
for key, meta in json.loads((old/"data/manifest.json").read_bytes()).items():
    src = old/("audited-data" if meta["fold"] == "fresh" else "data")/(key+".json")
    for d in json.loads(src.read_bytes())["docs"]:
        source_ids.add(d["id"])
        contents.add(m.digest(m.compact(d["source"]).casefold().encode()))
        questions.update(m.compact(q["text"]).casefold() for q in d["questions"])

m.fiction(splits=[("train","holdout",24)], exclude=source_ids)
m.meetings(splits=[("train","holdout",10)], exclude=source_ids)
data["papers"](fold="holdout", count=24, exclude=source_ids)
for key, meta in list(m.manifest.items()):
    docs = json.loads((m.OUT/(key+".json")).read_bytes())["docs"]
    for d in docs:
        fingerprint = m.digest(m.compact(d["source"]).casefold().encode())
        assert d["id"] not in source_ids and fingerprint not in contents
        source_ids.add(d["id"])
        contents.add(fingerprint)
        d["questions"] = [q for q in d["questions"] if q.get("kind") != "section"
                          and m.compact(q["text"]).casefold() not in questions]
        for q in d["questions"]:
            assert q["references"] and all(ref and all(0<=a<b<=m.units(d["source"]) for a,b in ref) for ref in q["references"])
    m.write(key, meta["domain"], "holdout", "document", docs, meta["source"])
(m.OUT/"manifest.json").write_text(json.dumps(m.manifest, indent=2), encoding="utf-8")
print({k:(len(x["documents"]),sum(d["questions"] for d in x["documents"])) for k,x in m.manifest.items()})
