/**
 * BM25 chunk index for RAG: tokenize text, score chunks, and merge notes, highlights,
 * meetings, documents, and saved conversations into one searchable index per user.
 */

import { readNotes } from "@/lib/notes-store"
import { mongoReadHighlights, mongoReadMeets } from "@/lib/mongo-app-data"
import { readDocuments } from "@/lib/document-store"
import { loadAllConverseSessionsForIndex } from "@/lib/converse-store"
import {
	loadDocumentChunksAndEmbeddingsFromMongo,
	persistChunkIndexToMongo,
	loadChunkIndexFromMongo,
} from "@/lib/chunk-index-mongo"
import { embedTextForRetrieval } from "@/lib/embedding-hash"

export type ChunkSourceType =
	| "note"
	| "highlight"
	| "meeting-transcript"
	| "meeting-summary"
	| "document"
	| "conversation"

export interface ChunkMetadata {
	sourceType: ChunkSourceType
	sourceId: string
	title: string
	url?: string
	speakers?: string[]
	tags?: string[]
	createdAt: string
	/** Provenance line for lexical indexing (Semantic Contextualisation Layer) */
	contextPrefix?: string
}

export interface Chunk {
	id: string
	text: string
	metadata: ChunkMetadata
	/** Pre-computed term frequencies for BM25 scoring */
	termFreqs: Record<string, number>
	/** Total token count in this chunk */
	tokenCount: number
}

export interface ChunkIndex {
	chunks: Chunk[]
	/** Document frequency: how many chunks contain each term */
	df: Record<string, number>
	/** Total number of chunks */
	totalChunks: number
	/** Average chunk token count */
	avgTokenCount: number
	/** Last indexed timestamp */
	indexedAt: string
}

export interface ScoredChunk {
	chunk: Chunk
	score: number
}

/** Roughly 200 to 400 tokens per chunk with overlap so splits do not lose context. */
const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 150

const BM25_K1 = 1.5
const BM25_B = 0.75

/** Prefix line so keyword search sees project, title, type, and date together. */
export function buildSemanticContextPrefix(meta: {
	sourceType: ChunkSourceType
	title: string
	tags?: string[]
	url?: string
	speakers?: string[]
	createdAt: string
}): string {
	const project = meta.tags?.length ? meta.tags.join(", ") : "General"
	const typeLabel =
		meta.sourceType === "note"
			? "Note"
			: meta.sourceType === "highlight"
				? "Web Highlight"
				: meta.sourceType === "meeting-transcript"
					? "Meeting Transcript"
					: meta.sourceType === "document"
						? "Document"
						: meta.sourceType === "conversation"
							? "AI Conversation"
							: "Meeting Summary"
	const datePart = meta.createdAt ? meta.createdAt.slice(0, 10) : ""
	const speakers =
		meta.speakers?.length && meta.speakers.length > 0
			? ` | Participants: ${meta.speakers.slice(0, 8).join(", ")}`
			: ""
	const urlPart = meta.url ? ` | URL: ${meta.url}` : ""
	return `[Project: ${project} | Source: ${meta.title} | Type: ${typeLabel}${datePart ? ` | Date: ${datePart}` : ""}${urlPart}${speakers}]`
}

const STOP_WORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "could",
	"should", "may", "might", "shall", "can", "to", "of", "in", "for",
	"on", "with", "at", "by", "from", "as", "into", "through", "during",
	"before", "after", "above", "below", "between", "out", "off", "over",
	"under", "again", "further", "then", "once", "here", "there", "when",
	"where", "why", "how", "all", "each", "every", "both", "few", "more",
	"most", "other", "some", "such", "no", "nor", "not", "only", "own",
	"same", "so", "than", "too", "very", "just", "because", "but", "and",
	"or", "if", "while", "about", "up", "it", "its", "this", "that",
	"these", "those", "i", "me", "my", "we", "our", "you", "your", "he",
	"him", "his", "she", "her", "they", "them", "their", "what", "which",
	"who", "whom", "also", "said", "like", "get", "got", "one", "two",
])

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s'-]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function buildTermFreqs(tokens: string[]): Record<string, number> {
	const freqs: Record<string, number> = {}
	for (const t of tokens) {
		freqs[t] = (freqs[t] ?? 0) + 1
	}
	return freqs
}

