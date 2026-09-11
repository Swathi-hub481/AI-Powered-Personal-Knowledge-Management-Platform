"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link as LinkIcon,
  LogOut,
  MessageSquare,
  Settings,
  User,
  Video,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/profile",      icon: User,          label: "Profile" },
  { href: "/notes",        icon: FileText,       label: "Notes" },
  { href: "/documents",    icon: BookMarked,     label: "Knowledge" },
  { href: "/converse",     icon: MessageSquare,  label: "Converse" },
  { href: "/meet",         icon: Video,          label: "Meet" },
  { href: "/integrations", icon: LinkIcon,       label: "Integrations" },
  { href: "/settings",     icon: Settings,       label: "Settings" },
] as const;

const W_EXPANDED  = 220;
const W_COLLAPSED = 58;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname();
  const router    = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted,   setMounted]   = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem("sidebar-collapsed") === "true") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/login");
  };

  const toggle = () =>
    setCollapsed(c => {
      try { localStorage.setItem("sidebar-collapsed", String(!c)); } catch { /**/ }
      return !c;
    });

  // Auth pages get no shell — just the bare page (after all hooks)
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const sidebarW = mounted ? (collapsed ? W_COLLAPSED : W_EXPANDED) : W_EXPANDED;

  return (
    // â”€â”€ Root: full-screen flex row — sidebar + main are SIBLINGS, no margins â”€â”€
    <div className="flex h-screen w-screen overflow-hidden">

      {/* â”€â”€ Desktop sidebar â”€â”€ */}
      <aside
        style={{ width: sidebarW, minWidth: sidebarW }}
        className="hidden h-full shrink-0 flex-col border-r border-[#cde0c9] bg-[#f5f7f2] transition-[width,min-width] duration-200 ease-in-out dark:border-[#1e3020] dark:bg-[#0d1510] md:flex overflow-hidden"
      >
        {/* Header row */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#cde0c9] px-2 dark:border-[#1e3020]">
          {!collapsed && (
            <span className="ml-2 truncate text-[0.9rem] font-semibold tracking-tight text-[#2c4a35] dark:text-[#c8e6cb]">
              UniFlow
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-[#8ab490] transition-colors hover:bg-[#e4f3e0] hover:text-[#3a6b45] dark:text-[#4a7054] dark:hover:bg-[#1a2e1e] dark:hover:text-[#6bbf7e]"
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          <ul className="space-y-0.5 px-1.5">
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={collapsed ? label : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.82rem] font-medium transition-colors duration-150
                      ${active
                        ? "bg-[#d4e8d0] text-[#2c4a35] dark:bg-[#1e3a28] dark:text-[#c8e6cb]"
                        : "text-[#5a8a63] hover:bg-[#e4f3e0] hover:text-[#2c4a35] dark:text-[#6a9070] dark:hover:bg-[#1a2e1e] dark:hover:text-[#c8e6cb]"}
                      ${collapsed ? "justify-center" : ""}`}
                  >
                    <Icon className={`size-4 shrink-0 ${active ? "text-[#4a9456] dark:text-[#6bbf7e]" : ""}`} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sign out */}
        <div className="shrink-0 border-t border-[#cde0c9] p-1.5 dark:border-[#1e3020]">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.82rem] font-medium text-[#8ab490] transition-colors hover:bg-red-50 hover:text-red-600 dark:text-[#4a7054] dark:hover:bg-[#2a1010] dark:hover:text-red-400 ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* â”€â”€ Main column â”€â”€ */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f5f7f2] dark:bg-[#0d1510]">

        {/* Theme toggle */}
        <div className="fixed top-3 right-3 z-50">
          <ThemeToggle />
        </div>

        {/* Mobile header */}
        <header className="shrink-0 border-b border-[#cde0c9] bg-[#f5f7f2] px-4 py-3 dark:border-[#1e3020] dark:bg-[#0d1510] md:hidden">
          <p className="text-sm font-semibold text-[#2c4a35] dark:text-[#c8e6cb]">UniFlow</p>
          <nav className="mt-2 overflow-x-auto">
            <ul className="flex min-w-max gap-1">
              {NAV.map(({ href, icon: Icon, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium
                      ${pathname === href
                        ? "bg-[#d4e8d0] text-[#2c4a35] dark:bg-[#1e3a28] dark:text-[#c8e6cb]"
                        : "text-[#5a8a63] hover:bg-[#e4f3e0] dark:text-[#6a9070]"}`}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 md:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
