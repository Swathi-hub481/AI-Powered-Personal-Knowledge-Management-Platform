/**
 * Document archive in MongoDB (`kb_documents`) — scoped by userId.
 */

import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

export interface DocumentIngestMeta {
	ocrUsed?: boolean
	htmlCleaned?: boolean
	normalizeStage?: string
	entities?: string[]
	keywords?: string[]
	actionItems?: string[]
	contextualSummary?: string
}

export interface StoredDocument {
	id: string
	userId?: string
	title: string
	kind: "pdf" | "html" | "image" | "text"
	mimeType?: string
	content: string
	tags: string[]
	createdAt: string
	updatedAt: string
	ingest?: DocumentIngestMeta
}

export async function readDocuments(userId?: string): Promise<StoredDocument[]> {
	const db = await getMongoDb()
	const filter = userId ? { userId } : {}
	const rows = await db.collection(COLLECTIONS.documents).find(filter).toArray()
	return rows as unknown as StoredDocument[]
}

export async function upsertDocument(doc: StoredDocument): Promise<void> {
	const db = await getMongoDb()
	const filter = doc.userId
		? { id: doc.id, userId: doc.userId }
		: { id: doc.id }
	await db.collection(COLLECTIONS.documents).updateOne(
		filter,
		{ $set: doc as unknown as Record<string, unknown> },
		{ upsert: true }
	)
}
