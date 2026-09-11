import { NextResponse } from "next/server"
import {
	createUser,
	createSession,
	findUserByEmail,
	buildSessionCookie,
	ensureAuthIndexes,
} from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
	try {
		await ensureAuthIndexes()

		const body = (await request.json()) as { name?: unknown; email?: unknown; password?: unknown }
		const name = typeof body.name === "string" ? body.name.trim() : ""
		const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
		const password = typeof body.password === "string" ? body.password : ""

		if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
		}
		if (password.length < 8) {
			return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
		}

		const existing = await findUserByEmail(email)
		if (existing) {
			return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
		}

		const user = await createUser(name, email, password)
		const token = await createSession(user._id)

		return NextResponse.json(
			{
				user: { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt },
				sessionToken: token,
			},
			{
				status: 201,
				headers: { "Set-Cookie": buildSessionCookie(token) },
			}
		)
	} catch (err) {
		if (err instanceof SyntaxError) {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
		}
		console.error("POST /api/auth/signup", err)
		return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
	}
}
