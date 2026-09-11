/**
 * OCR fallback for images / scanned content — Tesseract.js (local, no cloud OCR).
 */

import Tesseract from "tesseract.js"

export async function ocrImageBuffer(buffer: Buffer, lang = "eng"): Promise<{ text: string }> {
	const result = await Tesseract.recognize(buffer, lang, {
		logger: () => undefined,
	})
	const text = (result.data.text || "").replace(/\s+/g, " ").trim()
	return { text }
}
