"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
	BookOpen,
	CalendarDays,
	CheckSquare,
	Highlighter,
	Loader2,
	Pencil,
	Plus,
	Video,
	X,
} from "lucide-react";


interface ProfileStats {
	notes: number;
	meets: number;
	highlights: number;
	actionItems: number;
	summarizedMeets: number;
}

interface CustomTag {
	topic: string;
}


function initials(name: string): string {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase() ?? "")
		.join("") || "?";
}

function formatMemberSince(iso: string | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (isNaN(d.getTime())) return "";
	return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}


function StatCard({
	icon: Icon,
	label,
	value,
	loading,
}: {
	icon: React.ElementType;
	label: string;
	value: number;
	loading: boolean;
}) {
	return (
		<div className="rounded-2xl border border-[#cde0c9] bg-white p-5 text-center shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md dark:border-[#2a4030] dark:bg-[#111d14]">
			<div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-[#e4f3e0] dark:bg-[#1a3020]">
				<Icon className="size-5 text-[#4a9456] dark:text-[#6bbf7e]" />
			</div>
			{loading ? (
				<div className="flex h-8 items-center justify-center">
					<Loader2 className="size-5 animate-spin text-[#cde0c9] dark:text-[#2a4030]" />
				</div>
			) : (
				<p className="text-3xl font-bold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">{value}</p>
			)}
			<p className="mt-0.5 text-sm text-[#6a9470] dark:text-[#5a8060]">{label}</p>
		</div>
	);
}


export default function ProfilePage() {
	const router = useRouter();

	// Profile
	const [profileName, setProfileName] = useState("");
	const [profileEmail, setProfileEmail] = useState("");
	const [memberSince, setMemberSince] = useState<string | undefined>();
	const [isEditingProfile, setIsEditingProfile] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [draftEmail, setDraftEmail] = useState("");
	const [profileMessage, setProfileMessage] = useState<string | null>(null);
	const [isSavingProfile, setIsSavingProfile] = useState(false);

	// Stats
	const [stats, setStats] = useState<ProfileStats | null>(null);
	const [statsLoading, setStatsLoading] = useState(true);

	// Custom tags
	const [customTags, setCustomTags] = useState<CustomTag[]>([]);
	const [prefsLoaded, setPrefsLoaded] = useState(false);
	const [isAddingTag, setIsAddingTag] = useState(false);
	const [newTagName, setNewTagName] = useState("");

	// Settings
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
	const [showDeleteForm, setShowDeleteForm] = useState(false);
	const [deleteConfirmText, setDeleteConfirmText] = useState("");
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);
	const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

	// â”€â”€ Load profile + tags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	useEffect(() => {
		void (async () => {
			try {
				// Load authoritative name/email from auth system
				const meRes = await fetch("/api/auth/me", { cache: "no-store" });
				if (meRes.ok) {
					const meJson = (await meRes.json()) as { user?: { name?: string; email?: string; createdAt?: string } };
					if (meJson.user?.name) setProfileName(meJson.user.name);
					if (meJson.user?.email) setProfileEmail(meJson.user.email);
					if (meJson.user?.createdAt) setMemberSince(meJson.user.createdAt);
				}

				// Also load preferences for custom tags
				const res = await fetch("/api/preferences", { cache: "no-store" });
				if (!res.ok) return;
				const json = (await res.json()) as {
					data?: {
						profile?: { name?: string; email?: string };
						customTags?: unknown[];
						accountCreatedAt?: string;
					};
				};
				const d = json.data;
				// Only fallback to prefs for name/email if me didn't provide them
				if (!profileName && d?.profile?.name?.trim()) setProfileName(d.profile.name.trim());
				if (!profileEmail && d?.profile?.email?.trim()) setProfileEmail(d.profile.email.trim());
				if (!memberSince && d?.accountCreatedAt) setMemberSince(d.accountCreatedAt);
				const raw = d?.customTags;
				if (Array.isArray(raw)) {
					setCustomTags(
						raw
							.filter((t): t is { topic: string } => !!t && typeof (t as { topic?: unknown }).topic === "string")
							.map((t) => ({ topic: (t as { topic: string }).topic.trim() }))
							.filter((t) => t.topic.length > 0)
					);
				}
			} finally {
				setPrefsLoaded(true);
			}
		})();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// â”€â”€ Load stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	useEffect(() => {
		void fetch("/api/profile/stats", { cache: "no-store" })
			.then((r) => r.json())
			.then((j: ProfileStats) => setStats(j))
			.catch(() => setStats({ notes: 0, meets: 0, highlights: 0, actionItems: 0, summarizedMeets: 0 }))
			.finally(() => setStatsLoading(false));
	}, []);

	// â”€â”€ Persist custom tags whenever they change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	useEffect(() => {
		if (!prefsLoaded) return;
		void fetch("/api/preferences", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ customTags }),
		});
	}, [customTags, prefsLoaded]);

	// â”€â”€ Profile edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	const startEdit = () => {
		setDraftName(profileName);
		setDraftEmail(profileEmail);
		setProfileMessage(null);
		setIsEditingProfile(true);
	};

	const saveProfile = async () => {
		const name = draftName.trim();
		const email = draftEmail.trim();
		if (!name) { setProfileMessage("Name is required."); return; }
		const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
		if (email && !emailOk) { setProfileMessage("Enter a valid email address."); return; }

		setIsSavingProfile(true);
		setProfileMessage(null);
		try {
			await fetch("/api/preferences", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ profile: { name, email }, currentUserEmail: email }),
			});
			setProfileName(name);
			setProfileEmail(email);
			setIsEditingProfile(false);
			setProfileMessage("Profile updated.");
		} catch {
			setProfileMessage("Could not save — please try again.");
		} finally {
			setIsSavingProfile(false);
		}
	};

	// â”€â”€ Tags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	const addTag = () => {
		const name = newTagName.trim();
		if (!name || customTags.some((t) => t.topic.toLowerCase() === name.toLowerCase())) {
			setNewTagName("");
			setIsAddingTag(false);
			return;
		}
		setCustomTags((prev) => [...prev, { topic: name }]);
		setNewTagName("");
		setIsAddingTag(false);
	};

	const removeTag = (topic: string) => {
		setCustomTags((prev) => prev.filter((t) => t.topic.toLowerCase() !== topic.toLowerCase()));
	};

	// â”€â”€ Change password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	const handleChangePassword = async () => {
		if (!currentPassword || !newPassword || !confirmPassword) {
			setSettingsMessage("Fill in all password fields.");
			return;
		}
		if (newPassword.length < 8) {
			setSettingsMessage("New password must be at least 8 characters.");
			return;
		}
		if (newPassword !== confirmPassword) {
			setSettingsMessage("Passwords do not match.");
			return;
		}
		setIsUpdatingPassword(true);
		setSettingsMessage(null);
		try {
			const res = await fetch("/api/account/password", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ currentPassword, newPassword }),
			});
			const json = (await res.json()) as { error?: string };
			if (!res.ok) { setSettingsMessage(json.error ?? "Failed to update password."); return; }
			setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
			setShowPasswordForm(false);
			setSettingsMessage("Password changed successfully.");
		} catch {
			setSettingsMessage("Unable to reach server. Please try again.");
		} finally {
			setIsUpdatingPassword(false);
		}
	};

	// â”€â”€ Delete account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	const handleDeleteAccount = async () => {
		if (deleteConfirmText.trim() !== "DELETE") {
			setSettingsMessage('Type "DELETE" exactly to confirm.');
			return;
		}
		if (!window.confirm("This will permanently delete all your data. Continue?")) return;

		setIsDeletingAccount(true);
		setSettingsMessage(null);
		try {
			const res = await fetch("/api/account", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ confirmText: "DELETE" }),
			});
			const json = (await res.json()) as { error?: string };
			if (!res.ok) { setSettingsMessage(json.error ?? "Failed to delete account."); return; }
			window.sessionStorage.clear();
			router.push("/");
		} catch {
			setSettingsMessage("Unable to reach server. Please try again.");
		} finally {
			setIsDeletingAccount(false);
		}
	};

	// â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

	const displayName = profileName || "Your Name";
	const memberSinceLabel = formatMemberSince(memberSince);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-7 pb-12">
			{/* â”€â”€ Page header â”€â”€ */}
			<header>
				<h1 className="text-2xl font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">
					My Profile
				</h1>
				<p className="mt-0.5 text-sm text-[#6a9470] dark:text-[#5a8060]">
					Manage your account and workspace activity
				</p>
			</header>

			{/* â”€â”€ Identity card â”€â”€ */}
			<div className="rounded-2xl border border-[#cde0c9] bg-white p-6 shadow-sm dark:border-[#2a4030] dark:bg-[#111d14] md:p-7">
				<div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-4">
						<Avatar className="size-16 text-lg">
							<AvatarFallback className="bg-[#d4e8d0] font-semibold text-[#3a6b45] dark:bg-[#1e3a28] dark:text-[#6bbf7e]">
								{initials(displayName)}
							</AvatarFallback>
						</Avatar>
						<div>
							<h2 className="text-xl font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">{displayName}</h2>
							{profileEmail && (
								<p className="mt-0.5 text-sm text-[#6a9470] dark:text-[#5a8060]">{profileEmail}</p>
							)}
							{memberSinceLabel && (
								<p className="mt-1 flex items-center gap-1.5 text-xs text-[#8ab490] dark:text-[#4a7054]">
									<CalendarDays className="size-3.5" />
									Member since {memberSinceLabel}
								</p>
							)}
							{!profileName && (
								<p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
									Set your name to personalise your profile â†’
								</p>
							)}
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="shrink-0 rounded-lg border-[#cde0c9] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898]"
						onClick={startEdit}
					>
						<Pencil className="mr-1.5 size-3.5" />
						Edit Profile
					</Button>
				</div>

				{isEditingProfile && (
					<div className="mt-5 border-t border-[#e0edd9] pt-5 dark:border-[#1e3020]">
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div className="space-y-1.5">
								<label className="text-xs font-medium text-[#5a8a63] dark:text-[#6bbf7e]">
									Full Name <span className="text-rose-500">*</span>
								</label>
								<Input
									value={draftName}
									onChange={(e) => setDraftName(e.target.value)}
									placeholder="Your full name"
									className="border-[#cde0c9] focus-visible:ring-[#4a9456] dark:border-[#2a4030]"
									onKeyDown={(e) => { if (e.key === "Enter") void saveProfile(); }}
								/>
							</div>
							<div className="space-y-1.5">
								<label className="text-xs font-medium text-[#5a8a63] dark:text-[#6bbf7e]">
									Email Address
								</label>
								<Input
									type="email"
									value={draftEmail}
									onChange={(e) => setDraftEmail(e.target.value)}
									placeholder="you@example.com"
									className="border-[#cde0c9] focus-visible:ring-[#4a9456] dark:border-[#2a4030]"
								/>
							</div>
						</div>
						{profileMessage && (
							<p className="mt-2 text-xs text-rose-500">{profileMessage}</p>
						)}
						<div className="mt-4 flex justify-end gap-2">
							<Button variant="outline" size="sm"
								className="border-[#cde0c9] text-[#3a6b45] dark:border-[#2a4030]"
								onClick={() => { setIsEditingProfile(false); setProfileMessage(null); }}>
								Cancel
							</Button>
							<Button size="sm" disabled={isSavingProfile}
								className="bg-[#4a9456] hover:bg-[#3d7d49] text-white dark:bg-[#5aaa66]"
								onClick={() => void saveProfile()}>
								{isSavingProfile ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
							</Button>
						</div>
					</div>
				)}

				{!isEditingProfile && profileMessage && (
					<p className="mt-4 text-xs text-[#4a9456] dark:text-[#6bbf7e]">{profileMessage}</p>
				)}
			</div>

			{/* â”€â”€ Stats â”€â”€ */}
			<section className="space-y-3">
				<div>
					<h2 className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Activity</h2>
					<p className="text-sm text-[#6a9470] dark:text-[#5a8060]">Your workspace at a glance</p>
				</div>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<StatCard icon={BookOpen} label="Notes" value={stats?.notes ?? 0} loading={statsLoading} />
					<StatCard icon={Video} label="Meetings" value={stats?.meets ?? 0} loading={statsLoading} />
					<StatCard icon={Highlighter} label="Highlights" value={stats?.highlights ?? 0} loading={statsLoading} />
					<StatCard icon={CheckSquare} label="Action Items" value={stats?.actionItems ?? 0} loading={statsLoading} />
				</div>
			</section>

			{/* â”€â”€ Custom tags â”€â”€ */}
			<div className="rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
				<div className="flex flex-row items-center justify-between gap-4 p-5 pb-3">
					<div>
						<h3 className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Tags</h3>
						<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">Labels to organise your notes and content</p>
					</div>
					<Button size="sm" variant="outline"
						className="shrink-0 rounded-lg border-[#cde0c9] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898]"
						onClick={() => setIsAddingTag(true)}>
						<Plus className="mr-1 size-3.5" />
						Add
					</Button>
				</div>
				<div className="px-5 pb-5">
					{isAddingTag && (
						<div className="mb-4 flex gap-2">
							<Input autoFocus value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
								placeholder="Tag name…" className="border-[#cde0c9] text-sm focus-visible:ring-[#4a9456] dark:border-[#2a4030]"
								onKeyDown={(e) => {
									if (e.key === "Enter") addTag();
									if (e.key === "Escape") { setIsAddingTag(false); setNewTagName(""); }
								}} />
							<Button size="sm" className="bg-[#4a9456] hover:bg-[#3d7d49] text-white" onClick={addTag}>Add</Button>
							<Button size="sm" variant="outline" className="border-[#cde0c9] text-[#3a6b45] dark:border-[#2a4030]"
								onClick={() => { setNewTagName(""); setIsAddingTag(false); }}>
								Cancel
							</Button>
						</div>
					)}

					{customTags.length === 0 && !isAddingTag ? (
						<p className="py-2 text-sm text-[#8ab490] dark:text-[#4a7054]">
							No tags yet. Add tags to categorise your notes.
						</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{customTags.map((tag) => (
								<span key={tag.topic}
									className="inline-flex items-center gap-1 rounded-full bg-[#eef6ec] px-3 py-1 text-sm font-medium text-[#3a6b45] dark:bg-[#1a2e1e] dark:text-[#90c898]">
									{tag.topic}
									<button type="button" onClick={() => removeTag(tag.topic)}
										className="ml-0.5 flex size-4 items-center justify-center rounded-full hover:bg-[#d4e8d0] dark:hover:bg-[#2a4030]"
										aria-label={`Remove ${tag.topic}`}>
										<X className="size-2.5 text-[#5a8a63]" />
									</button>
								</span>
							))}
						</div>
					)}
				</div>
			</div>

			{/* â”€â”€ Account & Security â”€â”€ */}
			<div className="rounded-2xl border border-[#cde0c9] bg-white shadow-sm dark:border-[#2a4030] dark:bg-[#111d14]">
				<div className="p-5 pb-3">
					<h3 className="text-base font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">Account &amp; Security</h3>
					<p className="text-xs text-[#6a9470] dark:text-[#5a8060]">Manage your password and account data</p>
				</div>
				<div className="space-y-4 px-5 pb-5">
					<div className="flex flex-wrap gap-3">
						<Button variant="outline" size="sm"
							className="rounded-lg border-[#cde0c9] text-[#3a6b45] hover:bg-[#eef6ec] dark:border-[#2a4030] dark:text-[#90c898]"
							onClick={() => { setShowPasswordForm((v) => !v); setShowDeleteForm(false); setSettingsMessage(null); }}>
							Change Password
						</Button>
						<Button variant="outline" size="sm"
							className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400"
							onClick={() => { setShowDeleteForm((v) => !v); setShowPasswordForm(false); setSettingsMessage(null); }}>
							Delete All Data
						</Button>
					</div>

					{showPasswordForm && (
						<div className="space-y-3 rounded-xl border border-[#e0edd9] bg-[#f7fbf6] p-4 dark:border-[#1e3020] dark:bg-[#0d1a10]">
							<Input type="password" placeholder="Current password" value={currentPassword}
								className="border-[#cde0c9] dark:border-[#2a4030]"
								onChange={(e) => setCurrentPassword(e.target.value)} />
							<Input type="password" placeholder="New password (min 8 characters)" value={newPassword}
								className="border-[#cde0c9] dark:border-[#2a4030]"
								onChange={(e) => setNewPassword(e.target.value)} />
							<Input type="password" placeholder="Confirm new password" value={confirmPassword}
								className="border-[#cde0c9] dark:border-[#2a4030]"
								onChange={(e) => setConfirmPassword(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") void handleChangePassword(); }} />
							<div className="flex gap-2">
								<Button size="sm" disabled={isUpdatingPassword}
									className="bg-[#4a9456] hover:bg-[#3d7d49] text-white dark:bg-[#5aaa66]"
									onClick={() => void handleChangePassword()}>
									{isUpdatingPassword ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
									Update Password
								</Button>
								<Button size="sm" variant="outline"
									className="border-[#cde0c9] text-[#3a6b45] dark:border-[#2a4030]"
									onClick={() => { setShowPasswordForm(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }}>
									Cancel
								</Button>
							</div>
						</div>
					)}

					{showDeleteForm && (
						<div className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/40 dark:bg-red-900/10">
							<p className="text-sm text-[#2c4a35] dark:text-[#c8e6cb]">
								This will permanently delete <strong>all your notes, meetings, highlights, and settings</strong>.
								Type <span className="font-mono font-bold">DELETE</span> to confirm.
							</p>
							<Input value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)}
								placeholder="Type DELETE" className="font-mono border-red-200 dark:border-red-900/40" />
							<div className="flex gap-2">
								<Button size="sm" variant="destructive" disabled={isDeletingAccount}
									onClick={() => void handleDeleteAccount()}>
									{isDeletingAccount ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
									Confirm Delete
								</Button>
								<Button size="sm" variant="outline"
									className="border-[#cde0c9] text-[#3a6b45] dark:border-[#2a4030]"
									onClick={() => { setShowDeleteForm(false); setDeleteConfirmText(""); }}>
									Cancel
								</Button>
							</div>
						</div>
					)}

					{settingsMessage && (
						<p className={`rounded-lg px-3 py-2 text-xs ${settingsMessage.includes("success") || settingsMessage.includes("changed") ? "bg-[#eef6ec] text-[#3a6b45] dark:bg-[#0d1a10] dark:text-[#90c898]" : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"}`}>
							{settingsMessage}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
