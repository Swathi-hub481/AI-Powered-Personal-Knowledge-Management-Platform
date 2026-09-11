"use client";

/**
 * Meet hub: browse sessions, read transcripts and summaries, manage action items
 * (including sending some to Notion), and ask questions grounded in one session.
 * New sessions come from file upload or in-browser recording.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import {
	AlertCircle,
	CheckCheck,
	ChevronRight,
	Clock,
	ExternalLink,
	FileAudio,
	FileText,
	Loader2,
	MessageSquare,
	Mic,
	Plus,
	RotateCcw,
	Send,
	Square,
	Trash2,
	Upload,
	User,
	Users,
	WandSparkles,
	X,
} from "lucide-react";

interface TranscriptUtterance {
	speaker: string;
	start: number;
	end: number;
	text: string;
}

interface MeetParticipant {
	speakerLabel: string;
	speakerName: string | null;
	role: string;
	participationLevel: "active" | "moderate" | "passive";
}

interface ActionItem {
	id: string;
	text: string;
	assignedTo: string;
	priority: "high" | "medium" | "low";
	/** "user" = specifically for the user; "general" = team/group goal or collective commitment */
	category: "user" | "general";
	done: boolean;
}

interface MeetSession {
	id: string;
	title: string;
	userName: string;
	type: "upload" | "recording";
	status: "transcribing" | "ready" | "error";
	fileName: string;
	fileSize: number;
	createdAt: string;
	updatedAt: string;
	duration: number;
	transcript: TranscriptUtterance[];
	deepgramSummary: string | null;
	summary: string | null;
	sessionType: string | null;
	participants: MeetParticipant[] | null;
	userSpeaker: string | null;
	userNote: string | null;
	actionItems: ActionItem[] | null;
	summaryGeneratedAt: string | null;
	error: string | null;
	source?: "upload" | "google-drive";
}

const SPEAKER_COLORS = [
	"bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
	"bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
	"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	"bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
	"bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
	"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	"bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
	"bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
];

const SPEAKER_DOT_COLORS = [
	"bg-blue-500",
	"bg-violet-500",
	"bg-amber-500",
	"bg-rose-500",
	"bg-teal-500",
	"bg-orange-500",
	"bg-pink-500",
	"bg-cyan-500",
];

const PRIORITY_STYLES: Record<ActionItem["priority"], string> = {
	high: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
	medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
	low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const ACCEPTED_EXTENSIONS = ".mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus";

function formatDuration(seconds: number): string {
	if (!seconds || seconds <= 0) return "—";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatTimestamp(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRecordingTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getSpeakerIndex(speaker: string, speakers: string[]): number {
	const idx = speakers.indexOf(speaker);
	return idx === -1 ? 0 : idx;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: MeetSession["status"] }) {
	if (status === "ready")
		return (
			<Badge className="rounded-full bg-verdant-100 px-2 py-0.5 text-xs font-medium text-verdant-700 dark:bg-emerald-900/40 dark:text-emerald-300">
				Ready
			</Badge>
		);
	if (status === "transcribing")
		return (
			<Badge className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
				<Loader2 className="size-3 animate-spin" />
				Processing
			</Badge>
		);
	return (
		<Badge className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
			Error
		</Badge>
	);
}

function TypeBadge({ type }: { type: MeetSession["type"] }) {
	if (type === "recording")
		return (
			<Badge className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
				<Mic className="size-3" />
				Recorded
			</Badge>
		);
	return (
		<Badge className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
			<Upload className="size-3" />
			Uploaded
		</Badge>
	);
}

function DetailTab({
	active,
	onClick,
	label,
	badge,
	locked,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	badge?: number;
	locked?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={locked}
		className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
			active
				? "-mb-px border-b-2 border-[#4a9456] text-[#2c4a35] dark:border-[#5aaa66] dark:text-[#c8e6cb]"
				: "text-[#6a9470] hover:text-[#2c4a35] dark:text-[#5a8060] dark:hover:text-[#c8e6cb]"
		}`}
		>
			{label}
			{badge !== undefined && badge > 0 && (
				<span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
					{badge}
				</span>
			)}
		</button>
	);
}

function SessionListItem({
	session,
	isActive,
	onClick,
}: {
	session: MeetSession;
	isActive: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full rounded-xl px-3 py-3 text-left transition-all duration-150 ${
				isActive
					? "bg-verdant-50 ring-1 ring-verdant-200 dark:bg-slate-700 dark:ring-slate-500"
					: "hover:bg-gray-50 dark:hover:bg-slate-700/50"
			}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p
						className={`truncate text-sm font-medium ${
							isActive
								? "text-verdant-700 dark:text-verdant-400"
								: "text-gray-800 dark:text-slate-200"
						}`}
					>
						{session.title}
					</p>
					<p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
						{formatDate(session.createdAt)}
						{session.duration > 0 && (
							<span className="ml-1.5 text-gray-400 dark:text-slate-500">
								· {formatDuration(session.duration)}
							</span>
						)}
					</p>
				</div>
				<div className="mt-0.5 flex-shrink-0">
					<StatusBadge status={session.status} />
				</div>
			</div>
			<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
				<TypeBadge type={session.type} />
				{session.summaryGeneratedAt && (
					<Badge className="rounded-full bg-verdant-50 px-2 py-0.5 text-xs font-medium text-verdant-600 dark:bg-emerald-900/20 dark:text-emerald-400">
						<CheckCheck className="mr-1 inline size-3" />
						Summarized
					</Badge>
				)}
			</div>
		</button>
	);
}

function TranscriptView({
	transcript,
	userSpeaker,
}: {
	transcript: TranscriptUtterance[];
	userSpeaker: string | null;
}) {
	const uniqueSpeakers = [...new Set(transcript.map((u) => u.speaker))];

	if (transcript.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<FileAudio className="mb-3 size-10 text-gray-300 dark:text-slate-600" />
				<p className="text-sm text-gray-500 dark:text-slate-400">No transcript available</p>
			</div>
		);
	}

	return (
		<div>
			<div className="mb-5 flex flex-wrap gap-2">
				{uniqueSpeakers.map((speaker) => {
					const idx = getSpeakerIndex(speaker, uniqueSpeakers);
					const colorClass = SPEAKER_COLORS[idx % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
					const dotClass = SPEAKER_DOT_COLORS[idx % SPEAKER_DOT_COLORS.length] ?? SPEAKER_DOT_COLORS[0];
					const isUser = speaker === userSpeaker;
					return (
						<span
							key={speaker}
							className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}
						>
							<span className={`size-2 rounded-full ${dotClass}`} />
							{speaker}
							{isUser && (
								<span className="ml-0.5 rounded-full bg-verdant-200 px-1.5 py-0.5 text-[10px] font-semibold text-verdant-800 dark:bg-emerald-800 dark:text-emerald-200">
									You
								</span>
							)}
						</span>
					);
				})}
			</div>

			<div className="space-y-1">
				{transcript.map((utterance, idx) => {
					const speakerIdx = getSpeakerIndex(utterance.speaker, uniqueSpeakers);
					const colorClass =
						SPEAKER_COLORS[speakerIdx % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
					const dotClass =
						SPEAKER_DOT_COLORS[speakerIdx % SPEAKER_DOT_COLORS.length] ?? SPEAKER_DOT_COLORS[0];
					const isUser = utterance.speaker === userSpeaker;

					return (
						<div
							key={`${utterance.speaker}-${utterance.start}-${idx}`}
							className={`flex gap-3 rounded-xl px-3 py-3 transition-colors ${
								isUser
									? "bg-verdant-50/60 dark:bg-emerald-900/10"
									: "hover:bg-gray-50 dark:hover:bg-slate-700/30"
							}`}
						>
							<div className="mt-2 flex-shrink-0">
								<div className={`size-2.5 rounded-full ${dotClass}`} />
							</div>
							<div className="min-w-0 flex-1">
								<div className="mb-1 flex items-center gap-2">
									<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}>
										{utterance.speaker}
										{isUser && " (You)"}
									</span>
									<span className="font-mono text-[11px] text-gray-400 dark:text-slate-500">
										{formatTimestamp(utterance.start)}
									</span>
								</div>
								<p className="text-sm leading-relaxed text-gray-700 dark:text-slate-300">
									{utterance.text}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SummaryView({ session }: { session: MeetSession }) {
	const participantLabels = session.participants
		? session.participants.map((p) => p.speakerLabel)
		: [...new Set(session.transcript.map((u) => u.speaker))];

	if (!session.summary) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<WandSparkles className="mb-3 size-10 text-gray-300 dark:text-slate-600" />
				<p className="text-sm font-medium text-gray-600 dark:text-slate-400">
					Summary not generated yet
				</p>
				<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
					Click "Generate Summary" above to analyze this session with AI
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{session.sessionType && (
				<div className="flex items-center gap-2">
					<span className="text-sm text-gray-500 dark:text-slate-400">Session type:</span>
					<Badge className="rounded-full bg-verdant-100 px-3 py-1 text-xs font-semibold capitalize text-verdant-700 dark:bg-emerald-900/40 dark:text-emerald-300">
						{session.sessionType}
					</Badge>
				</div>
			)}

			{session.userNote && (
				<div className="rounded-xl border border-verdant-100 bg-verdant-50/60 p-4 dark:border-emerald-800/40 dark:bg-emerald-900/10">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 flex-shrink-0 rounded-full bg-verdant-200 p-1.5 dark:bg-emerald-800">
							<User className="size-3.5 text-verdant-700 dark:text-emerald-300" />
						</div>
						<div>
							<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-verdant-700 dark:text-emerald-400">
								Your Role
							</p>
							<p className="text-sm leading-relaxed text-gray-700 dark:text-slate-300">
								{session.userNote}
							</p>
						</div>
					</div>
				</div>
			)}

			{session.participants && session.participants.length > 0 && (
				<div>
					<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
						<Users className="size-4 text-gray-500 dark:text-slate-400" />
						Participants ({session.participants.length})
					</h3>
					<div className="grid gap-2 sm:grid-cols-2">
						{session.participants.map((p) => {
							const idx = getSpeakerIndex(p.speakerLabel, participantLabels);
							const colorClass = SPEAKER_COLORS[idx % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0];
							const dotClass = SPEAKER_DOT_COLORS[idx % SPEAKER_DOT_COLORS.length] ?? SPEAKER_DOT_COLORS[0];
							const isUser = p.speakerLabel === session.userSpeaker;

							return (
								<div
									key={p.speakerLabel}
									className={`flex items-start gap-3 rounded-xl border p-3 ${
										isUser
											? "border-verdant-200 bg-verdant-50 dark:border-emerald-700 dark:bg-emerald-900/10"
											: "border-gray-100 bg-white dark:border-slate-700 dark:bg-slate-800"
									}`}
								>
									<div
										className={`mt-1 size-2.5 flex-shrink-0 rounded-full ${dotClass}`}
									/>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-1.5">
											<span
												className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
											>
												{p.speakerLabel}
												{isUser && " (You)"}
											</span>
											{p.speakerName && (
												<span className="text-sm font-medium text-gray-700 dark:text-slate-300">
													{p.speakerName}
												</span>
											)}
										</div>
										<p className="mt-0.5 text-xs capitalize text-gray-500 dark:text-slate-400">
											{p.role}
										</p>
										<span
											className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
												p.participationLevel === "active"
													? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
													: p.participationLevel === "moderate"
														? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
														: "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300"
											}`}
										>
											{p.participationLevel}
										</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<div>
				<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
					<WandSparkles className="size-4 text-verdant-600 dark:text-verdant-400" />
					Summary
				</h3>
			<div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 overflow-x-auto">
				<Markdown
					content={session.summary}
					className="text-gray-700 dark:text-slate-300"
				/>
			</div>
			</div>
		</div>
	);
}

