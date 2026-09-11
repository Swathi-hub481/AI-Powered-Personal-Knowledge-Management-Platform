import { NextResponse } from "next/server"
import {
	mongoFetchNoteById,
	mongoDeleteNote,
	mongoDeleteChunksForNote,
} from "@/lib/mongo-app-data"
import { getSessionUserId } from "@/lib/auth"

type RouteContext = { params: Promise<{ id: string }> }

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function GET(req: Request, ctx: RouteContext) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)
	const { id } = await ctx.params
	if (!id) return errorResponse("Missing note id", 400)

	const note = await mongoFetchNoteById(userId, id)
	if (!note) return errorResponse("Note not found", 404)

	return NextResponse.json({ data: note })
}

export async function DELETE(req: Request, ctx: RouteContext) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)
	const { id } = await ctx.params
	if (!id) return errorResponse("Missing note id", 400)

	const note = await mongoFetchNoteById(userId, id)
	if (!note) return errorResponse("Note not found", 404)

	await Promise.all([mongoDeleteNote(userId, id), mongoDeleteChunksForNote(userId, id)])

	return NextResponse.json({ success: true })
}
