import { NextResponse } from "next/server"
import { getUserPreferences, patchUserPreferences, getActiveNotionToken } from "@/lib/user-preferences"
import { mongoFindMeetById } from "@/lib/mongo-app-data"
import { pushActionsToNotion } from "@/lib/notion-client"
import type { ActionItem } from "@/lib/meet-types"
import { getSessionUserId } from "@/lib/auth"

function errorResponse(message: string, status = 400) {
	return NextResponse.json({ error: message }, { status })
}

export async function POST(req: Request) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)

	let sessionId: string | undefined
	let actionItemIds: string[] | undefined
	let targetPageId: string | undefined
	try {
		const body = (await req.json()) as { sessionId?: string; actionItemIds?: string[]; targetPageId?: string }
		sessionId = body.sessionId
		actionItemIds = body.actionItemIds
		targetPageId = body.targetPageId?.trim() || undefined
	} catch {
		return errorResponse("Invalid request body")
	}

	if (!sessionId) return errorResponse("Missing sessionId")

	const prefs = await getUserPreferences(userId)
	const notionToken = getActiveNotionToken(prefs)
	if (!notionToken) {
		return errorResponse("Notion is not connected. Go to Integrations and connect Notion.", 403)
	}
	const isOAuthToken = !!prefs.notionAccessToken

	const session = await mongoFindMeetById(userId, sessionId)
	if (!session) return errorResponse("Session not found", 404)

	const allItems: ActionItem[] = session.actionItems ?? []
	if (allItems.length === 0) return errorResponse("This session has no action items", 422)

	// Filter to specific IDs if provided, otherwise push all
	const items = actionItemIds?.length
		? allItems.filter((a) => actionItemIds!.includes(a.id))
		: allItems

	if (items.length === 0) return errorResponse("None of the requested action item IDs were found", 422)

	// Use cached DB only when no explicit page destination is provided
	// (if the user picked a page, always create/update in that page's DB)
	const effectiveDbId = targetPageId ? undefined : prefs.notionTaskDbId

	const attemptPush = async (dbId: string | undefined) =>
		pushActionsToNotion(
			notionToken,
			session,
			items,
			dbId,
			targetPageId ?? prefs.notionParentPageId,
			isOAuthToken
		)

	try {
		let result
		try {
			result = await attemptPush(effectiveDbId)
		} catch (firstErr) {
			// If the cached database is inaccessible, clear the cache and retry
			const msg = firstErr instanceof Error ? firstErr.message : ""
			const isNotFound =
				msg.includes("object_not_found") ||
				msg.includes("Could not find database") ||
				msg.includes("Could not find data source")

			if (isNotFound && effectiveDbId) {
				await patchUserPreferences(userId, { notionTaskDbId: null })
				result = await attemptPush(undefined)
			} else {
				throw firstErr
			}
		}

		// Cache the resolved database ID for faster future pushes
		if (result.dbId && prefs.notionTaskDbId !== result.dbId) {
			await patchUserPreferences(userId, { notionTaskDbId: result.dbId })
		}

		return NextResponse.json({
			url: result.url,
			dbId: result.dbId,
			created: result.created,
			upserted: result.upserted,
			updated: result.updated,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error"

		// Surface actionable guidance for common Notion permission errors
		if (msg.includes("object_not_found") || msg.includes("Could not find")) {
			return errorResponse(
				"Notion could not find the target database. Make sure you have shared the relevant pages and databases with your integration at notion.so/my-integrations.",
				502
			)
		}
		if (msg.includes("default page is configured") || msg.includes("parent page")) {
			return errorResponse(msg, 502)
		}

		return errorResponse(`Notion API error: ${msg}`, 502)
	}
}
