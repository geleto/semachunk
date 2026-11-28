"""Paired HTML and Turndown retrieval on the reviewed Doc2Dial government pages."""
import collections
import hashlib
import json
import runpy
from pathlib import Path

import numpy as np

HERE=Path(__file__).resolve().parent
BENCH=runpy.run_path(str(HERE/"mastra-comparison.py"))
PRIOR,LIB,EV=BENCH["PRIOR"],BENCH["LIB"],BENCH["EV"]
ROOT=HERE/".cache/html-markdown"
OLD=PRIOR["zipped"](HERE/"results/2026-11-27-mastra-comparison.json.gz")
EDITION=json.loads((HERE/"results/2026-11-27-prose-reviewed-data.json").read_bytes())
RESULT=HERE/"results/2026-11-28-html-markdown.json.gz"
AGENCIES=("studentaid","dmv","ssa","va")
PROFILES={
    "semachunk":[("blocks","structure"),("semantic","structure-near")],
    "mastra-recursive":[("recursive/512/25","native")],
    "mastra-format":[("format/512/0","native")],
    "mastra-enhanced":[("format/512/0","structure-near")],
    "mastra-pair":[("format/512/0","structure-near"),("sentence/512/0","structure-near")],
    "semachunk-core-ranking":[("blocks","context"),("semantic","context")],
    "semachunk-paragraph-ranking":[("blocks","paragraph"),("semantic","paragraph")],
    "semachunk-section-ranking":[("blocks","section"),("semantic","section")],
    "semachunk-hierarchy-ranking":[("blocks","structure"),("semantic","structure")],
    "semachunk-blocks":[("blocks","structure")],
}
METRICS=("first","five","evidenceF1","firstTokens","correctSourceFirst","anyCompleteCandidate","wholeSourceFirst","firstSourceFraction")


def load_collection(key, root=ROOT):
    raw=(HERE/".cache/prose-reviewed"/(key+".json")).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==EDITION["sets"][key]["sha256"]
    docs=[]
    for i,source in enumerate(json.loads(raw)):
        stem=root/key/str(i)
        ix=PRIOR["zipped"](stem.with_suffix(".json.gz"))
        assert ix["id"]==source["id"] and hashlib.sha256(source["source"].encode()).hexdigest()==ix["sourceHash"]
        ordinal=EV.ordinals(source["source"])
        for v in ix["views"]:
            v["ink"]=EV.union((ordinal[a],ordinal[b]) for a,b in v["ranges"])
            v["size"]=EV.size(v["ink"])
            v["length"]=EV.size(v["raw"])
            assert 0<v["tokens"]<=512 and v["length"]>0
        docs.append(dict(id=ix["id"],domain=key,ix=ix,o=ordinal,file=stem.with_suffix(".f32")))
    return docs


