"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity, Bell, Bot, ChevronDown, ChevronRight, CircleHelp, FileHeart,
  FolderCog, Home, Menu, PanelLeftClose, RefreshCcw, RotateCcw, Search,
  Settings, ShieldCheck, Sparkles, Unplug, X,
} from "lucide-react";

const groups = [
  ["OVERVIEW", [["Dashboard", Home, true]]],
  ["CONTENT", [["Search", Search], ["Organize", FolderCog], ["Protected items", FileHeart]]],
  ["GUARDRAIL AI", [["Assistant", Bot], ["Recommendations", Sparkles]]],
  ["OPERATIONS", [["Connections", Unplug], ["Scan & sync", RefreshCcw], ["Activity", Activity], ["Restore", RotateCcw]]],
  ["ACCOUNT", [["Notifications", Bell], ["Settings", Settings], ["Help", CircleHelp]]],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  return (
    <div className="app-shell">
      {open && <button className="mobile-backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />}
      <aside className={`app-sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand"><Link className="brand inverse" href="/"><span className="brand-mark"><ShieldCheck size={20} /></span><span>GUARDRAIL</span></Link><button className="sidebar-close" onClick={() => setOpen(false)}><X /></button></div>
        <nav>{groups.map(([label, items]) => <div className="nav-group" key={label}><span className="nav-label">{label}</span>{items.map(([name, Icon, active]) => <Link className={`app-nav-item ${active ? "active" : ""}`} href={active ? "/app/dashboard" : "#"} key={name}><Icon size={18} /><span>{name}</span>{name === "Recommendations" && <i>7</i>}</Link>)}</div>)}</nav>
        <div className="sidebar-profile"><span className="profile-avatar">AK</span><span><b>Arjun Kapoor</b><small>Personal workspace</small></span><ChevronRight size={16} /></div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-title"><button className="menu-button" onClick={() => setOpen(true)}><Menu /></button><button className="desktop-collapse" aria-label="Collapse sidebar"><PanelLeftClose size={18} /></button><span>Dashboard</span></div>
          <button className="global-search"><Search size={16} /><span>Search files, emails, and more</span><kbd>⌘ K</kbd></button>
          <div className="topbar-actions">
            <div className="sync-control"><button className="sync-status" onClick={() => setSyncOpen(!syncOpen)}><i /><span><b>All accounts synced</b><small>4 minutes ago</small></span><ChevronDown size={14} /></button>{syncOpen && <div className="sync-popover"><b>Synchronization status</b><span><i /> Gmail <small>Up to date</small></span><span><i /> Google Drive <small>Up to date</small></span><button>View sync activity</button></div>}</div>
            <button className="icon-button" aria-label="Notifications"><Bell size={19} /><i /></button>
            <button className="assistant-button"><Sparkles size={16} /> <span>Ask Guardrail</span></button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
