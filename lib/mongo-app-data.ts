/**
 * Application data in MongoDB — all functions are scoped to a userId.
 */

import type { MeetSession } from "@/lib/meet-types"
import type { Note } from "@/lib/notes-store"
import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"
import { encrypt, decrypt } from "@/lib/encryption"

export interface HighlightRecord {
	id: string
	text: string
	url: string
	title: string
	createdAt: string
	isActive: boolean
	tags: string[]
	content?: string
}


export async function mongoReadNotes(userId: string): Promise<Note[]> {
	const db = await getMongoDb()
	const rows = await db.collection(COLLECTIONS.notes).find({ userId }).toArray()
	return (rows as unknown as Note[]).map((n) => ({
		...n,
		content: typeof n.content === "string" ? decrypt(n.content) : n.content,
	}))
}

/** Returns the N most recently updated notes, sorted newest-first. */
export async function mongoFetchRecentNotes(userId: string, limit = 5): Promise<Note[]> {
	const db = await getMongoDb()
	const rows = await db
		.collection(COLLECTIONS.notes)
		.find({ userId })
		.sort({ updatedAt: -1, createdAt: -1 })
		.limit(limit)
		.toArray()
	return (rows as unknown as Note[]).map((n) => ({
		...n,
		content: typeof n.content === "string" ? decrypt(n.content) : n.content,
	}))
}

/** Fetch a single note by its id field, scoped to userId. */
export async function mongoFetchNoteById(userId: string, id: string): Promise<Note | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.notes).findOne({ id, userId })
	if (!doc) return null
	const note = doc as unknown as Note
	return {
		...note,
		content: typeof note.content === "string" ? decrypt(note.content) : note.content,
	}
}

/** Delete a note by its id, scoped to userId. Returns true if a document was deleted. */
export async function mongoDeleteNote(userId: string, id: string): Promise<boolean> {
	const db = await getMongoDb()
	const r = await db.collection(COLLECTIONS.notes).deleteOne({ id, userId })
	return r.deletedCount > 0
}

/** Delete all kb_chunks whose sourceId matches the given note id and userId. */
export async function mongoDeleteChunksForNote(userId: string, id: string): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.chunks).deleteMany({ sourceId: id, userId })
}

/**
 * Replace all notes for a user.
 * Deletes existing user notes then inserts the new set (each stamped with userId).
 */
export async function mongoWriteNotes(userId: string, notes: Note[]): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.notes).deleteMany({ userId })
	if (notes.length > 0) {
		const stamped = notes.map((n) => ({
			...n,
			userId,
			content: typeof n.content === "string" ? encrypt(n.content) : n.content,
		}))
		await db.collection(COLLECTIONS.notes).insertMany(stamped as unknown as Record<string, unknown>[])
	}
}


export async function mongoReadHighlights(userId: string): Promise<HighlightRecord[]> {
	const db = await getMongoDb()
	const rows = await db.collection(COLLECTIONS.highlights).find({ userId }).toArray()
	return (rows as unknown as HighlightRecord[]).map((h) => ({
		...h,
		text: typeof h.text === "string" ? decrypt(h.text) : h.text,
		content: typeof h.content === "string" ? decrypt(h.content) : h.content,
	}))
}

export async function mongoWriteHighlights(userId: string, highlights: HighlightRecord[]): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.highlights).deleteMany({ userId })
	if (highlights.length > 0) {
		const stamped = highlights.map((h) => ({
			...h,
			userId,
			text: typeof h.text === "string" ? encrypt(h.text) : h.text,
			content: typeof h.content === "string" ? encrypt(h.content) : h.content,
		}))
		await db.collection(COLLECTIONS.highlights).insertMany(stamped as unknown as Record<string, unknown>[])
	}
}

export async function mongoReadHighlightResetMarker(userId: string): Promise<{ deletedBefore?: string }> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.appMeta).findOne({ _id: `highlights_reset_${userId}` as unknown as string })
	return (doc as { deletedBefore?: string } | null) ?? {}
}

