/**
 * POST /api/rag — Main RAG query endpoint.
 *
 * Accepts a query and optional filters, runs the full RAG pipeline
 * (BM25 retrieve → GPT-OSS rerank → GPT-OSS generate), returns a
 * grounded, cited answer.
 */

import { NextResponse } from "next/server"
import { executeRAG, type RAGQuery } from "@/lib/rag-pipeline"
import type { ChunkSourceType } from "@/lib/chunk-store"
import { getSessionUserId } from "@/lib/auth"

interface RequestBody {
	query?: unknown
	sourceTypes?: unknown
	sourceIds?: unknown
	tags?: unknown
	chatHistory?: unknown
	retrieveK?: unknown
	rerankK?: unknown
	skipRerank?: unknown
	language?: unknown
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0
}

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

const VALID_SOURCE_TYPES = new Set<string>([
	"note",
	"highlight",
	"meeting-transcript",
	"meeting-summary",
	"document",
	"conversation",
])

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const body = (await request.json()) as RequestBody

		if (!isNonEmptyString(body.query)) {
			return errorResponse("'query' must be a non-empty string", 400)
		}

		const query = body.query.trim()

		// Parse optional filters
		const sourceTypes: ChunkSourceType[] | undefined = Array.isArray(body.sourceTypes)
			? (body.sourceTypes as unknown[])
				.filter((t): t is string => typeof t === "string" && VALID_SOURCE_TYPES.has(t))
				.map((t) => t as ChunkSourceType)
			: undefined

		const sourceIds: string[] | undefined = Array.isArray(body.sourceIds)
			? (body.sourceIds as unknown[]).filter((id): id is string => isNonEmptyString(id))
			: undefined

		const tags: string[] | undefined = Array.isArray(body.tags)
			? (body.tags as unknown[]).filter((t): t is string => isNonEmptyString(t))
			: undefined

		const chatHistory: Array<{ role: "user" | "assistant"; content: string }> | undefined =
			Array.isArray(body.chatHistory)
				? (body.chatHistory as unknown[])
					.filter((m): m is { role: "user" | "assistant"; content: string } => {
						if (!m || typeof m !== "object") return false
						const msg = m as Record<string, unknown>
						return (
							(msg.role === "user" || msg.role === "assistant") &&
							typeof msg.content === "string"
						)
					})
				: undefined

		const retrieveK = typeof body.retrieveK === "number" && body.retrieveK > 0
			? Math.min(body.retrieveK, 50)
			: undefined

		const rerankK = typeof body.rerankK === "number" && body.rerankK > 0
			? Math.min(body.rerankK, 20)
			: undefined

		const skipRerank = body.skipRerank === true

		const language = isNonEmptyString(body.language) ? body.language.trim() : "English"

		const ragQuery: RAGQuery = {
			userId,
			query,
			...(sourceTypes?.length ? { sourceTypes } : {}),
			...(sourceIds?.length ? { sourceIds } : {}),
			...(tags?.length ? { tags } : {}),
			...(chatHistory?.length ? { chatHistory } : {}),
			...(retrieveK ? { retrieveK } : {}),
			...(rerankK ? { rerankK } : {}),
			skipRerank,
			language,
		}

		const result = await executeRAG(ragQuery)

		return NextResponse.json({ data: result }, { status: 200 })
	} catch (err) {
		if (err instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400)
		}
		console.error("POST /api/rag failed:", err)
		return errorResponse("RAG pipeline failed", 500)
	}
}
