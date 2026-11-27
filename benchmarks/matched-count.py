"""Run and summarize the per-document, uncapped semantic threshold comparison."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
import runpy
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "results"
STUDY = "2026-11-26-matched-count"
previous = runpy.run_path(str(HERE / "semantic-settings-run.py"))
interval = runpy.run_path(str(HERE / "semantic-settings-report.py"))["interval"]
read = previous["read"]
protocol = read(HERE / "matched-count-protocol.json")
model = protocol["model"]
STAGING = previous["STORE"] / "matched-count" / model
SEEDS = ["shuffle" + str(v) for v in protocol["shuffles"]]
METRICS = ["complete512", "recall512", "complete1024", "recall1024", "completeInOnePassage",
           "completeTop5", "completeTop1", "recallTop1", "recallTop5", "top5Tokens",
           "completeTop1At256", "recallTop1At256", "top1Tokens"]


def measure(keys, workers, script="matched-count.mjs"):
    groups = defaultdict(list)
    for key in keys:
        group = key.rsplit("-", 1)[0] if key.startswith(("government-", "faq-")) else key
        groups[group].append(key)

    def run_group(group):
        for key in group:
            subprocess.run(["node", str(HERE / script), key], cwd=HERE.parent, check=True,
                           env={**os.environ, "SEMACHUNK_BENCHMARK_MODEL": model})

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        list(executor.map(run_group, groups.values()))


def mean_vectors(vectors):
    return [statistics.mean(col) for col in zip(*vectors, strict=True)]


def observations(rows, subset="all", *, matched=("semantic",), shuffles=SEEDS):
    groups = defaultdict(dict)
    for row in rows:
        domain = previous["cohort"](row["key"])
        for i, (qid, cluster, _, doc) in enumerate(row["queries"]):
            methods = row["documents"][doc]["methods"]
            k = len(methods["blocks"]["sizes"])
            keep = subset == "all" or (k > 1 and all(len(methods[m]["sizes"]) == k for m in matched))
            v = {m: row["methods"][m]["outcomes"][i] for m in ["blocks", *matched, *shuffles]}
            if shuffles:
                v["shuffled"] = mean_vectors([v[m] for m in shuffles])
            group = groups[domain].setdefault(qid, [])
            group.append((cluster, keep, v))
    obs = {}
    for domain, values in groups.items():
        obs[domain] = []
        for views in values.values():
            if not all(row[1] for row in views):
                continue
            cluster = views[0][0]
            assert all(row[0] == cluster for row in views)
            obs[domain].append((cluster, {m: mean_vectors([row[2][m] for row in views])
                                          for m in views[0][2]}))
    return {k: v for k, v in obs.items() if v}


def describe(observations, metrics=METRICS):
    domains = {}
    for domain, rows in observations.items():
        domains[domain] = {m: dict(zip(metrics, mean_vectors([v[m] for _, v in rows]), strict=True))
                           for m in rows[0][1]}
    names = next(iter(domains.values()))
    macro = {m: {key: statistics.mean(v[m][key] for v in domains.values()) for key in metrics} for m in names}
    return {"questions": {k: len(v) for k, v in observations.items()}, "domains": domains, "macro": macro}


def contrast(obs, method, control, metric, metrics=METRICS, confidence=.95):
    i = metrics.index(metric)
    paired = {k: [(cluster, [v[method][i]], [v[control][i]]) for cluster, v in rows]
              for k, rows in obs.items()}
    delta = 100 * statistics.mean(statistics.mean(a[0] - b[0] for _, a, b in rows) for rows in paired.values())
    label = "paired" + f"{100*confidence:.2f}".rstrip("0").rstrip(".")
    return {"deltaPoints": round(delta, 4), label: interval(paired, confidence)}


def quantiles(values):
    ordered = sorted(values)
    if not ordered:
        return {}
    return {name: ordered[round(p * (len(ordered) - 1))] for name, p in
            [("min", 0), ("p10", .1), ("median", .5), ("p90", .9), ("p95", .95), ("p99", .99), ("max", 1)]}


def layouts(docs, method):
    base = [d["methods"]["blocks"] for d in docs]
    cmp = [d["methods"][method] for d in docs]
    sizes = [n for row in cmp for n in row["sizes"]]
    errors = [len(b["sizes"]) - len(a["sizes"]) for a, b in zip(base, cmp, strict=True)]
    cutoffs = [b["cutoff"] for b in cmp if b.get("cutoff", -1) > -1]
    return {"documents": len(docs), "chunks": len(sizes), "tokens": sum(sizes), "sizeTokens": quantiles(sizes),
            "over256": sum(n > 256 for n in sizes), "over512": sum(n > 512 for n in sizes),
            "over1024": sum(n > 1024 for n in sizes), "over8191": sum(n > 8191 for n in sizes),
            "exactCount": errors.count(0), "withinOne": sum(abs(e) <= 1 for e in errors),
            "fewer": sum(e < 0 for e in errors), "more": sum(e > 0 for e in errors),
            "absoluteCountError": sum(map(abs, errors)), "maxCountError": max(map(abs, errors)),
            "sameLayout": sum(a["layoutSHA256"] == b["layoutSHA256"] for a,b in zip(base,cmp,strict=True)),
            "nontrivialCutoffs": len(cutoffs), "cutoffs": quantiles(cutoffs)}


def summarize(rows):
    obs = observations(rows)
    exact = observations(rows, "exact-multiple")
    stats = describe(obs)
    stats["exactMultiple"] = describe(exact)
    stats["exactMultiple"]["comparison"] = contrast(exact, "semantic", "blocks", "complete512")
    docs = [d for row in rows for d in row["documents"]]
    stats["layouts"] = {m: layouts(docs, m) for m in ("blocks", "semantic", *SEEDS)}
    stats["distinctSources"] = len({(previous["cohort"](r["key"]), d["id"]) for r in rows for d in r["documents"]})
    stats["longSelectionInputs"] = sum(d["longInputs"] for d in docs)
    stats["comparisons"] = {control: {m: contrast(obs, "semantic", control, m) for m in
                             ("complete512", "complete1024", "completeTop1", "completeTop5", "completeTop1At256")}
                            for control in ("blocks", "shuffled")}
    stats["byDomain512"] = {k: contrast({k: rows}, "semantic", "blocks", "complete512") for k,rows in obs.items()}
    return stats


def report(keys, manifest):
    old = OUT / "2026-11-26-semantic-settings-outcomes.jsonl.gz"
    with gzip.open(old, "rt", encoding="utf8") as f:
        archived = {r["key"]: r for line in f if (r := json.loads(line)).get("model") == model and r.get("limit") == 256}
    raw = OUT / (STUDY + "-outcomes.jsonl.gz")
    tmp = raw.with_suffix(".tmp")
    rows = [read(STAGING / (key + ".json")) for key in keys]
    checked = 0
    with tmp.open("wb") as file, gzip.GzipFile(filename="", fileobj=file, mode="wb", mtime=0) as f:
        for r in rows:
            assert r["version"]==2 and r["dataSHA256"] == manifest["sets"][r["key"]]["sha256"]
            ref = archived[r["key"]]
            assert [q[:3] for q in r["queries"]] == [q[:3] for q in ref["queries"]]
            base = r["methods"]["blocks"]
            assert base["layoutSHA256"] == ref["methods"]["blocks"]["layoutSHA256"]
            assert [v[:6] for v in base["outcomes"]] == ref["methods"]["blocks"]["outcomes"]
            checked += len(r["queries"])
            f.write((json.dumps(r, ensure_ascii=False, separators=(",", ":"))+"\n").encode())
    result = {"protocol": protocol, "metrics": METRICS, "baselineOutcomesReproduced": checked,
              "additionalDiagnostic": "After seeing the untrimmed top-one results, replay the same rankings and clip the first hit to 256 tokens for every method. Also record the untrimmed first hit's token count.",
              "newEmbeddingTokens": sum(r["newTokens"] for r in rows)}
    for fold in ("confirmation", "development"):
        result[fold] = summarize([r for r in rows if ("-development-" in r["key"]) == (fold == "development")])
    tmp.replace(raw)
    result["archiveSHA256"] = hashlib.sha256(raw.read_bytes()).hexdigest()
    (OUT / (STUDY + ".json")).write_text(json.dumps(result, indent=2)+"\n", encoding="utf8", newline="\n")
    for k in ("confirmation", "development"):
        print(k, {m: round(result[k]["macro"][m]["complete512"]*100, 2) for m in ("blocks", "semantic", "shuffled")})
    print(checked, "baseline query/rendering outcomes reproduced")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", nargs="?", default="all", choices=["all", "measure", "report"])
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    data = read(previous["MANIFEST"])
    keys = sorted((k for k in data["sets"] if previous["primary"](k)), key=lambda k: ("-development-" in k, k))
    if args.stage != "report":
        measure(keys, args.workers)
    if args.stage != "measure":
        report(keys, data)
