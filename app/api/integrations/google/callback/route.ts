import { NextResponse } from "next/server"
import { saveGoogleTokens } from "@/lib/google-oauth"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) {
		return NextResponse.redirect(new URL("/login", request.url).toString())
	}
	const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
	const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()

	const { searchParams } = new URL(request.url)
	const code = searchParams.get("code")
	const err = searchParams.get("error")

	if (err) {
		return NextResponse.json({ error: err }, { status: 400 })
	}

	if (!code || !clientId || !clientSecret || !redirectUri) {
		return NextResponse.json({ error: "Invalid callback or missing Google OAuth env" }, { status: 400 })
	}

	const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	})

	if (!tokenRes.ok) {
		const t = await tokenRes.text()
		return NextResponse.json({ error: "token_exchange_failed", detail: t.slice(0, 400) }, { status: 502 })
	}

	const json = (await tokenRes.json()) as {
		access_token?: string
		refresh_token?: string
		expires_in?: number
	}

	if (!json.access_token) {
		return NextResponse.json({ error: "invalid_token_response" }, { status: 502 })
	}

	await saveGoogleTokens({
		userId,
		accessToken: json.access_token,
		refreshToken: json.refresh_token ?? "",
		expiresInSec: json.expires_in ?? 3600,
	})

	return NextResponse.redirect(new URL("/documents?google=connected", request.url).toString())
}
