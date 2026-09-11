/**
 * MongoDB knowledge layer: chunk storage, hybrid retrieval hooks, interaction feedback.
 * When MONGODB_URI is unset, persistence and hybrid search degrade gracefully.
 */

import { getMongoDb, COLLECTIONS } from "./mongodb"
import type { StoredDocument } from "./document-store"
import { tokenize, retrieveChunks, type ScoredChunk, type Chunk } from "./chunk-store"
import { embedTextForRetrieval, cosineSimilarity } from "./embedding-hash"

const RRF_K = 60

export interface PersistedChunkRow {
	chunkId: string
	sourceId: string
	sourceType: string
	title: string
	text: string
	contextualLine: string
	embedding: number[]
	tags: string[]
	createdAt: string
	/** Sparse terms for hybrid BM25-style scoring in-app */
	termFreqs: Record<string, number>
	tokenCount: number
	url?: string
	speakers?: string[]
}

export async function persistIngestedChunks(params: {
	userId: string
	documentId: string
	title: string
	tags: string[]
	chunks: Array<{
		chunkId: string
		text: string
		contextualLine: string
		embedding: number[]
		createdAt: string
	}>
	documentMeta: StoredDocument
}): Promise<void> {
	const db = await getMongoDb()

	await db.collection(COLLECTIONS.documents).updateOne(
		{ id: params.documentMeta.id, userId: params.userId },
		{ $set: { ...params.documentMeta, userId: params.userId } },
		{ upsert: true }
	)

	const bulk = params.chunks.map((c) => {
		const lexical = `${c.contextualLine}\n${c.text}`
		const terms = tokenize(lexical)
		const termFreqs: Record<string, number> = {}
		for (const t of terms) {
			termFreqs[t] = (termFreqs[t] ?? 0) + 1
		}
		const row: PersistedChunkRow & { userId: string } = {
			chunkId: c.chunkId,
			userId: params.userId,
			sourceId: params.documentId,
			sourceType: "document",
			title: params.title,
			text: c.text,
			contextualLine: c.contextualLine,
			embedding: c.embedding,
			tags: params.tags,
			createdAt: c.createdAt,
			termFreqs,
			tokenCount: terms.length,
		}
		return {
			updateOne: {
				filter: { chunkId: c.chunkId, userId: params.userId },
				update: { $set: row },
				upsert: true,
			},
		}
	})

	if (bulk.length > 0) {
		await db.collection(COLLECTIONS.chunks).bulkWrite(bulk, { ordered: false })
	}
}

/**
 * Feedback boosts for chunk ids (from user thumbs / helpful clicks).
 */
export async function getChunkFeedbackBoost(chunkIds: string[]): Promise<Map<string, number>> {
	const db = await getMongoDb()
	const boost = new Map<string, number>()
	if (chunkIds.length === 0) return boost

	const agg = await db
		.collection(COLLECTIONS.feedback)
		.aggregate<{ _id: string; s: number }>([
			{ $match: { chunkId: { $in: chunkIds } } },
			{ $group: { _id: "$chunkId", s: { $sum: "$delta" } } },
		])
		.toArray()

	for (const row of agg) {
		boost.set(row._id, 1 + Math.min(0.5, Math.max(-0.3, row.s * 0.05)))
	}
	return boost
}

/** True if kb_chunks has at least one document (used when JSON index is empty). */
export async function hasAnyKnowledgeChunksInMongo(): Promise<boolean> {
	try {
		const db = await getMongoDb()
		const doc = await db.collection(COLLECTIONS.chunks).findOne({}, { projection: { _id: 1 } })
		return doc != null
	} catch {
		return false
	}
}

export async function recordRagFeedback(params: {
	query: string
	chunkId: string
	helpful: boolean
}): Promise<void> {
	const db = await getMongoDb()
	const delta = params.helpful ? 1 : -1
	await db.collection(COLLECTIONS.feedback).insertOne({
		queryHash: hashQuery(params.query),
		query: params.query.slice(0, 500),
		chunkId: params.chunkId,
		delta,
		at: new Date().toISOString(),
	})
}

function hashQuery(q: string): string {
	let h = 0
	for (let i = 0; i < q.length; i++) {
		h = (Math.imul(31, h) + q.charCodeAt(i)) | 0
	}
	return String(h)
}

/**
 * Hybrid retrieval: BM25 (from JSON index) + dense hash embedding + RRF + feedback boost.
 * Falls back to JSON chunk-store only when Mongo empty or disabled.
 */
