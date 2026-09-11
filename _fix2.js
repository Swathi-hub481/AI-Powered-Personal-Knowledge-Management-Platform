const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app', 'converse', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix tryLocalReply indentation (add tabs)
const oldTryLocal = `/**
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
export default`;

const newTryLocal = `/**
 * Returns a local HTML reply for interactive content types (quiz, flashcard, graph),
 * or null if the prompt should be handled by the RAG API.
 */
function tryLocalReply(
\tuserPrompt: string,
\tactiveHighlight: Highlight | null,
\tgraphLayout: GraphLayoutPreference,
\tgraphTheme: GraphThemePreference
): ChatMessage | null {
\tif (!activeHighlight) return null;

\tconst prompt = userPrompt.toLowerCase();

\tif (prompt.includes("question")) {
\t\treturn { role: "assistant", content: generateHighlightQuizHtml(activeHighlight), format: "html" };
\t}
\tif (prompt.includes("graph") || prompt.includes("knowledge")) {
\t\treturn { role: "assistant", content: generateKnowledgeGraphHtml(activeHighlight, graphLayout, graphTheme), format: "html" };
\t}
\tif (prompt.includes("flashcard")) {
\t\treturn { role: "assistant", content: generateHighlightFlashcardsHtml(activeHighlight), format: "html" };
\t}

\treturn null;
}

export default`;

content = content.replace(oldTryLocal, newTryLocal);

// 2. Add isReplying state after copiedHtmlMessageIndex
content = content.replace(
  `const [copiedHtmlMessageIndex, setCopiedHtmlMessageIndex] = useState<number | null>(null);`,
  `const [copiedHtmlMessageIndex, setCopiedHtmlMessageIndex] = useState<number | null>(null);\n\tconst [isReplying, setIsReplying] = useState(false);`
);

// 3. Replace queueAssistantReply + sendUserMessage
const oldQueue = `\tconst queueAssistantReply = (userPrompt: string) => {
\t\tconst timeoutId = setTimeout(() => {
\t\t\tconst reply = buildAssistantReply(userPrompt, activeHighlight, graphLayout, graphTheme);

\t\t\tsetMessages((currentMessages) => [
\t\t\t\t...currentMessages,
\t\t\t\treply,
\t\t\t]);
\t\t}, 800);

\t\tpendingReplyTimeoutsRef.current.push(timeoutId);
\t};

\tconst sendUserMessage = (content: string) => {
\t\tconst trimmedContent = content.trim();
\t\tif (!trimmedContent) {
\t\t\treturn;
\t\t}

\t\tsetMessages((currentMessages) => [
\t\t\t...currentMessages,
\t\t\t{ role: "user", content: trimmedContent, format: "text" },
\t\t]);
\t\tqueueAssistantReply(trimmedContent);
\t};`;

const newQueue = `\tconst fetchRAGReply = async (userPrompt: string) => {
\t\tsetIsReplying(true);
\t\ttry {
\t\t\tconst highlight = activeHighlight
\t\t\t\t? { id: activeHighlight.id, title: activeHighlight.title, text: activeHighlight.text, url: activeHighlight.url }
\t\t\t\t: undefined;

\t\t\tconst prompt = userPrompt.toLowerCase();
\t\t\tconst mode = prompt.includes("explain") ? "explain" : "qa";

\t\t\tconst res = await fetch("/api/meet-assistant", {
\t\t\t\tmethod: "POST",
\t\t\t\theaders: { "Content-Type": "application/json" },
\t\t\t\tbody: JSON.stringify({
\t\t\t\t\tmode,
\t\t\t\t\tquestion: userPrompt,
\t\t\t\t\thighlight,
\t\t\t\t\tchatHistory: messages.filter((m) => m.format !== "html").map((m) => ({ role: m.role, content: m.content })).slice(-10),
\t\t\t\t\ttranscriptLanguage: "English",
\t\t\t\t\tsessionTitle: activeHighlight?.title ?? "General",
\t\t\t\t\tcontextHighlights: highlight ? [highlight] : [],
\t\t\t\t}),
\t\t\t});

\t\t\tif (!res.ok) {
\t\t\t\tthrow new Error("Failed to get AI response");
\t\t\t}

\t\t\tconst result = await res.json() as { data?: { answer?: string } };
\t\t\tconst answer = result.data?.answer ?? "Sorry, I couldn't generate a response. Please try again.";
\t\t\tsetMessages((prev) => [...prev, { role: "assistant", content: answer, format: "text" }]);
\t\t} catch {
\t\t\tsetMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong reaching the AI. Please try again.", format: "text" }]);
\t\t} finally {
\t\t\tsetIsReplying(false);
\t\t}
\t};

\tconst sendUserMessage = (content: string) => {
\t\tconst trimmedContent = content.trim();
\t\tif (!trimmedContent || isReplying) return;

\t\tsetMessages((currentMessages) => [
\t\t\t...currentMessages,
\t\t\t{ role: "user", content: trimmedContent, format: "text" },
\t\t]);

\t\t// Check if this is a local HTML content type first
\t\tconst localReply = tryLocalReply(trimmedContent, activeHighlight, graphLayout, graphTheme);
\t\tif (localReply) {
\t\t\tconst timeoutId = setTimeout(() => {
\t\t\t\tsetMessages((prev) => [...prev, localReply]);
\t\t\t}, 400);
\t\t\tpendingReplyTimeoutsRef.current.push(timeoutId);
\t\t\treturn;
\t\t}

\t\t// For text queries, use the RAG pipeline
\t\tvoid fetchRAGReply(trimmedContent);
\t};`;

if (content.indexOf(oldQueue) === -1) {
  console.log('WARNING: Could not find queueAssistantReply block');
  // Try to find it with different whitespace
  const idx = content.indexOf('const queueAssistantReply');
  if (idx !== -1) {
    console.log('Found queueAssistantReply at', idx);
    console.log('Context:', JSON.stringify(content.substring(idx, idx + 50)));
  }
} else {
  content = content.replace(oldQueue, newQueue);
  console.log('Replaced queueAssistantReply + sendUserMessage');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
