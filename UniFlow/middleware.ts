import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/** Gatekeeping: session cookie for the web app, or Bearer token for API clients like the extension. */

const COOKIE_NAME = "uniflow_session"

const PUBLIC_PATHS = [
	"/login",
	"/api/auth/signin",
	"/api/auth/signup",
	"/api/auth/signout",
]

export function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl

	// Always allow Next.js internals, static assets
	if (
		pathname.startsWith("/_next") ||
		pathname.startsWith("/favicon")
	) {
		return NextResponse.next()
	}

	// Always allow public paths (login page + auth API)
	if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
		return NextResponse.next()
	}

	// Bearer token (e.g. browser extension) — let API routes validate via getSessionUserId
	if (pathname.startsWith("/api/")) {
		const auth = request.headers.get("authorization")
		if (auth?.trim().toLowerCase().startsWith("bearer ") && auth.trim().length > 14) {
			return NextResponse.next()
		}
	}

	// Check for session cookie
	const sessionToken = request.cookies.get(COOKIE_NAME)?.value
	if (!sessionToken) {
		// API routes return 401; page routes redirect to /login
		if (pathname.startsWith("/api/")) {
			return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
		}
		const loginUrl = new URL("/login", request.url)
		loginUrl.searchParams.set("next", pathname)
		return NextResponse.redirect(loginUrl)
	}

	return NextResponse.next()
}

export const config = {
	matcher: [
		/*
		 * Match all paths except:
		 * - _next/static, _next/image (Next.js internals)
		 * - favicon.ico
		 */
		"/((?!_next/static|_next/image|favicon.ico).*)",
	],
}
