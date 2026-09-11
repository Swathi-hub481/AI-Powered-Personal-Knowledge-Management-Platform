import { NextResponse } from "next/server";
import { callGroqChat } from "@/lib/groq-chat-client";
import type { MeetSession, TranscriptUtterance } from "@/lib/meet-types";
import { mongoFindMeetById } from "@/lib/mongo-app-data";
import { getSessionUserId } from "@/lib/auth";

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status });
}

function formatTranscript(transcript: TranscriptUtterance[], maxChars = 24_000): string {
	const lines = transcript.map((u) => {
		const mins = Math.floor(u.start / 60);
		const secs = Math.floor(u.start % 60);
		const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
		return `[${ts}] ${u.speaker}: ${u.text}`;
	});
	const full = lines.join("\n");
	if (full.length <= maxChars) return full;

	// If too long, keep first third + last third so context and recent discussion are present
	const third = Math.floor(maxChars / 3 / 60);
	const head = lines.slice(0, third).join("\n");
	const tail = lines.slice(-third).join("\n");
	return `${head}\n\n[... middle section of transcript omitted for length ...]\n\n${tail}`;
}

function buildSystemPrompt(session: MeetSession): string {
	const transcriptText = formatTranscript(session.transcript);

	// Build a rich context preamble from already-generated analysis if available
	const preambleParts: string[] = [];

	if (session.executiveSummary) {
		preambleParts.push(`EXECUTIVE SUMMARY:\n${session.executiveSummary}`);
	}

	if (session.participants && session.participants.length > 0) {
		const participantList = session.participants
			.map((p) => {
				const name = p.speakerName ? ` (${p.speakerName})` : "";
				return `• ${p.speakerLabel}${name}: ${p.role} — ${p.participationLevel} participation`;
			})
			.join("\n");
		preambleParts.push(`PARTICIPANTS:\n${participantList}`);
	}

	if (session.topicsDiscussed && session.topicsDiscussed.length > 0) {
		const topicsList = session.topicsDiscussed
			.map((t) => {
				const pts = t.keyPoints.map((p) => `  - ${p}`).join("\n");
				const dec = t.decision ? `  → Decision: ${t.decision}` : "  → Unresolved";
				return `• ${t.topic}\n${pts}\n${dec}`;
			})
			.join("\n");
		preambleParts.push(`TOPICS DISCUSSED:\n${topicsList}`);
	}

	if (session.decisionsReached && session.decisionsReached.length > 0) {
		preambleParts.push(`DECISIONS REACHED:\n${session.decisionsReached.map((d) => `• ${d}`).join("\n")}`);
	}

	if (session.openQuestions && session.openQuestions.length > 0) {
		preambleParts.push(`OPEN QUESTIONS:\n${session.openQuestions.map((q) => `• ${q}`).join("\n")}`);
	}

	if (session.actionItems && session.actionItems.length > 0) {
		const itemList = session.actionItems
			.map((a) => {
				const dl = a.deadline ? ` [by: ${a.deadline}]` : "";
				return `• [${a.priority.toUpperCase()}] ${a.text} — ${a.assignedTo}${dl} (${a.category})`;
			})
			.join("\n");
		preambleParts.push(`ACTION ITEMS:\n${itemList}`);
	}

	if (session.userNote) {
		preambleParts.push(`USER CONTEXT:\n${session.userNote}`);
	}

	const preamble = preambleParts.length > 0
		? `MEETING ANALYSIS (pre-computed):\n${"═".repeat(50)}\n${preambleParts.join("\n\n")}\n${"═".repeat(50)}\n\n`
		: "";

	return `You are a focused, intelligent assistant for the recorded session titled "${session.title}".
You have two knowledge sources: (1) pre-computed meeting analysis, and (2) the full timestamped transcript below.
Use both to answer questions with maximum precision and depth.

${preamble}STRICT RULES:
1. Base ALL responses on the transcript and the pre-computed analysis above. This is your sole knowledge source.
2. If asked about something not present, say: "That isn't covered in this session."
3. EXCEPTION: When the user explicitly asks for outside context ("from your own knowledge", "outside this session", "general context", "broader field"), you may draw on your training. Prefix that section with "Outside context:" so it's clearly distinguished.
4. When answering questions about what was said, quote or closely paraphrase the transcript and cite the timestamp and speaker.
5. For action items or decisions: refer to the pre-computed analysis above, but also check the transcript for nuances.
6. Compare speaker positions, trace how a topic evolved, identify contradictions, highlight what was left unsaid — this is encouraged.
7. Refer to speakers by their label (Speaker 1, etc.) unless names were mentioned in the session.
8. Be thorough. Provide detailed, structured answers. Use markdown headings and bullet lists when it helps clarity.
9. For "summarize this meeting" queries, produce a structured response with: Overview → Topics → Decisions → Open Questions → Action Items.

FULL TRANSCRIPT OF "${session.title}":
${"─".repeat(50)}
${transcriptText}
${"─".repeat(50)}`;
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

		const session = await mongoFindMeetById(userId, id);
		if (!session) return errorResponse("Session not found", 404);

		if (session.status !== "ready" || !session.transcript?.length) {
			return errorResponse("Session transcript is not available", 400);
		}

		const body = (await request.json()) as RequestBody;
		if (!Array.isArray(body.messages)) {
			return errorResponse("'messages' must be an array", 400);
		}

		const messages: ChatMessage[] = (body.messages as unknown[])
			.filter((m): m is ChatMessage => {
				if (typeof m !== "object" || m === null) return false;
				const msg = m as Record<string, unknown>;
				return (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string";
			})
			.slice(-20);

		if (messages.length === 0) {
			return errorResponse("No valid messages provided", 400);
		}

		const systemPrompt = buildSystemPrompt(session);

		const reply =
			(await callGroqChat(
				[
					{ role: "system", content: systemPrompt },
					...messages.map((m) => ({ role: m.role, content: m.content })),
				],
				{ temperature: 0.25, maxTokens: 4096 }
			)) ?? "";

		if (!reply) return errorResponse("GROQ_API_KEY is not configured or AI returned empty", 503);

		return NextResponse.json({ reply }, { status: 200 });
	} catch (err) {
		console.error("POST /api/meets/[id]/converse failed", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Internal server error" },
			{ status: 500 }
		);
	}
}
