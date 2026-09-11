/**
 * Sessions, password hashing (pbkdf2), and cookie parsing. Node crypto only.
 */

import crypto from "node:crypto"
import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

const COOKIE_NAME = "uniflow_session"
const SESSION_TTL_DAYS = 30
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEY_LEN = 64
const PBKDF2_DIGEST = "sha512"

export interface UserDoc {
	_id: string        // userId (uuid)
	email: string
	passwordHash: string
	name: string
	createdAt: string
}

export interface SessionDoc {
	_id: string        // session token (hex)
	userId: string
	expiresAt: string  // ISO timestamp
}

/** Returns "salt:hash" using pbkdf2. */
export function hashPassword(password: string): string {
	const salt = crypto.randomBytes(16).toString("hex")
	const hash = crypto
		.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST)
		.toString("hex")
	return `${salt}:${hash}`
}

/** Constant-time comparison against a stored "salt:hash" value. */
export function verifyPassword(password: string, stored: string): boolean {
	const [salt, expectedHash] = stored.split(":")
	if (!salt || !expectedHash) return false
	const actualHash = crypto
		.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST)
		.toString("hex")
	// timingSafeEqual requires same-length buffers
	const actual = Buffer.from(actualHash, "hex")
	const expected = Buffer.from(expectedHash, "hex")
	if (actual.length !== expected.length) return false
	return crypto.timingSafeEqual(actual, expected)
}

/** Create a new session for `userId`. Returns the session token. */
export async function createSession(userId: string): Promise<string> {
	const db = await getMongoDb()
	const token = crypto.randomBytes(32).toString("hex")
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

	await db.collection(COLLECTIONS.authSessions).insertOne({
		_id: token as unknown as string,
		userId,
		expiresAt,
	})

	return token
}

/** Look up a session token and return the userId, or null if invalid/expired. */
export async function getSessionUserId(request: Request): Promise<string | null> {
	const token = getTokenFromRequest(request)
	if (!token) return null

	const db = await getMongoDb()
	const doc = (await db.collection(COLLECTIONS.authSessions).findOne({
		_id: token as unknown as string,
	})) as SessionDoc | null

	if (!doc) return null
	if (new Date(doc.expiresAt) < new Date()) {
		await db.collection(COLLECTIONS.authSessions).deleteOne({ _id: token as unknown as string })
		return null
	}

	return doc.userId
}

/** Delete a session (sign out). */
export async function deleteSession(token: string): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.authSessions).deleteOne({ _id: token as unknown as string })
}

/** Delete all sessions for a user (e.g. when deleting account). */
export async function deleteAllUserSessions(userId: string): Promise<void> {
	const db = await getMongoDb()
	await db.collection(COLLECTIONS.authSessions).deleteMany({ userId })
}

export function getTokenFromRequest(request: Request): string | null {
	const authHeader = request.headers.get("authorization")
	if (authHeader) {
		const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
		if (m?.[1]) {
			const t = m[1].trim()
			if (t.length > 0) return t
		}
	}
	const cookieHeader = request.headers.get("cookie") ?? ""
	const pairs = cookieHeader.split(";").map((s) => s.trim())
	for (const pair of pairs) {
		const eqIdx = pair.indexOf("=")
		if (eqIdx === -1) continue
		const name = pair.slice(0, eqIdx).trim()
		const value = pair.slice(eqIdx + 1).trim()
		if (name === COOKIE_NAME) return value
	}
	return null
}

/** Build the Set-Cookie header value for a session token. */
export function buildSessionCookie(token: string): string {
	const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60
	return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

/** Build the Set-Cookie header value that clears the session cookie. */
export function clearSessionCookie(): string {
	return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.users).findOne({ email: email.toLowerCase() })
	return doc as UserDoc | null
}

export async function findUserById(id: string): Promise<UserDoc | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.users).findOne({ _id: id as unknown as string })
	return doc as UserDoc | null
}

export async function createUser(name: string, email: string, password: string): Promise<UserDoc> {
	const db = await getMongoDb()
	const userId = crypto.randomUUID()
	const user: UserDoc = {
		_id: userId,
		email: email.toLowerCase(),
		passwordHash: hashPassword(password),
		name: name.trim(),
		createdAt: new Date().toISOString(),
	}
	await db.collection(COLLECTIONS.users).insertOne(user as unknown as Record<string, unknown>)
	return user
}

/** Ensure required MongoDB indexes exist. Called at startup. */
export async function ensureAuthIndexes(): Promise<void> {
	try {
		const db = await getMongoDb()
		await db.collection(COLLECTIONS.users).createIndex({ email: 1 }, { unique: true })
		await db.collection(COLLECTIONS.authSessions).createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0 }
		)
		for (const col of ["kb_notes", "kb_highlights", "meet_sessions", "kb_chunks", "kb_documents"]) {
			await db.collection(col).createIndex({ userId: 1 })
		}
	} catch {
	}
}
