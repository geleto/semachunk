"""Exploratory reranking of independently retrieved lists using ranks and cited words."""
import collections
import functools
import itertools
import json
import math
import re
import runpy
import sys
from pathlib import Path

import numpy as np

here = Path(__file__).resolve().parent
ranking = runpy.run_path(str(here / "paragraph-ranking.py"))
root = ranking["ROOT"]
profiles = json.loads((root / "compact-selection.json").read_bytes())["nominees"]
families = {"blocks": ["blocks"], "combined": ["blocks", "tree"], "twoBlocks": ["blocks", "secondBlocks"]}
controls = {name: profiles[name] for name in ("blocks", "tree")}
controls["secondBlocks"] = profiles["structural-rerank"]["alt"]
stop = set("a an and are as at be by did do does for from had has have how in is it of on or that the their they this to was were what when where which who why with".split())


def words(text):
    return [word for word in re.findall(r"[^\W_]+", text.casefold()) if word not in stop]


def sources(fold):
    result = {}
    for key, meta in ranking["REG"].items():
        if meta["fold"] != fold.removeprefix("shared-"):
            continue
        directory = (root / "holdout-data" if meta["fold"] == "holdout" else
                     here / ".cache/context-mixtures" / ("audited-data" if meta["fold"] == "fresh" else "data"))
        for doc in json.loads((directory / (key + ".json")).read_bytes())["docs"]:
            result[doc["id"]] = doc["source"].encode("utf-16-le")
    return result


class Shortlist:
    def __init__(self, pool, texts):
        self.pool = pool
        self.texts = [texts[d["id"]] for d in pool.docs]
        self.counts = functools.lru_cache(maxsize=None)(self._counts)
        self.iou = functools.lru_cache(maxsize=None)(self._iou)
        self.hits = {key: pool.run(config) for key, config in controls.items()}
        # Keep the IDF corpus identical for all families, including the single-layout baseline.
        base_views = {pool.offsets[i] + c["win"] for i, d in enumerate(pool.docs)
                      for c in d["ix"]["layouts"][controls["blocks"]["layouts"][0]]}
        freq = collections.Counter()
        length = 0
        for v in base_views:
            count = self.counts(v)
            freq.update(count.keys())
            length += count.total()
        self.n = len(base_views)
        self.freq = freq
        self.average = max(1, length / self.n)

    def _counts(self, v):
        raw = self.texts[self.pool.owners[v]]
        passage = " ".join(raw[a*2:b*2].decode("utf-16-le") for a, b in self.pool.views[v]["ranges"])
        return collections.Counter(words(passage))

    def _iou(self, v, u):
        if self.pool.owners[v] != self.pool.owners[u]:
            return 0.
        a, b = self.pool.views[v], self.pool.views[u]
        overlap = ranking["ev"].size(ranking["ev"].intersect(a["raw"], b["raw"]))
        return overlap / (a["length"] + b["length"] - overlap)

    def lexical(self, v, terms):
        count = self.counts(v)
        length_penalty = 1.2 * (.25 + .75 * count.total() / self.average)
        return sum(math.log1p((self.n - self.freq[t] + .5) / (self.freq[t] + .5))
                   * 2.2 * count[t] / (count[t] + length_penalty) for t in terms if t in count)

    def features(self, qi, family):
        lists = [self.hits[name][qi] for name in families[family]]
        views = tuple(dict.fromkeys(itertools.chain.from_iterable(lists)))
        terms = sorted(set(words(self.pool.qs[qi][1]["text"])))
        lexical = [self.lexical(v, terms) for v in views]
        # Competition ranks give equal lexical scores the same vote. An unmatched passage has none.
        lex = np.array([1 / (1 + sum(other > value for other in lexical)) if value else 0 for value in lexical])
        votes = {}
        for offset, near in itertools.product((0, 4), (False, True)):
            votes[offset, near] = np.array([
                sum(max((similarity * (offset + 1) / (offset + i + 1)
                         for i, u in enumerate(result)
                         if (similarity := (self.iou(u, v) if near else float(u == v))) >= .5), default=0.)
                    for result in lists) / len(lists) for v in views
            ])
        return views, lex, votes

    def score(self, views, lex, votes, config):
        w = config["lexical"]
        scores = (1-w) * votes[config["offset"], config["near"]] + w * lex
        chosen = []
        for i in np.argsort(-scores, kind="stable"):
            v = views[i]
            if all(self.pool.fraction(min(u, v), max(u, v)) < .85 for u in chosen):
                chosen.append(v)
                if len(chosen) == 5:
                    break
        return tuple(chosen)


def measure(fold, candidates):
    texts = sources(fold)
    result = {family: [[] for _ in configs] for family, configs in candidates.items()}
    labels = []
    for pool in ranking["pools"](fold):
        search = Shortlist(pool, texts)
        for qi, (doc, _) in enumerate(pool.qs):
            labels.append((doc["domain"], doc["id"]))
            for family, configs in candidates.items():
                values = search.features(qi, family)
                for i, config in enumerate(configs):
                    hits = search.score(*values, config)
                    if family == "blocks":
                        assert set(hits) == set(search.hits["blocks"][qi])
                    result[family][i].append(pool.grade(qi, hits))
    groups = collections.defaultdict(list)
    for i, (domain, doc) in enumerate(labels):
        groups[domain].append(dict(doc=doc, i=i))
    output = {}
    reference = np.array(result["blocks"][0])
    for family, options in result.items():
        output[family] = []
        for rows in options:
            a = np.array(rows)
            rates = np.mean([np.mean(a[[v["i"] for v in group]], axis=0) for group in groups.values()], axis=0)
            item = dict(zip(ranking["FIELDS"], rates.tolist()))
            if len(options) == 1:
                delta = a - reference
                item["pairedAgainstShortlistBlocks"] = ranking["report"]["paired"](
                    groups, 1, 0, lambda row, mode: delta[row["i"], :4] * mode)
            output[family].append(item)
    return output


selection_path = root / "shortlist-selection.json"
if sys.argv[1:] == ["select"]:
    trials = {name: [dict(lexical=w, near=n, offset=k) for w, n, k in
                     itertools.product((0, .25, .5, .75, 1), (False, True), (0, 4))] for name in families}
    dev = measure("development", trials)
    chosen = {}
    for name, configs in trials.items():
        quality = [(r["first"] + r["five"]) / 2 for r in dev[name]]
        near_best = [i for i, v in enumerate(quality) if v >= max(quality) - .0035]
        i = min(near_best, key=lambda i: (configs[i]["lexical"] > 0, configs[i]["near"],
                                           -dev[name][i]["f1"], -quality[i], i))
        chosen[name] = configs[i]
    selection_path.write_text(json.dumps(dict(selected=chosen, trials=trials, development=dev)), encoding="utf-8")
else:
    frozen = json.loads(selection_path.read_bytes())["selected"]
    folds = ("development", "confirmation", "fresh", "shared-fresh", "holdout", "shared-holdout")
    scores = {fold: {k: v[0] for k, v in measure(fold, {f: [c] for f, c in frozen.items()}).items()}
              for fold in folds}
    (root / "shortlist-validation.json").write_text(json.dumps(scores), encoding="utf-8")
