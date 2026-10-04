import { AppShell } from "@/components/app-shell";
import { StorageChart } from "@/components/storage-chart";
import { ArrowRight, Check, ChevronRight, Clock3, FileHeart, FolderOpen, HardDrive, Mail, MoreHorizontal, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

const recommendations = [
  { icon: Mail, tone: "amber", title: "Old newsletters and promotions", source: "Gmail", count: "184 messages", size: "2.8 GB", risk: "Low risk", action: "Move to trash" },
  { icon: FolderOpen, tone: "plum", title: "Duplicate project exports", source: "Google Drive", count: "24 files", size: "6.1 GB", risk: "Review", action: "Keep newest" },
  { icon: HardDrive, tone: "coral", title: "Large files not opened this year", source: "Google Drive", count: "11 files", size: "4.7 GB", risk: "Review", action: "Archive" },
];

export default function DashboardPage() {
  return <AppShell><main className="dashboard">
    <div className="dashboard-welcome"><div><span className="eyebrow">SUNDAY, OCTOBER 4</span><h1>Good morning, Arjun.</h1><p>Here is what Guardrail found across your connected storage.</p></div><button className="scan-button"><Sparkles size={16} /> Run smart scan</button></div>
    <section className="dashboard-metrics">
      <article className="dash-card storage-overview"><div className="card-heading"><span><b>Storage overview</b><small>Across 3 connected accounts</small></span><button><MoreHorizontal /></button></div><div className="storage-body"><StorageChart /><div className="storage-legend"><span><i className="dot drive" />Google Drive <b>142 GB</b></span><span><i className="dot gmail" />Gmail <b>86 GB</b></span><span><i className="dot photos" />Google Photos <b>58 GB</b></span><span className="available"><i className="dot free" />Available <b>114 GB</b></span></div></div></article>
      <article className="dash-card stat-card"><span className="stat-icon amber"><Sparkles /></span><span className="trend">+3.2 GB</span><small>Potential cleanup</small><b>18.4 <em>GB</em></b><p>Across 426 items</p><a href="#recommendations">Review opportunities <ArrowRight /></a></article>
      <article className="dash-card stat-card"><span className="stat-icon plum"><FileHeart /></span><span className="protected-badge"><ShieldCheck /> Protected</span><small>Important items</small><b>1,248</b><p>Never included in cleanup</p><a href="#">View protected items <ArrowRight /></a></article>
    </section>
    <section className="dashboard-grid">
      <article className="dash-card recommendations" id="recommendations"><div className="card-heading"><span><b>Recommended for you</b><small>AI suggestions based on your preferences</small></span><button className="link-button">View all 37 <ArrowRight /></button></div><div className="approval-notice"><ShieldCheck /><span><b>You stay in control</b><small>Nothing is changed until you review and approve the exact items.</small></span><a href="#">How approvals work</a></div><div className="table-head"><span>RECOMMENDATION</span><span>SPACE</span><span>RISK</span><span>ACTION</span><span /></div>{recommendations.map(({ icon: Icon, tone, title, source, count, size, risk, action }) => <div className="recommendation-item" key={title}><span className={`file-icon ${tone}`}><Icon /></span><span className="item-main"><b>{title}</b><small>{source} · {count}</small></span><strong>{size}</strong><span className={`risk ${risk === "Low risk" ? "low" : "review"}`}>{risk === "Low risk" ? <Check /> : <TriangleAlert />}{risk}</span><span className="action-label">{action}</span><button className="round-arrow" aria-label={`Review ${title}`}><ChevronRight /></button></div>)}</article>
      <aside className="dash-card activity-card"><div className="card-heading"><span><b>Recent activity</b><small>Your latest Guardrail actions</small></span><button><MoreHorizontal /></button></div><div className="activity-list"><div className="activity-item"><span className="activity-icon"><Check /></span><span><b>Cleanup completed</b><small>126 emails moved to trash</small><em>Today, 9:42 AM</em></span></div><div className="activity-item"><span className="activity-icon warm"><ShieldCheck /></span><span><b>12 items protected</b><small>Tax & identity documents</small><em>Yesterday, 4:18 PM</em></span></div><div className="activity-item"><span className="activity-icon neutral"><Clock3 /></span><span><b>Google Drive synced</b><small>42 changes indexed</small><em>Yesterday, 2:06 PM</em></span></div></div><button className="full-link">View all activity <ArrowRight /></button></aside>
    </section>
  </main></AppShell>;
}
