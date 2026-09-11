import { NextResponse } from "next/server"
import { getUserPreferences, patchUserPreferences } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const data = await getUserPreferences(userId)
		return NextResponse.json({ data }, { status: 200 })
	} catch (err) {
		console.error("GET /api/preferences", err)
		return errorResponse("Failed to load preferences", 500)
	}
}

export async function PATCH(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const body = (await request.json()) as Record<string, unknown>
		const allowed = [
			"theme",
			"fontScale",
			"transcriptLanguage",
			"graphSettings",
			"profile",
			"customTags",
			"settingsPreferences",
			"transcriptHistory",
			"currentUserEmail",
			"knowledgeGraphCache",
			"notionToken",
			"notionAccessToken",
			"notionWorkspaceName",
			"notionWorkspaceIcon",
			"notionParentPageId",
			"notionTaskDbId",
			"notionOauthClientId",
			"notionOauthClientSecret",
		] as const
		const patch: Record<string, unknown> = {}
		for (const k of allowed) {
			if (k in body) {
				patch[k] = body[k]
			}
		}
		const data = await patchUserPreferences(userId, patch)
		return NextResponse.json({ data }, { status: 200 })
	} catch (err) {
		console.error("PATCH /api/preferences", err)
		return errorResponse("Failed to save preferences", 500)
	}
}
