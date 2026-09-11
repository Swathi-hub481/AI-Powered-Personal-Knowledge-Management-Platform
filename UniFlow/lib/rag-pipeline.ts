/**
 * RAG: rewrite query, hybrid BM25 plus vectors plus rerank, then grounded answer with citations.
 * Uses GPT-OSS (Groq) end to end.
 */

import {
	type ChunkIndex,
	type ChunkSourceType,
	type ScoredChunk,
	loadOrBuildIndex,
} from "./chunk-store"
import { callGroqChat, type GroqChatMessage } from "./groq-chat-client"
import { hybridRetrieveForRag } from "./mongo-knowledge"
import { mongoFetchRecentNotes, mongoFetchMeetHeaders, mongoFetchRecentMeets } from "./mongo-app-data"

export interface RAGQuery {
	userId: string
	query: string
	sourceTypes?: ChunkSourceType[]
	sourceIds?: string[]
	tags?: string[]
	chatHistory?: Array<{ role: "user" | "assistant"; content: string }>
	retrieveK?: number
	rerankK?: number
	systemPromptOverride?: string
	skipRerank?: boolean
	/** Skip query rewriting (faster for simple factual lookups) */
	skipRewrite?: boolean
	language?: string
}

export interface RAGSourceCitation {
	sourceType: ChunkSourceType
	sourceId: string
	chunkId: string
	title: string
	url?: string
	relevanceScore: number
}

export interface RAGResponse {
	answer: string
	citations: RAGSourceCitation[]
	retrievedChunks: number
	rerankedChunks: number
	rewrittenQuery?: string
	pipeline: "rag" | "rag-no-rerank" | "fallback"
}

/* "Latest note" style questions need Mongo ordering, not vector similarity. */
const RECENCY_INTENT_RE =
	/\b(latest|most recent|newest|last (?:added|uploaded|created|indexed)|recently (?:added|uploaded|created|indexed)|just (?:added|uploaded))\b/i

const MEET_SUBJECT_RE =
	/\b(meet(?:ing)?|session|recording|transcript|call)\b/i

const NOTE_SUBJECT_RE =
	/\b(note|document|doc|upload|paper|file|article)\b/i

function detectRecencyIntent(query: string): boolean {
	return RECENCY_INTENT_RE.test(query)
}

/**
 * Returns a set of lowercase keywords from title + tags long enough to be meaningful.
 */
function itemKeywords(title: string, tags: string[]): string[] {
	const words = `${title} ${tags.join(" ")}`.toLowerCase().split(/\W+/)
	return [...new Set(words.filter((w) => w.length >= 4))]
}

