import { NextResponse } from "next/server"
import { readNotes, writeNotes, organizeNoteContent, appendHighlightsToNote } from "@/lib/notes-store"
import { getSessionUserId } from "@/lib/auth"
import { buildChunkIndex } from "@/lib/chunk-store"

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0
}

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const notes = await readNotes(userId)
		return NextResponse.json({ data: notes }, { status: 200 })
	} catch (err) {
		console.error("GET /api/notes failed", err)
		return errorResponse("Failed to fetch notes", 500)
	}
}

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const body = (await request.json()) as { id?: unknown }

		if (!isNonEmptyString(body.id)) {
			return errorResponse("Invalid payload: 'id' must be a non-empty string", 400)
		}

		const notes = await readNotes(userId)
		const idx = notes.findIndex((n) => n.id === (body.id as string).trim())

		if (idx === -1) {
			return errorResponse("Note not found", 404)
		}

		const note = notes[idx]
		const organized = await organizeNoteContent(note.content, note.title, note.url)

		if (!organized) {
			return errorResponse("AI organization unavailable — check GROQ_API_KEY", 503)
		}

		notes[idx] = {
			...note,
			content: organized.content,
			flowNodes: organized.flowNodes,
			updatedAt: new Date().toISOString(),
		}

		await writeNotes(userId, notes)
		// Rebuild index in background so the reorganised note is immediately searchable
		void buildChunkIndex(userId)
		return NextResponse.json({ data: notes[idx] }, { status: 200 })
	} catch (err) {
		if (err instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400)
		}
		console.error("POST /api/notes (organize) failed", err)
		return errorResponse("Failed to organize note", 500)
	}
}

export async function PATCH(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const body = (await request.json()) as { id?: unknown; content?: unknown; appendHighlights?: unknown }

		if (!isNonEmptyString(body.id)) {
			return errorResponse("Invalid payload: 'id' must be a non-empty string", 400)
		}

		const noteId = (body.id as string).trim()

		if (Array.isArray(body.appendHighlights)) {
			const texts = body.appendHighlights.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
			if (texts.length === 0) {
				return errorResponse("Invalid payload: 'appendHighlights' must be a non-empty string array", 400)
			}
			const updated = await appendHighlightsToNote(userId, noteId, texts)
			if (!updated) {
				return errorResponse("Note not found", 404)
			}
			void buildChunkIndex(userId)
			return NextResponse.json({ data: updated }, { status: 200 })
		}

		if (typeof body.content !== "string") {
			return errorResponse("Invalid payload: 'content' must be a string", 400)
		}

		const notes = await readNotes(userId)
		const idx = notes.findIndex((n) => n.id === noteId)

		if (idx === -1) {
			return errorResponse("Note not found", 404)
		}

		notes[idx] = {
			...notes[idx],
			content: body.content,
			updatedAt: new Date().toISOString(),
		}

		await writeNotes(userId, notes)
		// Rebuild index in background so the updated note content is immediately searchable
		void buildChunkIndex(userId)
		return NextResponse.json({ data: notes[idx] }, { status: 200 })
	} catch (err) {
		if (err instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400)
		}
		console.error("PATCH /api/notes failed", err)
		return errorResponse("Failed to update note", 500)
	}
}
