/**
 * Notion helpers using @notionhq/client with a user integration token, or OAuth flows elsewhere.
 * Search uses the 2026 API: databases appear as `data_source` in results, not `database`.
 */

import { Client } from "@notionhq/client"
import type { MeetSession, ActionItem } from "@/lib/meet-types"

export interface PushNoteResult {
	url: string
	pageId: string
}

export interface PushActionsResult {
	url: string
	dbId: string
	/** true when we created a new database (false = inserted into / updated existing) */
	created: boolean
	/** number of items inserted or updated */
	upserted: number
	/** number of items that already existed and were updated */
	updated: number
}

export interface NotionTaskDatabase {
	id: string
	title: string
	url: string
}

/** Yields YYYY-MM-DD for real dates only; vague phrases never become Notion dates. */
function toNotionDate(raw: string | null | undefined): string | null {
	if (!raw?.trim()) return null

	const trimmed = raw.trim()

	const isoDateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/
	if (isoDateRe.test(trimmed)) {
		const d = new Date(trimmed)
		if (!isNaN(d.getTime())) {
			return trimmed.slice(0, 10)
		}
	}

	const parsed = new Date(trimmed)
	if (!isNaN(parsed.getTime())) {
		const year = parsed.getFullYear()
		if (year >= 2020 && year <= 2100) {
			return parsed.toISOString().slice(0, 10)
		}
	}

	return null
}

export function getNotionClient(token: string): Client {
	return new Client({ auth: token })
}

const TASK_KEYWORDS = ["task", "todo", "to-do", "kanban", "action", "project", "work", "board"]

/** Finds a task-like database via workspace search (`data_source` filter). */
export async function searchTaskDatabases(token: string): Promise<NotionTaskDatabase | null> {
	const notion = getNotionClient(token)

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let results: any[] = []
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (notion.search as any)({
			filter: { property: "object", value: "data_source" },
			page_size: 30,
		})
		results = res.results ?? []
	} catch {
		return null
	}

	let best: { db: NotionTaskDatabase; score: number } | null = null

	for (const item of results) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = item as any
		if (raw.object !== "data_source") continue
		const titleParts: string[] = ((raw.title as unknown[]) ?? []).map(
			(t: unknown) => (t as { plain_text?: string }).plain_text ?? ""
		)
		const titleText = titleParts.join("").toLowerCase()
		const score = TASK_KEYWORDS.reduce(
			(acc, kw) => acc + (titleText.includes(kw) ? 1 : 0),
			0
		)
		if (score > 0 && (!best || score > best.score)) {
			best = {
				db: { id: raw.id as string, title: titleParts.join(""), url: (raw.url as string) ?? "" },
				score,
			}
		}
	}

	return best?.db ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retrieveDataSourceSchema(notion: Client, id: string): Promise<any> {
	try {
		return await notion.dataSources.retrieve({ data_source_id: id })
	} catch {
		try {
			return await notion.databases.retrieve({ database_id: id })
		} catch {
			return null
		}
	}
}

/** Lowercase title to page id so we update rows instead of duplicating. */
async function fetchExistingPageTitles(
	notion: Client,
	dbId: string
): Promise<Map<string, string>> {
	const titleMap = new Map<string, string>()
	let cursor: string | undefined

	const queryFn = async (startCursor?: string) => {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return await (notion.dataSources as any).query({
				data_source_id: dbId,
				start_cursor: startCursor,
				page_size: 100,
				result_type: "page",
				filter_properties: ["title"],
			})
		} catch {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return await (notion.databases as any).query({
				database_id: dbId,
				start_cursor: startCursor,
				page_size: 100,
				filter_properties: ["title"],
			})
		}
	}

	try {
		let hasMore = true
		while (hasMore) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res: any = await queryFn(cursor)
			for (const page of (res.results ?? [])) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const p = page as any
				if (p.object !== "page") continue
				const titleArr = p.properties?.Name?.title ?? p.properties?.name?.title ?? []
				const titleText: string = titleArr
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					.map((t: any) => t.plain_text ?? "")
					.join("")
					.trim()
				if (titleText) titleMap.set(titleText.toLowerCase(), p.id as string)
			}
			hasMore = res.has_more ?? false
			cursor = res.next_cursor ?? undefined
		}
	} catch {
	}

	return titleMap
}

