import { NextResponse } from "next/server"
import { getSessionUserId, findUserById, hashPassword, verifyPassword } from "@/lib/auth"
import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)

	let currentPassword: string | undefined
	let newPassword: string | undefined

	try {
		const body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown }
		currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : undefined
		newPassword = typeof body.newPassword === "string" ? body.newPassword : undefined
	} catch {
		return errorResponse("Invalid JSON body", 400)
	}

	if (!currentPassword || !newPassword) {
		return errorResponse("currentPassword and newPassword are required", 400)
	}
	if (newPassword.length < 8) {
		return errorResponse("New password must be at least 8 characters", 400)
	}

	const user = await findUserById(userId)
	if (!user) return errorResponse("User not found", 404)

	if (!verifyPassword(currentPassword, user.passwordHash)) {
		return errorResponse("Current password is incorrect", 403)
	}

	const db = await getMongoDb()
	await db.collection(COLLECTIONS.users).updateOne(
		{ _id: userId as unknown as string },
		{ $set: { passwordHash: hashPassword(newPassword) } }
	)

	return NextResponse.json({ success: true })
}
