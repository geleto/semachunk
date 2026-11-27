"""Summarize the published traces or inspect full local passages for a question."""
import argparse
import bisect
import collections
import gzip
import hashlib
import json
import re
import statistics
import sys
import tarfile
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCHIVE = HERE / "results/2026-11-27-prose-traces.jsonl.gz"
LOCAL = HERE / ".cache/prose-retrieval"
METHODS = ["blocks", "semantic512", "semanticUnlimited"]


def read_archive():
    with gzip.open(ARCHIVE, "rt", encoding="utf8") as stream:
        return [json.loads(line) for line in stream]


def read_local(key, details=False):
    with gzip.open(LOCAL / (key + (".details" if details else "") + ".json.gz"), "rt", encoding="utf8") as stream:
        return json.load(stream)


def threshold(rank, k):
    return rank is not None and rank <= k


def summary(rows):
    result = {}
    for fold in ["confirmation", "development"]:
        for domain in ["finance", "papers", "faq", "government"]:
            group = [r for r in rows if (r["fold"], r["domain"]) == (fold, domain)]
            qs = [q for r in group for q in r["queries"]]
            if not qs:
                continue
            methods = {}
            for m in METHODS:
                values = [q["methods"][m] for q in qs]
                docs = [d for r in group for d in r["documents"][m]]
                def count(predicate):
                    return sum(bool(predicate(v)) for v in values)
                entry = dict(questions=len(qs), complete1=count(lambda v: v["prefix"] == 1),
                    complete5=count(lambda v: threshold(v["prefix"], 5)),
                    possible1=count(lambda v: v["minPassages"] == 1),
                    possible5=count(lambda v: threshold(v["minPassages"], 5)),
                    any5=count(lambda v: v["firstAny"] and v["firstAny"]["rank"] <= 5),
                    medianGoldRank=statistics.median(v["prefix"] for v in values if v["prefix"]),
                    medianTopSize=statistics.median(v["top"][0]["tokens"] for v in values),
                    indexed=sum(d["sizes"]["n"] for d in docs), short=sum(d["short"] for d in docs),
                    shortHeadingOrNumeric=sum(d["shortHeadingOrNumeric"] for d in docs),
                    over256=sum(d["over256"] for d in docs))
                entry["sentence5"] = count(lambda v: threshold(v["probe"]["sentences"], 5))
                entry["sentenceAndBridge5"] = count(lambda v: threshold(v["probe"]["sentencesAndBridges"], 5))
                entry["separatedGoldBridges"] = count(lambda v: v["probe"]["bridgeGold"][1])
                methods[m] = entry
            result[(fold, domain)] = methods
    return result