def score_pool(pool,format,profiles):
    features=collections.defaultdict(set)
    for profile in profiles:
        for layout,treatment in PROFILES[profile]:
            features[layout].add(treatment)
    scores={}
    for layout,treatments in features.items():
        label=format+"/"+layout
        for t,pair in BENCH["scores_for"](pool,label,treatments-{"paragraph","section"}).items():
            scores[layout,t]=pair
        if "paragraph" in treatments or "section" in treatments:
            f=PRIOR["Features"](pool,label)
            scores[layout,"paragraph"]=(.5*(f.core+f.paragraph),f.win)
            scores[layout,"section"]=(.85*f.core+.15*np.where(f.has_sec,f.section,f.core),f.win)
    owners=np.array(pool.owners)
    results={}
    owner_ids={d["id"]:i for i,d in enumerate(pool.docs)}
    for profile in profiles:
        arms=PROFILES[profile]
        values,views=zip(*(scores[a] for a in arms))
        matrix=np.concatenate(values,axis=1);windows=np.concatenate(views)
        source_order=np.argsort(owners[windows],kind="stable")
        matrix,windows=matrix[:,source_order],windows[source_order]
        ranked=np.argsort(-matrix,axis=1,kind="stable")
        raw=len(arms)==1 and arms[0][1]=="native"
        observed=[];ranks=[];hits=[]
        for qi,order in enumerate(ranked):
            shown=tuple(int(v) for v in windows[order[:5]]) if raw else PRIOR["distinct"](pool,windows,order,.75)
            first,five,f1,tokens,_,whole=pool.grade(qi,shown)
            owner=pool.docs[owners[shown[0]]]["id"]
            refs=pool.refs[qi];eligible_sources={owner_ids[source] for source,_ in refs}
            candidates=windows[order]
            found=None
            for rank in np.flatnonzero(np.isin(owners[candidates],list(eligible_sources))):
                v=int(candidates[rank])
                masks=pool.evidence(qi,v)
                if any(mask.bit_count()==EV.size(ref) for mask,(_,ref) in zip(masks,refs)):
                    found=int(rank)+1
                    break
            assert bool(first)==(found==1)
            fraction=pool.views[shown[0]]["size"]/pool.docs[owners[shown[0]]]["o"][-1]
            observed.append([first,five,f1,tokens,int(owner_ids[owner] in eligible_sources),int(found is not None),whole,fraction])
            ranks.append(found)
            vr=pool.views[shown[0]]["ranges"]
            hits.append([owner,[vr[0][0],vr[-1][1]] if vr else []])
        core_sizes=[];window_sizes=[]
        for d in pool.docs:
            for l,t in arms:
                for c in d["ix"]["layouts"][format+"/"+l]:
                    core_sizes.append(d["ix"]["views"][c["bare"]]["tokens"])
                    window_sizes.append(d["ix"]["views"][c["bare" if t=="native" else "win"]]["tokens"])
        results[profile]=dict(rows=observed,rankOfFirstComplete=ranks,topSourceAndOuterBounds=hits,
                              candidates=len(windows),medianCore=float(np.median(core_sizes)),
                              meanCandidateTokens=float(np.mean(window_sizes)),medianCandidateTokens=float(np.median(window_sizes)))
    return results


def paired(html,md,questions):
    a,b=np.asarray(html["rows"]),np.asarray(md["rows"])
    delta=b-a
    cluster=PRIOR["bootstrap_weights"]([("agency",q[0],q[1]) for q in questions],{"agency":list(range(len(questions)))})
    ci=100*np.quantile(cluster@delta[:,:2],[.025,.975],axis=0).T
    return dict(html=a.mean(axis=0).tolist(),markdown=b.mean(axis=0).tolist(),delta=delta.mean(axis=0).tolist(),
                paired95pp=ci.tolist(),gained=(delta[:,:2]>0).sum(axis=0).tolist(),lost=(delta[:,:2]<0).sum(axis=0).tolist(),
                gainedFirstWithFullHtmlCandidate=int(((delta[:,0]>0)&(a[:,5]==1)).sum()),
                lostFirstWithFullMarkdownCandidate=int(((delta[:,0]<0)&(b[:,5]==1)).sum()))


