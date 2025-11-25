import { chunkText } from './src/index.js';

// Mock embedding function for "Drift Correction"
// Geometry:
// A = 0 deg.
// B = 60 deg.
// C = 30 deg.

// A~B (60 deg) -> Sim 0.5. (Fail < 0.6).
// B~C (30 deg) -> Sim 0.866. (Merge > 0.6).
// Avg(B,C) -> 45 deg.
// A~Avg (45 deg) -> Sim 0.707. (Merge > 0.6).

async function mockBatchEmbed(texts) {
	return texts.map(text => {
		const vector = new Array(384).fill(0);

		// Handle [A B C] - Check for all 3 components explicitly
		if (text.includes("Topic A.") && text.includes("Blocker") && text.includes("Topic A-ish")) {
			vector[0] = 0.8; vector[1] = 0.4; // Approx avg
			return vector;
		}

		// Handle merged [B C]
		if (text.includes("Blocker") && text.includes("Topic A-ish")) {
			// Avg(60, 30) -> 45 deg.
			// [0.683, 0.683].
			vector[0] = 0.683; vector[1] = 0.683;
			return vector;
		}

		// Check for specific strings first (longest match first)
		if (text.includes("Topic A-ish")) { // C (30 deg)
			vector[0] = 0.866; vector[1] = 0.5;
		}
		else if (text.includes("Topic A.")) { // A (0 deg) - Check for dot to avoid matching "Topic A-ish"
			vector[0] = 1; vector[1] = 0;
		}
		else if (text.includes("Blocker")) { // B (60 deg)
			vector[0] = 0.5; vector[1] = 0.866;
		}

		return vector;
	});
}

const testText =
	`This is Topic A.
This is a Blocker sentence.
This is Topic A-ish.`;

async function runTest() {
	console.log("--- TEST: Multi-Pass Merge (The 'Hidden Friend' Scenario) ---");

	console.log("\nRunning with combineChunks = false (Pass 0 only)...");
	const chunks1 = await chunkText(testText, mockBatchEmbed, {
		similarityThreshold: 0.6,
		combineChunksSimilarityThreshold: 0.6,
		numSimilaritySentencesLookahead: 0, // CRITICAL: Disable lookahead
		dynamicThresholdLowerBound: 0.6, // CRITICAL: Prevent auto-lowering
		logging: true,
		combineChunks: false
	});
	console.log(`Chunks: ${chunks1.length}`);
	chunks1.forEach(c => console.log(` - ${c.text}`));

	if (chunks1.length === 2) {
		console.log("✅ Pass 0 Correct (2 Chunks: A, [B C])");
	} else {
		console.error(`❌ Expected 2 chunks, got ${chunks1.length}`);
	}

	console.log("\nRunning with combineChunks = true (Optimization Enabled)...");
	const chunks5 = await chunkText(testText, mockBatchEmbed, {
		similarityThreshold: 0.6,
		combineChunksSimilarityThreshold: 0.6,
		numSimilaritySentencesLookahead: 0,
		dynamicThresholdLowerBound: 0.6,
		logging: true,
		combineChunks: true,
		maxPasses: 5
	});
	console.log(`Chunks: ${chunks5.length}`);
	chunks5.forEach(c => console.log(` - ${c.text}`));

	if (chunks5.length === 1) {
		console.log("✅ Optimization Correct (Merged [A B C]!)");
	} else {
		console.error(`❌ Expected 1 chunk, got ${chunks5.length}`);
	}
}

runTest();
