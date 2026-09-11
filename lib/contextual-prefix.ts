/**
 * Semantic Contextualisation Layer (SCL) — Anthropic-style Contextual Retrieval.
 *
 * Each chunk is prepended with a provenance-rich context line before embedding/BM25 indexing.
 * This reduces retrieval failure rate by 49–67% (Anthropic 2024).
 *
 * SCL format: [Type: X | Source: "Y" | Topic: Z | Tags: A,B | Context: summary sentence]
 * This encodes semantic content AND provenance simultaneously for scoped retrieval.
 */

import { callGroqChat } from "./groq-chat-client"

export async function generateContextualPrefix(
	sourceType: string,
	title: string,
	passageSnippet: string,
	tags?: string[]
): Promise<string | null> {
	const tagLine = tags?.length ? tags.join(", ") : "General"
	const raw = await callGroqChat(
		[
			{
				role: "system",
				content:
					"You write ONE compact retrieval context line (max 240 chars) for a text passage. " +
					"The line must encode: (1) the main concept or claim in the passage, (2) the source type and title, and (3) any key entities (people, tools, dates, metrics). " +
					"Format: start with the core topic, then add provenance. No quotes around the whole line, no markdown.",
			},
			{
				role: "user",
				content: [
					`Type: ${sourceType}`,
					`Title: ${title}`,
					`Tags: ${tagLine}`,
					`Passage:\n${passageSnippet.slice(0, 1200)}`,
				].join("\n"),
			},
		],
		{ temperature: 0.15, maxTokens: 220 }
	)
	if (!raw) return null
	const line = raw.replace(/\s+/g, " ").trim()
	return line.length > 0 ? line.slice(0, 300) : null
}

/**
 * Batch contextual prefix generation — one GPT-OSS call for up to 8 chunks.
 * Reduces API call overhead during ingestion (Anthropic 2024 recommends batching).
 */
export async function generateContextualPrefixesBatch(
	items: Array<{ id: string; sourceType: string; title: string; snippet: string; tags?: string[] }>
): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	if (items.length === 0) return out

	const blocks = items
		.map(
			(it, i) =>
				`[${i + 1}] id=${it.id}\n` +
				`Type: ${it.sourceType} | Title: ${it.title} | Tags: ${(it.tags ?? []).join(",") || "General"}\n` +
				`Passage: ${it.snippet.slice(0, 600)}`
		)
		.join("\n---\n")

	const raw = await callGroqChat(
		[
			{
				role: "system",
				content:
					"For each numbered block, write ONE compact retrieval context line (max 240 chars) that encodes: " +
					"(1) the main concept/claim, (2) source type and title, (3) key entities. " +
					'Return a JSON array of objects only: [{"id": "...", "line": "..."}]. No markdown, no extra text.',
			},
			{ role: "user", content: blocks },
		],
		{ temperature: 0.1, maxTokens: 2048, jsonMode: true }
	)
	if (!raw) return out
	try {
		const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
		const arr = JSON.parse(cleaned) as Array<{ id?: string; line?: string }>
		for (const row of arr) {
			if (typeof row.id === "string" && typeof row.line === "string" && row.line.trim()) {
				out.set(row.id, row.line.trim().slice(0, 300))
			}
		}
	} catch {
		// ignore parse errors; caller uses fallback
	}
	return out
}

/**
 * Build a fallback SCL line without an LLM call.
 * Used when GROQ_API_KEY is missing or the call fails.
 * Format matches the Semantic Contextualisation Layer (SCL) described in the literature.
 */
export function buildFallbackSCL(params: {
	sourceType: string
	title: string
	tags: string[]
	docType?: string
}): string {
	const tagPart = params.tags.length > 0 ? ` | Tags: ${params.tags.join(", ")}` : ""
	const typePart = params.docType ? ` | DocType: ${params.docType}` : ""
	return `[Type: ${params.sourceType} | Source: "${params.title}"${typePart}${tagPart}]`
}
