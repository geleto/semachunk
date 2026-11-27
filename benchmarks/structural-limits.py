"""Select passage defaults on development, then compare the four public strategies."""
import collections
import gzip
import json
import re
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
study = runpy.run_path(str(HERE / "bounded-passages.py"))
report = study["report"]
root = HERE / ".cache/structural-limits"
protocol = json.loads((HERE / "structural-limits-protocol.json").read_bytes())
selection_path = root / "development-selection.json"
published = HERE / "results/2026-11-27-structural-limits.json"


def core(name):
    return int(re.search(r"\d+", name).group())


def upper(name):
    number = re.search(r"u(\d+)", name)
    return int(number[1]) if number else float("inf")


def make_plans(documents):
    layouts = list(documents[0]["ix"]["layouts"])
    plans = {name: (name,) for name in layouts}
    plans.update({"both-" + name: ("blocks256", name) for name in layouts if name.startswith("tree")})
    return plans


def label(plan, cap, weight=.15):
    return f"{plan}/{cap}/{round(100*weight)}"


def run_pool(docs, plans, verify=None):
    def variants(plan):
        for cap in protocol["passageCaps"]:
            if cap >= max(map(core, plans[plan])):
                yield ("paragraph", cap, 0)

    rows = []
    for weight in protocol["sectionWeights"]:
        checked = None if verify is None else {f"{plan}/paragraph/{cap}/0" for plan, cap in verify}
        measured = study["evaluate"](docs, checked, plans=plans, detail_types=["paragraph"],
                                     variants=variants, section_weight=weight)
        if not rows:
            rows = [{**{k: v for k, v in row.items() if k not in ("metrics", "hits")},
                     "metrics": {}, "hits": {}} for row in measured]
        for dest, row in zip(rows, measured, strict=True):
            for key, metrics in row["metrics"].items():
                plan, _, cap, _ = key.split("/")
                name = label(plan, cap, weight)
                dest["metrics"][name] = metrics
                if verify is not None:
                    dest["hits"][name] = row["hits"][key]
    return rows


def summary(groups, name):
    observation = lambda r: r["metrics"][name]
    means = report["macro"](groups, observation)
    lengths = sorted((observation(r)[3], 1/(len(groups)*len(domain)))
                     for domain in groups.values() for r in domain)
    mass = 0
    for tokens, w in lengths:
        mass += w
        if mass >= .95:
            break
    return dict(zip(study["FIELDS"], means), p95=tokens, maxFirst=lengths[-1][0])


def summarize(rows, docs):
    groups = collections.defaultdict(list)
    long_groups = collections.defaultdict(list)
    for r in rows:
        groups[r["domain"]].append(r)
        if r["sourceTokens"] > 2048:
            long_groups[r["domain"]].append(r)
    labels = list(rows[0]["metrics"])
    plans = make_plans(docs)
    costs = {}
    for plan, families in plans.items():
        keys = set()
        count = largest = 0
        for d in docs:
            ix = d["ix"]
            ids = set(ix["sections"])
            for family in families:
                for c in ix["layouts"][family]:
                    ids.add(c["core"])
                    ids.update(c["pa"])
                    count += 1
                    largest = max(largest, ix["views"][c["bare"]]["tokens"])
            keys.update(ix["hashes"][i] for i in ids)
        costs[plan] = dict(uniqueVectors=len(keys), chunks=count, maxCore=largest)
    return dict(questions=len(rows), sources=len(docs), longQuestions=sum(map(len, long_groups.values())),
                longDomains=list(long_groups), costWithSections=costs,
                rates={k: summary(groups, k) for k in labels},
                longSources={k: summary(long_groups, k) for k in labels}), groups


def quality(row):
    return (row["complete1"] + row["complete5"]) / 2


def pick(names, rates):
    best = max(quality(rates[name]) for name in names)
    close = [name for name in names if quality(rates[name]) >= best - .01]
    return min(close, key=lambda n: (rates[n]["p95"], rates[n]["firstTokens"], upper(n), n))


