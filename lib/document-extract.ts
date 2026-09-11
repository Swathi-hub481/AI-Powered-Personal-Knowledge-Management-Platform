/**
 * Structured extraction over documents and chunks: entities, key phrases, action items (GPT-OSS via Groq).
 * Action item extraction target: F1 >= 0.75 (aligned with Akshatha et al., 2024).
 */

import { callGroqChat } from "./groq-chat-client"

export interface ExtractionResult {
	entities: string[]
	keywords: string[]
	actionItems: string[]
}

/**
 * Full-document knowledge signal extraction.
 * Extracts entities, keywords, and action items from a document.
 */
export async function extractKnowledgeSignals(text: string, titleHint: string): Promise<ExtractionResult | null> {
	const clipped = text.slice(0, 8000)
	const raw = await callGroqChat(
		[
			{
				role: "system",
				content: `You extract structured knowledge signals from documents for a personal knowledge base.
Return ONLY valid JSON with these keys:
- "entities": array of named entities — people, organisations, tools, technologies, places, datasets, papers (short strings, max 5 words each)
- "keywords": array of 1-4 word topical phrases that best describe what this document is about (for search/retrieval)
- "actionItems": array of verb-first task strings — only include EXPLICIT commitments, instructions, or tasks stated in the document (e.g. "Review the proposal by Friday", "Implement the new login flow", "Follow up with the client"). Do NOT include generic suggestions. Each item starts with a verb.
No markdown, no prose. Return raw JSON only.`,
			},
			{
				role: "user",
				content: `Document title: ${titleHint}\n\n---\n${clipped}`,
			},
		],
		{ temperature: 0.1, maxTokens: 2048, jsonMode: true }
	)
	if (!raw) return null
	try {
		const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
		const parsed = JSON.parse(cleaned) as {
			entities?: unknown
			keywords?: unknown
			actionItems?: unknown
		}
		const toStrArr = (v: unknown): string[] =>
			Array.isArray(v)
				? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
				: []
		return {
			entities: toStrArr(parsed.entities).slice(0, 40),
			keywords: toStrArr(parsed.keywords).slice(0, 40),
			actionItems: toStrArr(parsed.actionItems).slice(0, 30),
		}
	} catch {
		return null
	}
}

/**
 * Per-chunk lightweight extraction — for long documents processed in slices.
 */
export async function extractChunkSignals(chunkText: string, contextLine: string): Promise<ExtractionResult | null> {
	const raw = await callGroqChat(
		[
			{
				role: "system",
				content:
					'Return ONLY JSON: {"entities":[],"keywords":[],"actionItems":[]} for this passage. ' +
					'Max 6 items per array. actionItems must start with a verb and be explicit tasks/commitments only.',
			},
			{ role: "user", content: `${contextLine}\n\nPASSAGE:\n${chunkText.slice(0, 4000)}` },
		],
		{ temperature: 0.05, maxTokens: 512, jsonMode: true }
	)
	if (!raw) return null
	try {
		const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
		const parsed = JSON.parse(cleaned) as {
			entities?: unknown
			keywords?: unknown
			actionItems?: unknown
		}
		const toStrArr = (v: unknown): string[] =>
			Array.isArray(v)
				? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
				: []
		return {
			entities: toStrArr(parsed.entities).slice(0, 8),
			keywords: toStrArr(parsed.keywords).slice(0, 8),
			actionItems: toStrArr(parsed.actionItems).slice(0, 6),
		}
	} catch {
		return null
	}
}

/**
 * Dedicated meeting action item extractor.
 * Higher precision than the general extractor — tuned for meeting transcripts.
 * Returns structured items with assignee and deadline.
 */
export interface MeetingActionItem {
	text: string
	assignedTo: string
	deadline: string | null
	priority: "high" | "medium" | "low"
}

export async function extractMeetingActionItems(
	transcript: string,
	speakerLabels: string[]
): Promise<MeetingActionItem[]> {
	const clipped = transcript.slice(0, 10000)
	const speakerList = speakerLabels.length > 0 ? speakerLabels.join(", ") : "Speaker 1, Speaker 2"

	const raw = await callGroqChat(
		[
			{
				role: "system",
				content: `You extract ALL action items, commitments, and follow-ups from a meeting transcript.
Return ONLY a JSON array of objects with keys:
- "text": verb-first description of the task (e.g. "Send the budget report to finance team")
- "assignedTo": the speaker label or name who will do it (e.g. "Speaker 1", "John", "the team")
- "deadline": the mentioned deadline verbatim, or null (e.g. "by end of week", "before the demo", null)
- "priority": "high" (urgent/critical/ASAP/has hard deadline), "medium" (clear task, reasonable deadline), "low" (suggestion or backlog)

RULES:
1. Include EVERY explicit commitment, task, assignment, and follow-up — even implicit ones like "I'll look into that".
2. Each text MUST start with a verb: Send, Schedule, Review, Implement, Follow up, Prepare, etc.
3. Assign to the speaker who stated the commitment or who was explicitly assigned the task.
4. Use "the team" for collective/group commitments.
5. Extract deadline from phrases like "by Friday", "before the demo", "next sprint", "end of month".
6. DO NOT merge distinct tasks. One task per object.
7. Return empty array if no action items found.
No markdown. Return raw JSON array only.`,
			},
			{
				role: "user",
				content: `Speaker labels in this meeting: ${speakerList}\n\nTRANSCRIPT:\n${clipped}`,
			},
		],
		{ temperature: 0.1, maxTokens: 1500 }
	)
	if (!raw) return []
	try {
		const jsonMatch = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
		const arr = JSON.parse(jsonMatch.startsWith("[") ? jsonMatch : (jsonMatch.match(/\[[\s\S]*\]/) ?? ["[]"])[0]) as MeetingActionItem[]
		return arr
			.filter((a) => typeof a.text === "string" && a.text.trim().length > 5)
			.map((a) => ({
				text: a.text.trim(),
				assignedTo: typeof a.assignedTo === "string" ? a.assignedTo.trim() : "Unknown",
				deadline: typeof a.deadline === "string" ? a.deadline.trim() : null,
				priority: (["high", "medium", "low"].includes(a.priority) ? a.priority : "medium") as "high" | "medium" | "low",
			}))
	} catch {
		return []
	}
}
