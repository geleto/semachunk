import { chunkText } from './src/index.js';

// Mock embedder that returns random embeddings
async function mockEmbedder(texts) {
	return texts.map(() => Array(1536).fill(0).map(() => Math.random()));
}

async function runTest() {
	console.log('Running uncappedCandidateMerges test...');

	const sentences = [
		"Sentence 1.", "Sentence 2.", "Sentence 3.", "Sentence 4.", "Sentence 5.",
		"Sentence 6.", "Sentence 7.", "Sentence 8.", "Sentence 9.", "Sentence 10."
	];
	const text = sentences.join(' ');

	// Test with low percentage cap and high uncapped limit
	// With 10 sentences, we have ~9 candidates initially.
	// 10% cap would be 0.9 -> 0 merges (if floor) or 1 merge (if max(1, ...)).
	// But we set uncappedCandidateMerges to 5.
	// So we expect at least 5 merges in the first pass if similarities allow.

	// To ensure similarities allow, we need to mock embeddings or force high similarity.
	// Since we can't easily force high similarity with random embeddings,
	// we'll rely on the fact that with random embeddings, some will be similar enough if threshold is low.
	// Or better, we can mock the embedder to return identical embeddings for pairs we want to merge.

	// Let's use a custom embedder that returns identical embeddings for all sentences
	// This ensures all adjacent chunks are candidates (similarity = 1.0)
	async function identicalEmbedder(texts) {
		return texts.map(() => Array(10).fill(0.1)); // All identical
	}

	const options = {
		maxChunkSize: 1000,
		similarityThreshold: 0.0, // Merge everything
		combineChunks: true,
		combineChunksSimilarityThreshold: 0.0,
		maxUncappedPasses: 10,
		maxMergesPerPass: 100,
		candiateMergesPercentageCap: 10, // 10% of 9 candidates = 0.9 -> 0
		uncappedCandidateMerges: 5, // Should override percentage cap
		returnEmbedding: false,
		logging: true
	};

	console.log('Chunking with options:', JSON.stringify(options, null, 2));
	const chunks = await chunkText(text, identicalEmbedder, options);

	console.log(`Resulting chunks: ${chunks.length}`);
	// Initial: 10 chunks
	// Candidates: 9
	// Percentage limit: floor(9 * 0.1) = 0
	// Uncapped limit: 5
	// Effective limit: max(0, 5) = 5
	// So in the first pass, we should merge 5 pairs.
	// Wait, merges reduce the number of chunks.
	// If we merge 5 pairs, we reduce count by 5?
	// Pair 1+2, 3+4, 5+6, 7+8, 9+10 -> 5 chunks remaining?
	// Or 1+2, 2+3 (conflict)...
	// The algorithm sorts by similarity. Since all are identical, order is stable (index order).
	// 1+2 merged. 2 is gone. 3 is next.
	// 3+4 merged.
	// 5+6 merged.
	// 7+8 merged.
	// 9+10 merged.
	// Total 5 merges.
	// Remaining chunks: 5.

	if (chunks.length <= 5) {
		console.log('SUCCESS: uncappedCandidateMerges allowed enough merges.');
	} else {
		console.error(`FAILURE: Expected <= 5 chunks, got ${chunks.length}. uncappedCandidateMerges might not be working.`);
		process.exit(1);
	}
}

runTest().catch(err => {
	console.error(err);
	process.exit(1);
});
