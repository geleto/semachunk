"""Recover headings with source evidence and audit suspicious paragraph breaks before retrieval."""
import bisect,collections,json,re,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent;CACHE=HERE/".cache";ROOT=CACHE/"context-mixtures/data";OUT=CACHE/"scope-weights"
def utf(s):return len(s.encode("utf-16-le"))//2
def visible(s):return "".join(s.split())
def starts(s):return [0]+[m.end() for m in re.finditer(r"\n\s*\n",s)]
def fed_heading(s):
    return bool(re.match(r"^(Annual Organizational Matters|Developments in Financial Markets|Long(?:er)?[-– ]Run Monetary Policy|Staff (?:Review|Economic Outlook)|Participants[’'] Views|Committee Policy Action|Notation Vote|Review of Monetary Policy)",s,re.I))
def main():
    OUT.mkdir(exist_ok=True,parents=True)
    registry=json.loads((ROOT/"manifest.json").read_bytes());external={};audit=[];metrics=collections.defaultdict(collections.Counter)
    with zipfile.ZipFile(CACHE/"doc2dial-v1.0.1.zip") as archive:gov=json.loads(archive.read("doc2dial_doc.json"))["doc_data"]
    government={k:v for by_agency in gov.values() for k,v in by_agency.items()}
    for key,meta in registry.items():
        external[key]=[]
        for doc in json.loads((ROOT/(key+".json")).read_bytes())["docs"]:
            s=doc["source"];st=starts(s);ps=re.split(r"\n\s*\n",s);assert len(ps)==len(st)
            domain=meta["domain"];id=doc["id"];head=[];origin="parser";flags=[]
            if doc["format"]=="text":
                origin="none"
                if domain=="government" and id in government:
                    # The flat release and the normalized benchmark use identical nonwhitespace text.
                    d=government[id];raw=d["doc_text"];assert visible(raw)==visible(s)
                    native=[i for i,c in enumerate(raw) if not c.isspace()];norm=[i for i,c in enumerate(s) if not c.isspace()]
                    for t in d["spans"].values():
                        if re.fullmatch("h[1-6]",t["tag"]) and t["text_sp"].strip():
                            i=bisect.bisect_left(native,t["start_sp"]);head.append([utf(s[:norm[i]]),int(t["tag"][1])])
                    origin="original HTML heading spans"
                if domain=="boards":
                    for a,p in zip(st,ps):
                        match=re.match(r"^(\d+(?:\.\d+)*)\s+[A-Z]",p)
                        if id.startswith("psf") and match and len(p)<150:head.append([utf(s[:a]),1+match[1].count(".")])
                        elif id.startswith("fed") and fed_heading(p):head.append([utf(s[:a]),1])
                    origin="numbered agenda or named Fed agenda headings"
                if id in ("letter77","letter83"):
                    sections={"Textile Operations","Insurance Underwriting","Insurance Investments","Banking","Blue Chip Stamps","Nebraska Furniture Mart","Corporate Performance","Sources of Reported Earnings","Buffalo Evening News","See’s Candy Shops","Insurance - Controlled Operations","Insurance - GEICO","Stock Splits and Stock Activity","Miscellaneous","Appendix","Goodwill and its Amortization: The Rules and The Realities"}
                    head=[[utf(s[:a]),2 if p.startswith("Goodwill and its Amortization") else 1] for a,p in zip(st,ps) if p in sections]
                    origin="shareholder letter section titles"
            for i,(left,right) in enumerate(zip(ps,ps[1:])):
                a=re.sub(r"^#{1,6}\s+","",left).strip();b=re.sub(r"^#{1,6}\s+","",right).strip()
                if 32<=len(a)<=135 and "\n" not in a and "|" not in a and re.search("[A-Za-z,]$",a) and re.match("[a-z]",b):
                    flags.append([i,a[-65:],b[:65]])
            counts=metrics[domain];counts["documents"]+=1;counts["flaggedDocuments"]+=bool(flags);counts["flags"]+=len(flags)
            if flags:audit.append(dict(key=key,id=id,possibleBreaks=len(flags),examples=flags[:3]))
            external[key].append(dict(id=id,origin=origin,headings=sorted(set(map(tuple,head)))))
    (OUT/"source-headings.json").write_text(json.dumps(external,ensure_ascii=False),encoding="utf8")
    (HERE/"results/2026-11-27-scope-weights-source-audit.json").write_text(json.dumps(dict(counts=metrics,candidates=audit),ensure_ascii=False,indent=2)+"\n",encoding="utf8")
if __name__=="__main__":main()
