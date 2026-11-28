"""Native heading passages, matched HTML/Markdown ranking controls and full-suite impact."""
import collections
import json
import runpy
from pathlib import Path
from types import SimpleNamespace

import numpy as np

HERE = Path(__file__).resolve().parent
HTML = runpy.run_path(str(HERE / "html-markdown.py"))
BENCH, PRIOR, LIB = HTML["BENCH"], HTML["PRIOR"], HTML["LIB"]
PREVIOUS = PRIOR["zipped"](HTML["RESULT"])
MAIN = HTML["OLD"]
RESULT = HERE / "results/2026-11-28-html-handling.json.gz"
AGENCIES = HTML["AGENCIES"]
FOLDS = BENCH["FOLDS"][1:]
# The same ranking choices are eligible for both formats. Section weight stays at 15%.
PARAGRAPH = (0, .125, .25, .5)
NEIGHBOUR = (0, .3)
FIELDS = ("first", "five", "evidenceF1", "firstTokens", "wholeSourceFirst", "firstSourceFraction")
ARCHIVED_FIELDS = [HTML["METRICS"].index(k) for k in FIELDS]
HEADINGS = "html/headings"
PACKED = "html/packed"
BY_HEADING = "html/packed-by-heading"


def label(fmt, paragraph, neighbour):
    return f"{fmt}/p{paragraph:g}-n{neighbour:g}"


def grade(pool, scores, views):
    shown = PRIOR["top_views"](pool, scores, views, verify=True)
    rows = []
    for i, hits in enumerate(shown):
        first, five, f1, tokens, _, whole = pool.grade(i, hits)
        fraction = pool.views[hits[0]]["size"] / pool.docs[pool.owners[hits[0]]]["o"][-1]
        rows.append([first, five, f1, tokens, whole, fraction])
    return np.asarray(rows)


def collection(fold, agency):
    key = f"government-{fold}-reviewed-{agency}-html"
    stored = PREVIOUS["collections"][fold][agency]
    headings = HTML["load_collection"](key, HERE / ".cache/html-heading")
    heading_pool = LIB["Pool"](headings, stream_vectors=True)
    qs = [[d["id"], q["id"], q["text"]] for d, q in heading_pool.qs]
    assert qs == stored["questions"]
    centers, views = [], []
    for off, d, sim in zip(heading_pool.offsets, headings, heading_pool.sim):
        cs = d["ix"]["layouts"]["headings"]
        centers.append(sim[:, [c["v"] for c in cs]])
        views.extend(off + c["bare"] for c in cs)
    rows = {HEADINGS: grade(heading_pool, np.concatenate(centers, axis=1), np.asarray(views))}
    geometry = {k: sum(d["ix"][k] for d in headings) for k in ("sections", "oversized")}
    geometry.update(pages=len(headings), passages=len(views))
    packed_views, whole_scores, member_scores = [], [], []
    for off, d, sim in zip(heading_pool.offsets, headings, heading_pool.sim):
        cs = d["ix"]["layouts"]["packed"]
        packed_views.extend(off + c["bare"] for c in cs)
        whole_scores.append(sim[:,[c["v"] for c in cs]])
        member_scores.append(np.column_stack([sim[:,c["members"]].max(axis=1) for c in cs]))
    geometry["packedPassages"] = len(packed_views)
    for name, columns in ((PACKED,whole_scores), (BY_HEADING,member_scores)):
        rows[name] = grade(heading_pool, np.concatenate(columns,axis=1), np.asarray(packed_views))
    available = {name:PRIOR["complete_possible"](heading_pool,SimpleNamespace(win=np.asarray(ids)))
                 for name,ids in ((HEADINGS,views),(PACKED,packed_views))}
    assert np.all(available[PACKED] >= available[HEADINGS])
    assert np.all(rows[HEADINGS][:,0] <= available[HEADINGS]) and np.all(rows[PACKED][:,0] <= available[PACKED])
    pool = LIB["Pool"](HTML["load_collection"](key), stream_vectors=True)
    assert qs == [[d["id"], q["id"], q["text"]] for d, q in pool.qs]
    for fmt in ("html", "markdown"):
        blocks = PRIOR["Features"](pool, fmt+"/blocks")
        semantic = PRIOR["Features"](pool, fmt+"/semantic")
        mixed, windows = BENCH["scores_for"](pool, fmt+"/semantic", {"near"})["near"]
        assert np.array_equal(windows, semantic.win)
        views = np.r_[blocks.win, semantic.win]
        order = np.argsort(np.asarray(pool.owners)[views], kind="stable")
        def score_pair(a, b):
            return grade(pool, np.concatenate((a,b), axis=1)[:,order], views[order])
        rows[fmt+"/core"] = score_pair(blocks.core, semantic.core)
        for p in PARAGRAPH:
            def score(f, base):
                paragraph = np.where(f.has_pa, (1-p)*base + p*f.paragraph, base)
                return np.where(f.has_sec, .85*paragraph + .15*f.section, paragraph)
            structural = score(blocks, blocks.core)
            for n in NEIGHBOUR:
                rows[label(fmt,p,n)] = score_pair(structural, score(semantic, mixed if n else semantic.core))
        controls = {"semachunk":label(fmt,.5,.3), "semachunk-section-ranking":label(fmt,0,0),
                    "semachunk-core-ranking":fmt+"/core"}
        for profile, name in controls.items():
            old = np.asarray(stored["formats"][fmt][profile]["rows"])[:,ARCHIVED_FIELDS]
            assert np.array_equal(rows[name], old), (fold,agency,name)
    for p in (pool, heading_pool):
        for name in ("grade", "fraction", "evidence", "related"):
            getattr(p,name).cache_clear()
    PRIOR["matrix"].cache_clear()
    return {"questions":qs, "geometry":geometry, "completeCandidate":{k:v.tolist() for k,v in available.items()},
            "rows":{k:v.tolist() for k,v in rows.items()}}


