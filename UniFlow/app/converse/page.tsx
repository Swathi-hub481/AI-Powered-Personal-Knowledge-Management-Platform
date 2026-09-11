"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Send, Sparkles, BookmarkPlus, Shield } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";

interface Highlight {
	id: string;
	text: string;
	url: string;
	title: string;
	createdAt: string;
	isActive: boolean;
}

interface HighlightsResponse {
	data: Highlight[];
}

interface CitationItem {
	sourceType: string;
	sourceId?: string;
	title: string;
	url?: string;
	/** For retrieval learning (Mongo feedback boosts) */
	chunkId?: string;
}

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	format?: "text" | "html";
	citations?: CitationItem[];
	/** User query that produced this RAG answer (for source feedback) */
	ragQuery?: string;
}

type ScopePreset = "all" | "notes" | "highlights" | "documents" | "meetings" | "meeting" | "conversations";

interface MeetListItem {
	id: string;
	title: string;
	status: string;
}

type GraphLayoutPreference = "compact" | "expanded";
type GraphThemePreference = "forest" | "ink" | "sunset";

const defaultPrompts = [
	"Summarize my latest notes",
	"What are the key action items from my highlights?",
	"Turn this topic into a study plan",
	"Generate a quick revision checklist",
];

const activeHighlightSuggestions = [
	"Summarize this highlight",
	"Explain this concept",
	"Knowledge graphs",
	"Generate questions from this",
	"Create flashcards from this",
];

function normalizeWhitespace(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function splitIntoSentences(value: string) {
	const normalized = normalizeWhitespace(value);
	if (!normalized) {
		return [] as string[];
	}

	const sentenceMatches = normalized.match(/[^.!?]+[.!?]?/g);
	if (!sentenceMatches) {
		return [normalized];
	}

	return sentenceMatches
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 0);
}

function truncateAtWordBoundary(value: string, maxLength: number) {
	if (value.length <= maxLength) {
		return value;
	}

	const trimmed = value.slice(0, maxLength);
	const lastSpaceIndex = trimmed.lastIndexOf(" ");
	const clipped = (lastSpaceIndex > 40 ? trimmed.slice(0, lastSpaceIndex) : trimmed).trim();

	return `${clipped}...`;
}

