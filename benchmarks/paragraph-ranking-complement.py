"""Measure what a perfect choice from two frozen retrieval lists could recover."""
import itertools
import json
import runpy
from collections import defaultdict
from functools import reduce
from operator import or_
from pathlib import Path

import numpy as np

here = Path(__file__).resolve().parent
ranking = runpy.run_path(str(here / "paragraph-ranking.py"))
root = ranking["ROOT"]
selected = json.loads((root / "compact-selection.json").read_bytes())["nominees"]
profiles = {
    "blocks": selected["blocks"],
    "semantic": selected["tree"],
    "secondBlocks": selected["structural-rerank"]["alt"],
}


def can_cover(masks, target, limit):
    if target in masks:
        return True
    if limit == 1 or reduce(or_, masks, 0) != target:
        return False
    useful = set(masks) - {0}
    maximal = [m for m in useful if not any(m != n and m & n == m for n in useful)]
    if len(maximal) <= limit:
        return True
    return any(reduce(or_, chosen) == target for chosen in itertools.combinations(maximal, limit))


def diagnose(fold):
    by_domain = defaultdict(list)
    for pool in ranking["pools"](fold):
        hits = {name: pool.run(config) for name, config in profiles.items()}
        geometry = {}
        for i, doc in enumerate(pool.docs):
            geometry[doc["id"]] = {
                name: {pool.offsets[i] + c["win"] for c in doc["ix"]["layouts"][config["layouts"][0]]}
                for name, config in profiles.items()
            }
        for qi, (doc, _) in enumerate(pool.qs):
            refs = pool.refs[qi]
            targets = [(1 << ranking["ev"].size(spans)) - 1 for _, spans in refs]
            assert all(targets)

            def reachable(views, limit):
                candidates = [pool.evidence(qi, v) for v in set(views)]
                return any(can_cover([r[i] for r in candidates], target, limit)
                           for i, target in enumerate(targets))

            base = hits["blocks"][qi]
            scores = {}
            for name in profiles:
                shortlist = hits[name][qi]
                available = set().union(*(geometry[source][name] for source, _ in refs))
                scores[name + "First"] = reachable(shortlist[:1], 1)
                scores[name + "SingleInFive"] = reachable(shortlist, 1)
                scores[name + "AcrossFive"] = reachable(shortlist, 5)
                scores[name + "Geometry"] = reachable(available, 1)
                assert tuple(map(int, (scores[name + "First"], scores[name + "AcrossFive"]))) == pool.grade(qi, shortlist)[:2]
                if name == "blocks":
                    continue
                scores[name + "OrBlocksFirst"] = scores["blocksFirst"] or scores[name + "First"]
                scores[name + "OrBlocksGeometry"] = scores["blocksGeometry"] or scores[name + "Geometry"]
                scores[name + "WithBlocksSingleInTen"] = reachable(base + shortlist, 1)
                scores[name + "WithBlocksBestFiveOfTen"] = reachable(base + shortlist, 5)
            by_domain[doc["domain"]].append(scores)
    keys = next(iter(by_domain.values()))[0].keys()
    totals = {
        domain: {key: sum(row[key] for row in rows) for key in keys}
        for domain, rows in by_domain.items()
    }
    return {
        "questions": {domain: len(rows) for domain, rows in by_domain.items()},
        "successCounts": {key: sum(d[key] for d in totals.values()) for key in keys},
        "domainSuccessCounts": totals,
        "rates": {key: float(np.mean([totals[d][key] / len(rows) for d, rows in by_domain.items()]))
                  for key in keys},
    }


result = {"profiles": profiles, "folds": {fold: diagnose(fold) for fold in ("holdout", "shared-holdout")}}
(root / "complement.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