def average_agencies(data):
    result = {}
    for name in data[AGENCIES[0]]["rows"]:
        arrays = [np.asarray(group["rows"][name]) for group in data.values()]
        result[name] = {"equalQuestions":np.vstack(arrays).mean(axis=0).tolist(),
                        "equalAgencies":np.stack([x.mean(axis=0) for x in arrays]).mean(axis=0).tolist()}
    return result


def choose(rates, candidates):
    # Equal agencies and equal weight for first/five. Within 0.25 pp use the
    # simpler route: direct outline first, then fewer ranking signals, then raw HTML.
    utilities = {k:np.mean(rates[k]["equalAgencies"][:2]) for k in candidates}
    def simplicity(k):
        if k in (PACKED, HEADINGS, BY_HEADING):
            return (0, (PACKED,HEADINGS,BY_HEADING).index(k), 0, 0, 0)
        fmt, profile = k.split("/")
        if profile == "core":
            return (1, 0, fmt!="html", 0, 0)
        p, n = (float(part[1:]) for part in profile.split("-"))
        return (1, 1+bool(p)+bool(n), fmt!="html", n, p)
    return min((k for k,v in utilities.items() if v >= max(utilities.values())-.0025), key=simplicity)


def corpus_formats():
    by_fold = collections.defaultdict(dict)
    for key, meta in LIB["REG"].items():
        fold = meta["fold"]
        folder = LIB["ROOT"]/"holdout-data" if fold == "holdout" else HERE/".cache/context-mixtures"/(
            "audited-data" if fold == "fresh" else "data")
        docs = json.loads((folder/(key+".json")).read_bytes())["docs"]
        if any(d["format"] == "html" for d in docs):
            assert meta["pool"] == "collection" and all(d["format"] == "html" for d in docs)
            assert key == f"government-{fold}-reviewed-studentaid-html" and fold in ("development","confirmation")
        for d in docs:
            assert (meta["domain"],d["id"]) not in by_fold[fold]
            by_fold[fold][meta["domain"], d["id"]] = d["format"]
    for fold, formats in by_fold.items():
        assert len(formats) == MAIN["folds"][fold]["documents"]
    return by_fold


