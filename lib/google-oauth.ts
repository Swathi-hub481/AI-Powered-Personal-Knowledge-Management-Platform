/**
 * Google OAuth tokens (Drive import) stored in MongoDB — scoped per user.
 */

import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

export interface GoogleTokenDoc {
	_id: string    // userId
	userId: string
	accessToken: string
	refreshToken: string
	expiresAtMs: number
	updatedAt: string
}

export async function getStoredGoogleTokens(userId: string): Promise<GoogleTokenDoc | null> {
	const db = await getMongoDb()
	const doc = await db.collection(COLLECTIONS.oauthTokens).findOne({ _id: userId as unknown as string })
	return doc as GoogleTokenDoc | null
}

export async function saveGoogleTokens(params: {
	userId: string
	accessToken: string
	refreshToken: string
	expiresInSec: number
}): Promise<void> {
	const db = await getMongoDb()
	const expiresAtMs = Date.now() + params.expiresInSec * 1000
	await db.collection(COLLECTIONS.oauthTokens).updateOne(
		{ _id: params.userId as unknown as string },
		{
			$set: {
				_id: params.userId,
				userId: params.userId,
				accessToken: params.accessToken,
				refreshToken: params.refreshToken,
				expiresAtMs,
				updatedAt: new Date().toISOString(),
			},
		},
		{ upsert: true }
	)
}
