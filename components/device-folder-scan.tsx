"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderSearch, RefreshCcw } from "lucide-react";
import { useAuthSession } from "./auth-store";
import { getAccountFolderScan, type FolderScanResult } from "@/lib/folder-scan-api";
import { DEVICES_CHANGED } from "@/lib/device-api";

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
const time = (value: string) => `${new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
export function DeviceFolderScan({ id, paired }: { id: string; paired: boolean }) {
  const session = useAuthSession((state) => state.session);
  const scope = `${id}:${session?.user.id}:${session?.accessToken}:${paired}`;
  const epoch = useRef(0);
  const [state, setState] = useState<{ scope: string; scan: FolderScanResult | null; error: string; loading: boolean }>({ scope: "", scan: null, error: "", loading: true });
  const load = useCallback(async () => {
    const request = ++epoch.current;
    if (!paired || !session) { setState({ scope, scan: null, error: "", loading: false }); return; }
    const result = await getAccountFolderScan(id);
    if (request !== epoch.current || useAuthSession.getState().session?.accessToken !== session.accessToken) return;
    if (result.ok) setState({ scope, scan: result.data.scan, error: "", loading: false });
    else setState((previous) => ({ scope, scan: previous.scope === scope ? previous.scan : null, error: result.message, loading: false }));
  }, [id, paired, session, scope]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    const refresh = () => { void load(); }; window.addEventListener(DEVICES_CHANGED, refresh);
    return () => { ++epoch.current; window.clearInterval(timer); window.removeEventListener(DEVICES_CHANGED, refresh); };
  }, [load]);
  const current = state.scope === scope ? state : { scan: null, error: "", loading: true };
  const scan = paired ? current.scan : null;
  return <article className="work-panel device-folder-scan">
    <span className="eyebrow">READ-ONLY FOLDER SCANS</span>
    <div className="section-bar"><h2>Folder scan results</h2><button className="secondary" type="button" onClick={() => void load()}><RefreshCcw size={15} /> Refresh scan</button></div>
    <p>In Guardrail Companion, choose <b>Select folder</b>, confirm which metadata to share, then click <b>Scan and send metadata</b>. Only your selected folder is scanned. Files are never changed or deleted.</p>
    {current.loading ? <p role="status">Loading folder scan...</p> : !scan && <div className="folder-scan-empty"><FolderSearch aria-hidden="true" /><p>{paired ? "No folder scan received yet. Start a scan in the companion app." : "Pair the companion app before scanning a folder."}</p></div>}
    {current.error && <p className="field-error" role="alert">{current.error} The last received result, if shown, may be outdated.</p>}
    {scan && <>
      <h3>{scan.folderName}</h3><p className="source-note">Last received {time(scan.receivedAt)} · Scanned {time(scan.finishedAt)}</p>
      {(scan.skippedCount > 0 || scan.limitReached) && <p className="feedback" role="status">Partial coverage: {scan.skippedCount.toLocaleString("en-GB")} entries skipped.{scan.limitReached ? " Scan safety limit reached; choose a smaller folder for fuller results." : " Linked, hidden, offline, excluded or inaccessible entries are not included."}</p>}
      <div className="folder-scan-summary"><div><b>{scan.fileCount.toLocaleString("en-GB")}</b><span>Files counted</span></div><div><b>{size(scan.totalBytes)}</b><span>Logical file size</span></div><div><b>{scan.largestFiles.length}</b><span>Largest files shown</span></div></div>
      <h3>File types</h3><div className="scan-type-list">{scan.types.length ? scan.types.map((group) => <div key={group.type}><span>{group.type} · {group.count.toLocaleString("en-GB")} files</span><b>{size(group.bytes)}</b><progress max={Math.max(1, scan.totalBytes)} value={group.bytes} aria-label={`${group.type} scanned bytes`} /></div>) : <p>No eligible files found.</p>}</div>
      <h3>Largest files</h3><p className="source-note">Up to 20 largest files, with paths relative to your selected folder. File contents and the absolute folder path are not uploaded.</p>
      <div className="scan-table-scroll"><table><thead><tr><th>Relative path</th><th>Size</th><th>Type</th><th>Modified</th></tr></thead><tbody>{scan.largestFiles.map((file) => <tr key={file.relativePath}><td>{file.relativePath}</td><td>{size(file.bytes)}</td><td>{file.type}</td><td>{time(file.modifiedAt)}</td></tr>)}</tbody></table></div>
      <p className="source-note">This is the latest received metadata snapshot, not a live file listing or a cleanup recommendation. Changes during scanning and skipped entries can affect coverage.</p>
    </>}
  </article>;
}
