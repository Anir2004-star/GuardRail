import { AppShell } from "@/components/app-shell";
import { WorkspaceGuard } from "@/components/workspace-guard";
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return <WorkspaceGuard><AppShell>{children}</AppShell></WorkspaceGuard>; }
