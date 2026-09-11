import { NextResponse } from "next/server"
import { recordRagFeedback } from "@/lib/mongo-knowledge"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as {
			query?: unknown
			chunkId?: unknown
			helpful?: unknown
		}

		if (typeof body.query !== "string" || !body.query.trim()) {
			return errorResponse("query is required", 400)
		}
		if (typeof body.chunkId !== "string" || !body.chunkId.trim()) {
			return errorResponse("chunkId is required", 400)
		}
		if (typeof body.helpful !== "boolean") {
			return errorResponse("helpful must be boolean", 400)
		}

		await recordRagFeedback({
			query: body.query.trim(),
			chunkId: body.chunkId.trim(),
			helpful: body.helpful,
		})

		return NextResponse.json({ ok: true }, { status: 200 })
	} catch (err) {
		console.error("POST /api/rag/feedback", err)
		return errorResponse("Failed to record feedback", 500)
	}
}
