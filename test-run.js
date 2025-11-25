import { chunkText } from './src/index.js';

// Mock embedding function (returns random vectors for testing)
async function mockBatchEmbed(texts) {
	console.log(`Batch embedding ${texts.length} texts...`);
	return texts.map(() =>
		Array.from({ length: 384 }, () => Math.random())
	);
}

const testText = `
This is the first sentence. It talks about dogs.
The second sentence also discusses dogs and their behavior.
Now we switch topics entirely to talk about quantum physics.
Quantum mechanics is a fascinating subject.
Let's go back to talking about pets and animals.
Dogs make great companions.
`;

console.log('Starting chunking...');
try {
	const chunks = await chunkText(testText, mockBatchEmbed, {
		similarityThreshold: 0.5
	});

	console.log('Generated chunks:', chunks.length);
	chunks.forEach((chunk, i) => {
		console.log(`\nChunk ${i + 1}:`);
		console.log(chunk.text);
		console.log('Embedding length:', chunk.embedding ? chunk.embedding.length : 'None');
	});
} catch (error) {
	console.error('Error during chunking:', error);
}
