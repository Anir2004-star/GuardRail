import Link from "next/link";
export default function NotFound() { return <main className="not-found"><span className="eyebrow">404</span><h1>This page isn't here.</h1><p>Return to your workspace or start from the homepage.</p><Link className="button" href="/app/dashboard">Open dashboard</Link><Link href="/">Back to home</Link></main>; }
