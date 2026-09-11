/**
 * Deterministic semantic-ish embeddings without third-party embedding APIs.
 * Feature-hash tokens + bigrams into a fixed dimension, L2-normalised (usable with cosine similarity).
 */

const DIM = 384

function fnv1a(s: string): number {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

function tokenizeForEmbed(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1)
		.slice(0, 512)
}

function bigrams(tokens: string[]): string[] {
	const out: string[] = []
	for (let i = 0; i < tokens.length - 1; i++) {
		out.push(`${tokens[i]}_${tokens[i + 1]}`)
	}
	return out
}

export function embedTextForRetrieval(text: string): number[] {
	const tokens = tokenizeForEmbed(text)
	const pieces = [...tokens, ...bigrams(tokens).slice(0, 256)]
	const v = new Float64Array(DIM)
	for (const p of pieces) {
		let h = fnv1a(p)
		for (let r = 0; r < 4; r++) {
			const idx = (h + r * 1103515245) % DIM
			v[idx] += 1 / (1 + r)
			h = (h >>> 3) ^ (h << 5)
		}
	}
	let norm = 0
	for (let i = 0; i < DIM; i++) norm += v[i]! * v[i]!
	norm = Math.sqrt(norm) || 1
	return Array.from(v, (x) => x / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0
	let dot = 0
	for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
	return dot
}
