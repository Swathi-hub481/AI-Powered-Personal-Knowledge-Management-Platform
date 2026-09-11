import { NextResponse } from "next/server"

const SCOPE = [
	"https://www.googleapis.com/auth/drive.readonly",
	"https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ")

export async function GET() {
	const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
	const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim()
	if (!clientId || !redirectUri) {
		return NextResponse.json(
			{ error: "Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI" },
			{ status: 503 }
		)
	}

	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
	url.searchParams.set("client_id", clientId)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("scope", SCOPE)
	url.searchParams.set("access_type", "offline")
	url.searchParams.set("prompt", "consent")

	return NextResponse.redirect(url.toString())
}
