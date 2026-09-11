"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	CircleUserRound,
	FileText,
	Mic,
	MoonStar,
	Shield,
} from "lucide-react";

type TranscriptLanguage = "English" | "Spanish" | "French" | "German" | "Korean" | "Hindi";

interface StoredProfileDetails {
	name: string;
	email: string;
}

interface StoredTranscriptMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: string;
	isLive?: boolean;
}

interface StoredSettingsPreferences {
	voiceTranscription: boolean;
	autoSaveTranscripts: boolean;
	autoSaveHighlights: boolean;
	organizeByWebpage: boolean;
	aiSummaries: boolean;
}

interface HighlightExportItem {
	title: string;
	text: string;
	url: string;
	createdAt: string;
}

interface HighlightsExportResponse {
	data: HighlightExportItem[];
}

function getInitials(value: string) {
	const parts = value
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2);

	if (parts.length === 0) {
		return "U";
	}

	return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function SettingToggle({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description: string;
	value: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] p-3 dark:border-[#1e3020] dark:bg-[#0d1a10]">
			<div>
				<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">{label}</p>
				<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">{description}</p>
			</div>
		<button
			type="button"
			onClick={() => onChange(!value)}
			className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none ${
				value ? "bg-[#4a9456] dark:bg-[#5aaa66]" : "bg-[#cde0c9] dark:bg-[#2a4030]"
			}`}
			aria-pressed={value}
		>
			<span
				className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
					value ? "translate-x-5" : "translate-x-0"
				}`}
			/>
		</button>
		</div>
	);
}

