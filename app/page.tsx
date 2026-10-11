import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileCheck2,
  Fingerprint,
  FolderSync,
  HardDrive,
  LockKeyhole,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const workflow = [
  ["01", "Connect", "Link your accounts with official, scoped authorization."],
  ["02", "Analyze", "Guardrail finds patterns, duplicates and storage pressure."],
  ["03", "Recommend", "Get explainable actions ranked by impact and confidence."],
  ["04", "Approve", "Inspect every affected item before you authorize a change."],
  ["05", "Execute", "Only approved actions are sent to the original provider."],
];

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Guardrail home">
      <span>GUARDRAIL</span>
    </Link>
  );
}

function ProductPreview() {
  return (
    <div className="preview-shell" aria-label="Guardrail dashboard preview">
      <div className="preview-topbar">
        <Brand />
        <span className="preview-search"><Search size={14} /> Search Gmail and Drive</span>
        <span className="avatar">AK</span>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar">
          <span className="preview-nav active">Overview</span>
          <span className="preview-nav">Search</span>
          <span className="preview-nav">Recommendations</span>
          <span className="preview-nav">Protected</span>
          <span className="preview-nav">Connections</span>
        </aside>
        <div className="preview-content">
          <div className="preview-heading">
            <div><span className="eyebrow">GOOD MORNING</span><h3>Your storage, under control.</h3></div>
            <span className="sync-pill"><span /> Synced 4m ago</span>
          </div>
          <div className="metric-grid">
            <div className="metric featured"><span>Sample laptop storage</span><strong>56%</strong><div className="meter"><i /></div><small>Sample laptop · 286 GB of 512 GB</small></div>
            <div className="metric"><span>Cloud review</span><strong>3 <em>proposals</em></strong><small>Gmail and Drive sample data</small></div>
            <div className="metric"><span>Protected items</span><strong>2</strong><small>Safe from cleanup</small></div>
            <div className="metric"><span>Recommendations</span><strong>3</strong><small>Ready for review</small></div>
          </div>
          <div className="recommendation-card">
            <div className="recommendation-title"><span className="icon-tile"><Sparkles size={17} /></span><div><b>High-impact recommendations</b><small>Nothing changes without your approval</small></div><Link href="/app/proposals">Review all →</Link></div>
            <div className="recommendation-row"><span className="file-icon amber"><Mail size={16} /></span><span><b>Old newsletters and promotions</b><small>Gmail · 2 sample candidates</small></span><strong>12 MB</strong><span className="risk low">LOW RISK</span></div>
            <div className="recommendation-row"><span className="file-icon plum"><FolderSync size={16} /></span><span><b>Duplicate project exports</b><small>Google Drive · 1 sample copy</small></span><strong>1.4 GB</strong><span className="risk review">REVIEW</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <nav className="landing-nav wrap">
        <Brand />
        <div className="nav-links">
          <Link href="/features">Product</Link><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link>
        </div>
        <div className="nav-actions"><Link href="/login">Sign in</Link><Link className="button small" href="/app/dashboard">Get started <ArrowRight size={15} /></Link></div>
      </nav>

      <section className="hero wrap">
        <div className="hero-copy">
          <h1>Take control of your digital storage <em>without losing what matters.</em></h1>
          <p>An assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.</p>
          <div className="hero-actions"><Link className="button" href="/app/dashboard">Start organizing <ArrowRight size={17} /></Link><a className="text-link" href="#workflow">See how it works <ChevronRight size={16} /></a></div>
          <div className="trust-row"><span><Check size={14} /> No automatic deletion</span><span><Check size={14} /> Official provider access</span><span><Check size={14} /> Every action logged</span></div>
        </div>
        <ProductPreview />
      </section>

      <section className="provider-strip" id="product">
        <div className="wrap providers"><span>Cloud & devices, separate sources</span><b><Mail size={20} /> Gmail</b><b><HardDrive size={20} /> Google Drive</b><b><FileCheck2 size={20} /> Registered devices</b></div>
      </section>

      <section className="workflow-section wrap" id="workflow">
        <div className="section-heading"><span className="eyebrow">HOW GUARDRAIL WORKS</span><h2>Clear recommendations.<br />You make the final call.</h2><p>AI does the tedious work of finding and explaining opportunities. Your approval is the boundary it cannot cross.</p></div>
        <div className="workflow-grid">
          {workflow.map(([number, title, detail]) => <article className="workflow-step" key={number}><span>{number}</span><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
      </section>

      <section className="safety-section" id="security">
        <div className="wrap safety-grid">
          <div className="safety-visual"><div className="orb"><LockKeyhole size={34} /></div><div className="approval-card"><span className="approval-icon"><Fingerprint /></span><div><small>DESTRUCTIVE ACTION</small><b>Approval required</b><p>Review exact items before cleanup</p></div><Link className="approval-link" href="/app/proposals/newsletters">Review items</Link></div></div>
          <div className="safety-copy"><span className="eyebrow light">SAFETY BY DESIGN</span><h2>AI can suggest.<br />Only you can approve.</h2><p>Guardrail treats every cleanup action as a proposal—not a command. You can inspect exact items, understand the reason, and change the selection before execution.</p><ul><li><ShieldCheck /> Scoped, least-privilege access</li><li><FileCheck2 /> Item-level approval records</li><li><FolderSync /> Revalidation before execution</li></ul></div>
        </div>
      </section>

      <section className="cta wrap"><div><span className="eyebrow">YOUR DIGITAL LIFE, WITH LESS NOISE</span><h2>Review clutter. Monitor device storage.</h2></div><Link className="button amber" href="/app/dashboard">Explore the dashboard <ArrowRight size={17} /></Link></section>
      <footer className="footer wrap"><Brand /><span>© 2026 Guardrail. Thoughtful cleanup, by design.</span><div><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link></div></footer>
    </main>
  );
}
