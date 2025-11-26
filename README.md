# 🍱semachunk - a Minimal Semantic Chunker

A lightweight, dependency-free (almost) TypeScript/JavaScript library for semantically chunking text.

## Features

- Zero Heavy Dependencies (only `sentence-parse`)
- Model Agnostic, plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple callback
- Batch Embeddings for Efficiency and handling API Rate Limiting
- Optimized Sentence/Chunk Merging Algorithm

## Usage

```javascript
import { chunkText } from 'semachunk';

// 1. Define your embedding callback
async function myEmbedder(texts) {
    // Return array of vectors:
    return await openai.embeddings.create({ input: texts, model: "text-embedding-3-small" });
}

// 2. Chunk your text
const text = "Your long document text...";
const chunks = await chunkText(text, myEmbedder, {
    maxChunkSize: 500,
    similarityThreshold: 0.5
});

console.log(chunks);
// Output: [{ text: "...", embedding: [...] }, ...]
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `maxChunkSize` | 500 | Max characters per chunk |
| `similarityThreshold` | 0.5 | Threshold to merge sentences/chunks |
| `dynamicThresholdLowerBound` | 0.4 | Lower bound for dynamic threshold adjustment |
| `dynamicThresholdUpperBound` | 0.8 | Upper bound for dynamic threshold adjustment |
| `numSimilaritySentencesLookahead` | 3 | Number of future sentences to look ahead for similarity context |
| `combineChunks` | `true` | Enable the iterative merging optimization |
| `combineChunksSimilarityThreshold` | 0.5 | Threshold for merging chunks during optimization pass |
| `maxUncappedPasses` | `100` | Max number of passes where merges are NOT throttled (capped passes are unlimited) |
| `maxMergesPerPass` | `50` | Absolute limit on the number of merges per pass. |
| `maxMergesPerPassPercentage` | `40` | Percentage of valid merge candidates to execute per pass. |
| `returnEmbedding` | `true` | Include embeddings in the output |
| `chunkPrefix` | `''` | Prefix to add to each chunk before embedding |
| `excludeChunkPrefixInResults` | `false` | Exclude the prefix from the returned text |

# Acknowledgements

This project is derived from the original [semantic-chunking](https://github.com/jparkerweb/semantic-chunking) library by `jparkerweb` with these changes:
- Zero Heavy Dependencies (only `sentence-parse`)
- Stripped down to the core functionality
- Model Agnostic
- Batch Embeddings for Efficiency and handling API Rate Limiting
- New optimized chunk merging algorithm