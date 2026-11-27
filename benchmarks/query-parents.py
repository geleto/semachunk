"""Compare chunk and sentence retrieval against exhaustive scores and evidence containment."""
import argparse
import concurrent.futures
import functools
import gzip
import importlib.util
import json
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("scope_weights", HERE / "scope-weights.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
engine = prior.engine
ev = engine.ev
OUT = HERE / ".cache/query-parents"
PLANS = ("blocks256", "sent25", "tree25", "sent55")
DEPTHS = (5, 10, 20, 50)
ONION = "ec2045e0da92989642a5b5f2b1130c8bd765bcc5"


def document_ranges(group):
    sources = {}
    locations = []
    questions = []
    refs = []
    for doc, idx, _ in group:
        source = doc["id"]
        offsets = ev.ordinals(doc["source"])
        sources[source] = offsets
        locations.extend((source, ev.union((offsets[a], offsets[b]) for a, b in p["spans"]))
                         for p in idx["passages"])
        questions.extend((source, q) for q in idx["questions"])
    for source, q in questions:
        choices = [(source, rr) for rr in q.get("references", [q.get("ranges")])]
        choices.extend((a["source"], a["ranges"]) for a in q.get("alternativeSources", []))
        refs.append([(d, ev.union((sources[d][a], sources[d][b]) for a, b in rr)) for d, rr in choices])
    return locations, questions, refs


def first_support(locations, cores, neighbors, refs, order):
    # Determine if any single passage could contain every cited span, under an ideal ranker.
    by_source = defaultdict(list)
    for i, (c, (left, right, _)) in enumerate(zip(cores, neighbors, strict=True)):
        source, core_spans = locations[c]
        window = ev.union(span for p in [left, c, right] if p >= 0 for span in locations[p][1])
        by_source[source].append((i, core_spans, window))
    def covers(spans, evidence):
        return all(any(start <= a and b <= end for start, end in spans) for a, b in evidence)
    result = []
    for choices, ranked in zip(refs, order, strict=True):
        ranks = np.argsort(ranked) + 1
        answers = [[], []]
        for source, evidence in choices:
            assert evidence
            for i, core, expanded in by_source[source]:
                if covers(expanded, evidence):
                    answers[1].append(int(ranks[i]))
                    if covers(core, evidence):
                        answers[0].append(int(ranks[i]))
        result.append([min(a, default=0) for a in answers])
    return result


def sql_search(parents, units, questions, owners, member_rows, exhaustive, queries, example):
    # Only the reference side uses the exhaustive result; candidate construction issues
    # two real KNN queries and the reranker looks up vectors by parent membership.
    sys.path.insert(0, str(HERE / ".cache/query-parents-deps"))
    import sqlite_vec
    conn = sqlite3.connect(":memory:")
    try:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        tables = ("parents", "units")
        for name, vectors in zip(tables, (parents, units), strict=True):
            conn.execute(f"create virtual table {name} using vec0(embedding float[{vectors.shape[1]}] distance_metric=cosine)")
            conn.executemany(f"insert into {name}(rowid,embedding) values(?,?)",
                             ((i, v.tobytes()) for i, v in enumerate(vectors)))
        def nearest(name, q, size):
            rows = conn.execute(f"select rowid from {name} where embedding match ? and k=? order by distance",
                                (q.tobytes(), min(max(DEPTHS), size)))
            return [hit[0] for hit in rows]
        rows = []
        for qi, (query, gold_scores) in enumerate(zip(questions, exhaustive, strict=True)):
            parent_hits = nearest("parents", query, len(parents))
            unit_hits = nearest("units", query, len(units))
            reference = np.argsort(-gold_scores, kind="stable")[:5]
            outcomes = {}
            for k in DEPTHS:
                parent_only = set(parent_hits[:k])
                combined = parent_only.union(p for u in unit_hits[:k] for p in owners[u])
                for method, candidates in [("parent", parent_only), ("both", combined)]:
                    ids = np.array(sorted(candidates))
                    needed = sorted({u for p in ids for u in member_rows[p]})
                    scores = (parents[ids] @ query).astype(np.float64)
                    unit_scores = dict(zip(needed, units[needed] @ query, strict=True))
                    scores += [max(unit_scores[u] for u in member_rows[p]) for p in ids]
                    assert np.max(np.abs(scores * .5 - gold_scores[ids])) < 2e-6
                    hit = ids[np.argsort(-scores, kind="stable")[:5]]
                    recovered = len(set(hit) & set(reference))
                    outcomes[f"{method}{k}"] = [int(hit[0] == reference[0]), recovered / len(reference),
                                                   int(recovered == len(reference)), len(ids), len(needed)]
            if queries[qi][1]["id"] == ONION and example is not None:
                i = int(reference[0])
                example.update(parentSearchRank=parent_hits.index(i) + 1 if i in parent_hits else None,
                               firstSentenceSearchRank=next((j+1 for j,u in enumerate(unit_hits) if i in owners[u]), None))
            rows.append(outcomes)
        return rows
    finally:
        conn.close()


def evaluate_plan(plan, cores, children, vectors, p_to_v, qvec, neighbor, view, bare, add,
                  *, ranges, output, use_db, window_key="chunk/allow"):
    locations, queries, refs = ranges
    parents = vectors[p_to_v[cores]]
    links = [cc if cc else [c] for c, cc in zip(cores, children, strict=True)]
    units = np.unique([u for cc in links for u in cc])
    pos = {u: i for i, u in enumerate(units)}
    member_rows = [[pos[u] for u in cc] for cc in links]
    owners = [[] for _ in units]
    for p, rows in enumerate(member_rows):
        for row in rows:
            owners[row].append(p)
    unit_vecs = vectors[p_to_v[units]]
    parent_scores = qvec @ parents.T
    unit_scores = qvec @ unit_vecs.T
    best = np.stack([unit_scores[:, rows].max(axis=1) for rows in member_rows], axis=1)
    if window_key == "section":
        # Match the normalization and per-parent multiplication of scope_ranking.
        qdir = engine.unit(qvec)
        parent_scores = qdir @ engine.unit(parents).T
        best = np.stack([(qdir @ engine.unit(vectors[p_to_v[cc]]).T).max(axis=1) if cc else parent_scores[:, i]
                         for i, cc in enumerate(children)], axis=1)
    combined = (parent_scores + best) * .5
    lr = neighbor[window_key]
    window = np.array([view([left, c, right]) for c, (left, right, _) in zip(cores, lr, strict=True)])
    for name, score in [("parent", parent_scores), ("sentence", best), ("both", combined)]:
        add(name + "/core", score, bare)
        add(name + "/window", score, window)
    order = np.argsort(-combined, axis=1, kind="stable")
    support = first_support(locations, cores, lr, refs, order)
    example = {}
    if plan == "blocks256":
        for qi, (_, q) in enumerate(queries):
            if q["id"] == ONION:
                for label, p in [("wholeWinner", int(parent_scores[qi].argmax())), ("combinedWinner", int(order[qi,0]))]:
                    u = max(member_rows[p], key=lambda row: unit_scores[qi, row])
                    example[label] = dict(parent=p, whole=float(parent_scores[qi,p]),
                                          best=float(unit_scores[qi,u]), combined=float(combined[qi,p]))
                example.update(poolParents=len(cores), poolUnits=len(units))
    db = sql_search(parents, unit_vecs, qvec, owners, member_rows, combined, queries,
                    example if example else None) if use_db else None
    output[plan] = dict(support=support, db=db, size=[len(cores), len(units)], example=example)


def compare_keys(plan, cores, children, vectors, p_to_v, queries, neighbor, view, bare, add):
    normalize = engine.unit
    core = normalize(vectors[p_to_v[cores]])
    query = normalize(queries)
    parent = query @ core.T
    best = np.stack([(query @ normalize(vectors[p_to_v[cc]]).T).max(axis=1) if cc else parent[:, i]
                     for i, cc in enumerate(children)], axis=1)
    for unit in ("sentence", "chunk"):
        rows = neighbor[unit + "/allow"]
        left, right, joint = np.asarray(rows).T
        count = (left >= 0).astype(int) + (right >= 0)
        sides = np.zeros_like(core)
        for side in (left, right):
            keep = side >= 0
            sides[keep] += normalize(vectors[p_to_v[side[keep]]])
        sides /= np.maximum(count, 1)[:, None]
        sides[count == 0] = core[count == 0]
        expanded = normalize(vectors[p_to_v[joint]])
        additive = normalize(.64 * core + .36 * sides)
        # Reuse the previous development choices; no tuning on replication.
        hybrid = normalize(.49 * core + .21 * sides + .30 * expanded)
        display = np.array([view([l, c, r]) for c, (l, r, _) in zip(cores, rows, strict=True)])
        for label, score in [("parent", parent), ("sentenceMax", best), ("both", .5 * (parent + best)),
                             ("add36", query @ additive.T), ("joint", query @ expanded.T), ("hybrid", query @ hybrid.T)]:
            add(unit + "/" + label, score, display)


def evidence_within_one_unit(group):
    locations, questions, refs = document_ranges(group)
    base = 0
    atoms = defaultdict(list)
    for doc, idx, _ in group:
        atoms[doc["id"]] = [locations[base + pid][1] for pid in idx["atoms"]]
        base += len(idx["passages"])
    return {q["id"]: any(all(any(lo <= a and b <= hi for lo, hi in spans) for a, b in evidence)
                           for source, evidence in choices for spans in atoms[source])
            for (_, q), choices in zip(questions, refs, strict=True)}


def old_anchors(group, plans):
    result = {p:[] for p in plans}
    offset = 0
    for _, idx, _ in group:
        old = idx["plans"]["tree25-any"]
        for plan in plans:
            cursor = 0
            for new in idx["plans"][plan]:
                spans = idx["passages"][new]["spans"]
                members = []
                while cursor < len(old):
                    c = old[cursor]
                    pieces = idx["passages"][c]["spans"]
                    if not all(any(a <= lo and hi <= b for a,b in spans) for lo,hi in pieces):
                        break
                    members.append((offset+c,[offset+u for u in idx["members"][str(c)]]))
                    cursor += 1
                assert members
                result[plan].append(members)
            assert cursor == len(old)
        offset += len(idx["passages"])
    return result


def compare_anchors(plan, cores, children, V, P, Q, neighbor, view, bare, add, *, anchors):
    normalize = engine.unit
    Q = normalize(Q)
    parent = Q @ normalize(V[P[cores]]).T
    best = np.stack([(Q @ normalize(V[P[cc]]).T).max(axis=1) if cc else parent[:,i] for i,cc in enumerate(children)],axis=1)
    shown = np.array([view([l,c,r]) for c,(l,r,_) in zip(cores,neighbor["section"],strict=True)])
    old = [pair for group in anchors[plan] for pair in group]
    old_dirs = normalize(V[P[[p for p,_ in old]]])
    old_whole = Q @ old_dirs.T
    old_best = np.stack([(Q @ normalize(V[P[units]]).T).max(axis=1) if units else old_whole[:,i]
                         for i,(_,units) in enumerate(old)], axis=1)
    scores = .5 * (old_whole + old_best)
    bounds = np.cumsum([0]+[len(group) for group in anchors[plan]])
    carried = np.stack([scores[:,a:b].max(axis=1) for a,b in zip(bounds[:-1],bounds[1:])],axis=1)
    averaged = normalize(np.stack([old_dirs[a:b].mean(axis=0) for a,b in zip(bounds[:-1],bounds[1:])]))
    add("old-scores",carried,shown)
    add("mean-old-vectors",.5*(Q@averaged.T+best),shown)
    add("embed-joined",.5*(parent+best),shown)


def run_shard(key, stage):
    records = []
    has_paragraphs = stage in ("paragraphs", "bridge-support", "anchors")
    for group in prior.load_group(key, "paragraphs" if has_paragraphs else "original", OUT):
        comparison = ("tree25-para0-bridge","tree25-para25-bridge")
        anchors = old_anchors(group, comparison) if stage == "anchors" else None
        for _, idx, _ in group:
            idx["questions"] = [q for q in idx["questions"] if q.get("kind") != "section"]
            if stage == "bridge-support":
                selected = ("tree25-any", "tree25-para0-bridge", "tree25-para25-bridge", "s25-any", "blocks256")
                idx["plans"] = {p: idx["plans"][p] for p in selected}
            elif stage == "anchors":
                idx["plans"] = {p:idx["plans"][p] for p in comparison}
            elif not has_paragraphs:
                idx["plans"] = {p: idx["plans"][p] for p in PLANS}
        details = {}
        test_db = stage == "query" and prior.registry[key]["fold"] == "fresh"
        one_unit = {}
        if stage in ("query", "bridge-support"):
            window_key = "section" if stage == "bridge-support" else "chunk/allow"
            experiment = functools.partial(evaluate_plan, ranges=document_ranges(group), output=details, use_db=test_db,
                                           window_key=window_key)
        elif stage == "keys":
            experiment = compare_keys
            one_unit = evidence_within_one_unit(group)
        elif stage == "anchors":
            experiment = functools.partial(compare_anchors,anchors=anchors)
        else:
            experiment = prior.scope_ranking
        result = engine.evaluate(group, experiment=experiment)
        if result is None:
            continue
        questions, outcomes, _ = result
        for i, q in enumerate(questions):
            row = dict(id=q["id"], doc=q["doc"], metrics={n: a[i].tolist() for n, a in outcomes.items()})
            if stage == "keys":
                row["withinOneUnit"] = one_unit[q["id"]]
            if stage in ("query", "bridge-support"):
                row["support"] = {p: v["support"][i] for p, v in details.items()}
                for p, (core_rank, window_rank) in row["support"].items():
                    assert (core_rank == 1) == bool(row["metrics"][p + "/both/core"][0])
                    assert (window_rank == 1) == bool(row["metrics"][p + "/both/window"][0])
                if test_db:
                    row["db"] = {p: dict(size=v["size"], depths=v["db"][i]) for p, v in details.items()}
                if stage == "query" and q["id"] == ONION:
                    row["example"] = details["blocks256"]["example"]
            records.append(row)
    path = OUT / stage / (key + ".json.gz")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(records, separators=(",", ":")).encode(), mtime=0))
    print(stage, key, len(records), flush=True)


