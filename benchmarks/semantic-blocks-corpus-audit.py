"""Inventory annotations and source overlap without running a chunker or a retriever."""
import hashlib
import io
import json
import re
import sys
import tarfile
import zipfile
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import urlopen


CACHE = Path(__file__).resolve().parent / ".cache"
QMSUM = "https://raw.githubusercontent.com/Yale-LILY/QMSum/83d7768c1f2b4dfeb091385d3dc7e239b8e5bb7e/data/ALL/jsonl/"
SOURCES = {
    "qmsum-train.jsonl": (QMSUM + "train.jsonl", "55964a968e4b4c1c9da2434678f213f3b70c0c3d3cf609f5cd4ecd44cc8d2427"),
    "qmsum-val.jsonl": (QMSUM + "val.jsonl", "fc7444e241bdbe6997c01720d07f1a58b7357284acb73f909766e5a4700db49f"),
    "qmsum-test.jsonl": (QMSUM + "test.jsonl", "6bcd428211260ad2efae3af76cbaf6a7f5ae4bb5e1e59c45a4b8e89539cb9208"),
    "doc2dial-v1.0.1.zip": ("https://raw.githubusercontent.com/doc2dial/doc2dial.github.io/30fa02bacefca711cc4503f118cc50365225e9b9/file/doc2dial_v1.0.1.zip",
                            "94499fa5259f69018d2458cb948552e7a05f424711a95a562bb9e816a515dc23"),
    "wikisection.tar.gz": ("https://raw.githubusercontent.com/sebastianarnold/WikiSection/9d1bd55da4bc2dc985b5f4493e8214caa86100b8/wikisection_dataset_json.tar.gz",
                          "f37810a95702737b153a3034dbb877d08ecc699900f1a01c70110d47a5a016b8"),
}


def source(name):
    path = CACHE / name
    url, checksum = SOURCES[name]
    if path.is_file():
        data = path.read_bytes()
    else:
        with urlopen(url, timeout=120) as stream:
            data = stream.read()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError("Unexpected source digest for " + name)
    return data


def qmsum():
    partitions, fingerprints = {}, {}
    for split in ("train", "val", "test"):
        counts, seen = Counter(), set()
        for line in source("qmsum-" + split + ".jsonl").splitlines():
            row = json.loads(line)
            turns = row["meeting_transcripts"]
            fingerprint = hashlib.sha256(json.dumps(turns, sort_keys=True).encode()).hexdigest()
            if fingerprint in seen:
                raise ValueError("Repeated meeting in " + split)
            seen.add(fingerprint)
            topics = [set() for _ in turns]
            for i, topic in enumerate(row["topic_list"]):
                counts["topics"] += 1
                counts["topicsWithMultipleSpans"] += int(len(topic["relevant_text_span"]) > 1)
                for first, last in topic["relevant_text_span"]:
                    a, b = int(first), int(last)
                    if not 0 <= a <= b < len(turns):
                        raise ValueError("Invalid topic span in " + split)
                    for j in range(a, b + 1):
                        topics[j].add(i)
            for left, right in zip(topics, topics[1:]):
                if len(left) != 1 or len(right) != 1:
                    counts["unknownOrOverlapping"] += 1
                elif left == right:
                    counts["sameTopic"] += 1
                else:
                    counts["topicChange"] += 1
        partitions[split] = {"meetings": len(seen), **counts}
        fingerprints[split] = seen
    return {"partitions": partitions, "trainTranscriptsAlsoInValOrTest":
            len(fingerprints["train"] & (fingerprints["val"] | fingerprints["test"]))}


def wikisection():
    partitions, seen = {}, set()
    with tarfile.open(fileobj=io.BytesIO(source("wikisection.tar.gz"))) as archive:
        for split in ("validation", "test"):
            rows = json.load(archive.extractfile("wikisection_en_disease_" + split + ".json"))
            boundaries = 0
            for row in rows:
                if row["id"] in seen:
                    raise ValueError("Repeated WikiSection article")
                seen.add(row["id"])
                text = row["text"].encode("utf-16-le")
                end = 0
                for s in row["annotations"]:
                    a, b = s["begin"] * 2, (s["begin"] + s["length"]) * 2
                    if not end <= a < b <= len(text) or not text[a:b].decode("utf-16-le").strip():
                        raise ValueError("Invalid WikiSection annotation in " + row["id"])
                    end = b
                boundaries += max(0, len(row["annotations"]) - 1)
            partitions[split] = {"articles": len(rows), "editorialBoundaries": boundaries}
    return partitions


