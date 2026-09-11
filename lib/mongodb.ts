/**
 * MongoDB connection — required for Verdant (lexical index, vectors, app data).
 */

import { MongoClient, type Db } from "mongodb"

let client: MongoClient | null = null
let connecting: Promise<MongoClient> | null = null

export function isMongoConfigured(): boolean {
	return Boolean(process.env.MONGODB_URI?.trim())
}

export class MongoNotConfiguredError extends Error {
	constructor() {
		super("MONGODB_URI is not set. Configure MongoDB to run Verdant.")
		this.name = "MongoNotConfiguredError"
	}
}

export async function getMongoClient(): Promise<MongoClient> {
	if (!isMongoConfigured()) {
		throw new MongoNotConfiguredError()
	}
	if (client) return client
	if (!connecting) {
		connecting = MongoClient.connect(process.env.MONGODB_URI!, {
			maxPoolSize: 10,
			serverSelectionTimeoutMS: 8000,
			connectTimeoutMS: 8000,
			socketTimeoutMS: 20000,
		}).then((c) => {
			client = c
			return c
		})
	}
	return connecting
}

/** Throws if MONGODB_URI is missing. */
export async function getMongoDb(): Promise<Db> {
	const c = await getMongoClient()
	const name = process.env.MONGODB_DB_NAME?.trim() || "verdant_kb"
	return c.db(name)
}

export const COLLECTIONS = {
	chunks: "kb_chunks",
	documents: "kb_documents",
	feedback: "rag_feedback",
	entities: "kb_entities",
	sessions: "user_sessions",
	notes: "kb_notes",
	highlights: "kb_highlights",
	meetSessions: "meet_sessions",
	/** Persisted Converse chat sessions — indexed into the RAG pipeline */
	converseSessions: "converse_sessions",
	indexStats: "kb_index_stats",
	appMeta: "app_metadata",
	preferences: "user_preferences",
	oauthTokens: "oauth_tokens",
	/** Auth: registered user accounts */
	users: "users",
	/** Auth: active login sessions (TTL-indexed on expiresAt) */
	authSessions: "auth_sessions",
} as const
