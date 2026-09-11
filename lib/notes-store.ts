import { callGroqChat } from "./groq-chat-client"
import { mongoReadNotes, mongoWriteNotes } from "./mongo-app-data"


export interface FlowNode {
	headingText: string  // heading text without the ## prefix
	label: string        // â‰¤3-word label for the flowchart node
}

export interface Note {
	id: string
	url: string
	title: string
	content: string
	rawHighlights: string[]
	tags: string[]
	createdAt: string
	updatedAt: string
	flowNodes?: FlowNode[]
}


function normalizeUrl(url: string): string {
	try {
		const u = new URL(url)
		return `${u.hostname}${u.pathname}`.replace(/\/+$/, "").toLowerCase()
	} catch {
		return url.trim().replace(/\/+$/, "").toLowerCase()
	}
}

function makeId(url: string): string {
	return normalizeUrl(url)
		.replace(/[^a-z0-9]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80)
}

export async function readNotes(userId: string): Promise<Note[]> {
	return mongoReadNotes(userId)
}

export async function writeNotes(userId: string, notes: Note[]): Promise<void> {
	await mongoWriteNotes(userId, notes)
}


export async function organizeNoteContent(
	content: string,
	title: string,
	url: string
): Promise<{ content: string; flowNodes: FlowNode[] } | null> {
	const systemMessage =
		"You are a note organizer. Respond with a valid JSON object only — no markdown fences, no extra text. " +
		"The JSON must have exactly two keys: \"content\" (string: the reorganized note) and \"flowNodes\" " +
		"(array of {headingText, label} objects). " +
		"In \"content\": reorder paragraphs for logical reading order, never change any words, add ## headings only at major section boundaries. " +
		"In \"flowNodes\": for every ## heading that appears in the content, provide one entry where headingText is the exact heading text (without ##) and label is 1–3 words capturing that section's essence."

	const userMessage = `These notes were saved from a web page in arbitrary capture order, not logical reading order. Reorganize the paragraphs so a first-time reader can follow the content naturally.

Follow these steps:

1. Read every paragraph. Do not write output yet.

2. Determine the content type:
   - STORY/NARRATIVE (manga, novel, TV show, film, game, etc.)
   - EDUCATIONAL/SCIENTIFIC
   - HISTORICAL/BIOGRAPHICAL

3. Classify each paragraph's role — examples:
   OVERVIEW    — what this work/subject is, its premise or definition
   STORY-START — the earliest narrative events, how the story begins
   STORY-MID   — events that develop as the story progresses
   STORY-LATE  — later events, climaxes, twists, resolutions
   CHARACTER   — a character's identity, role, or motivations
   ADAPTATION  — TV series, films, games, or sequels based on the source
   PUBLICATION — release dates, licensing, sales figures, availability
   CONCEPT     — a foundational educational/scientific idea
   DETAIL      — a specific fact that extends a concept

4. Apply the correct reading order for the content type:

   STORY/NARRATIVE order:
     1. OVERVIEW — what the work is, its creators, genre, premise
     2. STORY-START — the opening of the story
     3. STORY-MID — how the plot develops
     4. STORY-LATE — later plot events
     5. CHARACTER descriptions
     6. ADAPTATION info (TV, film, game versions)
     7. PUBLICATION / licensing / metadata (always last)

   EDUCATIONAL/SCIENTIFIC order:
     1. OVERVIEW — what the subject is
     2. CONCEPT — foundational ideas, from broad to specific
     3. DETAIL — specific facts grouped by related concept

   HISTORICAL/BIOGRAPHICAL order:
     1. OVERVIEW — who or what this is
     2. Events in true chronological order
     3. Legacy, impact, later developments

Do NOT alter any words or sentences — reorder only.
Add a ## heading only at the boundary between genuinely distinct major sections (e.g., ## Plot Summary, ## Adaptations, ## Publication History). Do not add a heading for every paragraph.
Preserve all original paragraph spacing.

Source: "${title}" (${url})

--- NOTES TO REORGANIZE ---
${content.trim()}

Return your answer as a JSON object with this exact shape (no markdown fences around it):
{
  "content": "<the fully reorganized note text with ## headings>",
  "flowNodes": [
    { "headingText": "<heading text without ## prefix>", "label": "<1-3 words>" }
  ]
}
For flowNodes: one entry per ## heading in content. The label must be 1–3 words — concise and specific to that section's topic.`

	const raw =
		(await callGroqChat(
			[
				{ role: "system", content: systemMessage },
				{ role: "user", content: userMessage },
			],
			{ temperature: 0.1, maxTokens: 3000, jsonMode: true }
		)) ?? ""
	if (!raw) return null

	try {
		// Strip accidental markdown fences if the model wraps its JSON anyway
		const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
		const parsed = JSON.parse(cleaned) as { content?: unknown; flowNodes?: unknown }
		const organizedContent = typeof parsed.content === "string" ? parsed.content.trim() : ""
		if (!organizedContent) return null
		const flowNodes: FlowNode[] = []
		if (Array.isArray(parsed.flowNodes)) {
			for (const item of parsed.flowNodes as unknown[]) {
				if (
					typeof item === "object" && item !== null &&
					"headingText" in item && "label" in item &&
					typeof (item as Record<string, unknown>).headingText === "string" &&
					typeof (item as Record<string, unknown>).label === "string"
				) {
					flowNodes.push({
						headingText: ((item as Record<string, unknown>).headingText as string).trim(),
						label: ((item as Record<string, unknown>).label as string).trim(),
					})
				}
			}
		}
		return { content: organizedContent, flowNodes }
	} catch {
		return null
	}
}

