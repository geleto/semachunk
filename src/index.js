import { computeAdvancedSimilarities, documentMergeThreshold, groupAdjacentSentences } from './similarity.js';
import { parseSentences } from './sentences.js';
import { copyEmbedding, createBatchEmbedder } from './embeddings.js';
import { mergeChunks } from './merge.js';
import { DEFAULT_CONFIG } from '../config.js';
import { createJoinCheck, sentenceTokenLimit, tokenBudget } from './token-limit.js';

/**
 * Chunk text semantically using batch embeddings
 * @param {string} text - Input text to chunk
 * @param {Function} embedBatchCallback - async (texts[]) => embeddings[][]
 * @param {Object} options - Chunking options
 * @returns {Array} chunks - [{ text, embedding }, ...]
 */
export async function chunkText(text, embedBatchCallback, options = {}) {
	const {
		logging = DEFAULT_CONFIG.LOGGING,
		inputFormat = DEFAULT_CONFIG.INPUT_FORMAT,
		locale = DEFAULT_CONFIG.LOCALE,
		maxChunkSize = DEFAULT_CONFIG.MAX_CHUNK_SIZE,
		maxChunkTokens = DEFAULT_CONFIG.MAX_CHUNK_TOKENS,
		countTokens,
		maxEmbeddingBatchSize = DEFAULT_CONFIG.MAX_EMBEDDING_BATCH_SIZE,
		maxCachedEmbeddings = DEFAULT_CONFIG.MAX_CACHED_EMBEDDINGS,
		similarityThreshold = DEFAULT_CONFIG.SIMILARITY_THRESHOLD,
		groupSentences = DEFAULT_CONFIG.GROUP_SENTENCES,
		excludeNonLetterSentences = DEFAULT_CONFIG.EXCLUDE_NON_LETTER_SENTENCES,
		dynamicThresholdLowerBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_LOWER_BOUND,
		dynamicThresholdUpperBound = DEFAULT_CONFIG.DYNAMIC_THRESHOLD_UPPER_BOUND,
		combineChunks = DEFAULT_CONFIG.COMBINE_CHUNKS,
		combineChunksSimilarityThreshold = options?.similarityThreshold ?? DEFAULT_CONFIG.COMBINE_CHUNKS_SIMILARITY_THRESHOLD,
		mergeThresholdMode = DEFAULT_CONFIG.MERGE_THRESHOLD_MODE,
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
	for (const [name, value] of Object.entries({
		similarityThreshold, combineChunksSimilarityThreshold, dynamicThresholdLowerBound, dynamicThresholdUpperBound
	})) {
		if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	}
	if (dynamicThresholdLowerBound > dynamicThresholdUpperBound) {
		throw new RangeError('dynamicThresholdLowerBound must be at most dynamicThresholdUpperBound.');
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
	const embedBatch = createBatchEmbedder(embedBatchCallback, maxEmbeddingBatchSize, maxCachedEmbeddings);
	if (logging) await _printVersion();
	const prefix = chunkPrefix?.trim() ? chunkPrefix + ': ' : '';
	const fits = tokenBudget(maxChunkTokens, countTokens, prefix);
	let output;
	if (inputFormat === 'markdown') {
		if (groupSentences) throw new TypeError('Markdown does not support groupSentences.');
		const { parseMarkdown, packMarkdown, markdownResult } = await import('./markdown.js').catch(error => {
			if (error.code === 'ERR_MODULE_NOT_FOUND' && /package '(?:mdast-util|micromark-extension)-/.test(error.message)) {
				throw new Error('Markdown input requires optional packages. Run npm install mdast-util-from-markdown mdast-util-gfm mdast-util-frontmatter micromark-extension-gfm micromark-extension-frontmatter.', { cause: error });
			}
			throw error;
		});
		let units = parseMarkdown(text, { maxChunkSize, fits, locale, excludeNonLetterSentences });
		if (combineChunks) units = packMarkdown(text, units, maxChunkSize, fits);
		output = units.map(unit => markdownResult(text, unit));
	} else {
		const sentences = await parseSentences(text, { inputFormat, locale, excludeNonLetterSentences });
		if (sentences.length === 0) return [];

		const tokenLimit = sentenceTokenLimit(sentences, fits);
		const canJoin = createJoinCheck(maxChunkSize, tokenLimit);
		let cutoff = combineChunksSimilarityThreshold;
		let calibrate = mergeThresholdMode === 'document' && options?.combineChunksSimilarityThreshold === undefined;
		let chunks = sentences;
		if (groupSentences && sentences.length > 1) {
			const grouping = { maxChunkSize, canJoin, similarityThreshold, dynamicThresholdLowerBound, dynamicThresholdUpperBound, logging };
			const analysis = await computeAdvancedSimilarities(sentences, embedBatch, grouping);
			chunks = await groupAdjacentSentences(sentences, embedBatch, grouping, analysis);
			if (calibrate) {
				cutoff = documentMergeThreshold(analysis, cutoff);
				calibrate = false;
			}
		}
		if (logging) console.log('Initial chunks', chunks.map(chunk => chunk.slice(0, 50)));

		const outputText = text => prefix + text;
		if (combineChunks && chunks.length > 1) {
			chunks = await mergeChunks(chunks, embedBatch, {
				maxChunkSize, canJoin, tokenLimit, logging,
				combineChunksSimilarityThreshold: cutoff, calibrate,
				maxPasses,
				maxUncappedPasses,
				maxMergesPerPass,
				candidateMergesPercentageCap,
				uncappedCandidateMerges,
				finalEmbeddingText: returnEmbedding && maxCachedEmbeddings === Infinity ? outputText : undefined
			});
			if (logging) console.log('Combined chunks', chunks.map(chunk => chunk.slice(0, 100)));
		}

		if (tokenLimit?.oversized.size) chunks = chunks.flatMap(text => tokenLimit.oversized.get(text) ?? [text]);
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
