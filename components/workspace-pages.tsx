"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, FolderOpen, RefreshCcw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { demoService, protectionReason, instructions, formatDemoDateTime, formatSize, Item, notifications, proposals, useDemo } from "./demo-store";

import { DeviceDetailsPage, DevicesPage } from "./device-pages";
import { ScopeSettings } from "./scope-settings";

function Heading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><FolderOpen /><h3>{title}</h3><p>{text}</p></div>; }
function Notice({ children }: { children: React.ReactNode }) { return <div className="feedback" role="status">{children}</div>; }
function ItemPreview({ item, close }: { item: Item; close: () => void }) {
  const state = useDemo();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="item-dialog" aria-label="Item details" ref={dialog} onCancel={close}><div className="panel-header"><h2>Item details</h2><button className="secondary" onClick={close}>Close</button></div><FileText size={36} /><h3>{item.name}</h3><dl className="detail-list"><dt>Provider</dt><dd>{item.provider}</dd><dt>Type</dt><dd>{item.kind}</dd><dt>Category</dt><dd>{item.category}</dd><dt>Date</dt><dd>{item.date}</dd><dt>Sender</dt><dd>{item.sender ?? "Not applicable"}</dd><dt>Size</dt><dd>{formatSize(item.mb)}</dd><dt>Folder / label</dt><dd>{item.folder}</dd><dt>Protection</dt><dd>{protectionReason(item, state.preferences) ?? "Not protected"}</dd></dl><p className="muted-copy">This preview contains sample metadata. Original content will be available once provider access is connected.</p></dialog>;
}
function ItemsTable({ items, selected, toggle, restore = false }: { items: Item[]; selected?: string[]; toggle?: (id: string) => void; restore?: boolean }) {
  const state = useDemo(); const [preview, setPreview] = useState<Item | null>(null);
  if (!items.length) return <Empty title="No items here" text="Try another filter or update your selection." />;
  return <><div className="data-scroll"><table className="data-table"><thead><tr>{toggle && <th>Select</th>}<th>Item</th><th>Provider</th><th>Size</th><th>Folder / label</th><th>Actions</th></tr></thead><tbody>{items.map((i) => <tr key={i.id}>{toggle && <td><input type="checkbox" aria-label={`Select ${i.name}`} checked={selected?.includes(i.id) ?? false} onChange={() => toggle(i.id)} /></td>}<td><button className="item-name" onClick={() => setPreview(i)}><FileText size={17} /><span>{i.name}<small>{i.kind}</small></span></button></td><td>{i.provider}</td><td>{formatSize(i.mb)}</td><td>{i.folder}</td><td>{restore ? <button className="secondary" onClick={() => state.restore(i.id)}>Restore sample</button> : <button className={`secondary ${demoService.isProtected(i, state.preferences) ? "selected" : ""}`} onClick={() => state.toggleProtection(i.id)} aria-pressed={demoService.isProtected(i, state.preferences)} disabled={!i.protected && !!protectionReason(i, state.preferences)} title={protectionReason(i, state.preferences) ?? "Protect selected item"}>{demoService.isProtected(i, state.preferences) ? "Protected" : "Protect"}</button>}</td></tr>)}</tbody></table></div>{preview && <ItemPreview item={preview} close={() => setPreview(null)} />}</>;
}