def select(rates):
    eligible = [name for name in rates if name.startswith("both-") and name.endswith("/15")
                and upper(name) < core(name) and int(name.split("/")[1]) <= protocol["largestDefaultPassage"]]
    ceilings = sorted({int(name.split("/")[1]) for name in eligible})
    best = max(quality(rates[name]) for name in eligible)
    cap = next(c for c in ceilings if any(quality(rates[n]) >= best-.01
                                          for n in eligible if int(n.split("/")[1]) == c))
    combined = pick([n for n in eligible if int(n.split("/")[1]) == cap], rates)
    suffix = f"/{cap}/15"
    structural = pick([n for n in rates if n.startswith("blocks") and n.endswith(suffix)], rates)
    flat = pick([n for n in rates if n.startswith("semantic") and n.endswith(suffix)], rates)
    return dict(cap=cap, structuralCoreAlternative=structural, modes={
        "blocks": label("blocks256", cap), "pack": label("pack256", cap), "semantic": flat,
        "semantic-blocks": combined.removeprefix("both-"), "combined": combined})


def run(fold, verify=False):
    docs, rows, sample = [], [], set()
    selected = json.loads(selection_path.read_bytes()) if selection_path.exists() else None
    if fold != "development" and selected is None:
        raise ValueError("Run development and freeze the defaults first")
    checks = None
    if verify:
        checks = [(k.split("/")[0], int(k.split("/")[1])) for k in selected["modes"].values()]
    for key, meta in study["registry"].items():
        if meta["fold"] != ("fresh" if fold == "shared" else fold):
            continue
        local = list(study["shards"](key, root))
        docs.extend(local)
        if fold == "shared":
            if verify:
                qs = [(d["id"], q["id"]) for d in local for q in d["ix"]["qs"]]
                sample.update(qs[i] for i in (0, len(qs)//2, -1))
            continue
        for pool in ([local] if meta["pool"] == "collection" else [[d] for d in local]):
            rows.extend(run_pool(pool, make_plans(pool), checks))
    if fold == "shared":
        if verify:
            for d in docs:
                d["ix"]["qs"] = [q for q in d["ix"]["qs"] if (d["id"], q["id"]) in sample]
        rows = run_pool(docs, make_plans(docs), checks)
    if verify:
        data = [{k: r[k] for k in ("doc", "id", "hits")} for r in rows]
        (root / f"verify-{fold}.json.gz").write_bytes(gzip.compress(json.dumps(data).encode(), mtime=0))
        return
    result, groups = summarize(rows, docs)
    if fold == "development":
        selected = select(result["rates"])
        selection_path.write_text(json.dumps(selected, indent=2), encoding="utf-8")
        print("Development selection", selected, flush=True)
    modes = selected["modes"]
    result["perDomain"] = {d: {m: summary({d: rs}, n) for m, n in modes.items()} for d, rs in groups.items()}
    result["pairedAgainstBlocks"] = {mode: report["paired"](groups, key, modes["blocks"],
        lambda r, k: r["metrics"][k][:3]) for mode, key in modes.items() if mode != "blocks"}
    (root / (fold+".json")).write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(fold, len(rows), "questions,", len(result["rates"]), "configurations", flush=True)


def asymmetric():
    selected = json.loads(selection_path.read_bytes())
    sem = selected["modes"]["semantic-blocks"].split("/")[0]
    plans = {"blocks256": ("blocks256",), "combined": ("blocks256", sem)}
    def extend(ix, stem):
        for limit, views in study["read"](stem.with_suffix(".windows.gz")).items():
            for candidate, view in zip(ix["layouts"]["blocks256"], views, strict=True):
                candidate["windows"][limit] = {"view": len(ix["views"])}
                ix["views"].append(view)
    def evaluate(pool):
        return study["evaluate"](pool, plans=plans, detail_types=["paragraph"],
                variants=lambda _: [("paragraph", cap, 0) for cap in (256, 384, selected["cap"])],
                window_cap=lambda f, cap: cap if f == "blocks256" else selected["cap"])
    output = {}
    for fold in ("development", "confirmation", "fresh", "shared"):
        docs, rows = [], []
        for key, meta in study["registry"].items():
            if meta["fold"] != ("fresh" if fold == "shared" else fold):
                continue
            local = list(study["shards"](key, root, extend))
            docs.extend(local)
            if fold != "shared":
                for pool in ([local] if meta["pool"] == "collection" else [[d] for d in local]):
                    rows.extend(evaluate(pool))
        if fold == "shared":
            rows = evaluate(docs)
        groups = collections.defaultdict(list)
        for r in rows:
            groups[r["domain"]].append(r)
        output[fold] = {k: summary(groups, k) for k in rows[0]["metrics"]}
        main = json.loads((root/(fold+".json")).read_bytes())["rates"]
        for mode, plan in [("blocks", "blocks256"), ("combined", "combined")]:
            same = output[fold][f"{plan}/paragraph/{selected['cap']}/0"]
            assert same == main[selected["modes"][mode]]
        print("Structural reading budgets", fold, len(rows), flush=True)
    (root/"asymmetric.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


def upper_controls():
    # Hold both the learned cutoff and the complete reading budget fixed. Only the upper limit varies.
    directory = root.parent/"structural-upper-controls"
    output = {}
    for fold in ("development", "confirmation", "fresh", "shared"):
        docs, rows = [], []
        def evaluate(pool):
            return study["evaluate"](pool, plans=make_plans(pool), detail_types=["paragraph"],
                                     variants=lambda _: [("paragraph", 512, 0)])
        for key, meta in study["registry"].items():
            if meta["fold"] != ("fresh" if fold == "shared" else fold):
                continue
            local = list(study["shards"](key, directory))
            docs.extend(local)
            if fold != "shared":
                for pool in ([local] if meta["pool"] == "collection" else [[d] for d in local]):
                    rows.extend(evaluate(pool))
        if fold == "shared":
            rows = evaluate(docs)
        groups = collections.defaultdict(list)
        for row in rows:
            groups[row["domain"]].append(row)
        rates = {k: summary(groups, k) for k in rows[0]["metrics"]}
        main = json.loads((root/(fold+".json")).read_bytes())["rates"]
        for prefix in ("", "both-"):
            assert rates[prefix+"tree512u256low/paragraph/512/0"] == main[prefix+"tree512u256low/512/15"]
        maxima = {}
        for layout in docs[0]["ix"]["layouts"]:
            lengths = [d["ix"]["views"][c["bare"]]["tokens"] for d in docs for c in d["ix"]["layouts"][layout]
                       if len(c["pa"]) >= 2]
            maxima[layout] = max(lengths, default=0)
        output[fold] = dict(rates=rates, maxCoreWithMultipleParagraphs=maxima)
        print("Upper limits at fixed cutoff", fold, len(rows), flush=True)
    (root/"upper-controls.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    for task in sys.argv[1:] or ["development", "confirmation", "fresh", "shared", "publish"]:
        if task == "publish":
            result = dict(protocol=protocol, encoder=dict(model="text-embedding-3-small", dimensions=1536, tokenizer="cl100k_base"),
                          selection=json.loads(selection_path.read_bytes()),
                          folds={f: json.loads((root/(f+".json")).read_bytes())
                                 for f in ("development", "confirmation", "fresh", "shared")})
            if (root/"api-verification.json").exists():
                result["apiVerification"] = json.loads((root/"api-verification.json").read_bytes())
                for mode, stats in result["apiVerification"]["poolCounts"].items():
                    plan = result["selection"]["modes"][mode.removeprefix("default/")].split("/")[0]
                    cost = result["folds"]["shared"]["costWithSections"][plan]
                    assert stats["chunks"] == cost["chunks"]
                    if mode.startswith("default/"):
                        assert stats["uniqueEmbeddings"] <= cost["uniqueVectors"]
                    else:
                        assert stats["uniqueEmbeddings"] == cost["uniqueVectors"]
            if (root/"asymmetric.json").exists():
                result["structuralReadingCaps"] = json.loads((root/"asymmetric.json").read_bytes())
            if (root/"upper-controls.json").exists():
                result["fixedCutoffUpperLimits"] = json.loads((root/"upper-controls.json").read_bytes())
            published.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        elif task == "verify":
            run("fresh", True)
            run("shared", True)
        elif task == "asymmetric":
            asymmetric()
        elif task == "upper-controls":
            upper_controls()
        else:
            run(task)
