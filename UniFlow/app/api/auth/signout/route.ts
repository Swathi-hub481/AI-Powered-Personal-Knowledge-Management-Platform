import { NextResponse } from "next/server"
import { deleteSession, getTokenFromRequest, clearSessionCookie } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
	const token = getTokenFromRequest(request)
	if (token) {
		await deleteSession(token).catch(() => {})
	}
	return NextResponse.json(
		{ signedOut: true },
		{ headers: { "Set-Cookie": clearSessionCookie() } }
	)
}
