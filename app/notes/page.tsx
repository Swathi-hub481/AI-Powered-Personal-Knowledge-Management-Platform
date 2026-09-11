"use client";

import { useEffect, useRef, useState } from "react";
// Badge replaced with plain spans for custom styling
import { Button } from "@/components/ui/button";
// Card components replaced with plain divs for custom cottage-core styling
import { Input } from "@/components/ui/input";
import { BookOpen, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { NoteEditor, type NoteHighlight } from "@/components/note-editor";


interface ConsolidatedNote {
	id: string;
	url: string;
	title: string;
	content: string;
	rawHighlights: string[];
	tags: string[];
	createdAt: string;
	updatedAt: string;
	flowNodes?: { headingText: string; label: string }[];
}

interface NotesResponse {
	data: ConsolidatedNote[];
}



function formatDate(dateValue: string) {
	const d = new Date(dateValue);
	if (Number.isNaN(d.getTime())) return "Unknown date";
	return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function toHref(url: string) {
	if (!url) return "#";
	return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function notePreview(note: ConsolidatedNote): string {
	const src = note.content || note.rawHighlights[0] || "";
	const plain = src
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/`(.+?)`/g, "$1")
		.replace(/^[-*]\s+/gm, "")
		.replace(/\n{2,}/g, " ")
		.replace(/\n/g, " ")
		.trim();
	return plain.length > 130 ? plain.slice(0, 130) + "\u2026" : plain;
}

function noteToEditorHighlight(note: ConsolidatedNote): NoteHighlight {
	return {
		id: note.id,
		title: note.title,
		text: note.rawHighlights[0] ?? note.content,
		url: note.url,
		createdAt: note.updatedAt,
		content: note.content,
		tags: note.tags,
		flowNodes: note.flowNodes,
	};
}


export default function NotesPage() {
	const [notes, setNotes] = useState<ConsolidatedNote[]>([]);
	const [selectedNote, setSelectedNote] = useState<ConsolidatedNote | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSyncing, setIsSyncing] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [activeTag, setActiveTag] = useState<string>("All");
	const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [notionToken, setNotionToken] = useState<string | null>(null);
	const [notionPushState, setNotionPushState] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [notionPushUrl, setNotionPushUrl] = useState<string | null>(null);
	const [notionPushError, setNotionPushError] = useState<string | null>(null);

	const normalizedQuery = searchQuery.trim().toLowerCase();

	// Derive the available tag list from actual note data (no hardcoded list)
	const availableTags: string[] = ["All", ...Array.from(
		new Set(notes.flatMap((n) => n.tags).filter((t) => t && t.trim()))
	).sort()];

	const tagFiltered = notes.filter((note) => {
		if (activeTag === "All") return true;
		return note.tags.includes(activeTag);
	});

	const filtered = tagFiltered.filter((note) => {
		if (!normalizedQuery) return true;
		const searchable = [note.title, note.content, note.url].join(" ").toLowerCase();
		return searchable.includes(normalizedQuery);
	});

	const isTagEmpty = activeTag !== "All" && tagFiltered.length === 0;
	const isSearchEmpty = !isTagEmpty && normalizedQuery.length > 0 && filtered.length === 0;
	const displayed = isTagEmpty || isSearchEmpty ? [] : filtered;

	const fetchNotes = async (showSpinner = false) => {
		if (showSpinner) setIsSyncing(true);
		try {
			const res = await fetch("/api/notes", { cache: "no-store" });
			if (!res.ok) throw new Error("fetch failed");
			const result = (await res.json()) as NotesResponse;
			const fetched = Array.isArray(result.data) ? result.data : [];
			setNotes(fetched);
		} catch {
			if (showSpinner) setNotes([]);
		} finally {
			setIsLoading(false);
			if (showSpinner) setIsSyncing(false);
		}
	};

	// Load Notion token once so we can show/hide the Export button
	useEffect(() => {
		void fetch("/api/preferences", { cache: "no-store" })
			.then((r) => r.json())
			.then((j: { data?: { notionToken?: string } }) => {
				setNotionToken(j.data?.notionToken ?? null);
			})
			.catch(() => {/* ignore */});
	}, []);

	useEffect(() => {
		let mounted = true;

		const poll = async () => {
			if (!mounted) return;
			try {
				const res = await fetch("/api/notes", { cache: "no-store" });
				if (!res.ok || !mounted) return;
				const result = (await res.json()) as NotesResponse;
				const fetched = Array.isArray(result.data) ? result.data : [];
				setNotes(fetched);
				setIsLoading(false);
			} catch {
				if (mounted) setIsLoading(false);
			}
		};

		void poll();
		const interval = window.setInterval(() => void poll(), 5000);
		return () => {
			mounted = false;
			window.clearInterval(interval);
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const selectNote = (note: ConsolidatedNote) => {
		setSelectedNote(note);
		setNotionPushState("idle");
		setNotionPushUrl(null);
		setNotionPushError(null);
	};

	const handleContentSaved = (id: string, content: string) => {
		setNotes((prev) =>
			prev.map((n) => (n.id === id ? { ...n, content, updatedAt: new Date().toISOString() } : n))
		);
		setSelectedNote((prev) => (prev?.id === id ? { ...prev, content } : prev));
	};

	/** First click arms confirmation (button turns red); second click within 3 s deletes. */
	const handleDeleteClick = (e: React.MouseEvent, noteId: string) => {
		e.stopPropagation();
		if (confirmDeleteId === noteId) {
			// Second click — execute delete
			if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
			setConfirmDeleteId(null);
			void (async () => {
				setDeletingNoteId(noteId);
				try {
					await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
					setNotes((prev) => prev.filter((n) => n.id !== noteId));
					setSelectedNote((prev) => (prev?.id === noteId ? null : prev));
				} finally {
					setDeletingNoteId(null);
				}
			})();
		} else {
			// First click — arm
			if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
			setConfirmDeleteId(noteId);
			confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
		}
	};

	const handleExportToNotion = async (noteId: string) => {
		setNotionPushState("loading");
		setNotionPushUrl(null);
		setNotionPushError(null);
		try {
			const res = await fetch("/api/notion/push-note", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ noteId }),
			});
			const json = (await res.json()) as { url?: string; error?: string };
			if (!res.ok) throw new Error(json.error ?? "Export failed");
			setNotionPushUrl(json.url ?? null);
			setNotionPushState("success");
		} catch (err) {
			setNotionPushError(err instanceof Error ? err.message : "Export failed");
			setNotionPushState("error");
		}
	};

	const noResultsMessage = isTagEmpty ? "No notes tagged with this topic." : "No matching notes.";

	return (
		<div className="flex h-full max-h-full min-h-0 flex-col overflow-hidden">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden xl:flex-row xl:items-stretch">
				{/* â”€â”€ Sidebar: fixed header + scrollable note list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
				<div className="flex min-h-0 w-full max-h-[min(100dvh-5.5rem,56rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14] xl:w-[360px] xl:max-h-none xl:self-stretch">
					<div className="shrink-0 space-y-4 px-5 pt-5">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div className="flex size-7 items-center justify-center rounded-lg bg-[#d4e8d0] dark:bg-[#1e3a28]">
									<BookOpen className="size-3.5 text-[#3a6b45] dark:text-[#6bbf7e]" />
								</div>
								<h2 className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Notes</h2>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-xs text-[#8ab490] dark:text-[#4a7054]">
									{isLoading ? "Loading…" : `${displayed.length} note${displayed.length !== 1 ? "s" : ""}`}
								</span>
								<button
									type="button"
									className="rounded-full border border-[#cde0c9] bg-[#f5f7f2] px-2.5 py-1 text-[0.7rem] font-medium text-[#3a6b45] hover:bg-[#eef6ec] disabled:opacity-50 dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#90c898]"
									onClick={() => void fetchNotes(true)}
									disabled={isLoading || isSyncing}
								>
									{isSyncing ? "Syncing…" : "Sync"}
								</button>
							</div>
						</div>

						<div className="relative">
							<Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-[#8ab490] dark:text-[#4a7054]" />
							<Input
								className="h-9 rounded-full border-[#cde0c9] bg-[#f5f7f2] pl-9 text-sm text-[#2c4a35] shadow-none placeholder:text-[#8ab490] focus-visible:ring-2 focus-visible:ring-[#4a9456] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#c8e6cb]"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search notes…"
								type="text"
							/>
						</div>

						<div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
							{availableTags.map((tag) => {
								const isActive = activeTag === tag;
								return (
									<button
										key={tag}
										type="button"
										onClick={() => setActiveTag(tag)}
										className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
											isActive
												? "bg-[#4a9456] text-white dark:bg-[#5aaa66]"
												: "border border-[#cde0c9] bg-white text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:bg-[#111d14] dark:text-[#90c898] dark:hover:bg-[#1a2e1e]"
										}`}
									>
										{tag}
									</button>
								);
							})}
						</div>
					</div>

					<div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 [-webkit-overflow-scrolling:touch]">
						<div className="space-y-2 pr-1">
							{isLoading ? (
								<p className="rounded-xl border border-dashed border-[#cde0c9] p-4 text-sm text-[#6a9470] dark:border-[#2a4030] dark:text-[#5a8060]">
									Loading notes…
								</p>
							) : notes.length === 0 ? (
								<p className="rounded-xl border border-dashed border-[#cde0c9] p-4 text-sm text-[#6a9470] dark:border-[#2a4030] dark:text-[#5a8060]">
									No notes yet. Highlight text on any web page to create your first note.
								</p>
							) : isTagEmpty || isSearchEmpty ? (
								<p className="rounded-xl border border-dashed border-[#cde0c9] p-4 text-sm text-[#6a9470] dark:border-[#2a4030] dark:text-[#5a8060]">
									{noResultsMessage}
								</p>
							) : (
								displayed.map((note) => (
									<article
										key={note.id}
										className={`cursor-pointer rounded-xl border p-3.5 transition-all duration-150 ${
											selectedNote?.id === note.id
												? "border-[#4a9456] bg-[#eef6ec] dark:border-[#5aaa66] dark:bg-[#1a2e1e]"
												: "border-transparent hover:border-[#cde0c9] hover:bg-[#f7fbf6] dark:hover:border-[#2a4030] dark:hover:bg-[#131f15]"
										}`}
										onClick={() => selectNote(note)}
									>
										<div className="space-y-1.5">
											<div className="flex items-start justify-between gap-2">
												<h3 className="text-sm font-semibold leading-snug text-[#2c4a35] dark:text-[#c8e6cb]">
													{note.title}
												</h3>
												<div className="flex shrink-0 items-center gap-1.5">
													{note.rawHighlights.length > 1 && (
														<span className="rounded-full bg-[#e0f0dc] px-2 py-0.5 text-[10px] font-semibold text-[#3a6b45] dark:bg-[#1a3020] dark:text-[#90c898]">
															{note.rawHighlights.length} highlights
														</span>
													)}
													<button
														type="button"
														title={confirmDeleteId === note.id ? "Click again to confirm" : "Delete note"}
														disabled={deletingNoteId === note.id}
														onClick={(e) => handleDeleteClick(e, note.id)}
														className={`rounded-full p-1 transition-colors ${
															confirmDeleteId === note.id
																? "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400"
																: "text-[#b0c8b4] hover:bg-[#fce8e8] hover:text-red-500 dark:text-[#2a4030] dark:hover:bg-red-900/30 dark:hover:text-red-400"
														}`}
													>
														<Trash2 className="size-3.5" />
													</button>
												</div>
											</div>

											<p className="line-clamp-2 text-xs leading-relaxed text-[#5a8a63] dark:text-[#6a9070]">
												{notePreview(note)}
											</p>

											{note.tags.length > 0 && (
												<div className="flex flex-wrap gap-1">
													{[...note.tags].sort().map((tag) => (
														<span
															key={tag}
															className="rounded-full bg-[#eef6ec] px-2 py-0.5 text-[10px] font-medium text-[#5a8a63] dark:bg-[#1a2e1e] dark:text-[#7ab882]"
														>
															{tag}
														</span>
													))}
												</div>
											)}

											<div className="flex items-center justify-between gap-2">
												<a
													href={toHref(note.url)}
													target="_blank"
													rel="noopener noreferrer"
													title={note.url}
													className="min-w-0"
													onClick={(e) => e.stopPropagation()}
												>
													<span className="block max-w-[180px] truncate rounded-full bg-[#f0f8ee] px-2 py-0.5 text-[10px] font-medium text-[#5a8a63] hover:bg-[#e0f0dc] dark:bg-[#1a2e1e] dark:text-[#7ab882]">
														{note.url.replace(/^https?:\/\/(www\.)?/, "")}
													</span>
												</a>
												<span className="shrink-0 text-[10px] text-[#8ab490] dark:text-[#4a7054]">
													{formatDate(note.updatedAt)}
												</span>
											</div>
										</div>
									</article>
								))
							)}
						</div>
					</div>
				</div>

				{/* â”€â”€ Editor / placeholder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
				<div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
					<div className="flex h-full min-w-0 flex-col p-4 md:p-5">
						{selectedNote ? (
							<>
								{notionToken && (
									<div className="mb-3 flex items-center justify-between rounded-xl border border-[#e0edd9] bg-[#f7fbf6] px-3 py-2 dark:border-[#1e3020] dark:bg-[#0d1a10]">
										<span className="text-xs text-[#5a8a63] dark:text-[#6bbf7e]">
											Export this note to Notion
										</span>
										<div className="flex items-center gap-2">
											{notionPushState === "success" && notionPushUrl && (
												<a
													href={notionPushUrl}
													target="_blank"
													rel="noreferrer"
													className="flex items-center gap-1 text-xs text-[#4a9456] underline dark:text-[#6bbf7e]"
												>
													Open in Notion <ExternalLink className="size-3" />
												</a>
											)}
											{notionPushState === "error" && notionPushError && (
												<span className="max-w-[220px] truncate text-xs text-red-500" title={notionPushError}>
													{notionPushError}
												</span>
											)}
											<Button
												size="sm"
												variant="outline"
												className="h-7 rounded-full border-[#cde0c9] px-3 text-xs text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898]"
												disabled={notionPushState === "loading"}
												onClick={() => void handleExportToNotion(selectedNote.id)}
											>
												{notionPushState === "loading" ? "Exporting…" : notionPushState === "success" ? "Export again" : "Export to Notion"}
											</Button>
										</div>
									</div>
								)}
								<div className="flex flex-1 min-h-0 flex-col">
									<NoteEditor
										highlight={noteToEditorHighlight(selectedNote)}
										onClose={() => setSelectedNote(null)}
										onContentSaved={handleContentSaved}
										saveEndpoint="/api/notes"
									/>
								</div>
							</>
						) : (
							<div className="flex flex-1 items-center justify-center min-h-[360px]">
								<div className="space-y-3 text-center">
									<div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#e4f3e0] dark:bg-[#1a3020]">
										<BookOpen className="size-6 text-[#4a9456] dark:text-[#6bbf7e]" />
									</div>
									<h2 className="text-xl font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">Select a note to read</h2>
									<p className="text-sm text-[#6a9470] dark:text-[#5a8060]">
										{isLoading
											? "Loading your notes…"
											: `${notes.length} note${notes.length !== 1 ? "s" : ""} from ${notes.length} source${notes.length !== 1 ? "s" : ""}`}
									</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
