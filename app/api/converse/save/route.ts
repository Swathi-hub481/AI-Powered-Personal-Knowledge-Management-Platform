/**
 * POST /api/converse/save — Save an AI conversation insight as a new note.
 *
 * Called from the Converse UI "Save as Note" button. Takes a Q&A pair,
 * creates a note titled "AI Insight: <topic>", and triggers a chunk index
 * rebuild so the insight is immediately searchable.
 */

import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { getSessionUserId } from "@/lib/auth"
import { readNotes, writeNotes, type Note } from "@/lib/notes-store"
import { buildChunkIndex } from "@/lib/chunk-store"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

interface SaveBody {
	question?: unknown
	answer?: unknown
	citations?: unknown
}

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)

	try {
		const body = (await request.json()) as SaveBody

		if (typeof body.question !== "string" || !body.question.trim()) {
			return errorResponse("question is required", 400)
		}
		if (typeof body.answer !== "string" || !body.answer.trim()) {
			return errorResponse("answer is required", 400)
		}

		const question = body.question.trim()
		const answer = body.answer.trim()

		const titleTopic = question.length > 60
			? question.slice(0, 57) + "..."
			: question

		const citationLines = Array.isArray(body.citations)
			? (body.citations as Array<{ title?: string; sourceType?: string }>)
					.filter((c) => c.title)
					.map((c) => `- ${c.title} (${c.sourceType ?? "unknown"})`)
					.join("\n")
			: ""

		const content = [
			`## Question`,
			question,
			"",
			`## AI Answer`,
			answer,
			...(citationLines
				? ["", "## Sources Referenced", citationLines]
				: []),
			"",
			`*Saved from UniFlow Converse on ${new Date().toLocaleDateString()}*`,
		].join("\n")

		const now = new Date().toISOString()
		const newNote: Note = {
			id: `insight-${crypto.randomBytes(6).toString("hex")}`,
			title: `AI Insight: ${titleTopic}`,
			content,
			url: "",
			tags: ["ai-insight", "conversation"],
			createdAt: now,
			updatedAt: now,
			rawHighlights: [],
		}

		const existing = await readNotes(userId)
		existing.push(newNote)
		await writeNotes(userId, existing)

		void buildChunkIndex(userId)

		return NextResponse.json(
			{ data: { noteId: newNote.id, title: newNote.title } },
			{ status: 201 }
		)
	} catch (err) {
		if (err instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400)
		}
		console.error("POST /api/converse/save failed", err)
		return errorResponse("Failed to save insight", 500)
	}
}
