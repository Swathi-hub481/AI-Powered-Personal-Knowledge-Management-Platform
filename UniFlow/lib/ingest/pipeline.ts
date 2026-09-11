/**
 * Formal ingest pipeline: normalise → extract → chunk → contextual (optional) → persist.
 */

import crypto from "node:crypto"
import { extractPdfText } from "./pdf-extract"
import { normalizeHtml } from "./normalize-html"
import { ocrImageBuffer } from "./ocr-image"
import { extractKnowledgeSignals } from "../document-extract"
import { generateContextualPrefixesBatch } from "../contextual-prefix"
import type { StoredDocument, DocumentIngestMeta } from "../document-store"
import { upsertDocument } from "../document-store"
import { splitIntoChunks } from "../chunk-utils"
import { persistIngestedChunks } from "../mongo-knowledge"
import { embedTextForRetrieval } from "../embedding-hash"

export type IngestKind = "pdf" | "html" | "image" | "text"

export interface IngestInput {
	userId: string
	buffer: Buffer
	kind: IngestKind
	mimeType: string
	title: string
	tags: string[]
	/** For HTML: original URL helps Readability */
	sourceUrl?: string
}

export interface IngestResult {
	document: StoredDocument
	chunkCount: number
}

function makeId(): string {
	return `doc-${crypto.randomBytes(8).toString("hex")}`
}

export async function runIngestPipeline(input: IngestInput): Promise<IngestResult> {
	const now = new Date().toISOString()
	const id = makeId()

	let rawText = ""
	let ocrUsed = false
	let htmlCleaned = false
	let normalizeStage = "raw"

	let pdfTitleGuess: string | null = null
	let htmlTitleGuess: string | null = null
	if (input.kind === "pdf") {
		const pdf = await extractPdfText(input.buffer)
		rawText = pdf.text
		pdfTitleGuess = pdf.titleGuess
		normalizeStage = "pdf-parse"
		if (pdf.likelyScanned && rawText.length < 200) {
			ocrUsed = true
			rawText =
				rawText.length > 0
					? rawText
					: "[Scanned PDF: text layer empty or minimal. Please upload page images for OCR, or use a digital PDF.]"
		}
	} else if (input.kind === "html") {
		const html = input.buffer.toString("utf-8")
		const norm = await normalizeHtml(html, input.sourceUrl)
		rawText = norm.text
		htmlTitleGuess = norm.title
		htmlCleaned = norm.boilerplateRemoved
		normalizeStage = norm.boilerplateRemoved ? "readability+sanitize" : "sanitize-only"
	} else if (input.kind === "image") {
		const ocr = await ocrImageBuffer(input.buffer)
		rawText = ocr.text
		ocrUsed = true
		normalizeStage = "tesseract"
	} else {
		rawText = input.buffer.toString("utf-8")
		normalizeStage = "utf-8"
	}

	const title =
		input.title.trim() || htmlTitleGuess || pdfTitleGuess || "Untitled document"

	let extraction: Awaited<ReturnType<typeof extractKnowledgeSignals>> = null
	if (rawText.length > 50 && process.env.GROQ_API_KEY) {
		extraction = await extractKnowledgeSignals(rawText, title)
	}

	const ingestMeta: DocumentIngestMeta = {
		ocrUsed,
		htmlCleaned,
		normalizeStage,
		entities: extraction?.entities,
		keywords: extraction?.keywords,
		actionItems: extraction?.actionItems,
	}

	const doc: StoredDocument = {
		id,
		userId: input.userId,
		title,
		kind: input.kind,
		mimeType: input.mimeType,
		content: rawText,
		tags: input.tags,
		createdAt: now,
		updatedAt: now,
		ingest: ingestMeta,
	}

	await upsertDocument(doc)

	const textChunks = splitIntoChunks(rawText)
	const batchItems = textChunks.map((snippet, idx) => ({
		id: `${id}#${idx}`,
		sourceType: "document",
		title,
		snippet,
		tags: input.tags,
	}))

	let contextualMap = new Map<string, string>()
	if (process.env.GROQ_API_KEY && batchItems.length > 0) {
		// Batch in groups of 6
		for (let i = 0; i < batchItems.length; i += 6) {
			const slice = batchItems.slice(i, i + 6)
			const part = await generateContextualPrefixesBatch(slice)
			part.forEach((v, k) => contextualMap.set(k, v))
		}
	}

	await persistIngestedChunks({
		userId: input.userId,
		documentId: id,
		title,
		tags: input.tags,
		chunks: textChunks.map((text, idx) => {
			const cid = `${id}#${idx}`
			const ctx = contextualMap.get(cid) ?? `[Document: ${title} | Type: uploaded | Tags: ${input.tags.join(", ") || "General"}]`
			const embedInput = `${ctx}\n${text}`
			return {
				chunkId: cid,
				text,
				contextualLine: ctx,
				embedding: embedTextForRetrieval(embedInput),
				createdAt: now,
			}
		}),
		documentMeta: doc,
	})

	return { document: doc, chunkCount: textChunks.length }
}
