"""Compare three count-matched indexes with whole-passage retrieval at ranks one and five."""
import argparse
import gzip
import hashlib
import json
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
shared = runpy.run_path(str(HERE / "matched-count.py"))
previous, read, out = shared["previous"], shared["read"], shared["OUT"]
stem = "2026-11-27-whole-passage"
protocol = read(HERE / "whole-passage-protocol.json")
methods = list(protocol["limits"])
metrics = ["completeTop1", "recallTop1", "completeTop5", "recallTop5",
           "top1Tokens", "top5Tokens", "hitsReturned", "poolExhausted"]
pairs = [("semantic512", "blocks"), ("semanticUnlimited", "blocks"), ("semantic512", "semanticUnlimited")]


def comparisons(obs):
    return {f"{a} vs {b}": {
        metric: shared["contrast"](obs, a, b, metric, metrics, confidence)
        for metric, confidence in [("completeTop5", 1-.05/3), ("completeTop1", .95)]
    } for a, b in pairs}


def summarize(rows):
    def observations(subset):
        return shared["observations"](rows, subset, matched=methods[1:], shuffles=())

    obs = observations("all")
    exact = observations("exact-multiple")
    result = shared["describe"](obs, metrics)
    result["comparisons"] = comparisons(obs)
    result["exactMultiple"] = {**shared["describe"](exact, metrics), "comparisons": comparisons(exact)}
    docs = [d for r in rows for d in r["documents"]]
    result["layouts"] = {m: shared["layouts"](docs, m) for m in methods}
    result["distinctSources"] = len({(previous["cohort"](r["key"]), d["id"]) for r in rows for d in r["documents"]})
    result["allThreeExact"] = sum(len({len(v["sizes"]) for v in d["methods"].values()}) == 1 for d in docs)
    result["allThreeWithinOneOfBlocks"] = sum(all(abs(len(v["sizes"])-len(d["methods"]["blocks"]["sizes"])) <= 1
                                                   for v in d["methods"].values()) for d in docs)
    result["financialEvidence"] = {}
    for label in ("text", "table", "table+text"):
        selected = [(r, i) for r in rows if r["key"].startswith("finance-")
                    for i, q in enumerate(r["queries"]) if q[2] == label]
        result["financialEvidence"][label] = {"questions": len(selected), "complete": {
            m: {metric: sum(r["methods"][m]["outcomes"][i][metrics.index(metric)] for r,i in selected)
                for metric in ("completeTop1", "completeTop5")} for m in methods}}
    return result


