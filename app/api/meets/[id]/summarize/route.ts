import { NextResponse } from "next/server";
import { callGroqChat } from "@/lib/groq-chat-client";
import type {
	MeetSession,
	MeetParticipant,
	ActionItem,
	TopicDiscussed,
	TranscriptUtterance,
} from "@/lib/meet-types";
import { mongoFindMeetById, mongoUpsertMeet } from "@/lib/mongo-app-data";
import { getSessionUserId } from "@/lib/auth";
import { buildChunkIndex } from "@/lib/chunk-store";

/** Summarizes one meeting: GPT-OSS JSON analysis first, then a lightweight transcript-based fallback. */

function errorResponse(message: string, status: number) {
	return NextResponse.json({ error: message }, { status });
}

function formatTranscript(transcript: TranscriptUtterance[]): string {
	return transcript
		.map((u) => {
			const mins = Math.floor(u.start / 60);
			const secs = Math.floor(u.start % 60);
			const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
			return `[${ts}] ${u.speaker}: ${u.text}`;
		})
		.join("\n");
}

/** For very long transcripts, build a condensed version that samples evenly. */
function buildTranscriptBlock(transcript: TranscriptUtterance[], maxChars = 28_000): string {
	const full = formatTranscript(transcript);
	if (full.length <= maxChars) return full;

	// Evenly sample utterances so we keep beginning, middle and end
	const step = Math.ceil(transcript.length / Math.floor(maxChars / 120));
	const sampled = transcript.filter((_, i) => i % step === 0);
	const sampledText = formatTranscript(sampled);
	return `[Note: transcript condensed to ~${sampled.length} of ${transcript.length} utterances for length]\n\n${sampledText}`;
}

interface SpeakerStats {
	utterances: number;
	words: number;
	texts: string[];
}

function buildSpeakerStats(transcript: TranscriptUtterance[]): Map<string, SpeakerStats> {
	const stats = new Map<string, SpeakerStats>();
	for (const u of transcript) {
		const s = stats.get(u.speaker) ?? { utterances: 0, words: 0, texts: [] };
		s.utterances++;
		s.words += u.text.trim().split(/\s+/).length;
		if (u.text.trim().length > 15) s.texts.push(u.text.trim());
		stats.set(u.speaker, s);
	}
	return stats;
}

/** Single system prompt: model must return one JSON object with structured meeting fields. */
const MEETING_ANALYSIS_SYSTEM_PROMPT = `You are an expert meeting intelligence analyst and professional note-taker.
Your goal: produce a comprehensive, accurate, structured analysis that lets someone who was NOT present fully understand what happened, what was decided, and what needs to happen next.

TRANSCRIPT FORMAT: Lines are [MM:SS] SpeakerLabel: utterance text.

OUTPUT: Respond ONLY with a single valid JSON object — no markdown fences, no extra text.

JSON SCHEMA (all fields required unless marked optional):
{
  "sessionType": "specific descriptive label (e.g. 'cross-team sprint review', 'university lecture on ML', 'client discovery call', 'technical interview', 'one-on-one catch-up')",

  "participants": [
    {
      "speakerLabel": "Speaker N",
      "speakerName": "inferred first+last name, or null if not mentioned",
      "role": "precise role description including their stance/expertise (e.g. 'engineering lead pushing for microservices refactor', 'student asking clarifying questions about gradient descent')",
      "participationLevel": "active | moderate | passive"
    }
  ],

  "userSpeaker": "Speaker N, or null if the user (see userName field) cannot be identified",
  "userNote": "2-3 sentences: user's role, specific contributions, tone, and stance in this session. Be precise — quote or paraphrase their actual statements. If user is passive (attending a lecture), say so explicitly.",

  "executiveSummary": "2-3 sentences: what this session was about and what the key outcome was. Should be usable as a standalone description.",

  "topicsDiscussed": [
    {
      "topic": "concise topic name",
      "keyPoints": [
        "specific point raised, with speaker attribution if important",
        "counterpoint or alternative view if raised",
        "any data, numbers, tool names, or specifics mentioned"
      ],
      "decision": "the conclusion or decision reached on this topic, or null if unresolved"
    }
  ],

  "decisionsReached": [
    "Specific, unambiguous decision that was explicitly agreed upon — include who proposed it and any conditions"
  ],

  "openQuestions": [
    "Question or issue that was raised but NOT resolved — include who raised it"
  ],

  "summary": "Comprehensive multi-paragraph prose summary. Requirements: (a) cover EVERY topic and discussion thread; (b) capture specific details — numbers, names, dates, tools, technologies, proposals; (c) note key decisions and how they were reached (consensus vs disagreement); (d) record important unanswered questions; (e) highlight any tension or differing opinions; (f) describe the overall arc of the session; (g) write in professional prose, multiple substantial paragraphs — NOT bullets; (h) detailed enough that an absent person fully understands everything discussed.",

  "actionItems": [
    {
      "id": "unique string like 'ai-1'",
      "text": "Verb-first specific task description (e.g. 'Send the Q3 budget proposal to the finance team by Friday')",
      "assignedTo": "Speaker N | 'the team' | specific name if mentioned",
      "priority": "high | medium | low",
      "deadline": "specific date or relative deadline mentioned (e.g. 'end of week', '2026-04-10'), or null",
      "category": "user (if assigned to or expected of the user specifically) | general (team/project commitment)",
      "done": false
    }
  ]
}

ACTION ITEM RULES (critical for quality):
1. Extract EVERY commitment, task, follow-up, and obligation — even implicit ones.
2. Each item must start with a verb: Review, Send, Schedule, Implement, Write, Follow up, etc.
3. Assign each item to the speaker who committed to it or whom it was assigned to. Use 'the team' for collective commitments.
4. Priority: high = mentioned as urgent/critical/ASAP or has a near deadline; medium = clear task with reasonable deadline; low = suggestion, 'maybe', or backlog item.
5. Capture deadlines verbatim from the transcript (e.g. 'by next Monday', 'before the demo', 'end of sprint').
6. Do NOT duplicate items. Merge near-identical commitments into one precise item.
7. Minimum: extract ALL high and medium priority items — do not truncate.

TOPIC EXTRACTION RULES:
1. Create one entry per distinct discussion thread (not per utterance).
2. keyPoints: 3-6 specific points per topic — include actual data, names, technologies mentioned.
3. decision: null only if genuinely unresolved. If partially resolved, describe what was agreed.

QUALITY STANDARDS:
- The summary field should be 400-1200 words for a typical meeting.
- topicsDiscussed should have 3-10 entries depending on meeting length.
- decisionsReached should have at least 1 entry unless it was purely informational.
- openQuestions should capture genuinely unresolved items.`;