async function executeRecencyMeetQuery(userId: string, query: string): Promise<RAGResponse | null> {
	let recentMeets: Awaited<ReturnType<typeof mongoFetchRecentMeets>>
	try {
		recentMeets = await mongoFetchRecentMeets(userId, 3)
	} catch {
		return null
	}

	if (recentMeets.length === 0) {
		return {
			answer:
				"You don't have any recorded meeting sessions yet. " +
				"Record a meeting via the Meet section to get started.",
			citations: [],
			retrievedChunks: 0,
			rerankedChunks: 0,
			pipeline: "fallback",
		}
	}

	const latest = recentMeets[0]
	const latestDate = (latest.createdAt ?? "").slice(0, 10)

	// Build a context block from the latest meet's structured fields
	const meetContext = [
		`**Title:** ${latest.title}`,
		`**Date:** ${latestDate}`,
		latest.executiveSummary ? `\n**Executive Summary:**\n${latest.executiveSummary}` : null,
		latest.summary ? `\n**Full Summary:**\n${latest.summary.slice(0, 3000)}` : null,
		latest.decisionsReached?.length
			? `\n**Decisions Reached:**\n${latest.decisionsReached.map((d) => `- ${d}`).join("\n")}`
			: null,
		latest.actionItems?.length
			? `\n**Action Items:**\n${latest.actionItems.map((a) => `- [${a.assignedTo ?? "?"}] ${a.text}${a.deadline ? ` (by ${a.deadline})` : ""}`).join("\n")}`
			: null,
	]
		.filter(Boolean)
		.join("\n")

	const otherRecentLines =
		recentMeets.length > 1
			? "\n\n**Other recent sessions:**\n" +
			  recentMeets
					.slice(1)
					.map((m) => `- "${m.title}" (${(m.createdAt ?? "").slice(0, 10)})`)
					.join("\n")
			: ""

	// Check if user also wants related notes
	const wantsNotes = NOTE_SUBJECT_RE.test(query)
	let noteSection = ""
	if (wantsNotes) {
		try {
			const allNotes = await mongoFetchRecentNotes(userId, 20)
			const kws = itemKeywords(latest.title, [])
			const relatedNotes = allNotes.filter((n) => {
				const hay = `${n.title} ${n.tags?.join(" ") ?? ""}`.toLowerCase()
				return kws.some((kw) => hay.includes(kw))
			})
			noteSection =
				relatedNotes.length === 0
					? "\n\n**Related notes/documents:** None found covering the same topic."
					: "\n\n**Related notes/documents found:**\n" +
					  relatedNotes
							.slice(0, 5)
							.map((n) => `- "${n.title}" (${(n.updatedAt ?? n.createdAt ?? "").slice(0, 10)})`)
							.join("\n")
		} catch {
			noteSection = "\n\n*(Could not check for related notes — database error.)*"
		}
	}

	const systemPrompt =
		`You are a knowledgeable assistant for a personal knowledge management platform.\n` +
		`The user asked about their most recent meeting/session. ` +
		`Below is the actual latest meeting fetched directly by date (NOT by similarity — this is definitively the newest).\n\n` +
		`LATEST MEETING:\n${"─".repeat(50)}\n${meetContext}\n${"─".repeat(50)}` +
		otherRecentLines +
		noteSection +
		`\n\nINSTRUCTIONS:\n` +
		`1. Summarise this meeting clearly: purpose, key topics, decisions, and action items.\n` +
		`2. Be specific — use the structured data above, do NOT invent content.\n` +
		(wantsNotes ? `3. After the summary, explicitly state whether any related notes were found (the information is above).\n` : "") +
		`4. Use markdown: ## headings, bullet lists, **bold** for key terms.\n` +
		`5. Keep the response concise but complete.`

	const answer = await callGroqChat(
		[
			{ role: "system", content: systemPrompt },
			{ role: "user", content: query },
		],
		{ temperature: 0.15, maxTokens: 2048 }
	)

	return {
		answer: answer ?? "Could not generate a summary for your latest meeting.",
		citations: [
			{
				sourceType: "meet" as ChunkSourceType,
				sourceId: latest.id,
				chunkId: latest.id,
				title: latest.title,
				relevanceScore: 1.0,
			},
		],
		retrievedChunks: recentMeets.length,
		rerankedChunks: 1,
		pipeline: "rag",
	}
}

