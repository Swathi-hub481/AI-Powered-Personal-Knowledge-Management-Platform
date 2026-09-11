import { NextResponse } from "next/server"
import { upsertNote } from "@/lib/notes-store"
import {
	mongoReadHighlights,
	mongoWriteHighlights,
	mongoReadHighlightResetMarker,
	mongoWriteHighlightResetMarker,
	type HighlightRecord,
} from "@/lib/mongo-app-data"
import { getSessionUserId } from "@/lib/auth"

const HIGHLIGHT_TAGS = ["Education", "Research", "Biology", "Finance", "AI", "Technology"] as const

type HighlightTag = (typeof HIGHLIGHT_TAGS)[number]

const TAG_KEYWORDS: Record<HighlightTag, string[]> = {
	Education: ["education", "learn", "learning", "student", "course", "study"],
	Research: ["research", "paper", "analysis", "findings", "experiment"],
	Biology: ["biology", "gene", "cell", "organism", "crispr", "biotech"],
	Finance: ["finance", "financial", "budget", "investment", "revenue", "market"],
	AI: ["ai", "artificial intelligence", "machine learning", "ml", "neural", "model"],
	Technology: ["technology", "tech", "software", "engineering", "digital", "product"],
}

interface Highlight {
	id: string
	text: string
	url: string
	title: string
	createdAt: string
	isActive: boolean
	tags: HighlightTag[]
	content?: string
}

interface HighlightPayload {
	id?: unknown
	text?: unknown
	url?: unknown
	title?: unknown
	createdAt?: unknown
	isActive?: unknown
	tags?: unknown
	content?: unknown
}

interface HighlightActivationPayload {
	id?: unknown
	content?: unknown
}

interface HighlightsResetMarker {
	deletedBefore?: string
}

async function readHighlightsStore(userId: string): Promise<Highlight[]> {
	const rows = await mongoReadHighlights(userId)
	return rows.map((item) => {
		try {
			return parseHighlightPayload(item as unknown as HighlightPayload)
		} catch {
			return null
		}
	}).filter((item): item is Highlight => item !== null)
}

async function writeHighlightsStore(userId: string, highlights: Highlight[]) {
	await mongoWriteHighlights(userId, highlights as unknown as HighlightRecord[])
}

async function readResetMarker(userId: string): Promise<HighlightsResetMarker> {
	return mongoReadHighlightResetMarker(userId)
}

async function writeResetMarker(userId: string, marker: HighlightsResetMarker) {
	await mongoWriteHighlightResetMarker(userId, marker as { deletedBefore: string })
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0
}

function createHighlightId(text: string, url: string, title: string, createdAt: string) {
	return `${url}::${title}::${createdAt}::${text}`
}

function isHighlightTag(value: unknown): value is HighlightTag {
	return typeof value === "string" && HIGHLIGHT_TAGS.includes(value as HighlightTag)
}

function inferTagsFromContent(text: string, title: string, url: string): HighlightTag[] {
	const combined = `${title} ${text} ${url}`.toLowerCase()
	return HIGHLIGHT_TAGS.filter((tag) => TAG_KEYWORDS[tag].some((keyword) => combined.includes(keyword)))
}

function parseHighlightTags(payloadTags: unknown, text: string, title: string, url: string): HighlightTag[] {
	if (Array.isArray(payloadTags)) {
		const validTags = Array.from(new Set(payloadTags.filter(isHighlightTag)))
		if (validTags.length > 0) return validTags
	}
	return inferTagsFromContent(text, title, url)
}

function isSameHighlightCore(left: Highlight, right: Highlight) {
	return (
		left.text === right.text &&
		left.url === right.url &&
		left.title === right.title &&
		left.createdAt === right.createdAt
	)
}

function parseHighlightPayload(payload: HighlightPayload): Highlight {
	const { id, text, url, title, createdAt, isActive, tags } = payload

	if (!isNonEmptyString(text)) throw new Error("Invalid payload: 'text' must be a non-empty string")
	if (!isNonEmptyString(url)) throw new Error("Invalid payload: 'url' must be a non-empty string")
	if (!isNonEmptyString(title)) throw new Error("Invalid payload: 'title' must be a non-empty string")
	if (!isNonEmptyString(createdAt)) throw new Error("Invalid payload: 'createdAt' must be a non-empty string")

	const trimmedText = text.trim()
	const trimmedUrl = url.trim()
	const trimmedTitle = title.trim()
	const trimmedCreatedAt = createdAt.trim()
	const parsedId = isNonEmptyString(id)
		? id.trim()
		: createHighlightId(trimmedText, trimmedUrl, trimmedTitle, trimmedCreatedAt)
	const parsedIsActive = typeof isActive === "boolean" ? isActive : false
	const parsedTags = parseHighlightTags(tags, trimmedText, trimmedTitle, trimmedUrl)
	const parsedContent = typeof payload.content === "string" && payload.content.trim().length > 0
		? payload.content
		: undefined

	return {
		id: parsedId,
		text: trimmedText,
		url: trimmedUrl,
		title: trimmedTitle,
		createdAt: trimmedCreatedAt,
		isActive: parsedIsActive,
		tags: parsedTags,
		...(parsedContent !== undefined ? { content: parsedContent } : {}),
	}
}

