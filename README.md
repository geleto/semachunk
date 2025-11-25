# Minimal Semantic Chunker

A lightweight, dependency-free (almost) library for semantically chunking text. This library is designed to be model-agnostic, allowing you to plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple batch callback.

## Origin & Derivation

This project is a minimal extraction and refactor of the original [semantic-chunking](https://github.com/jparkerweb/semantic-chunking) library by `jparkerweb`.

### Key Changes from Original
1.  **Zero Heavy Dependencies**: Removed `@xenova/transformers`, `fs`, and all built-in model handling. The only remaining dependency is `sentence-parse` for robust sentence splitting.
2.  **Model Agnostic**: Instead of managing ONNX models internally, this library accepts an `embedBatchCallback` function. You control the embeddings; we control the chunking.
3.  **Iterative Optimization Algorithm**: Replaced the original single-pass merging logic with an **Iterative Hierarchical-like Merge** strategy using **chained comparisons**. This approach focuses on **batch embedding calculations** and has both advantages and disadvantages compared to the original approach (see below).

## The Algorithm

The core value of this library is its sophisticated chunking strategy, designed to preserve semantic integrity better than naive sliding windows.

### 1. Semantic Splitting
Text is split into sentences using `sentence-parse`. We then calculate the cosine similarity between adjacent sentences to identify "semantic breakpoints" where the topic shifts.

### 2. Iterative Optimization (The "Multi-Pass" Approach)
Unlike standard chunkers that do a single linear pass, this library uses an iterative approach to merge chunks:

1.  **Linear Scan**: We scan the list of chunks (initially sentences).
# Minimal Semantic Chunker

A lightweight, dependency-free (almost) library for semantically chunking text. This library is designed to be model-agnostic, allowing you to plug in any embedding provider (OpenAI, HuggingFace, etc.) via a simple batch callback.

## Origin & Derivation

This project is a minimal extraction and refactor of the original [semantic-chunking](https://github.com/jparkerweb/semantic-chunking) library by `jparkerweb`.

### Key Changes from Original
1.  **Zero Heavy Dependencies**: Removed `@xenova/transformers`, `fs`, and all built-in model handling. The only remaining dependency is `sentence-parse` for robust sentence splitting.
2.  **Model Agnostic**: Instead of managing ONNX models internally, this library accepts an `embedBatchCallback` function. You control the embeddings; we control the chunking.
3.  **Iterative Optimization Algorithm**: Replaced the original logic with an **Iterative Hierarchical-like Merge** strategy. This approach focuses on **batch embedding calculations** and has both advantages and disadvantages compared to the original approach (see below).

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
*   **The "Magnet" Effect**: Imagine Sentence A is somewhat related to Sentence B, but not enough to trigger a merge. However, if B merges with C first, the *combined meaning* of [B+C] shifts. This new, broader topic might now be close enough to A to pull it in. The multi-pass approach allows the chunker to "change its mind" and group sentences that belong together but weren't obvious pairs in isolation.
*   **Drift Correction**: Single-pass chunkers are "greedy" and can be thrown off by local noise. Iterative re-embedding allows the chunk to "settle" into its optimal shape by continuously re-evaluating the center of gravity of the evolving chunk.
*   **Efficiency via Batching**: While multiple passes might sound slow, this library is designed for **batching**. By sending all new chunks to the embedding provider in a single API call per pass, we drastically reduce network latency and avoid hitting rate limits compared to processing chunks one by one.

#### Comparison: Chained Multi-Pass vs. Original Single-Pass

| Feature | Original (Single-Pass) | New (Chained Multi-Pass) |
| :--- | :--- | :--- |
| **Comparison Strategy** | Typically compares `Chunk A` to `Chunk B`. If merged, compares the *cumulative* `[A+B]` to `C`. | **Chained**: Compares `A` to `B`. If merged, compares the *tail* (`B`) to `C` in the first pass. In subsequent passes, it re-embeds and compares the *whole chunk* `[A+B]` to `C`. |
| **Context Awareness** | **Greedy**. Decisions are final based on local context. Good for speed, but can be brittle. | **Converging**. Re-evaluates merges as the chunk grows and shifts in meaning ("Magnet Effect"). Better for quality. |
| **Embedding Calls** | Sequential (often one by one). | **Batched**. Embeds all new chunks in parallel per pass. |
| **Latency** | Lower for simple texts. | Higher due to multiple embedding rounds, but optimized via batching. |

### Disadvantages:
1.  **Risk of Semantic Drift**: The "Magnet Effect" is a double-edged sword. By merging based on the *combined* embedding, the topic can gradually shift. A chunk might start with "Topic A", merge with a bridge topic, and end with "Topic Z", where A and Z are unrelated. The original algorithm (which compared against specific parts) was more resistant to this gradual shift.

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
    similarityThreshold: 0.5,
    maxPasses: 5 // Enable multi-pass optimization
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
| `maxPasses` | 5 | Max iterations for optimization (1 = single pass) |
