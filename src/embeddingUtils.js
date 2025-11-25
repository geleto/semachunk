// Stubs for embeddingUtils
// This file is stripped of external dependencies

export async function initializeEmbeddingUtils() {
    return {
        modelName: 'stub-model',
        dtype: 'stub-dtype',
        device: 'stub-device',
    };
}

export async function createEmbedding(text) {
    throw new Error('createEmbedding stub - will be replaced with callback');
}

// Tokenizer stub
export function tokenizer(text) {
    // Rough approximation: 1 word ≈ 1.3 tokens
    const words = text.split(/\s+/).length;
    const size = Math.ceil(words * 1.3);
    return {
        input_ids: {
            size: size
        }
    };
}