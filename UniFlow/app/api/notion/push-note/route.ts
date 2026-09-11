import { NextResponse } from "next/server"
import { getUserPreferences } from "@/lib/user-preferences"
import { mongoFetchNoteById } from "@/lib/mongo-app-data"
import { pushNoteToNotion } from "@/lib/notion-client"
import { getSessionUserId } from "@/lib/auth"

function errorResponse(message: string, status = 400) {
	return NextResponse.json({ error: message }, { status })
}

export async function POST(req: Request) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)

	let noteId: string | undefined
	try {
		const body = (await req.json()) as { noteId?: string }
		noteId = body.noteId
	} catch {
		return errorResponse("Invalid request body")
	}

	if (!noteId) return errorResponse("Missing noteId")

	const prefs = await getUserPreferences(userId)
	if (!prefs.notionToken) {
		return errorResponse("Notion is not connected. Add your API token in Integrations.", 403)
	}

	const note = await mongoFetchNoteById(userId, noteId)
	if (!note) return errorResponse("Note not found", 404)

	try {
		const result = await pushNoteToNotion(
			prefs.notionToken,
			{
				id: note.id,
				title: note.title,
				content: note.content,
				tags: note.tags ?? [],
				url: note.url,
				updatedAt: note.updatedAt,
			},
			prefs.notionParentPageId
		)
		return NextResponse.json({ url: result.url, pageId: result.pageId })
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error"
		return errorResponse(`Notion API error: ${msg}`, 502)
	}
}