function simpleMerge(existingContent: string, newHighlight: string): string {
	return `${existingContent.trimEnd()}\n\n${newHighlight.trim()}`
}


export async function upsertNote(
	userId: string,
	params: {
		url: string
		title: string
		text: string
		tags: string[]
		createdAt: string
	}
): Promise<Note> {
	const notes = await readNotes(userId)
	const normKey = normalizeUrl(params.url)
	const existingIndex = notes.findIndex((n) => normalizeUrl(n.url) === normKey)

	// â”€â”€ Brand-new note â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
	if (existingIndex === -1) {
		const note: Note = {
			id: makeId(params.url),
			url: params.url,
			title: params.title,
			content: params.text.trim(),
			rawHighlights: [params.text.trim()],
			tags: params.tags,
			createdAt: params.createdAt,
			updatedAt: params.createdAt,
		}
		notes.push(note)
		await writeNotes(userId, notes)
		return note
	}

	const existing = notes[existingIndex]
	if (existing.rawHighlights.includes(params.text.trim())) {
		return existing
	}

	const newContent = simpleMerge(existing.content, params.text)

	const updated: Note = {
		...existing,
		content: newContent,
		rawHighlights: [...existing.rawHighlights, params.text.trim()],
		tags: Array.from(new Set([...existing.tags, ...params.tags])),
		updatedAt: params.createdAt,
	}

	notes[existingIndex] = updated
	await writeNotes(userId, notes)
	return updated
}

/** Append highlight lines to an existing note by id (e.g. browser extension send-to-note). */
export async function appendHighlightsToNote(
	userId: string,
	noteId: string,
	highlightTexts: string[]
): Promise<Note | null> {
	const trimmedId = noteId.trim()
	if (!trimmedId) return null
	const parts = highlightTexts.map((t) => t.trim()).filter(Boolean)
	if (parts.length === 0) return null

	const notes = await readNotes(userId)
	const idx = notes.findIndex((n) => n.id === trimmedId)
	if (idx === -1) return null

	const existing = notes[idx]
	let content = existing.content.trimEnd()
	const rawHighlights = [...existing.rawHighlights]
	for (const text of parts) {
		if (rawHighlights.includes(text)) continue
		rawHighlights.push(text)
		content = simpleMerge(content, text)
	}
	const updated: Note = {
		...existing,
		content,
		rawHighlights,
		updatedAt: new Date().toISOString(),
	}
	notes[idx] = updated
	await writeNotes(userId, notes)
	return updated
}