export async function mongoWriteHighlightResetMarker(
	userId: string,
	marker: { deletedBefore: string }
): Promise<void> {
	const db = await getMongoDb()
	const key = `highlights_reset_${userId}`
	await db.collection(COLLECTIONS.appMeta).updateOne(
		{ _id: key as unknown as string },
		{ $set: { _id: key, ...marker } },
		{ upsert: true }
	)
}


/** Returns the N most recently started meet sessions, sorted newest-first. */
export async function mongoFetchRecentMeets(userId: string, limit = 3): Promise<MeetSession[]> {
	const db = await getMongoDb()
	const rows = await db
		.collection(COLLECTIONS.meetSessions)
		.find({ userId })
		.sort({ createdAt: -1, updatedAt: -1 })
		.limit(limit)
		.toArray()
	return rows as unknown as MeetSession[]
}

export async function mongoReadMeets(userId: string): Promise<MeetSession[]> {
	const db = await getMongoDb()
	const rows = await db.collection(COLLECTIONS.meetSessions).find({ userId }).toArray()
	return rows as unknown as MeetSession[]
}

export async function mongoWriteMeets(userId: string, meets: MeetSession[]): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.meetSessions).deleteMany({ userId })
	if (meets.length > 0) {
		const stamped = meets.map((m) => ({ ...m, userId }))
		await db.collection(COLLECTIONS.meetSessions).insertMany(stamped as unknown as Record<string, unknown>[])
	}
}

export async function mongoUpsertMeet(userId: string, session: MeetSession): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.meetSessions).updateOne(
		{ id: session.id, userId },
		{ $set: { ...(session as unknown as Record<string, unknown>), userId } },
		{ upsert: true }
	)
}

export async function mongoFindMeetById(userId: string, id: string): Promise<MeetSession | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.meetSessions).findOne({ id, userId })
	return doc ? (doc as unknown as MeetSession) : null
}

export async function mongoDeleteMeet(userId: string, id: string): Promise<boolean> {
	const db = await getMongoDb()
	const r = await db.collection(COLLECTIONS.meetSessions).deleteOne({ id, userId })
	return r.deletedCount > 0
}

/** Returns lightweight meeting headers (no transcript) for cross-domain lookup. */
export async function mongoFetchMeetHeaders(userId: string): Promise<
	Array<{ id: string; title: string; summary: string | null; executiveSummary: string | null; tags: string[]; startedAt: string }>
> {
	const db = await getMongoDb()
	const rows = await db
		.collection(COLLECTIONS.meetSessions)
		.find(
			{ userId },
			{ projection: { id: 1, title: 1, summary: 1, executiveSummary: 1, tags: 1, startedAt: 1 } }
		)
		.toArray()
	return rows.map((r) => ({
		id: String(r.id ?? ""),
		title: String(r.title ?? "Untitled Meeting"),
		summary: typeof r.summary === "string" ? r.summary : null,
		executiveSummary: typeof r.executiveSummary === "string" ? r.executiveSummary : null,
		tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
		startedAt: String(r.startedAt ?? ""),
	}))
}

/** Delete all data belonging to a user across all collections. */
export async function mongoDeleteAllUserData(userId: string): Promise<void> {
	const db = await getMongoDb()
	await Promise.all([
		db.collection(COLLECTIONS.notes).deleteMany({ userId }),
		db.collection(COLLECTIONS.highlights).deleteMany({ userId }),
		db.collection(COLLECTIONS.documents).deleteMany({ userId }),
		db.collection(COLLECTIONS.meetSessions).deleteMany({ userId }),
		db.collection(COLLECTIONS.converseSessions).deleteMany({ userId }),
		db.collection(COLLECTIONS.chunks).deleteMany({ userId }),
		db.collection(COLLECTIONS.preferences).deleteMany({ _id: userId as unknown as string }),
		db.collection(COLLECTIONS.oauthTokens).deleteMany({ userId }),
		db.collection(COLLECTIONS.feedback).deleteMany({ userId }),
		db.collection(COLLECTIONS.appMeta).deleteMany({ _id: `highlights_reset_${userId}` as unknown as string }),
	])
}