async function executeRecencyNoteQuery(userId: string, query: string): Promise<RAGResponse | null> {
	let recentNotes: Awaited<ReturnType<typeof mongoFetchRecentNotes>>
	try {
		recentNotes = await mongoFetchRecentNotes(userId, 3)
	} catch {
		return null
	}

	if (recentNotes.length === 0) {
		return {
			answer:
				"Your knowledge base doesn't contain any notes yet. " +
				"Upload a document or save some highlights to get started.",
			citations: [],
			retrievedChunks: 0,
			rerankedChunks: 0,
			pipeline: "fallback",
		}
	}

	const latest = recentNotes[0]
	const latestDate = (latest.updatedAt ?? latest.createdAt ?? "").slice(0, 10)

	// Also check if user wants related meetings
	const wantsMeets = MEET_SUBJECT_RE.test(query)
	let meetingSection = ""
	if (wantsMeets) {
		try {
			const allMeets = await mongoFetchMeetHeaders(userId)
			const kws = itemKeywords(latest.title, latest.tags ?? [])
			const relatedMeets = allMeets.filter((m) => {
				const hay = `${m.title} ${m.summary ?? ""} ${m.executiveSummary ?? ""} ${m.tags.join(" ")}`.toLowerCase()
				return kws.some((kw) => hay.includes(kw))
			})
			meetingSection =
				relatedMeets.length === 0
					? "\n\n**Related meetings/sessions:** None found in your knowledge base that cover the same topic."
					: "\n\n**Related meetings/sessions found:**\n" +
					  relatedMeets
							.slice(0, 5)
							.map((m) => `- **${m.title}** (${m.startedAt ? m.startedAt.slice(0, 10) : "date unknown"})`)
							.join("\n")
		} catch {
			meetingSection = "\n\n*(Could not check for related meetings — database error.)*"
		}
	}

	const noteContext = [
		`**Title:** ${latest.title}`,
		`**Last updated:** ${latestDate}`,
		latest.tags?.length > 0 ? `**Tags:** ${latest.tags.join(", ")}` : null,
		`\n${latest.content.slice(0, 5000)}`,
	]
		.filter(Boolean)
		.join("\n")

	const otherRecentLines =
		recentNotes.length > 1
			? "\n\n**Other recently updated notes:**\n" +
			  recentNotes
					.slice(1)
					.map((n) => `- "${n.title}" (${(n.updatedAt ?? n.createdAt ?? "").slice(0, 10)})`)
					.join("\n")
			: ""

	const systemPrompt =
		`You are a knowledgeable assistant for a personal knowledge management platform.\n` +
		`The user asked about their most recently added/updated note. ` +
		`Below is the actual latest note fetched directly by date (NOT by similarity — this is definitively the newest item).\n\n` +
		`LATEST NOTE:\n${"─".repeat(50)}\n${noteContext}\n${"─".repeat(50)}` +
		otherRecentLines +
		meetingSection +
		`\n\nINSTRUCTIONS:\n` +
		`1. Provide a clear, well-structured summary of the latest note.\n` +
		`2. Cover: main topic, key concepts, important facts, action items (if any).\n` +
		(wantsMeets ? `3. After the summary, explicitly state whether any related meeting or session was found (the information is above).\n` : "") +
		`4. Use markdown: ## headings, bullet lists, **bold** for key terms.\n` +
		`5. Be thorough but concise. Do not make up content not in the note.`

	const answer = await callGroqChat(
		[
			{ role: "system", content: systemPrompt },
			{ role: "user", content: query },
		],
		{ temperature: 0.15, maxTokens: 2048 }
	)

	return {
		answer: answer ?? "Could not generate a summary for your latest note.",
		citations: [
			{
				sourceType: "note" as ChunkSourceType,
				sourceId: latest.id,
				chunkId: latest.id,
				title: latest.title,
				url: latest.url,
				relevanceScore: 1.0,
			},
		],
		retrievedChunks: recentNotes.length,
		rerankedChunks: 1,
		pipeline: "rag",
	}
}

async function executeRecencyQuery(ragQuery: RAGQuery): Promise<RAGResponse | null> {
	if (!detectRecencyIntent(ragQuery.query)) return null

	const q = ragQuery.query
	const meetSubject = MEET_SUBJECT_RE.test(q)
	const noteSubject = NOTE_SUBJECT_RE.test(q)

	if (meetSubject && !noteSubject) {
		return executeRecencyMeetQuery(ragQuery.userId, q)
	}
	return executeRecencyNoteQuery(ragQuery.userId, q)
}

/** Broaden the user question into a better search string before hybrid retrieval. */
async function rewriteQueryForRetrieval(
	query: string,
	chatHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
	const historyContext = chatHistory && chatHistory.length > 0
		? `Recent conversation:\n${chatHistory.slice(-4).map((m) => `${m.role}: ${m.content}`).join("\n")}\n\n`
		: ""

	const raw = await callGroqChat(
		[
			{
				role: "system",
				content:
					"You are a search query optimizer for a personal knowledge base that contains notes, web highlights, documents, and meeting transcripts. " +
					"Your job: given a user query, produce ONE improved search query that maximises retrieval recall. " +
					"Rules: (a) keep the core intent; (b) add synonyms or related terms that might appear in source documents; " +
					"(c) make it concrete — include nouns, verbs, and domain terms; " +
					"(d) if the query is already a clear keyword search, return it unchanged; " +
					"(e) output ONLY the improved query text — no quotes, no explanation, no labels.",
			},
			{
				role: "user",
				content: `${historyContext}Original query: ${query}`,
			},
		],
		{ temperature: 0.1, maxTokens: 150 }
	)

	const rewritten = raw?.trim()
	if (!rewritten || rewritten.length < 5 || rewritten.toLowerCase() === query.toLowerCase()) {
		return query
	}
	return rewritten
}

interface RerankResult {
	index: number
	relevance: number
}