function ContentPage({ mode }: { mode: "search" | "organize" | "protected" | "restore" }) {
  const state = useDemo(); const [query, setQuery] = useState(""); const [provider, setProvider] = useState("All providers"); const [kind, setKind] = useState("All types"); const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState<string[]>([]); const [folder, setFolder] = useState(""); const [message, setMessage] = useState("");
  const available = state.items.filter((i) => mode === "restore" ? i.trashed : !i.trashed && (mode !== "protected" || demoService.isProtected(i, state.preferences)));
  const items = available.filter((i) => `${i.name} ${i.folder}`.toLowerCase().includes(query.toLowerCase()) && (provider === "All providers" || i.provider === provider) && (kind === "All types" || i.kind === kind)).sort((a, b) => sort === "size" ? b.mb - a.mb : a.name.localeCompare(b.name));
  const titles = { search: "Find what matters", organize: "A place for everything", protected: "Protected items", restore: "Restore sample items" };
  const descriptions = { search: "Search your sample content by name, folder, provider, or type.", organize: "Select items and choose a folder or label for your demo workspace.", protected: "Selected items and enabled protection rules exclude these items from cleanup.", restore: "Review items moved to demo trash and bring them back." };
  return <><Heading title={titles[mode]} description={descriptions[mode]} /><section className="work-panel"><div className="filter-bar"><label className="search-field"><Search size={17} /><input aria-label="Search content" placeholder="Search sample content…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select aria-label="Provider filter" value={provider} onChange={(e) => setProvider(e.target.value)}>{["All providers", "Gmail", "Google Drive"].map((p) => <option key={p}>{p}</option>)}</select><select aria-label="Type filter" value={kind} onChange={(e) => setKind(e.target.value)}>{["All types", "Email", "Document", "Archive", "Video", "Image"].map((p) => <option key={p}>{p}</option>)}</select><select aria-label="Sort items" value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="size">Largest first</option></select></div><div className="panel-header"><h2>{items.length} sample item{items.length === 1 ? "" : "s"}</h2>{mode === "organize" && <button className="secondary" onClick={() => setSelected(items.map((i) => i.id))}>Select visible</button>}</div>{mode === "organize" && <form className="bulk-bar" onSubmit={(e) => { e.preventDefault(); const active = selected.filter((id) => available.some((i) => i.id === id)); if (!active.length || !folder.trim()) return; state.organize(active, folder.trim()); setMessage(`Updated ${active.length} sample item(s): Gmail labels / Drive folders → ${folder.trim()}.`); setSelected([]); }}><b>{selected.length} selected</b><input aria-label="Destination folder or label" placeholder="Folder or label name" value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={60} required /><button className="button small" disabled={!selected.length || !folder.trim()}>Move selected</button><button className="secondary" type="button" onClick={() => setSelected([])}>Clear</button></form>}{message && <Notice>{message}</Notice>}<ItemsTable items={items} selected={selected} toggle={mode === "organize" ? (id) => setSelected((s) => s.includes(id) ? s.filter((v) => v !== id) : [...s, id]) : undefined} restore={mode === "restore"} /></section></>;
}

