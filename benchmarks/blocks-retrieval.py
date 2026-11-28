"""Transfer section scoring, adjacent-vector scoring and the bounded reader to standalone blocks."""
import gzip
import hashlib
import itertools
import json
import runpy
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
FINAL = runpy.run_path(str(HERE / "mastra-finalists.py"))
BENCH, PRIOR = FINAL["BENCH"], FINAL["PRIOR"]
ROOT = HERE / ".cache/blocks-retrieval"
RESULT = HERE / "results/2026-11-28-blocks-retrieval.json.gz"
BASE = (0, 0, "one")
GRID = list(itertools.product([0, .075, .15, .225], [0, .15, .30], ["one", "budget", "extend"]))
# Transfer the semantic weights and test both bounded readers and their combinations.
# Freeze these and the development nominee's subsets before validation.
TRANSFERS = list(itertools.product([0, .15], [0, .30], ["one", "budget", "extend"]))


def label(config):
    return "/".join(map(str, config))


def preserves(wide, short):
    return all(any(x<=a and b<=y for x,y in wide["raw"]) for a,b in short["raw"])


def lookup_arrays(pool):
    centers, paragraphs, parents, has_paragraph, has_section = [], [], [], [], []
    side_means, dot_sums, side_dots, unchanged = [], [], [], []
    windows = {"one": [], "budget": [], "extend": []}
    for doc, sim, offset in zip(pool.docs, pool.sim, pool.offsets):
        chunks = doc["ix"]["layouts"]["blocks"]
        ids = np.array([c["v"] for c in chunks])
        left = np.array([c["near"][0] if c["near"] else j for j,c in enumerate(chunks)])
        right = np.array([c["near"][-1] if c["near"] else j for j,c in enumerate(chunks)])
        vectors = PRIOR["matrix"](doc["file"])
        core, lvec, rvec = vectors[ids], vectors[ids[left]], vectors[ids[right]]
        dot = PRIOR["dot_rows"]
        dot_sums.append(dot(core,lvec) + dot(core,rvec))
        side_dots.append(dot(lvec,rvec))
        unchanged.append((ids[left]==ids) & (ids[right]==ids))
        center = sim[:,ids]
        centers.append(center)
        side_means.append((center[:,left] + center[:,right]) / 2)
        paragraphs.append(np.column_stack([sim[:,c["pa"]].max(axis=1) if c["pa"] else center[:,j]
                                           for j,c in enumerate(chunks)]))
        parents.append(sim[:,[max(0,c["section"]) for c in chunks]])
        has_paragraph.extend(bool(c["pa"]) for c in chunks)
        has_section.extend(c["section"] >= 0 for c in chunks)
        windows["one"].extend(offset+c["win"] for c in chunks)
        windows["budget"].extend(offset+c["wide"] for c in chunks)
        for c in chunks:
            short,wide = [doc["ix"]["views"][c[k]] for k in ("win","wide")]
            windows["extend"].append(offset+(c["wide"] if preserves(wide,short) else c["win"]))
    center, mean, paragraph, parent = map(np.column_stack, (centers,side_means,paragraphs,parents))
    same, sum_dot, side_dot = map(np.concatenate, (unchanged,dot_sums,side_dots))

    def scores(section, neighbor):
        core = center
        if neighbor:
            keep = 1-neighbor
            norm = np.sqrt(keep**2 + keep*neighbor*sum_dot + .5*neighbor**2*(1+side_dot))
            core = np.where(same,center,(keep*center + neighbor*mean)/norm)
        base = np.where(has_paragraph,.5*(core+paragraph),core)
        return np.where(has_section,(1-section)*base + section*parent,base) if section else base

    return scores, {k:np.array(v) for k,v in windows.items()}


