import { NextResponse } from "next/server"
import {
	findUserByEmail,
	verifyPassword,
	createSession,
	buildSessionCookie,
} from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as { email?: unknown; password?: unknown }
		const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
		const password = typeof body.password === "string" ? body.password : ""

		if (!email || !password) {
			return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
		}

		const user = await findUserByEmail(email)
		if (!user || !verifyPassword(password, user.passwordHash)) {
			// Same message for both to avoid user enumeration
			return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
		}

		const token = await createSession(user._id)

		return NextResponse.json(
			{
				user: { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt },
				sessionToken: token,
			},
			{
				status: 200,
				headers: { "Set-Cookie": buildSessionCookie(token) },
			}
		)
	} catch (err) {
		if (err instanceof SyntaxError) {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
		}
		console.error("POST /api/auth/signin", err)
		return NextResponse.json({ error: "Failed to sign in" }, { status: 500 })
	}
}
