import { NextResponse } from "next/server"
import { getSessionUserId, findUserById } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) {
		return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
	}

	const user = await findUserById(userId)
	if (!user) {
		return NextResponse.json({ error: "User not found" }, { status: 404 })
	}

	return NextResponse.json({
		user: { id: user._id, name: user.name, email: user.email, createdAt: user.createdAt },
	})
}
