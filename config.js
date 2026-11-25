export const DEFAULT_CONFIG = {
    LOGGING: false,
    INPUT_FORMAT: 'text',
    CHUNKING_STRATEGY: 'auto',
    CHUNK_OVERLAP: 0,
    LOCALE: 'en',
    MAX_CHUNK_SIZE: 500,
    MARKDOWN_MAX_CHUNK_SIZE: 1024,
    JSON_MAX_CHUNK_SIZE: 1024,
    MAX_CHUNK_TOKENS: Infinity,
    MAX_EMBEDDING_BATCH_SIZE: Infinity,
    MAX_CACHED_EMBEDDINGS: Infinity,
    SIMILARITY_THRESHOLD: 0.5,
    EXCLUDE_NON_LETTER_SENTENCES: false,
    // Iterative Optimization
    COMBINE_CHUNKS: true,
    COMBINE_CHUNKS_SIMILARITY_THRESHOLD: 0.05,
    MERGE_THRESHOLD_MODE: 'fixed',
    MAX_PASSES: Infinity,
    MAX_UNCAPPED_PASSES: 100,
    MAX_MERGES_PER_PASS: 500, // Absolute limit
    MAX_MERGES_PER_PASS_PERCENTAGE: 40, // 40% of valid candidates
    UNCAPPED_CANDIDATE_MERGES: 12, // Soft-minimum number of merges per pass (overrides percentage cap)

    // Output
    RETURN_EMBEDDING: true,

    CHUNK_PREFIX: '',
    EXCLUDE_CHUNK_PREFIX_IN_RESULTS: false,
};