function ProposalsPage() {
  const state = useDemo(); const [risk, setRisk] = useState("All risks");
  return <><Heading title="Recommendations, explained" description="Review the reasons and exact items before approving a demo action." /><div className="filter-bar"><select aria-label="Risk filter" value={risk} onChange={(e) => setRisk(e.target.value)}><option>All risks</option><option>Low</option><option>Medium</option></select><Link href="/app/scan" className="secondary"><RefreshCcw size={15} /> Scan sample content</Link></div><div className="proposal-grid">{proposals.filter((p) => risk === "All risks" || p.risk === risk).map((p) => {
    const items = state.items.filter((i) => (p.ids as readonly string[]).includes(i.id));
    const completed = state.executions.some((e) => e.proposalId === p.id && e.state === "completed");
    return <article className="work-panel proposal-card" key={p.id}><span className="stat-icon plum"><Sparkles /></span><span className="badge">{p.risk} risk</span><h2>{p.title}</h2><p>{p.reason}</p><div className="proposal-meta"><span>{items.length} exact sample items</span><b>{p.action === "trash" ? `${formatSize(items.reduce((sum, i) => sum + i.mb, 0))} to trash` : "Folder organization"}</b></div><Link className="button small" href={`/app/proposals/${p.id}`}>{completed ? "Review again" : "Review items"}<ArrowRight size={15} /></Link>{completed && <small className="muted-copy">A demo execution has completed for this proposal.</small>}</article>;
  })}</div></>;
}
function ApprovalDialog({ items, operation, close, approve }: { items: Item[]; operation: string; close: () => void; approve: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="item-dialog" aria-label="Confirm exact selected items" ref={dialog} onCancel={close}><h2>Confirm approval</h2><p>{operation === "trash" ? "Move these mock items to mock Trash" : "Move these mock Drive files into Archive"}</p><ul>{items.map((i) => <li key={i.id}>{i.name} · {i.provider} · {i.category} · {formatSize(i.mb)}</li>)}</ul><p className="muted-copy">Only these exact items are approved. Moving to Trash does not necessarily free storage.</p><div className="inline-links"><button className="button small" disabled={!items.length} onClick={approve}>Confirm demo approval</button><button className="secondary" onClick={close}>Cancel</button></div></dialog>;
}
function ProposalDetail({ id }: { id: string }) {
  const state = useDemo(); const router = useRouter(); const proposal = proposals.find((p) => p.id === id);
  const [selected, setSelected] = useState<string[]>([]); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState(""); const [approvalOpen, setApprovalOpen] = useState(false);
  if (!proposal) return <Empty title="Recommendation unavailable" text="Return to the recommendation list." />;
  const items = state.items.filter((i) => (proposal.ids as readonly string[]).includes(i.id));
  const eligible = items.filter((i) => demoService.eligible(i, state.preferences, state.connections));
  const valid = selected.filter((id) => eligible.some((i) => i.id === id));
  return <><Link className="breadcrumb" href="/app/proposals">← Recommendations</Link><Heading title={proposal.title} description={proposal.reason} /><div className="review-layout"><section className="work-panel"><div className="panel-header"><h2>Exact affected items</h2><span className="badge">{proposal.risk} risk</span></div><div className="review-items">{items.map((i) => {
    const disabled = !eligible.some((v) => v.id === i.id);
    return <label className={`review-item ${disabled ? "unavailable" : ""}`} key={i.id}><input type="checkbox" disabled={disabled} checked={valid.includes(i.id)} onChange={() => { setSelected((s) => s.includes(i.id) ? s.filter((v) => v !== i.id) : [...s, i.id]); setConfirmed(false); }} /><FileText size={22} /><span><b>{i.name}</b><small>{i.provider} · {i.category} · {i.date} · {formatSize(i.mb)} · {demoService.isProtected(i, state.preferences) ? `Protected — ${protectionReason(i, state.preferences)}` : i.trashed ? "Already in demo trash" : !state.connections.includes(i.provider) ? "Provider disconnected" : proposal.action === "trash" ? "Move to demo trash" : "Move into Archive folder"}</small></span></label>;
  })}</div><p className="panel-note">Unchecked items are kept. Protected items cannot be approved.</p></section><aside className="work-panel approval-summary"><ShieldCheck size={28} /><h2>Your approval summary</h2><dl className="detail-list"><dt>Selected</dt><dd>{valid.length} items</dd><dt>Operation</dt><dd>{proposal.action === "trash" ? "Move to demo trash" : "Move into Archive"}</dd><dt>Storage impact</dt><dd>{proposal.action === "trash" ? `${formatSize(eligible.filter((i) => valid.includes(i.id)).reduce((s, i) => s + i.mb, 0))} in trash` : "No space recovered"}</dd></dl><p className="muted-copy">Moving items to trash may not free quota immediately. Approval lasts 15 minutes in this demo.</p><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!valid.length} />I reviewed these exact items and approve this demo operation.</label>{error && <Notice>{error}</Notice>}<button className="button" disabled={!valid.length || !confirmed} onClick={() => setApprovalOpen(true)}>Approve {valid.length} selected item(s)</button><Link className="secondary" href="/app/proposals">Keep items and return</Link></aside></div>{approvalOpen && <ApprovalDialog items={eligible.filter((i) => valid.includes(i.id))} operation={proposal.action} close={() => setApprovalOpen(false)} approve={() => { const run = state.approve(proposal.id, valid, proposal.action); if (run) router.push(`/app/execution/${run}`); else { setApprovalOpen(false); setError("The selection changed. Review available items again."); } }} />}</>;
}
function ExecutionPage({ id }: { id: string }) {
  const state = useDemo(); const [error, setError] = useState(""); const run = state.executions.find((e) => e.id === id);
  if (!run) return <><Heading title="Execution not found" description="Demo execution records are stored in the browser where you approved them." /><Link className="button small" href="/app/proposals">Review recommendations</Link></>;
  const items = state.items.filter((i) => run.ids.includes(i.id));
  return <><Heading title={run.state === "completed" ? "Demo execution completed" : "Approved and ready"} description="Only the exact approved sample items are included in this operation." /><div className="work-panel execution-panel"><div className="execution-steps"><span><Check />Reviewed</span><span><Check />Approved</span><span>{run.state === "completed" ? <Check /> : "3"}Revalidate & execute</span><span>{run.state === "completed" ? <Check /> : "4"}Complete</span></div><h2>{run.ids.length} items · {run.action === "trash" ? "Move to demo trash" : "Move into Archive"}</h2><ul>{items.map((i) => <li key={i.id}>{i.name} <small>{i.provider}</small></li>)}</ul>{error && <Notice>{error}</Notice>}{run.state === "approved" ? <button className="button" onClick={() => { const message = state.execute(id); setError(message ?? ""); }}>Execute approved demo action</button> : <Notice>Completed. Your real provider data has not changed.</Notice>}<div className="inline-links"><Link href="/app/activity">View activity</Link><Link href={run.action === "trash" ? "/app/restore" : "/app/organize"}>{run.action === "trash" ? "Restore items" : "View organized items"}</Link><Link href={`/app/proposals/${run.proposalId}`}>Review proposal</Link></div></div></>;
}