function ActionItemCard({
	item,
	onToggle,
	notionSelected,
	onNotionSelect,
	showNotionSelect,
}: {
	item: ActionItem;
	onToggle: (id: string, done: boolean) => void;
	notionSelected?: boolean;
	onNotionSelect?: (id: string, selected: boolean) => void;
	showNotionSelect?: boolean;
}) {
	return (
		<div
			className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
				notionSelected
					? "ring-1 ring-indigo-300 dark:ring-indigo-600"
					: ""
			} ${
				item.done
					? "border-gray-100 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50"
					: item.priority === "high"
						? "border-rose-100 bg-rose-50/60 shadow-sm dark:border-rose-900/30 dark:bg-rose-900/10"
						: item.priority === "medium"
							? "border-amber-100 bg-amber-50/60 dark:border-amber-900/30 dark:bg-amber-900/10"
							: "border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
			}`}
		>
			<button
				type="button"
				onClick={() => onToggle(item.id, !item.done)}
				className="mt-0.5 flex-shrink-0"
				aria-label={item.done ? "Mark as pending" : "Mark as done"}
			>
				<div
					className={`flex size-4.5 items-center justify-center rounded border-2 transition-colors ${
						item.done
							? "border-verdant-500 bg-verdant-500 dark:border-verdant-400 dark:bg-verdant-400"
							: "border-gray-300 hover:border-verdant-400 dark:border-slate-500"
					}`}
				>
					{item.done && (
						<svg
							className="size-2.5 text-white"
							fill="none"
							viewBox="0 0 12 12"
							stroke="currentColor"
							strokeWidth={2.5}
						>
							<path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					)}
				</div>
			</button>

			<div className="min-w-0 flex-1">
				<p
					className={`text-sm leading-relaxed ${
						item.done
							? "text-gray-400 line-through dark:text-slate-500"
							: "text-gray-800 dark:text-slate-200"
					}`}
				>
					{item.text}
				</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
					<span
						className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[item.priority]}`}
					>
						{item.priority}
					</span>
					{item.assignedTo && item.assignedTo !== "unknown" && (
						<span className="text-[11px] text-gray-500 dark:text-slate-400">
							· {item.assignedTo}
						</span>
					)}
				</div>
			</div>

			{showNotionSelect && onNotionSelect && (
				<button
					type="button"
					onClick={() => onNotionSelect(item.id, !notionSelected)}
					className="mt-0.5 flex-shrink-0"
					aria-label={notionSelected ? "Deselect for Notion" : "Select for Notion"}
					title={notionSelected ? "Remove from Notion send" : "Add to Notion send"}
				>
					<div
						className={`flex size-4.5 items-center justify-center rounded border-2 transition-colors ${
							notionSelected
								? "border-indigo-500 bg-indigo-500 dark:border-indigo-400 dark:bg-indigo-400"
								: "border-indigo-200 hover:border-indigo-400 dark:border-indigo-700 dark:hover:border-indigo-500"
						}`}
					>
						{notionSelected && (
							<NotionIconSmall className="size-2.5 text-white" />
						)}
					</div>
				</button>
			)}
		</div>
	);
}

function NotionIconSmall({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 100 100" className={className} aria-hidden="true">
			<path
				d="M6 4.8C9.4 7.6 10.7 7.4 13.3 7.2l51.2-3.4c.5 0 .1-.5-.1-.5L53.8.5c-2.2-.3-4.5-.2-6.8.1L6.4 4.3C5.8 4.4 5.5 4.5 6 4.8zM8 14.5v51.6c0 2.8 1.4 3.9 4.5 3.7l56.2-3.2c3.1-.2 3.5-2.1 3.5-4.4V10.9c0-2.3-1-3.6-3.1-3.4L11.2 11c-2.3.2-3.2 1.5-3.2 3.5zm55.1 4.1c.3 1.4 0 2.8-1.4 3l-2.2.4v32.4c-1.9 1-3.7 1.6-5.2 1.6-2.4 0-3-.7-4.8-2.9L32 29v28.2l5.4 1.2s0 2.8-3.9 2.8L22.1 62c-.3-1.4 0-2.9 1-3.3l2.6-.7V24.2L22.2 24c-.3-1.4.4-3.4 2.5-3.5L38.1 19.7l18.4 28.1V21l-4.5-.5c-.3-1.7 1-2.9 2.5-3L63.1 18.6z"
				fill="currentColor"
			/>
		</svg>
	);
}

