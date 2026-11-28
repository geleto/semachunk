"""Select Mastra splitters on development, then search the frozen evaluation pools."""
import argparse
import collections
import gzip
import itertools
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PLACEMENT = runpy.run_path(str(HERE / "passage-placement.py"))
PRIOR = PLACEMENT["PREV"]
LIB, EV = PRIOR["LIB"], PRIOR["EV"]
ROOT = HERE / ".cache/mastra-comparison"
PROTOCOL = json.loads((HERE / "mastra-protocol.json").read_bytes())
FOLDS = PLACEMENT["FOLDS"]
TREATMENTS = PROTOCOL["treatments"]
LABELS = [f"{family}/{size}/{overlap}" for family in PROTOCOL["families"] for size in PROTOCOL["sizes"]
          for overlap in PROTOCOL["overlapPercent"] + (PROTOCOL["extra512OverlapPercent"] if size == 512 else [])]
RESULT = HERE / "results/2026-11-27-mastra-comparison.json.gz"


def load_groups(fold):
    split = fold.removeprefix("shared-")
    folder = LIB["ROOT"]/"holdout-data" if split == "holdout" else HERE/".cache/context-mixtures"/("audited-data" if split == "fresh" else "data")
    groups, all_docs = [], []
    for key, spec in LIB["REG"].items():
        if spec["fold"] != split:
            continue
        docs = []
        for i, src in enumerate(json.loads((folder/(key+".json")).read_bytes())["docs"]):
            stem = ROOT/key/str(i)
            ix = PRIOR["zipped"](stem.with_suffix(".json.gz"))
            assert ix["id"] == src["id"] and ix["model"] == PROTOCOL["model"]
            ordinals = EV.ordinals(src["source"])
            for v in ix["views"]:
                v["ink"] = EV.union((ordinals[a], ordinals[b]) for a,b in v["ranges"])
                v["size"] = EV.size(v["ink"])
                v["length"] = EV.size(v["raw"])
                assert 0 < v["tokens"] <= PROTOCOL["passageTokens"]
            docs.append(dict(id=ix["id"], domain=spec["domain"], ix=ix, o=ordinals, file=stem.with_suffix(".f32")))
        all_docs.extend(docs)
        groups.extend([docs] if spec["pool"] == "collection" else [[d] for d in docs])
    return ([all_docs] if fold.startswith("shared-") else groups), all_docs


def scores_for(pool, layout, treatments):
    columns = collections.defaultdict(list)
    for off,d,s in zip(pool.offsets,pool.docs,pool.sim):
        cs = d["ix"]["layouts"][layout]
        ids = np.array([c["v"] for c in cs])
        centers = s[:,ids]
        enriched = any(t.startswith("structure") for t in treatments)
        near = "near" in treatments or any(t.startswith("structure-near") for t in treatments)
        if enriched:
            paragraph = np.column_stack([s[:,c["pa"]].max(axis=1) if c["pa"] else centers[:,i] for i,c in enumerate(cs)])
            paragraphs = np.array([bool(c["pa"]) for c in cs])
            sections = np.array([c["section"] for c in cs])
            parents = s[:,np.maximum(0,sections)]
            def structural(base):
                blended = np.where(paragraphs,.5*(base+paragraph),base)
                return np.where(sections>=0,.85*blended+.15*parents,blended)
            columns["structure"].append(structural(centers))
        if near:
            left = np.array([c["near"][0] if c["near"] else i for i,c in enumerate(cs)])
            right = np.array([c["near"][-1] if c["near"] else i for i,c in enumerate(cs)])
            m = PRIOR["matrix"](d["file"])
            c, l, r = m[ids],m[ids[left]],m[ids[right]]
            dot = PRIOR["dot_rows"]
            norm = np.sqrt(.7**2 + .7*.3*(dot(c,l)+dot(c,r)) + .3**2*.5*(1+dot(l,r)))
            mixed = (.7*centers+.15*(centers[:,left]+centers[:,right])) / norm
            mixed = np.where((ids[left]==ids)&(ids[right]==ids),centers,mixed)
            if enriched:
                columns["structure-near"].append(structural(mixed))
            if "near" in treatments:
                columns["near"].append(mixed)
        columns["core"].append(centers)
        columns["bare"].extend(off+c["bare"] for c in cs)
        columns["win"].extend(off+c["win"] for c in cs)
    arrays = {k:(np.array(v) if k in ("bare","win") else np.concatenate(v,axis=1)) for k,v in columns.items()}
    return {t:(arrays[t.removesuffix("-bare")] if t.startswith("structure") or t=="near" else arrays["core"],
               arrays["bare"] if t=="native" or t.endswith("-bare") else arrays["win"]) for t in treatments}