def cross_document_search(plan, section=False):
    # Retain only the vectors needed by this plan so all 69 documents fit in one pool.
    pooled = []
    for key, meta in prior.registry.items():
        if meta["fold"] != "fresh":
            continue
        for original in prior.load_group(key, "paragraphs" if section else "original", OUT):
            for doc, idx, vectors in original:
                cores = idx["plans"][plan]
                window_key = "section" if section else "chunk/allow"
                neighbors = idx["configs"][plan]["settings"][window_key]
                items = sorted(set(cores).union(p for c in cores for p in idx["members"][str(c)]).union(
                    p for left, right, _ in neighbors for p in (left, right) if p >= 0))
                mapping = {p: i for i, p in enumerate(items)}
                questions = [q for q in idx["questions"] if q.get("kind") != "section"]
                passages = [idx["passages"][p] for p in items]
                vi = sorted({p["v"] for p in passages}.union(q["v"] for q in questions))
                vm = {v: i for i, v in enumerate(vi)}
                compact = dict(passages=[dict(v=vm[p["v"]], spans=p["spans"]) for p in passages],
                               plans={plan: [mapping[c] for c in cores]},
                               questions=[{**q, "v": vm[q["v"]]} for q in questions],
                               members={str(mapping[c]): [mapping[u] for u in idx["members"][str(c)]] for c in cores})
                compact["configs"] = {plan: dict(bridges=[], settings={window_key: [
                    [mapping.get(l, -1), mapping.get(r, -1), mapping[c]] for c, (l, r, _) in zip(cores, neighbors, strict=True)]})}
                pooled.append(({"source": doc["source"], "id": doc["id"], "domain": meta["domain"]}, compact, vectors[vi]))
    details = {}
    assert len({d["id"] for d, _, _ in pooled}) == len(pooled)
    qs, outcomes, _ = engine.evaluate(pooled, experiment=functools.partial(evaluate_plan, ranges=document_ranges(pooled),
                                                                           output=details, use_db=not section, window_key=window_key))
    detail = details[plan]
    domains = {d["id"]: d["domain"] for d, _, _ in pooled}
    rows = [dict(doc=q["doc"], id=q["id"], domain=domains[q["doc"]], metrics={k: a[i].tolist() for k, a in outcomes.items()},
                 depths=detail["db"][i] if detail["db"] else None, support=detail["support"][i]) for i, q in enumerate(qs)]
    result = dict(size=detail["size"], docs=len(pooled), example=detail["example"], rows=rows)
    path = OUT / ("shared-bridges" if section else "global") / (plan + ".json.gz")
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_bytes(gzip.compress(json.dumps(result, separators=(",", ":")).encode(), mtime=0))
    print("global", plan, detail["size"], len(rows), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["query", "paragraphs", "keys", "global", "bridge-support", "shared-bridges","anchors"])
    parser.add_argument("key", nargs="?")
    parser.add_argument("--jobs", default=3, type=int)
    args = parser.parse_args()
    if args.stage in ("global","shared-bridges"):
        section = args.stage == "shared-bridges"
        choices = ("blocks256","tree25-any","tree25-para0-bridge","tree25-para25-bridge") if section else PLANS
        for plan in ([args.key] if args.key else choices):
            cross_document_search(plan,section)
    elif args.key:
        run_shard(args.key, args.stage)
    else:
        def run(key):
            if args.stage == "paragraphs":
                subprocess.run(["node", str(HERE / "scope-weights-index.mjs"), key, "--paragraphs"], check=True)
            subprocess.run([sys.executable, __file__, args.stage, key], check=True)
        with concurrent.futures.ThreadPoolExecutor(args.jobs) as pool:
            keys = sorted(prior.registry, key=lambda k: prior.registry[k]["fold"] != "fresh")
            list(pool.map(run, keys))
