import { NextResponse } from "next/server"
import { getUserPreferences } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

	const prefs = await getUserPreferences(userId)

	const envClientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim()
	const envClientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim()

	const oauthConfigured = !!(
		(envClientId || prefs.notionOauthClientId?.trim()) &&
		(envClientSecret || prefs.notionOauthClientSecret?.trim())
	)

	const credentialsInDb = !!(
		prefs.notionOauthClientId?.trim() &&
		prefs.notionOauthClientSecret?.trim()
	)

	return NextResponse.json({
		oauthConfigured,
		credentialsInDb,
		connected: !!(prefs.notionAccessToken ?? prefs.notionToken),
		oauthConnected: !!prefs.notionAccessToken,
		workspaceName: prefs.notionWorkspaceName ?? null,
		workspaceIcon: prefs.notionWorkspaceIcon ?? null,
		hasParentPage: !!prefs.notionParentPageId,
		hasCachedDb: !!prefs.notionTaskDbId,
	})
}
