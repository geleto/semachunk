"""Prepare the pinned question pools. Python supplies Unicode case folding and reads the large training archive."""
import hashlib
import json
import sys
import tarfile
import unicodedata
from pathlib import Path

cache = Path(sys.argv[1])
output = Path(sys.argv[2]) if len(sys.argv) > 2 else cache / "json-records"
output.mkdir(exist_ok=True)


def write(name, rows):
    path = output / (name + ".jsonl")
    with path.with_suffix(".tmp").open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    path.with_suffix(".tmp").replace(path)
    print(name, len(rows), flush=True)


def digest(ids):
    return hashlib.sha256("".join(x + "\n" for x in ids).encode()).hexdigest()


def title(s):
    return " ".join(unicodedata.normalize("NFC", s).casefold().replace("_", " ").split())


def valid(q):
    articles = dict(q["context"])
    return len(articles) == len(q["context"]) and all(
        t in articles and 0 <= i < len(articles[t]) and articles[t][i].strip() for t, i in q["supporting_facts"])


def hotpot(q):
    return dict(id=q["_id"], context=q["context"], question=q["question"], facts=q["supporting_facts"])


def oversized(q):
    titles = {t for t, _ in q["supporting_facts"]}
    def width(obj):
        return len(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-16-le")) // 2
    return any(t in titles and max(width(dict(title=t, sentences=s)), width(dict(title=t, text=" ".join(x.strip() for x in s)))) > 1024
               for t, s in q["context"])

def array_items(path):
    """Decode the pinned 566 MB array one element at a time."""
    decoder = json.JSONDecoder()
    with path.open(encoding="utf-8") as f:
        assert f.read(1) == "["
        buf, at = "", 0
        while True:
            while at < len(buf) and buf[at] in " \t\r\n,":
                at += 1
            if buf[at:at+1] == "]":
                return
            try:
                value, end = decoder.raw_decode(buf, at)
            except json.JSONDecodeError:
                more = f.read(256 * 1024)
                if not more:
                    raise
                buf, at = buf[at:] + more, 0
                continue
            yield value
            at = end


dev = json.loads((cache / "hotpot-dev-distractor.json").read_bytes())
known = {title(t) for q in dev for t, _ in q["context"]}
dev = [hotpot(q) for q in dev if valid(q)]
assert len(dev) == 7404
write("hotpot", dev)
del dev

eligible = [q for q in array_items(cache / "hotpot-train-7e54db.json") if q["level"] == "hard" and valid(q)
            and len({title(t) for t, _ in q["context"]}) == len(q["context"])
            and not any(title(t) in known for t, _ in q["context"])]
assert len(eligible) == 5315
used, selected, affected = set(), [], []
for q in sorted(eligible, key=lambda x: (hashlib.sha256(x["_id"].encode()).digest(), x["_id"])):
    titles = {title(t) for t, _ in q["context"]}
    if titles & used:
        continue
    used.update(titles)
    selected.append(hotpot(q))
    if oversized(q):
        affected.append(q["_id"])
assert digest(q["id"] for q in selected) == "da6ec852df9cefb8ca1cddb7fca53416c2185c87295f9435c16af5bd02246fee"
assert digest(affected) == "fe9dbb0bfa88c751b2a1315ca1e60505de055c66e1661e59285703e6d964bae2"
write("confirmation", selected)
del eligible, selected

pages = {}
for q in json.loads((cache / "finqa-dev.json").read_bytes()):
    data = {k: q[k] for k in ("pre_text", "post_text", "filename", "table")}
    page = pages.setdefault(q["filename"], dict(id=q["filename"], data=data, questions=[]))
    assert page["data"] == data
    page["questions"].append([q["id"], q["qa"]["question"], list(q["qa"]["gold_inds"])])
assert len(pages) == 299 and sum(len(p["questions"]) for p in pages.values()) == 883
write("finqa", list(pages.values()))

with tarfile.open(cache / "wikisql-cffb423.tar.bz2", "r|bz2") as tf:
    for member in tf:
        if member.name in ("data/dev.tables.jsonl", "data/dev.jsonl"):
            data = [json.loads(line) for line in tf.extractfile(member)]
            if member.name.endswith("tables.jsonl"):
                tables = {t["id"]: t for t in data}
            else:
                questions = data
lookup = {}
for i, q in enumerate(questions):
    t, sql = tables[q["table_id"]], q["sql"]
    header, rows, sel, conds = t["header"], t["rows"], sql["sel"], sql["conds"]
    if sql["agg"] or not conds or len(set(header)) != len(header) or any(len(row) != len(header) for row in rows):
        continue
    if any(c == sel or op != 0 or t["types"][c] != "text" or not str(v).strip() for c, op, v in conds):
        continue
    matches = [j for j, row in enumerate(rows) if all(str(row[c]).strip().casefold() == str(v).strip().casefold() for c, _, v in conds)]
    if len(matches) != 1 or not str(rows[matches[0]][sel]).strip():
        continue
    entry = lookup.setdefault(t["id"], dict(id=t["id"], header=header, rows=rows, questions=[]))
    entry["questions"].append([str(i), q["question"], matches[0], sorted({sel, *(c for c, _, _ in conds)})])
counts = len(lookup), sum(len(t["questions"]) for t in lookup.values()), sum(len(t["rows"]) for t in lookup.values())
assert counts == (1806, 4807, 29283), counts
write("wikisql", list(lookup.values()))
