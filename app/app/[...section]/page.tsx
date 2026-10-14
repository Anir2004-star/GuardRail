import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-pages";
const pages = ["search", "organize", "protected", "assistant", "proposals", "connections", "devices", "scan", "activity", "restore", "notifications", "settings", "help"];
const settings = ["general", "preferences", "storage", "devices", "appearance", "security", "privacy", "connections"];
export function generateStaticParams() {
  return [...pages.map((s) => ({ section: [s] })), ...settings.map((s) => ({ section: ["settings", s] })), ...["newsletters", "duplicates", "recordings"].map((s) => ({ section: ["proposals", s] }))];
}
export default async function Page({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  if (!(section.length === 1 && pages.includes(section[0])) && !(section.length === 2 && (section[0] === "execution" || section[0] === "devices" || (section[0] === "proposals" && ["newsletters", "duplicates", "recordings"].includes(section[1])) || (section[0] === "settings" && settings.includes(section[1]))))) notFound();
  return <WorkspacePage section={section} />;
}
