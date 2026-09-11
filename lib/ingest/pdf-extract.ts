/**
 * PDF text extraction (digital PDFs). Scanned PDFs may yield little text — caller should OCR.
 */

export interface PdfExtractResult {
	text: string
	titleGuess: string | null
	pageCount: number
	/** True when extracted text is too short per page — likely scanned */
	likelyScanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
	const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{
		text: string
		numpages: number
		info?: Record<string, unknown>
	}>
	const data = await pdfParse(buffer)
	const text = (data.text || "").replace(/\s+/g, " ").trim()
	const pageCount = data.numpages || 1
	const perPage = text.length / Math.max(pageCount, 1)
	const likelyScanned = perPage < 80 && pageCount > 0

	let titleGuess: string | null = null
	const info = data.info as Record<string, unknown> | undefined
	if (info && typeof info.Title === "string" && info.Title.trim()) {
		titleGuess = String(info.Title).trim()
	}

	return {
		text,
		titleGuess,
		pageCount,
		likelyScanned,
	}
}