class HtmlText(HTMLParser):
    """Whitespace-normalized DOM text for locating candidate evidence, independent of chunking."""
    blocks = set("address article aside blockquote br caption dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split())
    ignored = {"script", "style", "template"}

    def __init__(self, markup):
        super().__init__()
        self.parts = []
        self.skipped = 0
        self.feed(markup)
        self.close()
        self.text = " ".join("".join(self.parts).split())

    def handle_data(self, data):
        if not self.skipped:
            self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in self.ignored:
            self.skipped += 1
        if not self.skipped and tag in self.blocks:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self.ignored and self.skipped:
            self.skipped -= 1
        if not self.skipped and tag in self.blocks:
            self.parts.append(" ")


def location(text, needle):
    if not needle:
        return "missing"
    # Keep whole word edges so a short answer cannot match inside a different word.
    def word(char):
        return char.isalnum() or char == "_"

    found = False
    start = text.find(needle)
    while start >= 0:
        end = start + len(needle)
        left_ok = start == 0 or not word(needle[0]) or not word(text[start - 1])
        right_ok = end == len(text) or not word(needle[-1]) or not word(text[end])
        if left_ok and right_ok:
            if found:
                return "ambiguous"
            found = True
        start = text.find(needle, start + 1)
    return "unique" if found else "missing"


def page_splits(pages, eligible):
    # A source title can have several numbered versions. Identical rendered pages can also have different titles.
    families = {key: key[0] + "/" + re.sub(r"#\d+_\d+$", "", key[1]).strip().casefold() for key in pages}
    parent = {family: family for family in families.values()}

    def root(family):
        while parent[family] != family:
            family = parent[family]
        return family

    first_title = {}
    for key, digest in pages.items():
        family = families[key]
        a, b = sorted([root(family), root(first_title.setdefault(digest, family))])
        parent[b] = a
    result = {}
    for key, openings in eligible.items():
        family = root(families[key])
        fold = hashlib.sha256(("semachunk/doc2dial/v1/" + family).encode()).digest()[0]
        name = "development" if fold < 128 else "confirmation"
        entry = result.setdefault(name, {"families": set(), "documents": [], "openings": [], "byDomain": Counter()})
        entry["families"].add(family)
        entry["documents"].append(key)
        entry["openings"].extend((key[0], key[1], dial_id) for dial_id in openings)
        entry["byDomain"][key[0]] += len(openings)
    if result["development"]["families"] & result["confirmation"]["families"]:
        raise ValueError("Doc2Dial source family crosses splits")
    for entry in result.values():
        ids = sorted(entry.pop("openings"))
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate Doc2Dial opening")
        entry["openingQuestions"] = len(ids)
        entry["openingIdsSHA256"] = hashlib.sha256(json.dumps(ids, ensure_ascii=False).encode()).hexdigest()
        entry["sourceFamilies"] = len(entry.pop("families"))
        entry["documents"].sort()
    return result


def doc2dial():
    domains, unique = defaultdict(Counter), {}
    pages, source_sets, eligible = {}, {}, defaultdict(list)
    with zipfile.ZipFile(io.BytesIO(source("doc2dial-v1.0.1.zip"))) as archive:
        for domain, docs in json.loads(archive.read("doc2dial_doc.json"))["doc_data"].items():
            counts = domains[domain]
            for doc_id, doc in docs.items():
                counts["documentVersions"] += 1
                text, rendered = doc["doc_text"], HtmlText(doc["doc_html_raw"]).text
                pages[domain, doc_id] = hashlib.sha256(rendered.encode()).hexdigest()
                verified = set()
                for span_id, span in doc["spans"].items():
                    literal = span["text_sp"]
                    if text[span["start_sp"]:span["end_sp"]] != literal:
                        raise ValueError("Invalid Doc2Dial text offset in " + doc_id)
                    status = location(rendered, " ".join(literal.split()))
                    counts[status + "HtmlSpan"] += 1
                    if status == "unique":
                        verified.add(span_id)
                unique[domain, doc_id] = verified
        for split in ("train", "validation", "test"):
            source_sets[split] = set()
            data = json.loads(archive.read("doc2dial_dial_" + split + ".json"))["dial_data"]
            for domain, docs in data.items():
                counts = domains[domain]
                for doc_id, dialogs in docs.items():
                    key = (domain, doc_id)
                    source_sets[split].add(key)
                    for dialog in dialogs:
                        turns = dialog["turns"]
                        if len(turns) < 2:
                            continue
                        user, agent = turns[:2]
                        if user["role"] != "user" or not user["da"].startswith("query") or agent["role"] != "agent" or agent["da"] != "respond_solution":
                            continue
                        refs = [r["sp_id"] for r in agent["references"] if r["label"] in {"solution", "precondition"}]
                        if refs:
                            counts["groundedOpeningQuestions"] += 1
                            if all(r in unique[key] for r in refs):
                                eligible[key].append(dialog["dial_id"])
                                counts["openingsWithEverySpanUniqueInHtml"] += 1
    return {"domains": dict(domains), "distinctNormalizedHtmlTexts": len(set(pages.values())),
            "documentVersionsWithEligibleOpenings": len(eligible), "sourceFamilySplits": page_splits(pages, eligible),
            "officialTrainTestSharedDocumentVersions": len(source_sets["train"] & source_sets["test"])}


if __name__ == "__main__":
    result = {"sources": dict(sorted(SOURCES.items())), "wikiSectionEnglishDisease": wikisection(),
              "qmsum": qmsum(), "doc2dial": doc2dial()}
    report = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if len(sys.argv) == 1:
        sys.stdout.write(report)
    else:
        with Path(sys.argv[1]).open("x", encoding="utf-8", newline="\n") as output:
            output.write(report)