def score(fold, configs):
    groups, docs = load_groups(fold)
    requested = collections.defaultdict(set)
    for config in configs:
        for arm in config.split("+"):
            layout,treatment = arm.split("@")
            requested[layout].add(treatment)
    qs,results = [], collections.defaultdict(list)
    sizes = {layout:sum(d["ix"]["geometry"][layout]["chunks"] for d in docs) for layout in requested}
    for group in groups:
        if not any(d["ix"]["qs"] for d in group):
            continue
        pool = LIB["Pool"](group,accept_shared_holdout_citations=fold=="shared-holdout",stream_vectors=True)
        owners=np.asarray(pool.owners)
        questions,refs,sim = pool.qs,pool.refs,pool.sim
        for start in range(0,len(questions),48):
            batch = slice(start,start+48)
            pool.qs,pool.refs,pool.sim=questions[batch],refs[batch],[s[batch] for s in sim]
            qs.extend((d["domain"],d["id"],q["id"]) for d,q in pool.qs)
            for f in ("evidence","grade","fraction"):
                getattr(pool,f).cache_clear()
            signatures,arrays,aliases = {}, {}, {}
            for layout,treatments in requested.items():
                # Format routing is identical to recursive on plain text.
                signature=tuple(tuple((c["v"],c["bare"],c["win"]) for c in d["ix"]["layouts"][layout]) for d in group)
                key=(signature,tuple(sorted(treatments)))
                if key not in signatures:
                    signatures[key]=layout
                    for t,pair in scores_for(pool,layout,treatments).items():
                        arrays[layout+"@"+t]=pair
                for t in treatments:
                    aliases[layout+"@"+t]=signatures[key]+"@"+t
            graded={}
            for config in configs:
                arms=tuple(aliases[arm] for arm in config.split("+"))
                if arms not in graded:
                    matrices,views=zip(*(arrays[arm] for arm in arms))
                    scores = matrices[0] if len(arms)==1 else np.concatenate(matrices,axis=1)
                    windows = views[0] if len(arms)==1 else np.concatenate(views)
                    if len(arms)>1:
                        order=np.argsort(owners[windows],kind="stable")
                        scores,windows=scores[:,order],windows[order]
                    if len(arms)==1 and arms[0].endswith("@native"):
                        # Documented chunk-cosine search returns the raw top five, including overlaps.
                        top=np.argsort(-scores,axis=1,kind="stable")[:,:5]
                        hits=[tuple(int(x) for x in row) for row in windows[top]]
                    else:
                        hits=PRIOR["top_views"](pool,scores,windows,overlap=.75)
                    graded[arms]=[pool.grade(j,row)[:4] for j,row in enumerate(hits)]
                results[config].extend(graded[arms])
        for f in ("evidence","grade","fraction","related"):
            getattr(pool,f).cache_clear()
        PRIOR["matrix"].cache_clear()
    archive=PRIOR["zipped"](PLACEMENT["ROOT"]/(fold+"-meta.json.gz"))
    assert [list(q) for q in qs]==archive["questions"]
    return qs,{k:np.asarray(v) for k,v in results.items()},sizes


def groups_for(qs):
    domain=collections.defaultdict(list)
    for i,(d,_,_) in enumerate(qs):
        domain[d].append(i)
    return domain


def macro(rows,groups):
    return np.mean([rows[ix].mean(axis=0) for ix in groups.values()],axis=0)


def select(labels,rates,sizes):
    best=max(np.mean(rates[k][:2]) for k in labels)
    within=[k for k in labels if np.mean(rates[k][:2])>=best-.0015]
    def complexity(config):
        parts=[arm.split("@") for arm in config.split("+")]
        return (len(parts),sum(TREATMENTS.index(t) for _,t in parts),sum(int(l.split("/")[-1]) for l,_ in parts),
                sum(sizes[l] for l,_ in parts),-np.mean(rates[config][:2]),config)
    return min(within,key=complexity)


