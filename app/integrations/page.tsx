"use client";

import { useEffect, useState } from "react";
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
import {
	CheckCircle2,
	ChevronDown,
	Cloud,
	Copy,
	FileText,
	GitBranch,
	Loader2,
	MessageSquare,
	TrendingUp,
	type LucideIcon,
} from "lucide-react";


type DemoIntegration = {
	name: string;
	description: string;
	icon: LucideIcon;
	iconBgClassName: string;
};

const demoIntegrations: DemoIntegration[] = [
	{
		name: "Google Docs",
		description: "Sync and import from Google Docs",
		icon: FileText,
		iconBgClassName: "bg-verdant-50 text-verdant-700",
	},
	{
		name: "Slack",
		description: "Save messages and threads to notes",
		icon: MessageSquare,
		iconBgClassName: "bg-violet-50 text-violet-600",
	},
	{
		name: "Salesforce",
		description: "Export meeting notes to CRM records",
		icon: Cloud,
		iconBgClassName: "bg-sky-50 text-sky-600",
	},
	{
		name: "HubSpot",
		description: "Sync contacts and deal notes",
		icon: TrendingUp,
		iconBgClassName: "bg-orange-50 text-orange-600",
	},
	{
		name: "Linear",
		description: "Link issues and project updates",
		icon: GitBranch,
		iconBgClassName: "bg-slate-100 text-slate-600",
	},
];


function NotionIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 100 100" className={className} aria-hidden="true">
			<path
				d="M6 4.8C9.4 7.6 10.7 7.4 13.3 7.2l51.2-3.4c.5 0 .1-.5-.1-.5L53.8.5c-2.2-.3-4.5-.2-6.8.1L6.4 4.3C5.8 4.4 5.5 4.5 6 4.8zM8 14.5v51.6c0 2.8 1.4 3.9 4.5 3.7l56.2-3.2c3.1-.2 3.5-2.1 3.5-4.4V10.9c0-2.3-1-3.6-3.1-3.4L11.2 11c-2.3.2-3.2 1.5-3.2 3.5zm55.1 4.1c.3 1.4 0 2.8-1.4 3l-2.2.4v32.4c-1.9 1-3.7 1.6-5.2 1.6-2.4 0-3-.7-4.8-2.9L32 29v28.2l5.4 1.2s0 2.8-3.9 2.8L22.1 62c-.3-1.4 0-2.9 1-3.3l2.6-.7V24.2L22.2 24c-.3-1.4.4-3.4 2.5-3.5L38.1 19.7l18.4 28.1V21l-4.5-.5c-.3-1.7 1-2.9 2.5-3L63.1 18.6z"
				fill="currentColor"
			/>
		</svg>
	);
}


interface NotionOAuthStatus {
	oauthConfigured: boolean;
	credentialsInDb: boolean;
	connected: boolean;
	oauthConnected: boolean;
	workspaceName: string | null;
	workspaceIcon: string | null;
	hasParentPage: boolean;
	hasCachedDb: boolean;
}

interface NotionPage {
	id: string;
	title: string;
	icon: string | null;
	url: string;
}


