"""Select development settings, compare them on confirmation, or inspect full passages."""
import argparse
import collections
import gzip
import hashlib
import json
import random
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STORE = HERE / ".cache/prose-thresholds"
RESULTS = HERE / "results"
STEM = "2026-11-27-prose-threshold"
DOMAINS = ["papers", "faq", "government", "finance"]
FIELDS = ["first", "five", "firstF1", "recall5", "firstFullRank", "bestRank", "bestRecall",
          "pool", "firstTokens", "fiveTokens", "firstId", "topIds", "firstSimilarity",
          "completeFirstChoices", "bestF1InFive", "completePrefix"]


def read(path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf8") as stream:
            return json.load(stream)
    return json.loads(path.read_bytes())


def save(name, value):
    (RESULTS / (STEM + "-" + name + ".json")).write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf8", newline="\n")


def load(fold, low=False):
    edition = read(RESULTS / "2026-11-27-prose-reviewed-data.json")
    rows = []
    for key, meta in edition["sets"].items():
        if key.split("-")[1] == fold:
            row = read(STORE / (key + (".low" if low else "") + ".scores.gz"))
            assert row["version"] == 2
            assert row["key"] == key and row["dataSHA256"] == meta["sha256"]
            # Unchanged shards remain reusable across corrections to other domains.
            rows.append(row)
    return rows


def extended(rows, extra):
    for r, lo in zip(rows,extra,strict=True):
        assert r["key"]==lo["key"] and r["dataSHA256"]==lo["dataSHA256"]
        r["extensionSHA256"]=lo["protocolSHA256"]
        r["stats"].update({m:v for m,v in lo["stats"].items() if m not in r["stats"]})
        for q, more in zip(r["queries"],lo["queries"],strict=True):
            assert (q["id"],q["text"])==(more["id"],more["text"])
            q["shortestByChoice"]=[min((n for n in pair if n is not None),default=None)
                                   for pair in zip(q["shortestByChoice"],more["shortestByChoice"],strict=True)]
            for m,v in more["methods"].items():
                if m in q["methods"]:
                    # IDs are local to each run, but scores, ranks and sizes of the structural controls are identical.
                    old=q["methods"][m]
                    assert old[:10]+old[12:]==v[:10]+v[12:],(q["id"],m)
                else:
                    q["methods"][m]=v
    return rows


def summarize(rows):
    grouped = {d: [r for r in rows if r["key"].startswith(d+"-")] for d in DOMAINS}
    metrics = {}
    for name in rows[0]["stats"]:
        domains = {}
        for d, shards in grouped.items():
            vs = [q["methods"][name] for r in shards for q in r["queries"]]
            n = len(vs)
            domains[d] = dict(n=n, first=sum(v[0] for v in vs)/n, five=sum(v[1] for v in vs)/n,
                firstF1=statistics.mean(v[2] for v in vs), recall5=statistics.mean(v[3] for v in vs),
                possible1=sum(v[4]>0 for v in vs)/n, exhausted=sum(v[7]<=5 for v in vs)/n,
                medianFirstTokens=statistics.median(v[8] for v in vs), meanFiveTokens=statistics.mean(v[9] for v in vs),
                chunks=sum(r["stats"][name]["count"] for r in shards),
                short=sum(r["stats"][name]["short"] for r in shards))
        metrics[name] = {"domains":domains,"macro":{k:statistics.mean(v[k] for v in domains.values())
                         for k in ("first","five","firstF1","recall5","possible1","exhausted")}}
    return metrics


def nominees(scores):
    choice = {}
    for family in ("all","blocks","semantic"):
        allowed = [m for m in scores if family == "all" or (family == "blocks") == m.endswith("/blocks")]
        for metric in ("five","firstF1"):
            ordering = lambda m: (-scores[m]["macro"][metric],not m.startswith("ordinary/"),
                                   not m.endswith("/blocks"),list(scores).index(m))
            choice[family+"-"+metric] = min(allowed, key=ordering)
    return choice


def compare(rows, a, b):
    grouped = collections.defaultdict(lambda:collections.defaultdict(list))
    result = {}
    for d in DOMAINS:
        pairs = []
        same = 0
        longer = [0,0]
        for r in rows:
            if not r["key"].startswith(d+"-"):
                continue
            for q in r["queries"]:
                x,y=q["methods"][a],q["methods"][b]
                pairs.append((x,y))
                shared=set(x[13]) & set(y[13])
                if shared:
                    same+=1
                    shortest=min(q["shortestByChoice"][j] for j in shared)
                    for i,v in enumerate((x,y)):
                        longer[i]+=v[8]>=2*shortest and v[8]>=shortest+64
                grouped[d][q["cluster"]].append((x[0]-y[0],x[1]-y[1],x[2]-y[2]))
        common = [(x,y) for x,y in pairs if min(x[7],y[7])>5]
        wins = [(x,y) for x,y in pairs if x[0] and y[0]]
        result[d] = {"q":len(pairs), "wins5":sum(x[1]>y[1] for x,y in pairs),
            "sameCitationFirst":same,"firstWithShorterEquivalent":longer,
            "losses5":sum(x[1]<y[1] for x,y in pairs), "nonExhaustedQuestions":len(common),
            "nonExhaustedComplete5":[sum(p[j][1] for p in common) for j in (0,1)],
            "bothFirstComplete":len(wins),"medianTokensBothFirst":[statistics.median(p[j][8] for p in wins) if wins else None for j in (0,1)]}
    # Paired resampling of original source groups, with the four domain means equally weighted.
    rng = random.Random(49261)
    source_sums = [[(len(q),*[sum(v[i] for v in q) for i in range(3)]) for q in g.values()] for g in grouped.values()]
    draws = [[],[],[]]
    for _ in range(4000):
        means = [0.,0.,0.]
        for group in source_sums:
            sample = rng.choices(group,k=len(group))
            n,*sums = map(sum,zip(*sample))
            for i,total in enumerate(sums):
                means[i] += total/(n*len(source_sums))
        for i in range(3):
            draws[i].append(means[i])
    return {"methods":[a,b],"domains":result,"paired95":{k:[sorted(ds)[99],sorted(ds)[3899]]
            for k,ds in zip(("first","five","firstF1"),draws)}}


def case_table(rows, locked):
    previous=read(RESULTS/"2026-11-27-prose-reader-review.json")
    reviewed={c["id"]:c for c in previous["cases"]}
    extra={
        "ffeb67a61ecd09542b1c53c3e4c3abd4da0496a8":"Define concepts as nodes and relationships as edges.",
        "18c5d366b1da8447b5404eab71f4cc658ba12e6f":"Name all three models and distinguish the baselines.",
        "vue-30":"Name Single-File Components and the Composition API, with what each enables.",
        "financebench_id_01476":"Give both the previous and revised EPS growth forecasts.",
        "financebench_id_00882":"Identify the distinct 364-day and five-year facilities and both amounts.",
        "6844683935d0d8f588fa06530f5068bf3e1ed0c0":"Keep the missing word-context pair with its consequence for PMI. The pronoun alone has no antecedent.",
        "pnpm-1":"Either explain the hard links or show that a project and its store share the same physical megabyte.",
        "6aa87439768c9874aad16a861e8800cd":"Give the actual qualifying conditions or identify the covered groups and service connection.",
        "financebench_id_00606":"Identify the reported fiscal period and distinguish the higher payroll rate from the lower overall SG&A rate."
    }
    clarified={"f4496316ddd35ee2f0ccc6475d73a66abf87b611":"Identify the entity-relatedness benchmark and its CoNLL 2003 source.",
               "032ec9574501c5213a995bb17ba91c20":"Identify the loan servicer as the starting point for making a payment."}
    methods=list(dict.fromkeys(["ordinary/256/blocks","sections/256/blocks",locked["semantic-firstF1"],
                                "sections/256/0.4",locked["semantic-five"]]))
    case_rows={}
    packet={}
    for row in rows:
        qs=[q for q in row["queries"] if q["id"] in reviewed or q["id"] in extra]
        if not qs:
            continue
        indexes={}
        for q in qs:
            qid=q["id"]
            c=reviewed.get(qid,{})
            notes={v["textSHA256"]:v["judgment"] for v in c.get("candidates",{}).values()}
            metrics={}
            for m in methods:
                val=q["methods"][m]
                low=m.split("/")[-1] in ("-1","0","0.05")
                if low not in indexes:
                    indexes[low]=read(STORE/(row["key"]+(".low" if low else "")+".json.gz"))
                data=indexes[low]
                passage=data["passages"][val[10]]
                text=data["texts"][passage["v"]]
                digest=hashlib.sha256(text.encode()).hexdigest()
                metrics[m]=dict(completeFirst=val[0],completeFive=val[1],firstF1=val[2],tokens=val[8],
                    firstSimilarity=val[12],firstCompletePassageRank=val[4] or None,
                    completePrefix=val[15],source=data["documents"][passage["doc"]]["id"],textSHA256=digest)
                if digest in notes and c.get("question")==q["text"]:
                    metrics[m]["priorExactPassageReview"]=notes[digest]
                packet.setdefault(qid,{})[digest]=text
            case_rows[qid]=dict(domain=row["key"].split("-")[0],fold=row["key"].split("-")[1],question=q["text"],source=q["doc"],
                ideal=clarified.get(qid,c.get("ideal",extra.get(qid))),shortestCompleteTokens=min((n for n in q["shortestByChoice"]
                    if n is not None),default=None),methods=metrics)
    assert len(case_rows)==len(reviewed)+len(extra)
    save("cases",case_rows)
    (STORE/"case-texts.json").write_text(json.dumps(packet,ensure_ascii=False),encoding="utf8")


def diagnostics(folds):
    edition=read(RESULTS/"2026-11-27-prose-reviewed-data.json")
    with gzip.open(RESULTS/"2026-11-27-prose-traces.jsonl.gz","rt",encoding="utf8") as stream:
        old={q["id"]:q for line in stream for q in json.loads(line)["queries"]}
    result={}
    for fold,rows in folds.items():
        domains={}
        for d in DOMAINS:
            shards=[r for r in rows if r["key"].startswith(d+"-")]
            qs=[q for r in shards for q in r["queries"]]
            oracle={}
            for mode in ("ordinary","sections"):
                for cap in (256,512,"unlimited"):
                    prefix=f"{mode}/{cap}/"
                    choices=[m for m in qs[0]["methods"] if m.startswith(prefix) and not m.endswith("/blocks")]
                    bounds=collections.Counter()
                    for q in qs:
                        block=q["methods"][prefix+"blocks"]
                        five=[q["methods"][m][1] for m in choices]
                        bounds["someThresholdCompleteFive"]+=max(five)
                        bounds["everyThresholdCompleteFive"]+=min(five)
                        bounds["blocksMissSomeSemanticWins"]+=(not block[1] and max(five))
                        bounds["blocksWinAllSemanticMiss"]+=(block[1] and not max(five))
                    oracle[prefix]=dict(bounds)
            layout_equal=collections.Counter()
            edits=collections.Counter()
            heading_cuts={}
            for cutoff in ("0.05","0.1","0.4"):
                paired=[(q["methods"]["sections/256/blocks"],q["methods"]["sections/256/"+cutoff]) for q in qs]
                losses=[(b,s) for b,s in paired if b[1] and not s[1]]
                heading_cuts[cutoff]={
                    "gainedCompleteAtFive":sum(s[1]>b[1] for b,s in paired),
                    "lostCompleteAtFive":len(losses),
                    "lossesWithCompletePassageElsewhere":sum(bool(s[4]) for _,s in losses),
                    "lossesWhereNoSinglePassageStillCoversEvidence":sum(bool(b[4]) and not s[4] for b,s in losses),
                    "lossesWithSomeEvidenceInFive":sum(s[3]>0 for _,s in losses)}
            paper_units={}
            if d=="papers":
                unchanged=[q for r in shards for q in r["queries"] if q["id"] not in edition["sets"][r["key"]]["revised"]]
                for label,group in (("one",[q for q in unchanged if old[q["id"]]["sourceSentences"]==1]),
                                    ("twoOrMore",[q for q in unchanged if old[q["id"]]["sourceSentences"]>=2])):
                    paper_units[label]={"questions":len(group),"methods":{}}
                    for strategy in ("blocks","0.05","0.1","0.4"):
                        hits=[q["methods"]["sections/256/"+strategy] for q in group]
                        paper_units[label]["methods"][strategy]=dict(completeFirst=sum(v[0] for v in hits),
                            completeFive=sum(v[1] for v in hits))
            for r in shards:
                low=read(STORE/(r["key"]+".low.json.gz"))
                for name,per_doc in low["plans"].items():
                    mode,cap,strat=name.split("/")
                    if strat!="blocks":
                        controls=low["plans"][f"{mode}/{cap}/blocks"]
                        layout_equal[name]+=sum(a==b for a,b in zip(per_doc,controls,strict=True))
                for q in r["queries"]:
                    if q["id"] not in edition["sets"][r["key"]]["revised"]:
                        continue
                    prior=old[q["id"]]
                    if (prior["text"]!=q["text"] or q["doc"] in
                        ("PEPSICO_2023Q1_EARNINGS","JOHNSON_JOHNSON_2022Q4_EARNINGS")):
                        continue
                    edits["identicalQueryAndSource"]+=1
                    rank=prior["methods"]["blocks"]["prefix"] or float("inf")
                    hit=q["methods"]["ordinary/256/blocks"]
                    for j,k in enumerate((1,5)):
                        edits[f"oldMissNowHit{k}"]+=rank>k and bool(hit[j])
                        edits[f"oldHitNowMiss{k}"]+=rank<=k and not hit[j]
            domains[d]={"questions":len(qs),"docs":sum(len(edition["sets"][r["key"]]["sources"]) for r in shards),
                "perQuestionOracle":oracle,"documentsIdenticalToBlocks":dict(layout_equal),
                "correctedLabelsAtFixedRanking":dict(edits),"heading256Cuts":heading_cuts}
            if paper_units:
                domains[d]["unchangedCitationProseUnits"]=paper_units
        result[fold]=domains
    return result


def report():
    dev = load("development")
    first_lock = read(RESULTS/(STEM+"-nominees.json"))
    assert first_lock["methods"] == nominees(summarize(dev))
    locked = read(RESULTS/(STEM+"-extended-nominees.json"))
    dev = extended(dev,load("development",True))
    dev_scores=summarize(dev)
    assert locked["methods"]==nominees(dev_scores)
    confirm = extended(load("confirmation"),load("confirmation",True))
    scores = summarize(confirm)
    case_table(dev+confirm,locked["methods"])
    pairs = [(locked["methods"][f"semantic-{key}"],locked["methods"][f"blocks-{key}"])
             for key in ("five","firstF1")]
    pairs += [(m, "ordinary/256/blocks") for m in locked["methods"].values() if m!="ordinary/256/blocks"]
    for m in set(locked["methods"].values()):
        section, cap, strat=m.split("/")
        if section=="sections":
            pairs.append((m,"ordinary/"+cap+"/"+strat))
        if strat!="blocks":
            pairs.append((m,section+"/"+cap+"/blocks"))
    for key,m in first_lock["methods"].items():
        if m!=locked["methods"][key]:
            pairs.append((locked["methods"][key],m))
    # Descriptive comparison for the small positive cutoff in the extended sweep.
    pairs.append(("sections/256/0.05","sections/256/blocks"))
    comparisons=[compare(confirm,a,b) for a,b in dict.fromkeys(pairs) if a!=b]
    archive = RESULTS/(STEM+"-outcomes.jsonl.gz")
    payload = "".join(json.dumps(r,ensure_ascii=False,separators=(",",":"))+"\n" for r in dev+confirm).encode()
    archive.write_bytes(gzip.compress(payload,mtime=0))
    save("results",dict(development=dev_scores,confirmation=scores,comparisons=comparisons,fields=FIELDS,
        nominees=locked["methods"],originalNominees=first_lock["methods"],
        archiveSHA256=hashlib.sha256(archive.read_bytes()).hexdigest()))
    save("diagnostics",diagnostics({"development":dev,"confirmation":confirm}))


def inspect(qid, names):
    for path in (p for p in STORE.glob("*.scores.gz") if not p.name.endswith(".low.scores.gz")):
        row=read(path)
        for q in row["queries"]:
            if q["id"] != qid:
                continue
            data_by_run={}
            print(q["text"])
            for m in names:
                suffix="" if m in q["methods"] else ".low"
                if suffix not in data_by_run:
                    data_by_run[suffix]=read(STORE/(row["key"]+suffix+".json.gz"))
                data=data_by_run[suffix]
                if suffix:
                    low=read(STORE/(row["key"]+suffix+".scores.gz"))
                    out=next(v for v in low["queries"] if v["id"]==qid)["methods"][m]
                else:
                    out=q["methods"][m]
                print(m, "first / five",out[:2],"first F1",out[2],"first full rank",out[4])
                for i in out[11]:
                    p=data["passages"][i]
                    print(data["documents"][p["doc"]]["id"],p["tokens"],"tokens")
                    print(data["texts"][p["v"]])
            return
    raise SystemExit("Unknown question")


def plot():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D

    scores=read(RESULTS/(STEM+"-results.json"))["confirmation"]
    thresholds=[0,.05,*read(HERE/"prose-threshold-protocol.json")["thresholds"]]
    fig,axes=plt.subplots(2,2,figsize=(10,6),sharex=True,sharey="row",layout="constrained")
    colors=["#006f65","#a84d0b","#6251a2"]
    for col,(mode,title) in enumerate([("ordinary","Ordinary hierarchy"),("sections","Headings kept with sections")]):
        axes[0,col].set_title(title,loc="left",fontweight="bold")
        for row,(metric,label) in enumerate([("five","Complete citation in five hits (%)"),("firstF1","First-hit evidence F1 (×100)")]):
            ax=axes[row,col]
            for cap,color in zip(["256","512","unlimited"],colors):
                series=[100*scores[f"{mode}/{cap}/{t}"]["macro"][metric] for t in thresholds]
                ax.plot(thresholds,series,marker="o",markersize=3.7,color=color,linewidth=2)
                ax.axhline(100*scores[f"{mode}/{cap}/blocks"]["macro"][metric],color=color,linestyle="--",linewidth=1)
            ax.set_xticks(thresholds,["0",".05",".10",".15",".20",".25",".30",".40",".55",".70"],fontsize=8)
            ax.grid(axis="y",alpha=.22)
            ax.spines[["top","right"]].set_visible(False)
            if col==0: ax.set_ylabel(label)
            if row==1: ax.set_xlabel("Semantic similarity cutoff")
    handles=[Line2D([],[],color=c,label=l,linewidth=2) for c,l in zip(colors,["256 tokens","512 tokens","Unlimited"])]
    handles.extend([Line2D([],[],color="#333333",label="Semantic-blocks"),Line2D([],[],color="#333333",ls="--",label="Blocks")])
    fig.legend(handles=handles,loc="outside lower center",ncol=5,frameon=False,fontsize=9)
    fig.suptitle("Answer retrieval across fixed thresholds",fontweight="bold",fontsize=16)
    fig.savefig(RESULTS/(STEM+"-curves.png"),dpi=160,facecolor="white")
    plt.close(fig)


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["select","select-low","report","inspect","plot"])
    parser.add_argument("items",nargs="*")
    args=parser.parse_args()
    if args.action in ("select","select-low"):
        dev=load("development")
        if args.action=="select-low":
            dev=extended(dev,load("development",True))
        save("extended-nominees" if args.action=="select-low" else "nominees",
             dict(methods=nominees(summarize(dev)),fold="development",extensionSHA256=dev[0].get("extensionSHA256"),
             protocolSHA256=dev[0]["protocolSHA256"],
             editionSHA256=read(RESULTS/"2026-11-27-prose-reviewed-data.json")["correctionSHA256"]))
    elif args.action=="report":
        report()
    elif args.action=="plot":
        plot()
    else:
        inspect(args.items[0],args.items[1:] or ["ordinary/256/blocks"])