function splitIntoChunks(text: string): string[] {
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

function splitTranscriptIntoChunks(
	transcript: Array<{ speaker: string; start: number; text: string }>
): { text: string; speakers: string[] }[] {
	if (!transcript || transcript.length === 0) return []

	const results: { text: string; speakers: string[] }[] = []
	let currentText = ""
	let currentSpeakers = new Set<string>()

	for (const u of transcript) {
		const mins = Math.floor(u.start / 60)
		const secs = Math.floor(u.start % 60)
		const time = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
		const line = `[${time}] ${u.speaker}: ${u.text}`

		if (currentText.length + line.length + 1 > CHUNK_SIZE) {
			if (currentText.trim()) {
				results.push({
					text: currentText.trim(),
					speakers: [...currentSpeakers],
				})
			}
			const lines = currentText.split("\n")
			const overlapLines = lines.slice(-3).join("\n")
			currentText = overlapLines + "\n" + line
			currentSpeakers = new Set<string>()
			currentSpeakers.add(u.speaker)
		} else {
			currentText += (currentText ? "\n" : "") + line
			currentSpeakers.add(u.speaker)
		}
	}

	if (currentText.trim()) {
		results.push({
			text: currentText.trim(),
			speakers: [...currentSpeakers],
		})
	}

	return results
}

export async function buildChunkIndex(userId: string): Promise<ChunkIndex> {
	const allChunks: Chunk[] = []
	const embeddingOverrides = new Map<string, number[]>()

	const notes = await readNotes(userId)
	for (const note of notes) {
		if (!note.content || !note.id) continue
		const textChunks = splitIntoChunks(note.content)
		const createdAt = note.createdAt ?? new Date().toISOString()
		textChunks.forEach((text, idx) => {
			const meta: ChunkMetadata = {
				sourceType: "note",
				sourceId: note.id,
				title: note.title ?? "Untitled Note",
				url: note.url,
				tags: note.tags,
				createdAt,
				contextPrefix: buildSemanticContextPrefix({
					sourceType: "note",
					title: note.title ?? "Untitled Note",
					tags: note.tags,
					url: note.url,
					createdAt,
				}),
			}
			const lexical = `${meta.contextPrefix}\n${text}`
			const tokens = tokenize(lexical)
			const cid = `${note.id}#${idx}`
			allChunks.push({
				id: cid,
				text,
				metadata: meta,
				termFreqs: buildTermFreqs(tokens),
				tokenCount: tokens.length,
			})
		})
	}

	const highlights = await mongoReadHighlights(userId)
	for (const hl of highlights) {
		if (!hl.text || !hl.id) continue
		const createdAt = hl.createdAt ?? new Date().toISOString()
		const meta: ChunkMetadata = {
			sourceType: "highlight",
			sourceId: hl.id,
			title: hl.title ?? "Untitled",
			url: hl.url,
			tags: hl.tags as string[],
			createdAt,
			contextPrefix: buildSemanticContextPrefix({
				sourceType: "highlight",
				title: hl.title ?? "Untitled",
				tags: hl.tags as string[],
				url: hl.url,
				createdAt,
			}),
		}
		const lexical = `${meta.contextPrefix}\n${hl.text}`
		const tokens = tokenize(lexical)
		allChunks.push({
			id: `highlight-${hl.id}`,
			text: hl.text,
			metadata: meta,
			termFreqs: buildTermFreqs(tokens),
			tokenCount: tokens.length,
		})
	}

	const meets = await mongoReadMeets(userId)
	for (const session of meets) {
		if (!session.id || session.status !== "ready") continue

		if (Array.isArray(session.transcript) && session.transcript.length > 0) {
			const transcriptChunks = splitTranscriptIntoChunks(session.transcript)
			transcriptChunks.forEach((tc, ti) => {
				const createdAt = session.createdAt ?? new Date().toISOString()
				const meta: ChunkMetadata = {
					sourceType: "meeting-transcript",
					sourceId: session.id,
					title: session.title ?? "Untitled Meeting",
					speakers: tc.speakers,
					createdAt,
					contextPrefix: buildSemanticContextPrefix({
						sourceType: "meeting-transcript",
						title: session.title ?? "Untitled Meeting",
						tags: undefined,
						speakers: tc.speakers,
						createdAt,
					}),
				}
				const lexical = `${meta.contextPrefix}\n${tc.text}`
				const tokens = tokenize(lexical)
				allChunks.push({
					id: `${session.id}#t${ti}`,
					text: tc.text,
					metadata: meta,
					termFreqs: buildTermFreqs(tokens),
					tokenCount: tokens.length,
				})
			})
		}

		if (session.summary && session.summary.trim().length > 0) {
			const summaryChunks = splitIntoChunks(session.summary)
			summaryChunks.forEach((text, si) => {
				const createdAt = session.createdAt ?? new Date().toISOString()
				const speakerNames =
					session.participants?.map((p) => p.speakerName ?? p.speakerLabel) ?? []
				const meta: ChunkMetadata = {
					sourceType: "meeting-summary",
					sourceId: session.id,
					title: session.title ?? "Untitled Meeting",
					speakers: speakerNames,
					createdAt,
					contextPrefix: buildSemanticContextPrefix({
						sourceType: "meeting-summary",
						title: session.title ?? "Untitled Meeting",
						tags: undefined,
						speakers: speakerNames,
						createdAt,
					}),
				}
				const lexical = `${meta.contextPrefix}\n${text}`
				const tokens = tokenize(lexical)
				allChunks.push({
					id: `${session.id}#s${si}`,
					text,
					metadata: meta,
					termFreqs: buildTermFreqs(tokens),
					tokenCount: tokens.length,
				})
			})
		}
	}

	const { chunks: docChunksFromMongo, embeddingsByChunkId } =
		await loadDocumentChunksAndEmbeddingsFromMongo(userId)
	allChunks.push(...docChunksFromMongo)
	embeddingsByChunkId.forEach((v, k) => embeddingOverrides.set(k, v))

	const documents = await readDocuments(userId)
	const docIdsWithChunks = new Set(docChunksFromMongo.map((c) => c.metadata.sourceId))
	for (const doc of documents) {
		if (docIdsWithChunks.has(doc.id) || !doc.content || !doc.id) continue
		const textChunks = splitIntoChunks(doc.content)
		const createdAt = doc.createdAt ?? new Date().toISOString()
		for (let i = 0; i < textChunks.length; i++) {
			const text = textChunks[i]!
			const meta: ChunkMetadata = {
				sourceType: "document",
				sourceId: doc.id,
				title: doc.title ?? "Document",
				tags: doc.tags,
				createdAt,
				contextPrefix: buildSemanticContextPrefix({
					sourceType: "document",
					title: doc.title ?? "Document",
					tags: doc.tags,
					createdAt,
				}),
			}
			const lexical = `${meta.contextPrefix}\n${text}`
			const tokens = tokenize(lexical)
			const cid = `${doc.id}#${i}`
			const emb = embedTextForRetrieval(lexical.slice(0, 12000))
			embeddingOverrides.set(cid, emb)
			allChunks.push({
				id: cid,
				text,
				metadata: meta,
				termFreqs: buildTermFreqs(tokens),
				tokenCount: tokens.length,
			})
		}
	}

	const conversations = await loadAllConverseSessionsForIndex(userId)
	for (const session of conversations) {
		if (!session.turns || session.turns.length === 0) continue

		const turnPairs: string[] = []
		for (let i = 0; i < session.turns.length; i += 2) {
			const q = session.turns[i]
			const a = session.turns[i + 1]
			if (!q || !a) continue
			turnPairs.push(`Q: ${q.content}\nA: ${a.content}`)
		}
		if (turnPairs.length === 0) continue

		const sessionText = turnPairs.join("\n\n")
		const textChunks = splitIntoChunks(sessionText)
		const createdAt = session.createdAt ?? new Date().toISOString()

		textChunks.forEach((text, idx) => {
			const meta: ChunkMetadata = {
				sourceType: "conversation",
				sourceId: session.id,
				title: `Conversation: ${session.title}`,
				createdAt,
				contextPrefix: buildSemanticContextPrefix({
					sourceType: "conversation",
					title: `Conversation: ${session.title}`,
					tags: ["ai-conversation"],
					createdAt,
				}),
			}
			const lexical = `${meta.contextPrefix}\n${text}`
			const tokens = tokenize(lexical)
			allChunks.push({
				id: `${session.id}#${idx}`,
				text,
				metadata: meta,
				termFreqs: buildTermFreqs(tokens),
				tokenCount: tokens.length,
			})
		})
	}

	const df: Record<string, number> = {}
	for (const chunk of allChunks) {
		const uniqueTerms = new Set(Object.keys(chunk.termFreqs))
		for (const term of uniqueTerms) {
			df[term] = (df[term] ?? 0) + 1
		}
	}

	const totalTokens = allChunks.reduce((sum, c) => sum + c.tokenCount, 0)
	const avgTokenCount = allChunks.length > 0 ? totalTokens / allChunks.length : 0

	const index: ChunkIndex = {
		chunks: allChunks,
		df,
		totalChunks: allChunks.length,
		avgTokenCount,
		indexedAt: new Date().toISOString(),
	}

	await persistChunkIndexToMongo(userId, index, embeddingOverrides)
	return index
}

export function applyScopeFilter(
	chunks: Chunk[],
	options?: {
		sourceTypes?: ChunkSourceType[]
		sourceIds?: string[]
		tags?: string[]
	}
): Chunk[] {
	let candidateChunks = chunks

	if (options?.sourceTypes && options.sourceTypes.length > 0) {
		const allowedTypes = new Set(options.sourceTypes)
		candidateChunks = candidateChunks.filter((c) => allowedTypes.has(c.metadata.sourceType))
	}

	if (options?.sourceIds && options.sourceIds.length > 0) {
		const allowedIds = new Set(options.sourceIds)
		candidateChunks = candidateChunks.filter((c) => allowedIds.has(c.metadata.sourceId))
	}

	if (options?.tags && options.tags.length > 0) {
		const requiredTags = new Set(options.tags.map((t) => t.toLowerCase()))
		candidateChunks = candidateChunks.filter((c) => {
			if (!c.metadata.tags) return false
			return c.metadata.tags.some((t) => requiredTags.has(t.toLowerCase()))
		})
	}

	return candidateChunks
}

export async function loadOrBuildIndex(userId: string): Promise<ChunkIndex> {
	try {
		const loaded = await loadChunkIndexFromMongo(userId)
		if (loaded && loaded.totalChunks > 0) {
			return loaded
		}
	} catch {
	}
	return buildChunkIndex(userId)
}

function bm25Score(
	queryTerms: string[],
	chunk: Chunk,
	df: Record<string, number>,
	totalChunks: number,
	avgTokenCount: number
): number {
	let score = 0

	for (const term of queryTerms) {
		const termDocFreq = df[term] ?? 0
		if (termDocFreq === 0) continue

		const tf = chunk.termFreqs[term] ?? 0
		if (tf === 0) continue

		const idf = Math.log((totalChunks - termDocFreq + 0.5) / (termDocFreq + 0.5) + 1)

		const tfNorm = (tf * (BM25_K1 + 1)) /
			(tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.tokenCount / avgTokenCount)))

		score += idf * tfNorm
	}

	return score
}