async function rerankChunks(
	query: string,
	scoredChunks: ScoredChunk[],
	topK: number
): Promise<ScoredChunk[]> {
	if (scoredChunks.length <= topK) return scoredChunks

	const chunkList = scoredChunks
		.map((sc, i) => {
			const preview = sc.chunk.text.length > 350 ? sc.chunk.text.slice(0, 350) + "…" : sc.chunk.text
			const ctx = sc.chunk.metadata.contextPrefix ? `[Context: ${sc.chunk.metadata.contextPrefix}]\n` : ""
			return `[${i + 1}] Source: ${sc.chunk.metadata.title} (${sc.chunk.metadata.sourceType})\n${ctx}${preview}`
		})
		.join("\n\n")

	const rerankPrompt =
		`Rate each passage's relevance to the query on a scale of 1-10. ` +
		`Return ONLY a JSON array: [{"index": 1, "relevance": 8}, ...]\n\n` +
		`Query: "${query}"\n\nPassages:\n${chunkList}`

	try {
		const result = await callGroqChat(
			[
				{ role: "system", content: "You are a relevance scoring engine. Return only a valid JSON array, nothing else." },
				{ role: "user", content: rerankPrompt },
			],
			{ temperature: 0.05, maxTokens: 1024 }
		)

		if (!result) return scoredChunks.slice(0, topK)

		const jsonMatch = result.match(/\[[\s\S]*\]/)
		if (!jsonMatch) return scoredChunks.slice(0, topK)

		const rankings = JSON.parse(jsonMatch[0]) as RerankResult[]
		const reranked = scoredChunks.map((sc, i) => {
			const r = rankings.find((x) => x.index === i + 1)
			return { ...sc, score: r?.relevance ?? sc.score }
		})
		return reranked.sort((a, b) => b.score - a.score).slice(0, topK)
	} catch {
		return scoredChunks.slice(0, topK)
	}
}

function buildGenerationPrompt(
	query: string,
	contextChunks: ScoredChunk[],
	language: string,
	rewrittenQuery?: string
): { system: string; user: string } {
	const contextBlock = contextChunks
		.map((sc, i) => {
			const meta = sc.chunk.metadata
			const sourceLabel =
				meta.sourceType === "note" ? `Note: "${meta.title}"`
				: meta.sourceType === "highlight" ? `Web highlight from "${meta.title}"`
				: meta.sourceType === "meeting-transcript" ? `Meeting transcript: "${meta.title}"`
				: meta.sourceType === "document" ? `Document: "${meta.title}"`
				: meta.sourceType === "conversation" ? `Past conversation: "${meta.title}"`
				: `Meeting summary: "${meta.title}"`

			const urlLine = meta.url ? ` — ${meta.url}` : ""
			const tagsLine = meta.tags?.length ? ` [tags: ${meta.tags.join(", ")}]` : ""
			const ctxLine = meta.contextPrefix ? `Context: ${meta.contextPrefix}\n` : ""

			return `[Source ${i + 1}] ${sourceLabel}${urlLine}${tagsLine}\n${ctxLine}${sc.chunk.text}`
		})
		.join("\n\n────────────────────\n\n")

	const queryNote = rewrittenQuery && rewrittenQuery !== query
		? `\n(Retrieval used expanded query: "${rewrittenQuery}")`
		: ""

	const system = `You are a knowledgeable AI assistant for UniFlow, a personal knowledge management platform.
You answer questions by synthesising information from the user's own notes, web highlights, documents, and meeting transcripts.

STRICT RULES:
1. Base your answer PRIMARILY on the retrieved source context below.
2. Cite each source inline as [Source N] whenever you use it. Use multiple citations when combining sources.
3. If the context does not fully answer the question, clearly state what is and isn't covered.
4. You may supplement with general knowledge ONLY if clearly labelled: prefix that section with "**Beyond your notes:**".
5. Be thorough, precise, and helpful. Use markdown formatting — headings, bullet lists, bold — to structure your answer.
6. For complex questions, reason step by step before giving the final answer.
7. If the query involves comparing or connecting multiple sources, explicitly synthesise them.
8. Respond in ${language}.

RETRIEVED CONTEXT FROM YOUR KNOWLEDGE BASE:
${"═".repeat(60)}
${contextBlock}
${"═".repeat(60)}`

	const user = `${query}${queryNote}`

	return { system, user }
}