def combine(by_fold):
    return (by_fold["confirmation"] + (by_fold["fresh"] + by_fold["shared-fresh"])/2 +
            (by_fold["holdout"] + by_fold["shared-holdout"])/2)/3


def main_scores(formats, replacements, exclude=False):
    macros, means, draws, counts = {}, {}, {}, {}
    census = {}
    for fold in FOLDS:
        base = fold.removeprefix("shared-")
        paired = MAIN["folds"][fold]["pairedOutcomes"]
        questions = paired["questionIds"]
        if fold.startswith("shared-"):
            assert questions == MAIN["folds"][base]["pairedOutcomes"]["questionIds"]
            assert "html" not in formats[base].values()
        mask = np.array([formats[base][domain,owner] == "html" for domain,owner,_ in questions])
        original = {k:np.asarray(v) for k,v in paired["profiles"].items()}
        placement = BENCH["PLACEMENT"]["ROOT"]
        assert questions == PRIOR["zipped"](placement/(fold+"-meta.json.gz"))["questions"]
        with np.load(placement/(fold+"-questions.npz")) as archived:
            original.update(tunedUnion=archived["tunedUnion/0.225/core"], parent=archived["tunedParent/0.175/0.5"])
        scores = dict(original)
        for name,(profile,answers) in replacements.items():
            changed = original[profile].copy()
            if mask.any():
                assert [tuple(q[1:]) for q,keep in zip(questions,mask) if keep] == list(answers)
                changed[mask] = list(answers.values())
            scores[name] = changed
        keep = ~mask if exclude else np.ones(len(mask), dtype=bool)
        questions = [q for q,ok in zip(questions,keep) if ok]
        counts[fold] = len(questions)
        groups = BENCH["groups_for"](questions)
        weights = PRIOR["bootstrap_weights"](questions,groups)
        scores = {k:v[keep] for k,v in scores.items()}
        macros[fold] = {k:BENCH["macro"](v,groups) for k,v in scores.items()}
        means[fold] = {k:v.mean(axis=0) for k,v in scores.items()}
        draws[fold] = {k:weights @ v[:,:2] for k,v in scores.items()}
        census[fold] = dict(documents=sum(v!="html" or not exclude for v in formats[base].values()),
                            questions=len(questions),rawHtmlDocuments=sum(v=="html" for v in formats[base].values()),
                            rawHtmlQuestions=int(mask.sum()))
    rng = np.random.default_rng(130187)
    for base in ("fresh","holdout"):
        order = rng.permutation(3000)
        for fold in (base,"shared-"+base):
            draws[fold] = {k:v[order] for k,v in draws[fold].items()}
    keys = scores.keys()
    balanced = {k:combine({f:macros[f][k] for f in FOLDS}).tolist() for k in keys}
    boot = {k:combine({f:draws[f][k] for f in FOLDS}) for k in keys}
    weights = [counts[f]*(1 if f=="confirmation" else .5) for f in FOLDS]
    by_question = {k:np.average([means[f][k] for f in FOLDS],axis=0,weights=weights).tolist() for k in keys}
    intervals = {}
    references = ["semachunk","native","enhanced","two","blocks"]
    if "mastraHtmlChoice" in boot:
        references.append("mastraHtmlChoice")
    for k,b in boot.items():
        intervals[k] = {r:(100*np.quantile(b-boot[r],[.025,.975],axis=0).T).tolist()
                        for r in references}
    if not exclude:
        for k in original:
            assert np.allclose(balanced[k],MAIN["validation"][k]) and np.allclose(by_question[k],MAIN["validationEqualQuestions"][k])
        for k in ("native","enhanced","two"):
            assert np.allclose(intervals["semachunk"][k],MAIN["validationPaired95pp"][k])
    return dict(census=census,domainBalanced=balanced,equalQuestions=by_question,paired95pp=intervals)


