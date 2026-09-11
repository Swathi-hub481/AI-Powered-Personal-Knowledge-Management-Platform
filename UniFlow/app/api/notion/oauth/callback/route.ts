import { NextResponse } from "next/server"
import { getUserPreferences, patchUserPreferences } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) {
		return NextResponse.redirect(new URL("/login", request.url).toString())
	}

	const origin = new URL(request.url).origin
	const callbackUri = `${origin}/api/notion/oauth/callback`

	const { searchParams } = new URL(request.url)
	const code = searchParams.get("code")
	const err = searchParams.get("error")

	const failRedirect = (reason: string) =>
		NextResponse.redirect(
			new URL(`/integrations?notion_error=${encodeURIComponent(reason)}`, request.url).toString()
		)

	if (err) return failRedirect(err)
	if (!code) return failRedirect("No authorization code received from Notion")

	let clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim()
	let clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim()
	const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI?.trim() ?? callbackUri

	if (!clientId || !clientSecret) {
		const prefs = await getUserPreferences(userId)
		clientId = clientId ?? prefs.notionOauthClientId?.trim()
		clientSecret = clientSecret ?? prefs.notionOauthClientSecret?.trim()
	}

	if (!clientId || !clientSecret) {
		return failRedirect(
			"Notion OAuth credentials are not configured. Please add your Client ID and Secret on the Integrations page."
		)
	}

	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

	const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Basic ${credentials}`,
			"Notion-Version": "2022-06-28",
		},
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	})

	if (!tokenRes.ok) {
		const detail = await tokenRes.text()
		return failRedirect(`Token exchange failed: ${detail.slice(0, 200)}`)
	}

	const json = (await tokenRes.json()) as {
		access_token?: string
		workspace_name?: string
		workspace_icon?: string | null
	}

	if (!json.access_token) {
		return failRedirect("No access token returned from Notion")
	}

	await patchUserPreferences(userId, {
		notionAccessToken: json.access_token,
		notionWorkspaceName: json.workspace_name ?? undefined,
		notionWorkspaceIcon: json.workspace_icon ?? undefined,
		notionTaskDbId: null,
	})

	return NextResponse.redirect(
		new URL("/integrations?notion=connected", request.url).toString()
	)
}