function ConnectionsPage() {
  const state = useDemo();
  return <><Heading title="Your connected accounts" description="Try connection states with sample data. Real OAuth will be provided by the backend." /><div className="connection-grid">{["Gmail", "Google Drive"].map((p, index) => {
    const connected = state.connections.includes(p);
    return <article className="work-panel connection-card" key={p}><span className={`provider-logo provider-${index}`}><FolderOpen /></span><span className="badge">{connected ? "Demo connected" : "Disconnected"}</span><h2>{p}</h2><p>{p === "Gmail" ? "Planned: search authorized messages; suggest categories and labels; protect starred messages and selected senders; identify promotional-email candidates; review exact messages; move approved messages to Trash where supported." : "Planned: search accessible files; suggest folders and categories; protect selected files and folders; identify duplicate candidates; review large or old files without assuming they are unimportant; review exact files; move approved files to Trash where supported."}</p><dl className="detail-list"><dt>Access</dt><dd>{connected ? "Sample metadata only" : "No provider authorization"}</dd><dt>Account</dt><dd>{connected ? "Demo account" : "Not connected"}</dd></dl><button className={connected ? "secondary" : "button small"} onClick={() => state.connect(p)}>{connected ? "Disconnect demo" : "Use sample data"}</button></article>;
  })}</div></>;
}
function ScanPage() {
  const state = useDemo(); const [step, setStep] = useState(0); const [running, setRunning] = useState(false); const [done, setDone] = useState(false); const [provider, setProvider] = useState("All connected accounts");
  const labels = ["Read sample metadata", "Normalize sample index", "Apply protection rules", "Build sample recommendations"];
  const canScan = state.connections.length > 0 && (provider === "All connected accounts" || state.connections.includes(provider));
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => { if (step < 3) setStep(step + 1); else { state.scan(); setRunning(false); setDone(true); } }, 650);
    return () => window.clearTimeout(timer);
  }, [running, step, state.scan]);
  return <><Heading title="Scan & sync" description="Preview the indexing workflow using the content already in your demo workspace." /><section className="work-panel scan-panel"><div className="panel-header"><h2>Run a sample scan</h2><span className="badge">{running ? "Scanning" : done ? "Complete" : "Ready"}</span></div><div className="filter-bar"><select aria-label="Scan provider" value={provider} disabled={running} onChange={(e) => setProvider(e.target.value)}><option>All connected accounts</option>{state.connections.map((p) => <option key={p}>{p}</option>)}</select><button className="button small" disabled={running || !canScan} onClick={() => { setStep(0); setDone(false); setRunning(true); }}>Start demo scan</button>{running && <button className="secondary" onClick={() => setRunning(false)}>Cancel scan</button>}</div>{!canScan && <Notice>Connect a demo account before scanning. <Link href="/app/connections">Open connections</Link></Notice>}<ol className="scan-steps">{labels.map((label, i) => <li className={done || (running && i <= step) ? "step-active" : ""} key={label}><span>{done || (running && i < step) ? <Check size={16} /> : i + 1}</span><div><b>{label}</b><small>{done ? "Completed" : running && i === step ? "Processing sample content…" : "Sample workflow"}</small></div></li>)}</ol>{done && <Notice>Demo scan completed for {provider}. <Link href="/app/proposals">Review recommendations →</Link></Notice>}<p className="panel-note">No provider requests are made. Last demo sync: {state.lastSync ? formatDemoDateTime(state.lastSync) : "Not yet run"}.</p></section></>;
}
function ActivityPage() {
  const state = useDemo(); const [filter, setFilter] = useState("all");
  const events = state.events.filter((e) => filter === "all" || e.type === filter);
  return <><Heading title="Activity history" description="Follow the actions taken in this browser's demo workspace." /><section className="work-panel"><div className="filter-bar"><select aria-label="Activity filter" value={filter} onChange={(e) => setFilter(e.target.value)}>{["all", "content", "sync", "execution", "account", "device"].map((p) => <option key={p} value={p}>{p === "all" ? "All activity" : p}</option>)}</select></div>{events.length ? <div className="timeline">{events.map((e) => <div key={e.id}><span className="activity-icon"><Check size={15} /></span><span><b>{e.text}</b><small>{formatDemoDateTime(e.time)} · {e.type}</small></span></div>)}</div> : <Empty title="No activity yet" text="Run a sample scan, organize an item, or review a recommendation to see its history here." />}</section>{state.executions.length > 0 && <section className="work-panel history-panel"><h2>Execution records</h2>{state.executions.map((e) => <Link className="history-row" key={e.id} href={`/app/execution/${e.id}`}><span>{e.ids.length} items · {e.action}</span><span className="badge">{e.state}</span><ArrowRight size={16} /></Link>)}</section>}</>;
}
function NotificationsPage() {
  const state = useDemo(); const [unreadOnly, setUnreadOnly] = useState(false);
  const visible = notifications.filter((n) => !unreadOnly || !state.readNotifications.includes(n.id));
  return <><Heading title="Notifications" description="Updates and reminders for your demo workspace."><button className="secondary" onClick={() => state.markRead(notifications.map((n) => n.id))}>Mark all read</button></Heading><label className="check-row"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label><section className="work-panel">{visible.length ? visible.map((n) => <article className="notification-row" key={n.id}><span className="stat-icon plum"><Sparkles /></span><div><h2>{n.title}</h2><p>{n.text}</p><Link href={n.href}>View details →</Link></div>{state.readNotifications.includes(n.id) ? <span className="badge">Read</span> : <button className="secondary" onClick={() => state.markRead([n.id])}>Mark read</button>}</article>) : <Empty title="You're all caught up" text="There are no unread demo notifications." />}</section></>;
}
function AssistantPage() {
  const [input, setInput] = useState(""); const [messages, setMessages] = useState<{ role: string; text: string; href?: string }[]>([{ role: "assistant", text: "Welcome! I can guide you through the sample workspace. Try asking about duplicates, protection, or cleanup." }]);
  const end = useRef<HTMLDivElement>(null);
  function send(text: string) {
    if (!text.trim()) return;
    const query = text.toLowerCase();
    const response = query.includes("protect") ? { text: "Open Protected items to see what is excluded from cleanup. You can protect another item from Search using its Protect button.", href: "/app/protected" } : query.includes("connect") || query.includes("account") ? { text: "Connections lets you try Gmail and Drive demo states. Real authorization will be connected through the backend.", href: "/app/connections" } : query.includes("restor") ? { text: "Restore lists sample items in trash. Restoring returns them to the content index in this browser.", href: "/app/restore" } : { text: "Review the sample recommendations, select exact items, and approve the operation. Then use the separate execution screen to try the demo action. This is a scripted guide; live AI is not connected yet.", href: "/app/proposals" };
    setMessages((m) => [...m, { role: "you", text: text.trim() }, { role: "assistant", ...response }]); setInput("");
  }
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages]);
  return <><Heading title="Ask Guardrail" description="A scripted frontend guide to help you explore the sample workflows." /><section className="work-panel chat-panel"><div className="chat-messages" aria-live="polite">{messages.map((m, i) => <div className={`chat-message ${m.role === "you" ? "from-user" : ""}`} key={i}><span>{m.role === "you" ? "YOU" : "GUARDRAIL · DEMO GUIDE"}</span><p>{m.text}</p>{m.href && <Link href={m.href}>Open workspace page →</Link>}</div>)}<div ref={end} /></div><div className="suggestion-chips">{instructions.map((q) => <button className="secondary" key={q} onClick={() => send(q)}>{q}</button>)}</div><form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}><input aria-label="Message to Guardrail" placeholder="Ask about your demo workspace…" value={input} maxLength={1000} onChange={(e) => setInput(e.target.value)} /><button className="button small" disabled={!input.trim()}>Send <ArrowRight size={16} /></button></form></section></>;
}

