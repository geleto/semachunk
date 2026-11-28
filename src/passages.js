import { parseText, sentenceLocale } from './sentences.js';
import { copyEmbedding, createBatchEmbedder } from './embeddings.js';
import { chunkDelimited, packSentences } from './packing.js';
import { DEFAULT_CONFIG } from '../config.js';
import { tokenBudget } from './token-limit.js';
import { sliceView } from './citations.js';

export function defaultCharacterTarget(format) {
	if (format === 'json') return DEFAULT_CONFIG.JSON_MAX_CHUNK_SIZE;
	return format === 'markdown' || format === 'html' ? DEFAULT_CONFIG.MARKDOWN_MAX_CHUNK_SIZE : DEFAULT_CONFIG.MAX_CHUNK_SIZE;
}

export function validateStrategy(strategy, inputFormat, chunkOverlap) {
	if (!['blocks', 'pack', 'semantic'].includes(strategy)) {
		throw new TypeError("strategy must be 'blocks', 'pack' or 'semantic'.");
	}
	if (!Number.isSafeInteger(chunkOverlap) || chunkOverlap < 0) {
		throw new RangeError('chunkOverlap must be a nonnegative safe integer.');
	}
	if (inputFormat === 'json' && strategy !== 'blocks') throw new TypeError("JSON input requires the 'blocks' strategy.");
	if (chunkOverlap && strategy !== 'pack') throw new RangeError("chunkOverlap requires the 'pack' strategy.");
}