interface AnalysisResult {
	sessionType: string;
	participants: MeetParticipant[];
	userSpeaker: string | null;
	userNote: string;
	executiveSummary: string;
	topicsDiscussed: TopicDiscussed[];
	decisionsReached: string[];
	openQuestions: string[];
	summary: string;
	actionItems: ActionItem[];
}

interface MeetingAnalysisJson {
	sessionType?: string;
	participants?: Array<{
		speakerLabel?: string;
		speakerName?: string | null;
		role?: string;
		participationLevel?: string;
	}>;
	userSpeaker?: string | null;
	userNote?: string;
	executiveSummary?: string;
	topicsDiscussed?: Array<{
		topic?: string;
		keyPoints?: unknown[];
		decision?: string | null;
	}>;
	decisionsReached?: unknown[];
	openQuestions?: unknown[];
	summary?: string;
	actionItems?: Array<{
		id?: string;
		text?: string;
		assignedTo?: string;
		priority?: string;
		deadline?: string | null;
		category?: string;
		done?: boolean;
	}>;
}

function toStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

async function analyzeMeetingWithLlm(session: MeetSession): Promise<AnalysisResult | null> {
	const durationMins = Math.round((session.duration || 0) / 60);
	const transcriptBlock = buildTranscriptBlock(session.transcript);

	const userContent = [
		`Session title: ${session.title}`,
		`Duration: approximately ${durationMins} minutes`,
		`User's name: ${session.userName || "Not specified"}`,
		`Deepgram auto-summary (use as hint only, do not copy verbatim): ${session.deepgramSummary || "Not available"}`,
		"",
		"FULL TRANSCRIPT:",
		transcriptBlock,
	].join("\n");

	const rawContent = await callGroqChat(
		[
			{ role: "system", content: MEETING_ANALYSIS_SYSTEM_PROMPT },
			{ role: "user", content: userContent },
		],
		{ temperature: 0.15, maxTokens: 8192, jsonMode: true }
	);

	if (!rawContent) return null;

	const cleaned = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	const parsed = JSON.parse(cleaned) as MeetingAnalysisJson;

	const participants: MeetParticipant[] = (parsed.participants ?? []).map((p) => ({
		speakerLabel: typeof p.speakerLabel === "string" ? p.speakerLabel : "Unknown",
		speakerName: typeof p.speakerName === "string" ? p.speakerName : null,
		role: typeof p.role === "string" ? p.role : "participant",
		participationLevel: (["active", "moderate", "passive"].includes(p.participationLevel ?? "")
			? p.participationLevel
			: "moderate") as "active" | "moderate" | "passive",
	}));

	const actionItems: ActionItem[] = (parsed.actionItems ?? []).map((a, idx) => ({
		id: typeof a.id === "string" && a.id ? a.id : `ai-${Date.now()}-${idx}`,
		text: typeof a.text === "string" ? a.text : "Action item",
		assignedTo: typeof a.assignedTo === "string" ? a.assignedTo : "Unknown",
		priority: (["high", "medium", "low"].includes(a.priority ?? "") ? a.priority : "medium") as "high" | "medium" | "low",
		deadline: typeof a.deadline === "string" ? a.deadline : null,
		category: (["user", "general"].includes(a.category ?? "") ? a.category : "general") as "user" | "general",
		done: false,
	}));

	const topicsDiscussed: TopicDiscussed[] = (parsed.topicsDiscussed ?? []).map((t) => ({
		topic: typeof t.topic === "string" ? t.topic : "Topic",
		keyPoints: toStringArray(t.keyPoints),
		decision: typeof t.decision === "string" ? t.decision : null,
	}));

	return {
		sessionType: typeof parsed.sessionType === "string" ? parsed.sessionType : "meeting",
		participants,
		userSpeaker: typeof parsed.userSpeaker === "string" ? parsed.userSpeaker : null,
		userNote: typeof parsed.userNote === "string" ? parsed.userNote : "Your role could not be determined.",
		executiveSummary: typeof parsed.executiveSummary === "string" ? parsed.executiveSummary : "",
		topicsDiscussed,
		decisionsReached: toStringArray(parsed.decisionsReached),
		openQuestions: toStringArray(parsed.openQuestions),
		summary: typeof parsed.summary === "string" ? parsed.summary : "Summary not available.",
		actionItems,
	};
}