function SectionCard({
	title,
	description,
	icon,
	children,
}: {
	title: string;
	description: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<Card className="rounded-2xl border border-[#cde0c9] bg-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md dark:border-[#2a4030] dark:bg-[#111d14]">
			<CardHeader className="space-y-2">
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-[#d4e8d0] p-2 text-[#3a6b45] dark:bg-[#1e3a28] dark:text-[#6bbf7e]">
						{icon}
					</div>
					<div>
						<CardTitle className="text-[#2c4a35] dark:text-[#c8e6cb]">{title}</CardTitle>
						<CardDescription className="text-[#6a9470] dark:text-[#5a8060]">{description}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">{children}</CardContent>
		</Card>
	);
}

export default function SettingsPage() {
	const [statusMessage, setStatusMessage] = useState("All changes are ready.");
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const [isDeleteHighlightsModalOpen, setIsDeleteHighlightsModalOpen] = useState(false);
	const [isDeletingHighlights, setIsDeletingHighlights] = useState(false);
	const [isExportingNotesPdf, setIsExportingNotesPdf] = useState(false);

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");

	const [voiceTranscription, setVoiceTranscription] = useState(true);
	const [transcriptLanguage, setTranscriptLanguage] = useState<TranscriptLanguage>("English");
	const [autoSaveTranscripts, setAutoSaveTranscripts] = useState(true);

	const [autoSaveHighlights, setAutoSaveHighlights] = useState(true);
	const [organizeByWebpage, setOrganizeByWebpage] = useState(true);
	const [aiSummaries, setAiSummaries] = useState(true);

	const [fontScale, setFontScale] = useState(100);
	const [prefsLoaded, setPrefsLoaded] = useState(false);

	useEffect(() => {
		void (async () => {
			try {
				// Load real user identity from auth session
				const meRes = await fetch("/api/auth/me", { cache: "no-store" });
				if (meRes.ok) {
					const meJson = (await meRes.json()) as { user?: { name?: string; email?: string } };
					if (meJson.user?.name) setName(meJson.user.name);
					if (meJson.user?.email) setEmail(meJson.user.email);
				}

				// Load saved preferences
				const res = await fetch("/api/preferences", { cache: "no-store" });
				if (!res.ok) { setPrefsLoaded(true); return; }

				const json = (await res.json()) as {
					data?: {
						profile?: Partial<StoredProfileDetails>
						transcriptLanguage?: string
						fontScale?: number
						settingsPreferences?: Partial<StoredSettingsPreferences>
					}
				};
				const data = json.data;
				if (!data) { setPrefsLoaded(true); return; }

				// Only use saved profile name/email as fallback if auth/me didn't give us one
				if (!name && typeof data.profile?.name === "string" && data.profile.name.trim()) {
					setName(data.profile.name.trim());
				}
				if (!email && typeof data.profile?.email === "string" && data.profile.email.trim()) {
					setEmail(data.profile.email.trim());
				}

				const lang = data.transcriptLanguage;
				if (lang === "English" || lang === "Spanish" || lang === "French" || lang === "German" || lang === "Korean" || lang === "Hindi") {
					setTranscriptLanguage(lang);
				}

				if (typeof data.fontScale === "number" && !Number.isNaN(data.fontScale) && data.fontScale >= 85 && data.fontScale <= 125) {
					setFontScale(data.fontScale);
				}

				const sp = data.settingsPreferences;
				if (sp) {
					if (typeof sp.voiceTranscription === "boolean") setVoiceTranscription(sp.voiceTranscription);
					if (typeof sp.autoSaveTranscripts === "boolean") setAutoSaveTranscripts(sp.autoSaveTranscripts);
					if (typeof sp.autoSaveHighlights === "boolean") setAutoSaveHighlights(sp.autoSaveHighlights);
					if (typeof sp.organizeByWebpage === "boolean") setOrganizeByWebpage(sp.organizeByWebpage);
					if (typeof sp.aiSummaries === "boolean") setAiSummaries(sp.aiSummaries);
				}
				setPrefsLoaded(true);
			} catch {
				setPrefsLoaded(true);
			}
		})();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!prefsLoaded) return;
		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ transcriptLanguage }),
		});
	}, [transcriptLanguage, prefsLoaded]);

	useEffect(() => {
		if (!prefsLoaded) return;
		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fontScale }),
		});
		document.documentElement.style.fontSize = `${fontScale}%`;
	}, [fontScale, prefsLoaded]);

	const actionDone = (message: string) => {
		setStatusMessage(message);
	};

	const showToast = (message: string) => {
		setToastMessage(message);
	};

	useEffect(() => {
		if (!toastMessage) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setToastMessage(null);
		}, 2600);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [toastMessage]);

	useEffect(() => {
		if (!isDeleteHighlightsModalOpen) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !isDeletingHighlights) {
				setIsDeleteHighlightsModalOpen(false);
			}
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [isDeleteHighlightsModalOpen, isDeletingHighlights]);

	const handleUpdateProfile = () => {
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();

		if (!trimmedName || !trimmedEmail) {
			actionDone("Name and email are required to update profile.");
			return;
		}

		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				profile: { name: trimmedName, email: trimmedEmail },
				currentUserEmail: trimmedEmail,
			}),
		});

		setName(trimmedName);
		setEmail(trimmedEmail);
		actionDone("Profile settings updated.");
	};

	const readStoredTranscriptMessages = async (): Promise<StoredTranscriptMessage[]> => {
		try {
			const res = await fetch("/api/preferences", { cache: "no-store" });
			if (!res.ok) return [];
			const json = (await res.json()) as { data?: { transcriptHistory?: unknown } };
			const parsed = json.data?.transcriptHistory;
			if (!Array.isArray(parsed)) {
				return [];
			}

			return parsed.filter((item): item is StoredTranscriptMessage => {
				if (!item || typeof item !== "object") {
					return false;
				}

				const candidate = item as Partial<StoredTranscriptMessage>;
				return (
					typeof candidate.id === "string" &&
					(candidate.role === "user" || candidate.role === "assistant") &&
					typeof candidate.content === "string" &&
					typeof candidate.timestamp === "string"
				);
			});
		} catch {
			return [];
		}
	};

	const handleDownloadTranscripts = () => {
		void (async () => {
		const transcriptMessages = await readStoredTranscriptMessages();
		if (transcriptMessages.length === 0) {
			actionDone("No transcript history found to download.");
			return;
		}

		const lines = transcriptMessages.map((message) => {
			const when = new Date(message.timestamp);
			const label = Number.isNaN(when.getTime()) ? message.timestamp : when.toLocaleString();
			const role = message.role === "assistant" ? "Assistant" : "User";
			return `[${label}] ${role}: ${message.content}`;
		});

		const fileContent = `Assist Note Portal - Transcript History\n\n${lines.join("\n")}`;
		const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
		const objectUrl = window.URL.createObjectURL(blob);
		const link = document.createElement("a");
		const dateSuffix = new Date().toISOString().slice(0, 10);

		link.href = objectUrl;
		link.download = `assist-transcripts-${dateSuffix}.txt`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(objectUrl);

		actionDone(`Downloaded ${transcriptMessages.length} transcript messages.`);
		})();
	};

	const handleClearTranscriptHistory = () => {
		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ transcriptHistory: [] }),
		});
		actionDone("Transcript history cleared.");
		showToast("Transcript history has been cleared.");
	};


	const clearHighlightsFromStore = async (successStatus: string, successToast: string) => {
		if (isDeletingHighlights) {
			return;
		}

		setIsDeletingHighlights(true);

		try {
			const response = await fetch("/api/highlights", {
				method: "DELETE",
			});

			if (!response.ok) {
				throw new Error("Failed to delete highlights");
			}

			actionDone(successStatus);
			showToast(successToast);
			setIsDeleteHighlightsModalOpen(false);
		} catch {
			actionDone("Could not delete highlights right now. Please try again.");
			showToast("Delete failed. Please try again.");
		} finally {
			setIsDeletingHighlights(false);
		}
	};

	const handleClearSavedNotes = () => {
		void clearHighlightsFromStore("Saved notes cleared.", "Saved notes have been cleared.");
	};

	const handleRequestDeleteAllHighlights = () => {
		setIsDeleteHighlightsModalOpen(true);
	};

	const handleConfirmDeleteAllHighlights = () => {
		void clearHighlightsFromStore("All highlights deleted.", "All highlights have been deleted.");
	};

	const handleLogoutAccount = () => {
		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ currentUserEmail: null, profile: { name: "", email: "" } }),
		});
		window.sessionStorage.clear();
		actionDone("You have been logged out.");
		showToast("Logged out successfully. Redirecting to login...");

		window.setTimeout(() => {
			window.location.href = "/login";
		}, 180);
	};

	const handleExportNotesAsPdf = async () => {
		if (isExportingNotesPdf) {
			return;
		}

		setIsExportingNotesPdf(true);

		try {
			const response = await fetch("/api/highlights", { cache: "no-store" });
			if (!response.ok) {
				throw new Error("Failed to load highlights for export");
			}

			const result = (await response.json()) as HighlightsExportResponse;
			const highlights = Array.isArray(result.data) ? result.data : [];

			const { jsPDF } = await import("jspdf");
			const doc = new jsPDF({ unit: "pt", format: "a4" });
			const pageWidth = doc.internal.pageSize.getWidth();
			const pageHeight = doc.internal.pageSize.getHeight();
			const margin = 40;
			const maxWidth = pageWidth - margin * 2;
			let cursorY = margin;

			doc.setFontSize(18);
			doc.text("UniFlow - Highlights Export", margin, cursorY);
			cursorY += 22;
			doc.setFontSize(10);
			doc.setTextColor(90);
			doc.text(`Generated: ${new Date().toLocaleString()}`, margin, cursorY);
			cursorY += 20;
			doc.setTextColor(20);

			if (highlights.length === 0) {
				doc.setFontSize(12);
				doc.text("No notes available to export.", margin, cursorY);
			} else {
				for (let index = 0; index < highlights.length; index += 1) {
					const highlight = highlights[index];

					const title = (highlight.title || "Untitled source").trim();
					const text = (highlight.text || "").replace(/\s+/g, " ").trim();
					const url = (highlight.url || "Unknown source").trim();
					const highlightedAt = new Date(highlight.createdAt);
					const created = Number.isNaN(highlightedAt.getTime())
						? "Unknown date"
						: highlightedAt.toLocaleString();

					doc.setFontSize(12);
					doc.setFont("helvetica", "bold");
					const titleLines = doc.splitTextToSize(`${index + 1}. ${title}`, maxWidth);

					doc.setFont("helvetica", "normal");
					doc.setFontSize(10);
					const metaLines = doc.splitTextToSize(`Source: ${url} | Highlighted: ${created}`, maxWidth);

					doc.setFontSize(11);
					const bodyLines = doc.splitTextToSize(text || "(Empty highlight text)", maxWidth);

					const requiredHeight = titleLines.length * 15 + metaLines.length * 13 + bodyLines.length * 14 + 20;

					if (cursorY + requiredHeight > pageHeight - margin) {
						doc.addPage();
						cursorY = margin;
					}

					doc.setFont("helvetica", "bold");
					doc.setFontSize(12);
					doc.text(titleLines, margin, cursorY);
					cursorY += titleLines.length * 15;

					doc.setFont("helvetica", "normal");
					doc.setFontSize(10);
					doc.setTextColor(90);
					doc.text(metaLines, margin, cursorY);
					cursorY += metaLines.length * 13;

					doc.setTextColor(20);
					doc.setFontSize(11);
					doc.text(bodyLines, margin, cursorY);
					cursorY += bodyLines.length * 14 + 16;
				}
			}

			const defaultName = `verdant-notes-${new Date().toISOString().slice(0, 10)}`;
			const enteredName = window.prompt("Enter PDF filename", defaultName);

			if (enteredName === null) {
				actionDone("PDF export canceled.");
				showToast("PDF export canceled.");
				return;
			}

			const sanitizedName = enteredName
				.trim()
				.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
				.replace(/\s+/g, "-")
				.slice(0, 80);
			const finalName = sanitizedName.length > 0 ? sanitizedName : defaultName;

			doc.save(`${finalName}.pdf`);
			actionDone("Notes exported as PDF.");
			showToast("PDF exported successfully.");
		} catch {
			actionDone("PDF export failed. Please try again.");
			showToast("PDF export failed. Please try again.");
		} finally {
			setIsExportingNotesPdf(false);
		}
	};

	const handleSaveAllSettings = () => {
		const trimmedName = name.trim();
		const trimmedEmail = email.trim();

		if (!trimmedName || !trimmedEmail) {
			actionDone("Name and email are required to save all settings.");
			showToast("Please enter both name and email before saving.");
			return;
		}

		const preferences: StoredSettingsPreferences = {
			voiceTranscription,
			autoSaveTranscripts,
			autoSaveHighlights,
			organizeByWebpage,
			aiSummaries,
		};

		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				profile: { name: trimmedName, email: trimmedEmail },
				currentUserEmail: trimmedEmail,
				settingsPreferences: preferences,
				transcriptLanguage,
				fontScale,
			}),
		});
		document.documentElement.style.fontSize = `${fontScale}%`;

		setName(trimmedName);
		setEmail(trimmedEmail);
		actionDone("All settings saved successfully.");
		showToast("All settings have been saved.");
	};

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
					{isDeleteHighlightsModalOpen ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]">
					<div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-300 bg-white shadow-2xl dark:border-rose-700 dark:bg-slate-900">
						<div className="bg-gradient-to-r from-rose-100 to-orange-100 px-5 py-4 dark:from-rose-900/40 dark:to-orange-900/30">
							<p className="text-xs font-semibold tracking-[0.12em] text-rose-700 uppercase dark:text-rose-300">Danger Zone</p>
							<h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Delete all highlights?</h2>
						</div>
						<div className="space-y-4 px-5 py-4">
							<p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
								Are you sure you want to delete all highlights? This action will clear your saved notes data and cannot be undone.
							</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => setIsDeleteHighlightsModalOpen(false)}
									disabled={isDeletingHighlights}
								>
									Cancel
								</Button>
								<Button
									variant="destructive"
									onClick={handleConfirmDeleteAllHighlights}
									disabled={isDeletingHighlights}
								>
									{isDeletingHighlights ? "Deleting..." : "Yes, Delete All"}
								</Button>
							</div>
						</div>
					</div>
				</div>
			) : null}

			{toastMessage ? (
				<div className="fixed top-5 right-5 z-50 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 shadow-lg animate-in fade-in slide-in-from-top-2 dark:border-emerald-600/40 dark:bg-emerald-900/80 dark:text-emerald-100">
					{toastMessage}
				</div>
			) : null}

		<header className="space-y-1">
			<h1 className="text-2xl font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">Settings</h1>
			<p className="text-sm text-[#6a9470] dark:text-[#5a8060]">
				Customize your workspace, voice tools, highlights, and privacy controls.
			</p>
		</header>

		<div className="rounded-xl border border-[#cde0c9] bg-[#eef6ec] px-4 py-2 text-sm text-[#3a6b45] dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#90c898]">
			{statusMessage}
		</div>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<SectionCard
				title="Profile Settings"
				description="Update your display name and account details."
				icon={<CircleUserRound className="size-4" />}
			>
				<div className="flex items-center gap-4 rounded-xl border border-[#e0edd9] p-3 dark:border-[#1e3020]">
					<Avatar className="h-12 w-12">
						<AvatarFallback className="text-base font-semibold">{getInitials(name)}</AvatarFallback>
					</Avatar>
					<div>
						<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">{name || "—"}</p>
						<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">{email || "—"}</p>
					</div>
				</div>
				<div className="space-y-2">
					<label className="text-sm font-medium">Display Name</label>
					<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
				</div>
				<div className="space-y-2">
					<label className="text-sm font-medium">Email</label>
					<Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
				</div>
				<Button onClick={handleUpdateProfile}>Update Profile</Button>
			</SectionCard>

				<SectionCard
					title="Voice & Transcript"
					description="Control Meet voice capture and transcript behavior."
					icon={<Mic className="size-4" />}
				>
					<SettingToggle
						label="Enable Voice Transcription"
						description="Turn live transcript capture on or off in Meet."
						value={voiceTranscription}
						onChange={setVoiceTranscription}
					/>
				<div className="space-y-2 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] p-3 dark:border-[#1e3020] dark:bg-[#0d1a10]">
					<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">Transcript Language</p>
						<div className="flex flex-wrap gap-2">
							{(["English", "Spanish", "French", "German", "Korean", "Hindi"] as TranscriptLanguage[]).map((language) => (
								<Button
									key={language}
									variant={transcriptLanguage === language ? "default" : "outline"}
									size="sm"
									onClick={() => {
										setTranscriptLanguage(language);
										actionDone(`Transcript language set to ${language}.`);
									}}
								>
									{language}
								</Button>
							))}
						</div>
					</div>
					<SettingToggle
						label="Auto-save Transcripts"
						description="Save each Meet transcript automatically."
						value={autoSaveTranscripts}
						onChange={setAutoSaveTranscripts}
					/>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={handleDownloadTranscripts}>Download Transcripts</Button>
						<Button variant="destructive" onClick={handleClearTranscriptHistory}>Clear History</Button>
					</div>
				</SectionCard>

				<SectionCard
					title="Highlight & Notes"
					description="Manage note capture and summary preferences."
					icon={<FileText className="size-4" />}
				>
					<SettingToggle
						label="Auto-save Highlights to Notes"
						description="Store highlighted content directly in Notes."
						value={autoSaveHighlights}
						onChange={setAutoSaveHighlights}
					/>
					<SettingToggle
						label="Organize by Webpage"
						description="Group highlights under source webpage automatically."
						value={organizeByWebpage}
						onChange={setOrganizeByWebpage}
					/>
					<SettingToggle
						label="Enable AI Summaries"
						description="Generate summary cards from your latest highlights."
						value={aiSummaries}
						onChange={setAiSummaries}
					/>
					<Button variant="outline" onClick={() => void handleExportNotesAsPdf()} disabled={isExportingNotesPdf}>
						{isExportingNotesPdf ? "Exporting PDF..." : "Export Notes as PDF"}
					</Button>
				</SectionCard>

							<SectionCard
					title="Appearance"
					description="Adjust visual style for comfortable learning."
					icon={<MoonStar className="size-4" />}
				>
				<div className="flex items-center justify-between rounded-xl border border-[#e0edd9] bg-[#f7fbf6] p-3 dark:border-[#1e3020] dark:bg-[#0d1a10]">
					<div>
						<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">Theme Mode</p>
						<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">Switch between light and dark appearance.</p>
					</div>
					<ThemeToggle />
				</div>
				<div className="space-y-2 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] p-3 dark:border-[#1e3020] dark:bg-[#0d1a10]">
					<div className="flex items-center justify-between">
						<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">Font Size</p>
						<span className="rounded-full bg-[#eef6ec] px-2.5 py-0.5 text-xs font-medium text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#90c898]">{fontScale}%</span>
					</div>
					<input
						type="range"
						min={85}
						max={125}
						value={fontScale}
						onChange={(event) => setFontScale(Number(event.target.value))}
						className="w-full accent-[#4a9456]"
					/>
				</div>
			</SectionCard>

			<SectionCard
				title="Privacy & Data"
				description="Manage sensitive data and account safety controls."
				icon={<Shield className="size-4" />}
			>
				<div className="flex flex-wrap gap-2">
					<Button variant="destructive" onClick={handleClearSavedNotes} disabled={isDeletingHighlights}>Clear Saved Notes</Button>
					<Button variant="destructive" onClick={handleRequestDeleteAllHighlights} disabled={isDeletingHighlights}>Delete All Highlights</Button>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" onClick={handleLogoutAccount}>Sign Out</Button>
					<Button variant="outline" onClick={handleSaveAllSettings}>Save All Settings</Button>
				</div>
			</SectionCard>
			</div>
		</div>
	);
}
