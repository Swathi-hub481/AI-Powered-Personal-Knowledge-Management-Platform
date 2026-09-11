/**
 * Groq OpenAI-compatible chat: GPT-OSS (e.g. openai/gpt-oss-120b).
 *
 * Token budget strategy (free tier = 10 000 TPM):
 *  1. Estimate input tokens (4 chars ≈ 1 token) before every request.
 *  2. If estimated input > INPUT_TOKEN_CAP, iteratively trim the largest
 *     user/assistant message (keep head + tail, elide middle) until it fits.
 *  3. On a 429 response, parse the Groq retry-after hint and wait, then retry
 *     up to MAX_RETRIES times before surfacing an error.
 */

/** Default model for all server-side LLM calls (Groq). */
export const GPT_OSS_MODEL = "openai/gpt-oss-120b" as const

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"

/** Estimated input token cap per request (leaves room for output tokens inside the 10 k TPM window). */
const INPUT_TOKEN_CAP = 5500

/** Maximum 429 retries before giving up. */
const MAX_RETRIES = 4

export type GroqChatMessageRole = "system" | "user" | "assistant"

export interface GroqChatMessage {
	role: GroqChatMessageRole
	content: string
}

export interface CallGroqChatOptions {
	temperature?: number
	/** Max output tokens. Defaults to 2048 to conserve TPM budget. */
	maxTokens?: number
	jsonMode?: boolean
	/** Override the input token cap for this call (use for short extraction tasks). */
	inputTokenCap?: number
}

type MessageContent = string | null | Array<{ type?: string; text?: string }>

interface GroqChatResponse {
	choices?: Array<{
		message?: {
			content?: MessageContent
			reasoning?: string
			reasoning_content?: string
		}
	}>
}

function extractAssistantContent(
	message: { content?: MessageContent; reasoning?: string; reasoning_content?: string } | undefined
): string {
	if (!message) return ""
	const c = message.content
	if (typeof c === "string" && c.length > 0) return c.trim()
	if (c == null) {
		if (typeof message.reasoning === "string" && message.reasoning.length > 0) {
			return message.reasoning.trim()
		}
		if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) {
			return message.reasoning_content.trim()
		}
	}
	if (Array.isArray(c)) {
		const parts: string[] = []
		for (const p of c) {
			if (p && p.type === "text" && typeof p.text === "string") parts.push(p.text)
		}
		return parts.join("\n").trim()
	}
	return ""
}

/** Rough token estimate: 4 chars ≈ 1 token. */
function estimateTokens(messages: GroqChatMessage[]): number {
	return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
}

/**
 * Iteratively trim the largest user/assistant message until the estimated
 * token count is within `cap`. System messages are never touched.
 * Strategy: keep first 55 % and last 10 % of the content, elide the middle.
 */
function compactMessages(messages: GroqChatMessage[], cap: number): GroqChatMessage[] {
	const msgs = messages.map((m) => ({ ...m }))

	for (let pass = 0; pass < 6; pass++) {
		if (estimateTokens(msgs) <= cap) break

		let maxLen = 0
		let maxIdx = -1
		for (let i = 0; i < msgs.length; i++) {
			if (msgs[i].role !== "system" && msgs[i].content.length > maxLen) {
				maxLen = msgs[i].content.length
				maxIdx = i
			}
		}
		if (maxIdx === -1) break

		const content = msgs[maxIdx].content
		const keepStart = Math.floor(content.length * 0.55)
		const keepEnd = Math.floor(content.length * 0.1)
		const omittedChars = content.length - keepStart - keepEnd
		const omittedTokens = Math.round(omittedChars / 4)

		msgs[maxIdx] = {
			...msgs[maxIdx],
			content:
				content.slice(0, keepStart) +
				`\n\n[…~${omittedTokens} tokens omitted to stay within rate-limit budget…]\n\n` +
				content.slice(content.length - keepEnd),
		}
	}

	return msgs
}

/**
 * Returns milliseconds to wait after a 429 response.
 * Groq may include `retry-after-ms` or `x-ratelimit-reset-tokens` headers,
 * or a "try again in Xms / Xs" hint in the response body.
 */
function parseRetryAfterMs(headers: Headers, errorBody: string): number {
	const hMs = headers.get("retry-after-ms")
	if (hMs && /^\d+$/.test(hMs)) return Math.max(parseInt(hMs, 10) + 200, 500)

	const hS = headers.get("retry-after")
	if (hS && /^\d+$/.test(hS)) return Math.max(parseInt(hS, 10) * 1000 + 200, 500)

	const m = errorBody.match(/try again in ([\d.]+)\s*(ms|s)/i)
	if (m) {
		const n = parseFloat(m[1])
		const ms = m[2].toLowerCase() === "s" ? n * 1000 : n
		return Math.max(ms + 200, 500)
	}

	return 3000
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Chat completion with GPT-OSS on Groq.
 * - Returns null if GROQ_API_KEY is missing.
 * - Automatically compacts messages that exceed INPUT_TOKEN_CAP.
 * - Retries up to MAX_RETRIES times on 429 rate-limit responses.
 */
export async function callGroqChat(
	messages: GroqChatMessage[],
	options?: CallGroqChatOptions
): Promise<string | null> {
	const apiKey = process.env.GROQ_API_KEY
	if (!apiKey) return null

	const cap = options?.inputTokenCap ?? INPUT_TOKEN_CAP
	const compacted = compactMessages(messages, cap)

	const body: Record<string, unknown> = {
		model: GPT_OSS_MODEL,
		temperature: options?.temperature ?? 0.3,
		max_tokens: options?.maxTokens ?? 2048,
		messages: compacted,
	}

	if (options?.jsonMode) {
		body.response_format = { type: "json_object" }
	}

	let lastError: Error | null = null

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const response = await fetch(GROQ_CHAT_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		})

		if (response.status === 429) {
			const errText = await response.text()
			const waitMs = parseRetryAfterMs(response.headers, errText)

			if (attempt < MAX_RETRIES) {
				console.warn(
					`[groq-chat] 429 rate limit — waiting ${waitMs} ms before retry ${attempt + 1}/${MAX_RETRIES}…`
				)
				await sleep(waitMs)
				continue
			}

			lastError = new Error(
				`Groq ${GPT_OSS_MODEL} rate limit exceeded after ${MAX_RETRIES} retries. ` +
					`Last retry-after: ${waitMs} ms. Consider reducing request frequency.`
			)
			break
		}

		if (!response.ok) {
			const text = await response.text()
			throw new Error(`Groq ${GPT_OSS_MODEL} error (${response.status}): ${text.slice(0, 300)}`)
		}

		const data = (await response.json()) as GroqChatResponse
		const msg = data.choices?.[0]?.message
		const text = extractAssistantContent(msg)
		return text.trim() || null
	}

	throw lastError ?? new Error(`Groq ${GPT_OSS_MODEL}: exhausted retries`)
}

// Remove dead code from my draft - I had extractAssistantText stub that does nothing. Let me remove that.