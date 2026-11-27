"""Reconstruct the source-disjoint benchmark from immutable public originals."""
import concurrent.futures
import hashlib
import importlib.util
import io
import json
import re
import sys
import tarfile
import zipfile
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("audit", HERE / "semantic-blocks-corpus-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
OUT = audit.CACHE / "tree-corpus"
OUT.mkdir(parents=True, exist_ok=True)
MANUALS = [
    ("rclone", "rclone/rclone", "cd9c861693c874ba446f0b6f6708f0a20ae636fa", "docs/content/faq.md", "development"),
    ("docker", "docker/docs", "e8a4ce7a531961f3fbd8986ccfbf7715628f903b", "content/manuals/compose/support-and-feedback/faq.md", "confirmation"),
    ("pandoc", "jgm/pandoc", "50c337cb9c32467310026af43ba904582a656711", "doc/faqs.md", "confirmation"),
    ("pnpm", "pnpm/pnpm.io", "58864a152d11882918c6b5af63974007b7b661c1", "docs/faq.md", "development"),
    ("cargo", "rust-lang/cargo", "1c15deee3cd6c5e49d7f1189dba9be2b6a7af938", "doc/book/src/faq.md", "confirmation"),
    ("jellyfin", "jellyfin/jellyfin.org", "ce09cd62679d4551135aabb8b9904f70d1bce2a4", "docs/general/faq.md", "development"),
]
for slug in ("retrieval-to-grounded-answers", "draft-review-revise", "change-implementation-keep-workflow"):
    MANUALS.append((slug, "geleto/casai", "2cad8a588f9c057201c81c0e97e41ee182cea1e3",
                    "docs/matrix/articles/" + slug + ".md", "product"))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def save(name, data):
    (OUT / (name + ".json")).write_text(json.dumps(data, ensure_ascii=False), encoding="utf8")


def manual(entry):
    slug, repo, commit, path, split = entry
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"
    file = OUT / (slug + "-" + commit + ".md")
    if not file.exists():
        with urlopen(url, timeout=90) as stream:
            file.write_bytes(stream.read())
    data = file.read_bytes()
    return dict(id=slug, group=repo, split=split, url=url, sha256=sha(data), raw=data.decode("utf-8-sig"))


def government():
    frozen = json.loads((HERE / "results/2026-11-26-semantic-blocks-corpus-audit.json").read_text("utf8"))["doc2dial"]["sourceFamilySplits"]
    split = {tuple(key): fold for fold, entry in frozen.items() for key in entry["documents"]}
    with zipfile.ZipFile(io.BytesIO(audit.source("doc2dial-v1.0.1.zip"))) as z:
        pages = json.loads(z.read("doc2dial_doc.json"))["doc_data"]
        docs, valid, families, seen = {}, {}, {}, {}
        # Reconstruct family unions on ALL pages, including versions without scored questions.
        def root(f):
            while families[f] != f:
                families[f] = families[families[f]]
                f = families[f]
            return f
        for domain, by_id in pages.items():
            for page, row in by_id.items():
                key = domain, page
                title = domain + "/" + re.sub(r"#\d+_\d+$", "", page).strip().casefold()
                families.setdefault(title, title)
                visible = audit.HtmlText(row["doc_html_raw"]).text
                a, b = sorted([root(title), root(seen.setdefault(sha(visible.encode()), title))])
                families[b] = a
                if key not in split:
                    continue
                valid[key] = {i: " ".join(s["text_sp"].split()) for i, s in row["spans"].items()
                              if audit.location(visible, " ".join(s["text_sp"].split())) == "unique"}
                docs[key] = dict(id=page, title=row["title"], domain=domain, group=title, split=split[key],
                                 raw=row["doc_html_raw"], questions=[])
        for doc in docs.values():
            doc["group"] = root(doc["group"])
        ids = defaultdict(list)
        for name in ("train", "validation", "test"):
            for domain, by_id in json.loads(z.read("doc2dial_dial_" + name + ".json"))["dial_data"].items():
                for page, dialogs in by_id.items():
                    key = domain, page
                    if key not in docs:
                        continue
                    for dialog in dialogs:
                        turns = dialog["turns"]
                        if len(turns) < 2:
                            continue
                        user, agent = turns[:2]
                        if user["role"] != "user" or not user["da"].startswith("query") or agent["role"] != "agent" or agent["da"] != "respond_solution":
                            continue
                        refs = [r["sp_id"] for r in agent["references"] if r["label"] in {"solution", "precondition"}]
                        if refs and all(r in valid[key] for r in refs):
                            ids[split[key]].append((*key, dialog["dial_id"]))
                            docs[key]["questions"].append(dict(id=dialog["dial_id"], text=user["utterance"],
                                                               evidence=[valid[key][r] for r in dict.fromkeys(refs)]))
        for fold, members in ids.items():
            assert sha(json.dumps(sorted(members), ensure_ascii=False).encode()) == frozen[fold]["openingIdsSHA256"]
        return list(docs.values())


def boundaries():
    with tarfile.open(fileobj=io.BytesIO(audit.source("wikisection.tar.gz"))) as z:
        for split, name in (("validation", "development"), ("test", "confirmation")):
            data = json.load(z.extractfile("wikisection_en_disease_" + split + ".json"))
            save("wiki-" + name, [dict(id=d["id"], raw=d["text"], starts=[s["begin"] for s in d["annotations"][1:]]) for d in data])
    for split, name in (("val", "development"), ("train", "confirmation")):
        docs = []
        for line in audit.source("qmsum-" + split + ".jsonl").splitlines():
            row = json.loads(line)
            turns = row["meeting_transcripts"]
            topics = [set() for _ in turns]
            for i, topic in enumerate(row["topic_list"]):
                for a, b in topic["relevant_text_span"]:
                    for j in range(int(a), int(b) + 1):
                        topics[j].add(i)
            labels = [None if len(a) != 1 or len(b) != 1 else int(a != b) for a, b in zip(topics, topics[1:])]
            docs.append(dict(id=sha(json.dumps(turns, sort_keys=True).encode()), labels=labels,
                             turns=[t["speaker"] + ": " + t["content"] for t in turns]))
        save("meetings-" + name, docs)


if __name__ == "__main__":
    if sys.argv[1:] == ["government"]:
        save("government", government())
        sys.exit(0)
    with concurrent.futures.ThreadPoolExecutor() as ex:
        save("manuals", list(ex.map(manual, MANUALS)))
    save("government", government())
    boundaries()
