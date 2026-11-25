import { parseText } from './sentences.js';
import { copyEmbedding, createBatchEmbedder } from './embeddings.js';
import { mergeChunks } from './merge.js';
import { packSentences } from './packing.js';
import { DEFAULT_CONFIG } from '../config.js';
import { sentenceTokenLimit, tokenBudget } from './token-limit.js';

function resolveStrategy(strategy, inputFormat, combineChunks, maxChunkSize, maxChunkTokens, chunkOverlap) {
	if (!['auto', 'blocks', 'pack', 'semantic'].includes(strategy)) {
		throw new TypeError("chunkingStrategy must be 'auto', 'blocks', 'pack' or 'semantic'.");
	}
	if (!Number.isSafeInteger(chunkOverlap) || chunkOverlap < 0) {
		throw new RangeError('chunkOverlap must be a nonnegative safe integer.');
	}
	if (strategy === 'auto') {
		if (!combineChunks) strategy = inputFormat === 'markdown' ? 'blocks' : 'sentences';
		else if (chunkOverlap || (inputFormat === 'markdown' &&
			(maxChunkSize <= DEFAULT_CONFIG.MARKDOWN_MAX_CHUNK_SIZE || maxChunkTokens < 256))) strategy = 'pack';
		else strategy = 'semantic';
	}
	if (chunkOverlap && strategy !== 'pack') throw new RangeError("chunkOverlap requires the 'pack' strategy.");
	return strategy;
}

/**
 * Chunk text by structure, size or embedding similarity.
 * @param {string} text - Input text to chunk
 * @param {Function} embedBatchCallback - async (texts[]) => embeddings[][]
 * @param {Object} options - Chunking options
 * @returns {Array} chunks - [{ text, embedding }, ...]
 */
