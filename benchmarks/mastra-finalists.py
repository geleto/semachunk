"""Replay the frozen Semachunk and Mastra retrieval finalists on the five validation scopes."""
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH = runpy.run_path(str(HERE / "mastra-comparison.py"))
PRIOR = BENCH["PRIOR"]
CACHE = HERE / ".cache/mastra-finalists"
RESULT = HERE / "results/2026-11-28-mastra-finalists.json.gz"
SELECTION = json.loads((BENCH["ROOT"] / "selection.json").read_bytes())
PROFILES = {
    "semachunk": "blocks@structure+semantic@structure-near",
    "mastra": SELECTION["enhanced"],
    "mastraTwoLayouts": SELECTION["two"],
}
SCOPES = BENCH["FOLDS"][1:]


def combined(scope_values):
    replication = (scope_values["fresh"] + scope_values["shared-fresh"]) / 2
    holdout = (scope_values["holdout"] + scope_values["shared-holdout"]) / 2
    return (scope_values["confirmation"] + replication + holdout) / 3


def main():
    folds, draws, costs = {}, {}, {}
    for fold in SCOPES:
        qs, measured, counts = BENCH["score"](fold, list(PROFILES.values()), CACHE)
        groups = BENCH["groups_for"](qs)
        values = {method: measured[config] for method, config in PROFILES.items()}
        rates = {m: BENCH["macro"](v,groups).tolist() for m,v in values.items()}
        weights = PRIOR["bootstrap_weights"](qs,groups)
        draws[fold] = {m: weights @ (values["semachunk"][:,:2] - values[m][:,:2])
                       for m in PROFILES if m != "semachunk"}
        folds[fold] = dict(questions=qs, profiles={m:v.tolist() for m,v in values.items()}, balanced=rates,
                           questionMean={m:v.mean(axis=0).tolist() for m,v in values.items()},
                           perDomain={domain:{m:v[ix].mean(axis=0).tolist() for m,v in values.items()}
                                      for domain,ix in groups.items()})
        if not fold.startswith("shared-"):
            costs[fold] = counts
        print(fold,len(qs),{m:[round(x*100,2) for x in v[:2]] for m,v in rates.items()},flush=True)
    for fold in ["fresh","holdout"]:
        assert folds[fold]["questions"] == folds["shared-"+fold]["questions"]
    unique = [q for f in costs for q in folds[f]["questions"]]
    assert len(unique)==len({tuple(q) for q in unique})==1759
    sources = sum(len(spec["documents"]) for spec in BENCH["LIB"]["REG"].values() if spec["fold"] in costs)
    assert sources == 201
    rates, equal_questions, intervals = {}, {}, {}
    rng = np.random.default_rng(130187)
    permutations = {s:rng.permutation(3000) for s in ["fresh","holdout"]}
    for m in PROFILES:
        rates[m] = combined({s:np.array(folds[s]["balanced"][m]) for s in SCOPES}).tolist()
        equal_questions[m] = (sum(np.array(folds[s]["questionMean"][m]) * len(folds[s]["questions"]) *
                                  (1 if s=="confirmation" else .5) for s in SCOPES)/len(unique)).tolist()
        if m != "semachunk":
            d = {s:draws[s][m] for s in SCOPES}
            for f,perm in permutations.items():
                for s in [f,"shared-"+f]:
                    d[s] = d[s][perm]
            intervals[m] = (100*np.quantile(combined(d),[.025,.975],axis=0).T).tolist()
    registry = BENCH["LIB"]["REG"]
    result = dict(methods=PROFILES, mastraVersion=BENCH["PROTOCOL"]["package"], model=BENCH["PROTOCOL"]["model"],
                  dimensions=1536, passageTokens=512, metrics=PRIOR["METRICS"], uniqueQuestions=len(unique), sources=sources,
                  splitSources={f:sum(len(s["documents"]) for s in registry.values() if s["fold"]==f) for f in costs},
                  candidateCounts=costs, folds=folds, balanced=rates, equalQuestions=equal_questions, paired95pp=intervals)
    BENCH["PLACEMENT"]["packed"](RESULT,result)
    print(json.dumps(dict(balanced=rates,equalQuestions=equal_questions,paired95pp=intervals),indent=2))


if __name__=="__main__":
    main()
