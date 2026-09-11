import { NextResponse } from "next/server";
import { callGroqChat } from "@/lib/groq-chat-client";
import { readNotes, type Note } from "@/lib/notes-store";
import { hybridRetrieveForRag } from "@/lib/mongo-knowledge";
import { getSessionUserId } from "@/lib/auth";

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status });
}

/** Pull a few related chunks from the rest of the KB, never from this note’s own chunks. */
async function fetchRelatedContext(
	userId: string,
	noteId: string,
	query: string,
	noteTitle: string
): Promise<string> {
	try {
		const chunks = await hybridRetrieveForRag({ userId, query, retrieveK: 8 });
		// Exclude chunks belonging to this note to avoid circular context
		const external = chunks.filter(
			(sc) => !(sc.chunk.metadata.sourceId === noteId)
		).slice(0, 5);

		if (external.length === 0) return "";

		const lines = external.map((sc, i) => {
			const meta = sc.chunk.metadata;
			const sourceLabel =
				meta.sourceType === "note" ? `Note: "${meta.title}"`
				: meta.sourceType === "highlight" ? `Highlight from "${meta.title}"`
				: meta.sourceType === "meeting-transcript" ? `Meeting: "${meta.title}"`
				: meta.sourceType === "document" ? `Document: "${meta.title}"`
				: `Source: "${meta.title}"`;
			const ctx = meta.contextPrefix ? `[${meta.contextPrefix}]\n` : "";
			return `[KB ${i + 1}] ${sourceLabel}\n${ctx}${sc.chunk.text.slice(0, 500)}`;
		});

		return [
			`\nRELATED CONTENT FROM YOUR KNOWLEDGE BASE (for cross-referencing "${noteTitle}"):`,
			"─".repeat(50),
			lines.join("\n\n"),
			"─".repeat(50),
		].join("\n");
	} catch {
		return "";
	}
}

async function buildSystemPrompt(userId: string, note: Note, query: string): Promise<string> {
	const tagLine = note.tags.length > 0 ? `Tags: ${note.tags.join(", ")}\n` : "";
	const highlightsSection =
		note.rawHighlights && note.rawHighlights.length > 1
			? `\n\nORIGINAL HIGHLIGHTS (${note.rawHighlights.length} sources before consolidation):\n${note.rawHighlights.map((h, i) => `[${i + 1}] ${h}`).join("\n")}`
			: "";

	// Fetch related context from KB for richer cross-referencing
	const relatedContext = await fetchRelatedContext(userId, note.id, query, note.title);

	return `You are an intelligent learning assistant for the note titled "${note.title}".
Your primary knowledge source is the full content of this note, provided below.
You also have access to related content from the user's broader knowledge base for cross-referencing.

STRICT RULES:
1. Base ALL responses on the note content below. This is your primary source.
2. If the user asks about something not present in or inferable from the note, say: "That isn't covered in this note."
3. EXCEPTION — outside knowledge: Only when the user explicitly requests an outside perspective ("from your own knowledge", "outside this note", "outside pov", "general context", "what does the broader field say") may you draw on your training. Prefix that section with "**Outside context:**" so the user knows you are going beyond the note.
4. You may freely analyse, synthesise, and give opinions — but ground them in the note content.
5. You can have rich discussions: explain concepts, connect ideas within the note, identify gaps, suggest deeper questions.
6. When the related KB content below is relevant to the user's question, incorporate it and cite it as [KB N].
7. Be thorough and structured. Use markdown — headings, bullets, bold — when it helps clarity.
8. For questions like "what are the key takeaways" or "summarise this note", produce a structured Cornell-style response:
   - **Main Ideas**: the core concepts
   - **Key Details**: specific facts, data, examples
   - **Cue Questions**: 3-5 questions a student might use for review
   - **Summary**: 2-3 sentence distillation

SOURCE: ${note.url || "no URL"}
${tagLine}FULL NOTE CONTENT OF "${note.title}":
${"─".repeat(50)}
${note.content}
${"─".repeat(50)}${highlightsSection}${relatedContext}`;
}

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface RequestBody {
	messages?: unknown;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const userId = await getSessionUserId(request);
	if (!userId) return errorResponse("Not authenticated", 401);
	try {
		const { id } = await params;

		const notes = await readNotes(userId);
		const note = notes.find((n: Note) => n.id === id);
		if (!note) return errorResponse("Note not found", 404);

		if (!note.content || note.content.trim().length === 0) {
			return errorResponse("Note has no content", 400);
		}

		const body = (await request.json()) as RequestBody;
		if (!Array.isArray(body.messages)) {
			return errorResponse("'messages' must be an array", 400);
		}

		const messages: ChatMessage[] = (body.messages as unknown[])
			.filter(
				(m): m is ChatMessage =>
					typeof m === "object" &&
					m !== null &&
					"role" in m &&
					"content" in m &&
					((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant")
			)
			.slice(-20);

		if (messages.length === 0) {
			return errorResponse("No valid messages provided", 400);
		}

		// Use the latest user message as the query for KB context retrieval
		const latestQuery = messages.filter((m) => m.role === "user").at(-1)?.content ?? note.title;

		const systemPrompt = await buildSystemPrompt(userId, note, latestQuery);

		const reply =
			(await callGroqChat(
				[
					{ role: "system", content: systemPrompt },
					...messages.map((m) => ({ role: m.role, content: m.content })),
				],
				{ temperature: 0.3, maxTokens: 4096 }
			)) ?? "";

		if (!reply) return errorResponse("GROQ_API_KEY is not configured or AI returned empty", 503);

		return NextResponse.json({ reply }, { status: 200 });
	} catch (err) {
		if (err instanceof SyntaxError) {
			return errorResponse("Invalid JSON body", 400);
		}
		console.error("POST /api/notes/[id]/converse failed", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Internal server error" },
			{ status: 500 }
		);
	}
}
