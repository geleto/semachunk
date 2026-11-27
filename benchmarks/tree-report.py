"""Validate every planned run and publish paired outcomes with source-clustered intervals."""
import gzip
import hashlib
import json
import random
import runpy
import statistics
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
run = runpy.run_path(str(HERE / "tree-study.py"))
CACHE, MANIFEST = run["CACHE"], run["MANIFEST"]
RESULTS = HERE / "results"


def bootstrap(groups, numerator, denominator):
    items = list(groups.values())
    if len(items) < 2:
        return None
    rng = random.Random(20261126)
    values = []
    for _ in range(2000):
        sample = rng.choices(items, k=len(items))
        den = sum(x[denominator] for x in sample)
        if den:
            values.append(100 * sum(x[numerator] for x in sample) / den)
    values.sort()
    return [round(values[int((len(values)-1)*p)], 2) for p in (.025,.975)]


def ratio(n,d):
    return round(n/d, 6) if d else None


def retrieval(rows, method, exclusions):
    queries, observations, base = [], [], []
    for row in rows:
        for q,a,b in zip(row["queries"],row["results"][method]["values"],row["results"]["tree"]["values"],strict=True):
            if q[0] not in exclusions:
                queries.append(q)
                observations.append(a)
                base.append(b)
    n = len(queries)
    wins = losses = 0
    groups = defaultdict(lambda:[0,0,0])
    for (_, _, family, _), a,b in zip(queries, observations, base, strict=True):
        diff = a[0] - b[0]
        groups[family][0] += diff
        groups[family][1] += 1
        groups[family][2] += a[0]
        wins += diff > 0
        losses += diff < 0
    return dict(questions=n, families=len(groups), complete512=sum(v[0] for v in observations),
                sourceMacroComplete512=round(statistics.mean(s[2]/s[1] for s in groups.values()),6),
                recall512=ratio(sum(v[1] for v in observations),n), complete1024=sum(v[2] for v in observations),
                recall1024=ratio(sum(v[3] for v in observations),n),
                over512Gold=sum(q[3] > 512 for q in queries),
                vsTree=dict(gains=wins,losses=losses,points=round(100*(wins-losses)/n,2),
                            sourceMacroPoints=round(100*statistics.mean(s[0]/s[1] for s in groups.values()),2),
                            cluster95=bootstrap(groups,0,1)))


def boundaries(rows, method):
    obs = [v for r in rows for v in r["results"][method]["boundaries"]]
    baseline = [v for r in rows for v in r["results"]["tree"]["boundaries"]]
    predicted, hit, gold, added, good, removed, lost, unknown = map(sum,zip(*obs))
    groups = {i:[a[1]-b[1],a[2]] for i,(a,b) in enumerate(zip(obs,baseline,strict=True))}
    return dict(documents=len(obs), gold=gold, scoredPredictions=predicted, hits=hit,
                precision=ratio(hit,predicted), recall=ratio(hit,gold), f1=ratio(2*hit,predicted+gold),
                unscoredPredictions=unknown, vsTree=dict(added=added, addedHits=good, addedPrecision=ratio(good,added),
                    addedRecallOfMissed=ratio(good,gold-sum(b[1] for b in baseline)), removed=removed, removedHits=lost,
                    recallDelta95=bootstrap(groups,0,1)))


def regression_summary():
    tasks = {}
    for key in ("squad","wikisection","finqa","qasper","cuad","hotpotqa","friendsqa","qmsum"):
        data = json.loads((CACHE / "regression" / (key+".json")).read_text("utf8"))
        tasks[key] = {}
        for method, row in data.items():
            if key == "squad":
                metric, value = "answerHit256", row["hitRate"]
                detail = {"hits":row["hits"],"questions":row["questions"]}
            elif key == "wikisection":
                metric, value = "boundaryF1", row["f1"]
                detail = {k:row[k] for k in ("matched","predicted","gold")}
            else:
                metric = "tokenRecall512" if key == "qmsum" else "completeEvidence512"
                value = statistics.mean(v["five512"]["recall"] if key == "qmsum" else
                    v["five512"]["complete"] / len(row["hits"][pool]["five512"])
                    for pool,v in row["retrieval"].items())
                detail = {"questions":len(next(iter(row["hits"].values()))["five512"]),
                          "byPool":{pool:v["five512"] for pool,v in row["retrieval"].items()}}
            tasks[key][method] = {"metric":metric,"score":round(value,6),"chunks":row["chunks"],**detail}
    return tasks