export async function executeRAG(ragQuery: RAGQuery): Promise<RAGResponse> {
	try {
		const recencyResult = await executeRecencyQuery(ragQuery)
		if (recencyResult) return recencyResult
	} catch {
	}

	const {
		userId,
		query,
		sourceTypes,
		sourceIds,
		tags,
		chatHistory,
		retrieveK = 25,
		rerankK = 8,
		systemPromptOverride,
		skipRerank = false,
		skipRewrite = false,
		language = "English",
	} = ragQuery

	let index: ChunkIndex
	try {
		index = await loadOrBuildIndex(userId)
	} catch (err) {
		console.error("RAG: Failed to load chunk index:", err)
		return {
			answer: "I couldn't access your knowledge base. Please try re-indexing your content.",
			citations: [],
			retrievedChunks: 0,
			rerankedChunks: 0,
			pipeline: "fallback",
		}
	}

	if (index.totalChunks === 0) {
		return {
			answer: "Your knowledge base is empty. Add some notes, highlights, or meeting recordings first, then I can answer questions from your content.",
			citations: [],
			retrievedChunks: 0,
			rerankedChunks: 0,
			pipeline: "fallback",
		}
	}

	let rewrittenQuery = query
	if (!skipRewrite) {
		try {
			rewrittenQuery = await rewriteQueryForRetrieval(query, chatHistory)
		} catch {
			rewrittenQuery = query
		}
	}

	const retrieved = await hybridRetrieveForRag({
		userId,
		query: rewrittenQuery,
		retrieveK,
		sourceTypes,
		sourceIds,
		tags,
	})

	if (retrieved.length === 0) {
		try {
			const noContextAnswer = await callGroqChat([
				{
					role: "system",
					content: `You are a helpful assistant for UniFlow. No relevant content was found in the user's knowledge base for their query. Respond helpfully: acknowledge the gap, suggest what content they could add, and offer a brief general answer if you can. Respond in ${language}.`,
				},
				{ role: "user", content: query },
			])
			return {
				answer: noContextAnswer ?? "No relevant content found in your knowledge base for this query.",
				citations: [],
				retrievedChunks: 0,
				rerankedChunks: 0,
				rewrittenQuery,
				pipeline: "rag",
			}
		} catch {
			return {
				answer: "No relevant content found in your knowledge base for this query.",
				citations: [],
				retrievedChunks: 0,
				rerankedChunks: 0,
				pipeline: "fallback",
			}
		}
	}

	let finalChunks: ScoredChunk[]
	if (skipRerank || retrieved.length <= rerankK) {
		finalChunks = retrieved.slice(0, rerankK)
	} else {
		try {
			finalChunks = await rerankChunks(rewrittenQuery, retrieved, rerankK)
		} catch {
			finalChunks = retrieved.slice(0, rerankK)
		}
	}

	const { system: defaultSystem, user: userPrompt } = buildGenerationPrompt(
		query,
		finalChunks,
		language,
		rewrittenQuery !== query ? rewrittenQuery : undefined
	)
	const systemPrompt = systemPromptOverride ?? defaultSystem

	const messages: GroqChatMessage[] = [{ role: "system", content: systemPrompt }]

	if (chatHistory && chatHistory.length > 0) {
		for (const msg of chatHistory.slice(-10)) {
			messages.push({ role: msg.role, content: msg.content })
		}
	}
	messages.push({ role: "user", content: userPrompt })

	try {
		const answer = await callGroqChat(messages, { temperature: 0.25, maxTokens: 2048 })

		if (!answer) throw new Error("Empty response from Groq (GPT-OSS)")

		const citations: RAGSourceCitation[] = []
		const seenKeys = new Set<string>()
		for (const sc of finalChunks) {
			const key = `${sc.chunk.metadata.sourceType}:${sc.chunk.metadata.sourceId}`
			if (!seenKeys.has(key)) {
				seenKeys.add(key)
				citations.push({
					sourceType: sc.chunk.metadata.sourceType,
					sourceId: sc.chunk.metadata.sourceId,
					chunkId: sc.chunk.id,
					title: sc.chunk.metadata.title,
					url: sc.chunk.metadata.url,
					relevanceScore: sc.score,
				})
			}
		}

		return {
			answer,
			citations,
			retrievedChunks: retrieved.length,
			rerankedChunks: finalChunks.length,
			rewrittenQuery: rewrittenQuery !== query ? rewrittenQuery : undefined,
			pipeline: skipRerank ? "rag-no-rerank" : "rag",
		}
	} catch (err) {
		console.error("RAG: Generation failed:", err)
		const fallbackAnswer = finalChunks
			.slice(0, 3)
			.map((sc, i) => `**[Source ${i + 1}: ${sc.chunk.metadata.title}]**\n${sc.chunk.text}`)
			.join("\n\n---\n\n")
		return {
			answer: `Encountered an error generating a response. Here are the most relevant passages:\n\n${fallbackAnswer}`,
			citations: finalChunks.slice(0, 3).map((sc) => ({
				sourceType: sc.chunk.metadata.sourceType,
				sourceId: sc.chunk.metadata.sourceId,
				chunkId: sc.chunk.id,
				title: sc.chunk.metadata.title,
				url: sc.chunk.metadata.url,
				relevanceScore: sc.score,
			})),
			retrievedChunks: retrieved.length,
			rerankedChunks: finalChunks.length,
			pipeline: "fallback",
		}
	}
}