function isHighlightStale(highlight: Highlight, resetMarker: HighlightsResetMarker) {
	if (!isNonEmptyString(resetMarker.deletedBefore)) return false
	const highlightTime = new Date(highlight.createdAt).getTime()
	const deletedBeforeTime = new Date(resetMarker.deletedBefore).getTime()
	if (Number.isNaN(highlightTime) || Number.isNaN(deletedBeforeTime)) return false
	return highlightTime <= deletedBeforeTime
}

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const highlightStore = await readHighlightsStore(userId)
		return NextResponse.json({ data: highlightStore }, { status: 200 })
	} catch (error) {
		console.error("GET /api/highlights failed", error)
		return errorResponse("Failed to fetch highlights", 500)
	}
}

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const highlightStore = await readHighlightsStore(userId)
		const resetMarker = await readResetMarker(userId)
		const payload = (await request.json()) as HighlightPayload
		const highlight = parseHighlightPayload(payload)

		if (isHighlightStale(highlight, resetMarker)) {
			return NextResponse.json(
				{ data: highlight, ignored: true, reason: "stale-after-delete" },
				{ status: 202 }
			)
		}

		const existingIndex = highlightStore.findIndex((item) => isSameHighlightCore(item, highlight))

		if (existingIndex === -1) {
			highlightStore.push(highlight)
			await writeHighlightsStore(userId, highlightStore)
		} else {
			const existingHighlight = highlightStore[existingIndex]
			const mergedTags = Array.from(new Set([...existingHighlight.tags, ...highlight.tags]))
			if (mergedTags.length !== existingHighlight.tags.length) {
				highlightStore[existingIndex] = { ...existingHighlight, tags: mergedTags }
				await writeHighlightsStore(userId, highlightStore)
			}
		}

		try {
			await upsertNote(userId, {
				url: highlight.url,
				title: highlight.title,
				text: highlight.text,
				tags: highlight.tags,
				createdAt: highlight.createdAt,
			})
		} catch (noteErr) {
			console.error("POST /api/highlights — upsertNote failed (non-fatal)", noteErr)
		}

		return NextResponse.json({ data: highlight }, { status: 201 })
	} catch (error) {
		if (error instanceof SyntaxError) return errorResponse("Invalid JSON body", 400)
		if (error instanceof Error && error.message.startsWith("Invalid payload:")) {
			return errorResponse(error.message, 400)
		}
		console.error("POST /api/highlights failed", error)
		return errorResponse("Failed to save highlight", 500)
	}
}

export async function PATCH(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const highlightStore = await readHighlightsStore(userId)
		const payload = (await request.json()) as HighlightActivationPayload

		if (!isNonEmptyString(payload.id)) {
			return errorResponse("Invalid payload: 'id' must be a non-empty string", 400)
		}

		const targetId = payload.id.trim()
		const targetIndex = highlightStore.findIndex((h) => h.id === targetId)

		if (targetIndex === -1) return errorResponse("Highlight not found", 404)

		if (typeof payload.content === "string") {
			const updatedHighlights = highlightStore.map((h, i) =>
				i === targetIndex ? { ...h, content: payload.content as string } : h
			)
			await writeHighlightsStore(userId, updatedHighlights)
			return NextResponse.json({ data: updatedHighlights[targetIndex] }, { status: 200 })
		}

		const updatedHighlights = highlightStore.map((h, i) => ({
			...h,
			isActive: i === targetIndex,
		}))
		await writeHighlightsStore(userId, updatedHighlights)
		return NextResponse.json({ data: updatedHighlights[targetIndex] }, { status: 200 })
	} catch (error) {
		if (error instanceof SyntaxError) return errorResponse("Invalid JSON body", 400)
		console.error("PATCH /api/highlights failed", error)
		return errorResponse("Failed to update highlight", 500)
	}
}

export async function DELETE(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		const highlightStore = await readHighlightsStore(userId)
		const deletedCount = highlightStore.length
		await writeHighlightsStore(userId, [])
		await writeResetMarker(userId, { deletedBefore: new Date().toISOString() })
		return NextResponse.json({ data: { deleted: true, deletedCount } }, { status: 200 })
	} catch (error) {
		console.error("DELETE /api/highlights failed", error)
		return errorResponse("Failed to delete highlights", 500)
	}
}
