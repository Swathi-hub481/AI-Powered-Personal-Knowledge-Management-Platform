/**
 * Shared meet session types (used by API routes and Mongo persistence).
 */

export interface TranscriptUtterance {
	speaker: string
	start: number
	end: number
	text: string
}

export interface MeetParticipant {
	speakerLabel: string
	speakerName: string | null
	role: string
	participationLevel: "active" | "moderate" | "passive"
}

export interface ActionItem {
	id: string
	text: string
	assignedTo: string
	priority: "high" | "medium" | "low"
	category: "user" | "general"
	done: boolean
	deadline?: string | null
}

/** One discussion thread — a topic raised, what was said, and whether a decision was reached. */
export interface TopicDiscussed {
	topic: string
	keyPoints: string[]
	decision: string | null
}

export interface MeetSession {
	id: string
	title: string
	userName: string
	type: "upload" | "recording"
	status: "transcribing" | "ready" | "error"
	fileName: string
	fileSize: number
	createdAt: string
	updatedAt: string
	duration: number
	transcript: TranscriptUtterance[]
	deepgramSummary: string | null
	/** Full narrative summary (may be multi-paragraph prose). */
	summary: string | null
	/** One-to-three sentence "at a glance" executive summary. */
	executiveSummary?: string | null
	/** Structured discussion threads extracted by the AI. */
	topicsDiscussed?: TopicDiscussed[] | null
	/** Explicit decisions that were definitively reached. */
	decisionsReached?: string[] | null
	/** Questions raised but not resolved. */
	openQuestions?: string[] | null
	sessionType: string | null
	participants: MeetParticipant[] | null
	userSpeaker: string | null
	userNote: string | null
	actionItems: ActionItem[] | null
	summaryGeneratedAt: string | null
	error: string | null
	source?: "upload" | "google-drive"
}
