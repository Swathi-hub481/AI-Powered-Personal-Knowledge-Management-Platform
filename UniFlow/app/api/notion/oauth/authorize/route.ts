import { NextResponse } from "next/server"
import { getUserPreferences } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

	const origin = new URL(request.url).origin
	const callbackUri = `${origin}/api/notion/oauth/callback`

	let clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim()
	const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI?.trim() ?? callbackUri

	if (!clientId) {
		const prefs = await getUserPreferences(userId)
		clientId = prefs.notionOauthClientId?.trim()
	}

	if (!clientId) {
		return NextResponse.json(
			{
				error:
					"Notion OAuth is not configured. Go to the Integrations page and " +
					"enter your Notion OAuth Client ID and Secret.",
			},
			{ status: 503 }
		)
	}

	const url = new URL("https://api.notion.com/v1/oauth/authorize")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("owner", "user")
	url.searchParams.set("redirect_uri", redirectUri)

	return NextResponse.redirect(url.toString())
}
