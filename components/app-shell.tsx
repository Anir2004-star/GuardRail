"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, Bot, ChevronDown, CircleHelp, FileHeart, FolderCog, Home, Laptop, Menu, PanelLeftClose, RefreshCcw, RotateCcw, Search, Settings, Sparkles, Unplug, X } from "lucide-react";
import { demoService, notifications, proposals, useDemo } from "./demo-store";

const groups = [
  { label: "OVERVIEW", items: [{ name: "Dashboard", icon: Home, route: "dashboard" }] },
  { label: "CONTENT", items: [{ name: "Search", icon: Search, route: "search" }, { name: "Organize", icon: FolderCog, route: "organize" }, { name: "Protected items", icon: FileHeart, route: "protected" }] },
  { label: "GUARDRAIL AI", items: [{ name: "Assistant", icon: Bot, route: "assistant" }, { name: "Recommendations", icon: Sparkles, route: "proposals" }] },
  { label: "OPERATIONS", items: [{ name: "Connections", icon: Unplug, route: "connections" }, { name: "Devices", icon: Laptop, route: "devices" }, { name: "Scan & sync", icon: RefreshCcw, route: "scan" }, { name: "Activity", icon: Activity, route: "activity" }, { name: "Restore", icon: RotateCcw, route: "restore" }] },
  { label: "ACCOUNT", items: [{ name: "Notifications", icon: Bell, route: "notifications" }, { name: "Settings", icon: Settings, route: "settings" }, { name: "Help", icon: CircleHelp, route: "help" }] },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => { const update = () => setOffline(!navigator.onLine); update(); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  const path = usePathname(); const router = useRouter(); const state = useDemo();
  const page = path.split("/")[2];
  const title = page === "execution" ? "Execution progress" : groups.flatMap((g) => g.items).find((i) => i.route === page)?.name ?? "Workspace";
  const pending = proposals.filter((p) => p.ids.some((id) => state.items.some((i) => i.id === id && demoService.eligible(i, state.preferences, state.connections)))).length;
  useEffect(() => { void useDemo.persist.rehydrate(); }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setSyncOpen(false); setProfileOpen(false); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); router.push("/app/search"); } };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [router]);
  return <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`} data-appearance={state.preferences.appearance}>
    {open && <button className="mobile-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
    <aside className={`app-sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand"><Link className="brand inverse" href="/"><span>GUARDRAIL</span></Link><button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X /></button></div>
      <nav aria-label="Workspace navigation">{groups.map((g) => <div className="nav-group" key={g.label}><span className="nav-label">{g.label}</span>{g.items.map(({ name, icon: Icon, route }) => <Link className={`app-nav-item ${page === route ? "active" : ""}`} href={`/app/${route}`} aria-label={name} aria-current={page === route ? "page" : undefined} onClick={() => setOpen(false)} title={name} key={route}><Icon size={18} /><span>{name}</span>{route === "proposals" && <i aria-hidden="true">{pending}</i>}</Link>)}</div>)}</nav>
      <div className="profile-area"><button className="sidebar-profile" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="profile-avatar">{state.profile.name.slice(0, 2).toUpperCase()}</span><span><b>{state.profile.name}</b><small>Demo workspace</small></span><ChevronDown size={14} /></button>{profileOpen && <div className="profile-menu"><Link href="/app/settings/general" onClick={() => setProfileOpen(false)}>Profile settings</Link><Link href="/login" onClick={() => setProfileOpen(false)}>Leave demo</Link></div>}</div>
    </aside>
    <div className="app-main"><header className="app-topbar">
      <div className="topbar-title"><button className="menu-button" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><button className="desktop-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><PanelLeftClose size={18} /></button><span>{title}</span></div>
      <Link className="global-search" href="/app/search"><Search size={16} /><span>Search files, emails, and more</span><kbd>Ctrl K</kbd></Link>
      <div className="topbar-actions"><div className="sync-control"><button className="sync-status" onClick={() => setSyncOpen(!syncOpen)} aria-expanded={syncOpen}><i /><span><b>Demo sync status</b><small>{state.lastSync ? "Sample index refreshed" : "Ready to scan"}</small></span><ChevronDown size={14} /></button>{syncOpen && <div className="sync-popover"><b>Demo synchronization</b>{state.connections.map((p) => <span key={p}><i />{p}<small>Sample data</small></span>)}{!state.connections.length && <span>No demo connections</span>}<Link href="/app/scan" onClick={() => setSyncOpen(false)}>View sync details</Link></div>}</div><Link className="icon-button" href="/app/notifications" aria-label="Notifications"><Bell size={19} />{notifications.some((n) => !state.readNotifications.includes(n.id)) && <i />}</Link><Link className="assistant-button" href="/app/assistant"><Sparkles size={16} /><span>Ask Guardrail</span></Link></div>
    </header><div className="demo-banner">Frontend demo · Changes are saved in this browser. Real accounts and files are untouched.</div>{offline && <div className="feedback" role="status">Offline. Your local sample workspace remains available.</div>}{children}</div>
  </div>;
}
