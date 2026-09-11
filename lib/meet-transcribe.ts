/**
 * Deepgram transcription for meeting audio uploads.
 */

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? ""

const DEEPGRAM_PARAMS = new URLSearchParams({
	model: "nova-3",           // Latest Deepgram model — lower WER than nova-2
	diarize: "true",           // Speaker attribution
	smart_format: "true",      // Formats numbers, dates, punctuation
	punctuate: "true",
	utterances: "true",        // Required for speaker-segmented output
	paragraphs: "true",        // Groups utterances into paragraphs
	summarize: "v2",           // Deepgram abstractive summary (used as fallback)
	entities: "true",          // People, places, orgs detected inline (replaces deprecated detect_entities)
	topics: "true",            // Main topics extraction (replaces deprecated detect_topics)
	sentiment: "true",         // Tone per utterance
})

export interface TranscriptUtterance {
	speaker: string
	start: number
	end: number
	text: string
}

interface DeepgramUtterance {
	start: number
	end: number
	transcript: string
	speaker: number
	channel?: number
}

interface DeepgramMetadata {
	duration?: number
}

interface DeepgramResult {
	metadata?: DeepgramMetadata
	results?: {
		utterances?: DeepgramUtterance[]
		summary?: {
			result?: string
			short?: string
		}
	}
	error?: string
	message?: string
}

export async function transcribeWithDeepgram(
	buffer: Buffer,
	mimeType: string
): Promise<{ utterances: TranscriptUtterance[]; duration: number; summary: string | null }> {
	if (!DEEPGRAM_API_KEY) {
		throw new Error("DEEPGRAM_API_KEY is not configured")
	}

	const url = `https://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${DEEPGRAM_API_KEY}`,
			"Content-Type": mimeType,
		},
		body: new Uint8Array(buffer),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Deepgram API error (${response.status}): ${text.slice(0, 300)}`)
	}

	const data = (await response.json()) as DeepgramResult

	if (data.error) {
		throw new Error(`Deepgram returned error: ${data.error} – ${data.message ?? ""}`)
	}

	const utterances: TranscriptUtterance[] = (data.results?.utterances ?? []).map((u) => ({
		speaker: `Speaker ${u.speaker + 1}`,
		start: u.start,
		end: u.end,
		text: u.transcript.trim(),
	}))

	const duration = data.metadata?.duration ?? 0
	const deepgramSummary = data.results?.summary?.short ?? null

	return { utterances, duration, summary: deepgramSummary }
}

export function getMimeTypeForMeet(fileName: string, fallbackMime: string): string {
	const ext = fileName.split(".").pop()?.toLowerCase()
	const map: Record<string, string> = {
		mp3: "audio/mpeg",
		mp4: "video/mp4",
		m4a: "audio/mp4",
		wav: "audio/wav",
		webm: "audio/webm",
		ogg: "audio/ogg",
		flac: "audio/flac",
		aac: "audio/aac",
		opus: "audio/opus",
	}
	return (ext && map[ext]) || fallbackMime || "audio/mpeg"
}
