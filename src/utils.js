
export function splitSentences(text) {
	// Basic sentence splitting on .!?
	return text
		.replace(/([.!?])\s+/g, '$1\n')
		.split('\n')
		.map(s => s.trim())
		.filter(s => s.length > 0);
}