type NotionBlock = Record<string, unknown>

/** Rough markdown to Notion blocks, max 95 children per API limits. */
function markdownToNotionBlocks(md: string): NotionBlock[] {
	const lines = md.split("\n")
	const blocks: NotionBlock[] = []

	for (const rawLine of lines) {
		if (blocks.length >= 95) break
		const line = rawLine.trimEnd()
		if (!line.trim()) continue

		const h3Match = line.match(/^###\s+(.+)/)
		const h2Match = line.match(/^##\s+(.+)/)
		const h1Match = line.match(/^#\s+(.+)/)
		const bulletMatch = line.match(/^[-*]\s+(.+)/)
		const numberedMatch = line.match(/^\d+\.\s+(.+)/)

		if (h1Match ?? h2Match ?? h3Match) {
			const level = h3Match ? "heading_3" : h2Match ? "heading_2" : "heading_1"
			const text = (h3Match ?? h2Match ?? h1Match)![1]
			blocks.push({
				object: "block",
				type: level,
				[level]: { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] },
			})
		} else if (bulletMatch) {
			blocks.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [{ type: "text", text: { content: bulletMatch[1].slice(0, 2000) } }],
				},
			})
		} else if (numberedMatch) {
			blocks.push({
				object: "block",
				type: "numbered_list_item",
				numbered_list_item: {
					rich_text: [{ type: "text", text: { content: numberedMatch[1].slice(0, 2000) } }],
				},
			})
		} else {
			blocks.push({
				object: "block",
				type: "paragraph",
				paragraph: {
					rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }],
				},
			})
		}
	}

	return blocks
}

export interface NotePushPayload {
	id: string
	title: string
	content: string
	tags: string[]
	url?: string
	updatedAt?: string
}

/** Creates a page under `parentPageId` (internal tokens cannot use workspace root). */
export async function pushNoteToNotion(
	token: string,
	note: NotePushPayload,
	parentPageId?: string | null
): Promise<PushNoteResult> {
	if (!parentPageId) {
		throw new Error(
			"A parent page ID is required. Open Integrations, edit your Notion settings, and enter the 32-character ID of the page you want notes created under."
		)
	}

	const notion = getNotionClient(token)
	const parentProp = { type: "page_id" as const, page_id: parentPageId }
	const contentBlocks = markdownToNotionBlocks(note.content)

	const metaLines: string[] = []
	if (note.url) metaLines.push(`Source: ${note.url}`)
	if (note.updatedAt) metaLines.push(`Last updated: ${note.updatedAt.slice(0, 10)}`)
	if (note.tags.length > 0) metaLines.push(`Tags: ${note.tags.join(", ")}`)

	const allBlocks: NotionBlock[] = [
		...(metaLines.length > 0
			? [
					{
						object: "block",
						type: "callout",
						callout: {
							rich_text: [{ type: "text", text: { content: metaLines.join("  ·  ") } }],
							icon: { type: "emoji", emoji: "📎" },
							color: "gray_background",
						},
					},
			  ]
			: []),
		...contentBlocks,
	]

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const page = await notion.pages.create({
		parent: parentProp as Parameters<typeof notion.pages.create>[0]["parent"],
		properties: {
			title: {
				title: [{ type: "text", text: { content: note.title.slice(0, 2000) } }],
			},
		},
		children: allBlocks as Parameters<typeof notion.pages.create>[0]["children"],
	})

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const url = (page as any).url ?? `https://notion.so/${page.id.replace(/-/g, "")}`
	return { url, pageId: page.id }
}

const PRIORITY_EMOJI: Record<string, string> = {
	high: "🔴",
	medium: "🟡",
	low: "🔵",
}