interface NotionPageItem {
	id: string;
	title: string;
	icon: string | null;
	parentId: string | null;
	hasChildren: boolean;
}

/** Picks a Notion parent page: loads top level pages first, expands children on demand, can create a page inline. */
function NotionPagePicker({
	defaultPageId,
	count,
	onConfirm,
	onCancel,
}: {
	defaultPageId: string;
	count: number;
	onConfirm: (pageId: string) => void;
	onCancel: () => void;
}) {
	const [roots, setRoots] = useState<NotionPageItem[]>([]);
	const [childMap, setChildMap] = useState<Map<string, NotionPageItem[]>>(new Map());
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
	const [selectedId, setSelectedId] = useState(defaultPageId);
	const [rootLoading, setRootLoading] = useState(true);
	const [rootError, setRootError] = useState<string | null>(null);

	const [showCreate, setShowCreate] = useState(false);
	const [createTitle, setCreateTitle] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/notion/pages", { cache: "no-store" });
				const json = (await res.json()) as { pages?: NotionPageItem[]; error?: string };
				if (json.error) throw new Error(json.error);
				setRoots(json.pages ?? []);
			} catch (err) {
				setRootError(err instanceof Error ? err.message : "Could not load pages");
			} finally {
				setRootLoading(false);
			}
		})();
	}, []);

	const loadChildren = async (pageId: string) => {
		if (childMap.has(pageId)) return;
		setLoadingIds((prev) => new Set(prev).add(pageId));
		try {
			const res = await fetch(`/api/notion/pages?parentId=${pageId}`, { cache: "no-store" });
			const json = (await res.json()) as { pages?: NotionPageItem[] };
			setChildMap((prev) => new Map(prev).set(pageId, json.pages ?? []));
		} finally {
			setLoadingIds((prev) => { const n = new Set(prev); n.delete(pageId); return n; });
		}
	};

	const toggleExpand = async (id: string) => {
		if (expandedIds.has(id)) {
			setExpandedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
		} else {
			await loadChildren(id);
			setExpandedIds((prev) => new Set(prev).add(id));
		}
	};

	const handleCreate = async () => {
		if (!createTitle.trim()) return;
		setIsCreating(true);
		setCreateError(null);
		try {
			const res = await fetch("/api/notion/pages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: createTitle.trim(), parentId: selectedId || null }),
			});
			const json = (await res.json()) as { page?: NotionPageItem; error?: string };
			if (!res.ok || !json.page) throw new Error(json.error ?? "Failed to create page");
			const newPage = json.page;
			if (selectedId) {
				setChildMap((prev) => new Map(prev).set(selectedId, [...(prev.get(selectedId) ?? []), newPage]));
				setExpandedIds((prev) => new Set(prev).add(selectedId));
			} else {
				setRoots((prev) => [...prev, newPage]);
			}
			setSelectedId(newPage.id);
			setShowCreate(false);
			setCreateTitle("");
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "Could not create page");
		} finally {
			setIsCreating(false);
		}
	};

	const findTitle = (id: string): string => {
		for (const r of roots) { if (r.id === id) return r.title; }
		for (const children of childMap.values()) {
			for (const c of children) { if (c.id === id) return c.title; }
		}
		return "";
	};

	const renderItem = (item: NotionPageItem, depth: number) => {
		const isSelected = selectedId === item.id;
		const isExpanded = expandedIds.has(item.id);
		const isLoading = loadingIds.has(item.id);
		const children = childMap.get(item.id);

		return (
			<div key={item.id}>
				<div
					className={`flex items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors ${
						isSelected
							? "bg-indigo-100 dark:bg-indigo-900/30"
							: "hover:bg-gray-50 dark:hover:bg-slate-700/40"
					}`}
					style={{ paddingLeft: `${depth * 16 + 4}px` }}
				>
					<button
						type="button"
						className={`flex size-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-600 dark:text-slate-500 ${!item.hasChildren ? "invisible" : ""}`}
						onClick={() => void toggleExpand(item.id)}
						aria-label={isExpanded ? "Collapse" : "Expand"}
					>
						{isLoading
							? <Loader2 className="size-3 animate-spin" />
							: <ChevronRight className={`size-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />}
					</button>

					<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
						<input
							type="radio"
							name="npick"
							checked={isSelected}
							onChange={() => setSelectedId(item.id)}
							className="shrink-0 accent-indigo-600"
						/>
						<span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
							{!item.icon
								? <FileText className="size-3.5 text-gray-400" />
								: item.icon.startsWith("http")
									// eslint-disable-next-line @next/next/no-img-element
									? <img src={item.icon} alt="" className="size-3.5 rounded-sm object-cover" />
									: item.icon}
						</span>
						<span className={`truncate text-sm ${isSelected ? "font-semibold text-indigo-800 dark:text-indigo-200" : "text-gray-700 dark:text-slate-300"}`}>
							{item.title}
						</span>
					</label>
				</div>

				{isExpanded && (
					<div>
						{!children
							? <p className="py-1 text-[11px] text-gray-400 dark:text-slate-500" style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}>Loading…</p>
							: children.length === 0
								? <p className="py-1 text-[11px] text-gray-400 dark:text-slate-500" style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}>No sub-pages</p>
								: children.map((child) => renderItem(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-200">
					<NotionIconSmall className="size-4 text-indigo-600 dark:text-indigo-400" />
					Where should we save {count} action item{count !== 1 ? "s" : ""}?
				</p>
				<button type="button" onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700">
					<X className="size-4" />
				</button>
			</div>

			<p className="text-xs text-gray-500 dark:text-slate-400">
				Pick a page — a task database will be created inside it. Expand ▶ to see sub-pages.
			</p>

			<div className="max-h-60 overflow-y-auto rounded-xl border border-gray-100 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900/40">
				{rootLoading ? (
					<div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-400 dark:text-slate-500">
						<Loader2 className="size-4 animate-spin" /> Loading pages…
					</div>
				) : rootError ? (
					<p className="px-3 py-3 text-xs text-red-500">{rootError}</p>
				) : roots.length === 0 ? (
					<p className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500">No pages found. Create one below.</p>
				) : (
					roots.map((r) => renderItem(r, 0))
				)}
			</div>

			{showCreate ? (
				<div className="flex items-center gap-2">
					<span className="text-sm">📄</span>
					<input
						autoFocus
						type="text"
						className="flex-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-indigo-700 dark:bg-slate-900 dark:text-slate-100"
						placeholder="Page name…"
						value={createTitle}
						onChange={(e) => setCreateTitle(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void handleCreate();
							if (e.key === "Escape") { setShowCreate(false); setCreateTitle(""); }
						}}
					/>
					<Button size="sm" className="shrink-0 rounded-lg" disabled={!createTitle.trim() || isCreating} onClick={() => void handleCreate()}>
						{isCreating ? <Loader2 className="size-3.5 animate-spin" /> : "Create"}
					</Button>
					<button type="button" onClick={() => { setShowCreate(false); setCreateTitle(""); }} className="shrink-0 text-gray-400 hover:text-gray-600">
						<X className="size-4" />
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400 transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 dark:border-slate-600 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/10 dark:hover:text-indigo-400"
				>
					<Plus className="size-3.5" />
					{selectedId
						? `Create a new page inside "${findTitle(selectedId) || "selected page"}"`
						: "Create a new page at workspace root"}
				</button>
			)}

			{createError && <p className="text-xs text-red-500">{createError}</p>}

			{selectedId && (
				<p className="text-[11px] text-gray-400 dark:text-slate-500">
					Task database will be created inside <span className="font-medium text-gray-600 dark:text-slate-300">{findTitle(selectedId)}</span>
				</p>
			)}

			<div className="flex gap-2">
				<Button
					size="sm"
					className="rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
					disabled={!selectedId}
					onClick={() => onConfirm(selectedId)}
				>
					Save here
				</Button>
				<Button size="sm" variant="outline" className="rounded-lg" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function ActionItemsView({
	session,
	onToggle,
}: {
	session: MeetSession;
	onToggle: (itemId: string, done: boolean) => void;
}) {
	const [notionConnected, setNotionConnected] = useState(false);
	const [notionState, setNotionState] = useState<"idle" | "loading" | "success" | "error">("idle");
	const [notionUrl, setNotionUrl] = useState<string | null>(null);
	const [notionError, setNotionError] = useState<string | null>(null);
	const [notionResult, setNotionResult] = useState<{ upserted: number; updated: number } | null>(null);

	const [notionSelectedIds, setNotionSelectedIds] = useState<Set<string>>(new Set());

	const [showPicker, setShowPicker] = useState(false);
	const [defaultPickerPageId, setDefaultPickerPageId] = useState("");

	useEffect(() => {
		void fetch("/api/notion/oauth/status", { cache: "no-store" })
			.then((r) => r.json())
			.then((j: { connected?: boolean }) => {
				setNotionConnected(j.connected === true);
			})
			.catch(() => {/* ignore */});
	}, []);

	useEffect(() => {
		if (!session.actionItems) return;
		setNotionSelectedIds(new Set(session.actionItems.map((a) => a.id)));
	}, [session.actionItems]);

	const handleNotionSelect = (id: string, selected: boolean) => {
		setNotionSelectedIds((prev) => {
			const next = new Set(prev);
			if (selected) next.add(id);
			else next.delete(id);
			return next;
		});
	};

	const openPicker = async () => {
		if (notionSelectedIds.size === 0) return;
		setNotionState("idle");
		setNotionUrl(null);
		setNotionError(null);
		setNotionResult(null);
		try {
			const res = await fetch("/api/preferences", { cache: "no-store" });
			const json = (await res.json()) as { data?: { notionParentPageId?: string } };
			setDefaultPickerPageId(json.data?.notionParentPageId ?? "");
		} catch { /* ignore */ }
		setShowPicker(true);
	};

	const handleSendToNotion = async (targetPageId?: string) => {
		setShowPicker(false);
		setNotionState("loading");
		setNotionUrl(null);
		setNotionError(null);
		setNotionResult(null);

		const selectedIds = Array.from(notionSelectedIds);
		const body: Record<string, unknown> = {
			sessionId: session.id,
			actionItemIds: selectedIds,
		};
		if (targetPageId) body.targetPageId = targetPageId;

		try {
			const res = await fetch("/api/notion/push-meet-actions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const json = (await res.json()) as {
				url?: string;
				dbId?: string;
				created?: boolean;
				upserted?: number;
				updated?: number;
				error?: string;
			};
			if (!res.ok) throw new Error(json.error ?? "Push failed");
			setNotionUrl(json.url ?? null);
			setNotionResult({ upserted: json.upserted ?? selectedIds.length, updated: json.updated ?? 0 });
			setNotionState("success");
		} catch (err) {
			setNotionError(err instanceof Error ? err.message : "Push failed");
			setNotionState("error");
		}
	};

	if (!session.actionItems) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<WandSparkles className="mb-3 size-10 text-gray-300 dark:text-slate-600" />
				<p className="text-sm font-medium text-gray-600 dark:text-slate-400">
					No action items yet
				</p>
				<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
					Generate a summary to extract action items from this session
				</p>
			</div>
		);
	}

	if (session.actionItems.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center">
				<CheckCheck className="mb-3 size-10 text-gray-300 dark:text-slate-600" />
				<p className="text-sm font-medium text-gray-600 dark:text-slate-400">
					No action items detected
				</p>
				<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
					No specific tasks or commitments were found in this session
				</p>
			</div>
		);
	}

	const allItems = session.actionItems;
	const userItems = allItems.filter((a) => a.category === "user");
	const generalItems = allItems.filter((a) => a.category === "general");
	const totalPending = allItems.filter((a) => !a.done).length;
	const totalCompleted = allItems.filter((a) => a.done).length;
	const allSelected = notionSelectedIds.size === allItems.length;

	function PrioritySection({
		items,
		priority,
	}: {
		items: ActionItem[];
		priority: "high" | "medium" | "low";
	}) {
		const filtered = items.filter((a) => a.priority === priority && !a.done);
		if (filtered.length === 0) return null;
		const labelMap = {
			high: { label: "High Priority", color: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
			medium: { label: "Medium Priority", color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
			low: { label: "Low Priority", color: "text-gray-400 dark:text-slate-500", dot: "bg-gray-300 dark:bg-slate-500" },
		};
		const m = labelMap[priority];
		return (
			<div>
				<p className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${m.color}`}>
					<span className={`size-1.5 rounded-full ${m.dot}`} />
					{m.label}
				</p>
				<div className="space-y-2">
					{filtered.map((item) => (
						<ActionItemCard
							key={item.id}
							item={item}
							onToggle={onToggle}
							showNotionSelect={notionConnected}
							notionSelected={notionSelectedIds.has(item.id)}
							onNotionSelect={handleNotionSelect}
						/>
					))}
				</div>
			</div>
		);
	}

	function CategorySection({
		items,
		label,
		icon,
		accent,
		emptyNote,
	}: {
		items: ActionItem[];
		label: string;
		icon: ReactNode;
		accent: string;
		emptyNote: string;
	}) {
		const pending = items.filter((a) => !a.done);
		const completed = items.filter((a) => a.done);
		if (items.length === 0) return null;
		return (
			<div className={`rounded-2xl border p-5 ${accent}`}>
				<h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-200">
					{icon}
					{label}
					<span className="ml-auto text-xs font-normal text-gray-400 dark:text-slate-500">
						{pending.length} pending
					</span>
				</h3>
				{pending.length === 0 && completed.length === 0 ? (
					<p className="text-xs text-gray-400 dark:text-slate-500">{emptyNote}</p>
				) : (
					<div className="space-y-4">
						<PrioritySection items={items} priority="high" />
						<PrioritySection items={items} priority="medium" />
						<PrioritySection items={items} priority="low" />
						{completed.length > 0 && (
							<div>
								<p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-slate-500">
									<CheckCheck className="size-3.5" />
									Completed ({completed.length})
								</p>
								<div className="space-y-2 opacity-60">
									{completed.map((item) => (
										<ActionItemCard
											key={item.id}
											item={item}
											onToggle={onToggle}
											showNotionSelect={notionConnected}
											notionSelected={notionSelectedIds.has(item.id)}
											onNotionSelect={handleNotionSelect}
										/>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-gray-500 dark:text-slate-400">
					{totalPending} pending · {totalCompleted} completed
				</p>

			{notionConnected && (
				<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							className="text-[11px] text-indigo-500 underline-offset-2 hover:underline dark:text-indigo-400"
							onClick={() =>
								setNotionSelectedIds(
									allSelected ? new Set() : new Set(allItems.map((a) => a.id))
								)
							}
						>
							{allSelected ? "Deselect all" : "Select all"}
						</button>

						<span className="text-[11px] text-gray-300 dark:text-slate-600">|</span>

						{notionState === "success" && notionUrl && (
							<a
								href={notionUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1 text-xs text-verdant-700 underline dark:text-emerald-400"
							>
								Open in Notion <ExternalLink className="size-3" />
							</a>
						)}
						{notionState === "success" && notionResult && (
							<span className="text-[11px] text-verdant-600 dark:text-emerald-400">
								{notionResult.updated > 0
									? `${notionResult.upserted - notionResult.updated} added · ${notionResult.updated} updated`
									: `${notionResult.upserted} sent`}
							</span>
						)}
						{notionState === "error" && notionError && (
							<span className="max-w-[260px] truncate text-xs text-red-500" title={notionError}>
								{notionError}
							</span>
						)}

						<Button
							size="sm"
							variant="outline"
							className="h-7 rounded-full px-3 text-xs"
							disabled={notionState === "loading" || notionSelectedIds.size === 0}
							onClick={() => void openPicker()}
						>
							{notionState === "loading" ? (
								<><Loader2 className="mr-1 size-3 animate-spin" />Sending…</>
							) : (
								<>
									<NotionIconSmall className="mr-1 size-3" />
									{notionState === "success"
										? `Send again (${notionSelectedIds.size})`
										: `Send ${notionSelectedIds.size} to Notion`}
								</>
							)}
						</Button>
					</div>
				)}
			</div>

		{notionConnected && notionState === "idle" && (
				<p className="flex items-center gap-1.5 text-[11px] text-indigo-400/80 dark:text-indigo-500/80">
					<NotionIconSmall className="size-3" />
					Use the <span className="font-medium">indigo checkboxes</span> on each task to choose which ones to send to Notion.
				</p>
			)}

		{showPicker && (
			<div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-800/40 dark:bg-indigo-900/10">
				<NotionPagePicker
					defaultPageId={defaultPickerPageId}
					count={notionSelectedIds.size}
					onConfirm={(pageId) => void handleSendToNotion(pageId)}
					onCancel={() => setShowPicker(false)}
				/>
			</div>
		)}

			<CategorySection
				items={userItems}
				label="Your Tasks"
				icon={<User className="size-4 text-verdant-600 dark:text-verdant-400" />}
				accent="border-verdant-100 bg-verdant-50/40 dark:border-emerald-800/40 dark:bg-emerald-900/10"
				emptyNote="No tasks specifically assigned to you in this session."
			/>

			<CategorySection
				items={generalItems}
				label="Group Goals & Commitments"
				icon={<Users className="size-4 text-blue-500 dark:text-blue-400" />}
				accent="border-blue-100 bg-blue-50/40 dark:border-blue-800/40 dark:bg-blue-900/10"
				emptyNote="No group-level goals or commitments found."
			/>
		</div>
	);
}

function NewSessionModal({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated: (session: MeetSession) => void;
}) {
	const [tab, setTab] = useState<"upload" | "record">("upload");

	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [isRecording, setIsRecording] = useState(false);
	const [recordingTime, setRecordingTime] = useState(0);
	const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const streamRef = useRef<MediaStream | null>(null);

	const [title, setTitle] = useState("");
	const [userName, setUserName] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [transcriptionConsent, setTranscriptionConsent] = useState(false);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/preferences", { cache: "no-store" });
				if (!res.ok) return;
				const json = (await res.json()) as { data?: { profile?: { name?: string } } };
				const n = json.data?.profile?.name;
				if (typeof n === "string" && n.trim()) setUserName(n.trim());
			} catch {
				// ignore
			}
		})();
	}, []);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
			streamRef.current?.getTracks().forEach((t) => t.stop());
		};
	}, []);

	const validateAndSetFile = (file: File) => {
		const acceptedExts = ACCEPTED_EXTENSIONS.split(",");
		const name = file.name.toLowerCase();
		const isValid = acceptedExts.some((ext) => name.endsWith(ext.trim()));
		if (!isValid) {
			setSubmitError(
				"Unsupported file type. Please upload: MP3, MP4, WAV, M4A, WebM, OGG, FLAC, AAC, or OPUS."
			);
			return;
		}
		if (file.size > 150 * 1024 * 1024) {
			setSubmitError("File exceeds 150 MB limit.");
			return;
		}
		setSubmitError(null);
		setUploadFile(file);
		if (!title) {
			const base = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
			setTitle(base.charAt(0).toUpperCase() + base.slice(1));
		}
	};

	const startRecording = async () => {
		setSubmitError(null);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;
			const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
				? "audio/webm;codecs=opus"
				: MediaRecorder.isTypeSupported("audio/webm")
					? "audio/webm"
					: "";
			const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
			audioChunksRef.current = [];
			recorder.ondataavailable = (e: BlobEvent) => {
				if (e.data.size > 0) audioChunksRef.current.push(e.data);
			};
			recorder.start(1000);
			mediaRecorderRef.current = recorder;
			setIsRecording(true);
			setRecordingTime(0);
			timerRef.current = setInterval(() => {
				setRecordingTime((t) => t + 1);
			}, 1000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setSubmitError(
				`Microphone access denied: ${msg}. Please enable microphone permissions in your browser.`
			);
		}
	};

	const stopRecording = () => {
		return new Promise<Blob>((resolve) => {
			if (!mediaRecorderRef.current) {
				resolve(new Blob());
				return;
			}
			mediaRecorderRef.current.onstop = () => {
				const mime = mediaRecorderRef.current?.mimeType ?? "audio/webm";
				resolve(new Blob(audioChunksRef.current, { type: mime }));
			};
			mediaRecorderRef.current.stop();
			streamRef.current?.getTracks().forEach((t) => t.stop());
			if (timerRef.current) clearInterval(timerRef.current);
			setIsRecording(false);
		});
	};

	const handleStopRecording = async () => {
		const blob = await stopRecording();
		setRecordedBlob(blob);
		if (!title) setTitle("Recording – " + new Date().toLocaleDateString());
	};

	const handleSubmit = async () => {
		setSubmitError(null);

		let fileToSubmit: File | null = null;
		if (tab === "upload") {
			fileToSubmit = uploadFile;
		} else if (recordedBlob) {
			fileToSubmit = new File(
				[recordedBlob],
				`recording-${Date.now()}.webm`,
				{ type: recordedBlob.type || "audio/webm" }
			);
		}

		if (!fileToSubmit) {
			setSubmitError(
				tab === "upload"
					? "Please select an audio or video file."
					: "Please record some audio first."
			);
			return;
		}
		if (!title.trim()) {
			setSubmitError("Please enter a session title.");
			return;
		}

		if (!transcriptionConsent) {
			setSubmitError(
				"Please confirm you have permission to transcribe this audio, including consent from other participants where required."
			);
			return;
		}

		setIsSubmitting(true);
		try {
			const fd = new FormData();
			fd.append("audio", fileToSubmit);
			fd.append("title", title.trim());
			fd.append("userName", userName.trim());
			fd.append("sessionType", tab === "upload" ? "upload" : "recording");

			const res = await fetch("/api/meets", { method: "POST", body: fd });
			const data = (await res.json()) as { data?: MeetSession; error?: string };

			if (!res.ok || data.error) throw new Error(data.error ?? "Upload failed");
			if (data.data) onCreated(data.data);
		} catch (err) {
			setSubmitError(
				err instanceof Error ? err.message : "Failed to process session. Please try again."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const canSubmit =
		!isSubmitting &&
		transcriptionConsent &&
		title.trim().length > 0 &&
		(tab === "upload" ? !!uploadFile : !!recordedBlob);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
			<div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800">
				<div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-700">
					<h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
						New Session
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-slate-400 dark:hover:bg-slate-700"
					>
						<X className="size-4" />
					</button>
				</div>

				<div className="flex border-b border-gray-100 px-6 dark:border-slate-700">
					{(["upload", "record"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => {
								setTab(t);
								setSubmitError(null);
							}}
							className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
								tab === t
									? "-mb-px border-b-2 border-verdant-600 text-verdant-700 dark:border-verdant-400 dark:text-verdant-400"
									: "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300"
							}`}
						>
							{t === "upload" ? <Upload className="size-3.5" /> : <Mic className="size-3.5" />}
							{t === "upload" ? "Upload File" : "Record Audio"}
						</button>
					))}
				</div>

				<div className="space-y-4 px-6 py-5">
					{tab === "upload" && (
						<div>
							{uploadFile ? (
								<div className="flex items-center gap-3 rounded-xl border border-verdant-200 bg-verdant-50 p-4 dark:border-emerald-700 dark:bg-emerald-900/20">
									<FileAudio className="size-8 flex-shrink-0 text-verdant-600 dark:text-verdant-400" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-verdant-800 dark:text-verdant-300">
											{uploadFile.name}
										</p>
										<p className="text-xs text-verdant-600 dark:text-verdant-400">
											{formatFileSize(uploadFile.size)}
										</p>
									</div>
									<button
										type="button"
										onClick={() => {
											setUploadFile(null);
											setSubmitError(null);
										}}
										className="flex-shrink-0 rounded-lg p-1 text-verdant-500 hover:bg-verdant-100 dark:hover:bg-emerald-800"
									>
										<X className="size-4" />
									</button>
								</div>
							) : (
								<div
									onDrop={(e) => {
										e.preventDefault();
										setIsDragging(false);
										const f = e.dataTransfer.files[0];
										if (f) validateAndSetFile(f);
									}}
									onDragOver={(e) => {
										e.preventDefault();
										setIsDragging(true);
									}}
									onDragLeave={() => setIsDragging(false)}
									onClick={() => fileInputRef.current?.click()}
									className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
										isDragging
											? "border-verdant-400 bg-verdant-50 dark:border-verdant-500 dark:bg-verdant-900/20"
											: "border-gray-200 bg-gray-50 hover:border-verdant-300 hover:bg-verdant-50/60 dark:border-slate-600 dark:bg-slate-700/50 dark:hover:border-verdant-600"
									}`}
								>
									<div className="rounded-full bg-white p-3 shadow-sm dark:bg-slate-700">
										<Upload className="size-6 text-gray-400 dark:text-slate-400" />
									</div>
									<div className="text-center">
										<p className="text-sm font-medium text-gray-700 dark:text-slate-300">
											Drop audio or video file here
										</p>
										<p className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
											MP3, MP4, WAV, M4A, WebM, OGG, FLAC · Max 150 MB
										</p>
									</div>
									<input
										ref={fileInputRef}
										type="file"
										accept={ACCEPTED_EXTENSIONS}
										className="hidden"
										onChange={(e) => {
											const f = e.target.files?.[0];
											if (f) validateAndSetFile(f);
											e.target.value = "";
										}}
									/>
								</div>
							)}
						</div>
					)}

					{tab === "record" && (
						<div className="flex min-h-40 flex-col items-center justify-center gap-4">
							{!recordedBlob && !isRecording && (
								<>
									<div className="rounded-full bg-rose-50 p-5 dark:bg-rose-900/20">
										<Mic className="size-8 text-rose-500" />
									</div>
									<div className="text-center">
										<p className="text-sm font-medium text-gray-700 dark:text-slate-300">
											Record your meeting or session
										</p>
										<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
											Have your meeting open elsewhere — record your mic here in parallel
										</p>
									</div>
									<Button
										onClick={() => void startRecording()}
										className="gap-2 rounded-full bg-rose-500 px-6 text-white hover:bg-rose-600"
									>
										<Mic className="size-4" />
										Start Recording
									</Button>
								</>
							)}

							{isRecording && (
								<>
									<div className="flex items-center gap-3">
										<span className="size-3 animate-pulse rounded-full bg-rose-500" />
										<span className="font-mono text-2xl font-semibold text-rose-600 dark:text-rose-400">
											{formatRecordingTime(recordingTime)}
										</span>
									</div>
									<p className="text-xs text-gray-500 dark:text-slate-400">
										🎙️ Recording in progress — speak or have your meeting running
									</p>
									<Button
										onClick={() => void handleStopRecording()}
										variant="outline"
										className="gap-2 rounded-full border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400"
									>
										<Square className="size-4 fill-current" />
										Stop Recording
									</Button>
								</>
							)}

							{recordedBlob && !isRecording && (
								<>
									<div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-700 dark:bg-violet-900/20">
										<Mic className="size-5 text-violet-600 dark:text-violet-400" />
										<div>
											<p className="text-sm font-medium text-violet-800 dark:text-violet-300">
												Recording captured
											</p>
											<p className="text-xs text-violet-600 dark:text-violet-400">
												{formatRecordingTime(recordingTime)} ·{" "}
												{formatFileSize(recordedBlob.size)}
											</p>
										</div>
									</div>
									<button
										type="button"
										onClick={() => {
											setRecordedBlob(null);
											setRecordingTime(0);
										}}
										className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-rose-500 dark:hover:text-rose-400"
									>
										<RotateCcw className="size-3" />
										Discard and re-record
									</button>
								</>
							)}
						</div>
					)}

					<div className="space-y-3">
						<div>
							<label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-slate-400">
								Session Title <span className="text-rose-500">*</span>
							</label>
							<Input
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="e.g. Q1 Planning, Weekly Standup, CS101 Lecture..."
								className="rounded-lg border-gray-200 text-sm dark:border-slate-600 dark:bg-slate-700"
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-slate-400">
								Your Name{" "}
								<span className="text-gray-400">(helps identify your role in the transcript)</span>
							</label>
							<Input
								value={userName}
								onChange={(e) => setUserName(e.target.value)}
								placeholder="e.g. Alex — your name as others might say it in the session"
								className="rounded-lg border-gray-200 text-sm dark:border-slate-600 dark:bg-slate-700"
							/>
						</div>
						<label className="flex cursor-pointer items-start gap-2 text-xs text-gray-600 dark:text-slate-400">
							<input
								type="checkbox"
								checked={transcriptionConsent}
								onChange={(e) => setTranscriptionConsent(e.target.checked)}
								className="mt-0.5 size-4 rounded border-gray-300 text-verdant-600 focus:ring-verdant-500"
							/>
							<span>
								I confirm I have permission to transcribe this audio, including consent from other participants where
								required by law or policy.
							</span>
						</label>
					</div>

					{submitError && (
						<div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
							<AlertCircle className="mt-0.5 size-3.5 flex-shrink-0" />
							{submitError}
						</div>
					)}
				</div>

				<div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-700">
					<Button
						variant="outline"
						onClick={onClose}
						disabled={isSubmitting}
						className="rounded-full"
					>
						Cancel
					</Button>
					<Button
						onClick={() => void handleSubmit()}
						disabled={!canSubmit}
						className="gap-2 rounded-full bg-verdant-600 text-white hover:bg-verdant-700 disabled:opacity-50"
					>
						{isSubmitting ? (
							<>
								<Loader2 className="size-4 animate-spin" />
								Transcribing...
							</>
						) : (
							<>
								<ChevronRight className="size-4" />
								Process Session
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}

const SUGGESTED_QUESTIONS = [
	"What were the main topics covered?",
	"What decisions were made?",
	"What questions were raised but not answered?",
	"Summarize each speaker's position.",
];

function ConverseView({ sessionId }: { sessionId: string }) {
	type ChatMsg = { role: "user" | "assistant"; content: string };
	const [messages, setMessages] = useState<ChatMsg[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setMessages([]);
		setInput("");
		setSendError(null);
	}, [sessionId]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading]);

	const handleSend = async (text?: string) => {
		const trimmed = (text ?? input).trim();
		if (!trimmed || isLoading) return;

		const newMsgs: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
		setMessages(newMsgs);
		setInput("");
		setIsLoading(true);
		setSendError(null);

		try {
			const res = await fetch(`/api/meets/${sessionId}/converse`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ messages: newMsgs }),
			});
			const data = (await res.json()) as { reply?: string; error?: string };
			if (!res.ok || data.error) throw new Error(data.error ?? "No response from AI");
			setMessages((prev) => [...prev, { role: "assistant", content: data.reply! }]);
		} catch (err) {
			setSendError(err instanceof Error ? err.message : "Failed to get a response. Please try again.");
			setMessages(messages); // rollback
		} finally {
			setIsLoading(false);
			inputRef.current?.focus();
		}
	};

	return (
		<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
		<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 space-y-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<div className="mb-4 rounded-full bg-verdant-50 p-4 dark:bg-emerald-900/20">
							<MessageSquare className="size-8 text-verdant-500 dark:text-verdant-400" />
						</div>
						<p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
							Ask anything about this session
						</p>
						<p className="mt-1 max-w-sm text-xs text-gray-400 dark:text-slate-500">
							Answers are strictly within the transcript. Say{" "}
							<span className="font-medium text-gray-500 dark:text-slate-400">
								&ldquo;outside pov&rdquo;
							</span>{" "}
							to get broader context.
						</p>
						<div className="mt-5 flex flex-wrap justify-center gap-2">
							{SUGGESTED_QUESTIONS.map((q) => (
								<button
									key={q}
									type="button"
									onClick={() => void handleSend(q)}
									className="rounded-full border border-verdant-200 bg-verdant-50 px-3 py-1.5 text-xs font-medium text-verdant-700 transition-colors hover:bg-verdant-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-verdant-400 dark:hover:bg-emerald-900/40"
								>
									{q}
								</button>
							))}
						</div>
					</div>
				) : (
					messages.map((msg, i) => (
						<div
							key={i}
						className={`flex w-full min-w-0 ${
							msg.role === "user" ? "justify-end" : "justify-start"
						}`}
					>
				<div
					className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] ${
						msg.role === "user"
							? "max-w-[72%] rounded-br-sm bg-verdant-600 text-white dark:bg-verdant-700"
							: "max-w-[84%] rounded-bl-sm border border-gray-100 bg-white text-gray-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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

				{isLoading && (
					<div className="flex justify-start">
						<div className="rounded-2xl rounded-bl-sm border border-gray-100 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
							<div className="flex items-center gap-1">
								<span
									className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400"
									style={{ animationDelay: "0ms" }}
								/>
								<span
									className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400"
									style={{ animationDelay: "150ms" }}
								/>
								<span
									className="size-1.5 animate-bounce rounded-full bg-gray-400 dark:bg-slate-400"
									style={{ animationDelay: "300ms" }}
								/>
							</div>
						</div>
					</div>
				)}

				{sendError && (
					<div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
						<AlertCircle className="mt-0.5 size-3.5 flex-shrink-0" />
						{sendError}
					</div>
				)}

				<div ref={bottomRef} />
			</div>

			<div className="border-t border-gray-100 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
				<div className="flex gap-2">
					<Input
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void handleSend();
							}
						}}
						placeholder="Ask about this session…"
						disabled={isLoading}
						className="flex-1 rounded-full border-gray-200 text-sm dark:border-slate-600 dark:bg-slate-700"
					/>
					<Button
						onClick={() => void handleSend()}
						disabled={!input.trim() || isLoading}
						size="sm"
						className="h-9 w-9 flex-shrink-0 rounded-full bg-verdant-600 p-0 text-white hover:bg-verdant-700 disabled:opacity-50"
					>
						<Send className="size-4" />
					</Button>
				</div>
				<p className="mt-1.5 text-[11px] text-gray-400 dark:text-slate-500">
					Answers based on transcript only · &ldquo;outside pov&rdquo; unlocks broader knowledge
				</p>
			</div>
		</div>
	);
}

