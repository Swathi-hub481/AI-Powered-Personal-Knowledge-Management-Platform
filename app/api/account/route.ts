import { NextResponse } from "next/server"
import {
	getSessionUserId,
	deleteAllUserSessions,
	findUserById,
	clearSessionCookie,
} from "@/lib/auth"
import { mongoDeleteAllUserData } from "@/lib/mongo-app-data"
import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"

interface DeletePayload {
	confirmText?: unknown
}

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function DELETE(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)

	try {
		const payload = (await request.json()) as DeletePayload

		if (typeof payload.confirmText !== "string" || payload.confirmText.trim() !== "DELETE") {
			return errorResponse("Invalid payload: confirmText must be DELETE", 400)
		}

		const user = await findUserById(userId)
		if (!user) return errorResponse("User not found", 404)

		// Delete all user data
		await mongoDeleteAllUserData(userId)

		// Delete the user account itself
		const db = await getMongoDb()
		await db.collection(COLLECTIONS.users).deleteOne({ _id: userId as unknown as string })

		// Delete all sessions for this user
		await deleteAllUserSessions(userId)

		const response = NextResponse.json({ data: { deleted: true } }, { status: 200 })
		response.headers.set("Set-Cookie", clearSessionCookie())
		return response
	} catch (error) {
		if (error instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400)
		}
		console.error("DELETE /api/account failed", error)
		return errorResponse("Failed to delete account data", 500)
	}
}