function buildItemProperties(
	item: ActionItem,
	schemaProps: Record<string, { type: string; name?: string }>,
	sessionTitle: string
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
	const priorityLabel = item.priority.charAt(0).toUpperCase() + item.priority.slice(1)
	const priorityEmoji = PRIORITY_EMOJI[item.priority] ?? ""

	const nameText = `${priorityEmoji} ${item.text}`.trim().slice(0, 2000)

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const props: Record<string, any> = {
		Name: { title: [{ type: "text", text: { content: nameText } }] },
	}

	const byType: Record<string, string> = {}
	for (const [key, val] of Object.entries(schemaProps)) {
		if (!byType[val.type]) byType[val.type] = key
	}

	if (byType.status) {
		props[byType.status] = { status: { name: item.done ? "Done" : "Not started" } }
	}

	const selects = Object.entries(schemaProps)
		.filter(([, v]) => v.type === "select")
		.map(([k]) => k)

	if (selects[0] && !byType.status) {
		props[selects[0]] = { select: { name: item.done ? "Done" : "Not started" } }
	}
	if (selects[1]) {
		props[selects[1]] = {
			select: {
				name: priorityLabel,
				color: item.priority === "high" ? "red" : item.priority === "medium" ? "yellow" : "blue",
			},
		}
	}

	if (byType.checkbox) {
		props[byType.checkbox] = { checkbox: item.done }
	}

	if (byType.date) {
		const isoDate = toNotionDate(item.deadline)
		if (isoDate) {
			props[byType.date] = { date: { start: isoDate } }
		}
	}

	const richTexts = Object.entries(schemaProps)
		.filter(([, v]) => v.type === "rich_text")
		.map(([k]) => k)

	if (richTexts[0] && item.assignedTo && item.assignedTo !== "unknown") {
		props[richTexts[0]] = { rich_text: [{ type: "text", text: { content: item.assignedTo } }] }
	}
	const meetingKey = Object.keys(schemaProps).find(
		(k) => k.toLowerCase() === "meeting" || k.toLowerCase() === "source"
	)
	if (meetingKey) {
		props[meetingKey] = { rich_text: [{ type: "text", text: { content: sessionTitle } }] }
	} else if (richTexts[1]) {
		props[richTexts[1]] = { rich_text: [{ type: "text", text: { content: sessionTitle } }] }
	}

	return props
}

async function upsertActionsIntoDb(
	notion: Client,
	dbId: string,
	session: MeetSession,
	items: ActionItem[]
): Promise<{ inserted: number; updated: number }> {
	const schema = await retrieveDataSourceSchema(notion, dbId)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const props: Record<string, { type: string }> = (schema as any)?.properties ?? {}

	const existingTitles = await fetchExistingPageTitles(notion, dbId)

	let inserted = 0
	let updated = 0

	for (const item of items) {
		const nameText = `${PRIORITY_EMOJI[item.priority] ?? ""} ${item.text}`.trim()
		const existingId = existingTitles.get(item.text.toLowerCase())
		const properties = buildItemProperties(item, props, session.title)

		if (existingId) {
			await notion.pages.update({
				page_id: existingId,
				properties,
			})
			updated++
		} else {
			await notion.pages.create({
				parent: { database_id: dbId },
				properties,
				children: [
					{
						object: "block",
						type: "to_do",
						to_do: {
							rich_text: [{ type: "text", text: { content: nameText.slice(0, 2000) } }],
							checked: item.done,
							color: item.priority === "high" ? "red_background" : "default",
						},
					},
					...(item.assignedTo && item.assignedTo !== "unknown"
						? [
								{
									object: "block",
									type: "paragraph",
									paragraph: {
										rich_text: [
											{ type: "text", text: { content: "Assigned to: " }, annotations: { bold: true } },
											{ type: "text", text: { content: item.assignedTo } },
										],
									},
								},
						  ]
						: []),
					{
						object: "block",
						type: "callout",
						callout: {
							rich_text: [{ type: "text", text: { content: `From meeting: ${session.title}` } }],
							icon: { type: "emoji", emoji: "🗒️" },
							color: "gray_background",
						},
					},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				] as any,
			})
			inserted++
		}
	}

	return { inserted, updated }
}