export async function hybridRetrieveForRag(options: {
	userId: string
	query: string
	/** Pool size before rerank */
	retrieveK: number
	sourceTypes?: import("./chunk-store").ChunkSourceType[]
	sourceIds?: string[]
	tags?: string[]
}): Promise<ScoredChunk[]> {
	const { loadOrBuildIndex } = await import("./chunk-store")
	const index = await loadOrBuildIndex(options.userId)
	const bm25 = retrieveChunks(options.query, index, {
		topK: Math.min(120, options.retrieveK * 4),
		sourceTypes: options.sourceTypes,
		sourceIds: options.sourceIds,
		tags: options.tags,
	})

	const db = await getMongoDb()
	const queryEmb = embedTextForRetrieval(options.query)

	let mongoRows: PersistedChunkRow[] = []
	try {
		const filter: Record<string, unknown> = { userId: options.userId }
		if (options.sourceTypes?.length) {
			filter.sourceType = { $in: options.sourceTypes }
		}
		if (options.sourceIds?.length) {
			filter.sourceId = { $in: options.sourceIds }
		}
		if (options.tags?.length) {
			filter.tags = { $in: options.tags }
		}
		const vectorIndex = process.env.MONGODB_VECTOR_INDEX_NAME?.trim()
		if (vectorIndex) {
			try {
				const vs: Record<string, unknown> = {
					index: vectorIndex,
					path: "embedding",
					queryVector: queryEmb,
					numCandidates: Math.min(400, options.retrieveK * 40),
					limit: 120,
				}
				if (Object.keys(filter).length > 0) {
					vs.filter = filter
				}
				const pipeline = [{ $vectorSearch: vs }, { $project: { _id: 0 } }]
				const agg = await db.collection(COLLECTIONS.chunks).aggregate(pipeline).toArray()
				mongoRows = agg as unknown as PersistedChunkRow[]
			} catch {
				mongoRows = []
			}
		}
		if (mongoRows.length === 0) {
			mongoRows = (await db
				.collection(COLLECTIONS.chunks)
				.find(Object.keys(filter).length ? filter : {})
				.limit(4000)
				.toArray()) as unknown as PersistedChunkRow[]
		}
	} catch {
		return bm25.slice(0, options.retrieveK)
	}

	const dense: ScoredChunk[] = mongoRows
		.map((row) => {
			const ch = mongoRowToChunk(row)
			const sim = cosineSimilarity(queryEmb, row.embedding)
			return { chunk: ch, score: sim }
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 80)

	const merged = reciprocalRankFusionLists([bm25, dense], options.retrieveK)
	const ids = merged.map((m) => m.chunk.id)
	const boosts = await getChunkFeedbackBoost(ids)
	return merged.map((m) => ({
		chunk: m.chunk,
		score: m.score * (boosts.get(m.chunk.id) ?? 1),
	}))
}

export function mongoRowToChunk(row: PersistedChunkRow): Chunk {
	return {
		id: row.chunkId,
		text: row.text,
		metadata: {
			sourceType: row.sourceType as Chunk["metadata"]["sourceType"],
			sourceId: row.sourceId,
			title: row.title,
			tags: row.tags,
			createdAt: row.createdAt,
			contextPrefix: row.contextualLine,
			url: row.url,
			speakers: row.speakers,
		},
		termFreqs: row.termFreqs,
		tokenCount: row.tokenCount,
	}
}

function reciprocalRankFusionLists(lists: ScoredChunk[][], topK: number): ScoredChunk[] {
	const scoreById = new Map<string, number>()
	const chunkById = new Map<string, Chunk>()
	for (const list of lists) {
		list.forEach((sc, rank) => {
			scoreById.set(sc.chunk.id, (scoreById.get(sc.chunk.id) ?? 0) + 1 / (RRF_K + rank + 1))
			chunkById.set(sc.chunk.id, sc.chunk)
		})
	}
	return [...scoreById.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topK)
		.map(([id, score]) => ({ chunk: chunkById.get(id)!, score }))
}

/** Ensure Mongo indexes (best-effort). */
export async function ensureMongoIndexes(): Promise<void> {
	const db = await getMongoDb()
	try {
		await db.collection(COLLECTIONS.chunks).createIndex({ chunkId: 1 }, { unique: true })
		await db.collection(COLLECTIONS.chunks).createIndex({ sourceId: 1 })
		await db.collection(COLLECTIONS.chunks).createIndex({ sourceType: 1 })
		await db.collection(COLLECTIONS.documents).createIndex({ id: 1 }, { unique: true })
		await db.collection(COLLECTIONS.feedback).createIndex({ chunkId: 1 })
		await db.collection(COLLECTIONS.feedback).createIndex({ queryHash: 1 })
		await db.collection(COLLECTIONS.notes).createIndex({ id: 1 }, { unique: true })
		await db.collection(COLLECTIONS.highlights).createIndex({ id: 1 }, { unique: true })
		await db.collection(COLLECTIONS.meetSessions).createIndex({ id: 1 }, { unique: true })
		await db.collection(COLLECTIONS.preferences).createIndex({ _id: 1 }, { unique: true })
		await db.collection(COLLECTIONS.oauthTokens).createIndex({ _id: 1 }, { unique: true })
	} catch {
		// ignore
	}
}
