import { NextResponse } from "next/server"
import { getUserPreferences, getActiveNotionToken } from "@/lib/user-preferences"
import { getNotionClient } from "@/lib/notion-client"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

export interface NotionDbEntry {
	id: string
	title: string
	url: string
}

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

	const prefs = await getUserPreferences(userId)
	const token = getActiveNotionToken(prefs)
	if (!token) {
		return NextResponse.json({ error: "Notion is not connected" }, { status: 403 })
	}

	try {
		const notion = getNotionClient(token)

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (notion.search as any)({
			filter: { property: "object", value: "data_source" },
			page_size: 50,
		})

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const databases: NotionDbEntry[] = ((res.results ?? []) as any[])
			.filter((item: any) => item.object === "data_source")
			.map((item: any) => {
				const titleParts: string[] = ((item.title as unknown[]) ?? []).map(
					(t: unknown) => (t as { plain_text?: string }).plain_text ?? ""
				)
				return {
					id: item.id as string,
					title: titleParts.join("").trim() || "Untitled",
					url: (item.url as string) ?? `https://notion.so/${(item.id as string).replace(/-/g, "")}`,
				}
			})

		return NextResponse.json({
			databases,
			cachedDbId: prefs.notionTaskDbId ?? null,
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error"
		return NextResponse.json({ error: `Notion API error: ${msg}` }, { status: 502 })
	}
}
