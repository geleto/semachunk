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

### 2. Iterative Optimization (Global Priority Merge)
Unlike standard chunkers that do a single linear pass, this library uses a **Global Priority Merge** strategy to iteratively refine chunks:

1.  **Calculate All Pairs**: We calculate the similarity for *all* adjacent pairs of chunks.
2.  **Global Ranking**: We sort all pairs by similarity score (highest to lowest).
3.  **Priority Merge**: We iterate through the sorted list and merge the best pairs first. Crucially, we skip any pair where one of the chunks has already been merged in the current pass. This ensures the *strongest* semantic bonds form first, independent of their position in the text.
4.  **Batch Re-embedding**: We batch-generate embeddings for the newly formed chunks.
5.  **Repeat**: We repeat the process until no more merges occur or `maxPasses` is reached.

#### Comparison: Global Priority Merge vs. Linear Scan

| Feature | Original (Linear Scan) | New (Global Priority Merge) |
| :--- | :--- | :--- |
| **Merge Order** | **Greedy (Left-to-Right)**. Biased by sentence order. If `A-B` is 0.6 and `B-C` is 0.9, it might merge `A-B` first just because it sees it first. | **Global Best-First**. Merges `B-C` (0.9) first, preserving the strongest topic core. |
| **Drift Resistance** | Low. Can easily drift from Topic A to Z. | **High**. By forming strong cores first, it naturally resists drifting into unrelated topics. |
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

### 2. Iterative Optimization (Global Priority Merge)
Unlike standard chunkers that do a single linear pass, this library uses a **Global Priority Merge** strategy to iteratively refine chunks:

1.  **Calculate All Pairs**: We calculate the similarity for *all* adjacent pairs of chunks.
2.  **Global Ranking**: We sort all pairs by similarity score (highest to lowest).
3.  **Priority Merge**: We iterate through the sorted list and merge the best pairs first. Crucially, we skip any pair where one of the chunks has already been merged in the current pass. This ensures the *strongest* semantic bonds form first, independent of their position in the text.
4.  **Batch Re-embedding**: We batch-generate embeddings for the newly formed chunks.
5.  **Repeat**: We repeat the process until no more merges occur or `maxPasses` is reached.

#### Comparison: Global Priority Merge vs. Linear Scan

| Feature | Original (Linear Scan) | New (Global Priority Merge) |
| :--- | :--- | :--- |
| **Merge Order** | **Greedy (Left-to-Right)**. Biased by sentence order. If `A-B` is 0.6 and `B-C` is 0.9, it might merge `A-B` first just because it sees it first. | **Global Best-First**. Merges `B-C` (0.9) first, preserving the strongest topic core. |
| **Drift Resistance** | Low. Can easily drift from Topic A to Z. | **High**. By forming strong cores first, it naturally resists drifting into unrelated topics. |
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

### 2. Iterative Optimization (Global Priority Merge)
Unlike standard chunkers that do a single linear pass, this library uses a **Global Priority Merge** strategy to iteratively refine chunks:

1.  **Calculate All Pairs**: We calculate the similarity for *all* adjacent pairs of chunks.
2.  **Global Ranking**: We sort all pairs by similarity score (highest to lowest).
3.  **Priority Merge**: We iterate through the sorted list and merge the best pairs first. Crucially, we skip any pair where one of the chunks has already been merged in the current pass. This ensures the *strongest* semantic bonds form first, independent of their position in the text.
4.  **Batch Re-embedding**: We batch-generate embeddings for the newly formed chunks.
5.  **Repeat**: We repeat the process until no more merges occur or `maxPasses` is reached.

#### Comparison: Global Priority Merge vs. Linear Scan

| Feature | Original (Linear Scan) | New (Global Priority Merge) |
| :--- | :--- | :--- |
| **Merge Order** | **Greedy (Left-to-Right)**. Biased by sentence order. If `A-B` is 0.6 and `B-C` is 0.9, it might merge `A-B` first just because it sees it first. | **Global Best-First**. Merges `B-C` (0.9) first, preserving the strongest topic core. |
| **Drift Resistance** | Low. Can easily drift from Topic A to Z. | **High**. By forming strong cores first, it naturally resists drifting into unrelated topics. |
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
| `combineChunks` | `true` | Enable the iterative merging optimization |
| `maxUncappedPasses` | 16 | Max number of passes where merges are NOT throttled (capped passes are unlimited) |
| `maxMergesPerPass` | `50` | Absolute limit on the number of merges per pass. |
| `maxMergesPerPassPercentage` | `0.4` | Percentage of valid merge candidates to execute per pass (0.4 = 40%). |