function PagePicker({ onSaved }: { onSaved: () => void }) {
	const [pages, setPages] = useState<NotionPage[]>([]);
	const [selectedId, setSelectedId] = useState<string>("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const loadPages = async () => {
			setLoading(true);
			setError(null);
			try {
				const [pagesRes, prefsRes] = await Promise.all([
					fetch("/api/notion/pages", { cache: "no-store" }),
					fetch("/api/preferences", { cache: "no-store" }),
				]);
				if (!pagesRes.ok) throw new Error("Could not load pages");
				const { pages: list } = (await pagesRes.json()) as { pages: NotionPage[] };
				const prefs = (await prefsRes.json()) as { data?: { notionParentPageId?: string } };
				setPages(list);
				setSelectedId(prefs.data?.notionParentPageId ?? "");
			} catch {
				setError("Could not load your Notion pages. Try reconnecting.");
			} finally {
				setLoading(false);
			}
		};
		void loadPages();
	}, []);

	const handleChange = async (id: string) => {
		setSelectedId(id);
		setSaving(true);
		try {
			await fetch("/api/preferences", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ notionParentPageId: id || null }),
			});
			onSaved();
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="flex items-center gap-2 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] px-3 py-2.5 dark:border-[#1e3020] dark:bg-[#0d1a10]">
				<Loader2 className="size-4 animate-spin text-[#8ab490]" />
				<span className="text-sm text-[#6a9470]">Loading your pages…</span>
			</div>
		);
	}

	if (error) {
		return <p className="text-xs text-red-500">{error}</p>;
	}

	if (pages.length === 0) {
		return (
			<p className="text-xs text-[#8ab490] dark:text-[#4a7054]">
				No pages found in your workspace. Create a page in Notion first.
			</p>
		);
	}

	const selectedPage = pages.find((p) => p.id === selectedId);

	return (
		<div className="relative">
			<div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
				{selectedPage?.icon ? (
					selectedPage.icon.startsWith("http") ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={selectedPage.icon} alt="" className="size-4 rounded-sm object-cover" />
					) : (
						<span className="text-sm leading-none">{selectedPage.icon}</span>
					)
				) : (
					<FileText className="size-4 text-[#8ab490]" />
				)}
			</div>
			<select
				value={selectedId}
				onChange={(e) => void handleChange(e.target.value)}
				disabled={saving}
				className="w-full appearance-none rounded-xl border border-[#cde0c9] bg-white py-2.5 pl-9 pr-9 text-sm text-[#2c4a35] shadow-none transition focus:border-[#4a9456] focus:outline-none focus:ring-2 focus:ring-[#cde0c9] disabled:opacity-60 dark:border-[#2a4030] dark:bg-[#0d1a10] dark:text-[#c8e6cb]"
			>
				<option value="">— No default page —</option>
				{pages.map((p) => (
					<option key={p.id} value={p.id}>
						{p.icon && !p.icon.startsWith("http") ? `${p.icon} ` : ""}{p.title}
					</option>
				))}
			</select>
			<div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
				{saving ? (
					<Loader2 className="size-4 animate-spin text-[#4a9456]" />
				) : (
					<ChevronDown className="size-4 text-[#8ab490]" />
				)}
			</div>
		</div>
	);
}