def summarize(fold,agency):
    key="government-"+fold+"-reviewed-"+agency+"-html"
    docs=load_collection(key)
    pool=LIB["Pool"](docs,stream_vectors=True)
    qs=[[d["id"],q["id"],q["text"]] for d,q in pool.qs]
    modes={f:score_pool(pool,f,PROFILES) for f in ("html","markdown")}
    modes["text"]=score_pool(pool,"text",["semachunk","semachunk-core-ranking"])
    trees={}
    for f in ("html","markdown","text"):
        counts=collections.Counter()
        for d in docs: counts.update(d["ix"]["tree"][f])
        trees[f]=dict(counts)
    source_hashes={d["id"]:{k:d["ix"][k] for k in ("htmlHash","sourceHash","markdownHash")} for d in docs}
    report=dict(documents=len(docs),sourceHashes=source_hashes,questions=qs,trees=trees,formats=modes,
                comparisons={p:paired(modes["html"][p],modes["markdown"][p],qs) for p in PROFILES})
    if agency=="studentaid":
        old=OLD["folds"][fold]["pairedOutcomes"]
        ids=[j for j,(domain,*_) in enumerate(old["questionIds"]) if domain=="government"]
        assert [old["questionIds"][j][1:] for j in ids]==[q[:2] for q in qs]
        for profile,label in (("semachunk","semachunk"),("mastra-recursive","native"),("mastra-enhanced","enhanced"),("mastra-pair","two")):
            assert np.array_equal(np.array(modes["html"][profile]["rows"])[:,:4],np.array(old["profiles"][label])[ids])
        html=np.asarray(modes["html"]["semachunk"]["rows"]);md=np.asarray(modes["markdown"]["semachunk"]["rows"])
        rival=np.asarray(modes["html"]["mastra-recursive"]["rows"])
        cohort=(html[:,0]==0)&(rival[:,0]==1)
        outcomes={}
        for name,mask in (("all",cohort),("htmlCandidateAvailable",cohort&(html[:,5]==1)),("htmlCandidateAbsent",cohort&(html[:,5]==0))):
            outcomes[name]=dict(questions=int(mask.sum()),markdownFirst=int(md[mask,0].sum()),markdownFive=int(md[mask,1].sum()),
                                markdownCandidateAvailable=int(md[mask,5].sum()))
        report["previousMastraOnlyFirstHits"]=outcomes
        if fold=="confirmation":
            assert outcomes["all"]["questions"]==64 and outcomes["htmlCandidateAvailable"]["questions"]==59
    for name in ("grade","fraction","evidence","related"):getattr(pool,name).cache_clear()
    PRIOR["matrix"].cache_clear()
    return report


def main():
    collections_by_fold={f:{a:summarize(f,a) for a in AGENCIES} for f in ("development","confirmation")}
    aggregates={}
    for f,data in collections_by_fold.items():
        aggregate={}
        for profile in PROFILES:
            agency_rates={}
            for label in (("html","markdown","text") if profile in ("semachunk","semachunk-core-ranking") else ("html","markdown")):
                rows=[np.array(d["formats"][label][profile]["rows"]) for d in data.values()]
                agency_rates[label]=dict(equalQuestions=np.vstack(rows).mean(axis=0).tolist(),
                                         equalAgencies=np.mean([v.mean(axis=0) for v in rows],axis=0).tolist())
            draws=[];sizes=[]
            for i,d in enumerate(data.values()):
                q=d["questions"]; weights=PRIOR["bootstrap_weights"]([("agency",t[0],t[1]) for t in q],{"agency":list(range(len(q)))})
                diff=np.asarray(d["formats"]["markdown"][profile]["rows"])[:,:2]-np.asarray(d["formats"]["html"][profile]["rows"])[:,:2]
                draws.append((weights@diff)[np.random.default_rng(8743+i).permutation(len(weights))]);sizes.append(len(q))
            agency_rates["paired95ppEqualQuestions"]=(100*np.quantile(np.average(draws,axis=0,weights=sizes),[.025,.975],axis=0).T).tolist()
            aggregate[profile]=agency_rates
        aggregates[f]=aggregate
    BENCH["PLACEMENT"]["packed"](RESULT,dict(metrics=METRICS,profiles=PROFILES,converter="turndown@7.2.5 + turndown-plugin-gfm@1.0.2",
                                            collections=collections_by_fold,aggregates=aggregates))
    print(RESULT,flush=True)
    for a,group in collections_by_fold["confirmation"].items():
        print(a,len(group["questions"]),{k:[[round(x*100,1) for x in v[fmt][:2]] for fmt in ("html","markdown")]
               for k,v in group["comparisons"].items()},flush=True)


if __name__=="__main__": main()
