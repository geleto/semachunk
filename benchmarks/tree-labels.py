"""Question-only and reference-only screening, independent of any chunk layout or score."""
import json
import re
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
def normalize(s):
    return " ".join(re.findall(r"\w+", s.casefold()))


# Reviewed short openings and reference strings. Keep specific short answers, including fees and durations.
NO_INTENT = {normalize(s) for s in (
    "hi", "hi there", "asdfas", "dfsgfgsdrgfdg", "dfsgsf", "dsafe", "dsffsdf", "iyiugygoiuoi", "sdfgf", "sdfrafg",
    "how do I apply", "how do I apply for benefits", "hi i need help about how do i apply", "hi i need help on how do i apply",
    "who can get benefits", "what documents do I need", "what original documents do I need to show the office",
    "what documents do i need to apply", "what do i need to know about this", "what is your purpose",
    "I need eligibility help", "I need help with fees and such", "as it is through a DMV office",
    "what requirements do i need to get an increase", "i need more information about the deadline for my request, please",
    "hi, i need help in the financial area",
)}
NON_ANSWERS = {normalize(s) for s in (
    "Citizenship", "Learn about Disability Benefits", "Disability Home", "Yes.", "Let's review what to expect.",
    "Let s review what to expect.", "Bring", "Information", "Important", "Name Change", "Apply Online", "Don't worry.",
)}


class Headings(HTMLParser):
    def __init__(self, raw):
        super().__init__()
        self.values, self.parts = set(), None
        self.feed(raw)
        self.close()

    def handle_starttag(self, tag, attrs):
        if re.fullmatch("h[1-6]", tag):
            self.parts = []

    def handle_endtag(self, tag):
        if self.parts is not None and re.fullmatch("h[1-6]",tag):
            self.values.add(normalize("".join(self.parts)))
            self.parts = None

    def handle_data(self, data):
        if self.parts is not None:
            self.parts.append(data)


def screen(docs):
    result = {}
    by_query = defaultdict(list)
    for doc in docs:
        headings = Headings(doc["raw"]).values
        for q in doc["questions"]:
            key = q["id"]
            assert key not in result
            wording = normalize(q["text"])
            refs = tuple(normalize(s) for s in q["evidence"])
            reason = None
            if wording in NO_INTENT:
                reason = "missingStandaloneIntent"
            elif all(s in NON_ANSWERS or s in headings for s in refs):
                reason = "onlyHeadingNavigationOrNonAnswer"
            result[key] = dict(fold=doc["split"],reason=reason)
            by_query[wording].append((doc["split"],doc["domain"],doc["group"],refs,key))
    for entries in by_query.values():
        usable = [e for e in entries if result[e[-1]]["reason"] is None]
        for fold in ("development","confirmation"):
            for domain in {e[1] for e in usable}:
                rows = sorted(e for e in usable if e[0:2] == (fold,domain))
                if fold == "confirmation" and any(e[0] == "development" for e in entries):
                    for *_,k in rows:
                        result[k]["reason"] = "wordingAppearsInDevelopment"
                elif len({(e[2],e[3]) for e in rows}) > 1:
                    for *_,k in rows:
                        result[k]["reason"] = "identicalQueryConflictingSourceOrEvidence"
                else:
                    for *_,k in rows[1:]:
                        result[k]["reason"] = "duplicateQuestionAndEvidence"
    return result


if __name__ == "__main__":
    docs = json.loads((HERE / ".cache/tree-corpus/government.json").read_text("utf8"))
    decisions = screen(docs)
    out = {"counts":{}, "excluded":{k:v["reason"] for k,v in sorted(decisions.items()) if v["reason"]}}
    for fold in ("development","confirmation"):
        out["counts"][fold] = dict(Counter(v["reason"] or "scored" for v in decisions.values() if v["fold"] == fold))
    path = HERE / "results/2026-11-26-tree-labels.json"
    text = json.dumps(out,indent=2,sort_keys=True) + "\n"
    if path.exists():
        assert path.read_text("utf8") == text
    else:
        path.write_text(text,encoding="utf8",newline="\n")
    print(out["counts"])