export async function splitPassages(text, embedBatchCallback, options, capture) {
	const {
		logging = DEFAULT_CONFIG.LOGGING,
		inputFormat = DEFAULT_CONFIG.INPUT_FORMAT,
		chunkingStrategy: strategy = DEFAULT_CONFIG.CHUNKING_STRATEGY,
		separator,
		chunkOverlap = DEFAULT_CONFIG.CHUNK_OVERLAP,
		locale = DEFAULT_CONFIG.LOCALE,
		maxChunkSize = defaultCharacterTarget(inputFormat),
		maxChunkTokens = DEFAULT_CONFIG.MAX_CHUNK_TOKENS,
		countTokens,
		maxEmbeddingBatchSize = DEFAULT_CONFIG.MAX_EMBEDDING_BATCH_SIZE,
		maxCachedEmbeddings = DEFAULT_CONFIG.MAX_CACHED_EMBEDDINGS,
		mergeThresholdMode = DEFAULT_CONFIG.MERGE_THRESHOLD_MODE,
		similarityThreshold = mergeThresholdMode === 'document' ? DEFAULT_CONFIG.SIMILARITY_THRESHOLD : DEFAULT_CONFIG.SEMANTIC_SIMILARITY_THRESHOLD,
		excludeNonLetterSentences = DEFAULT_CONFIG.EXCLUDE_NON_LETTER_SENTENCES,
		combineChunksSimilarityThreshold = similarityThreshold,
		returnEmbedding = embedBatchCallback != null && DEFAULT_CONFIG.RETURN_EMBEDDING,
		chunkPrefix = DEFAULT_CONFIG.CHUNK_PREFIX,
		excludeChunkPrefixInResults = DEFAULT_CONFIG.EXCLUDE_CHUNK_PREFIX_IN_RESULTS
	} = options ?? {};

	if (typeof text !== 'string') {
		throw new TypeError('Input must be a string');
	}
	validateStrategy(strategy, inputFormat, chunkOverlap);
	const usesSimilarity = strategy === 'semantic';
	for (const [name, value] of Object.entries({ similarityThreshold, combineChunksSimilarityThreshold })) {
		if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
	}
	if (maxChunkSize !== Infinity && !(Number.isSafeInteger(maxChunkSize) && maxChunkSize >= 0)) {
		throw new RangeError('maxChunkSize must be a nonnegative safe integer or Infinity.');
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
	if (separator !== undefined) {
		if (typeof separator !== 'string' || !separator.length) throw new TypeError('separator must be a nonempty string.');
		if (inputFormat !== 'text' || usesSimilarity || excludeNonLetterSentences) {
			throw new TypeError("separator requires plain text, 'blocks' or 'pack', and no sentence filtering.");
		}
		sentenceLocale(locale);
	}
	const embedBatch = capture?.embed ?? createBatchEmbedder(embedBatchCallback, maxEmbeddingBatchSize, maxCachedEmbeddings);
	if (!embedBatch && (usesSimilarity || returnEmbedding)) {
		throw new TypeError("An embedding callback is required for 'semantic' or returnEmbedding: true.");
	}
	if (logging) await _printVersion();
	const prefix = chunkPrefix?.trim() ? chunkPrefix + ': ' : '';
	const fits = capture?.characterCeiling === undefined ? tokenBudget(maxChunkTokens,countTokens,prefix) :
		tokenBudget(capture.characterCeiling,text=>text.length,prefix);
	const fitsStructure = capture?.structuralLimit === undefined ? undefined :
		tokenBudget(capture.structuralLimit,capture.characterCeiling === undefined ? countTokens : text=>text.length,prefix);
	const fitsOverlap = chunkOverlap > 0 && (maxChunkTokens === Infinity
		? text => text.length <= chunkOverlap : tokenBudget(chunkOverlap, countTokens, ''));
	const parsing = {
		strategy, fits, fitsStructure, locale, excludeNonLetterSentences, maxChunkSize,
		joinParagraphs:options?.joinParagraphs, combineChunksSimilarityThreshold,
		calibrate: mergeThresholdMode === 'document' && options?.combineChunksSimilarityThreshold === undefined
	};
	let output;
	if (separator !== undefined) {
		output = chunkDelimited(text, separator, { ...parsing, fitsOverlap });
		if (capture?.tree) {
			const records = chunkDelimited(text,separator,{strategy:'blocks',maxChunkSize:Infinity});
			capture.tree({roots:records.map(c=>({...c.sourceRanges[0],kind:'record'})),children:()=>[]});
		}
	} else if (inputFormat === 'json') {
		if (excludeNonLetterSentences) throw new TypeError('JSON input does not support sentence filtering.');
		const [{ chunkJsonRecords }, parser] = await Promise.all([
			import('./json-records.js'),
			import('jsonc-parser').catch(error => {
				if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("package 'jsonc-parser'")) {
					throw new Error('JSON input requires jsonc-parser. Run npm install --include=optional.', { cause: error });
				}
				throw error;
			})
		]);
		output = chunkJsonRecords(text, maxChunkSize, fits, locale, parser, capture, fitsStructure);
	} else if (inputFormat === 'markdown' || inputFormat === 'html') {
		const { chunkStructured } = await import('./structured-chunks.js');
		const parse = inputFormat === 'html' ? (await import('./html.js')).parseHtml :
			(await import('./markdown-units.js')).parseMarkdownDocument;
		const parsed = capture?.parsed ?? await parse(text, !!capture);
		if (capture) capture.parsed = parsed;
		output = await chunkStructured(parsed, embedBatch, { ...parsing, fitsOverlap }, capture);
	} else {
		let chunks = await parseText(text, { ...parsing, inputFormat }, embedBatch, capture);
		if (chunks.length === 0) return [];
		if (logging) console.log('Initial chunks', chunks.map(chunk => chunk.slice(0, 50)));

		const flat = capture?.flat;
		if (strategy === 'pack') {
			if (capture) capture.chunks = [];
			chunks = packSentences(chunks, maxChunkSize, fits, fitsOverlap,
				flat && ((a,b)=>capture.chunks.push(sliceView(flat,a,b))));
		}
		output = capture?.chunks ?? chunks.map(text => ({ text }));
	}
	if (!prefix && !returnEmbedding && !fits) return output;
	const indexed = [], pending = [];
	for (const chunk of output) {
		const text = prefix + chunk.text;
		if (fits && !fits(chunk.text)) {
			if (capture?.characterCeiling !== undefined) chunk.sizeLimitExceeded = true;
			else chunk.tokenLimitExceeded = true;
		}
		else if (returnEmbedding) {
			indexed.push(text);
			pending.push(chunk);
		}
		if (prefix && !excludeChunkPrefixInResults) {
			chunk.text = text;
			for (const range of chunk.sourceRanges ?? []) range.outputStart += prefix.length;
			for (const range of chunk.citations ?? []) { range.outputStart += prefix.length; range.outputEnd += prefix.length; }
		} else if (prefix && (chunk.sourceRanges || capture)) chunk.embeddingText = text;
	}
	if (pending.length) await embedPassages(pending,embedBatch,indexed);
	return output;
}

export async function embedPassages(chunks,embed,texts = chunks.map(c=>c.embeddingText ?? c.text)) {
	const vectors = await embed(texts);
	const seen = new Set();
	chunks.forEach((c,i)=>{
		c.embedding = seen.has(vectors[i]) ? copyEmbedding(vectors[i]) : vectors[i];
		seen.add(vectors[i]);
	});
}

export async function _printVersion() {
	const { default: { version } } = await import('../package.json', { with: { type: 'json' } }).catch(error => {
		// Earlier Node ESM loaders use the import assertion spelling.
		if (error.code !== 'ERR_IMPORT_ASSERTION_TYPE_MISSING') throw error;
		return import('../package.json', { assert: { type: 'json' } });
	});
	const versionText = `-- semachunk v${version} --`;
	const lineLength = versionText.length;
	console.log(`\n${'-'.repeat(lineLength)}\n${versionText}\n${'-'.repeat(lineLength)}`);
}
