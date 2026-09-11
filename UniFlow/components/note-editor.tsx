"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bold, Code, Heading1, Heading2, Italic, List, Loader2, MessageSquare, Save, Send, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteFlowchart } from "./note-flowchart";
import { Markdown } from "@/components/ui/markdown";

export interface NoteHighlight {
	id: string;
	title: string;
	text: string;
	url: string;
	createdAt: string;
	isActive?: boolean;
	tags?: string[];
	content?: string;
	flowNodes?: { headingText: string; label: string }[];
}

type Tab = "edit" | "preview" | "flowchart" | "converse";



interface NoteEditorProps {
	highlight: NoteHighlight;
	onClose: () => void;
	onContentSaved?: (id: string, content: string) => void;
	saveEndpoint?: string;
}

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: "edit", label: "Edit" },
	{ id: "preview", label: "Preview" },
	{ id: "flowchart", label: "Flowchart" },
	{ id: "converse", label: "Converse" },
];

const NOTE_SUGGESTED_QUESTIONS = [
	"What are the key concepts in this note?",
	"Summarize this note briefly.",
	"What questions does this note leave unanswered?",
	"Explain the main ideas in simpler terms.",
];

export function NoteEditor({ highlight, onClose, onContentSaved, saveEndpoint = "/api/highlights" }: NoteEditorProps) {
	const [tab, setTab] = useState<Tab>("edit");
	const [content, setContent] = useState(highlight.content ?? highlight.text);
	const [flowNodes, setFlowNodes] = useState(highlight.flowNodes ?? []);
	const [isDirty, setIsDirty] = useState(false);
	const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
	const [isOrganizing, setIsOrganizing] = useState(false);

	// Converse state
	type ChatMsg = { role: "user" | "assistant"; content: string };
	const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
	const [chatInput, setChatInput] = useState("");
	const [isChatLoading, setIsChatLoading] = useState(false);
	const [chatError, setChatError] = useState<string | null>(null);
	const chatBottomRef = useRef<HTMLDivElement>(null);
	const chatInputRef = useRef<HTMLInputElement>(null);

	const editorRef = useRef<HTMLTextAreaElement>(null);
	const contentRef = useRef(content);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync contentRef with state
	useEffect(() => { contentRef.current = content; }, [content]);

	// Reset when highlight changes
	useEffect(() => {
		setContent(highlight.content ?? highlight.text);
		setFlowNodes(highlight.flowNodes ?? []);
		setIsDirty(false);
		setSaveStatus("saved");
		setTab("edit");
		setChatMessages([]);
		setChatInput("");
		setChatError(null);
	}, [highlight.id]); // eslint-disable-line react-hooks/exhaustive-deps

	const doSave = useCallback(async (val: string) => {
		setSaveStatus("saving");
		try {
			const res = await fetch(saveEndpoint, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: highlight.id, content: val }),
			});
			if (!res.ok) throw new Error("save failed");
			setIsDirty(false);
			setSaveStatus("saved");
			onContentSaved?.(highlight.id, val);
		} catch {
			setSaveStatus("error");
		}
	}, [highlight.id, saveEndpoint, onContentSaved]);

	const handleChange = (val: string) => {
		setContent(val);
		setIsDirty(true);
		setSaveStatus("unsaved");
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => { void doSave(val); }, 2000);
	};

	// Scroll editor to charOffset (switches to Edit tab first)
	const scrollToOffset = useCallback((charOffset: number) => {
		setTab("edit");
		setTimeout(() => {
			const el = editorRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(charOffset, charOffset);
			const before = contentRef.current.slice(0, charOffset);
			const lines = before.split("\n").length;
			el.scrollTop = Math.max(0, (lines - 3) * 24);
		}, 80);
	}, []);

	// Toolbar: insert markdown at cursor
	const insertAt = (before: string, after = "", placeholder = "text") => {
		const el = editorRef.current;
		if (!el) return;
		const s = el.selectionStart;
		const e = el.selectionEnd;
		const sel = content.slice(s, e) || placeholder;
		const next = content.slice(0, s) + before + sel + after + content.slice(e);
		handleChange(next);
		setTimeout(() => {
			el.setSelectionRange(s + before.length, s + before.length + sel.length);
			el.focus();
		}, 10);
	};

	const handleOrganize = async () => {
		setIsOrganizing(true);
		try {
			// First save current content, then ask GPT-OSS (Groq) to organize
			await doSave(content);
			const res = await fetch("/api/notes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: highlight.id }),
			});
			if (!res.ok) throw new Error("organize failed");
			const json = (await res.json()) as { data?: { content?: string; flowNodes?: { headingText: string; label: string }[] } };
			const organized = json.data?.content;
			if (organized) {
				setContent(organized);
				setFlowNodes(json.data?.flowNodes ?? []);
				setIsDirty(false);
				setSaveStatus("saved");
				onContentSaved?.(highlight.id, organized);
			}
		} catch {
			setSaveStatus("error");
		} finally {
			setIsOrganizing(false);
		}
	};


	// Auto-scroll chat on new messages
	useEffect(() => {
		chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [chatMessages, isChatLoading]);

	const handleChatSend = async (text?: string) => {
		const trimmed = (text ?? chatInput).trim();
		if (!trimmed || isChatLoading) return;

		const newMsgs: ChatMsg[] = [...chatMessages, { role: "user", content: trimmed }];
		setChatMessages(newMsgs);
		setChatInput("");
		setIsChatLoading(true);
		setChatError(null);

		try {
			const res = await fetch(`/api/notes/${encodeURIComponent(highlight.id)}/converse`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages: newMsgs }),
			});
			const data = (await res.json()) as { reply?: string; error?: string };
			if (!res.ok || data.error) throw new Error(data.error ?? "No response from AI");
			setChatMessages((prev) => [...prev, { role: "assistant", content: data.reply! }]);
		} catch (err) {
			setChatError(err instanceof Error ? err.message : "Failed to get a response. Please try again.");
			setChatMessages(chatMessages); // rollback
		} finally {
			setIsChatLoading(false);
			chatInputRef.current?.focus();
		}
	};

	const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

	const statusInfo = {
		saved: { label: "Saved", cls: "text-green-600 dark:text-green-400" },
		unsaved: { label: "Unsaved changes", cls: "text-yellow-600 dark:text-yellow-400" },
		saving: { label: "Saving…", cls: "text-blue-500" },
		error: { label: "Save failed", cls: "text-red-500" },
	}[saveStatus];

	return (
		<div className="flex min-w-0 w-full flex-col h-full overflow-hidden">
			{/* â”€â”€ Header â”€â”€ */}
			<div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
				<div className="flex-1 min-w-0">
					<h2 className="text-xl font-semibold text-foreground truncate">{highlight.title}</h2>
					<a
						href={highlight.url.startsWith("http") ? highlight.url : `https://${highlight.url}`}
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-verdant-600 hover:underline truncate block mt-0.5"
					>
						{highlight.url}
					</a>
				</div>
				<div className="flex items-center gap-2 shrink-0 pt-0.5">
					<span className={`text-xs font-medium ${statusInfo.cls}`}>{statusInfo.label}</span>
					<Button
						size="sm"
						variant="outline"
						className="h-8 rounded-full px-3 text-xs gap-1.5"
						onClick={() => void handleOrganize()}
						disabled={isOrganizing}
						title="Organize with GPT-OSS (Groq)"
					>
						{isOrganizing ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
						{isOrganizing ? "Organizing…" : "Organize"}
					</Button>
					<Button
						size="sm"
						className="h-8 rounded-full px-3 text-xs gap-1.5"
						onClick={() => void doSave(content)}
						disabled={saveStatus === "saving" || !isDirty}
					>
						<Save className="size-3.5" />
						Save
					</Button>
					<button
						type="button"
						onClick={onClose}
						className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors"
						aria-label="Close editor"
					>
						<X className="size-4" />
					</button>
				</div>
			</div>

			{/* â”€â”€ Tabs â”€â”€ */}
			<div className="flex gap-1 py-2 shrink-0">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
							tab === t.id
								? "bg-verdant-600 text-white"
								: "text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* â”€â”€ Toolbar (edit only) â”€â”€ */}
			{tab === "edit" && (
				<div className="flex items-center gap-0.5 pb-2 border-b border-gray-100 dark:border-slate-700 shrink-0">
					{[
						{ icon: Heading1, label: "H1", action: () => insertAt("# ", "", "Heading 1") },
						{ icon: Heading2, label: "H2", action: () => insertAt("## ", "", "Heading 2") },
						{ icon: Bold, label: "Bold", action: () => insertAt("**", "**", "bold text") },
						{ icon: Italic, label: "Italic", action: () => insertAt("*", "*", "italic text") },
						{ icon: List, label: "List", action: () => insertAt("- ", "", "list item") },
						{ icon: Code, label: "Code", action: () => insertAt("`", "`", "code") },
					].map(({ icon: Icon, label, action }) => (
						<button
							key={label}
							type="button"
							onClick={action}
							title={label}
							className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
						>
							<Icon className="size-4" />
						</button>
					))}
					<span className="ml-auto text-xs text-gray-400 dark:text-slate-500 pr-1">
						{wordCount} words
					</span>
				</div>
			)}

			{/* â”€â”€ Content area â”€â”€ */}
			<div className={`flex-1 min-h-0 mt-1 ${tab === "converse" ? "flex flex-col overflow-hidden" : "overflow-auto"}`}>
				{tab === "edit" && (
					<textarea
						ref={editorRef}
						value={content}
						onChange={(e) => handleChange(e.target.value)}
						className="w-full h-full min-h-[320px] resize-none bg-transparent text-sm leading-7 text-gray-800 dark:text-slate-200 outline-none p-2 font-sans placeholder:text-gray-300 dark:placeholder:text-slate-600"
						placeholder={"Start writing your note...\n\nUse # Heading 1, ## Heading 2, **bold**, *italic*, - list items"}
						spellCheck
					/>
				)}

			{tab === "preview" && (
				<article className="overflow-y-auto p-3 text-gray-800 dark:text-slate-200">
					<Markdown content={content} />
				</article>
			)}

				{tab === "flowchart" && (
					<div className="p-2">
						<p className="text-xs text-gray-400 dark:text-slate-500 mb-4">
							Click any node to jump to that section. Use Organize to generate a topic-structured chart.
						</p>
					<NoteFlowchart content={content} flowNodes={flowNodes} onNodeClick={scrollToOffset} />
					</div>
				)}

				{tab === "converse" && (
					<>
					{/* Messages area */}
					<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 space-y-3">
							{chatMessages.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-10 text-center">
									<div className="mb-3 rounded-full bg-verdant-50 p-3 dark:bg-emerald-900/20">
										<MessageSquare className="size-6 text-verdant-500 dark:text-verdant-400" />
									</div>
									<p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
										Ask anything about this note
									</p>
									<p className="mt-1 max-w-xs text-xs text-gray-400 dark:text-slate-500">
										Answers are strictly within the note content. Say{" "}
										<span className="font-medium text-gray-500 dark:text-slate-400">
											&ldquo;outside pov&rdquo;
										</span>{" "}
										to get broader context.
									</p>
									<div className="mt-4 flex flex-wrap justify-center gap-2">
										{NOTE_SUGGESTED_QUESTIONS.map((q) => (
											<button
												key={q}
												type="button"
												onClick={() => void handleChatSend(q)}
												className="rounded-full border border-verdant-200 bg-verdant-50 px-3 py-1.5 text-xs font-medium text-verdant-700 transition-colors hover:bg-verdant-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-verdant-400 dark:hover:bg-emerald-900/40"
											>
												{q}
											</button>
										))}
									</div>
								</div>
							) : (
								chatMessages.map((msg, i) => (
									<div
										key={i}
										className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
									>
								<div
									className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] ${
										msg.role === "user"
											? "max-w-[72%] rounded-br-sm bg-verdant-600 text-white dark:bg-verdant-700"
											: "max-w-[82%] rounded-bl-sm border border-gray-100 bg-white text-gray-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
									}`}
								>
										{msg.role === "assistant"
											? <Markdown content={msg.content} compact />
											: <p className="break-words">{msg.content}</p>
										}
									</div>
									</div>
								))
							)}

							{/* Loading indicator */}
							{isChatLoading && (
								<div className="flex justify-start">
									<div className="rounded-2xl rounded-bl-sm border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
										<div className="flex items-center gap-1">
											<span className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400" style={{ animationDelay: "0ms" }} />
											<span className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400" style={{ animationDelay: "150ms" }} />
											<span className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400" style={{ animationDelay: "300ms" }} />
										</div>
									</div>
								</div>
							)}

							{/* Error */}
							{chatError && (
								<div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
									<AlertCircle className="mt-0.5 size-3.5 flex-shrink-0" />
									{chatError}
								</div>
							)}

							<div ref={chatBottomRef} />
						</div>

						{/* Input bar */}
						<div className="border-t border-gray-100 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800 shrink-0">
							<div className="flex gap-2">
								<Input
									ref={chatInputRef}
									value={chatInput}
									onChange={(e) => setChatInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											void handleChatSend();
										}
									}}
									placeholder="Ask about this note…"
									disabled={isChatLoading}
									className="flex-1 rounded-full border-gray-200 text-sm dark:border-slate-600 dark:bg-slate-700"
								/>
								<Button
									onClick={() => void handleChatSend()}
									disabled={!chatInput.trim() || isChatLoading}
									size="sm"
									className="h-9 w-9 flex-shrink-0 rounded-full bg-verdant-600 p-0 text-white hover:bg-verdant-700 disabled:opacity-50"
								>
									<Send className="size-4" />
								</Button>
							</div>
							<p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
								Answers based on note content only Â· &ldquo;outside pov&rdquo; unlocks broader knowledge
							</p>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