function NotionSetupWizard({ onSaved }: { onSaved: () => void }) {
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Compute the redirect URI from the browser's current origin
	const redirectUri =
		typeof window !== "undefined"
			? `${window.location.origin}/api/notion/oauth/callback`
			: "/api/notion/oauth/callback";

	const copyRedirectUri = () => {
		void navigator.clipboard.writeText(redirectUri);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleSave = async () => {
		if (!clientId.trim() || !clientSecret.trim()) {
			setError("Both Client ID and Client Secret are required.");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const res = await fetch("/api/preferences", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					notionOauthClientId: clientId.trim(),
					notionOauthClientSecret: clientSecret.trim(),
				}),
			});
			if (!res.ok) throw new Error("Failed to save");
			onSaved();
		} catch {
			setError("Could not save — please try again.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-5">
			{/* Step 1 */}
			<div className="flex gap-3">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
					1
				</div>
				<div className="space-y-1.5 pt-0.5">
					<p className="text-sm font-medium text-gray-800 dark:text-slate-100">
						Create a Notion integration
					</p>
					<p className="text-xs text-gray-500 dark:text-slate-400">
						Go to{" "}
						<a
							href="https://www.notion.so/my-integrations"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400"
						>
							notion.so/my-integrations
						</a>{" "}
						â†’ click <strong>New integration</strong> â†’ give it any name â†’ set the type to{" "}
						<strong>Public</strong>.
					</p>
				</div>
			</div>

			{/* Step 2 */}
			<div className="flex gap-3">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
					2
				</div>
				<div className="w-full space-y-2 pt-0.5">
					<p className="text-sm font-medium text-gray-800 dark:text-slate-100">
						Add the redirect URI
					</p>
					<p className="text-xs text-gray-500 dark:text-slate-400">
						Under <strong>OAuth Domain &amp; URIs</strong>, paste this exact URL:
					</p>
					<div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 dark:border-indigo-800/30 dark:bg-indigo-900/10">
						<code className="flex-1 break-all text-[11px] font-mono text-indigo-800 dark:text-indigo-300">
							{redirectUri}
						</code>
						<button
							type="button"
							onClick={copyRedirectUri}
							className="shrink-0 rounded p-1 text-indigo-500 transition hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
							title="Copy"
						>
							{copied ? (
								<CheckCircle2 className="size-4 text-verdant-600" />
							) : (
								<Copy className="size-4" />
							)}
						</button>
					</div>
				</div>
			</div>

			{/* Step 3 */}
			<div className="flex gap-3">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
					3
				</div>
				<div className="w-full space-y-3 pt-0.5">
					<p className="text-sm font-medium text-gray-800 dark:text-slate-100">
						Paste your credentials here
					</p>
					<p className="text-xs text-gray-500 dark:text-slate-400">
						Copy the <strong>OAuth client ID</strong> and <strong>OAuth client secret</strong> from
						the integration page and paste them below.
					</p>
					<div className="space-y-2">
						<Input
							placeholder="Client ID  (e.g. 12345678-…)"
							value={clientId}
							onChange={(e) => setClientId(e.target.value)}
							className="font-mono text-xs"
						/>
						<Input
							placeholder="Client Secret  (e.g. secret_…)"
							type="password"
							value={clientSecret}
							onChange={(e) => setClientSecret(e.target.value)}
							className="font-mono text-xs"
							onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
						/>
					</div>
					{error && <p className="text-xs text-red-500">{error}</p>}
					<Button
						className="w-full rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
						onClick={() => void handleSave()}
						disabled={saving}
					>
						{saving ? (
							<><Loader2 className="mr-2 size-4 animate-spin" />Saving…</>
						) : (
							<>Save &amp; Continue â†’</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}


function NotionIntegrationCard() {
	const [oauthStatus, setOauthStatus] = useState<NotionOAuthStatus | null>(null);
	const [isDisconnecting, setIsDisconnecting] = useState(false);
	const [showSetup, setShowSetup] = useState(false);
	const [flashMessage, setFlashMessage] = useState<{ text: string; ok: boolean } | null>(null);

	const loadStatus = async () => {
		try {
			const res = await fetch("/api/notion/oauth/status", { cache: "no-store" });
			if (!res.ok) return;
			setOauthStatus((await res.json()) as NotionOAuthStatus);
		} catch {
			// ignore
		}
	};

	useEffect(() => {
		void loadStatus();
		const params = new URLSearchParams(window.location.search);
		if (params.get("notion") === "connected") {
			setFlashMessage({ text: "Notion connected! Choose a default page below.", ok: true });
			window.history.replaceState({}, "", window.location.pathname);
		} else if (params.get("notion_error")) {
			setFlashMessage({
				text: decodeURIComponent(params.get("notion_error") ?? "Connection failed"),
				ok: false,
			});
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	const handleDisconnect = async () => {
		setIsDisconnecting(true);
		try {
			await fetch("/api/notion/verify", { method: "DELETE" });
			setOauthStatus(null);
			setFlashMessage(null);
			await loadStatus();
		} catch {
			setFlashMessage({ text: "Could not disconnect — please try again.", ok: false });
		} finally {
			setIsDisconnecting(false);
		}
	};

	const isConnected = oauthStatus?.connected ?? false;
	const isOAuth = oauthStatus?.oauthConnected ?? false;
	const oauthConfigured = oauthStatus?.oauthConfigured ?? false;
	// Show setup if user hasn't saved credentials yet (or explicitly clicked "Set up")
	const needsSetup = !oauthConfigured || showSetup;

	return (
		<Card className="rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="inline-flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
							<NotionIcon className="size-5" />
						</div>
						<div>
							<CardTitle className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Notion</CardTitle>
							<CardDescription className="mt-0.5 text-xs text-[#6a9470] dark:text-[#5a8060]">
								Send meeting action items to your Notion workspace
							</CardDescription>
						</div>
					</div>
					{isConnected && !showSetup && (
						<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef6ec] px-2.5 py-1 text-xs font-medium text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#90c898]">
							<CheckCircle2 className="size-3" />
							Connected
						</span>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{flashMessage && !showSetup && (
					<p className={`rounded-lg px-3 py-2 text-xs font-medium ${
						flashMessage.ok
							? "bg-[#eef6ec] text-[#3a6b45] dark:bg-[#0d1a10] dark:text-[#90c898]"
							: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
					}`}>
						{flashMessage.text}
					</p>
				)}

				{isConnected && !showSetup ? (
					<>
						<div className="flex items-center gap-3 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] px-4 py-3 dark:border-[#1e3020] dark:bg-[#0d1a10]">
							{oauthStatus?.workspaceIcon ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={oauthStatus.workspaceIcon} alt="" className="size-8 rounded-md object-cover" />
							) : (
								<div className="flex size-8 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
									<NotionIcon className="size-4 text-slate-500" />
								</div>
							)}
							<div className="min-w-0">
								<p className="truncate text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">
									{oauthStatus?.workspaceName ?? "Notion workspace"}
								</p>
								<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">
									{isOAuth ? "Full workspace access" : "Connected via integration token"}
								</p>
							</div>
						</div>

						<div className="space-y-2">
							<div>
								<p className="text-sm font-medium text-[#2c4a35] dark:text-[#c8e6cb]">Default page for action items</p>
								<p className="mt-0.5 text-xs text-[#6a9470] dark:text-[#5a8060]">
									Task lists from your meetings will be created inside this page.
								</p>
							</div>
							<PagePicker onSaved={() => { void loadStatus(); setFlashMessage({ text: "Default page saved.", ok: true }); }} />
						</div>

						<div className="flex items-center justify-between pt-1">
							<a href="/api/notion/oauth/authorize"
								className="text-xs text-[#8ab490] underline underline-offset-2 hover:text-[#5a8a63] dark:text-[#4a7054]">
								Re-authorize
							</a>
							<Button size="sm" variant="outline"
								className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400"
								onClick={() => void handleDisconnect()} disabled={isDisconnecting}>
								{isDisconnecting ? "Disconnecting…" : "Disconnect"}
							</Button>
						</div>
					</>
				) : oauthConfigured && !showSetup ? (
					<>
						<p className="text-sm text-[#5a8a63] dark:text-[#6a9070]">
							Connect your Notion account to send action items from meetings directly to your workspace — no manual page sharing required.
						</p>
						<Button className="w-full rounded-lg bg-[#2c2c2c] text-white hover:bg-[#1a1a1a] dark:bg-[#1a1a1a]" asChild>
							<a href="/api/notion/oauth/authorize">
								<NotionIcon className="mr-2 size-4" />
								Connect with Notion
							</a>
						</Button>
						<button type="button" onClick={() => setShowSetup(true)}
							className="w-full text-center text-xs text-[#8ab490] underline underline-offset-2 hover:text-[#5a8a63] dark:text-[#4a7054]">
							Change credentials
						</button>
					</>
				) : (
					<>
						{showSetup && (
							<button type="button" onClick={() => setShowSetup(false)}
								className="mb-1 text-xs text-[#8ab490] underline underline-offset-2 hover:text-[#5a8a63]">
								â† Back
							</button>
						)}
						{!showSetup && (
							<p className="text-sm text-[#5a8a63] dark:text-[#6a9070]">Set up in 3 steps — takes about 2 minutes.</p>
						)}
						<NotionSetupWizard onSaved={async () => {
							await loadStatus();
							setShowSetup(false);
							setFlashMessage({ text: "Credentials saved! Click \"Connect with Notion\" to authorize.", ok: true });
						}} />
					</>
				)}
			</CardContent>
		</Card>
	);
}


export default function IntegrationsPage() {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-8 pb-12">
			<header>
				<h1 className="text-2xl font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">Integrations</h1>
				<p className="mt-0.5 text-sm text-[#6a9470] dark:text-[#5a8060]">
					Connect your tools to streamline your workflow
				</p>
			</header>

			{/* â”€â”€ Active integrations â”€â”€ */}
			<div className="space-y-4">
				<h2 className="text-[0.7rem] font-semibold uppercase tracking-widest text-[#8ab490] dark:text-[#4a7054]">
					Active Integrations
				</h2>
				<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
					<NotionIntegrationCard />

					{/* Google Drive */}
					<Card className="rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
						<CardHeader className="pb-3">
							<div className="flex items-start gap-3">
								<div className="inline-flex size-11 items-center justify-center rounded-full bg-[#e4f3e0] dark:bg-[#1a3020]">
									<FileText className="size-5 text-[#4a9456] dark:text-[#6bbf7e]" />
								</div>
								<div>
									<CardTitle className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Google Drive</CardTitle>
									<CardDescription className="mt-0.5 text-xs text-[#6a9470] dark:text-[#5a8060]">
										Import and sync documents from your Drive
									</CardDescription>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<p className="mb-4 text-xs text-[#6a9470] dark:text-[#5a8060]">
								Tokens are stored securely in MongoDB. Grants read-only Drive access.
							</p>
							<Button asChild variant="outline"
								className="rounded-lg border-[#cde0c9] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898]">
								<a href="/api/integrations/google/authorize">Connect Google Drive</a>
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* â”€â”€ Coming soon â”€â”€ */}
			<div className="space-y-4">
				<h2 className="text-[0.7rem] font-semibold uppercase tracking-widest text-[#8ab490] dark:text-[#4a7054]">
					Coming Soon
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{demoIntegrations.map((integration) => {
						const Icon = integration.icon;
						return (
							<div key={integration.name}
								className="flex items-start gap-3 rounded-2xl border border-[#e0edd9] bg-[#f7fbf6] px-4 py-3.5 opacity-75 dark:border-[#1e3020] dark:bg-[#0d1a10]">
								<div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef6ec] dark:bg-[#1a2e1e]">
									<Icon className="size-4 text-[#6a9470] dark:text-[#5a8060]" />
								</div>
								<div>
									<p className="text-sm font-medium text-[#3a5a42] dark:text-[#a0c8a8]">{integration.name}</p>
									<p className="mt-0.5 text-xs text-[#8ab490] dark:text-[#4a7054]">{integration.description}</p>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