def main():
    manifest = json.loads(MANIFEST.read_text("utf8"))
    review_path = RESULTS / "2026-11-26-tree-labels.json"
    labels = json.loads(review_path.read_text("utf8"))
    output = {"manifestSHA256":hashlib.sha256(MANIFEST.read_text("utf8").encode()).hexdigest(),
              "labelsSHA256":hashlib.sha256(review_path.read_text("utf8").encode()).hexdigest(), "reviewCounts":labels["counts"],
              "profiles":{}, "runs":0, "provider":{"apiRequests":0,"apiInputs":0,"apiInputTokens":0}}
    cohorts = defaultdict(list)
    archive = RESULTS / "2026-11-26-tree-outcomes.jsonl.gz"
    temporary = archive.with_suffix(".tmp")
    with temporary.open("wb") as out, gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as gz:
        for model, mode, key, shard in run["jobs"](manifest):
            r = json.loads((CACHE / "runs" / model / mode / f"{key}.{shard}.json").read_text("utf8"))
            assert [r["model"],r["mode"],r["key"],r["shard"]] == [model,mode,key,shard]
            eligible = manifest["retrieval"].get(key) or manifest["boundaries"][key]
            assert r["datasetSHA256"] == eligible["sha256"]
            for method, row in r["results"].items():
                if key in manifest["retrieval"]:
                    assert len(row["values"]) == len(r["queries"]) == eligible["questions"]
                    assert all(len(v) == 4 and v[0] in (0,1) and v[2] in (0,1) and 0 <= v[1] <= 1 and 0 <= v[3] <= 1 for v in row["values"])
                else:
                    assert len(row["boundaries"]) == len(r["documents"])
            gz.write((json.dumps(r, ensure_ascii=False,separators=(",",":")) + "\n").encode())
            output["runs"] += 1
            for k in output["provider"]:
                output["provider"][k] += r["provider"][k]
            profile = model + "/" + mode
            cohort = key
            if key.startswith("government-"):
                _,fold,_,fmt = key.split("-")
                cohort = "government-" + fold + "-" + fmt
                # Keep per-agency counts alongside the pooled-format result.
                cohorts[profile,key].append(r)
            cohorts[profile,cohort].append(r)
            if model == run["SMALL"] and mode == "tokens" and key in ("wiki-development","meetings-development"):
                count, width = (32,24) if key.startswith("wiki") else (12,5)
                keep = min(len(r["documents"]),count-shard*width)
                if keep > 0:
                    sample = {**r, "documents":r["documents"][:keep],"results":{m:{"boundaries":v["boundaries"][:keep]}
                              for m,v in r["results"].items()}}
                    cohorts[profile,key+"-transfer-panel"].append(sample)
    temporary.replace(archive)
    for (profile,key),rows in cohorts.items():
        results = {}
        doc_ids = [(r["key"],doc) for r in rows for doc in r["documents"]]
        assert len(doc_ids) == len(set(doc_ids)), "Duplicate dataset shard"
        for method in rows[0]["results"]:
            b = "boundaries" in rows[0]["results"][method]
            result = boundaries(rows,method) if b else retrieval(rows,method,labels["excluded"] if key.startswith("government-") else {})
            if key.startswith("government-"):
                complete = [v[0] for r in rows for v in r["results"][method]["values"]]
                result["beforeLabelReview"] = {"questions":len(complete),"complete512":sum(complete)}
            if key.endswith("-transfer-panel"):
                results[method] = result
                continue
            for name in ("selectionInputs","selectionTokens","packets","indexTokens","overLimit"):
                result[name] = sum(r["results"][method][name] for r in rows)
            bins = {}
            for r in rows:
                for name, hist in r["results"][method]["edgeBins"].items():
                    target = bins.setdefault(name,[0]*4)
                    for i,v in enumerate(hist):
                        target[i] += v
            if bins:
                result["eligibleEdges"] = bins
            results[method] = result
        output["profiles"].setdefault(profile,{})[key] = results
    output["outcomesSHA256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
    output["historicalRegression"] = regression_summary()
    edges = {m:json.loads((CACHE / "edge-reports" / (m+".json")).read_text("utf8")) for m in (run["SMALL"],run["LARGE"])}
    edge_data = json.dumps({"columns":["parentRole","parentDepthCappedAt3","documentTokenGroup","pairSizeQuartileOfLimit",
                         "cosineBand","topicChangeLabel","count","meanCosine"],"models":edges},separators=(",",":")).encode()
    edge_path = RESULTS / "2026-11-26-tree-edges.json.gz"
    with edge_path.open("wb") as raw, gzip.GzipFile(filename="",mode="wb",fileobj=raw,mtime=0) as compressed:
        compressed.write(edge_data)
    output["edgeReportSHA256"] = hashlib.sha256(edge_path.read_bytes()).hexdigest()
    (RESULTS / "2026-11-26-tree-experiments.json").write_text(json.dumps(output,indent=2) + "\n",encoding="utf8",newline="\n")
    print("Published", output["runs"], "completed shards", output["provider"])


if __name__ == "__main__":
    main()
