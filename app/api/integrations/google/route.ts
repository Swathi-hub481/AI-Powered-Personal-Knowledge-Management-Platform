import { NextResponse } from "next/server"

/**
 * Google Drive OAuth entry points (read-only). Use authorize → callback to store tokens in MongoDB.
 */

export async function GET() {
	return NextResponse.json({
		status: "ready",
		authorize: "/api/integrations/google/authorize",
		callback: "/api/integrations/google/callback",
		message:
			"After OAuth, tokens are stored in MongoDB (`oauth_tokens.google`). Poll Drive for Meet recordings or shared files, then download and POST to /api/meets. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.",
		docs: "https://developers.google.com/workspace/drive/api/guides/about-sdk",
	})
}