def ranked_diagnostics(rows):
    output = {}
    for (fold, domain), metrics in summary(rows).items():
        shards = [r for r in rows if (r["fold"], r["domain"]) == (fold, domain)]
        queries = [q for shard in shards for q in shard["queries"]]
        contexts = [doc for shard in shards for doc in shard["contextByDocument"]]
        exact_docs = set()
        for shard in shards:
            for sizes in zip(*(shard["documents"][m] for m in METHODS)):
                if len({d["sizes"]["n"] for d in sizes}) == 1:
                    exact_docs.add(sizes[0]["id"])

        common = []
        for q in queries:
            fits = [q["methods"][m]["fit"] for m in METHODS]
            choices = set.intersection(*(set(f["completeChoices"]) for f in fits))
            if choices:
                shortest = min(f["shortestByChoice"][j]["tokens"] for f in fits for j in choices)
                common.append((q, shortest))

        pairs = {}
        for lag in ("1", "4"):
            bins = collections.defaultdict(lambda: [0, 0])
            for doc in contexts:
                for pattern, (n, total) in doc["pairs"][lag].items():
                    bins[pattern][0] += n
                    bins[pattern][1] += total
            def measure(patterns):
                n = sum(bins[p][0] for p in patterns)
                return {"pairs": n, "meanCosine": sum(bins[p][1] for p in patterns) / n if n else None}
            pairs[lag] = {"all": measure(bins),
                          "blocksTogetherUnlimitedApart": measure([p for p in bins if p[0] == "1" and p[2] == "0"]),
                          "unlimitedTogetherBlocksApart": measure([p for p in bins if p[0] == "0" and p[2] == "1"])}

        groups = {"exactDocumentCount": [q for q in queries if q["doc"] in exact_docs],
                  "oneProseUnit": [q for q in queries if q["sourceSentences"] == 1],
                  "multipleProseUnits": [q for q in queries if q["sourceSentences"] >= 2]}
        for m in METHODS:
            first_sizes = [q["methods"][m]["top"][0]["tokens"] for q, _ in common]
            fits = [q["methods"][m]["fit"] for q in queries]
            values = metrics[m]
            values["commonWins"] = len(common)
            values["commonMedianFirstTokens"] = statistics.median(first_sizes) if common else None
            values["commonFirstWithShorterEquivalent"] = sum(
                n >= 2 * shortest and n >= shortest + 64 for n, (_, shortest) in zip(first_sizes, common))
            values["expandedComplete1"] = sum(f["expand"]["first"] == 1 for f in fits)
            values["expandedComplete5"] = sum(f["expand"]["five"] == 1 for f in fits)
            values["meanAddedTokensInFive"] = statistics.mean(f["expand"]["fiveTokens"] - f["top5Tokens"] for f in fits)
            values["meanTokensInFive"] = statistics.mean(f["top5Tokens"] for f in fits)
            if m != "blocks":
                swaps = [q["methods"][m]["nested"] for q in queries if q["methods"][m]["nested"]]
                values["nestedReplacement"] = {
                    "eligible": len(swaps),
                    "rises": sum(v["replacementRank"] < v["parentRank"] for v in swaps),
                    "falls": sum(v["replacementRank"] > v["parentRank"] for v in swaps),
                    "entersFive": sum(v["replacementRank"] <= 5 < v["parentRank"] for v in swaps),
                    "leavesFive": sum(v["parentRank"] <= 5 < v["replacementRank"] for v in swaps)}
            values["subsets"] = {
                name: {"questions": len(qs), "complete1": sum(q["methods"][m]["prefix"] == 1 for q in qs),
                       "complete5": sum(threshold(q["methods"][m]["prefix"], 5) for q in qs)}
                for name, qs in groups.items()}
        output.setdefault(fold, {})[domain] = {
            "documents": len(contexts), "exactCountDocuments": len(exact_docs), "methods": metrics,
            "sourcePairs": pairs, "bridgeOpportunities": sum(doc["bridges"][1] for doc in contexts)}
    return output


def inspect(rows, query_id):
    matches = [(r,q) for r in rows for q in r["queries"] if q["id"] == query_id]
    if len(matches) != 1:
        raise SystemExit("Expected one matching query ID.")
    row,q = matches[0]
    details = read_local(row["key"], True)
    print(q["text"])
    for ref in details["gold"][q["id"]]:
        print("CITED", ref["doc"], ref["text"])
    for name in METHODS:
        method = q["methods"][name]
        print(name, "first complete prefix", method["prefix"], "minimum passages", method["minPassages"])
        shown = set()
        for hit in [*method["top"], method["best"], method["firstFull"]]:
            if not hit or hit["id"] in shown:
                continue
            shown.add(hit["id"])
            passage = details["plans"][name][hit["id"]]
            print(hit, row["documents"][name][passage["doc"]]["id"])
            print(passage["text"])