export async function executeMeetingRAG(
	userId: string,
	query: string,
	meetingId: string,
	chatHistory?: Array<{ role: "user" | "assistant"; content: string }>,
	meetingTitle?: string
): Promise<RAGResponse> {
	return executeRAG({
		userId,
		query,
		chatHistory,
		retrieveK: 30,
		rerankK: 10,
		systemPromptOverride: buildMeetingSystemPrompt(meetingTitle ?? "Meeting"),
		language: "English",
	})
}

function buildMeetingSystemPrompt(meetingTitle: string): string {
	return `You are an intelligent assistant for analysing meetings and connecting them to the user's broader knowledge base in UniFlow.

The user is asking about the meeting titled "${meetingTitle}". You have access to the meeting's transcript, summary, AND the user's notes and highlights from other sources.

RULES:
1. Prioritise content from this meeting when answering meeting-specific questions.
2. When the user asks to connect meeting content with their notes/highlights, draw from all available sources.
3. Cite sources as [Source N] inline to show provenance.
4. If information is absent from any source, say so clearly.
5. Synthesise across sources — this cross-referencing is a core feature.
6. Refer to speakers by transcript labels or inferred names.
7. Use markdown formatting for structured answers (headings, bullet lists, bold).
8. Be thorough, precise, and conversational.`
}

export async function executeAssistantRAG(
	userId: string,
	query: string,
	mode: "explain" | "qa",
	highlight?: { id: string; title: string; text: string; url: string },
	chatHistory?: Array<{ role: "user" | "assistant"; content: string }>,
	language?: string,
	scope?: {
		sourceTypes?: ChunkSourceType[]
		sourceIds?: string[]
		tags?: string[]
	}
): Promise<RAGResponse> {
	const lang = language ?? "English"
	const scopeOpts = scope
		? {
				...(scope.sourceTypes?.length ? { sourceTypes: scope.sourceTypes } : {}),
				...(scope.sourceIds?.length ? { sourceIds: scope.sourceIds } : {}),
				...(scope.tags?.length ? { tags: scope.tags } : {}),
		  }
		: {}

	if (mode === "explain" && highlight) {
		return executeRAG({
			userId,
			query: `Explain this concept: ${highlight.text.slice(0, 300)}`,
			chatHistory,
			retrieveK: 20,
			rerankK: 6,
			language: lang,
			...scopeOpts,
			systemPromptOverride: `You are a learning assistant for UniFlow. The user wants an explanation of a highlighted passage from "${highlight.title}".

The highlighted text:
"${highlight.text}"
${highlight.url ? `Source: ${highlight.url}` : ""}

You also have related content from the user's knowledge base below.

RULES:
1. Explain the highlighted concept in clear, accessible language.
2. If related content from the user's notes/meetings adds context, incorporate it and cite as [Source N].
3. Structure your explanation:
   - **Simple meaning**: What this means in plain language
   - **Why it matters**: Practical or theoretical significance
   - **Example**: A concrete example that makes it tangible
   - **Common misconceptions**: What people often get wrong
   - **Study tip / next step**: One actionable takeaway
4. Respond in ${lang}.
5. Use markdown formatting for the structure above.`,
		})
	}

	return executeRAG({
		userId,
		query,
		chatHistory,
		retrieveK: 25,
		rerankK: 8,
		language: lang,
		...scopeOpts,
	})
}