def save(fold,qs,values):
    np.savez_compressed(ROOT/(fold+"-questions.npz"),**values)
    (ROOT/(fold+"-questions.json")).write_text(json.dumps(qs),encoding="utf8")


def development():
    singles=[layout+"@"+t for layout in LABELS for t in TREATMENTS]
    print("Scoring",len(singles),"single-layout development configurations",flush=True)
    qs,values,sizes=score("development",singles)
    groups=groups_for(qs)
    rates={k:macro(v,groups) for k,v in values.items()}
    shortlist=sorted({select([k for k in singles if k.startswith(family+"/") and k.endswith("@"+t)],rates,sizes)
                      for family in PROTOCOL["families"] for t in TREATMENTS})
    pairs=[a+"+"+b for a,b in itertools.combinations(shortlist,2) if a.split("@")[0]!=b.split("@")[0]]
    print("Testing",len(pairs),"two-layout configurations",flush=True)
    again,pair_values,_=score("development",pairs)
    assert again==qs
    values.update(pair_values)
    rates.update({k:macro(v,groups) for k,v in pair_values.items()})
    selected=dict(native=select([k for k in singles if k.endswith("@native")],rates,sizes),
                  enhanced=select([k for k in singles if not k.endswith("@native")],rates,sizes),
                  best=select(list(rates),rates,sizes))
    selected["two"]=select(pairs,rates,sizes)
    selected["layouts"]=sorted({a.split("@")[0] for c in list(selected.values()) for a in c.split("+")})
    selected["shortlist"]=shortlist
    selected["trials"]={"single":len(singles),"two":len(pairs)}
    save("development",qs,values)
    (ROOT/"selection.json").write_text(json.dumps(selected,indent=2)+"\n",encoding="utf8")
    print(selected,flush=True)


def validation(fold):
    selected=json.loads((ROOT/"selection.json").read_bytes())
    configs=list(dict.fromkeys(selected[k] for k in ("native","enhanced","two","best")))
    qs,values,_=score(fold,configs)
    save(fold,qs,values)
    print(fold,len(qs),"questions",len(configs),"frozen configurations",flush=True)


def pair_controls(fold):
    selection=json.loads((ROOT/"selection.json").read_bytes())
    layouts=[arm.split("@")[0] for arm in selection["two"].split("+")]
    configs={t:"+".join(layout+"@"+t for layout in layouts)
             for t in ("native","context","structure","structure-near","structure-near-bare")}
    qs,values,_=score(fold,list(configs.values()))
    np.savez_compressed(ROOT/(fold+"-controls.npz"),**{t:values[c] for t,c in configs.items()})
    return qs


def index_cost(fold,selection):
    _,docs=load_groups(fold)
    levels={}
    for arm in ("native","enhanced","two","best"):
        candidates=keys=secondary=missing=total=0
        chunksizes=[]
        for d in docs:
            ix=d["ix"]; vectors=set(); ink=[]
            for branch in selection[arm].split("+"):
                layout,treatment=branch.split("@")
                secondary+=ix["geometry"][layout]["secondary"]
                for c in ix["layouts"][layout]:
                    candidates+=1
                    vectors.add(c["v"])
                    if treatment.startswith("structure"):
                        vectors.update(c["pa"])
                        if c["section"]>=0: vectors.add(c["section"])
                    view=ix["views"][c["bare"]]
                    chunksizes.append(view["tokens"])
                    ink.extend(view["ink"])
            keys+=len(vectors)
            count=d["o"][-1]
            total+=count
            missing+=count-EV.size(EV.union(ink))
        levels[arm]=dict(candidates=candidates,distinctRetrievalVectors=keys,medianCoreTokens=float(np.median(chunksizes)),
                         secondarySplits=secondary,uncoveredNonWhitespace=missing,sourceNonWhitespace=total)
    candidates=keys=0
    for d in docs:
        old=PRIOR["zipped"](PRIOR["ROOT"]/d["file"].relative_to(ROOT).with_suffix(".json.gz"))
        vectors=set()
        for layout in ("blocks","0.15"):
            for c in old["layouts"][layout]:
                candidates+=1
                vectors.add(c["v"]); vectors.update(c["pa"]); vectors.update(c.get("chunk",[]))
                if c["section"]>=0: vectors.add(c["section"])
        keys+=len(vectors)
    levels["semachunk"]=dict(candidates=candidates,distinctRetrievalVectors=keys)
    return levels