/** New task database under a page (or workspace for OAuth), not inline on a page body. */
async function createActionsDatabase(
	notion: Client,
	parentPageId: string | null,
	sessionTitle: string
): Promise<string> {
	const parent = parentPageId
		? ({ type: "page_id", page_id: parentPageId } as const)
		: ({ workspace: true } as unknown as Parameters<typeof notion.databases.create>[0]["parent"])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const db = await notion.databases.create({
		parent,
		is_inline: false,
		title: [{ type: "text", text: { content: `📋 ${sessionTitle} — Action Items` } }],
		icon: { type: "emoji", emoji: "📋" },
		description: [{ type: "text", text: { content: `Action items extracted from the meeting: ${sessionTitle}` } }],
		properties: {
			Name: { title: {} },
			Status: {
				status: {
					options: [
						{ name: "Not started", color: "red" },
						{ name: "In progress", color: "yellow" },
						{ name: "Done", color: "green" },
					],
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				} as any,
			},
			Priority: {
				select: {
					options: [
						{ name: "High", color: "red" },
						{ name: "Medium", color: "yellow" },
						{ name: "Low", color: "blue" },
					],
				},
			},
			Done: { checkbox: {} },
			Due: { date: {} },
			"Assigned to": { rich_text: {} },
			"Meeting": { rich_text: {} },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any,
	} as Parameters<typeof notion.databases.create>[0])

	return db.id
}

/**
 * Push meeting tasks: use `existingDbId` if set; else find a task DB; else create one.
 * OAuth can create at workspace root; internal integrations need `parentPageId`.
 */
export async function pushActionsToNotion(
	token: string,
	session: MeetSession,
	items: ActionItem[],
	existingDbId?: string | null,
	parentPageId?: string | null,
	isOAuthToken = false
): Promise<PushActionsResult> {
	const notion = getNotionClient(token)

	if (items.length === 0) {
		throw new Error("No action items to push")
	}

	if (existingDbId) {
		const { inserted, updated } = await upsertActionsIntoDb(notion, existingDbId, session, items)
		const schema = await retrieveDataSourceSchema(notion, existingDbId)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const url = (schema as any)?.url ?? `https://notion.so/${existingDbId.replace(/-/g, "")}`
		return { url, dbId: existingDbId, created: false, upserted: inserted + updated, updated }
	}

	const found = await searchTaskDatabases(token)
	if (found) {
		try {
			const { inserted, updated } = await upsertActionsIntoDb(notion, found.id, session, items)
			return { url: found.url, dbId: found.id, created: false, upserted: inserted + updated, updated }
		} catch (err) {
			const msg = err instanceof Error ? err.message : ""
			const isStale = msg.includes("object_not_found") || msg.includes("Could not find")
			if (!isStale) throw err
		}
	}

	if (!parentPageId && !isOAuthToken) {
		throw new Error(
			"No task database found in your Notion workspace and no default page is configured. " +
			"Go to Integrations → Notion and choose a default page for your action items."
		)
	}

	const newDbId = await createActionsDatabase(notion, parentPageId ?? null, session.title)

	const schema = await retrieveDataSourceSchema(notion, newDbId)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const props: Record<string, { type: string }> = (schema as any)?.properties ?? {}

	let inserted = 0
	for (const item of items) {
		const nameText = `${PRIORITY_EMOJI[item.priority] ?? ""} ${item.text}`.trim()
		await notion.pages.create({
			parent: { database_id: newDbId },
			properties: buildItemProperties(item, props, session.title),
			children: [
				{
					object: "block",
					type: "to_do",
					to_do: {
						rich_text: [{ type: "text", text: { content: nameText.slice(0, 2000) } }],
						checked: item.done,
						color: item.priority === "high" ? "red_background" : "default",
					},
				},
				...(item.assignedTo && item.assignedTo !== "unknown"
					? [
							{
								object: "block",
								type: "paragraph",
								paragraph: {
									rich_text: [
										{ type: "text", text: { content: "Assigned to: " }, annotations: { bold: true } },
										{ type: "text", text: { content: item.assignedTo } },
									],
								},
							},
					  ]
					: []),
				{
					object: "block",
					type: "callout",
					callout: {
						rich_text: [{ type: "text", text: { content: `From meeting: ${session.title}` } }],
						icon: { type: "emoji", emoji: "🗒️" },
						color: "gray_background",
					},
				},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			] as any,
		})
		inserted++
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const dbSchema = await retrieveDataSourceSchema(notion, newDbId)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const url = (dbSchema as any)?.url ?? `https://notion.so/${newDbId.replace(/-/g, "")}`
	return { url, dbId: newDbId, created: true, upserted: inserted, updated: 0 }
}
