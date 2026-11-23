"""Run the published splitter against the benchmark's exact cached embeddings."""

import json
import sys
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from langchain_experimental.text_splitter import SemanticChunker, combine_sentences


def windows(text):
    splitter = SemanticChunker(None)
    parts = splitter._get_single_sentences_list(text)
    if len(parts) == 1:
        return []
    sentences = [{"sentence": part, "index": i} for i, part in enumerate(parts)]
    return [s["combined_sentence"] for s in combine_sentences(sentences, splitter.buffer_size)]


def main():
    docs = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    if sys.argv[1] == "windows":
        return [windows(text) for text, _ in docs]
    vectors = np.fromfile(sys.argv[3], dtype=np.float32).reshape(-1, int(sys.argv[4]))
    cursor = 0
    layouts = []
    for text, count in docs:
        inputs = windows(text)
        block = vectors[cursor:cursor + len(inputs)]
        cursor += len(inputs)

        def embed_documents(requested):
            if requested != inputs or len(block) != len(inputs):
                raise ValueError("Cached embeddings differ from the native splitter request")
            return block.astype(np.float64)

        embeddings = SimpleNamespace(embed_documents=embed_documents)
        layouts.append([SemanticChunker(embeddings, number_of_chunks=n).split_text(text) for n in (None, count)])
    if cursor != len(vectors):
        raise ValueError("Unconsumed embedding rows")
    return {"layouts": layouts, "versions": {p: version(p) for p in
            ("langchain-experimental", "langchain-community", "langchain-core", "numpy")}}


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=True, separators=(",", ":")))
