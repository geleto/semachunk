# Minimal Semantic Chunker

A lightweight, dependency-free (almost) library for semantically chunking text. This library is designed to be model-agnostic, allowing you to plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple batch callback.

## Origin & Derivation

This project is a minimal extraction and refactor of the original [semantic-chunking](https://github.com/jparkerweb/semantic-chunking) library by `jparkerweb`.

### Key Changes from Original
1.  **Zero Heavy Dependencies**: Removed `@xenova/transformers`, `fs`, and all built-in model handling. The only remaining dependency is `sentence-parse` for robust sentence splitting.
2.  **Model Agnostic**: Instead of managing ONNX models internally, this library accepts an `embedBatchCallback` function. You control the embeddings; we control the chunking.
3.  **Iterative Optimization Algorithm**: Replaced the original single-pass merging logic with a robust **Iterative Hierarchical-like Merge** strategy (see below).

## The Algorithm

The core value of this library is its sophisticated chunking strategy, designed to preserve semantic integrity better than naive sliding windows.

### 1. Semantic Splitting
Text is split into sentences using `sentence-parse`. We then calculate the cosine similarity between adjacent sentences to identify "semantic breakpoints" where the topic shifts.

### 2. Iterative Optimization (The "Multi-Pass" Approach)
Unlike standard chunkers that do a single linear pass, this library uses an iterative approach to merge chunks:

1.  **Linear Scan**: We scan the list of chunks (initially sentences).
2.  **Chain Similarity**: We merge `Chunk A` + `Chunk B` if they are similar. We then check if `Chunk C` is similar to the *tail* of the new group (`Chunk B`).
3.  **Batch Re-embedding**: After a pass of merges, we **re-calculate embeddings** for the newly formed groups.
4.  **Repeat**: We treat the new groups as atomic chunks and repeat the process.

#### Rationale for Multiple Passes
Why re-embed and repeat?
*   **Noise Reduction**: A single sentence might be noisy (dissimilar to its neighbors). But once merged into a larger group, the "average meaning" of that group might align perfectly with the next chunk.
*   **Contextual Integrity**: By re-embedding the merged group `[A B]`, we get a vector representing the *combined concept*. Comparing this new vector to `C` is far more accurate than relying on the old sentence-level vectors.
*   **Efficiency via Batching**: While multiple passes might sound slow, this library is designed for **batching**. By sending all new chunks to the embedding provider in a single API call per pass, we drastically reduce network latency and avoid hitting rate limits compared to processing chunks one by one.

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
    maxTokenSize: 500,
    similarityThreshold: 0.5
});

console.log(chunks);
// Output: [{ text: "...", embedding: [...] }, ...]
```

## Configuration

| Option | Default | Description |
|BO|BO|BO|
| `maxTokenSize` | 500 | Max approximate tokens per chunk |
| `similarityThreshold` | 0.5 | Threshold to merge sentences/chunks |
| `combineChunks` | true | Enable the iterative merging optimization |
