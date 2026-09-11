import { NextResponse } from "next/server"
import { runIngestPipeline } from "@/lib/ingest/pipeline"
import { buildChunkIndex } from "@/lib/chunk-store"
import { ensureMongoIndexes } from "@/lib/mongo-knowledge"
import { callGroqChat } from "@/lib/groq-chat-client"
import { readNotes, writeNotes } from "@/lib/notes-store"
import type { Note } from "@/lib/notes-store"
import { getSessionUserId } from "@/lib/auth"
import crypto from "node:crypto"

export const runtime = "nodejs"
export const maxDuration = 300

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}


async function generateDocumentNote(
	docId: string,
	title: string,
	rawText: string,
	tags: string[],
	extractedKeywords: string[],
	extractedActionItems: string[]
): Promise<Note | null> {
	const now = new Date().toISOString()

	// Build note content via GPT-OSS (Groq) — summary + action items + keywords
	let noteContent = ""

	if (process.env.GROQ_API_KEY) {
		const snippet = rawText.slice(0, 10000)
		const actionBlock = extractedActionItems.length > 0
			? `\n\n## Action Items\n${extractedActionItems.map((a) => `- ${a}`).join("\n")}`
			: ""
		const keywordBlock = extractedKeywords.length > 0
			? `\n\n**Key topics:** ${extractedKeywords.slice(0, 20).join(", ")}`
			: ""

		const raw = await callGroqChat(
			[
				{
					role: "system",
					content:
						"You write comprehensive document notes for a personal knowledge base using Markdown. " +
						"Use ## headings, bullet lists, and **bold** for key terms. No markdown fences (no ```). " +
						"Structure exactly:\n" +
						"## Executive Summary\n2-3 sentence overview.\n" +
						"## Key Concepts\nBullet list of the main ideas with detail.\n" +
						"## Important Facts & Data\nSpecific numbers, names, findings from the document.\n" +
						"## Cue Questions\n3-5 review questions a student could use.\n" +
						"## Takeaway\nOne-sentence bottom-line.\n" +
						"Be thorough — include actual names, figures, and facts from the document.",
				},
				{
					role: "user",
					content: `Document title: ${title}\n\n---\n${snippet}`,
				},
			],
			{ temperature: 0.2, maxTokens: 3000 }
		)
		noteContent = raw?.trim() ?? ""
		if (noteContent) {
			noteContent += actionBlock + keywordBlock
		}
	}

	// Fallback: use the first ~2000 chars of the document as the note
	if (!noteContent) {
		const preview = rawText.slice(0, 2000).trim()
		const actionBlock = extractedActionItems.length > 0
			? `\n\nAction items:\n${extractedActionItems.map((a) => `- ${a}`).join("\n")}`
			: ""
		noteContent = `${preview}${preview.length < rawText.length ? "\n\n[Content truncated — full text indexed in knowledge base]" : ""}${actionBlock}`
	}

	// If no user-supplied tags, derive them from the top extracted keywords (max 8)
	const finalTags =
		tags.length > 0
			? tags
			: extractedKeywords
					.slice(0, 8)
					.map((k) => k.replace(/\s+/g, " ").trim())
					.filter((k) => k.length > 1 && k.length <= 30)

	const note: Note = {
		id: `doc-note-${crypto.randomBytes(6).toString("hex")}`,
		url: `doc://${docId}`,
		title,
		content: noteContent,
		rawHighlights: [],
		tags: finalTags,
		createdAt: now,
		updatedAt: now,
	}

	return note
}


export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
	try {
		const form = await request.formData()
		const file = form.get("file")
		const title = form.get("title")
		const tagsRaw = form.get("tags")

		if (!(file instanceof File)) {
			return errorResponse("file is required", 400)
		}

		const titleStr = typeof title === "string" ? title.trim() : ""
		const tags =
			typeof tagsRaw === "string" && tagsRaw.trim()
				? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
				: []

		const buf = Buffer.from(await file.arrayBuffer())
		const mime = file.type || "application/octet-stream"
		const name = file.name.toLowerCase()

		let kind: "pdf" | "html" | "image" | "text" = "text"
		if (mime === "application/pdf" || name.endsWith(".pdf")) kind = "pdf"
		else if (mime.startsWith("text/html") || name.endsWith(".html") || name.endsWith(".htm")) kind = "html"
		else if (mime.startsWith("image/")) kind = "image"
		else if (mime.startsWith("text/")) kind = "text"

		await ensureMongoIndexes()

		const result = await runIngestPipeline({
			userId,
			buffer: buf,
			kind,
			mimeType: mime,
			title: titleStr,
			tags,
		})

		// Rebuild the chunk index so RAG picks up the new document
		await buildChunkIndex(userId)

		// â”€â”€ Create a Note from the ingested document â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
		let noteId: string | undefined
		try {
			const note = await generateDocumentNote(
				result.document.id,
				result.document.title,
				result.document.content,
				result.document.tags,
				result.document.ingest?.keywords ?? [],
				result.document.ingest?.actionItems ?? []
			)
			if (note) {
				const notes = await readNotes(userId)
				// Avoid duplicate notes for the same document ID
				const alreadyExists = notes.some((n) => n.url === `doc://${result.document.id}`)
				if (!alreadyExists) {
					notes.push(note)
					await writeNotes(userId, notes)
					noteId = note.id
				}
			}
		} catch (noteErr) {
			// Note creation failure is non-fatal — the document is still indexed
			console.warn("Failed to create note from document (non-fatal):", noteErr)
		}

		return NextResponse.json(
			{
				data: {
					document: result.document,
					chunkCount: result.chunkCount,
					noteId,
					hint: "Document indexed into the RAG knowledge base. A note was created in your Notes section — you can chat with it directly.",
				},
			},
			{ status: 200 }
		)
	} catch (err) {
		console.error("POST /api/documents/upload", err)
		return errorResponse(err instanceof Error ? err.message : "Upload failed", 500)
	}
}