def historical_report(keys, manifest):
    with gzip.open(out / "2026-11-26-matched-count-outcomes.jsonl.gz", "rt", encoding="utf8") as f:
        archived = {r["key"]: r for r in map(json.loads, f)}
    store = previous["STORE"] / "whole-passage" / protocol["model"]
    rows = [read(store / (k + ".json")) for k in keys]
    protocol_hash = hashlib.sha256(json.dumps(protocol, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    archive = out / (stem + "-outcomes.jsonl.gz")
    temp = archive.with_suffix(".tmp")
    checked = 0
    with temp.open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as f:
        for r in rows:
            old = archived[r["key"]]
            assert r["dataSHA256"] == manifest["sets"][r["key"]]["sha256"] == old["dataSHA256"]
            assert r["protocolSHA256"] == protocol_hash and r["queries"] == old["queries"]
            assert list(r["methods"]) == methods
            for m, limit in protocol["limits"].items():
                for doc in r["documents"]:
                    assert all(0 < n <= float(limit) for n in doc["methods"][m]["sizes"])
                values = r["methods"][m]["outcomes"]
                assert len(values) == len(r["queries"]) and all(len(v) == len(metrics) for v in values)
                assert all(v[0] <= v[2] and v[1] <= v[3] and v[4] <= v[5] for v in values)
            for m, original in [("blocks", "blocks"), ("semanticUnlimited", "semantic")]:
                assert r["methods"][m]["layoutSHA256"] == old["methods"][original]["layoutSHA256"]
                for d, ref in zip(r["documents"], old["documents"], strict=True):
                    assert d["id"] == ref["id"] and d["methods"][m] == ref["methods"][original]
                expected = [[v[i] for i in (6,7,5,8,12,9)] for v in old["methods"][original]["outcomes"]]
                assert [v[:6] for v in r["methods"][m]["outcomes"]] == expected
                checked += len(expected)
            f.write((json.dumps(r, ensure_ascii=False, separators=(",", ":"))+"\n").encode())
    result = {"protocol": protocol, "metrics": metrics, "reproducedMethodQuestionViews": checked,
              "newEmbeddingTokens": sum(r["newTokens"] for r in rows)}
    for fold in ("confirmation", "development"):
        result[fold] = summarize([r for r in rows if ("-development-" in r["key"]) == (fold == "development")])
    temp.replace(archive)
    result["archiveSHA256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
    (out / (stem + ".json")).write_text(json.dumps(result, indent=2)+"\n", encoding="utf8", newline="\n")
    for fold in ("confirmation", "development"):
        print(fold, {m: [round(100*result[fold]["macro"][m][k], 2) for k in ("completeTop1","completeTop5")]
                     for m in methods})
    print(checked, "archived whole-passage outcomes verified")


def source_report(keys, manifest, audited):
    summary_stem = stem + ("-audited" if audited else "-filings")
    filings_protocol = {**protocol, **read(HERE / "whole-passage-filings-protocol.json")}
    active = {**protocol, **read(HERE / "whole-passage-audited-protocol.json")} if audited else filings_protocol
    digest = lambda obj: hashlib.sha256(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    retained = {k for k in keys if k.startswith("finance-") == audited}
    baseline = stem + "-filings" if audited else stem
    archive_path = out / (baseline+"-outcomes.jsonl.gz")
    assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == read(out/(baseline+".json"))["archiveSHA256"]
    with gzip.open(archive_path, "rt", encoding="utf8") as f:
        archived = {r["key"]:r for r in map(json.loads, f) if r["key"] in retained}
    assert archived.keys() == retained
    store = previous["STORE"] / "whole-passage" / active["model"]
    archive = out/(summary_stem+"-outcomes.jsonl.gz")
    published = {}
    if any(not (store/(key+".json")).exists() for key in keys if key not in retained):
        reference = read(out/(summary_stem+".json"))
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == reference["archiveSHA256"]
        with gzip.open(archive, "rt", encoding="utf8") as f:
            published = {r["key"]:r for r in map(json.loads,f) if r["key"] not in retained}
    rows = []
    for key in keys:
        if key in retained:
            r = archived[key]
        elif (store/(key+".json")).exists():
            r = read(store/(key+".json"))
        else:
            r = published[key]
        meta = manifest["sets"][key]
        assert r["dataSHA256"] == meta["sha256"] and r["key"] == key
        expected = (filings_protocol if audited else protocol) if key in retained else active
        assert r["protocolSHA256"] == digest(expected)
        assert len(r["queries"]) == meta["questions"] and [d["id"] for d in r["documents"]] == meta["sources"]
        assert list(r["methods"]) == methods
        for method, limit in active["limits"].items():
            outcomes = r["methods"][method]["outcomes"]
            assert len(outcomes) == meta["questions"]
            for doc in r["documents"]:
                assert doc["methods"][method]["sizes"] and all(0 < n <= float(limit) for n in doc["methods"][method]["sizes"])
            for query, values in zip(r["queries"], outcomes, strict=True):
                assert len(values) == len(metrics) and values[0] <= values[2] and values[1] <= values[3] and values[4] <= values[5]
                if key not in retained:
                    doc = r["documents"][query[3]]
                    count = (len(doc["methods"][method]["sizes"]) if meta["pool"] == "document" else
                             sum(len(d["methods"][method]["sizes"]) for d in r["documents"]))
                    assert values[6:] == [min(5,count),int(count<=5)]
                    if not audited:
                        assert query[0] in manifest["documents"][doc["id"]]["questions"]
                        assert query[1] == manifest["documents"][doc["id"]]["company"]
        rows.append(r)
    tmp = archive.with_suffix(".tmp")
    with tmp.open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as f:
        for row in rows:
            f.write((json.dumps(row, ensure_ascii=False, separators=(",", ":"))+"\n").encode())
    tmp.replace(archive)
    result = {"protocol":active,"metrics":metrics,"manifestSHA256":hashlib.sha256((out/active["data"]).read_bytes().replace(b"\r\n",b"\n")).hexdigest(),
              "archiveSHA256":hashlib.sha256(archive.read_bytes()).hexdigest(),
              ("reusedFinanceShards" if audited else "reusedNonfinancialShards"):len(retained)}
    for fold in ("confirmation","development"):
        group = [r for r in rows if ("-development-" in r["key"]) == (fold == "development")]
        summary = summarize(group)
        financial = [r for r in group if r["key"].startswith("finance-")]
        fdocs = [d for r in financial for d in r["documents"]]
        finance_obs = shared["observations"](financial, matched=methods[1:], shuffles=())
        summary["financialLayouts"] = {m:shared["layouts"](fdocs,m) for m in methods}
        summary["financialComparisons"] = comparisons(finance_obs)
        result[fold] = summary
        print(fold, "finance", {m:round(summary["domains"]["finance"][m]["completeTop5"]*100,2) for m in methods})
    (out/(summary_stem+".json")).write_text(json.dumps(result,indent=2)+"\n", encoding="utf8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", nargs="?", default="all", choices=("all","measure","report"))
    parser.add_argument("--workers", type=int, default=4)
    version = parser.add_mutually_exclusive_group()
    version.add_argument("--legacy", action="store_true", help="Reproduce the archived one-page FinQA comparison")
    version.add_argument("--filings", action="store_true", help="Reproduce the first full-filing comparison")
    args = parser.parse_args()
    audited = not (args.legacy or args.filings)
    overlay = "whole-passage-audited-protocol.json" if audited else "whole-passage-filings-protocol.json"
    data = read(previous["MANIFEST"] if args.legacy else out/read(HERE/overlay)["data"])
    keys = sorted((k for k in data["sets"] if previous["primary"](k)), key=lambda k: ("-development-" in k, k))
    if args.stage != "report":
        measure_keys = keys if args.legacy else [k for k in keys if k.startswith("finance-") != audited]
        shared["measure"](measure_keys, args.workers, "whole-passage.mjs")
    if args.stage != "measure":
        if args.legacy:
            historical_report(keys, data)
        else:
            source_report(keys, data, audited)