function HelpPage() {
  return <><Heading title="A little guidance" description="Learn how to explore Guardrail and keep control of your content." /><section className="work-panel help-panel">{[
    ["How do I try cleanup?", "Open Recommendations, review a proposal, select exact sample items, and tick the confirmation. Approval opens a separate execution screen. The Execute button changes only the local sample data."],
    ["What happens to protected items?", "They cannot be approved or executed in cleanup proposals. You can protect or unprotect sample content from Search and Protected items."],
    ["Can I undo a demo cleanup?", "Yes. Open Restore to return a sample item from demo trash. Organization changes can be updated from Organize."],
    ["Are my accounts connected?", "No. The Connections page simulates account states. Provider authorization, live indexing, and real file operations require the backend."],
    ["Does the assistant use AI yet?", "The current assistant is a scripted guide. It can point you to frontend workflows, but it does not call a model or access your private content."],
    ["Does registering a device grant file access?", "No. Registration records sample storage capacity and usage only. A future permission-based companion app will supply real measurements."],
    ["Where are changes saved?", "In this browser's local storage. They persist across refreshes on the same origin and are not synchronized to another device."],
  ].map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section><div className="inline-links"><Link href="/security">Security overview</Link><Link href="/privacy">Privacy overview</Link><Link href="/app/proposals">Try a recommendation</Link></div></>;
}
export function WorkspacePage({ section }: { section: string[] }) {
  const page = section[0];
  let content: React.ReactNode;
  if (["search", "organize", "protected", "restore"].includes(page)) content = <ContentPage mode={page as "search" | "organize" | "protected" | "restore"} />;
  else if (page === "proposals") content = section[1] ? <ProposalDetail id={section[1]} key={section[1]} /> : <ProposalsPage />;
  else if (page === "execution") content = <ExecutionPage id={section[1]} />;
  else if (page === "devices") content = section[1] ? <DeviceDetailsPage id={section[1]} key={section[1]} /> : <DevicesPage />;
  else if (page === "connections") content = <ConnectionsPage />;
  else if (page === "scan") content = <ScanPage />;
  else if (page === "activity") content = <ActivityPage />;
  else if (page === "notifications") content = <NotificationsPage />;
  else if (page === "assistant") content = <AssistantPage />;
  else if (page === "settings") content = <ScopeSettings tab={section[1]} key={section[1]} />;
  else content = <HelpPage />;
  return <main className="workspace-page">{content}</main>;
}