def coverage_diagnostic(fold,key,selection):
    """Check whether each missed first hit had any single fully citable candidate."""
    folder=LIB["ROOT"]/"holdout-data" if fold=="holdout" else HERE/".cache/context-mixtures/data"
    docs=json.loads((folder/(key+".json")).read_bytes())["docs"]
    ordinals={d["id"]:EV.ordinals(d["source"]) for d in docs}
    def ink(owner,ranges):
        o=ordinals[owner]
        return EV.union((o[a],o[b]) for a,b in ranges)
    windows={"semachunk":{},"native":{}}
    questions=[]
    for i,d in enumerate(docs):
        stem=PRIOR["ROOT"]/key/str(i); owner=d["id"]
        base=PRIOR["zipped"](stem.with_suffix(".json.gz")); wide=PRIOR["zipped"](stem.with_suffix(".budget.json.gz"))
        mastra=PRIOR["zipped"]((ROOT/key/str(i)).with_suffix(".json.gz"))
        assert base["id"]==mastra["id"]==owner and wide["baseStamp"]==base["stamp"]
        sv=[base["views"][c["win"]] for c in base["layouts"]["blocks"]]
        sv.extend(wide["views"][c["budget"]["win"]] for c in wide["layouts"]["0.15"])
        mv=[mastra["views"][c["bare"]] for c in mastra["layouts"][selection["native"].split("@")[0]]]
        for method,views in (("semachunk",sv),("native",mv)):
            windows[method][owner]=[ink(owner,v["ranges"]) for v in views]
        questions.extend((owner,q) for q in mastra["qs"])
    ids=json.loads((ROOT/(fold+"-questions.json")).read_bytes())
    row={(owner,q):i for i,(_,owner,q) in enumerate(ids)}
    with np.load(PLACEMENT["ROOT"]/(fold+"-questions.npz")) as old, np.load(ROOT/(fold+"-questions.npz")) as study:
        hits={"semachunk":old["combined/0.15/one"][:,0],"native":study[selection["native"]][:,0]}
    count=collections.Counter()
    examples={}
    for owner,q in questions:
        refs=[(owner,ink(owner,r)) for r in q.get("references",[q.get("ranges")])]
        refs.extend((a["source"],ink(a["source"],a["ranges"])) for a in q.get("alternativeSources",[]))
        possible={k:any(EV.size(EV.intersect(v,ref))==EV.size(ref) for s,ref in refs for v in w[s]) for k,w in windows.items()}
        i=row[owner,q["id"]]
        for a,b in (("semachunk","native"),("native","semachunk")):
            assert not hits[a][i] or possible[a]
            count[a+"/possible"]+=int(possible[a])
            if hits[b][i] and not hits[a][i]:
                reason="available" if possible[a] else "absent"
                tag=a+"/missed/"+reason
                count[tag]+=1
                examples.setdefault(tag,dict(source=owner,question=q["text"],id=q["id"]))
    return dict(fold=fold,collection=key,questions=len(questions),counts=dict(count),examples=examples)


