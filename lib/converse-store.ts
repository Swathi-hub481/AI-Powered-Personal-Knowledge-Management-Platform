/**
 * Conversation persistence layer — stores Converse chat sessions in MongoDB.
 *
 * Each session groups related turns (Q&A pairs) for a single Converse page visit.
 * Sessions are:
 *   1. Auto-persisted after every RAG exchange (meet-assistant route).
 *   2. Indexed by buildChunkIndex so future queries find past conversation insights.
 *   3. Encrypted at rest (content fields) when ENCRYPTION_KEY is set.
 */

import crypto from "node:crypto"
import { getMongoDb, COLLECTIONS } from "./mongodb"
import { encrypt, decrypt } from "./encryption"


export interface ConverseTurn {
	role: "user" | "assistant"
	content: string
	timestamp: string
	citations?: Array<{
		sourceType: string
		title: string
		chunkId?: string
	}>
}

export interface ConverseSession {
	id: string
	userId: string
	title: string
	turns: ConverseTurn[]
	scope: string
	createdAt: string
	updatedAt: string
}


export function newSessionId(): string {
	return `conv-${crypto.randomBytes(8).toString("hex")}`
}

function encryptTurns(turns: ConverseTurn[]): ConverseTurn[] {
	return turns.map((t) => ({ ...t, content: encrypt(t.content) }))
}

function decryptTurns(turns: ConverseTurn[]): ConverseTurn[] {
	return turns.map((t) => ({ ...t, content: decrypt(t.content) }))
}


/**
 * Append a user question + AI answer to a conversation session.
 * Creates the session document on first call (upsert).
 */
export async function appendConverseTurns(
	userId: string,
	sessionId: string,
	userMessage: string,
	assistantMessage: string,
	scope: string,
	citations?: ConverseTurn["citations"]
): Promise<void> {
	const db = await getMongoDb()
	const now = new Date().toISOString()

	const newTurns: ConverseTurn[] = [
		{ role: "user", content: userMessage, timestamp: now },
		{ role: "assistant", content: assistantMessage, timestamp: now, citations },
	]

	const titleGuess = userMessage.length > 80
		? userMessage.slice(0, 77) + "..."
		: userMessage

	await db.collection(COLLECTIONS.converseSessions).updateOne(
		{ id: sessionId, userId },
		{
			$push: { turns: { $each: encryptTurns(newTurns) } },
			$set: { updatedAt: now, scope },
			$setOnInsert: {
				id: sessionId,
				userId,
				title: titleGuess,
				createdAt: now,
			},
		} as Record<string, unknown>,
		{ upsert: true }
	)
}


export async function loadConverseSession(
	userId: string,
	sessionId: string
): Promise<ConverseSession | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.converseSessions).findOne({ id: sessionId, userId })
	if (!doc) return null
	const session = doc as unknown as ConverseSession
	session.turns = decryptTurns(session.turns ?? [])
	return session
}

export async function loadRecentConverseSessions(
	userId: string,
	limit = 20
): Promise<ConverseSession[]> {
	const db = await getMongoDb()
	const rows = await db
		.collection(COLLECTIONS.converseSessions)
		.find({ userId })
		.sort({ updatedAt: -1 })
		.limit(limit)
		.toArray()

	return (rows as unknown as ConverseSession[]).map((s) => ({
		...s,
		turns: decryptTurns(s.turns ?? []),
	}))
}

/**
 * Lightweight read for chunk indexing — returns decrypted turns.
 */
export async function loadAllConverseSessionsForIndex(
	userId: string
): Promise<ConverseSession[]> {
	const db = await getMongoDb()
	const rows = await db
		.collection(COLLECTIONS.converseSessions)
		.find({ userId })
		.toArray()

	return (rows as unknown as ConverseSession[]).map((s) => ({
		...s,
		turns: decryptTurns(s.turns ?? []),
	}))
}

export async function deleteConverseSession(
	userId: string,
	sessionId: string
): Promise<boolean> {
	const db = await getMongoDb()
	const r = await db.collection(COLLECTIONS.converseSessions).deleteOne({ id: sessionId, userId })
	return r.deletedCount > 0
}
