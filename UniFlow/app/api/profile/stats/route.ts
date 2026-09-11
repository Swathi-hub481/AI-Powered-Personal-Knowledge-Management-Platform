import { NextResponse } from "next/server"
import { COLLECTIONS, getMongoDb } from "@/lib/mongodb"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

	try {
		const db = await getMongoDb()

		const [notesCount, meetsCount, highlightsCount, meetDocs] = await Promise.all([
			db.collection(COLLECTIONS.notes).countDocuments({ userId }),
			db.collection(COLLECTIONS.meetSessions).countDocuments({ userId }),
			db.collection(COLLECTIONS.highlights).countDocuments({ userId, isActive: { $ne: false } }),
			db
				.collection(COLLECTIONS.meetSessions)
				.find({ userId }, { projection: { actionItems: 1, summaryGeneratedAt: 1 } })
				.toArray(),
		])

		const actionItemsCount = meetDocs.reduce((sum, doc) => {
			return sum + (Array.isArray(doc.actionItems) ? doc.actionItems.length : 0)
		}, 0)

		const summarizedMeets = meetDocs.filter((d) => !!d.summaryGeneratedAt).length

		return NextResponse.json({
			notes: notesCount,
			meets: meetsCount,
			highlights: highlightsCount,
			actionItems: actionItemsCount,
			summarizedMeets,
		})
	} catch (err) {
		console.error("GET /api/profile/stats", err)
		return NextResponse.json(
			{ notes: 0, meets: 0, highlights: 0, actionItems: 0, summarizedMeets: 0 },
			{ status: 200 }
		)
	}
}
