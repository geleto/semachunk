# Minimal Semantic Chunker

A lightweight, dependency-free (almost) library for semantically chunking text. This library is designed to be model-agnostic, allowing you to plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple batch callback.

## Origin

This project is derived from the original [semantic-chunking](https://github.com/jparkerweb/semantic-chunking) library by `jparkerweb`.

### Key Changes from Original
1.  **Zero Heavy Dependencies**: Removed `@xenova/transformers`, `fs`, and all built-in model handling. The only remaining dependency is `sentence-parse` for robust sentence splitting.
2.  **Model Agnostic**: Instead of managing ONNX models internally, this library accepts an `embedBatchCallback` function. You control the embeddings; we control the chunking.
3.  **Optimized Merging Algorithm**: Uses a more optimal algorithm than the original. Instead of linear merges, it selects the best chunk pairs from the text to merge first. It also recalculates embeddings in batches for significantly better speed, especially with external embedding models.

## Usage

```javascript
import { chunkText } from './src/index.js';

// 1. Define your embedding callback
async function myEmbedder(texts) {
    // Call OpenAI, local model, etc.
    // Return array of vectors: [[0.1, ...], [0.2, ...]]
    return await openai.embeddings.create({ input: texts });
}

// 2. Chunk your text
const text = "Your long document text...";
const chunks = await chunkText(text, myEmbedder, {
    maxChunkSize: 500,
    similarityThreshold: 0.5,
    maxUncappedPasses: 10
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
| `maxUncappedPasses` | 16 | Max number of passes where merges are NOT throttled (capped passes are unlimited) |
| `maxMergesPerPass` | `50` | Absolute limit on the number of merges per pass. |
| `maxMergesPerPassPercentage` | `0.4` | Percentage of valid merge candidates to execute per pass (0.4 = 40%). |
| `returnEmbedding` | `true` | Include embeddings in the output |

| `chunkPrefix` | `''` | Prefix to add to each chunk before embedding |
| `excludeChunkPrefixInResults` | `false` | Exclude the prefix from the returned text |
