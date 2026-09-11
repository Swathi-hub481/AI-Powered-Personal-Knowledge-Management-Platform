/**
 * HTML normalisation: boilerplate removal + plain-text extraction.
 *
 * IMPORTANT: jsdom and @mozilla/readability are loaded with dynamic `import()`
 * inside the async function body. A static top-level import causes webpack to
 * evaluate them during bundle compilation, where __dirname inside jsdom resolves
 * to the .next/dev/ output folder instead of node_modules/jsdom/, making Node
 * unable to find jsdom's own default-stylesheet.css.
 *
 * isomorphic-dompurify has the same problem (it statically requires jsdom in
 * Node.js), so we skip it entirely and do tag stripping with regex — which is
 * sufficient here because we only ever need plain text output.
 */

export interface HtmlNormalizeResult {
	text: string
	title: string | null
	byline: string | null
	excerpt: string | null
	boilerplateRemoved: boolean
}

export async function normalizeHtml(rawHtml: string, urlHint?: string): Promise<HtmlNormalizeResult> {
	// Dynamic imports — Node.js resolves __dirname correctly at runtime.
	const { JSDOM } = (await import("jsdom")) as typeof import("jsdom")
	const { Readability } = (await import("@mozilla/readability")) as typeof import("@mozilla/readability")

	const dom = new JSDOM(rawHtml, { url: urlHint || "https://local.document" })
	const doc = dom.window.document

	try {
		const reader = new Readability(doc)
		const article = reader.parse()

		if (article?.textContent && article.textContent.trim().length > 80) {
			return {
				text: collapseWhitespace(article.textContent),
				title: article.title ?? null,
				byline: article.byline ?? null,
				excerpt: article.excerpt ?? null,
				boilerplateRemoved: true,
			}
		}
	} catch {
		// fall through to raw body extraction
	}

	// Fallback: strip tags with regex — adequate for plain-text extraction.
	const body = doc.body?.innerHTML ?? rawHtml
	const text = collapseWhitespace(
		body
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<[^>]+>/g, " ")
	)

	return {
		text,
		title: null,
		byline: null,
		excerpt: null,
		boilerplateRemoved: false,
	}
}

function collapseWhitespace(s: string) {
	return s.replace(/\s+/g, " ").trim()
}
