/**
 * Server-side user preferences — scoped per-user by userId.
 */

import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

export type UserPreferencesDoc = {
	_id: string        // userId
	updatedAt?: string
	theme?: "light" | "dark"
	fontScale?: number
	transcriptLanguage?: string
	graphSettings?: {
		enabled?: boolean
		layout?: string
		autoConnect?: boolean
		theme?: string
	}
	profile?: { name?: string; email?: string }
	customTags?: unknown[]
	settingsPreferences?: Record<string, unknown>
	transcriptHistory?: unknown[]
	currentUserEmail?: string
	knowledgeGraphCache?: unknown
	/** Notion internal integration token (legacy / self-hosted) */
	notionToken?: string
	/** Notion OAuth access token — preferred over notionToken when present */
	notionAccessToken?: string
	/** Workspace name returned during OAuth */
	notionWorkspaceName?: string
	/** Workspace icon URL returned during OAuth */
	notionWorkspaceIcon?: string
	/** Optional Notion page ID under which note pages are created */
	notionParentPageId?: string
	/** Cached Notion database ID used for meet action items (auto-detected or created) */
	notionTaskDbId?: string
	/** User-supplied Notion OAuth client ID (used when env var is absent) */
	notionOauthClientId?: string
	/** User-supplied Notion OAuth client secret (used when env var is absent) */
	notionOauthClientSecret?: string
	/** ISO timestamp set once when the preferences doc is first created */
	accountCreatedAt?: string
}

/** Returns the best available Notion auth token (OAuth preferred over internal). */
export function getActiveNotionToken(prefs: UserPreferencesDoc): string | undefined {
	return prefs.notionAccessToken ?? prefs.notionToken
}

export async function getUserPreferences(userId: string): Promise<UserPreferencesDoc> {
	const db = await getMongoDb()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const doc = await db.collection(COLLECTIONS.preferences).findOne({ _id: userId as any })
	return (doc as UserPreferencesDoc | null) ?? { _id: userId }
}

export async function patchUserPreferences(
	userId: string,
	patch: Partial<Omit<UserPreferencesDoc, "_id">>
): Promise<UserPreferencesDoc> {
	const db = await getMongoDb()

	// Separate fields to $set vs $unset (null/undefined values are cleared)
	const setFields: Record<string, unknown> = { updatedAt: new Date().toISOString() }
	const unsetFields: Record<string, 1> = {}

	for (const [k, v] of Object.entries(patch)) {
		if (v === null || v === undefined) {
			unsetFields[k] = 1
		} else {
			setFields[k] = v
		}
	}

	const updateOp: Record<string, unknown> = { $set: setFields }
	if (Object.keys(unsetFields).length > 0) {
		updateOp.$unset = unsetFields
	}
	// Record first-ever creation date so profile can show "member since"
	updateOp.$setOnInsert = { accountCreatedAt: new Date().toISOString() }

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await db.collection(COLLECTIONS.preferences).updateOne(
		{ _id: userId as any },
		updateOp,
		{ upsert: true }
	)
	return getUserPreferences(userId)
}
