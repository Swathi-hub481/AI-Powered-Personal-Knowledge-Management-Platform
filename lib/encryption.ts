/**
 * AES-256-GCM encryption at rest for sensitive user data.
 *
 * Wraps note content, conversation turns, and highlight text before MongoDB writes.
 * Encrypted values are prefixed with "enc:" so readers can detect and decrypt transparently.
 *
 * Key derivation: SHA-256 of ENCRYPTION_KEY env var → 32-byte AES key.
 * If ENCRYPTION_KEY is absent, all functions pass-through (no encryption).
 *
 * Note: the search index (kb_chunks) stores derived text fragments in plaintext
 * because BM25/vector search requires it. The primary data stores (kb_notes,
 * converse_sessions, kb_highlights) hold the encrypted originals.
 */

import crypto from "node:crypto"

const ALGO = "aes-256-gcm" as const
const IV_LEN = 12
const ENC_PREFIX = "enc:"

function deriveKey(): Buffer | null {
	const raw = process.env.ENCRYPTION_KEY?.trim()
	if (!raw) return null
	return crypto.createHash("sha256").update(raw).digest()
}

export function isEncryptionEnabled(): boolean {
	return deriveKey() !== null
}

export function encrypt(plaintext: string): string {
	const key = deriveKey()
	if (!key) return plaintext

	const iv = crypto.randomBytes(IV_LEN)
	const cipher = crypto.createCipheriv(ALGO, key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
	const tag = cipher.getAuthTag()

	return `${ENC_PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decrypt(value: string): string {
	if (!value.startsWith(ENC_PREFIX)) return value

	const key = deriveKey()
	if (!key) return value

	const payload = value.slice(ENC_PREFIX.length)
	const parts = payload.split(".")
	if (parts.length !== 3) return value

	try {
		const iv = Buffer.from(parts[0]!, "base64")
		const tag = Buffer.from(parts[1]!, "base64")
		const data = Buffer.from(parts[2]!, "base64")

		const decipher = crypto.createDecipheriv(ALGO, key, iv)
		decipher.setAuthTag(tag)
		return decipher.update(data).toString("utf-8") + decipher.final("utf-8")
	} catch {
		return value
	}
}

export function encryptFields<T extends Record<string, unknown>>(
	obj: T,
	fields: (keyof T)[]
): T {
	const out = { ...obj }
	for (const f of fields) {
		if (typeof out[f] === "string") {
			(out as Record<string, unknown>)[f as string] = encrypt(out[f] as string)
		}
	}
	return out
}

export function decryptFields<T extends Record<string, unknown>>(
	obj: T,
	fields: (keyof T)[]
): T {
	const out = { ...obj }
	for (const f of fields) {
		if (typeof out[f] === "string") {
			(out as Record<string, unknown>)[f as string] = decrypt(out[f] as string)
		}
	}
	return out
}
