/**
 * Shared chunking for ingest (mirrors chunk-store split heuristics).
 */

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 150

export function splitIntoChunks(text: string): string[] {
	if (text.length <= CHUNK_SIZE) {
		return [text.trim()].filter(Boolean)
	}

	const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
	const chunks: string[] = []
	let currentChunk = ""

	for (const para of paragraphs) {
		if (currentChunk.length + para.length + 2 <= CHUNK_SIZE) {
			currentChunk += (currentChunk ? "\n\n" : "") + para.trim()
		} else {
			if (currentChunk.trim()) {
				chunks.push(currentChunk.trim())
			}
			if (para.length > CHUNK_SIZE) {
				const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [para]
				currentChunk = ""
				for (const sentence of sentences) {
					if (currentChunk.length + sentence.length + 1 <= CHUNK_SIZE) {
						currentChunk += (currentChunk ? " " : "") + sentence.trim()
					} else {
						if (currentChunk.trim()) chunks.push(currentChunk.trim())
						currentChunk = sentence.trim()
					}
				}
			} else {
				const overlap = currentChunk.slice(-CHUNK_OVERLAP).trim()
				currentChunk = overlap ? overlap + "\n\n" + para.trim() : para.trim()
			}
		}
	}

	if (currentChunk.trim()) {
		chunks.push(currentChunk.trim())
	}

	return chunks
}