export async function chunkText(text, embedBatchCallback, options = {}) {
	const {
		logging = DEFAULT_CONFIG.LOGGING,
		inputFormat = DEFAULT_CONFIG.INPUT_FORMAT,
		chunkingStrategy = DEFAULT_CONFIG.CHUNKING_STRATEGY,
		chunkOverlap = DEFAULT_CONFIG.CHUNK_OVERLAP,
		locale = DEFAULT_CONFIG.LOCALE,
		maxChunkSize = inputFormat === 'markdown' ? DEFAULT_CONFIG.MARKDOWN_MAX_CHUNK_SIZE : DEFAULT_CONFIG.MAX_CHUNK_SIZE,
		maxChunkTokens = DEFAULT_CONFIG.MAX_CHUNK_TOKENS,
		countTokens,
		maxEmbeddingBatchSize = DEFAULT_CONFIG.MAX_EMBEDDING_BATCH_SIZE,
		maxCachedEmbeddings = DEFAULT_CONFIG.MAX_CACHED_EMBEDDINGS,
		mergeThresholdMode = inputFormat === 'markdown' ? 'document' : DEFAULT_CONFIG.MERGE_THRESHOLD_MODE,
		similarityThreshold = inputFormat !== 'markdown' && mergeThresholdMode === 'fixed'
			? DEFAULT_CONFIG.COMBINE_CHUNKS_SIMILARITY_THRESHOLD
			: DEFAULT_CONFIG.SIMILARITY_THRESHOLD,
		excludeNonLetterSentences = DEFAULT_CONFIG.EXCLUDE_NON_LETTER_SENTENCES,
		combineChunks = DEFAULT_CONFIG.COMBINE_CHUNKS,
		combineChunksSimilarityThreshold = similarityThreshold,
		maxPasses = DEFAULT_CONFIG.MAX_PASSES,
		maxUncappedPasses = DEFAULT_CONFIG.MAX_UNCAPPED_PASSES,
		returnEmbedding = DEFAULT_CONFIG.RETURN_EMBEDDING,
		chunkPrefix = DEFAULT_CONFIG.CHUNK_PREFIX,
		excludeChunkPrefixInResults = DEFAULT_CONFIG.EXCLUDE_CHUNK_PREFIX_IN_RESULTS,
		maxMergesPerPass = DEFAULT_CONFIG.MAX_MERGES_PER_PASS,
		candiateMergesPercentageCap = DEFAULT_CONFIG.MAX_MERGES_PER_PASS_PERCENTAGE,
		candidateMergesPercentageCap = candiateMergesPercentageCap,
		uncappedCandidateMerges = DEFAULT_CONFIG.UNCAPPED_CANDIDATE_MERGES
	} = options ?? {};

	if (typeof text !== 'string') {
		throw new TypeError('Input must be a string');
	}
	for (const [name, value] of Object.entries({ similarityThreshold, combineChunksSimilarityThreshold })) {
		if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	}
	for (const [name, value] of Object.entries({ maxChunkSize, maxPasses, maxUncappedPasses, maxMergesPerPass, uncappedCandidateMerges })) {
		if (value !== Infinity && !(Number.isSafeInteger(value) && value >= 0)) {
			throw new RangeError(`${name} must be a nonnegative safe integer or Infinity.`);
		}
	}
	if (mergeThresholdMode !== 'fixed' && mergeThresholdMode !== 'document') {
		throw new TypeError("mergeThresholdMode must be 'fixed' or 'document'.");
	}
	if (maxChunkTokens !== Infinity && !(Number.isSafeInteger(maxChunkTokens) && maxChunkTokens > 0)) {
		throw new RangeError('maxChunkTokens must be a positive safe integer or Infinity.');
	}
	if ((maxChunkTokens !== Infinity || countTokens !== undefined) && typeof countTokens !== 'function') {
		throw new TypeError('A finite maxChunkTokens requires a countTokens function.');
	}
	if (!Number.isFinite(candidateMergesPercentageCap) || candidateMergesPercentageCap < 0 || candidateMergesPercentageCap > 100) {
		throw new RangeError('candidateMergesPercentageCap (legacy candiateMergesPercentageCap) must be between 0 and 100.');
	}
	const strategy = resolveStrategy(chunkingStrategy, inputFormat, combineChunks, maxChunkSize, maxChunkTokens, chunkOverlap);
	const embedBatch = createBatchEmbedder(embedBatchCallback, maxEmbeddingBatchSize, maxCachedEmbeddings);
	if (logging) await _printVersion();
	const prefix = chunkPrefix?.trim() ? chunkPrefix + ': ' : '';
	const fits = tokenBudget(maxChunkTokens, countTokens, prefix);
	const fitsOverlap = chunkOverlap > 0 && (maxChunkTokens === Infinity
		? text => text.length <= chunkOverlap : tokenBudget(chunkOverlap, countTokens, ''));
	const parsing = { strategy, fits, locale, excludeNonLetterSentences, maxChunkSize };
	const priority = {
		maxChunkSize, maxPasses, maxUncappedPasses, maxMergesPerPass, candidateMergesPercentageCap,
		uncappedCandidateMerges, combineChunksSimilarityThreshold,
		calibrate: mergeThresholdMode === 'document' && options?.combineChunksSimilarityThreshold === undefined
	};
	let output;
	if (inputFormat === 'markdown') {
		const { chunkMarkdown } = await import('./markdown-merge.js').catch(error => {
			if (error.code === 'ERR_MODULE_NOT_FOUND' && /package '(?:mdast-util|micromark-extension)-/.test(error.message)) {
				throw new Error('Markdown input requires the optional Markdown parsers. Run npm install --include=optional.', { cause: error });
			}
			throw error;
		});
		output = await chunkMarkdown(text, embedBatch, { ...priority, ...parsing, fitsOverlap });
	} else {
		let chunks = await parseText(text, { ...parsing, inputFormat });
		if (chunks.length === 0) return [];
		if (logging) console.log('Initial chunks', chunks.map(chunk => chunk.slice(0, 50)));

		if (strategy === 'pack') chunks = packSentences(chunks, maxChunkSize, fits, fitsOverlap);
		else if (strategy !== 'blocks') {
			const tokenLimit = sentenceTokenLimit(chunks, fits);
			if (strategy === 'semantic' && chunks.length > 1) {
				chunks = await mergeChunks(chunks, embedBatch, {
					...priority, tokenLimit, logging,
					finalEmbeddingText: returnEmbedding && maxCachedEmbeddings === Infinity ? text => prefix + text : undefined
				});
				if (logging) console.log('Combined chunks', chunks.map(chunk => chunk.slice(0, 100)));
			}
			if (tokenLimit?.oversized.size) chunks = chunks.flatMap(text => tokenLimit.oversized.get(text) ?? [text]);
		}
		output = chunks.map(text => ({ text }));
	}
	if (!prefix && !returnEmbedding) return output;
	const indexed = output.map(chunk => {
		const text = prefix + chunk.text;
		if (prefix && !excludeChunkPrefixInResults) {
			chunk.text = text;
			for (const range of chunk.sourceRanges ?? []) range.outputStart += prefix.length;
		} else if (prefix && inputFormat === 'markdown') chunk.embeddingText = text;
		return text;
	});
	if (returnEmbedding) {
		const embeddings = await embedBatch(indexed);
		const seen = new Set();
		output.forEach((chunk, i) => {
			const vector = embeddings[i];
			chunk.embedding = seen.has(vector) ? copyEmbedding(vector) : vector;
			seen.add(vector);
		});
	}
	return output;
}

export async function _printVersion() {
	const { readFile } = await import('node:fs/promises');
	const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const versionText = `-- semachunk v${version} --`;
	const lineLength = versionText.length;
	console.log(`\n${'-'.repeat(lineLength)}\n${versionText}\n${'-'.repeat(lineLength)}`);
}