export function retrieveChunks(
	query: string,
	index: ChunkIndex,
	options?: {
		topK?: number
		sourceTypes?: ChunkSourceType[]
		sourceIds?: string[]
		tags?: string[]
	}
): ScoredChunk[] {
	const topK = options?.topK ?? 10
	const queryTerms = tokenize(query)

	if (queryTerms.length === 0) return []

	const candidateChunks = applyScopeFilter(index.chunks, options)

	const scored: ScoredChunk[] = candidateChunks
		.map((chunk) => ({
			chunk,
			score: bm25Score(queryTerms, chunk, index.df, index.totalChunks, index.avgTokenCount),
		}))
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK)

	return scored
}

export async function getIndexStats(userId: string): Promise<{
	totalChunks: number
	noteChunks: number
	highlightChunks: number
	meetingTranscriptChunks: number
	meetingSummaryChunks: number
	documentChunks: number
	conversationChunks: number
	indexedAt: string | null
}> {
	try {
		const index = await loadOrBuildIndex(userId)
		return {
			totalChunks: index.totalChunks,
			noteChunks: index.chunks.filter((c) => c.metadata.sourceType === "note").length,
			highlightChunks: index.chunks.filter((c) => c.metadata.sourceType === "highlight").length,
			meetingTranscriptChunks: index.chunks.filter((c) => c.metadata.sourceType === "meeting-transcript").length,
			meetingSummaryChunks: index.chunks.filter((c) => c.metadata.sourceType === "meeting-summary").length,
			documentChunks: index.chunks.filter((c) => c.metadata.sourceType === "document").length,
			conversationChunks: index.chunks.filter((c) => c.metadata.sourceType === "conversation").length,
			indexedAt: index.indexedAt,
		}
	} catch {
		return {
			totalChunks: 0,
			noteChunks: 0,
			highlightChunks: 0,
			meetingTranscriptChunks: 0,
			meetingSummaryChunks: 0,
			documentChunks: 0,
			conversationChunks: 0,
			indexedAt: null,
		}
	}
}
