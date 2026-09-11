import { NextResponse } from "next/server"
import { getNotionClient } from "@/lib/notion-client"
import { patchUserPreferences } from "@/lib/user-preferences"
import { getSessionUserId } from "@/lib/auth"

export const runtime = "nodejs"

function errorResponse(message: string, status = 400) {
	return NextResponse.json({ error: message }, { status })
}

export async function POST(req: Request) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)

	let token: string | undefined
	let parentPageId: string | undefined

	try {
		const body = (await req.json()) as { token?: string; parentPageId?: string }
		token = body.token?.trim()
		parentPageId = body.parentPageId?.trim() || undefined
	} catch {
		return errorResponse("Invalid request body")
	}

	if (!token) return errorResponse("Token is required")

	try {
		const notion = getNotionClient(token)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (notion.search as any)({ page_size: 1 })
		const totalResults: number = res.results?.length ?? 0

		await patchUserPreferences(userId, {
			notionToken: token,
			...(parentPageId !== undefined ? { notionParentPageId: parentPageId } : {}),
			notionTaskDbId: undefined,
		})

		return NextResponse.json({ ok: true, accessible: totalResults })
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Verification failed"
		return errorResponse(`Notion API error: ${msg}`, 502)
	}
}

export async function DELETE(req: Request) {
	const userId = await getSessionUserId(req)
	if (!userId) return errorResponse("Not authenticated", 401)
	try {
		await patchUserPreferences(userId, {
			notionToken: null,
			notionAccessToken: null,
			notionWorkspaceName: null,
			notionWorkspaceIcon: null,
			notionParentPageId: null,
			notionTaskDbId: null,
		})
		return NextResponse.json({ ok: true })
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error"
		return NextResponse.json({ error: msg }, { status: 500 })
	}
}
