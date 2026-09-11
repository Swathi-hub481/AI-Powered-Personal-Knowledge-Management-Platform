import { NextResponse } from "next/server"
import type { ActionItem } from "@/lib/meet-types"
import { mongoDeleteMeet, mongoFindMeetById, mongoUpsertMeet } from "@/lib/mongo-app-data"
import { getSessionUserId } from "@/lib/auth"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

interface PatchPayload {
	actionItems?: ActionItem[]
	title?: string
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const { id } = await params
		const session = await mongoFindMeetById(userId, id)
		if (!session) return errorResponse("Session not found", 404)
		return NextResponse.json({ data: session }, { status: 200 })
	} catch (err) {
		console.error("GET /api/meets/[id] failed", err)
		return errorResponse("Failed to load session", 500)
	}
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const { id } = await params
		const session = await mongoFindMeetById(userId, id)
		if (!session) return errorResponse("Session not found", 404)

		const body = (await request.json()) as PatchPayload
		if (Array.isArray(body.actionItems)) session.actionItems = body.actionItems
		if (typeof body.title === "string" && body.title.trim()) session.title = body.title.trim()

		session.updatedAt = new Date().toISOString()
		await mongoUpsertMeet(userId, session)
		return NextResponse.json({ data: session }, { status: 200 })
	} catch (err) {
		console.error("PATCH /api/meets/[id] failed", err)
		return errorResponse("Failed to update session", 500)
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const { id } = await params
		const ok = await mongoDeleteMeet(userId, id)
		if (!ok) return errorResponse("Session not found", 404)
		return NextResponse.json({ data: { deleted: id } }, { status: 200 })
	} catch (err) {
		console.error("DELETE /api/meets/[id] failed", err)
		return errorResponse("Failed to delete session", 500)
	}
}
