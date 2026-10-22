"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, Bot, ChevronDown, FileHeart, Home, Menu, PanelLeftClose, Search, Settings, Sparkles, Unplug, X } from "lucide-react";
import { notifications, useDemo } from "./demo-store";
import { useReviewDemo } from "./review-store";
import { useAssistantDemo } from "./assistant-store";

const groups = [
  { label: "WORKSPACE", items: [{ name: "Overview", icon: Home, route: "dashboard" }, { name: "AI Assistant", icon: Bot, route: "assistant" }, { name: "Connections & Devices", icon: Unplug, route: "connections" }, { name: "Cleanup Review", icon: Sparkles, route: "cleanup" }, { name: "Protected Items", icon: FileHeart, route: "protected" }, { name: "Activity", icon: Activity, route: "activity" }, { name: "Settings", icon: Settings, route: "settings" }] },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => { const update = () => setOffline(!navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const path = usePathname(); const router = useRouter(); const state = useDemo(); const review = useReviewDemo();
  const page = path.split("/")[2];
  const title = page === "execution" ? "Execution progress" : groups.flatMap((g) => g.items).find((i) => i.route === page)?.name ?? "Workspace";
  const pending = review.suggestions.filter((suggestion) => suggestion.reviewStatus === "Waiting").length;
  useEffect(() => { void useDemo.persist.rehydrate(); void useReviewDemo.persist.rehydrate(); void useAssistantDemo.persist.rehydrate(); }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setSyncOpen(false); setProfileOpen(false); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); router.push("/app/assistant"); } };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [router]);
  return <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`} data-appearance={state.preferences.appearance}>
    {open && <button className="mobile-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
    <aside className={`app-sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><Link className="brand inverse" href="/"><span>GUARDRAIL</span></Link><button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X /></button></div>
      <nav aria-label="Workspace navigation">{groups.map((g) => <div className="nav-group" key={g.label}><span className="nav-label">{g.label}</span>{g.items.map(({ name, icon: Icon, route }) => <Link className={`app-nav-item ${page === route ? "active" : ""}`} href={`/app/${route}`} aria-label={name} aria-current={page === route ? "page" : undefined} onClick={() => setOpen(false)} title={name} key={route}><Icon size={18} /><span>{name}</span>{route === "cleanup" && <i aria-label={`${pending} waiting`}>{pending}</i>}</Link>)}</div>)}</nav>
      <div className="profile-area"><button className="sidebar-profile" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="profile-avatar">{state.profile.name.slice(0, 2).toUpperCase()}</span><span><b>{state.profile.name}</b><small>Demo workspace</small></span><ChevronDown size={14} /></button>{profileOpen && <div className="profile-menu"><Link href="/app/settings/general" onClick={() => setProfileOpen(false)}>Profile settings</Link><Link href="/login" onClick={() => setProfileOpen(false)}>Leave demo</Link></div>}</div>
    </aside>
    <div className="app-main"><header className="app-topbar">
      <div className="topbar-title"><button className="menu-button" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><button className="desktop-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><PanelLeftClose size={18} /></button>{page !== "dashboard" && <span>{title}</span>}</div>
      <Link className="global-search" href="/app/assistant"><Search size={16} /><span>Ask Guardrail about sample items</span><kbd>Ctrl K</kbd></Link>
      <div className="topbar-actions"><div className="sync-control"><button className="sync-status" onClick={() => setSyncOpen(!syncOpen)} aria-expanded={syncOpen}><i /><span><b>Demo source status</b><small>{pending} items waiting for review</small></span><ChevronDown size={14} /></button>{syncOpen && <div className="sync-popover"><b>Demo sources</b>{review.account.providers.map((provider) => <span key={provider}><i />{provider}<small>{review.connectionStatus[provider].replace("-", " ")}</small></span>)}<Link href="/app/connections" onClick={() => setSyncOpen(false)}>View connections & devices</Link></div>}</div><Link className="icon-button" href="/app/notifications" aria-label="Notifications"><Bell size={19} />{notifications.some((n) => !state.readNotifications.includes(n.id)) && <i />}</Link><Link className="assistant-button" href="/app/assistant"><Bot size={16} /><span>AI Assistant</span></Link></div>
    </header><div className="demo-banner">Frontend demo · Changes are saved in this browser. Real accounts and files are untouched.</div>{offline && <div className="feedback" role="status">Offline. Your local sample workspace remains available.</div>}{children}</div>
  </div>;
}