def physical_breaks(rows):
    result = {}
    for row in rows:
        if row["domain"] != "finance":
            continue
        [doc] = json.loads((HERE / ".cache/semantic-settings" / (row["key"] + ".json")).read_bytes())
        source = doc["source"]
        offsets = [0]
        for char in source:
            offsets.append(offsets[-1] + (2 if ord(char) > 65535 else 1))
        gaps = []
        for match in re.finditer(r"(?<=\S)\n[ \t]*\n(?=\S)", source):
            a,b = match.span()
            left = source[source.rfind("\n",0,a)+1:a].strip()
            end = source.find("\n",b)
            right = source[b:end if end >= 0 else len(source)].strip()
            if (len(left)>=16 and not left.startswith(("#","|","```","<",">")) and
                    re.search(r"[A-Za-z,-]$",left) and re.match(r"[a-z]",right)):
                gaps.append((offsets[a]-1,offsets[b]))
        details = read_local(row["key"], True)
        points = sorted({p for pair in gaps for p in pair})
        info = {"candidates":len(gaps)}
        for m in METHODS:
            owners = collections.defaultdict(set)
            for idx,passage in enumerate(details["plans"][m]):
                for a,b in passage["spans"]:
                    for p in points[bisect.bisect_left(points,a):bisect.bisect_left(points,b)]:
                        owners[p].add(idx)
            info[m] = {"indexed":sum(bool(owners[a] and owners[b]) for a,b in gaps),
                "separated":sum(bool(owners[a] and owners[b] and owners[a].isdisjoint(owners[b])) for a,b in gaps)}
        result[doc["id"]] = info
    return result


def literal_answers(rows):
    def normalize(s):
        return " " + " ".join(re.findall(r"[^\W_]+",unicodedata.normalize("NFKC",s).casefold())) + " "
    with tarfile.open(HERE / ".cache/qasper-train-dev-v0.3.tgz") as tgz:
        native = json.load(tgz.extractfile("qasper-dev-v0.3.json"))
    result = {}
    for row in rows:
        if row["domain"] != "papers":
            continue
        docs = json.loads((HERE / ".cache/semantic-settings" / (row["key"]+".json")).read_bytes())
        sources = {d["id"]:normalize(d["source"]) for d in docs}
        details = read_local(row["key"], True)
        passages = {m:[normalize(t["text"]) for t in details["plans"][m]] for m in METHODS}
        group = result.setdefault(row["fold"],{m:collections.Counter() for m in METHODS})
        for q in row["queries"]:
            published = next(v for v in native[q["doc"]]["qas"] if v["question_id"]==q["id"])
            refs = []
            for annotation in published["answers"]:
                answer = annotation["answer"]
                if answer["unanswerable"] or any("FLOAT SELECTED:" in s for s in answer["evidence"]):
                    continue
                ref = [normalize(s) for s in answer["extractive_spans"]]
                if (ref and all(len(s.split())>=2 and any(c.isalpha() for c in s) and
                        not re.search(r"\b(?:bibref|figref|tabref|secref|eqref|inlineform|displayform)\d+",s)
                        and s in sources[q["doc"]] for s in ref) and max(len(s.split()) for s in ref)>=3):
                    refs.append(ref)
            if not refs:
                continue
            for m in METHODS:
                data = group[m]
                data["eligible"] += 1
                for k in (1,5):
                    top = [passages[m][h["id"]] for h in q["methods"][m]["top"][:k]]
                    literal = any(all(any(s in t for t in top) for s in ref) for ref in refs)
                    cited = threshold(q["methods"][m]["prefix"],k)
                    data["allAnswerStrings"+str(k)] += literal
                    data["completeCitation"+str(k)] += cited
                    data["stringsWithoutCitation"+str(k)] += literal and not cited
    return result


