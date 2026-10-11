"use client";
import Link from "next/link";
export default function WorkspaceError({ reset }: { reset: () => void }) { return <main className="workspace-page"><div className="work-panel empty-state"><h2>This view couldn't load.</h2><p>Try opening it again or return to the dashboard.</p><div className="inline-links"><button className="button small" onClick={reset}>Try again</button><Link href="/app/dashboard">Open dashboard</Link></div></div></main>; }
