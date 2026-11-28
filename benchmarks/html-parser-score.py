"""Score the shipped HTML parser with the original sources, model and ranking rules."""
import json
import runpy
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
STUDY = runpy.run_path(str(HERE/"html-markdown.py"))
PREV, LIB, EV = STUDY["PRIOR"], STUDY["LIB"], STUDY["EV"]
ARCHIVE = PREV["zipped"](STUDY["RESULT"])
ROOT = HERE/".cache/html-parser"
PROFILES = ("semachunk", "semachunk-core-ranking", "semachunk-blocks")
RESULT = HERE/"results/2026-11-28-html-parser.json.gz"


def run(docs, formats):
    pool = LIB["Pool"](docs, stream_vectors=True)
    qs = [[d["id"],q["id"],q["text"]] for d,q in pool.qs]
    results = {f:STUDY["score_pool"](pool,f,PROFILES) for f in formats}
    for name in ("grade","fraction","evidence","related"):
        getattr(pool,name).cache_clear()
    PREV["matrix"].cache_clear()
    return qs,results


def paired(rows, old, qs):
    v = STUDY["paired"](old,rows,qs)
    return dict(before=v["html"],after=v["markdown"],delta=v["delta"],gained=v["gained"],lost=v["lost"],paired95pp=v["paired95pp"])


def external_docs(version):
    docs = []
    for i,d in enumerate(json.loads((ROOT/"external-html.json").read_bytes())):
        stem = ROOT/version/"external-html"/str(i)
        ix = PREV["zipped"](stem.with_suffix(".json.gz"))
        assert ix["id"]==d["id"] and ix["sourceHash"]==STUDY["hashlib"].sha256(d["source"].encode()).hexdigest()
        ordinal = EV.ordinals(d["source"])
        for v in ix["views"]:
            v["ink"] = EV.union((ordinal[a],ordinal[b]) for a,b in v["ranges"])
            v["size"],v["length"] = EV.size(v["ink"]),EV.size(v["raw"])
            assert 0<v["tokens"]<=512 and v["size"]
        docs.append(dict(id=d["id"],domain="external",ix=ix,o=ordinal,file=stem.with_suffix(".f32")))
    return docs


def main():
    study, rates, intervals = {}, {}, {}
    for fold in ("development","confirmation"):
        study[fold], rates[fold] = {}, {}
        for agency in STUDY["AGENCIES"]:
            key = f"government-{fold}-reviewed-{agency}-html"
            docs = STUDY["load_collection"](key,ROOT/"current")
            qs,formats = run(docs,("html","markdown"))
            archived = ARCHIVE["collections"][fold][agency]
            assert qs==archived["questions"]
            for p in PROFILES:
                assert formats["markdown"][p]["rows"]==archived["formats"]["markdown"][p]["rows"],(fold,agency,p)
            study[fold][agency] = dict(questions=qs,documents=len(docs),formats=formats,
                paired={f:{p:paired(formats[f][p],archived["formats"][f][p],qs) for p in PROFILES} for f in formats})
        for f in ("html","markdown"):
            rates[fold][f] = {}
            for p in PROFILES:
                rows = [np.array(g["formats"][f][p]["rows"]) for g in study[fold].values()]
                rates[fold][f][p] = np.vstack(rows).mean(axis=0).tolist()
            print(fold,f,[(p,[round(100*v,2) for v in r[:3]]) for p,r in rates[fold][f].items()],flush=True)
        draws, sizes = [], []
        for j,(agency,g) in enumerate(study[fold].items()):
            qs = [("agency",q[0],q[1]) for q in g["questions"]]
            weights = PREV["bootstrap_weights"](qs,{"agency":list(range(len(qs)))})
            before = ARCHIVE["collections"][fold][agency]["formats"]["html"]["semachunk"]["rows"]
            after = g["formats"]["html"]["semachunk"]["rows"]
            diff = np.asarray(after)[:,:2]-np.asarray(before)[:,:2]
            draws.append((weights@diff)[np.random.default_rng(8743+j).permutation(len(weights))])
            sizes.append(len(qs))
        intervals[fold] = (100*np.quantile(np.average(draws,axis=0,weights=sizes),[.025,.975],axis=0).T).tolist()
    original = STUDY["OLD"]
    aid = study["confirmation"]["studentaid"]
    ids = [q[:2] for q in aid["questions"]]
    outcomes = original["folds"]["confirmation"]["pairedOutcomes"]
    indices = [i for i,q in enumerate(outcomes["questionIds"]) if q[0]=="government"]
    assert [outcomes["questionIds"][i][1:] for i in indices]==ids
    before = np.asarray(outcomes["profiles"]["semachunk"])[indices]
    after = np.asarray(aid["formats"]["html"]["semachunk"]["rows"])[:,:4]
    assert np.array_equal(before,np.asarray(ARCHIVE["collections"]["confirmation"]["studentaid"]["formats"]["html"]["semachunk"]["rows"])[:,:4])
    full = (np.asarray(original["validation"]["semachunk"])+(after-before).mean(axis=0)/21).tolist()
    result = dict(metrics=STUDY["METRICS"],government=study,rates=rates,paired95pp=intervals,validation=full,
                  previousValidation=original["validation"]["semachunk"])
    result["verifiedNonHtml"] = json.loads((ROOT/"control-counts.json").read_bytes())
    assert result["verifiedNonHtml"]["documents"] == 174
    ext = {}
    vectors = {}
    for version in ("legacy","current"):
        docs = external_docs(version)
        for d in docs:
            matrix=np.memmap(d["file"],dtype="<f4",mode="r").reshape(-1,1536)
            for q in d["ix"]["qs"]:
                row=matrix[q["v"]].tobytes()
                if version=="legacy": vectors[d["id"],q["id"]] = row
                else: assert vectors[d["id"],q["id"]]==row
        qs,formats = run(docs,("html",))
        ext[version] = formats["html"]
        if version=="legacy": ext["questions"]=qs
        else: assert qs==ext["questions"]
    ext["paired"] = {p:paired(ext["current"][p],ext["legacy"][p],qs) for p in PROFILES}
    result["external"] = ext
    STUDY["BENCH"]["PLACEMENT"]["packed"](RESULT,result)
    print("Full validation",full,flush=True)


if __name__=="__main__":
    main()