def reader_sample(rows):
    """Sample distinct documents by outcome. Present original passages without the method labels."""
    order = lambda s: hashlib.sha256(("prose-read-v1/"+s).encode()).hexdigest()
    packet, key = {}, {}
    for domain in ("papers","faq","government","finance"):
        group = [(r,q) for r in rows if r["domain"]==domain and r["fold"]=="confirmation" for q in r["queries"]]
        used_docs, used_publishers = set(), set()
        for stratum in ("larger complete","short complete","blocks win","semantic win","no complete","ordinary co-win"):
            eligible = []
            for r,q in group:
                if q["doc"] in used_docs:
                    continue
                values = [q["methods"][m] for m in METHODS]
                hit = [v["prefix"]==1 for v in values]
                sizes = [v["top"][0]["tokens"] for v in values]
                suits = {"larger complete":all(hit) and max(sizes)>=2*min(sizes) and max(sizes)-min(sizes)>=64,
                         "short complete":any(yes and n<=64 for yes,n in zip(hit,sizes)),
                         "blocks win":hit[0] and not all(hit), "semantic win":not hit[0] and any(hit[1:]),
                         "no complete":not any(hit), "ordinary co-win":all(hit)}
                if suits[stratum]:
                    publisher = r["key"].split("-")[-2] if domain=="government" else q["doc"]
                    eligible.append((publisher in used_publishers,order(q["id"]),publisher,r,q))
            if not eligible:
                continue
            _,_,publisher,row,q = min(eligible,key=lambda item:item[:2])
            used_docs.add(q["doc"])
            used_publishers.add(publisher)
            details = read_local(row["key"],True)
            candidates, winning = {}, {}
            def add(method,hit):
                src = details["plans"][method][hit["id"]]
                # Identical displayed answers in the same document need a single reading.
                identity = (row["documents"][method][src["doc"]]["id"],src["text"])
                candidates[identity] = {"document":identity[0],"text":identity[1]}
                return identity
            shortest = []
            for method in METHODS:
                value = q["methods"][method]
                winning[method] = add(method,value["top"][0])
                for item in value["fit"]["shortestByChoice"]:
                    if item:
                        shortest.append((item["tokens"],item["rank"],method,item))
            if shortest:
                _,_,method,item = min(shortest,key=lambda v:v[:3])
                alternative = add(method,item)
            else:
                best = [(q["methods"][m]["best"],m) for m in METHODS if q["methods"][m]["best"]]
                item,method = max(best,key=lambda v:(v[0]["recall"],-v[0]["tokens"]))
                alternative = add(method,item)
            ordered = sorted(candidates,key=lambda c:order(q["id"]+'/'+c[0]+'/'+c[1]))
            labels = {c:chr(65+i) for i,c in enumerate(ordered)}
            packet[q["id"]] = {"question":q["text"], "evidence":[ref["text"] for ref in details["gold"][q["id"]]],
                               "candidates":{labels[c]:candidates[c] for c in ordered}}
            key[q["id"]] = {"domain":domain,"stratum":stratum,"methods":{m:labels[c] for m,c in winning.items()},
                            "alternative":labels[alternative]}
    for name,value in [("reader-packet",packet),("reader-key",key)]:
        (LOCAL/(name+".json")).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf8")
    print(len(packet),"reader cases")


if __name__ == "__main__":
    # Preserve source characters even when a Windows shell redirects the passage output.
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question", nargs="?")
    parser.add_argument("--diagnostics", action="store_true", help="Rebuild cross-domain retrieval, source-wrap and answer-string diagnostics")
    parser.add_argument("--reader-sample",action="store_true",help="Prepare the method-masked local reading packet")
    args = parser.parse_args()
    data = read_archive()
    if args.reader_sample:
        reader_sample(data)
    elif args.diagnostics:
        extra = {"rankedRetrieval":ranked_diagnostics(data), "possiblePhysicalWraps":physical_breaks(data),
                 "qasperAnswerStrings":literal_answers(data)}
        (HERE / "results/2026-11-27-prose-diagnostics.json").write_text(
            json.dumps(extra,indent=2)+"\n",encoding="utf8",newline="\n")
    elif args.question:
        inspect(data, args.question)
    else:
        for (fold, domain), values in summary(data).items():
            print(fold, domain, json.dumps(values))