def publish():
    selection=json.loads((ROOT/"selection.json").read_bytes())
    compact=PRIOR["zipped"](HERE/"results/2026-11-27-neighbor-threshold.json.gz")
    folds,draws={},{}
    for fold in FOLDS:
        qs=json.loads((ROOT/(fold+"-questions.json")).read_bytes()); groups=groups_for(qs)
        original=PRIOR["zipped"](PLACEMENT["ROOT"]/(fold+"-meta.json.gz"))
        assert qs==original["questions"]
        with np.load(ROOT/(fold+"-questions.npz")) as measured:
            grid={k:macro(measured[k],groups).tolist() for k in measured} if fold=="development" else {}
            values={k:measured[selection[k]] for k in ("native","enhanced","two","best")}
        with np.load(PLACEMENT["ROOT"]/(fold+"-questions.npz")) as prior:
            values.update(semachunk=prior["combined/0.15/one"],blocks=prior["tuned"],
                          tunedUnion=prior["tunedUnion/0.225/core"],parent=prior["tunedParent/0.175/0.5"])
        controls=ROOT/(fold+"-controls.npz")
        if not controls.exists(): assert [list(q) for q in pair_controls(fold)]==qs
        with np.load(controls) as ablations:
            assert np.array_equal(ablations["structure-near"],values["two"])
            values.update({"pair/"+k:ablations[k] for k in ablations})
        rates={k:macro(v,groups).tolist() for k,v in values.items()}
        assert np.allclose(rates["semachunk"],compact["folds"][fold]["budget"]["rates"]["combined/0.15/one/budget"])
        rates["immediate"]=compact["folds"][fold]["budget"]["rates"]["combined/0.15/one/1"]
        intervals={}
        weights=PRIOR["bootstrap_weights"](qs,groups)
        for k in ("native","best","enhanced","two"):
            diff=values["semachunk"][:,:2]-values[k][:,:2]
            sampled=weights@diff
            intervals[k]=dict(paired95pp=(100*np.quantile(sampled,[.025,.975],axis=0).T).tolist(),
                             gained=(diff>0).sum(axis=0).tolist(),lost=(diff<0).sum(axis=0).tolist())
            draws[fold,k]=sampled
        if fold.startswith("shared-"):
            assert qs==json.loads((ROOT/(fold.removeprefix("shared-")+"-questions.json")).read_bytes())
        geometry=compact["folds"][fold]["geometry"]
        costs=folds[fold[7:]]["index"] if fold.startswith("shared-") else index_cost(fold,selection)
        assert costs["semachunk"]["candidates"]==geometry["blocks"]["chunks"]+geometry["0.15"]["chunks"]
        folds[fold]=dict(questions=len(qs),documents=original["sources"],rates=rates,index=costs,
                         questionMeans={k:v.mean(axis=0).tolist() for k,v in values.items()},
                         pairedOutcomes=dict(questionIds=qs,profiles={k:values[k].tolist() for k in
                                             ("semachunk","native","enhanced","two","blocks")}),
                         domains={d:{k:v[ix].mean(axis=0).tolist() for k,v in values.items()} for d,ix in groups.items()},
                         comparisons=intervals,developmentGrid=grid)
    # Resample the same documents for original and pooled search; independent question
    # sets use independently permuted draw indices, preserving each paired bootstrap.
    rng=np.random.default_rng(130187)
    pf=rng.permutation(3000); ph=rng.permutation(3000)
    def average(v):
        return (v["confirmation"]+(v["fresh"]+v["shared-fresh"])/2+(v["holdout"]+v["shared-holdout"])/2)/3
    aggregate={k:average({f:np.array(folds[f]["rates"][k]) for f in FOLDS[1:]}).tolist() for k in folds["confirmation"]["rates"]}
    question_weight={f:folds[f]["questions"]*(1 if f=="confirmation" else .5) for f in FOLDS[1:]}
    per_question={k:(sum(w*np.array(folds[f]["questionMeans"][k]) for f,w in question_weight.items())/sum(question_weight.values())).tolist()
                  for k in folds["confirmation"]["questionMeans"]}
    ci={}
    for k in ("native","best","enhanced","two"):
        dd={f:draws[f,k] for f in FOLDS[1:]}
        for f in ("fresh","shared-fresh"):dd[f]=dd[f][pf]
        for f in ("holdout","shared-holdout"):dd[f]=dd[f][ph]
        ci[k]=(100*np.quantile(average(dd),[.025,.975],axis=0).T).tolist()
    diagnostics={k:coverage_diagnostic(f,k,selection) for f,k in
                 (("confirmation","government-confirmation-reviewed-studentaid-html"),("holdout","fiction-holdout"))}
    PLACEMENT["packed"](RESULT,dict(protocol=PROTOCOL,selected=selection,metrics=PRIOR["METRICS"],folds=folds,
                                    validation=aggregate,validationPaired95pp=ci,validationEqualQuestions=per_question,
                                    candidateCoverageDiagnostics=diagnostics))
    print(json.dumps(dict(aggregate=aggregate,paired=ci,selected={k:selection[k] for k in ("native","enhanced","two","best")}),indent=2))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=(*FOLDS,"publish"))
    parser.add_argument("--controls",action="store_true",help="Hold the selected pair of layouts fixed and isolate scoring and display")
    args=parser.parse_args()
    if args.controls: pair_controls(args.action)
    elif args.action=="development": development()
    elif args.action=="publish": publish()
    else: validation(args.action)
