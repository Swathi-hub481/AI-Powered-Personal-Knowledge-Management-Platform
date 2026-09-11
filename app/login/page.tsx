"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import "./login.css"

function LoginForm() {
	const router = useRouter()
	const searchParams = useSearchParams()
	const nextPath = searchParams.get("next") ?? "/"

	const [tab, setTab] = useState<"signin" | "signup">("signin")
	const [name, setName] = useState("")
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [confirm, setConfirm] = useState("")
	const [showPass, setShowPass] = useState(false)
	const [showConfirm, setShowConfirm] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => { setError(null); setSuccess(null) }, [tab])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setSuccess(null)
		if (tab === "signup") {
			if (!name.trim()) { setError("Name is required"); return }
			if (password !== confirm) { setError("Passwords do not match"); return }
			if (password.length < 8) { setError("Password must be at least 8 characters"); return }
		}
		setLoading(true)
		try {
			const endpoint = tab === "signin" ? "/api/auth/signin" : "/api/auth/signup"
			const body = tab === "signin" ? { email, password } : { name, email, password }
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			const json = (await res.json()) as { error?: string }
			if (!res.ok) { setError(json.error ?? "Something went wrong"); return }
			if (tab === "signup") {
				setSuccess("Account created! Signing you in…")
				await new Promise(r => setTimeout(r, 800))
			}
			router.push(nextPath)
		} catch {
			setError("Unable to reach server. Check your connection.")
		} finally {
			setLoading(false)
		}
	}

	const eyeIcon = (open: boolean) => open ? (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m3 3 18 18"/><path d="M10.58 10.58a2 2 0 0 0 2.83 2.83"/><path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a17.86 17.86 0 0 1-2.22 3.32"/><path d="M6.61 6.61C3.82 8.17 2 12 2 12a17.3 17.3 0 0 0 7.17 6.17"/></svg>
	) : (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
	)

	return (
		<div className="lp-scene">

			{/* Subtle gradient wash — top of page */}
			<div className="lp-gradient" aria-hidden="true" />

			{/* Top bar */}
			<header className="lp-header">
				<span className="lp-wordmark">UniFlow</span>
				<span className="lp-header-right">
					{tab === "signin" ? (
						<>Don&apos;t have an Account?{" "}<button type="button" onClick={() => setTab("signup")}>Sign up &rarr;</button></>
					) : (
						<>Already have an account?{" "}<button type="button" onClick={() => setTab("signin")}>Sign in &rarr;</button></>
					)}
				</span>
			</header>

			{/* Centered form area */}
			<main className="lp-main">
				<h1 className="lp-title">
					{tab === "signin" ? "Log in to your account" : "Create your account"}
				</h1>

				{error && <p className="lp-alert lp-alert-err">{error}</p>}
				{success && <p className="lp-alert lp-alert-ok">{success}</p>}

				<form onSubmit={(e) => void handleSubmit(e)} className="lp-form">

					{tab === "signup" && (
						<div className="lp-input-row">
							<svg className="lp-ico" viewBox="0 0 20 20" width="18" height="18"><path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 8a6.5 6.5 0 0 1 13 0h-13Z" fill="currentColor"/></svg>
							<input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" />
						</div>
					)}

					<div className="lp-input-row">
						<svg className="lp-ico" viewBox="0 0 20 20" width="18" height="18"><path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 8a6.5 6.5 0 0 1 13 0h-13Z" fill="currentColor"/></svg>
						<input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete={tab === "signin" ? "username" : "email"} />
					</div>

					<div className="lp-input-row">
						<svg className="lp-ico" viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="9" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
						<input
							type={showPass ? "text" : "password"}
							placeholder={tab === "signup" ? "Password (min 8 chars)" : "Password"}
							value={password} onChange={e => setPassword(e.target.value)}
							required autoComplete={tab === "signin" ? "current-password" : "new-password"}
							className="lp-has-toggle"
						/>
						<button type="button" className="lp-eye" onClick={() => setShowPass(v => !v)} aria-label="Toggle password">{eyeIcon(showPass)}</button>
					</div>

					{tab === "signup" && (
						<div className="lp-input-row">
							<svg className="lp-ico" viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="9" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
							<input
								type={showConfirm ? "text" : "password"}
								placeholder="Confirm password"
								value={confirm} onChange={e => setConfirm(e.target.value)}
								required autoComplete="new-password"
								className="lp-has-toggle"
							/>
							<button type="button" className="lp-eye" onClick={() => setShowConfirm(v => !v)} aria-label="Toggle password">{eyeIcon(showConfirm)}</button>
						</div>
					)}

					<button type="submit" className="lp-btn" disabled={loading}>
						{loading ? "Please wait\u2026" : tab === "signin" ? "Log In" : "Create Account"}
					</button>
				</form>

				<p className="lp-tagline">Your personal knowledge management system, reimagined.</p>
			</main>
		</div>
	)
}

export default function LoginPage() {
	return (
		<Suspense fallback={<div className="lp-loading">Loading&hellip;</div>}>
			<LoginForm />
		</Suspense>
	)
}
