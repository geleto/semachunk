"""Run the frozen profiles. Each worker owns a source cohort and checkpoints its shards."""
import argparse
import concurrent.futures
import json
import math
import os
import subprocess
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "results/2026-11-26-tree-corpus.json"
CACHE = HERE / ".cache/tree-corpus"
SMALL = "text-embedding-3-small"
LARGE = "text-embedding-3-large"


def jobs(manifest):
    for model, mode in [(SMALL, "tokens"), (SMALL, "chars"), (LARGE, "tokens")]:
        for key in sorted(manifest["retrieval"]):
            if model == LARGE and key.startswith("government-") and "-ssa-" not in key:
                continue
            yield model, mode, key, 0
        for key, cohort in manifest["boundaries"].items():
            wiki = key.startswith("wiki-")
            n = cohort["documents"]
            if model == LARGE or mode == "chars":
                if not key.endswith("-development"):
                    continue
                n = min(n, 32 if wiki else 12)
            for shard in range(math.ceil(n / (24 if wiki else 5))):
                yield model, mode, key, shard


def run_job(job):
    model, mode, key, shard = job
    base = CACHE / "runs" / model / mode
    result = base / f"{key}.{shard}.json"
    if result.is_file():
        return
    base.mkdir(parents=True, exist_ok=True)
    cmd = ["node", str(HERE / "tree-experiment.mjs"), key, mode, str(shard)]
    with (base / f"{key}.{shard}.log").open("w", encoding="utf8") as out:
        run = subprocess.run(cmd, cwd=HERE.parent, stdout=out, stderr=subprocess.STDOUT,
                             env={**os.environ, "SEMACHUNK_BENCHMARK_MODEL": model})
    if run.returncode:
        raise RuntimeError(f"{model}/{mode}/{key}.{shard} failed. See {base / (key + '.' + str(shard) + '.log')}")
    print(model, mode, key, shard, flush=True)


def run_all(workers):
    manifest = json.loads(MANIFEST.read_text("utf8"))
    groups = defaultdict(list)
    for job in jobs(manifest):
        model, mode, key, shard = job
        # Reuse archived vectors across formats, chunk limits and FAQ renderings.
        group = key.rsplit("-", 1)[0] if key.startswith(("faq-", "government-")) else key
        groups[model, group, shard].append(job)
    def run_group(group):
        for job in group:
            run_job(job)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(run_group, group) for group in groups.values()]
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except BaseException:
                for other in futures:
                    other.cancel()
                raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=3)
    run_all(parser.parse_args().workers)