function toSimplePoint(sentence: string) {
	const withoutParentheses = sentence.replace(/\([^)]*\)/g, " ");
	const cleaned = normalizeWhitespace(withoutParentheses.replace(/[;:]/g, ",").replace(/["“”]/g, ""));

	if (!cleaned) {
		return "";
	}

	const base = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	return truncateAtWordBoundary(base, 120);
}

function extractKeyTerms(highlightText: string) {
	const stopWords = new Set([
		"the",
		"and",
		"for",
		"with",
		"that",
		"this",
		"from",
		"into",
		"your",
		"their",
		"have",
		"been",
		"were",
		"about",
		"there",
		"which",
		"when",
		"what",
		"where",
		"while",
		"than",
		"then",
		"also",
		"because",
		"between",
		"through",
		"using",
		"used",
	]);

	const words = normalizeWhitespace(highlightText)
		.toLowerCase()
		.match(/[a-z][a-z0-9-]{3,}/g);

	if (!words) {
		return [] as string[];
	}

	const frequencies = new Map<string, number>();

	for (const word of words) {
		if (stopWords.has(word)) {
			continue;
		}

		frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
	}

	return [...frequencies.entries()]
		.sort((left, right) => right[1] - left[1])
		.slice(0, 4)
		.map(([term]) => term);
}

function toTitleCase(value: string) {
	return value
		.split(" ")
		.map((word) => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}` : ""))
		.join(" ");
}

function buildAnalogy(topic: string) {
	const cleanTopic = topic.trim() || "the concept";
	return `Think of ${cleanTopic} like learning to ride a bicycle: first you understand the basic idea, then practice each small step, and soon it feels natural.`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function generateHighlightQuizHtml(highlight: Highlight) {
	const sentences = splitIntoSentences(highlight.text).slice(0, 6);
	const keyTerms = extractKeyTerms(highlight.text);
	const topic = keyTerms[0] ? toTitleCase(keyTerms[0]) : toTitleCase(highlight.title || "this topic");
	const mainIdea = truncateAtWordBoundary(toSimplePoint(sentences[0] ?? highlight.text) || highlight.text, 100);
	const supportingIdea = truncateAtWordBoundary(toSimplePoint(sentences[1] ?? sentences[0] ?? highlight.text) || highlight.text, 90);
	const technicalTerm = keyTerms[1] ? toTitleCase(keyTerms[1]) : topic;

	const questions = [
		{
			question: `What is the main focus of this highlighted concept about ${topic}?`,
			options: [
				mainIdea,
				"Memorizing random facts without understanding",
				"Ignoring practical meaning and only learning names",
				"Focusing only on unrelated historical details",
			],
			correctIndex: 0,
		},
		{
			question: "Why is this concept important?",
			options: [
				"It helps apply the idea in real situations",
				"It is only useful for passing one exam",
				"It removes the need to understand basics",
				"It is mainly for memorizing long definitions",
			],
			correctIndex: 0,
		},
		{
			question: `Which sentence best supports the highlighted idea?`,
			options: [
				supportingIdea,
				"A sentence unrelated to the selected highlight",
				"A statement that contradicts the concept",
				"A detail that ignores the main topic",
			],
			correctIndex: 0,
		},
		{
			question: `In this context, what does ${technicalTerm} most likely represent?`,
			options: [
				"A key idea connected to the main concept",
				"An unrelated term with no role here",
				"A temporary note that should be ignored",
				"A replacement for the entire topic",
			],
			correctIndex: 0,
		},
		{
			question: "What is the best way to learn this highlighted concept?",
			options: [
				"Break it into small steps and apply each part",
				"Skip understanding and only memorize terms",
				"Read once and avoid any revision",
				"Focus only on difficult jargon",
			],
			correctIndex: 0,
		},
	];

	const questionCards = questions
		.map((item, questionIndex) => {
			const safeQuestion = escapeHtml(item.question);
			const optionButtons = item.options
				.map((option, optionIndex) => {
					const safeOption = escapeHtml(option);
					return `<button class="option" data-question="${questionIndex}" data-option="${optionIndex}">${safeOption}</button>`;
				})
				.join("");

			return `
<div class="question-card" data-correct="${item.correctIndex}" data-answered="false">
	<h3>Q${questionIndex + 1}. ${safeQuestion}</h3>
	<div class="options">${optionButtons}</div>
	<p class="feedback" aria-live="polite"></p>
</div>`;
		})
		.join("\n");

	const safeTitle = escapeHtml(highlight.title || "Highlighted Topic");

	return `
<style>
	.quiz-root {
		font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
		color: #0f172a;
	}

	.quiz-header {
		text-align: center;
		margin-bottom: 14px;
	}

	.quiz-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.quiz-subtitle {
		margin: 6px 0 0;
		font-size: 0.8rem;
		color: #475569;
	}

	.quiz-container {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}

	.question-card {
		background: linear-gradient(140deg, #bfdbfe 0%, #c4b5fd 48%, #99f6e4 100%);
		border-radius: 16px;
		padding: 14px;
		box-shadow: 0 10px 22px rgba(15, 23, 42, 0.12);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.question-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 14px 26px rgba(15, 23, 42, 0.16);
	}

	.question-card h3 {
		margin: 0 0 10px;
		font-size: 0.92rem;
		line-height: 1.35;
		color: #0f172a;
	}

	.options {
		display: grid;
		gap: 8px;
	}

	.option {
		border: none;
		border-radius: 12px;
		padding: 8px 10px;
		text-align: left;
		background: rgba(255, 255, 255, 0.86);
		color: #0f172a;
		font-size: 0.82rem;
		cursor: pointer;
		transition: transform 0.18s ease, background-color 0.18s ease;
	}

	.option:hover {
		transform: translateY(-1px);
		background: rgba(255, 255, 255, 0.98);
	}

	.option.correct {
		background: #dcfce7;
		color: #14532d;
	}

	.option.wrong {
		background: #fee2e2;
		color: #7f1d1d;
	}

	.option:disabled {
		cursor: default;
		opacity: 1;
	}

	.feedback {
		min-height: 18px;
		margin: 8px 0 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: #0f172a;
	}

	.score-board {
		margin-top: 14px;
		text-align: center;
		border-radius: 14px;
		padding: 10px;
		background: linear-gradient(140deg, #cffafe, #bbf7d0);
		color: #065f46;
		font-weight: 700;
		display: none;
	}

	.quiz-actions {
		margin-top: 10px;
		display: flex;
		justify-content: center;
	}

	.retry-btn {
		border: none;
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 0.8rem;
		font-weight: 600;
		background: linear-gradient(135deg, #bfdbfe, #c4b5fd);
		color: #1e293b;
		cursor: pointer;
		transition: transform 0.18s ease, opacity 0.18s ease;
	}

	.retry-btn:hover {
		transform: translateY(-1px);
		opacity: 0.95;
	}

	@media (max-width: 640px) {
		.quiz-container {
			grid-template-columns: 1fr;
		}
	}
</style>

<div class="quiz-root">
	<div class="quiz-header">
		<p class="quiz-title">Interactive Quiz</p>
		<p class="quiz-subtitle">Topic: ${safeTitle}</p>
	</div>

	<div class="quiz-container">
		${questionCards}
	</div>

	<div id="score-board" class="score-board"></div>
	<div class="quiz-actions">
		<button id="retry-quiz" class="retry-btn" type="button">Retry Quiz</button>
	</div>
</div>

<script>
	const cards = document.querySelectorAll('.question-card');
	const scoreBoard = document.getElementById('score-board');
	const retryButton = document.getElementById('retry-quiz');
	let answeredCount = 0;
	let score = 0;

	const resetQuiz = () => {
		answeredCount = 0;
		score = 0;
		scoreBoard.style.display = 'none';
		scoreBoard.textContent = '';

		cards.forEach((card) => {
			card.dataset.answered = 'false';
			const feedback = card.querySelector('.feedback');
			if (feedback) {
				feedback.textContent = '';
			}

			const options = card.querySelectorAll('.option');
			options.forEach((option) => {
				option.disabled = false;
				option.classList.remove('correct');
				option.classList.remove('wrong');
			});
		});
	};

	cards.forEach((card) => {
		const correctIndex = Number(card.dataset.correct || '0');
		const options = card.querySelectorAll('.option');
		const feedback = card.querySelector('.feedback');

		options.forEach((option) => {
			option.addEventListener('click', () => {
				if (card.dataset.answered === 'true') {
					return;
				}

				const selectedIndex = Number(option.dataset.option || '-1');
				card.dataset.answered = 'true';
				answeredCount += 1;

				options.forEach((candidate, index) => {
					candidate.disabled = true;
					if (index === correctIndex) {
						candidate.classList.add('correct');
					}
				});

				if (selectedIndex === correctIndex) {
					score += 1;
					feedback.textContent = 'âœ… Correct! Great job.';
				} else {
					option.classList.add('wrong');
					feedback.textContent = 'âŒ Not quite. The green option is correct.';
				}

				if (answeredCount === cards.length) {
					scoreBoard.style.display = 'block';
					scoreBoard.textContent = 'Your Score: ' + score + ' / ' + cards.length;
				}
			});
		});
	});

	if (retryButton) {
		retryButton.addEventListener('click', resetQuiz);
	}
</script>
`.trim();
}

function buildKnowledgeGraphData(highlight: Highlight, graphLayout: GraphLayoutPreference) {
	const sentences = splitIntoSentences(highlight.text).slice(0, 6);
	const terms = extractKeyTerms(highlight.text);

	const rawConcepts = [
		toTitleCase(highlight.title || "Main Concept"),
		...terms.map((term) => toTitleCase(term)),
		...sentences
			.map((sentence) => toSimplePoint(sentence))
			.filter((sentence) => sentence.length > 0)
			.map((sentence) => truncateAtWordBoundary(sentence, 36)),
	];

	const uniqueConcepts: string[] = [];
	for (const concept of rawConcepts) {
		const normalized = normalizeWhitespace(concept);
		if (!normalized) {
			continue;
		}

		if (!uniqueConcepts.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
			uniqueConcepts.push(normalized);
		}
	}

	const maxConceptCount = graphLayout === "expanded" ? 10 : 7;
	const minimumConceptCount = graphLayout === "expanded" ? 6 : 5;
	const conceptLabels = uniqueConcepts.slice(0, maxConceptCount);
	while (conceptLabels.length < minimumConceptCount) {
		conceptLabels.push(`Supporting Idea ${conceptLabels.length}`);
	}

	const nodes = conceptLabels.map((label, index) => ({
		id: index + 1,
		label,
	}));

	const relationLabels = ["related to", "supports", "explains", "leads to", "depends on", "applies to"];
	const edges = nodes.slice(0, -1).map((node, index) => ({
		from: node.id,
		to: nodes[index + 1].id,
		label: relationLabels[index % relationLabels.length],
	}));

	if (nodes.length >= 4) {
		edges.push({
			from: 1,
			to: Math.min(4, nodes.length),
			label: "connects to",
		});
	}

	return { nodes, edges };
}

function generateKnowledgeGraphHtml(
	highlight: Highlight,
	graphLayout: GraphLayoutPreference,
	graphTheme: GraphThemePreference
) {
	const graph = buildKnowledgeGraphData(highlight, graphLayout);
	const safeTitle = escapeHtml(highlight.title || "Highlighted Topic");
	const sourceSentences = splitIntoSentences(highlight.text);

	const graphData = {
		nodes: graph.nodes.map((node, index) => {
			const loweredLabel = node.label.toLowerCase();
			const isExampleLike =
				loweredLabel.includes("example") ||
				loweredLabel.includes("application") ||
				loweredLabel.includes("use") ||
				loweredLabel.includes("practice");

			const type =
				index === 0
					? "main"
					: isExampleLike
						? "application"
						: index <= 3
							? "secondary"
							: "supporting";

			const relatedSentence = sourceSentences[index % Math.max(1, sourceSentences.length)] ?? "";
			const tooltip =
				type === "main"
					? `This is the core concept: ${node.label}.`
					: relatedSentence
						? truncateAtWordBoundary(toSimplePoint(relatedSentence) || relatedSentence, 90)
						: `${node.label} supports understanding of the main concept.`;

			return {
				...node,
				type,
				tooltip,
			};
		}),
		edges: graph.edges,
	};

	const edgeItems = graphData.edges
		.map((edge) => {
			const fromNode = graphData.nodes.find((node) => node.id === edge.from);
			const toNode = graphData.nodes.find((node) => node.id === edge.to);
			const fromLabel = escapeHtml(fromNode?.label ?? `Node ${edge.from}`);
			const toLabel = escapeHtml(toNode?.label ?? `Node ${edge.to}`);
			const edgeLabel = escapeHtml(edge.label);

			return `<li><strong>${fromLabel}</strong> ${edgeLabel} <strong>${toLabel}</strong></li>`;
		})
		.join("");

	return `
<style>
	.graph-root {
		font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
		color: #0f172a;
	}

	.graph-head {
		text-align: center;
		margin-bottom: 10px;
	}

	.graph-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.graph-subtitle {
		margin: 6px 0 0;
		font-size: 0.8rem;
		color: #475569;
	}

	.graph-map {
		position: relative;
		height: 440px;
		border-radius: 16px;
		background: radial-gradient(circle at 30% 20%, #eff6ff, #eef2ff 48%, #ecfeff 100%);
		box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
		overflow: hidden;
		border: 1px solid #dbeafe;
	}

	.graph-lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 1;
	}

	.graph-lines path {
		stroke: rgba(51, 65, 85, 0.35);
		stroke-width: 1.5;
		fill: none;
		transition: opacity 0.2s ease, stroke 0.2s ease, stroke-width 0.2s ease;
	}

	.graph-lines path.is-active {
		stroke: #2563eb;
		stroke-width: 2.2;
		opacity: 1;
	}

	.graph-lines path.is-dimmed {
		opacity: 0.18;
	}

	.graph-edge-label {
		position: absolute;
		z-index: 3;
		transform: translate(-50%, -50%);
		font-size: 0.66rem;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.88);
		color: #334155;
		border: 1px solid #e2e8f0;
		pointer-events: none;
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.graph-edge-label.is-active {
		color: #1d4ed8;
		border-color: #bfdbfe;
	}

	.graph-edge-label.is-dimmed {
		opacity: 0.2;
	}

	.graph-node {
		position: absolute;
		z-index: 4;
		min-width: 120px;
		max-width: 168px;
		transform: translate(-50%, -50%);
		border-radius: 16px;
		padding: 10px 12px;
		text-align: center;
		font-size: 0.76rem;
		font-weight: 600;
		line-height: 1.3;
		color: #1e293b;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.14);
		cursor: default;
		transition: transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
		opacity: 0;
		animation: graphNodeFadeIn 340ms ease forwards;
	}

	.graph-node:hover {
		transform: translate(-50%, -50%) translateY(-2px);
		box-shadow: 0 12px 26px rgba(15, 23, 42, 0.18);
	}

	.graph-node.node-main {
		min-width: 168px;
		max-width: 220px;
		font-size: 0.85rem;
		font-weight: 700;
		background: linear-gradient(140deg, #93c5fd, #60a5fa);
		color: #0f172a;
		border: 1px solid #bfdbfe;
	}

	.graph-node.node-secondary {
		background: linear-gradient(140deg, #c4b5fd, #a7f3d0);
		border: 1px solid #ddd6fe;
	}

	.graph-node.node-supporting {
		min-width: 106px;
		max-width: 148px;
		font-size: 0.72rem;
		background: linear-gradient(140deg, #bbf7d0, #a7f3d0);
		border: 1px solid #86efac;
	}

	.graph-node.node-application {
		background: linear-gradient(140deg, #fed7aa, #fdba74);
		border: 1px solid #fdba74;
	}

	.graph-node.is-active {
		opacity: 1;
		filter: saturate(1.05);
	}

	.graph-node.is-dimmed {
		opacity: 0.26;
	}

	.graph-tooltip {
		position: absolute;
		z-index: 6;
		left: 0;
		top: 0;
		max-width: 220px;
		padding: 8px 10px;
		border-radius: 10px;
		font-size: 0.7rem;
		line-height: 1.35;
		color: #f8fafc;
		background: rgba(15, 23, 42, 0.9);
		box-shadow: 0 10px 20px rgba(15, 23, 42, 0.2);
		transform: translate(-50%, -110%);
		pointer-events: none;
		display: none;
	}

	.graph-tooltip.show {
		display: block;
	}

	@keyframes graphNodeFadeIn {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.9);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	.graph-meta {
		margin-top: 12px;
		display: grid;
		gap: 10px;
	}

	.graph-relations {
		border-radius: 14px;
		padding: 10px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
	}

	.graph-relations h4 {
		margin: 0 0 8px;
		font-size: 0.8rem;
		color: #334155;
	}

	.graph-relations ul {
		margin: 0;
		padding-left: 18px;
		font-size: 0.75rem;
		line-height: 1.35;
		color: #334155;
	}

	@media (max-width: 640px) {
		.graph-map {
			height: 420px;
		}

		.graph-node.node-main {
			min-width: 150px;
			max-width: 190px;
		}

		.graph-node {
			max-width: 132px;
		}
	}

	.graph-root.is-compact .graph-map {
		height: 400px;
	}

	.graph-root.is-expanded .graph-map {
		height: 540px;
	}

	.graph-root.theme-forest .graph-map {
		background: radial-gradient(circle at 30% 20%, #ecfdf5, #dcfce7 48%, #d1fae5 100%);
		border-color: #86efac;
	}

	.graph-root.theme-forest .graph-node.node-main {
		background: linear-gradient(140deg, #86efac, #4ade80);
		border-color: #4ade80;
	}

	.graph-root.theme-forest .graph-node.node-secondary {
		background: linear-gradient(140deg, #bbf7d0, #99f6e4);
		border-color: #6ee7b7;
	}

	.graph-root.theme-forest .graph-node.node-supporting {
		background: linear-gradient(140deg, #dcfce7, #bbf7d0);
		border-color: #86efac;
	}

	.graph-root.theme-forest .graph-lines path.is-active {
		stroke: #16a34a;
	}

	.graph-root.theme-ink {
		color: #e2e8f0;
	}

	.graph-root.theme-ink .graph-title,
	.graph-root.theme-ink .graph-subtitle,
	.graph-root.theme-ink .graph-relations h4,
	.graph-root.theme-ink .graph-relations ul {
		color: #cbd5e1;
	}

	.graph-root.theme-ink .graph-map {
		background: radial-gradient(circle at 30% 20%, #334155, #1e293b 48%, #0f172a 100%);
		border-color: #475569;
	}

	.graph-root.theme-ink .graph-node {
		color: #e2e8f0;
	}

	.graph-root.theme-ink .graph-node.node-main {
		background: linear-gradient(140deg, #1d4ed8, #334155);
		border-color: #60a5fa;
	}

	.graph-root.theme-ink .graph-node.node-secondary {
		background: linear-gradient(140deg, #334155, #475569);
		border-color: #64748b;
	}

	.graph-root.theme-ink .graph-node.node-supporting {
		background: linear-gradient(140deg, #475569, #334155);
		border-color: #64748b;
	}

	.graph-root.theme-ink .graph-node.node-application {
		background: linear-gradient(140deg, #0f172a, #334155);
		border-color: #475569;
	}

	.graph-root.theme-ink .graph-lines path {
		stroke: rgba(148, 163, 184, 0.45);
	}

	.graph-root.theme-ink .graph-lines path.is-active {
		stroke: #93c5fd;
	}

	.graph-root.theme-ink .graph-edge-label {
		background: rgba(15, 23, 42, 0.88);
		color: #cbd5e1;
		border-color: #334155;
	}

	.graph-root.theme-ink .graph-tooltip {
		background: rgba(2, 6, 23, 0.95);
	}

	.graph-root.theme-ink .graph-relations {
		background: #0f172a;
		border-color: #334155;
	}

	.graph-root.theme-sunset .graph-map {
		background: radial-gradient(circle at 30% 20%, #ffedd5, #fed7aa 52%, #fecaca 100%);
		border-color: #fdba74;
	}

	.graph-root.theme-sunset .graph-node.node-main {
		background: linear-gradient(140deg, #fb7185, #fb923c);
		border-color: #f97316;
	}

	.graph-root.theme-sunset .graph-node.node-secondary {
		background: linear-gradient(140deg, #fdba74, #fda4af);
		border-color: #fb923c;
	}

	.graph-root.theme-sunset .graph-node.node-supporting {
		background: linear-gradient(140deg, #fde68a, #fdba74);
		border-color: #f59e0b;
	}

	.graph-root.theme-sunset .graph-lines path.is-active {
		stroke: #ea580c;
	}

	.graph-root.theme-sunset .graph-edge-label.is-active {
		color: #c2410c;
		border-color: #fdba74;
	}
</style>

<div class="graph-root ${graphLayout === "expanded" ? "is-expanded" : "is-compact"} theme-${graphTheme}">
	<div class="graph-head">
		<p class="graph-title">Knowledge Graph</p>
		<p class="graph-subtitle">Topic: ${safeTitle}</p>
	</div>

	<div id="graph-map" class="graph-map">
		<svg id="graph-lines" class="graph-lines"></svg>
		<div id="graph-tooltip" class="graph-tooltip"></div>
	</div>

	<div class="graph-meta">
		<div class="graph-relations">
			<h4>Concept Connections</h4>
			<ul>${edgeItems}</ul>
		</div>
	</div>
</div>

<script>
	const graphLayout = ${JSON.stringify(graphLayout)};
	const graphData = ${JSON.stringify(graphData)};
	const mapElement = document.getElementById('graph-map');
	const linesElement = document.getElementById('graph-lines');
	const tooltipElement = document.getElementById('graph-tooltip');

	if (mapElement && linesElement && tooltipElement) {
		const width = mapElement.clientWidth;
		const height = mapElement.clientHeight;
		const centerX = width / 2;
		const centerY = height / 2;
		const secondaryNodes = graphData.nodes.filter((node) => node.type === 'secondary');
		const outerNodes = graphData.nodes.filter((node) => node.type !== 'secondary' && node.type !== 'main');

		const secondaryRadius = graphLayout === 'expanded'
			? Math.max(145, Math.min(width, height) / 2.9)
			: Math.max(105, Math.min(width, height) / 3.9);
		const outerRadius = graphLayout === 'expanded'
			? Math.max(210, Math.min(width, height) / 1.95)
			: Math.max(150, Math.min(width, height) / 2.55);

		const placedNodes = new Map();

		const mainNode = graphData.nodes[0];
		if (mainNode) {
			placedNodes.set(mainNode.id, { ...mainNode, x: centerX, y: centerY });
		}

		secondaryNodes.forEach((node, index) => {
			const angle = (Math.PI * 2 * index) / Math.max(1, secondaryNodes.length) - Math.PI / 2;
			const x = centerX + secondaryRadius * Math.cos(angle);
			const y = centerY + secondaryRadius * Math.sin(angle);
			placedNodes.set(node.id, { ...node, x, y });
		});

		outerNodes.forEach((node, index) => {
			const angle = (Math.PI * 2 * index) / Math.max(1, outerNodes.length) - Math.PI / 2 + Math.PI / 8;
			const x = centerX + outerRadius * Math.cos(angle);
			const y = centerY + outerRadius * Math.sin(angle);
			placedNodes.set(node.id, { ...node, x, y });
		});

		const positionedNodes = [...placedNodes.values()];
		const edgeElements = [];
		const nodeElements = new Map();

		graphData.edges.forEach((edge, edgeIndex) => {
			const fromNode = placedNodes.get(edge.from);
			const toNode = placedNodes.get(edge.to);
			if (!fromNode || !toNode) {
				return;
			}

			const midX = (fromNode.x + toNode.x) / 2;
			const midY = (fromNode.y + toNode.y) / 2;
			const dx = toNode.x - fromNode.x;
			const dy = toNode.y - fromNode.y;
			const length = Math.max(1, Math.hypot(dx, dy));
			const offset = edgeIndex % 2 === 0 ? 18 : -18;
			const controlX = midX + (-dy / length) * offset;
			const controlY = midY + (dx / length) * offset;

			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M ' + fromNode.x + ' ' + fromNode.y + ' Q ' + controlX + ' ' + controlY + ' ' + toNode.x + ' ' + toNode.y);
			path.dataset.from = String(edge.from);
			path.dataset.to = String(edge.to);
			linesElement.appendChild(path);

			const labelElement = document.createElement('div');
			labelElement.className = 'graph-edge-label';
			labelElement.textContent = edge.label;
			labelElement.style.left = controlX + 'px';
			labelElement.style.top = controlY + 'px';
			mapElement.appendChild(labelElement);

			edgeElements.push({ edge, path, labelElement });
		});

		const clearHighlight = () => {
			nodeElements.forEach((element) => {
				element.classList.remove('is-active');
				element.classList.remove('is-dimmed');
			});

			edgeElements.forEach(({ path, labelElement }) => {
				path.classList.remove('is-active');
				path.classList.remove('is-dimmed');
				labelElement.classList.remove('is-active');
				labelElement.classList.remove('is-dimmed');
			});

			tooltipElement.classList.remove('show');
		};

		const focusNode = (nodeId) => {
			const connectedNodeIds = new Set([nodeId]);
			const connectedEdges = new Set();

			edgeElements.forEach(({ edge }, index) => {
				if (edge.from === nodeId || edge.to === nodeId) {
					connectedNodeIds.add(edge.from);
					connectedNodeIds.add(edge.to);
					connectedEdges.add(index);
				}
			});

			nodeElements.forEach((element, id) => {
				if (connectedNodeIds.has(id)) {
					element.classList.add('is-active');
					element.classList.remove('is-dimmed');
				} else {
					element.classList.remove('is-active');
					element.classList.add('is-dimmed');
				}
			});

			edgeElements.forEach(({ path, labelElement }, index) => {
				if (connectedEdges.has(index)) {
					path.classList.add('is-active');
					path.classList.remove('is-dimmed');
					labelElement.classList.add('is-active');
					labelElement.classList.remove('is-dimmed');
				} else {
					path.classList.remove('is-active');
					path.classList.add('is-dimmed');
					labelElement.classList.remove('is-active');
					labelElement.classList.add('is-dimmed');
				}
			});
		};

		positionedNodes.forEach((node, nodeIndex) => {
			const nodeElement = document.createElement('div');
			nodeElement.className = 'graph-node node-' + node.type;
			nodeElement.style.left = node.x + 'px';
			nodeElement.style.top = node.y + 'px';
			nodeElement.style.animationDelay = String(nodeIndex * 60) + 'ms';
			nodeElement.textContent = node.label;

			nodeElement.addEventListener('mouseenter', () => {
				focusNode(node.id);
				tooltipElement.textContent = node.tooltip;
				tooltipElement.style.left = node.x + 'px';
				tooltipElement.style.top = node.y + 'px';
				tooltipElement.classList.add('show');
			});

			nodeElement.addEventListener('mouseleave', () => {
				clearHighlight();
			});

			nodeElements.set(node.id, nodeElement);
			mapElement.appendChild(nodeElement);
		});

		mapElement.addEventListener('mouseleave', clearHighlight);
	}
</script>
`.trim();
}

function summarizeHighlightText(highlightText: string) {
	const sentences = splitIntoSentences(highlightText);

	if (sentences.length === 0) {
		return [
			"1. Concept Overview",
			"I could not find enough content in this highlight to explain the concept yet. Please select a longer highlight so I can teach it clearly in simple steps.",
			"",
			"2. Simple Explanation",
			"• There is not enough text to identify the full idea.",
			"• A longer highlight helps me explain it in easy points.",
			"• Include at least 2 to 5 full sentences.",
			"",
			"3. Step-by-Step Understanding",
			"Step 1 – Select a full concept from your notes.",
			"Step 2 – Ask me to explain it in simple words.",
			"Step 3 – I will break it into small learning steps.",
			"",
			"4. Real-World Example (if applicable)",
			"It is like trying to explain a movie from one screenshot; we need a bit more context to understand the full story.",
			"",
			"5. Key Takeaways",
			"• More context gives a better explanation.",
			"• Step-by-step learning makes hard ideas easier.",
			"• You can try another highlight now.",
			"",
			"6. Suggestions to Understand Better",
			"• Highlight 2 to 5 complete sentences.",
			"• Include the sentence that defines the concept.",
			"• Ask one follow-up question after the explanation.",
		].join("\n");
	}

	const simplePoints = sentences
		.slice(0, 6)
		.map((sentence) => toSimplePoint(sentence))
		.filter((point) => point.length > 0)
		.slice(0, 4);
	const keyTerms = extractKeyTerms(highlightText);
	const topic = keyTerms[0] ? toTitleCase(keyTerms[0]) : "this concept";

	const conceptOverview = [
		`This highlighted text is mainly about ${topic} and explains the core idea in a practical way.`,
		`In simple terms, the central message is: ${truncateAtWordBoundary(simplePoints[0] ?? sentences[0], 130)}`,
		"The goal is to help you understand what it means and how to use the idea in real situations.",
	].join(" ");

	const simpleExplanationPoints = [
		`• Main idea: ${truncateAtWordBoundary(simplePoints[0] ?? sentences[0], 120)}`,
		`• Why it matters: it helps you understand ${topic.toLowerCase()} clearly without extra complexity.`,
		`• In short: break the concept into small parts and learn one part at a time.`,
	].join("\n");

	const stepTitles = [
		"Start with the main idea",
		"Understand what it means",
		"Connect it to real use",
		"Remember the key point",
	];

	const stepByStep = stepTitles
		.map((title, index) => {
			const fallbackPoint = simplePoints[simplePoints.length - 1] ?? simplePoints[0] ?? sentences[0];
			const detail = simplePoints[index] ?? fallbackPoint;
			return `Step ${index + 1} – ${title}: ${detail}`;
		})
		.join("\n");

	const keyTakeaways = [
		`• The concept is about ${topic} and how it works in simple terms.`,
		`• Focus on this line first: ${truncateAtWordBoundary(simplePoints[0] ?? sentences[0], 100)}`,
		"• Learning step by step makes hard topics easier to remember.",
	].join("\n");

	const technicalTerms = keyTerms.length > 0
		? keyTerms
			.slice(0, 3)
			.map((term) => `• ${toTitleCase(term)} means an important keyword in this concept.`)
			.join("\n")
		: "• No heavy technical terms were detected in this highlight.";

	const suggestions = [
		"• Re-read Step 1 and Step 2, then explain them in your own words.",
		"• Create one question from each step and answer it without looking.",
		"• Explore a related concept to connect this idea with a bigger picture.",
	].join("\n");

	const realWorldExample = buildAnalogy(topic);

	return [
		"1. Concept Overview",
		conceptOverview,
		"",
		"2. Simple Explanation",
		simpleExplanationPoints,
		technicalTerms,
		"",
		"3. Step-by-Step Understanding",
		stepByStep,
		"",
		"4. Real-World Example (if applicable)",
		realWorldExample,
		"",
		"5. Key Takeaways",
		keyTakeaways,
		"",
		"6. Suggestions to Understand Better",
		suggestions,
	].join("\n");
}

function explainHighlightConcept(highlight: Highlight) {
	const explanation = summarizeHighlightText(highlight.text);

	return [
		`Explaining your selected highlight from ${highlight.title}:`,
		"",
		explanation,
	].join("\n");
}

function generateHighlightFlashcardsHtml(highlight: Highlight) {
	const sentences = splitIntoSentences(highlight.text).slice(0, 6);
	const keyTerms = extractKeyTerms(highlight.text);
	const topic = keyTerms[0] ? toTitleCase(keyTerms[0]) : highlight.title;
	const safeTitle = escapeHtml(highlight.title || "Highlighted Topic");

	const cards = [
		{
			front: `What is ${topic} in this highlight?`,
			back: truncateAtWordBoundary(toSimplePoint(sentences[0] ?? highlight.text) || highlight.text, 130),
		},
		{
			front: "What is the key takeaway?",
			back: truncateAtWordBoundary(toSimplePoint(sentences[1] ?? sentences[0] ?? highlight.text) || highlight.text, 130),
		},
		{
			front: "Why does this concept matter?",
			back: `It matters because it helps you make better decisions using ${topic.toLowerCase()} in real situations.`,
		},
		{
			front: "How can you apply this in real life?",
			back: `Use it step by step: ${truncateAtWordBoundary(toSimplePoint(sentences[2] ?? sentences[0] ?? highlight.text) || highlight.text, 115)}`,
		},
		{
			front: "What common mistake should you avoid?",
			back: "Avoid memorizing without understanding the idea and when to apply it.",
		},
		{
			front: "Explain this concept in one simple line",
			back: truncateAtWordBoundary(toSimplePoint(sentences[0] ?? highlight.text) || highlight.text, 100),
		},
	].slice(0, 6);

	if (!sentences.length) {
		cards.splice(0, cards.length, ...[
			{
				front: "What is the main idea of this highlighted text?",
				back: "It explains a core concept in simple terms.",
			},
			{
				front: "Why is this concept important?",
				back: "It helps you understand and apply the topic in practical situations.",
			},
			{
				front: "How would you teach this to a beginner?",
				back: "Break it into small steps and explain one step at a time.",
			},
			{
				front: "How can this be applied in real life?",
				back: "Start with one small example and use the concept to solve it.",
			},
		]);
	}

	const cardMarkup = cards
		.map((card) => {
			const front = escapeHtml(card.front);
			const back = escapeHtml(card.back);

			return `
<div class="flashcard" role="button" tabindex="0" aria-label="Flashcard">
	<div class="flashcard-inner">
		<div class="flashcard-front">${front}</div>
		<div class="flashcard-back">${back}</div>
	</div>
</div>`;
		})
		.join("\n");

	return `
<style>
	.study-root {
		font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
		color: #0f172a;
	}

	.study-title {
		text-align: center;
		font-size: 1rem;
		font-weight: 700;
		margin: 0 0 12px 0;
		color: #1e293b;
	}

	.study-subtitle {
		text-align: center;
		font-size: 0.8rem;
		color: #475569;
		margin: 0 0 16px 0;
	}

	.flashcard-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
	}

	.flashcard {
		perspective: 1000px;
		min-height: 170px;
		cursor: pointer;
	}

	.flashcard-inner {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 170px;
		text-align: center;
		transition: transform 0.6s ease;
		transform-style: preserve-3d;
	}

	.flashcard:hover .flashcard-inner {
		transform: translateY(-2px);
	}

	.flashcard.is-flipped .flashcard-inner {
		transform: rotateY(180deg);
	}

	.flashcard-front,
	.flashcard-back {
		position: absolute;
		inset: 0;
		border-radius: 18px;
		padding: 16px;
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1.35;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		font-size: 0.92rem;
		font-weight: 600;
	}

	.flashcard-front {
		background: linear-gradient(135deg, #bfdbfe, #c4b5fd);
		color: #0f172a;
	}

	.flashcard-back {
		background: linear-gradient(135deg, #99f6e4, #86efac);
		color: #064e3b;
		transform: rotateY(180deg);
	}

	@media (max-width: 640px) {
		.flashcard-grid {
			grid-template-columns: 1fr;
		}
	}
</style>

<div class="study-root">
	<p class="study-title">Interactive Flashcards</p>
	<p class="study-subtitle">Topic: ${safeTitle} — Click a card to flip</p>
	<div class="flashcard-grid">
		${cardMarkup}
	</div>
</div>

<script>
	const cards = document.querySelectorAll('.flashcard');
	cards.forEach((card) => {
		const toggle = () => {
			card.classList.toggle('is-flipped');
		};

		card.addEventListener('click', toggle);
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggle();
			}
		});
	});
</script>
`.trim();
}

/**
 * Returns a local HTML reply for interactive content types (quiz, flashcard, graph),
 * or null if the prompt should be handled by the RAG API.
 */
function tryLocalReply(
	userPrompt: string,
	activeHighlight: Highlight | null,
	graphLayout: GraphLayoutPreference,
	graphTheme: GraphThemePreference
): ChatMessage | null {
	if (!activeHighlight) return null;

	const prompt = userPrompt.toLowerCase();

	if (prompt.includes("question")) {
		return { role: "assistant", content: generateHighlightQuizHtml(activeHighlight), format: "html" };
	}
	if (prompt.includes("graph") || prompt.includes("knowledge")) {
		return { role: "assistant", content: generateKnowledgeGraphHtml(activeHighlight, graphLayout, graphTheme), format: "html" };
	}
	if (prompt.includes("flashcard")) {
		return { role: "assistant", content: generateHighlightFlashcardsHtml(activeHighlight), format: "html" };
	}

	return null;
}

export default function ConversePage() {
	const [activeHighlight, setActiveHighlight] = useState<Highlight | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [copiedHtmlMessageIndex, setCopiedHtmlMessageIndex] = useState<number | null>(null);
	const [isReplying, setIsReplying] = useState(false);
	const [graphLayout, setGraphLayout] = useState<GraphLayoutPreference>("compact");
	const [graphTheme, setGraphTheme] = useState<GraphThemePreference>("forest");
	const [scopePreset, setScopePreset] = useState<ScopePreset>("all");
	const [meetingScopeId, setMeetingScopeId] = useState<string>("");
	const [meetList, setMeetList] = useState<MeetListItem[]>([]);
	/** Keys `${messageIndex}-${ci}` → last feedback sent for that citation */
	const [citationFeedback, setCitationFeedback] = useState<Record<string, "helpful" | "not">>({});
	/** Persistent conversation session ID — survives page refreshes via sessionStorage */
	const [converseSessionId] = useState<string>(() => {
		if (typeof window === "undefined") return `conv-${Date.now().toString(36)}`;
		const stored = sessionStorage.getItem("uniflow_converse_sid");
		if (stored) return stored;
		const id = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		sessionStorage.setItem("uniflow_converse_sid", id);
		return id;
	});
	const [savedInsightIndices, setSavedInsightIndices] = useState<Set<number>>(new Set());

	const messagesEndRef = useRef<HTMLDivElement | null>(null);
	const pendingReplyTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

	useEffect(() => {
		let isMounted = true;

		const fetchActiveHighlight = async () => {
			try {
				setErrorMessage(null);

				const response = await fetch("/api/highlights", { cache: "no-store" });

				if (!response.ok) {
					throw new Error("Failed to fetch highlights");
				}

				const result = (await response.json()) as HighlightsResponse;
				const highlights = Array.isArray(result.data) ? result.data : [];
				const currentActiveHighlight = highlights.find((highlight) => highlight?.isActive === true) ?? null;

				if (isMounted) {
					setActiveHighlight(currentActiveHighlight);
				}
			} catch {
				if (isMounted) {
					setErrorMessage("Could not load highlight context right now.");
					setActiveHighlight(null);
				}
			} finally {
				if (isMounted) {
					setIsLoading(false);
				}
			}
		};

		void fetchActiveHighlight();

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const loadMeets = async () => {
			try {
				const res = await fetch("/api/meets", { cache: "no-store" });
				if (!res.ok) return;
				const json = (await res.json()) as { data?: MeetListItem[] };
				const rows = Array.isArray(json.data) ? json.data : [];
				if (!cancelled) {
					setMeetList(
						rows
							.filter((m) => m.status === "ready")
							.map((m) => ({ id: m.id, title: m.title, status: m.status }))
					);
				}
			} catch {
				// optional
			}
		};
		void loadMeets();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [messages]);

	useEffect(() => {
		return () => {
			pendingReplyTimeoutsRef.current.forEach((timeoutId) => {
				clearTimeout(timeoutId);
			});
			pendingReplyTimeoutsRef.current = [];
		};
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/preferences", { cache: "no-store" });
				if (!res.ok) return;
				const json = (await res.json()) as {
					data?: { graphSettings?: { layout?: string; theme?: string } };
				};
				const gs = json.data?.graphSettings;
				if (gs?.layout === "expanded" || gs?.layout === "compact") {
					setGraphLayout(gs.layout);
				}
				if (gs?.theme === "forest" || gs?.theme === "ink" || gs?.theme === "sunset") {
					setGraphTheme(gs.theme);
				}
			} catch {
				// defaults
			}
		})();
	}, []);

	const hasActiveHighlight = useMemo(() => activeHighlight !== null, [activeHighlight]);

	const buildRetrievalScope = () => {
		if (scopePreset === "all") {
			return {} as Record<string, unknown>;
		}
		if (scopePreset === "notes") {
			return { sourceTypes: ["note"] };
		}
		if (scopePreset === "highlights") {
			return { sourceTypes: ["highlight"] };
		}
		if (scopePreset === "meetings") {
			return { sourceTypes: ["meeting-transcript", "meeting-summary"] };
		}
		if (scopePreset === "documents") {
			return { sourceTypes: ["document"] };
		}
		if (scopePreset === "conversations") {
			return { sourceTypes: ["conversation"] };
		}
		if (scopePreset === "meeting" && meetingScopeId) {
			return {
				sourceIds: [meetingScopeId],
				sourceTypes: ["meeting-transcript", "meeting-summary"],
			};
		}
		return {};
	};

	const sendCitationFeedback = async (
		messageIndex: number,
		ci: number,
		chunkId: string | undefined,
		ragQuery: string | undefined,
		helpful: boolean
	) => {
		const key = `${messageIndex}-${ci}`;
		if (!chunkId?.trim() || !ragQuery?.trim()) {
			return;
		}
		// Already submitted for this citation — allow changing the vote
		const prev = citationFeedback[key];
		if (prev === (helpful ? "helpful" : "not")) return;
		// Optimistically update UI first to prevent double-clicks
		setCitationFeedback((s) => ({ ...s, [key]: helpful ? "helpful" : "not" }));
		try {
			const res = await fetch("/api/rag/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: ragQuery.trim(),
					chunkId: chunkId.trim(),
					helpful,
				}),
			});
			if (!res.ok) {
				// Revert on failure
				setCitationFeedback((s) => {
					const next = { ...s };
					if (prev) next[key] = prev;
					else delete next[key];
					return next;
				});
			}
		} catch {
			setCitationFeedback((s) => {
				const next = { ...s };
				if (prev) next[key] = prev;
				else delete next[key];
				return next;
			});
		}
	};

	const saveInsightAsNote = useCallback(async (messageIndex: number) => {
		const assistantMsg = messages[messageIndex];
		if (!assistantMsg || assistantMsg.role !== "assistant") return;
		const userMsg = messages
			.slice(0, messageIndex)
			.reverse()
			.find((m) => m.role === "user");
		if (!userMsg) return;

		try {
			const res = await fetch("/api/converse/save", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					question: userMsg.content,
					answer: assistantMsg.content,
					citations: assistantMsg.citations,
				}),
			});
			if (res.ok) {
				setSavedInsightIndices((prev) => new Set(prev).add(messageIndex));
			}
		} catch {
			// silent
		}
	}, [messages]);

	const fetchRAGReply = async (userPrompt: string) => {
		if (scopePreset === "meeting" && !meetingScopeId) {
			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: "Select a meeting in the scope dropdown to search within that recording.",
					format: "text",
				},
			]);
			return;
		}

		setIsReplying(true);
		try {
			const highlight = activeHighlight
				? { id: activeHighlight.id, title: activeHighlight.title, text: activeHighlight.text, url: activeHighlight.url }
				: undefined;

			const prompt = userPrompt.toLowerCase();
			const mode = prompt.includes("explain") ? "explain" : "qa";

			const scope = buildRetrievalScope();

			const res = await fetch("/api/meet-assistant", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					mode,
					question: userPrompt,
					highlight,
					chatHistory: messages.filter((m) => m.format !== "html").map((m) => ({ role: m.role, content: m.content })).slice(-10),
					transcriptLanguage: "English",
					sessionTitle: activeHighlight?.title ?? "General",
					contextHighlights: highlight ? [highlight] : [],
					converseSessionId,
					...scope,
				}),
			});

			if (!res.ok) {
				throw new Error("Failed to get AI response");
			}

			const result = await res.json() as {
				data?: { answer?: string; citations?: CitationItem[] };
			};
			const answer = result.data?.answer ?? "Sorry, I couldn't generate a response. Please try again.";
			const citations = result.data?.citations;
			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: answer,
					format: "text",
					ragQuery: userPrompt,
					...(citations && citations.length > 0 ? { citations } : {}),
				},
			]);
		} catch {
			setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong reaching the AI. Please try again.", format: "text" }]);
		} finally {
			setIsReplying(false);
		}
	};

	const sendUserMessage = (content: string) => {
		const trimmedContent = content.trim();
		if (!trimmedContent || isReplying) return;

		setMessages((currentMessages) => [
			...currentMessages,
			{ role: "user", content: trimmedContent, format: "text" },
		]);

		// Check if this is a local HTML content type first
		const localReply = tryLocalReply(trimmedContent, activeHighlight, graphLayout, graphTheme);
		if (localReply) {
			const timeoutId = setTimeout(() => {
				setMessages((prev) => [...prev, localReply]);
			}, 400);
			pendingReplyTimeoutsRef.current.push(timeoutId);
			return;
		}

		// For text queries, use the RAG pipeline
		void fetchRAGReply(trimmedContent);
	};
	const handleSuggestionClick = (suggestionText: string) => {
		setInput(suggestionText);
		sendUserMessage(suggestionText);
	};

	const handleSend = () => {
		const messageToSend = input.trim();
		if (!messageToSend) {
			return;
		}

		sendUserMessage(messageToSend);
		setInput("");
	};

	const handleCopyHtmlMessage = async (messageContent: string, messageIndex: number) => {
		try {
			await navigator.clipboard.writeText(messageContent);
			setCopiedHtmlMessageIndex(messageIndex);

			window.setTimeout(() => {
				setCopiedHtmlMessageIndex((currentValue) =>
					currentValue === messageIndex ? null : currentValue
				);
			}, 1800);
		} catch {
			setCopiedHtmlMessageIndex(null);
		}
	};

	return (
		<div className="flex h-full min-h-[560px] w-full flex-col overflow-hidden">
			{/* Outer shell — warm sage canvas */}
			<div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">

				{/* ── Header ───────────────────────────────────────────────── */}
				<div className="flex shrink-0 items-center gap-2.5 border-b border-[#e0edd9] bg-[#f5f7f2] px-5 py-3.5 dark:border-[#1e3020] dark:bg-[#0d1510]">
					<div className="flex size-7 items-center justify-center rounded-lg bg-[#d4e8d0] dark:bg-[#1e3a28]">
						<Sparkles className="size-3.5 text-[#3a6b45] dark:text-[#6bbf7e]" />
					</div>
					<h1 className="text-base font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">
						UniFlow AI
					</h1>
					<div className="ml-auto flex items-center gap-2">
						<span className="inline-flex items-center gap-1 rounded-full bg-[#eef6ec] px-2 py-0.5 text-[0.6rem] font-medium text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#6bbf7e]">
							<Shield className="size-2.5" />
							Encrypted
						</span>
						<span className="text-[0.68rem] text-[#8ab490] dark:text-[#4a7054]">
							Conversations auto-saved
						</span>
					</div>
				</div>

				{/* ── Scrollable message area ───────────────────────────────── */}
				<div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden p-4 md:p-5">
					{isLoading ? (
						<div className="rounded-2xl border border-dashed border-[#cde0c9] p-6 text-sm text-[#6a9470] dark:border-[#2a4030] dark:text-[#5a8060]">
							Loading AI context…
						</div>
					) : hasActiveHighlight && activeHighlight ? (
						<section className="mb-4 space-y-4 rounded-2xl border border-[#cde0c9] bg-[#f7fbf6] p-4 dark:border-[#2a4030] dark:bg-[#0d1a10] md:p-5">
							<p className="text-[0.68rem] font-semibold uppercase tracking-widest text-[#5a8a63] dark:text-[#6bbf7e]">
								Active Highlight
							</p>
							<p className="text-sm text-[#3a5a42] dark:text-[#b0d4b8]">
								From <span className="font-medium">{activeHighlight.title}</span>:
							</p>
							<blockquote className="rounded-xl border-l-4 border-[#4a9456] bg-[#eef6ec] p-3.5 text-sm leading-relaxed text-[#2c4a35] italic dark:border-[#5aaa66] dark:bg-[#1a2e1e] dark:text-[#c0e0c8]">
								{activeHighlight.text}
							</blockquote>
							<div className="flex flex-wrap gap-1.5">
								{activeHighlightSuggestions.map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										className="rounded-full border border-[#cde0c9] bg-white px-3 py-1.5 text-xs font-medium text-[#3a6b45] transition-colors hover:border-[#4a9456] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:bg-[#111d14] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
										onClick={() => handleSuggestionClick(suggestion)}
									>
										{suggestion}
									</button>
								))}
							</div>
						</section>
					) : (
						<section className="mb-4 space-y-4 rounded-2xl border border-[#cde0c9] bg-[#f7fbf6] p-4 dark:border-[#2a4030] dark:bg-[#0d1a10] md:p-5">
							<div>
								<p className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Welcome to UniFlow AI</p>
								<p className="mt-0.5 text-sm text-[#5a8a63] dark:text-[#6bbf7e]">
									Ask about your notes, meetings, and highlights for insights and learning support.
								</p>
							</div>
							<div className="flex flex-wrap gap-1.5">
								{defaultPrompts.map((prompt) => (
									<button
										key={prompt}
										type="button"
										disabled={isReplying}
										className="rounded-full border border-[#cde0c9] bg-white px-3 py-1.5 text-xs font-medium text-[#3a6b45] transition-colors hover:border-[#4a9456] hover:bg-[#eef6ec] disabled:opacity-50 dark:border-[#2a4030] dark:bg-[#111d14] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
										onClick={() => handleSuggestionClick(prompt)}
									>
										{prompt}
									</button>
								))}
							</div>
						</section>
					)}

					{errorMessage ? (
						<p className="mb-4 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
					) : null}

					{/* ── Messages ─────────────────────────────────────────── */}
					<div className="w-full space-y-3 overflow-hidden">
						{messages.map((message, index) => (
							<div
								key={`${message.role}-${index}-${message.content}`}
								className={`flex w-full min-w-0 ${message.role === "user" ? "justify-end" : "justify-start"}`}
							>
								<div
									className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] ${
										message.role === "user"
											? "max-w-[72%] bg-[#4a9456] text-white dark:bg-[#5aaa66]"
											: message.format === "html"
												? "w-full max-w-[760px] border border-[#cde0c9] bg-[#f7fbf6] p-2 dark:border-[#2a4030] dark:bg-[#111d14]"
												: "max-w-[84%] border border-[#e0edd9] bg-[#f7fbf6] text-[#2c4a35] dark:border-[#1e3020] dark:bg-[#131f15] dark:text-[#c8e6cb]"
									}`}
									style={{ animation: "converseFadeIn 220ms ease-out" }}
								>
									{message.format === "html" ? (
										<div className="flex flex-col gap-2">
											<iframe
												title={`flashcards-${index}`}
												sandbox="allow-scripts"
												srcDoc={message.content}
												className="h-[520px] w-full rounded-xl border-0 bg-transparent"
											/>
											<div className="flex justify-end">
												<button
													type="button"
													className="h-7 rounded-full border border-[#cde0c9] bg-white px-3 text-[0.7rem] font-medium text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:bg-[#111d14] dark:text-[#90c898]"
													onClick={() => void handleCopyHtmlMessage(message.content, index)}
												>
													{copiedHtmlMessageIndex === index ? "Copied" : "Copy HTML"}
												</button>
											</div>
										</div>
									) : (
										<>
											{message.role === "assistant"
												? <Markdown content={message.content} compact />
												: message.content
											}
											{message.role === "assistant" ? (
												<div className="mt-2 flex items-center gap-1.5">
													{savedInsightIndices.has(index) ? (
														<span className="inline-flex items-center gap-1 rounded-full bg-[#eef6ec] px-2.5 py-1 text-[10px] font-medium text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#90c898]">
															&#10003; Saved to Notes
														</span>
													) : (
														<button
															type="button"
															className="inline-flex items-center gap-1 rounded-full border border-[#cde0c9] px-2.5 py-1 text-[10px] font-medium text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
															onClick={() => void saveInsightAsNote(index)}
														>
															<BookmarkPlus className="size-3" />
															Save as Note
														</button>
													)}
												</div>
											) : null}
											{message.role === "assistant" && message.citations && message.citations.length > 0 ? (
												<div className="mt-3 border-t border-[#e0edd9] pt-2 text-xs text-[#5a8a63] dark:border-[#1e3020] dark:text-[#6bbf7e]">
													<p className="mb-1 font-semibold text-[#3a6b45] dark:text-[#90c898]">Sources</p>
													<p className="mb-2 text-[11px] text-[#8ab490] dark:text-[#4a7054]">
														Mark sources helpful to improve future answers.
													</p>
													<ul className="space-y-2">
														{message.citations.map((c, ci) => {
															const fbKey = `${index}-${ci}`;
															const fb = citationFeedback[fbKey];
															return (
																<li
																	key={`${c.chunkId ?? c.sourceId ?? c.title}-${ci}`}
																	className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2"
																>
																	<div>
																		<span className="text-[#5a8a63] dark:text-[#6bbf7e]">
																			{c.title} ({c.sourceType})
																		</span>
																		{c.url ? (
																			<a href={c.url} target="_blank" rel="noreferrer"
																				className="ml-1 text-[#4a9456] underline dark:text-[#6bbf7e]">
																				Open
																			</a>
																		) : null}
																	</div>
																	{message.ragQuery && c.chunkId ? (
																		<div className="flex shrink-0 flex-wrap items-center gap-1">
																			{fb ? (
																				<span className="inline-flex items-center gap-1 rounded-full bg-[#eef6ec] px-2 py-0.5 text-[10px] text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#90c898]">
																					{fb === "helpful" ? "\u2714 Helpful" : "\u2716 Not helpful"}
																					<button
																						type="button"
																						className="ml-0.5 text-[9px] opacity-60 hover:opacity-100"
																						onClick={() => setCitationFeedback((s) => {
																							const next = { ...s };
																							delete next[fbKey];
																							return next;
																						})}
																						aria-label="Change vote"
																					>
																						\u21BB
																					</button>
																				</span>
																			) : (
																				<>
																					<button type="button"
																						className="rounded-full border border-[#cde0c9] px-2 py-0.5 text-[10px] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
																						onClick={() => void sendCitationFeedback(index, ci, c.chunkId, message.ragQuery, true)}>
																						\uD83D\uDC4D Helpful
																					</button>
																					<button type="button"
																						className="rounded-full border border-[#cde0c9] px-2 py-0.5 text-[10px] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
																						onClick={() => void sendCitationFeedback(index, ci, c.chunkId, message.ragQuery, false)}>
																						\uD83D\uDC4E Not helpful
																					</button>
																				</>
																			)}
																		</div>
																	) : null}
																</li>
															);
														})}
													</ul>
												</div>
											) : null}
										</>
									)}
								</div>
							</div>
						))}
						<div ref={messagesEndRef} />
					</div>
				</div>

				{/* ── Input bar ─────────────────────────────────────────────── */}
				<div className="shrink-0 border-t border-[#e0edd9] bg-[#f5f7f2] px-4 pb-4 pt-3 dark:border-[#1e3020] dark:bg-[#0d1510]">
					{/* Scope selector */}
					<div className="mb-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
						<label className="text-[0.7rem] font-medium text-[#5a8a63] dark:text-[#6bbf7e]" htmlFor="converse-scope">
							Scope
						</label>
						<select
							id="converse-scope"
							className="h-8 max-w-full rounded-full border border-[#cde0c9] bg-white px-3 text-xs text-[#2c4a35] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#c8e6cb]"
							value={scopePreset}
							disabled={isReplying}
							onChange={(e) => {
								const v = e.target.value as ScopePreset;
								setScopePreset(v);
								if (v !== "meeting") setMeetingScopeId("");
							}}
						>
							<option value="all">All knowledge</option>
							<option value="notes">Notes only</option>
							<option value="highlights">Highlights only</option>
							<option value="meetings">All meetings</option>
							<option value="documents">Uploaded documents</option>
							<option value="conversations">Past conversations</option>
							<option value="meeting">One meeting…</option>
						</select>
						{scopePreset === "meeting" ? (
							<select
								className="h-8 max-w-full flex-1 rounded-full border border-[#cde0c9] bg-white px-3 text-xs text-[#2c4a35] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#c8e6cb]"
								value={meetingScopeId}
								disabled={isReplying || meetList.length === 0}
								onChange={(e) => setMeetingScopeId(e.target.value)}
							>
								<option value="">Select a meeting…</option>
								{meetList.map((m) => (
									<option key={m.id} value={m.id}>{m.title}</option>
								))}
							</select>
						) : null}
					</div>

					{/* Input + send */}
					<div className="flex items-center gap-2">
						{messages.length > 0 ? (
							<button
								type="button"
								disabled={isReplying}
								className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-[#cde0c9] bg-white px-3 text-[0.7rem] font-medium text-[#3a6b45] hover:bg-[#eef6ec] disabled:opacity-40 dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#90c898]"
								onClick={() => {
									setMessages([]);
									setCitationFeedback({});
									setSavedInsightIndices(new Set());
									const newId = `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
									sessionStorage.setItem("uniflow_converse_sid", newId);
									window.location.reload();
								}}
							>
								New chat
							</button>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<Input
							className="h-10 rounded-full border-[#cde0c9] bg-white px-5 text-[#2c4a35] shadow-none placeholder:text-[#8ab490] focus-visible:ring-2 focus-visible:ring-[#4a9456] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#c8e6cb]"
							value={input}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !isReplying) {
									event.preventDefault();
									handleSend();
								}
							}}
							placeholder={isReplying ? "Thinking…" : "Ask about your notes, meetings, or highlights…"}
							type="text"
							disabled={isReplying}
						/>
						<button
							type="button"
							disabled={!input.trim() || isReplying}
							onClick={handleSend}
							className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#4a9456] text-white transition-all hover:bg-[#3d7d49] hover:scale-[1.04] disabled:opacity-40 dark:bg-[#5aaa66] dark:hover:bg-[#4d9459]"
						>
							<Send className="size-4" />
						</button>
					</div>
				</div>
			</div>

			<style jsx>{`
				@keyframes converseFadeIn {
					from { opacity: 0; transform: translateY(4px); }
					to   { opacity: 1; transform: translateY(0);   }
				}
			`}</style>
		</div>
	);
}
