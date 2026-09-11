import crypto from "node:crypto"
import { NextResponse } from "next/server"
import type {
	MeetSession,
	TranscriptUtterance,
	MeetParticipant,
	ActionItem,
} from "@/lib/meet-types"
import { transcribeWithDeepgram, getMimeTypeForMeet } from "@/lib/meet-transcribe"
import { mongoReadMeets, mongoUpsertMeet } from "@/lib/mongo-app-data"
import { getSessionUserId } from "@/lib/auth"
import { buildChunkIndex } from "@/lib/chunk-store"

export type { MeetSession, TranscriptUtterance, MeetParticipant, ActionItem } from "@/lib/meet-types"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

// â”€â”€ GET /api/meets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const meets = await mongoReadMeets(userId)
		const sorted = meets.sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		)
		return NextResponse.json({ data: sorted }, { status: 200 })
	} catch (err) {
		console.error("GET /api/meets failed", err)
		return errorResponse("Failed to load sessions", 500)
	}
}

// â”€â”€ POST /api/meets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const formData = await request.formData()

		const file = formData.get("audio")
		const title = formData.get("title")
		const userName = formData.get("userName")
		const sessionType = formData.get("sessionType")

		if (!(file instanceof File)) return errorResponse("'audio' file is required", 400)
		if (typeof title !== "string" || !title.trim()) return errorResponse("'title' is required", 400)
		if (typeof userName !== "string") return errorResponse("'userName' is required", 400)

		const type: MeetSession["type"] = sessionType === "recording" ? "recording" : "upload"

		const MAX_SIZE = 150 * 1024 * 1024
		if (file.size > MAX_SIZE) return errorResponse("File exceeds the 150 MB size limit", 400)

		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const mimeType = getMimeTypeForMeet(file.name, file.type)

		let utterances: TranscriptUtterance[] = []
		let duration = 0
		let deepgramSummary: string | null = null
		let sessionStatus: MeetSession["status"] = "ready"
		let sessionError: string | null = null

		try {
			const result = await transcribeWithDeepgram(buffer, mimeType)
			utterances = result.utterances
			duration = result.duration
			deepgramSummary = result.summary
		} catch (transcribeErr) {
			console.error("Deepgram transcription failed", transcribeErr)
			sessionStatus = "error"
			sessionError =
				transcribeErr instanceof Error
					? transcribeErr.message
					: "Transcription failed. Please check your Deepgram API key and try again."
		}

		const now = new Date().toISOString()
		const newSession: MeetSession = {
			id: crypto.randomUUID(),
			title: title.trim(),
			userName: userName.trim(),
			type,
			status: sessionStatus,
			fileName: file.name,
			fileSize: file.size,
			createdAt: now,
			updatedAt: now,
			duration,
			transcript: utterances,
			deepgramSummary,
			summary: null,
			sessionType: null,
			participants: null,
			userSpeaker: null,
			userNote: null,
			actionItems: null,
			summaryGeneratedAt: null,
			error: sessionError,
			source: "upload",
		}

		await mongoUpsertMeet(userId, newSession)
		// Index the raw transcript in background so it's searchable in Converse
		// before the user even triggers AI summarisation.
		void buildChunkIndex(userId)
		return NextResponse.json({ data: newSession }, { status: 201 })
	} catch (err) {
		if (err instanceof SyntaxError) return errorResponse("Invalid request body", 400)
		console.error("POST /api/meets failed", err)
		return errorResponse("Failed to process session", 500)
	}
}
