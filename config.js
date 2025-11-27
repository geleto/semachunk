export const DEFAULT_CONFIG = {
    LOGGING: false,
    MAX_CHUNK_SIZE: 500,
    SIMILARITY_THRESHOLD: 0.5,
    DYNAMIC_THRESHOLD_LOWER_BOUND: 0.4,
    DYNAMIC_THRESHOLD_UPPER_BOUND: 0.8,
    NUM_SIMILARITY_SENTENCES_LOOKAHEAD: 3,
    // Iterative Optimization
    COMBINE_CHUNKS: true,
    COMBINE_CHUNKS_SIMILARITY_THRESHOLD: 0.5,
    MAX_UNCAPPED_PASSES: 100,
    MAX_MERGES_PER_PASS: 500, // Absolute limit
    MAX_MERGES_PER_PASS_PERCENTAGE: 40, // 40% of valid candidates
    UNCAPPED_CANDIDATE_MERGES: 12, // Soft-minimum number of merges per pass (overrides percentage cap)

    // Output
    RETURN_EMBEDDING: true,

    CHUNK_PREFIX: '',
    EXCLUDE_CHUNK_PREFIX_IN_RESULTS: false,
};