def passage_hash(pool, hits):
    cited = [[pool.docs[pool.owners[h]]["id"],pool.views[h]["raw"],pool.views[h]["tokens"]] for h in hits]
    return hashlib.sha256(json.dumps(cited,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()


def evaluate(fold, configs, directory=ROOT):
    groups, docs = BENCH["load_groups"](fold,directory)
    questions, metrics, examples = [], {c:[] for c in configs}, {c:[] for c in configs}
    for group in groups:
        if not any(d["ix"]["qs"] for d in group):
            continue
        pool = BENCH["LIB"]["Pool"](group,accept_shared_holdout_citations=fold=="shared-holdout",stream_vectors=True)
        questions.extend((d["domain"],d["id"],q["id"]) for d,q in pool.qs)
        scores, windows = lookup_arrays(pool)
        for section,neighbor in sorted({(s,n) for s,n,_ in configs}):
            ranking = scores(section,neighbor)
            for window in windows:
                c = (section,neighbor,window)
                if c not in metrics:
                    continue
                hits = PRIOR["top_views"](pool,ranking,windows[window],verify=(c==BASE))
                metrics[c].extend(pool.grade(j,shown)[:4] for j,shown in enumerate(hits))
                if fold!="development":
                    examples[c].extend(passage_hash(pool,shown) for shown in hits)
        for f in ("evidence","grade","fraction","related"):
            getattr(pool,f).cache_clear()
        PRIOR["matrix"].cache_clear()
    archive = PRIOR["zipped"](BENCH["PLACEMENT"]["ROOT"]/(fold+"-meta.json.gz"))
    assert [list(q) for q in questions] == archive["questions"]
    by_domain = BENCH["groups_for"](questions)
    values = {c:np.array(rows) for c,rows in metrics.items()}
    rates = {c:BENCH["macro"](v,by_domain) for c,v in values.items()}
    return questions, len(docs), values, rates, examples


def pack(file, data):
    file.write_bytes(gzip.compress(json.dumps(data,separators=(",",":")).encode(),mtime=0))


def select():
    qs, docs, _, rates, _ = evaluate("development",GRID)
    mean = {c:np.mean(v[:2]) for c,v in rates.items()}
    within = [c for c in GRID if mean[c]>=max(mean.values())-.0015]
    def preference(c):
        section,neighbor,window = c
        enabled = int(bool(section))+int(bool(neighbor))+int(window!="one")
        return enabled, int(window=="extend"), -mean[c], -rates[c][2], c
    chosen = min(within,key=preference)
    candidates = set(TRANSFERS)
    candidates.update(itertools.product([0,chosen[0]],[0,chosen[1]],["one",chosen[2]]))
    selection = dict(questions=len(qs),sources=docs,chosen=chosen,candidates=sorted(candidates),
                     rates={label(c):v.tolist() for c,v in rates.items()})
    (ROOT/"selection.json").write_text(json.dumps(selection,indent=2))
    print("Development",len(qs),"questions;",docs,"sources; nominee",chosen,flush=True)
    for c in sorted(rates,key=mean.get,reverse=True):
        print(c,np.round(rates[c]*[100,100,100,1],2),flush=True)


def validate():
    selection = json.loads((ROOT/"selection.json").read_text())
    configs = [tuple(c) for c in selection["candidates"]]
    all_rates, draws, folds = {}, {}, {}
    for fold in FINAL["SCOPES"]:
        qs,docs,values,rates,examples = evaluate(fold,configs)
        groups = BENCH["groups_for"](qs)
        weights = PRIOR["bootstrap_weights"](qs,groups)
        draws[fold] = {c:weights @ (v-values[BASE]) for c,v in values.items()}
        all_rates[fold] = rates
        folds[fold] = dict(questions=qs,sources=docs,rates={label(c):r.tolist() for c,r in rates.items()},
                           metrics={label(c):v.tolist() for c,v in values.items()})
        pack(ROOT/(fold+"-verify.json.gz"),dict(questions=qs,profiles={label(c):rows for c,rows in examples.items()}))
        print(fold,len(qs),"questions;",docs,"sources;",flush=True)
    for f in ["fresh","holdout"]:
        assert folds[f]["questions"]==folds["shared-"+f]["questions"]
    combined = FINAL["combined"]
    rng = np.random.default_rng(130187)
    for f in ["fresh","holdout"]:
        perm = rng.permutation(3000)
        for scope in [f,"shared-"+f]:
            draws[scope] = {c:b[perm] for c,b in draws[scope].items()}
    balanced, intervals = {}, {}
    for c in configs:
        avg = combined({f:v[c] for f,v in all_rates.items()})
        diff = combined({f:v[c] for f,v in draws.items()})
        balanced[label(c)] = avg.tolist()
        # Coverage and F1 in percentage points, length in tokens. Final pair is mean first/five.
        scaled = diff * [100,100,100,1]
        intervals[label(c)] = np.quantile(np.column_stack((scaled,scaled[:,:2].mean(axis=1))),[.025,.975],axis=0).T.tolist()
        print(c,"balanced",np.round(avg*[100,100,100,1],2),"paired95",np.round(intervals[label(c)],2).tolist(),flush=True)
    pack(RESULT,dict(metrics=["completeFirst","completeFive","firstEvidenceF1","firstTokens"],model=BENCH["PROTOCOL"]["model"],
                     development=selection,balanced=balanced,paired95vsBaseline=intervals,folds=folds))


def combined_control():
    """Change only the structural reader inside the previously published semantic finalist."""
    archived = PRIOR["zipped"](FINAL["RESULT"])
    result = PRIOR["zipped"](RESULT)
    rates, draws, folds = {}, {}, {}
    for fold in FINAL["SCOPES"]:
        groups, docs = BENCH["load_groups"](fold,FINAL["CACHE"])
        for d in docs:
            ix = d["ix"]
            aux = PRIOR["zipped"](ROOT/d["file"].parent.name/d["file"].with_suffix(".json.gz").name)
            assert d["id"] == aux["id"]
            for src,c in zip(aux["layouts"]["blocks"],ix["layouts"]["blocks"],strict=True):
                wide, short = aux["views"][src["wide"]],ix["views"][c["win"]]
                c["extend"] = c["win"]
                if (wide["raw"]==short["raw"] and wide["tokens"]==short["tokens"] and wide["ranges"]==short["ranges"]) or not preserves(wide,short):
                    continue
                ink = BENCH["EV"].union((d["o"][a],d["o"][b]) for a,b in wide["ranges"])
                c["extend"] = len(ix["views"])
                ix["views"].append(dict(**wide,ink=ink,size=BENCH["EV"].size(ink),length=BENCH["EV"].size(wide["raw"])))
        vals, questions, checks = {"one":[],"extend":[]}, [], []
        for group in groups:
            if not any(d["ix"]["qs"] for d in group):
                continue
            pool = BENCH["LIB"]["Pool"](group,accept_shared_holdout_citations=fold=="shared-holdout",stream_vectors=True)
            questions.extend([d["domain"],d["id"],q["id"]] for d,q in pool.qs)
            b, short = BENCH["scores_for"](pool,"blocks",["structure"])["structure"]
            s, sem = BENCH["scores_for"](pool,"semantic",["structure-near"])["structure-near"]
            extended = [o+c["extend"] for o,d in zip(pool.offsets,group) for c in d["ix"]["layouts"]["blocks"]]
            order = np.argsort(np.asarray(pool.owners)[np.concatenate((short,sem))],kind="stable")
            scores = np.concatenate((b,s),axis=1)[:,order]
            for method,struct in [("one",short),("extend",extended)]:
                hits = PRIOR["top_views"](pool,scores,np.concatenate((struct,sem))[order])
                vals[method].extend(pool.grade(j,h)[:4] for j,h in enumerate(hits))
                if method=="extend":
                    checks.extend(passage_hash(pool,h) for h in hits)
            for f in ("evidence","grade","fraction","related"):
                getattr(pool,f).cache_clear()
            PRIOR["matrix"].cache_clear()
        reference = archived["folds"][fold]
        assert questions==reference["questions"]
        assert np.array_equal(vals["one"],reference["profiles"]["semachunk"])
        domain = BENCH["groups_for"](questions)
        rates[fold] = {m:BENCH["macro"](np.array(v),domain) for m,v in vals.items()}
        draws[fold] = PRIOR["bootstrap_weights"](questions,domain) @ (np.array(vals["extend"])-vals["one"])
        folds[fold] = {m:v.tolist() for m,v in rates[fold].items()}
        pack(ROOT/(fold+"-semantic-verify.json.gz"),dict(questions=questions,profiles={"extend":checks}))
    rng = np.random.default_rng(130187)
    for fold in ["fresh","holdout"]:
        perm = rng.permutation(3000)
        for scope in [fold,"shared-"+fold]:
            draws[scope] = draws[scope][perm]
    avg = {m:FINAL["combined"]({s:v[m] for s,v in rates.items()}).tolist() for m in vals}
    paired = np.quantile(FINAL["combined"](draws)*[100,100,100,1],[.025,.975],axis=0).T.tolist()
    result["combinedSemantic"] = dict(balanced=avg,paired95=paired,folds=folds)
    pack(RESULT,result)
    print("Combined semantic",avg,"paired95",paired,flush=True)


def core_sizes():
    result = PRIOR["zipped"](RESULT)
    readers = [BASE,(0,0,"extend")]
    dev = {256:{label(c):result["development"]["rates"][label(c)] for c in readers}}
    for size in [384,512]:
        _,_,_,rates,_ = evaluate("development",readers,ROOT/str(size))
        dev[size] = {label(c):r.tolist() for c,r in rates.items()}
    means = {s:np.mean(r["0/0/extend"][:2]) for s,r in dev.items()}
    nominee = min(s for s,v in means.items() if v>=max(means.values())-.0015)
    print("Development core nominee",nominee,dev,flush=True)
    rates, draws, per_fold = {}, {}, {}
    for fold in FINAL["SCOPES"]:
        reference = result["folds"][fold]
        baseline = np.array(reference["metrics"]["0/0/extend"])
        by_domain = BENCH["groups_for"](reference["questions"])
        weights = PRIOR["bootstrap_weights"](reference["questions"],by_domain)
        rates[fold],draws[fold],per_fold[fold] = {},{},{}
        for size in [384,512]:
            questions,_,values,avg,_ = evaluate(fold,readers,ROOT/str(size))
            assert [list(q) for q in questions]==reference["questions"]
            for config in readers:
                key = str(size)+"/"+config[2]
                rates[fold][key] = avg[config]
                draws[fold][key] = weights @ (values[config]-baseline)
                per_fold[fold][key] = dict(rates=avg[config].tolist(),metrics=values[config].tolist())
    rng = np.random.default_rng(130187)
    for f in ["fresh","holdout"]:
        perm = rng.permutation(3000)
        for scope in [f,"shared-"+f]:
            draws[scope] = {k:b[perm] for k,b in draws[scope].items()}
    balanced, intervals = {}, {}
    for key in rates["confirmation"]:
        balanced[key] = FINAL["combined"]({s:r[key] for s,r in rates.items()}).tolist()
        paired = FINAL["combined"]({s:r[key] for s,r in draws.items()}) * [100,100,100,1]
        intervals[key] = np.quantile(paired,[.025,.975],axis=0).T.tolist()
        print(key,np.round(np.array(balanced[key])*[100,100,100,1],2),"paired95",np.round(intervals[key],2).tolist(),flush=True)
    result["coreSizes"] = dict(development=dev,nominee=nominee,balanced=balanced,paired95vs256Extend=intervals,folds=per_fold)
    pack(RESULT,result)


if __name__=="__main__":
    {"select":select,"validate":validate,"combined":combined_control,"sizes":core_sizes}[sys.argv[1]]()
