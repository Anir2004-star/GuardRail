"use client";

import Link from "next/link";
import { enterDemoSession } from "@/lib/session-coordinator";

export function DemoLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={className} onClick={enterDemoSession}>{children}</Link>;
}
