import { DEFAULT_CONFIG } from '../config.js';
import { documentNodes, finishDocument, orderedSectionRanges } from './document.js';
import { prepareDocument } from './document-index.js';
import { createBatchEmbedder } from './embeddings.js';
import { defaultCharacterTarget, embedPassages, splitPassages, validateStrategy } from './passages.js';
export { getChunkContext } from './document.js';
export { createDocumentIndex, search } from './document-index.js';
export { _printVersion } from './passages.js';

/** Split one source into citable passages and retain its hierarchy for retrieval. */
export async function chunk(text, options = {}) {
    if (typeof text !== 'string') throw new TypeError('Input must be a string');
    if (!options || typeof options !== 'object' || Array.isArray(options) || arguments.length > 2) {
        throw new TypeError('Use chunk(text, options) and pass the embedding callback as embedBatch.');
    }
    const {
        sourceId, format = 'text', strategy = 'blocks', sizeUnit = 'characters', embedBatch, countTokens,
        sectionRanges = [], maxChunkSize, maxStructuralSize = sizeUnit === 'tokens' ?
            DEFAULT_CONFIG.DOCUMENT_STRUCTURAL_TOKENS : DEFAULT_CONFIG.DOCUMENT_STRUCTURAL_CHARACTERS,
        maxPassageSize = sizeUnit === 'tokens' ? DEFAULT_CONFIG.DOCUMENT_PASSAGE_TOKENS : DEFAULT_CONFIG.DOCUMENT_PASSAGE_CHARACTERS,
        index = false, returnEmbedding = embedBatch != null, joinParagraphs = strategy === 'semantic', ...rest
    } = options;
    if (!['text','markdown','html','json'].includes(format)) throw new TypeError('Invalid document format.');
    validateStrategy(strategy,format,rest.chunkOverlap === undefined ? DEFAULT_CONFIG.CHUNK_OVERLAP : rest.chunkOverlap);
    if (rest.separator !== undefined && strategy === 'semantic') throw new TypeError("separator requires 'blocks' or 'pack'.");
    if ('inputFormat' in rest || 'chunkingStrategy' in rest) throw new TypeError('Use format and strategy in chunk options.');
    if ('maxChunkTokens' in rest) throw new TypeError('Use maxChunkSize and sizeUnit to size chunks.');
    if (sizeUnit !== 'characters' && sizeUnit !== 'tokens') throw new TypeError("sizeUnit must be 'characters' or 'tokens'.");
    if (sizeUnit === 'tokens' && typeof countTokens !== 'function') throw new TypeError('Token sizing requires countTokens.');
    if (!Number.isSafeInteger(maxPassageSize) || maxPassageSize < 1) throw new RangeError('maxPassageSize must be a positive safe integer.');
    if (maxStructuralSize !== Infinity && (!Number.isSafeInteger(maxStructuralSize) || maxStructuralSize < 1)) {
        throw new RangeError('maxStructuralSize must be a positive safe integer or Infinity.');
    }
    if (sourceId !== undefined && typeof sourceId !== 'string') throw new TypeError('sourceId must be a string.');
    if (typeof index !== 'boolean') throw new TypeError('index must be a boolean.');
    if (joinParagraphs && strategy !== 'semantic') throw new TypeError('joinParagraphs requires semantic.');
    const blockTarget = sizeUnit === 'tokens' ? DEFAULT_CONFIG.DOCUMENT_STRUCTURAL_TOKENS : defaultCharacterTarget(format);
    const target = maxChunkSize ?? (strategy === 'semantic' ? maxPassageSize : blockTarget);
    if (target !== Infinity && (!Number.isSafeInteger(target) || target < (sizeUnit === 'tokens' ? 1 : 0))) {
        throw new RangeError('Invalid maxChunkSize.');
    }
    const sections = orderedSectionRanges(sectionRanges,text.length);
    const embed = createBatchEmbedder(embedBatch,rest.maxEmbeddingBatchSize,rest.maxCachedEmbeddings);
    if (!embed && (index || returnEmbedding || strategy === 'semantic')) throw new TypeError('An embedBatch callback is required.');
    let nodes;
    const capture = {embed, characterCeiling:sizeUnit === 'characters' ? maxPassageSize : undefined,
        tree(tree) {nodes = documentNodes(text,tree,format);}};
    const structuralLimit = Math.min(maxStructuralSize,maxPassageSize);
    const chunks = [];
    for (const layout of strategy === 'semantic' ? ['blocks','semantic'] : [strategy]) {
        const limit = layout === 'blocks' && strategy === 'semantic' ? Math.min(blockTarget,target) : target;
        const sizing = sizeUnit === 'tokens' ? {maxChunkSize:Infinity,maxChunkTokens:Math.min(limit,maxPassageSize),countTokens} :
            {maxChunkSize:limit};
        capture.structuralLimit = layout !== 'pack' && structuralLimit < Math.min(limit,maxPassageSize) ? structuralLimit : undefined;
        const passages = await splitPassages(text,embedBatch,{...rest,...sizing,logging:rest.logging && !nodes,
            inputFormat:format,chunkingStrategy:layout,joinParagraphs:layout === 'semantic' && joinParagraphs,returnEmbedding:false},capture);
        for (const c of passages) {
            c.layout = layout;
            c.citations ??= c.sourceRanges.map(r=>({...r,outputEnd:r.outputStart+r.end-r.start}));
            if (sourceId !== undefined) c.sourceId = sourceId;
            chunks.push(c);
        }
        capture.tree = undefined;
    }
    if (returnEmbedding) {
        const eligible = chunks.filter(c=>!c.sizeLimitExceeded && !c.tokenLimitExceeded);
        if (eligible.length) await embedPassages(eligible,embed);
    }
    const doc = finishDocument(sourceId,format,chunks,nodes ?? documentNodes(text,{roots:[],children:()=>[]},format),
        sections,sizeUnit,maxPassageSize,countTokens,structuralLimit,strategy);
    return prepareDocument(doc,{index,embed,embedBatch,maxEmbeddingBatchSize:rest.maxEmbeddingBatchSize});
}