function buildFallbackAnalysis(session: MeetSession): AnalysisResult {
	const { transcript, userName, title, deepgramSummary, duration } = session;

	const stats = buildSpeakerStats(transcript);
	const sortedSpeakers = [...stats.entries()].sort((a, b) => b[1].words - a[1].words);
	const totalWords = sortedSpeakers.reduce((sum, [, s]) => sum + s.words, 0);

	let sessionType = "general conversation";
	if (sortedSpeakers.length <= 1) sessionType = "monologue or lecture";
	else if (sortedSpeakers.length === 2) {
		const ratio = (sortedSpeakers[0]?.[1].words ?? 0) / ((sortedSpeakers[1]?.[1].words ?? 0) || 1);
		if (ratio > 4) sessionType = "lecture or presentation";
		else if (ratio > 2) sessionType = "interview or Q&A";
		else sessionType = "one-on-one meeting";
	} else {
		sessionType = "group meeting";
	}

	const participants: MeetParticipant[] = sortedSpeakers.map(([speaker, s], idx) => {
		const ratio = s.words / (totalWords || 1);
		const level: "active" | "moderate" | "passive" = ratio > 0.5 ? "active" : ratio > 0.15 ? "moderate" : "passive";
		let role = "participant";
		if (idx === 0 && sessionType.includes("lecture")) role = "lecturer / presenter";
		else if (idx === 0 && sessionType.includes("interview")) role = "interviewer";
		else if (idx === 1 && sessionType.includes("interview")) role = "interviewee";
		return { speakerLabel: speaker, speakerName: null, role, participationLevel: level };
	});

	let userSpeaker: string | null = null;
	let userNote = "Your role in this session could not be automatically determined. Please review the transcript.";
	if (userName) {
		const firstName = userName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
		for (const [speaker, s] of stats) {
			if (s.texts.some((t) => firstName && t.toLowerCase().includes(firstName))) {
				userSpeaker = speaker;
				break;
			}
		}
		if (userSpeaker) {
			const p = participants.find((p) => p.speakerLabel === userSpeaker);
			userNote = `${userName} appears to be ${userSpeaker} (${p?.role ?? "participant"}) in this session.`;
		}
	}

	// Simple regex-based action item extraction
	const actionPatterns: { re: RegExp; priority: "high" | "medium" | "low" }[] = [
		{ re: /\b(?:action item|todo|next step|follow.?up)[:\s]+([^.!?]{10,200})/gi, priority: "high" },
		{ re: /\b(?:we|i|you)\s+(?:will|shall|need to|am going to|have to|must)\s+([^.!?,]{10,160})/gi, priority: "medium" },
		{ re: /\b(?:by|before|until)\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|eod|eow)\b([^.!?]{0,100})/gi, priority: "high" },
		{ re: /\b(?:deadline|due by)[:\s]+([^.!?]{5,120})/gi, priority: "high" },
		{ re: /\b(?:let['']?s|please|make sure)\s+([^.!?,]{10,140})/gi, priority: "medium" },
	];
	const actionItems: ActionItem[] = [];
	const seen = new Set<string>();
	for (const u of transcript) {
		for (const { re, priority } of actionPatterns) {
			re.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = re.exec(u.text)) !== null && actionItems.length < 20) {
				const captured = (match[1] ?? match[0]).trim();
				const norm = captured.toLowerCase().replace(/\s+/g, " ");
				if (captured.length >= 10 && !seen.has(norm)) {
					seen.add(norm);
					actionItems.push({
						id: `fb-${Date.now()}-${actionItems.length}`,
						text: captured.charAt(0).toUpperCase() + captured.slice(1),
						assignedTo: u.speaker,
						priority: /urgent|asap|immediately|critical|today/i.test(u.text) ? "high" : priority,
						deadline: null,
						category: userSpeaker && u.speaker === userSpeaker ? "user" : "general",
						done: false,
					});
				}
			}
		}
	}

	const minutes = Math.round((duration || 0) / 60);
	const fullText = transcript.map((u) => u.text).join(" ");
	const sentences = (fullText.match(/[^.!?]+[.!?]+/g) ?? []).filter((s) => s.length > 40 && s.length < 400);
	const step = Math.max(1, Math.floor(sentences.length / 8));
	const sampled = sentences.filter((_, i) => i % step === 0).slice(0, 8);

	const executiveSummary = deepgramSummary
		? deepgramSummary
		: `This ${sessionType} titled "${title}" ran for approximately ${minutes} minute${minutes !== 1 ? "s" : ""} and involved ${sortedSpeakers.length} participant${sortedSpeakers.length !== 1 ? "s" : ""}.`;

	const summaryParts: string[] = [
		`This ${sessionType} titled "${title}" ran for approximately ${minutes} minute${minutes !== 1 ? "s" : ""} and involved ${sortedSpeakers.length} participant${sortedSpeakers.length !== 1 ? "s" : ""}. ${deepgramSummary ?? ""}`,
		sampled.length > 0 ? "Key points from the session: " + sampled.join(" ") : "",
		`Participation: ${participants.map((p) => `${p.speakerLabel} was ${p.participationLevel} as ${p.role}${p.speakerLabel === userSpeaker ? " (this is you)" : ""}`).join("; ")}.`,
		actionItems.length > 0 ? `${actionItems.length} action item${actionItems.length !== 1 ? "s" : ""} were identified. Review the Action Items tab for the full list.` : "",
	].filter(Boolean);

	return {
		sessionType,
		participants,
		userSpeaker,
		userNote,
		executiveSummary,
		topicsDiscussed: [],
		decisionsReached: [],
		openQuestions: [],
		summary: summaryParts.join("\n\n"),
		actionItems,
	};
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
		if (session.status !== "ready") return errorResponse("Session must be in 'ready' state", 400);
		if (!session.transcript || session.transcript.length === 0) return errorResponse("No transcript available", 400);

		let analysis: AnalysisResult;
		try {
			const llmResult = await analyzeMeetingWithLlm(session);
			analysis = llmResult ?? buildFallbackAnalysis(session);
		} catch (aiError) {
			console.warn("Meeting LLM analysis failed, using fallback:", aiError);
			analysis = buildFallbackAnalysis(session);
		}

		session.summary = analysis.summary;
		session.executiveSummary = analysis.executiveSummary || null;
		session.topicsDiscussed = analysis.topicsDiscussed.length > 0 ? analysis.topicsDiscussed : null;
		session.decisionsReached = analysis.decisionsReached.length > 0 ? analysis.decisionsReached : null;
		session.openQuestions = analysis.openQuestions.length > 0 ? analysis.openQuestions : null;
		session.sessionType = analysis.sessionType;
		session.participants = analysis.participants;
		session.userSpeaker = analysis.userSpeaker;
		session.userNote = analysis.userNote;
		session.actionItems = analysis.actionItems;
		session.summaryGeneratedAt = new Date().toISOString();
		session.updatedAt = new Date().toISOString();

		await mongoUpsertMeet(userId, session);
		// Rebuild RAG index so the meeting summary, action items, and transcript
		// are immediately searchable in Converse without a manual re-index.
		await buildChunkIndex(userId);
		return NextResponse.json({ data: session }, { status: 200 });
	} catch (err) {
		console.error("POST /api/meets/[id]/summarize failed", err);
		return errorResponse("Failed to generate summary", 500);
	}
}