def agency_intervals(data, compared):
    deltas = collections.defaultdict(list)
    counts = []
    for i, (agency, group) in enumerate(data.items()):
        qs = [("agency",owner,qid) for owner,qid,_ in group["questions"]]
        weights = PRIOR["bootstrap_weights"](qs, {"agency":list(range(len(qs)))})
        order = np.random.default_rng(8743+i).permutation(len(weights))
        counts.append(len(qs))
        for a,b in compared:
            diff = np.asarray(group["rows"][a])[:,:2]-np.asarray(group["rows"][b])[:,:2]
            deltas[a+" minus "+b].append((weights @ diff)[order])
    return {k:(100*np.quantile(np.average(v,axis=0,weights=counts),[.025,.975],axis=0).T).tolist()
            for k,v in deltas.items()}


def main():
    study, rates, selected = {}, {}, {}
    for fold in ("development","confirmation"):
        study[fold] = {agency:collection(fold,agency) for agency in AGENCIES}
        rates[fold] = average_agencies(study[fold])
        if fold == "development":
            dev = rates[fold]
            initial = [k for k in dev if k not in (PACKED,BY_HEADING)]
            selected = {"directRerank":choose(dev,[k for k in initial if k.startswith("html/") and k!=HEADINGS]),
                        "nativeHtml":choose(dev,[k for k in initial if k.startswith("html/")]),
                        "converted":choose(dev,[k for k in initial if k.startswith("markdown/")]),
                        "overall":choose(dev,initial),
                        "groupedNative":choose(dev,[k for k in dev if k.startswith("html/")]), "expandedChoice":choose(dev,dev)}
        print(fold, selected, flush=True)
    fsa = study["confirmation"]["studentaid"]
    archive = PREVIOUS["collections"]["confirmation"]["studentaid"]
    keys = [tuple(q[:2]) for q in fsa["questions"]]
    assert len(set(keys)) == len(keys)
    def keyed(rows):
        assert len(rows) == len(keys)
        return dict(zip(keys,np.asarray(rows)[:,:4].tolist()))
    replaces = {k:("semachunk",keyed(fsa["rows"][name])) for k,name in (
        ("headings",HEADINGS),("packed",PACKED),("packedByHeading",BY_HEADING))}
    for name,k in selected.items():
        replaces[name] = ("semachunk",keyed(fsa["rows"][k]))
    for profile,rival in (("semachunk","semachunk"),("native","mastra-recursive"),
                          ("enhanced","mastra-enhanced"),("two","mastra-pair")):
        replaces[profile+"Markdown"] = (profile,keyed(archive["formats"]["markdown"][rival]["rows"]))
    # Give Mastra the same format-specific choice, keeping its strongest validation
    # single layout elsewhere. The route on HTML is selected on development only.
    routes = [(p,f) for p in ("mastra-recursive","mastra-format","mastra-enhanced","mastra-pair")
              for f in ("html","markdown")]
    utility = {(p,f):np.mean(PREVIOUS["aggregates"]["development"][p][f]["equalAgencies"][:2]) for p,f in routes}
    rival, fmt = next(r for r in routes if utility[r] >= max(utility.values())-.0025)
    replaces["mastraHtmlChoice"] = ("enhanced",keyed(archive["formats"][fmt][rival]["rows"]))
    formats = corpus_formats()
    compared = [(HEADINGS,label("html",.5,.3)),(selected["directRerank"],label("html",.5,.3)),
                (selected["converted"],label("markdown",.5,.3)),(selected["nativeHtml"],selected["converted"]),
                (selected["groupedNative"],label("html",.5,.3)),(selected["groupedNative"],selected["converted"]),
                (PACKED,BY_HEADING),(PACKED,HEADINGS)]
    result = dict(metrics=FIELDS,selected=selected,mastraHtmlChoice=[rival,fmt],collections=study,rates=rates,
                  agencyPaired95pp=agency_intervals(study["confirmation"],compared),
                  full=main_scores(formats,replaces),excludeRawHTML=main_scores(formats,{},exclude=True))
    BENCH["PLACEMENT"]["packed"](RESULT,result)
    print(RESULT,flush=True)


if __name__ == "__main__":
    main()
