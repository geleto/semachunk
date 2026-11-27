"""Collect corrected-reference sensitivity, reader judgments and domain-specific comparisons."""
import gzip,json,runpy
from pathlib import Path
import numpy as np
helpers=runpy.run_path(str(Path(__file__).with_name("mixture-analysis.py")))
R,RES,P=helpers["ROOT"],helpers["RESULT"],helpers["PREFIX"]
def gz(p):return json.loads(gzip.decompress(p.read_bytes()))
manifest=json.loads((R/"data/manifest.json").read_bytes());names=json.loads((R/"shortlist.json").read_bytes())
domains={};fields=["completeFirst","completeFive","focus","firstLength"];compact={}
for k,m in manifest.items():
    if m["fold"]!="fresh":continue
    rows=gz(R/"audited-traces"/(k+".json.gz"));original=gz(R/"traces"/(k+".json.gz"))
    assert len(rows)==len(original)
    for a,b in zip(rows,original,strict=True):
        assert a["id"]==b["id"] and a["hits"]==b["hits"]
    mat=np.asarray([[q["metrics"][n] for q in rows] for n in names]);domains[m["domain"]]=(rows,mat)
    compact[m["domain"]]={q["id"]:q["metrics"] for q,b in zip(rows,original) if q["metrics"]!=b["metrics"]}
ds=helpers["summaries"](domains);av=np.stack(list(ds.values())).mean(axis=0)
sel=json.loads((RES/(P+"selections.json")).read_bytes())["methods"]
pairs=[(sel["semantic"][s],sel["structural"][s]) for s in ["five","focus"]]
pairs.extend([("blocks256/child50","blocks256/core"),(sel["structural"]["five"],"blocks256/core")])
aud=dict(fields=fields,macro=dict(zip(names,av.tolist())),domains={d:dict(zip(names,x.tolist())) for d,x in ds.items()},
    comparisons={a+" vs "+b:helpers["paired"](domains,names.index(a),names.index(b)) for a,b in pairs},changedQuestionMetrics=compact)
read={}
for variant in ["reader","reader-audited"]:
    data=gz(RES/(P+variant+".json.gz"));groups={};inversions={};quotes=[]
    for arm in data[0]["results"]:
        groups[arm]={}
        for show in ["core","both","cos40","reader","oracle"]:
            met=[];suff=[];noise=[]
            for q in data:
                x=q["results"][arm][show];met.append([x["first"],x["five"],x["f1"],x["length"]])
                if show!="oracle":
                    grade=q["grounded"][x["passage"]];suff.append(grade["sufficiency"]);noise.append(grade["excess"])
            groups[arm][show]=dict(first=sum(x[0] for x in met),five=sum(x[1] for x in met),focus=np.mean(met,axis=0)[2],length=np.mean(met,axis=0)[3],
                judgedComplete=suff.count(2),judgedMostlyExtraneous=noise.count(2)) if suff else dict(first=sum(x[0] for x in met),five=sum(x[1] for x in met),focus=np.mean(met,axis=0)[2],length=np.mean(met,axis=0)[3])
        inversions[arm]=sum(q["grounded"][q["results"][arm]["core"]["passage"]]["sufficiency"]>q["grounded"][q["results"][arm]["both"]["passage"]]["sufficiency"] for q in data)
    for q in data:quotes.extend(grade["quotesVerified"] for grade in q["grounded"].values() if grade["sufficiency"]>0)
    read[variant]=dict(questions=len(data),uniquePassages=sum(len(q["grounded"]) for q in data),methods=groups,nestedSufficiencyInversions=inversions,gradedWithSupport=len(quotes),quotesExactlyLocated=sum(quotes))
helpers["save"]("sensitivity",dict(audited=aud,readers=read))