export default function MeetPage() {
	const [sessions, setSessions] = useState<MeetSession[]>([]);
	const [isLoadingSessions, setIsLoadingSessions] = useState(true);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "actions" | "converse">(
		"transcript"
	);
	const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
	const [isSummarizing, setIsSummarizing] = useState(false);
	const [summarizeError, setSummarizeError] = useState<string | null>(null);
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

	const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

	const fetchSessions = useCallback(async () => {
		try {
			const res = await fetch("/api/meets", { cache: "no-store" });
			if (!res.ok) return;
			const data = (await res.json()) as { data?: MeetSession[] };
			if (Array.isArray(data.data)) setSessions(data.data);
		} catch {
			// ignore
		} finally {
			setIsLoadingSessions(false);
		}
	}, []);

	useEffect(() => {
		void fetchSessions();
	}, [fetchSessions]);

	const handleSessionCreated = (session: MeetSession) => {
		setSessions((prev) => [session, ...prev]);
		setActiveSessionId(session.id);
		setActiveTab("transcript");
		setIsNewSessionOpen(false);
		setSummarizeError(null);
	};

	const handleGenerateSummary = async () => {
		if (!activeSession) return;
		setIsSummarizing(true);
		setSummarizeError(null);
		try {
			const res = await fetch(`/api/meets/${activeSession.id}/summarize`, {
				method: "POST",
			});
			const data = (await res.json()) as { data?: MeetSession; error?: string };
			if (!res.ok || data.error) throw new Error(data.error ?? "Failed to generate summary");
			if (data.data) {
				setSessions((prev) =>
					prev.map((s) => (s.id === data.data!.id ? data.data! : s))
				);
				setActiveTab("summary");
			}
		} catch (err) {
			setSummarizeError(
				err instanceof Error ? err.message : "Failed to generate summary. Please try again."
			);
		} finally {
			setIsSummarizing(false);
		}
	};

	const handleToggleActionItem = async (itemId: string, done: boolean) => {
		if (!activeSession?.actionItems) return;
		const updated = activeSession.actionItems.map((a) =>
			a.id === itemId ? { ...a, done } : a
		);
		setSessions((prev) =>
			prev.map((s) =>
				s.id === activeSession.id ? { ...s, actionItems: updated } : s
			)
		);
		try {
			await fetch(`/api/meets/${activeSession.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ actionItems: updated }),
			});
		} catch {
			// revert
			setSessions((prev) =>
				prev.map((s) =>
					s.id === activeSession.id
						? { ...s, actionItems: activeSession.actionItems }
						: s
				)
			);
		}
	};

	const handleDeleteSession = async (id: string) => {
		try {
			await fetch(`/api/meets/${id}`, { method: "DELETE" });
			setSessions((prev) => prev.filter((s) => s.id !== id));
			if (activeSessionId === id) setActiveSessionId(null);
			setDeleteConfirmId(null);
		} catch {
			// ignore
		}
	};

	const actionCount =
		activeSession?.actionItems?.filter((a) => !a.done).length ?? 0;

	return (
		<div className="flex h-full min-h-[560px] overflow-hidden rounded-2xl border border-[#cde0c9] shadow-sm dark:border-[#2a4030]">
			<div className="flex w-[240px] shrink-0 flex-col border-r border-[#e0edd9] bg-white dark:border-[#1e3020] dark:bg-[#111d14]">
				<div className="flex items-center justify-between border-b border-[#e0edd9] px-4 py-4 dark:border-[#1e3020]">
					<h2 className="text-sm font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">
						Meet Sessions
					</h2>
					<Button
						size="sm"
						onClick={() => setIsNewSessionOpen(true)}
						className="h-7 gap-1.5 rounded-full bg-verdant-600 px-3 text-xs text-white hover:bg-verdant-700"
					>
						<Plus className="size-3.5" />
						New
					</Button>
				</div>

				<div className="flex-1 overflow-y-auto p-2">
					{isLoadingSessions ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<Loader2 className="mb-2 size-6 animate-spin text-gray-300 dark:text-slate-600" />
							<p className="text-xs text-gray-400 dark:text-slate-500">Loading...</p>
						</div>
					) : sessions.length === 0 ? (
						<div className="flex flex-col items-center justify-center px-4 py-12 text-center">
							<FileAudio className="mb-3 size-10 text-gray-200 dark:text-slate-600" />
							<p className="text-xs font-medium text-gray-500 dark:text-slate-400">
								No sessions yet
							</p>
							<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
								Upload or record to get started
							</p>
							<Button
								size="sm"
								onClick={() => setIsNewSessionOpen(true)}
								className="mt-4 h-7 gap-1.5 rounded-full bg-verdant-600 px-3 text-xs text-white hover:bg-verdant-700"
							>
								<Plus className="size-3" />
								New Session
							</Button>
						</div>
					) : (
						<div className="space-y-0.5">
							{sessions.map((session) => (
								<SessionListItem
									key={session.id}
									session={session}
									isActive={session.id === activeSessionId}
									onClick={() => {
										setActiveSessionId(session.id);
										setSummarizeError(null);
									}}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col bg-[#f5f7f2] dark:bg-[#0d1510]">
				{!activeSession ? (
					<div className="flex h-full flex-col items-center justify-center p-8 text-center">
						<div className="max-w-sm rounded-2xl border border-[#cde0c9] bg-white p-8 shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
							<FileAudio className="mx-auto mb-4 size-12 text-[#b0c8b4] dark:text-[#2a4030]" />
							<h3 className="mb-2 text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">
								Upload or record a session
							</h3>
							<p className="mb-5 text-sm text-[#6a9470] dark:text-[#5a8060]">
								Deepgram transcribes with full speaker identification. Get a detailed AI
								summary, full transcript, and action items — all generated when you&apos;re ready.
							</p>
							<Button
								onClick={() => setIsNewSessionOpen(true)}
								className="gap-2 rounded-full bg-verdant-600 text-white hover:bg-verdant-700"
							>
								<Plus className="size-4" />
								New Session
							</Button>
						</div>
						<div className="mt-6 flex flex-wrap justify-center gap-6 text-xs text-gray-400 dark:text-slate-500">
							<span className="flex items-center gap-1.5">
								<Upload className="size-3.5" /> Upload MP3 / MP4 / WAV
							</span>
							<span className="flex items-center gap-1.5">
								<Mic className="size-3.5" /> Record from mic
							</span>
							<span className="flex items-center gap-1.5">
								<Users className="size-3.5" /> Speaker identification
							</span>
							<span className="flex items-center gap-1.5">
								<WandSparkles className="size-3.5" /> AI summary &amp; todos
							</span>
						</div>
					</div>
				) : (
					<>
					<div className="border-b border-[#e0edd9] bg-white px-6 py-4 dark:border-[#1e3020] dark:bg-[#111d14]">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0 flex-1">
									<h1 className="truncate text-lg font-semibold text-gray-900 dark:text-slate-100">
										{activeSession.title}
									</h1>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
										<span>{formatDate(activeSession.createdAt)}</span>
										{activeSession.duration > 0 && (
											<>
												<span>·</span>
												<span className="flex items-center gap-1">
													<Clock className="size-3" />
													{formatDuration(activeSession.duration)}
												</span>
											</>
										)}
										{activeSession.transcript.length > 0 && (
											<>
												<span>·</span>
												<span>
													{activeSession.transcript.length} utterances
												</span>
											</>
										)}
									</div>
								</div>

								<div className="flex flex-shrink-0 items-center gap-2">
									<div className="flex flex-wrap gap-1.5">
										<TypeBadge type={activeSession.type} />
										<StatusBadge status={activeSession.status} />
									</div>

									{activeSession.status === "ready" &&
										activeSession.transcript.length > 0 &&
										!activeSession.summaryGeneratedAt && (
											<Button
												onClick={() => void handleGenerateSummary()}
												disabled={isSummarizing}
												size="sm"
												className="h-8 gap-1.5 rounded-full bg-verdant-600 px-4 text-xs text-white hover:bg-verdant-700 disabled:opacity-60"
											>
												{isSummarizing ? (
													<>
														<Loader2 className="size-3.5 animate-spin" />
														Analyzing…
													</>
												) : (
													<>
														<WandSparkles className="size-3.5" />
														Generate Summary
													</>
												)}
											</Button>
										)}

									{activeSession.summaryGeneratedAt && (
										<Button
											onClick={() => void handleGenerateSummary()}
											disabled={isSummarizing}
											variant="outline"
											size="sm"
											className="h-8 gap-1 rounded-full px-3 text-xs"
											title="Re-generate summary"
										>
											{isSummarizing ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<RotateCcw className="size-3.5" />
											)}
										</Button>
									)}

									{deleteConfirmId === activeSession.id ? (
										<div className="flex items-center gap-1">
											<Button
												onClick={() =>
													void handleDeleteSession(activeSession.id)
												}
												size="sm"
												className="h-7 rounded-full bg-rose-600 px-3 text-xs text-white hover:bg-rose-700"
											>
												Delete
											</Button>
											<Button
												onClick={() => setDeleteConfirmId(null)}
												variant="outline"
												size="sm"
												className="h-7 rounded-full px-2 text-xs"
											>
												Cancel
											</Button>
										</div>
									) : (
										<button
											type="button"
											onClick={() => setDeleteConfirmId(activeSession.id)}
											className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
											title="Delete session"
										>
											<Trash2 className="size-4" />
										</button>
									)}
								</div>
							</div>

							{summarizeError && (
								<div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
									<AlertCircle className="mt-0.5 size-3.5 flex-shrink-0" />
									{summarizeError}
								</div>
							)}

							{activeSession.status === "ready" && (
								<div className="mt-3 flex gap-0 border-b border-gray-100 dark:border-slate-700">
									<DetailTab
										active={activeTab === "transcript"}
										onClick={() => setActiveTab("transcript")}
										label="Transcript"
									/>
									<DetailTab
										active={activeTab === "summary"}
										onClick={() => setActiveTab("summary")}
										label="Summary"
										locked={!activeSession.summaryGeneratedAt}
									/>
									<DetailTab
										active={activeTab === "actions"}
										onClick={() => setActiveTab("actions")}
										label="Action Items"
										badge={actionCount}
										locked={!activeSession.summaryGeneratedAt}
									/>
									<DetailTab
										active={activeTab === "converse"}
										onClick={() => setActiveTab("converse")}
										label="Converse"
									/>
								</div>
							)}
						</div>

						<div className="flex flex-1 flex-col overflow-hidden">
							{activeSession.status === "error" ? (
								<div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
									<AlertCircle className="mb-3 size-10 text-rose-400" />
									<p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
										Transcription failed
									</p>
									<p className="mt-1 max-w-md text-xs text-gray-500 dark:text-slate-400">
										{activeSession.error ??
											"An error occurred. Check your Deepgram API key in .env.local and try again."}
									</p>
								</div>
							) : activeSession.status === "transcribing" ? (
								<div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
									<Loader2 className="mb-3 size-10 animate-spin text-blue-400" />
									<p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
										Transcribing audio…
									</p>
									<p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
										Processing with Deepgram — this may take a moment
									</p>
								</div>
							) : activeTab === "converse" ? (
								<ConverseView sessionId={activeSession.id} />
							) : (
							<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
								<div className="mx-auto max-w-3xl px-6 py-6">
									{activeTab === "transcript" && (
										<TranscriptView
											transcript={activeSession.transcript}
											userSpeaker={activeSession.userSpeaker}
										/>
									)}
									{activeTab === "summary" && (
										<SummaryView session={activeSession} />
									)}
									{activeTab === "actions" && (
										<ActionItemsView
											session={activeSession}
											onToggle={(id, done) =>
												void handleToggleActionItem(id, done)
											}
										/>
									)}
								</div>
								</div>
							)}
						</div>
					</>
				)}
			</div>

			{isNewSessionOpen && (
				<NewSessionModal
					onClose={() => setIsNewSessionOpen(false)}
					onCreated={handleSessionCreated}
				/>
			)}
		</div>
	);
}
