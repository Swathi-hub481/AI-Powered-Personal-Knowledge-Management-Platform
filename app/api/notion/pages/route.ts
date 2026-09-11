import { NextResponse } from "next/server"
import { Client } from "@notionhq/client"
import { getUserPreferences, getActiveNotionToken } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

// â”€â”€ Shared helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function notionClient(token: string) {
	return new Client({ auth: token })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTitle(properties: Record<string, any> | undefined): string {
	for (const prop of Object.values(properties ?? {})) {
		if (prop.type === "title" && Array.isArray(prop.title) && prop.title.length > 0) {
			const text = prop.title.map((t: { plain_text?: string }) => t.plain_text ?? "").join("").trim()
			if (text) return text
		}
	}
	return "Untitled"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractIcon(icon: any): string | null {
	if (!icon) return null
	if (icon.type === "emoji") return icon.emoji ?? null
	if (icon.type === "external") return icon.external?.url ?? null
	if (icon.type === "file") return icon.file?.url ?? null
	return null
}

function normalizeId(id: string) {
	return id.replace(/-/g, "")
}

// â”€â”€ GET /api/notion/pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// No params  â†’ workspace-root pages (parent.type === "workspace").
// ?parentId  â†’ child pages of that page, loaded via blocks.children.list.
//
// Each page shape: { id, title, icon, parentId, hasChildren }

export async function GET(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
	const prefs = await getUserPreferences(userId)
	const token = getActiveNotionToken(prefs)
	if (!token) return NextResponse.json({ error: "Not connected to Notion" }, { status: 401 })

	const { searchParams } = new URL(request.url)
	const parentId = searchParams.get("parentId")?.trim()

	const notion = notionClient(token)

	try {
		if (parentId) {
			// â”€â”€ Children of a specific page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
			// blocks.children.list returns all block objects including child_page blocks.
			// child_page blocks carry: id (= page id), child_page.title, has_children.
			const blocksRes = await notion.blocks.children.list({
				block_id: parentId,
				page_size: 100,
			})

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const pages = (blocksRes.results as any[])
				.filter((b) => b.type === "child_page")
				.map((b) => ({
					id: normalizeId(b.id as string),
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					title: (b.child_page as any)?.title || "Untitled",
					icon: null as string | null, // not available from blocks API
					parentId: normalizeId(parentId),
					hasChildren: !!(b.has_children as boolean),
				}))

			// Fetch icons for child pages in a batched way (parallel, max 10)
			const withIcons = await Promise.all(
				pages.map(async (p) => {
					try {
						const page = await notion.pages.retrieve({ page_id: p.id })
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						return { ...p, icon: extractIcon((page as any).icon) }
					} catch {
						return p
					}
				})
			)

			return NextResponse.json({ pages: withIcons })
		} else {
			// â”€â”€ Workspace-root pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
			// Search returns up to 100 most-recently-edited pages; filter to workspace root.
			const searchRes = await notion.search({
				filter: { value: "page", property: "object" },
				sort: { direction: "descending", timestamp: "last_edited_time" },
				page_size: 100,
			})

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const pages = (searchRes.results as any[])
				.filter((item) => item.object === "page" && item.parent?.type === "workspace")
				.map((item) => ({
					id: normalizeId(item.id as string),
					title: extractTitle(item.properties),
					icon: extractIcon(item.icon),
					parentId: null as string | null,
					hasChildren: !!(item.has_children as boolean),
				}))

			return NextResponse.json({ pages })
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return NextResponse.json({ error: message }, { status: 500 })
	}
}

// â”€â”€ POST /api/notion/pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Body: { title: string, parentId?: string | null }
// Creates a new Notion page and returns { page: { id, title, icon, parentId, hasChildren } }

export async function POST(request: Request) {
	const userId = await getSessionUserId(request)
	if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
	const prefs = await getUserPreferences(userId)
	const token = getActiveNotionToken(prefs)
	if (!token) return NextResponse.json({ error: "Not connected to Notion" }, { status: 401 })

	let title: string
	let parentId: string | null
	try {
		const body = (await request.json()) as { title?: string; parentId?: string | null }
		title = body.title?.trim() ?? ""
		parentId = body.parentId?.trim() || null
		if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 })
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
	}

	const notion = notionClient(token)

	try {
		const parent = parentId
			? ({ type: "page_id" as const, page_id: parentId })
			: ({ workspace: true } as unknown as Parameters<typeof notion.pages.create>[0]["parent"])

		const page = await notion.pages.create({
			parent,
			icon: { type: "emoji", emoji: "ðŸ“„" },
			properties: {
				title: { title: [{ type: "text", text: { content: title } }] },
			},
		})

		return NextResponse.json({
			page: {
				id: normalizeId(page.id),
				title,
				icon: "ðŸ“„",
				parentId: parentId ? normalizeId(parentId) : null,
				hasChildren: false,
			},
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error"
		return NextResponse.json({ error: message }, { status: 500 })
	}
}
