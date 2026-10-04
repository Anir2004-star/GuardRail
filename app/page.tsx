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
      <span className="brand-mark"><ShieldCheck size={20} strokeWidth={2.2} /></span>
      <span>GUARDRAIL</span>
    </Link>
  );
}

function ProductPreview() {
  return (
    <div className="preview-shell" aria-label="Guardrail dashboard preview">
      <div className="preview-topbar">
        <Brand />
        <span className="preview-search"><Search size={14} /> Search everything</span>
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
            <div className="metric featured"><span>Storage used</span><strong>72%</strong><div className="meter"><i /></div><small>286 GB of 400 GB</small></div>
            <div className="metric"><span>Potential cleanup</span><strong>18.4 <em>GB</em></strong><small>Across 426 items</small></div>
            <div className="metric"><span>Protected items</span><strong>1,248</strong><small>Safe from cleanup</small></div>
            <div className="metric"><span>Recommendations</span><strong>37</strong><small>Ready for review</small></div>
          </div>
          <div className="recommendation-card">
            <div className="recommendation-title"><span className="icon-tile"><Sparkles size={17} /></span><div><b>High-impact recommendations</b><small>Nothing changes without your approval</small></div><button>Review all <ArrowRight size={14} /></button></div>
            <div className="recommendation-row"><span className="file-icon amber"><Mail size={16} /></span><span><b>Old newsletters and promotions</b><small>Gmail · 184 messages</small></span><strong>2.8 GB</strong><span className="risk low">LOW RISK</span></div>
            <div className="recommendation-row"><span className="file-icon plum"><FolderSync size={16} /></span><span><b>Duplicate project exports</b><small>Google Drive · 24 files</small></span><strong>6.1 GB</strong><span className="risk review">REVIEW</span></div>
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
          <a href="#product">Product</a><a href="#workflow">How it works</a><a href="#security">Security</a>
        </div>
        <div className="nav-actions"><Link href="/login">Sign in</Link><Link className="button small" href="/app/dashboard">Get started <ArrowRight size={15} /></Link></div>
      </nav>

      <section className="hero wrap">
        <div className="hero-copy">
          <span className="kicker"><Sparkles size={14} /> AI organization, with a human guardrail</span>
          <h1>Take control of your digital storage <em>without losing what matters.</em></h1>
          <p>Guardrail finds the clutter across your email and files, explains what is safe to clean, and waits for your approval before anything changes.</p>
          <div className="hero-actions"><Link className="button" href="/app/dashboard">Start organizing <ArrowRight size={17} /></Link><a className="text-link" href="#workflow">See how it works <ChevronRight size={16} /></a></div>
          <div className="trust-row"><span><Check size={14} /> No automatic deletion</span><span><Check size={14} /> Official provider access</span><span><Check size={14} /> Every action logged</span></div>
        </div>
        <ProductPreview />
      </section>

      <section className="provider-strip" id="product">
        <div className="wrap providers"><span>One calm view across</span><b><Mail size={20} /> Gmail</b><b><HardDrive size={20} /> Google Drive</b><b><FileCheck2 size={20} /> Google Photos</b><b className="muted">More providers coming</b></div>
      </section>

      <section className="workflow-section wrap" id="workflow">
        <div className="section-heading"><span className="eyebrow">HOW GUARDRAIL WORKS</span><h2>Clear recommendations.<br />You make the final call.</h2><p>AI does the tedious work of finding and explaining opportunities. Your approval is the boundary it cannot cross.</p></div>
        <div className="workflow-grid">
          {workflow.map(([number, title, detail]) => <article className="workflow-step" key={number}><span>{number}</span><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
      </section>

      <section className="safety-section" id="security">
        <div className="wrap safety-grid">
          <div className="safety-visual"><div className="orb"><LockKeyhole size={34} /></div><div className="approval-card"><span className="approval-icon"><Fingerprint /></span><div><small>DESTRUCTIVE ACTION</small><b>Approval required</b><p>184 messages · Move to trash</p></div><button>Review items</button></div></div>
          <div className="safety-copy"><span className="eyebrow light">SAFETY BY DESIGN</span><h2>AI can suggest.<br />Only you can approve.</h2><p>Guardrail treats every cleanup action as a proposal—not a command. You can inspect exact items, understand the reason, and change the selection before execution.</p><ul><li><ShieldCheck /> Scoped, least-privilege access</li><li><FileCheck2 /> Item-level approval records</li><li><FolderSync /> Revalidation before execution</li></ul></div>
        </div>
      </section>

      <section className="cta wrap"><div><span className="eyebrow">YOUR DIGITAL LIFE, WITH LESS NOISE</span><h2>Make space without second-guessing.</h2></div><Link className="button amber" href="/app/dashboard">Explore the dashboard <ArrowRight size={17} /></Link></section>
      <footer className="footer wrap"><Brand /><span>© 2026 Guardrail. Thoughtful cleanup, by design.</span><div><a href="#security">Security</a><a href="#">Privacy</a></div></footer>
    </main>
  );
}
