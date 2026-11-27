"""Post-result sensitivity edition. Preserve blind scores and use the same cached rankings."""
import gzip,json,runpy,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;m=runpy.run_path(str(HERE/"mixture-data.py"))["m"]
R=HERE/".cache/context-mixtures";dest=R/"audited-data";dest.mkdir(exist_ok=True)
TURNS={
    "qmsum-val-14/7":("replace",[78],"Published turn 89 is an interjection by Hefin David. Williams states her merger policy in turn 78."),
    "qmsum-val-22/11":("replace",[114],"The published range ends at the question. Blaney gives his response in the next turn."),
    "qmsum-val-31/6":("add",[232],"Bains gives the funding amount and purpose in his own turn. The surrounding Nater questions are optional."),
    "qmsum-val-22/9":("add",[103],"Blaney answers the yes/no question and explains reliance on external assessment in one turn."),
    "qmsum-val-14/5":("add",[47],"Williams gives her geographic assessment and the part-time route in her answer."),
    "qmsum-val-11/1":("add",[2],"The minister states both lessons in his response."),
    "qmsum-val-11/5":("add",[24],"The minister gives his capacity judgment and reasoning in his response.")}
TEXT={
    "1333848d61e359b78c9d42740497b4c3":(["Nothing.","We provide dependent coverage at no cost"],"The question asks for the cost. The age condition is additional information."),
    "ebb4db9c24aa36db9954dd65ea079a798df80558":(["PKD-Skip performs slightly better than PKD-Last"],"The direct comparison answers which strategy performed better. The broader paper annotation is also valid.")}
log={}
for path in (R/"data").glob("*-fresh.json"):
    data=json.loads(path.read_bytes())
    for doc in data["docs"]:
        for q in doc["questions"]:
            if q["id"] in TURNS:
                how,ns,reason=TURNS[q["id"]];paras=doc["source"].split("\n\n");rr=[]
                for n in ns:
                    line=paras[n];a=sum(len(p)+2 for p in paras[:n]);rr.append(m.span(doc["source"],a+line.index(":")+2,a+len(line)))
                q["references"]=[rr] if how=="replace" else q["references"]+[rr]
            elif q["id"] in TEXT:
                phrases,reason=TEXT[q["id"]];src=doc["source"];original=q["references"][0];off=src.encode("utf-16-le")
                for phrase in phrases:
                    # Locate the direct answer inside its annotated supporting passage only.
                    hits=[]
                    for a,b in original:
                        s=off[2*a:2*b].decode("utf-16-le")
                        if s.count(phrase)==1:hits.append([a+m.units(s[:s.index(phrase)]),a+m.units(s[:s.index(phrase)])+m.units(phrase)])
                    assert len(hits)==1,(q["id"],phrase);q["references"].append(hits)
            else:continue
            log[q["id"]]=dict(document=doc["id"],question=q["text"],reason=reason,references=q["references"])
    (dest/path.name).write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf8")
assert len(log)==len(TEXT)+len(TURNS)
(HERE/"results/2026-11-27-context-mixtures-citation-audit.json").write_text(json.dumps(log,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
