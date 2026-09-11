import { NextResponse } from "next/server";
import type { ChunkSourceType } from "@/lib/chunk-store";
import { executeAssistantRAG } from "@/lib/rag-pipeline";
import { getSessionUserId } from "@/lib/auth";
import { appendConverseTurns } from "@/lib/converse-store";
import { buildChunkIndex } from "@/lib/chunk-store";

const CHUNK_SOURCE_TYPES: ChunkSourceType[] = [
	"note",
	"highlight",
	"meeting-transcript",
	"meeting-summary",
	"document",
	"conversation",
];

type AssistantMode = "explain" | "qa";
type TranscriptLanguage = "English" | "Spanish" | "French" | "German" | "Korean" | "Hindi";

interface HighlightPayload {
	id?: unknown;
	title?: unknown;
	text?: unknown;
	url?: unknown;
	createdAt?: unknown;
}

interface AssistantPayload {
	mode?: unknown;
	highlight?: unknown;
	sessionTitle?: unknown;
	question?: unknown;
	contextHighlights?: unknown;
	chatHistory?: unknown;
	transcriptLanguage?: unknown;
	/** Optional retrieval scope (scoped AI; see platform architecture) */
	sourceTypes?: unknown;
	sourceIds?: unknown;
	tags?: unknown;
	/** Converse session ID for conversation persistence */
	converseSessionId?: unknown;
}

interface ChatMessagePayload {
	role?: unknown;
	content?: unknown;
}

interface ParsedChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface ParsedHighlight {
	id: string;
	title: string;
	text: string;
	url: string;
	createdAt: string;
}

interface ParsedPayload {
	mode: AssistantMode;
	highlight: ParsedHighlight | null;
	sessionTitle: string;
	question: string;
	contextHighlights: ParsedHighlight[];
	chatHistory: ParsedChatMessage[];
	transcriptLanguage: TranscriptLanguage;
	sourceTypes?: ChunkSourceType[];
	sourceIds?: string[];
	tags?: string[];
	converseSessionId?: string;
}

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status });
}

function parseChunkSourceTypes(raw: unknown): ChunkSourceType[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const allowed = new Set<string>(CHUNK_SOURCE_TYPES);
	const out = raw.filter(
		(x): x is ChunkSourceType => typeof x === "string" && allowed.has(x)
	);
	return out.length ? out : undefined;
}

