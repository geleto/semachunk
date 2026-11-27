"""Prepare the frozen full-filing retrieval corpus from pinned FinanceBench sources."""
import argparse
import concurrent.futures
import hashlib
import json
import re
import runpy
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache/financebench"
SETS = HERE / ".cache/semantic-settings"
RESULTS = HERE / "results"
MANIFEST = RESULTS / "2026-11-27-full-filings-data.json"
REVIEW = HERE / "financebench-citations.json"
REV = "cc39aeb4afdf33909ee1412188bf89035950c2eb"
ROOT = f"https://raw.githubusercontent.com/patronus-ai/financebench/{REV}"
PDF_MODULE = HERE / "financebench-pdf.py"
OCR_SHA = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
ASSETS = {"financebench_open_source.jsonl": "a5a2aa673e573e55675fc3c0f9aa38c1cf59d2abc91edb077534f71f10a71877",
          "financebench_document_information.jsonl": "1c69127783879de8cdadb159d2181f39bc3123b8e0ebf74031c3969d69189575"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def read(path):
    return json.loads(path.read_text("utf8"))


def fetched(path, url):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(Request(url, headers={"User-Agent": "semachunk-benchmark"}), timeout=120) as response:
            data = response.read()
        tmp = path.with_suffix(".download")
        tmp.write_bytes(data)
        tmp.replace(path)
    return path.read_bytes()


def inputs():
    data = []
    for name, checksum in ASSETS.items():
        raw = fetched(CACHE/name, f"{ROOT}/data/{name}")
        assert sha(raw) == checksum, name
        data.append([json.loads(line) for line in raw.splitlines()])
    return data


def prepare_pdf(job):
    from importlib.metadata import version
    assert version("PyMuPDF") == "1.26.7"
    name, blob, size = job
    pdf = CACHE/"pdfs"/(name+".pdf")
    data = fetched(pdf, f"{ROOT}/pdfs/{quote(pdf.name)}")
    assert len(data) == size and hashlib.sha1(f"blob {size}\0".encode()+data).hexdigest() == blob, name
    checksum = sha(data)
    target = CACHE/"rendered"/(name+".json")
    extractor = sha(PDF_MODULE.read_bytes().replace(b"\r\n", b"\n"))
    if target.exists():
        old = read(target)
        if old["extractor"] == extractor and old["pdfSHA256"] == checksum:
            return
    value = runpy.run_path(str(PDF_MODULE))["extract"](pdf)
    value.update(extractor=extractor, pdfSHA256=checksum)
    target.parent.mkdir(exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(packed(value), encoding="utf8")
    tmp.replace(target)


# Physical-page audit of every page with no native body text in the pinned PDFs.
# These exhibits contain a raster image followed by its searchable transcription.
DUPLICATE_SCANS = {"WALMART_2019_10K": range(90,145,2),
                   "AMERICANWATERWORKS_2021_10K": (151,153,155)}


def scanned_pages(name, doc):
    import pymupdf
    scans = {str(i): {"duplicateOf":i+1} for i in DUPLICATE_SCANS.get(name,())}
    for page, match in scans.items():
        a,b,_,_ = doc["pages"][int(page)-1]
        c,d,_,_ = doc["pages"][match["duplicateOf"]-1]
        assert a == b and c < d
    if name == "AMCOR_2020_10K":
        # Three scanned amendments are unique to this filing. The last page is blank.
        with pymupdf.open(CACHE/"pdfs"/(name+".pdf")) as pdf:
            for i in range(179,188):
                assert doc["pages"][i-1][0] == doc["pages"][i-1][1]
                page = pdf[i-1]
                tp = page.get_textpage_ocr(language="eng",dpi=240,full=True,tessdata=str(CACHE/"tessdata"))
                raw = page.get_text("text",textpage=tp,sort=True)
                paragraphs = [" ".join(p.split()) for p in re.split(r"\n\s*\n",raw)]
                text = "\n\n".join(p for p in paragraphs if p)
                assert len(text) > 200
                scans[str(i)] = {"text":text}
    return scans


def add_scans(doc, scans):
    if not any("text" in v for v in scans.values()):
        return doc
    source, pages, units = [], [], []
    cursor = 0
    for i,(start,end,first,last) in enumerate(doc["pages"],1):
        text = scans.get(str(i),{}).get("text",doc["source"][start:end])
        if i > 1:
            source.append("\n\n")
            cursor += 2
        n = len(units)
        units.extend([a-start+cursor,b-start+cursor,k] for a,b,k in doc["units"][first:last])
        if end == start and text:
            units.append([cursor,cursor+len(text),"text"])
        pages.append([cursor,cursor+len(text),n,len(units)])
        source.append(text)
        cursor += len(text)
    return {**doc,"source":"".join(source),"units":units,"pages":pages}


def render(workers):
    qs, _ = inputs()
    tree = json.loads(fetched(CACHE/"tree.json", f"https://api.github.com/repos/patronus-ai/financebench/git/trees/{REV}?recursive=1"))
    assert tree["sha"] == REV and not tree["truncated"]
    files = {x["path"]: x for x in tree["tree"]}
    jobs = []
    for name in sorted({q["doc_name"] for q in qs}):
        entry = files[f"pdfs/{name}.pdf"]
        jobs.append((name, entry["sha"], entry["size"]))
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
        list(pool.map(prepare_pdf, jobs))
    print(f"Verified and rendered {len(jobs)} PDFs.")


def split_companies(docs):
    types = defaultdict(set)
    for doc in docs:
        types[doc["company"]].add(doc["doc_type"].lower())
    def order(company):
        priority = next((i for i, t in enumerate(("earnings", "8k", "10q")) if t in types[company]), 3)
        return priority, sha(("financebench/v1/"+company).encode())
    return {c: ("development", "confirmation")[i % 2] for i, c in enumerate(sorted(types, key=order))}


def citation(page_rows, evidence_pages, doc):
    spans = []
    for item in page_rows:
        page, selectors = item.split(":")
        page = int(page)
        assert page in evidence_pages, (page, evidence_pages)
        _, _, start, end = doc["pages"][page-1]
        for part in selectors.split(","):
            bounds = list(map(int, part.split("-")))
            lo, hi = bounds[0], bounds[-1]
            assert 1 <= lo <= hi <= end-start
            for a, b, _ in doc["units"][start+lo-1:start+hi]:
                # Markdown table dividers separate cells and carry no source evidence.
                for match in re.finditer(r"[^|]+", doc["source"][a:b]):
                    text = match.group().strip()
                    if text:
                        left = a + match.start() + len(match.group())-len(match.group().lstrip())
                        spans.append((left, left+len(text)))
    result = sorted(set(spans))
    assert result and all(a < b for a,b in result)
    return result


def build():
    from bisect import bisect_left
    qs, metadata = inputs()
    model = fetched(CACHE/"tessdata/eng.traineddata",
                    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata")
    assert sha(model) == OCR_SHA
    labels = read(REVIEW)
    assert len(qs) == len(labels) and {q["financebench_id"] for q in qs} == labels.keys()
    by_doc = defaultdict(list)
    for q in qs:
        by_doc[q["doc_name"]].append(q)
    docs = {d["doc_name"]: d for d in metadata if d["doc_name"] in by_doc}
    assert docs.keys() == by_doc.keys()
    split = split_companies(docs.values())
    old = read(RESULTS/"2026-11-26-semantic-settings-data.json")
    frozen = read(MANIFEST) if MANIFEST.exists() else None
    sets = {k:v for k,v in old["sets"].items() if not k.startswith("finance-")}
    manifest = {"release": REV, "upstream": "https://github.com/patronus-ai/financebench",
                "assetSHA256": ASSETS, "ocrModelSHA256":OCR_SHA,"citationSHA256": sha(REVIEW.read_bytes().replace(b"\r\n", b"\n")),
                "extractorSHA256": sha(PDF_MODULE.read_bytes().replace(b"\r\n", b"\n")),
                "nonfinanceManifest": "2026-11-26-semantic-settings-data.json",
                "companies": split, "documents": {}, "excluded": {}, "sets": sets}
    SETS.mkdir(parents=True, exist_ok=True)
    for name, questions in sorted(by_doc.items()):
        doc = read(CACHE/"rendered"/(name+".json"))
        assert doc["extractor"] == manifest["extractorSHA256"]
        scans = scanned_pages(name, doc)
        doc = add_scans(doc, scans)
        source = doc["source"]
        surrogate_pairs = [i for i,c in enumerate(source) if ord(c)>0xffff]
        def utf16(i):
            return i + bisect_left(surrogate_pairs, i)
        info = docs[name]
        fold = split[info["company"]]
        rows, evidence_info = [], {}
        for q in questions:
            qid = q["financebench_id"]
            label = labels[qid]
            if "exclude" in label:
                manifest["excluded"][qid] = {"document": name, "reason": label["exclude"]}
                continue
            assert q["company"] == info["company"] and all(e["doc_name"] == name for e in q["evidence"])
            pages = {e["evidence_page_num"]+1 for e in q["evidence"]}
            refs = [citation(view, pages, doc) for view in label["references"]]
            converted = [[[utf16(a),utf16(b)] for a,b in ref] for ref in refs]
            rows.append({"id": qid, "text": q["question"], "kind": label["kind"],
                         "cluster": q["company"], "references": converted})
            evidence_info[qid] = {"type": q["question_type"], "publishedPages": sorted(pages),
                                  "referencesSHA256": sha(packed(converted).encode())}
        data = packed([{"id":name,"group":info["company"],"raw":source,"source":source,
                        "format":"markdown","questions":rows}]).encode()
        key = f"finance-{fold}-filing-{name}"
        sets[key] = {"sources":[name],"questions":len(rows),"format":"markdown","pool":"document",
                     "vectorBank":"full-financebench-"+name,"byEvidence":dict(Counter(q["kind"] for q in rows)),
                     "sha256":sha(data)}
        if frozen:
            assert frozen["sets"][key] == sets[key], f"{name} differs from the frozen finance corpus."
        target = SETS/(key+".json")
        if not target.exists() or sha(target.read_bytes()) != sets[key]["sha256"]:
            tmp = target.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(target)
        manifest["documents"][name] = {"type":info["doc_type"],"company":info["company"],"sector":info["gics_sector"],
            "fold":fold,"pages":len(doc["pages"]),"pagesWithoutText":[i for i,(a,b,_,_) in enumerate(doc["pages"],1) if a==b],
            "ocrPages":[int(i) for i,v in scans.items() if "text" in v],
            "duplicateScans":{i:v["duplicateOf"] for i,v in scans.items() if "duplicateOf" in v},
            "pdfSHA256":doc["pdfSHA256"],"markdownSHA256":sha(source.encode()),"questions":evidence_info}
    if frozen:
        assert frozen == manifest, "Rebuilt data differ from the frozen filing manifest."
    else:
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n", encoding="utf8", newline="\n")
    print(f"{len(docs)} filings, {len(split)} issuers, {len(qs)-len(manifest['excluded'])} scored questions, {len(manifest['excluded'])} exclusions.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("stage", choices=["render", "build"])
    p.add_argument("--workers", type=int, default=4)
    args = p.parse_args()
    render(args.workers)
    if args.stage == "build":
        build()
