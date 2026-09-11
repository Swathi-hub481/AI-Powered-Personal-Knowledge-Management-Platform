/**
 * POST /api/rag/index — Trigger chunk index rebuild.
 * GET  /api/rag/index — Get current index stats.
 */

import { NextResponse } from "next/server"
import { buildChunkIndex, getIndexStats } from "@/lib/chunk-store"
import { ensureMongoIndexes } from "@/lib/mongo-knowledge"
import { getSessionUserId } from "@/lib/auth"

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const stats = await getIndexStats(userId)
		return NextResponse.json({ data: stats }, { status: 200 })
	} catch (err) {
		console.error("GET /api/rag/index failed:", err)
		return errorResponse("Failed to get index stats", 500)
	}
}

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		await ensureMongoIndexes()
		const startTime = Date.now()
		const index = await buildChunkIndex(userId)
		const duration = Date.now() - startTime

		return NextResponse.json(
			{
				data: {
					totalChunks: index.totalChunks,
					avgTokenCount: Math.round(index.avgTokenCount),
					uniqueTerms: Object.keys(index.df).length,
					indexedAt: index.indexedAt,
					durationMs: duration,
				},
			},
			{ status: 200 }
		)
	} catch (err) {
		console.error("POST /api/rag/index failed:", err)
		return errorResponse("Failed to rebuild chunk index", 500)
	}
}