function parseNonEmptyStringArray(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out = raw
		.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
		.map((s) => s.trim());
	return out.length ? out : undefined;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function parseHighlight(input: unknown): ParsedHighlight | null {
	if (!input || typeof input !== "object") {
		return null;
	}

	const candidate = input as HighlightPayload;
	const title = isNonEmptyString(candidate.title) ? candidate.title.trim() : "";
	const text = isNonEmptyString(candidate.text) ? candidate.text.trim() : "";
	const url = isNonEmptyString(candidate.url) ? candidate.url.trim() : "";
	const createdAt = isNonEmptyString(candidate.createdAt) ? candidate.createdAt.trim() : "";
	const id = isNonEmptyString(candidate.id) ? candidate.id.trim() : `${url}-${createdAt}-${text.slice(0, 30)}`;

	if (!text) {
		return null;
	}

	return {
		id,
		title,
		text,
		url,
		createdAt,
	};
}

function parsePayload(payload: AssistantPayload): ParsedPayload {
	const mode = payload.mode;
	if (mode !== "explain" && mode !== "qa") {
		throw new Error("Invalid payload: 'mode' must be 'explain' or 'qa'");
	}

	const highlight = parseHighlight(payload.highlight);
	const sessionTitle = isNonEmptyString(payload.sessionTitle) ? payload.sessionTitle.trim() : "Current Session";
	const question = isNonEmptyString(payload.question) ? payload.question.trim() : "";
	const transcriptLanguage: TranscriptLanguage =
		payload.transcriptLanguage === "Spanish" ||
		payload.transcriptLanguage === "French" ||
		payload.transcriptLanguage === "German" ||
		payload.transcriptLanguage === "Korean" ||
		payload.transcriptLanguage === "Hindi" ||
		payload.transcriptLanguage === "English"
			? payload.transcriptLanguage
			: "English";

	const contextHighlights = Array.isArray(payload.contextHighlights)
		? payload.contextHighlights
				.map((item) => parseHighlight(item))
				.filter((item): item is ParsedHighlight => item !== null)
		: [];

	const chatHistory = Array.isArray(payload.chatHistory)
		? payload.chatHistory
				.map((item) => {
					if (!item || typeof item !== "object") {
						return null;
					}

					const candidate = item as ChatMessagePayload;
					if ((candidate.role !== "user" && candidate.role !== "assistant") || !isNonEmptyString(candidate.content)) {
						return null;
					}

					return {
						role: candidate.role,
						content: candidate.content.trim(),
					};
				})
				.filter((item): item is ParsedChatMessage => item !== null)
		: [];

	if (mode === "explain" && !highlight) {
		throw new Error("Invalid payload: 'highlight' is required for explain mode");
	}

	if (mode === "qa" && !question) {
		throw new Error("Invalid payload: 'question' is required for qa mode");
	}

	return {
		mode,
		highlight,
		sessionTitle,
		question,
		contextHighlights,
		chatHistory,
		transcriptLanguage,
		sourceTypes: parseChunkSourceTypes(payload.sourceTypes),
		sourceIds: parseNonEmptyStringArray(payload.sourceIds),
		tags: parseNonEmptyStringArray(payload.tags),
		converseSessionId: isNonEmptyString(payload.converseSessionId)
			? payload.converseSessionId.trim()
			: undefined,
	};
}

function fallbackExplanation(highlight: ParsedHighlight, transcriptLanguage: TranscriptLanguage) {
	if (transcriptLanguage === "Spanish") {
		const cleanText = highlight.text.replace(/\s+/g, " ").trim();
		const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
		const leadTopic = highlight.title || "este concepto";

		return [
			`${leadTopic} en palabras simples:`,
			shortText,
			"Que significa: enfocarte primero en la idea principal.",
			"Ejemplo facil: conectalo con una situacion real.",
			"Revision rapida: explicalo en una frase con tus palabras.",
		].join(" ");
	}

	if (transcriptLanguage === "French") {
		const cleanText = highlight.text.replace(/\s+/g, " ").trim();
		const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
		const leadTopic = highlight.title || "ce concept";

		return [
			`${leadTopic} en version simple:`,
			shortText,
			"Ce que cela veut dire: se concentrer d'abord sur l'idee principale.",
			"Exemple facile: relie-le a une situation reelle.",
			"Revision rapide: explique-le en une phrase avec tes mots.",
		].join(" ");
	}

	if (transcriptLanguage === "German") {
		const cleanText = highlight.text.replace(/\s+/g, " ").trim();
		const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
		const leadTopic = highlight.title || "dieses Konzept";

		return [
			`${leadTopic} einfach erklart:`,
			shortText,
			"Was das bedeutet: zuerst auf die Kernidee konzentrieren.",
			"Einfaches Beispiel: verbinde es mit einer realen Situation.",
			"Schnelle Wiederholung: erklare es in einem Satz mit eigenen Worten.",
		].join(" ");
	}

	if (transcriptLanguage === "Korean") {
		const cleanText = highlight.text.replace(/\s+/g, " ").trim();
		const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
		const leadTopic = highlight.title || "이 개념";

		return [
			`${leadTopic}를 쉽게 설명하면:`,
			shortText,
			"의미: 어려운 단어보다 핵심 아이디어를 먼저 이해하세요.",
			"쉬운 예시: 이 아이디어를 이미 아는 실제 상황과 연결해 보세요.",
			"빠른 복습: 친구에게 설명하듯 한 문장으로 말해 보세요.",
		].join(" ");
	}

	if (transcriptLanguage === "Hindi") {
		const cleanText = highlight.text.replace(/\s+/g, " ").trim();
		const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
		const leadTopic = highlight.title || "यह अवधारणा";

		return [
			`${leadTopic} को आसान तरीके से समझें:`,
			shortText,
			"मतलब: कठिन शब्दों से पहले मुख्य विचार पर ध्यान दें.",
			"आसान उदाहरण: इसे किसी परिचित वास्तविक स्थिति से जोड़कर देखें.",
			"त्वरित पुनरावृत्ति: इसे एक वाक्य में ऐसे समझाएं जैसे दोस्त को पढ़ा रहे हों.",
		].join(" ");
	}

	const cleanText = highlight.text.replace(/\s+/g, " ").trim();
	const shortText = cleanText.length > 220 ? `${cleanText.slice(0, 220).trim()}...` : cleanText;
	const leadTopic = highlight.title || "this concept";

	return [
		`${leadTopic} in simple words:`,
		shortText,
		"What this means: focus on the main idea first, not difficult words.",
		"Easy example: connect this to one real situation you already know.",
		"Quick check: explain this in one sentence as if teaching a friend.",
	].join(" ");
}

function fallbackAnswer(
	question: string,
	sessionTitle: string,
	contextHighlights: ParsedHighlight[],
	transcriptLanguage: TranscriptLanguage
) {
	if (transcriptLanguage === "Spanish") {
		if (contextHighlights.length === 0) {
			return `Puedo ayudarte con "${sessionTitle}", pero aun no hay highlights en contexto. Agrega o selecciona notas y vuelve a preguntar.`;
		}

		const primary = contextHighlights[0];
		const text = primary.text.replace(/\s+/g, " ").trim();
		const shortText = text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
		return `Respuesta a "${question}": ${shortText} Si quieres, tambien puedo darte un ejemplo o un mini quiz.`;
	}

	if (transcriptLanguage === "French") {
		if (contextHighlights.length === 0) {
			return `Je peux t'aider pour "${sessionTitle}", mais il n'y a pas encore de highlights dans le contexte. Ajoute ou selectionne des notes puis repose ta question.`;
		}

		const primary = contextHighlights[0];
		const text = primary.text.replace(/\s+/g, " ").trim();
		const shortText = text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
		return `Reponse a "${question}": ${shortText} Je peux aussi fournir un exemple ou un mini quiz.`;
	}

	if (transcriptLanguage === "German") {
		if (contextHighlights.length === 0) {
			return `Ich kann bei "${sessionTitle}" helfen, aber es gibt noch keine Highlights im Kontext. Fuge Notizen hinzu oder wahle sie aus und frage erneut.`;
		}

		const primary = contextHighlights[0];
		const text = primary.text.replace(/\s+/g, " ").trim();
		const shortText = text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
		return `Antwort auf "${question}": ${shortText} Ich kann auch ein Beispiel oder ein Mini-Quiz geben.`;
	}

	if (transcriptLanguage === "Korean") {
		if (contextHighlights.length === 0) {
			return `"${sessionTitle}"에 대해 도와드릴 수 있지만, 아직 참고할 하이라이트가 없습니다. 노트를 선택하거나 추가한 뒤 다시 질문해 주세요.`;
		}

		const primary = contextHighlights[0];
		const text = primary.text.replace(/\s+/g, " ").trim();
		const shortText = text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
		return `"${question}"에 대한 답변: ${shortText} 원하면 더 쉬운 설명, 예시, 또는 미니 퀴즈도 제공할 수 있어요.`;
	}

	if (transcriptLanguage === "Hindi") {
		if (contextHighlights.length === 0) {
			return `मैं "${sessionTitle}" में मदद कर सकता हूं, लेकिन अभी संदर्भ में कोई हाइलाइट नहीं है. कृपया नोट्स जोड़ें या चुनें, फिर दोबारा पूछें.`;
		}

		const primary = contextHighlights[0];
		const text = primary.text.replace(/\s+/g, " ").trim();
		const shortText = text.length > 220 ? `${text.slice(0, 220).trim()}...` : text;
		return `"${question}" का उत्तर: ${shortText} चाहें तो मैं इसका आसान संस्करण, एक उदाहरण, या छोटा क्विज भी दे सकता हूं.`;
	}

	if (contextHighlights.length === 0) {
		return `I can help with \"${sessionTitle}\", but there are no highlights in context yet. Add or select notes, then ask again.`;
	}

	const normalizedQuestion = question.trim();
	const lowerQuestion = normalizedQuestion.toLowerCase();
	const queryTokens = lowerQuestion.match(/[a-z][a-z0-9]{2,}/g) || [];

	const scored = contextHighlights
		.map((item) => {
			const source = `${item.title} ${item.text}`.toLowerCase();
			let score = 0;
			for (const token of queryTokens) {
				if (source.includes(token)) {
					score += 1;
				}
			}
			return { item, score };
		})
		.sort((left, right) => right.score - left.score);

	const topMatches = scored.slice(0, Math.min(2, scored.length)).map((entry) => entry.item);
	const primary = topMatches[0] || contextHighlights[0];
	const primaryText = primary.text.replace(/\s+/g, " ").trim();
	const shortPrimary = primaryText.length > 220 ? `${primaryText.slice(0, 220).trim()}...` : primaryText;

	const wantsSummary = /summary|summarize|overview|main point/.test(lowerQuestion);
	const wantsExample = /example|real world|use case|sample/.test(lowerQuestion);
	const wantsSteps = /how|steps|process|method|approach/.test(lowerQuestion);
	const wantsQuiz = /quiz|test me|practice|questions/.test(lowerQuestion);
	const wantsCompare = /compare|difference|vs|versus/.test(lowerQuestion);

	if (wantsSummary) {
		const lines = topMatches.map((item, index) => {
			const text = item.text.replace(/\s+/g, " ").trim();
			const shortText = text.length > 140 ? `${text.slice(0, 140).trim()}...` : text;
			return `${index + 1}. ${shortText}`;
		});

		return `Summary for \"${sessionTitle}\": ${lines.join(" ")} Suggested revision: explain each point in your own words.`;
	}

	if (wantsExample) {
		return `Simple example from your highlights: ${shortPrimary} Real-world connection: apply this idea to one small task you do daily, then describe what changes when you use it correctly.`;
	}

	if (wantsSteps) {
		return `Try this 3-step method: Step 1: Read this key idea - ${shortPrimary} Step 2: Rewrite it in plain words. Step 3: Solve one tiny practice question using that idea.`;
	}

	if (wantsQuiz) {
		const topic = primary.title || "this topic";
		return `Quick practice on ${topic}: Q1) What is the core idea? Q2) Why is it useful? Q3) Give one practical example from your own experience. I can check your answers if you share them.`;
	}

	if (wantsCompare && topMatches.length > 1) {
		const second = topMatches[1];
		const secondText = second.text.replace(/\s+/g, " ").trim();
		const shortSecond = secondText.length > 130 ? `${secondText.slice(0, 130).trim()}...` : secondText;
		return `Comparison from your notes: First idea - ${shortPrimary} Second idea - ${shortSecond} Main difference: the first focuses on ${primary.title || "its core concept"}, while the second focuses on ${second.title || "another related concept"}.`;
	}

	return `Answer to \"${normalizedQuestion}\": ${shortPrimary} If you want, I can also give a simpler explanation, an example, or a short quiz from this same topic.`;
}

function buildSystemPrompt(mode: AssistantMode, transcriptLanguage: TranscriptLanguage) {
	const responseLanguage = `Respond in ${transcriptLanguage}.`;

	if (mode === "explain") {
		return `You are a simple AI tutor. Explain highlighted text for a beginner in very easy language. ${responseLanguage} Use short sentences, avoid jargon, and define difficult words in plain language. Output exactly 5-7 sentences in this order: 1) Simple meaning, 2) Why it matters, 3) Easy example, 4) Common mistake, 5) One study tip. No markdown.`;
	}

	return `You are a learning assistant. ${responseLanguage} Answer only from the provided highlights context. If unsure, say what is missing. Keep answers short and direct. No markdown.`;
}

function buildUserPrompt(payload: ParsedPayload) {
	if (payload.mode === "explain" && payload.highlight) {
		return [
			`Session title: ${payload.sessionTitle}`,
			`Preferred language: ${payload.transcriptLanguage}`,
			`Highlight title: ${payload.highlight.title || "Untitled"}`,
			`Highlight text: ${payload.highlight.text}`,
			`Source URL: ${payload.highlight.url || "Unknown"}`,
			"Task: Explain this concept for a student and suggest one follow-up learning action.",
		].join("\n");
	}

	const context = payload.contextHighlights
		.map(
			(item, index) =>
				`[${index + 1}] Title: ${item.title || "Untitled"}\nText: ${item.text}\nSource: ${item.url || "Unknown"}`
		)
		.join("\n\n");

	return [
		`Session title: ${payload.sessionTitle}`,
		`Preferred language: ${payload.transcriptLanguage}`,
		`Question: ${payload.question}`,
		"Context highlights:",
		context || "No context provided.",
		"Task: Answer using only the context. Include one short supporting reference to the context.",
	].join("\n\n");
}

export async function POST(request: Request) {
	try {
		const userId = await getSessionUserId(request);
		if (!userId) return errorResponse("Not authenticated", 401);

		const raw = (await request.json()) as AssistantPayload;
		const payload = parsePayload(raw);

		let answer: string;
		let provider: "llm" | "fallback" | "rag" = "fallback";
		let citations: Array<{
			sourceType: string
			sourceId: string
			title: string
			url?: string
			chunkId: string
		}> = [];

		try {
			const apiKey = process.env.GROQ_API_KEY;
			if (apiKey) {
				const highlight = payload.highlight
					? { id: payload.highlight.id, title: payload.highlight.title, text: payload.highlight.text, url: payload.highlight.url }
					: undefined;
				const chatHistory = payload.chatHistory.map((m) => ({ role: m.role, content: m.content }));

				const scope =
					payload.sourceTypes?.length || payload.sourceIds?.length || payload.tags?.length
						? {
								...(payload.sourceTypes?.length ? { sourceTypes: payload.sourceTypes } : {}),
								...(payload.sourceIds?.length ? { sourceIds: payload.sourceIds } : {}),
								...(payload.tags?.length ? { tags: payload.tags } : {}),
							}
						: undefined;

				const result = await executeAssistantRAG(
					userId,
					payload.mode === "qa" ? payload.question : (payload.highlight?.text ?? ""),
					payload.mode,
					highlight,
					chatHistory.length > 0 ? chatHistory : undefined,
					payload.transcriptLanguage,
					scope
				);

				answer = result.answer;
				provider = result.pipeline === "fallback" ? "fallback" : "rag";
				citations = result.citations.map((c) => ({
					sourceType: c.sourceType,
					sourceId: c.sourceId,
					title: c.title,
					url: c.url,
					chunkId: c.chunkId,
				}));
			} else if (payload.mode === "explain" && payload.highlight) {
				answer = fallbackExplanation(payload.highlight, payload.transcriptLanguage);
			} else {
				answer = fallbackAnswer(
					payload.question,
					payload.sessionTitle,
					payload.contextHighlights,
					payload.transcriptLanguage
				);
			}
		} catch (upstreamError) {
			console.error("POST /api/meet-assistant upstream error", upstreamError);
			if (payload.mode === "explain" && payload.highlight) {
				answer = fallbackExplanation(payload.highlight, payload.transcriptLanguage);
			} else {
				answer = fallbackAnswer(
					payload.question,
					payload.sessionTitle,
					payload.contextHighlights,
					payload.transcriptLanguage
				);
			}
		}

		if (payload.converseSessionId) {
			const userQ = payload.mode === "qa" ? payload.question : (payload.highlight?.text ?? "");
			const scopeLabel =
				payload.sourceTypes?.length ? payload.sourceTypes.join(",") : "all";
			void appendConverseTurns(
				userId,
				payload.converseSessionId,
				userQ,
				answer,
				scopeLabel,
				citations.length > 0
					? citations.map((c) => ({
							sourceType: c.sourceType,
							title: c.title,
							chunkId: c.chunkId,
						}))
					: undefined
			).then(() => {
				void buildChunkIndex(userId);
			}).catch((err) => {
				console.error("Failed to persist conversation turn", err);
			});
		}

		return NextResponse.json({ data: { answer, provider, citations } }, { status: 200 });
	} catch (error) {
		if (error instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400);
		}

		if (error instanceof Error && error.message.startsWith("Invalid payload:")) {
			return errorResponse(error.message, 400);
		}

		console.error("POST /api/meet-assistant failed", error);
		return errorResponse("Failed to process assistant request", 500);
	}
}
