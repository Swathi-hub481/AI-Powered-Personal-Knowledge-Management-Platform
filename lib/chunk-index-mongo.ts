/**
 * Persist / load BM25 + vector chunk index in MongoDB (hybrid lexical + dense; optional Atlas $vectorSearch).
 * All operations are scoped to a userId.
 */

import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"
import { embedTextForRetrieval } from "@/lib/embedding-hash"
import type { Chunk, ChunkIndex } from "@/lib/chunk-store"

/** Mirrors persisted kb_chunks shape (avoid circular imports with mongo-knowledge). */
interface KbChunkRow {
	chunkId: string
	userId: string
	sourceId: string
	sourceType: string
	title: string
	text: string
	contextualLine: string
	embedding: number[]
	tags: string[]
	createdAt: string
	termFreqs: Record<string, number>
	tokenCount: number
	url?: string
	speakers?: string[]
}

function persistedRowToChunk(row: KbChunkRow): Chunk {
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

export async function loadDocumentChunksAndEmbeddingsFromMongo(userId: string): Promise<{
	chunks: Chunk[]
	embeddingsByChunkId: Map<string, number[]>
}> {
	const db = await getMongoDb()
	const rows = (await db
		.collection(COLLECTIONS.chunks)
		.find({ sourceType: "document", userId })
		.toArray()) as unknown as KbChunkRow[]

	const embeddingsByChunkId = new Map<string, number[]>()
	const chunks: Chunk[] = []
	for (const row of rows) {
		if (row.embedding?.length) {
			embeddingsByChunkId.set(row.chunkId, row.embedding)
		}
		chunks.push(persistedRowToChunk(row))
	}
	return { chunks, embeddingsByChunkId }
}

export async function loadChunkIndexFromMongo(userId: string): Promise<ChunkIndex | null> {
	const db = await getMongoDb()
	const statsId = `main_${userId}`
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const stats = await db.collection(COLLECTIONS.indexStats).findOne({ _id: statsId as any })
	if (!stats || typeof stats !== "object") return null

	const rows = (await db.collection(COLLECTIONS.chunks).find({ userId }).toArray()) as unknown as KbChunkRow[]
	if (rows.length === 0) return null

	const s = stats as {
		df?: Record<string, number>
		totalChunks?: number
		avgTokenCount?: number
		indexedAt?: string
	}
	const chunks = rows.map((r) => persistedRowToChunk(r))

	return {
		chunks,
		df: s.df ?? {},
		totalChunks: s.totalChunks ?? chunks.length,
		avgTokenCount: s.avgTokenCount ?? 0,
		indexedAt: s.indexedAt ?? new Date().toISOString(),
	}
}

export async function persistChunkIndexToMongo(
	userId: string,
	index: ChunkIndex,
	embeddingOverrides?: Map<string, number[]>
): Promise<void> {
	const db = await getMongoDb()
	const rows: KbChunkRow[] = index.chunks.map((c) => {
		const lexical = `${c.metadata.contextPrefix ?? ""}\n${c.text}`.slice(0, 12000)
		const emb =
			embeddingOverrides?.get(c.id) ?? embedTextForRetrieval(lexical)
		const row: KbChunkRow = {
			chunkId: c.id,
			userId,
			sourceId: c.metadata.sourceId,
			sourceType: c.metadata.sourceType,
			title: c.metadata.title,
			text: c.text,
			contextualLine: c.metadata.contextPrefix ?? "",
			embedding: emb,
			tags: c.metadata.tags ?? [],
			termFreqs: c.termFreqs,
			tokenCount: c.tokenCount,
			createdAt: c.metadata.createdAt,
			url: c.metadata.url,
			speakers: c.metadata.speakers,
		}
		return row
	})

	// Replace only chunks belonging to this user
	await db.collection(COLLECTIONS.chunks).deleteMany({ userId })
	if (rows.length > 0) {
		await db.collection(COLLECTIONS.chunks).insertMany(rows as unknown as Record<string, unknown>[])
	}

	const statsId = `main_${userId}`
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await db.collection(COLLECTIONS.indexStats).updateOne(
		{ _id: statsId as any },
		{
			$set: {
				_id: statsId,
				userId,
				df: index.df,
				totalChunks: index.totalChunks,
				avgTokenCount: index.avgTokenCount,
				indexedAt: index.indexedAt,
			},
		},
		{ upsert: true }
	)
}
