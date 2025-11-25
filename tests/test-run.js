import { chunkText } from '../src/index.js';
import { parseSentences } from 'sentence-parse';

// Mock embedding function that returns vectors based on content
// to simulate semantic similarity
async function mockBatchEmbed(texts) {
	// console.log(`Batch embedding ${texts.length} texts...`);
	return texts.map(text => {
		// Create a 384-dimensional vector (standard size)
		const vector = new Array(384).fill(0.01); // Fill with small noise

		// Topic 1: Dogs/Intro (Sentences 1 & 2)
		if (text.includes("first sentence") || text.includes("second sentence")) {
			vector[0] = 1;
		}
		// Topic 2: Physics (Sentences 3 & 4)
		else if (text.includes("quantum") || text.includes("mechanics")) {
			vector[10] = 1;
		}
		// Topic 3: Pets/Companions (Sentences 5 & 6)
		else if (text.includes("pets") || text.includes("companions")) {
			vector[20] = 1;
		}

		if (text.includes("first sentence") || text.includes("second sentence")) vector[0] = 1;
		if (text.includes("quantum") || text.includes("mechanics")) vector[10] = 1;
		if (text.includes("pets") || text.includes("companions")) vector[20] = 1;

		return vector;
	});
}

// Adjusted to have exactly 6 sentences
const testText =
	`This is the first sentence about dogs.
The second sentence also discusses dogs and their behavior.
Now we switch topics entirely to talk about quantum physics.
Quantum mechanics is a fascinating subject.
Let's go back to talking about pets and animals.
Dogs make great companions.`;

console.log('Starting chunking...');

async function runTest() {
	try {
		// 1. Verify Initial State
		const initialSentences = await parseSentences(testText);
		console.log(`Initial sentences: ${initialSentences.length}`);
		if (initialSentences.length !== 6) {
			throw new Error(`Expected 6 initial sentences, found ${initialSentences.length}`);
		}

		// 2. Run Chunking
		const chunks = await chunkText(testText, mockBatchEmbed, {
			similarityThreshold: 0.5
		});

		console.log('Generated chunks:', chunks.length);
		chunks.forEach((chunk, i) => {
			console.log(`\nChunk ${i + 1}:`);
			console.log(chunk.text);

		});

		// 3. Verify Final State
		if (chunks.length !== 3) {
			throw new Error(`Expected 3 final chunks, found ${chunks.length}`);
		}

		console.log('\n✅ TEST PASSED: 6 Sentences -> 3 Chunks');

	} catch (error) {
		console.error('❌ TEST FAILED:', error);
		process.exit(1);
	}
}

runTest();
