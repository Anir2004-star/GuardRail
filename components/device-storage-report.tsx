"use client";

import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import type { RegisteredDevice } from "@/lib/device-api";

const capacity = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GiB`;
const timestamp = (date: string) => `${new Date(date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
export function DeviceStorageReport({ device, detailed = false }: { device: RegisteredDevice; detailed?: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now()); tick(); const timer = window.setInterval(tick, 15000); return () => window.clearInterval(timer); }, []);
  const report = device.storage;
  if (!report) return <div className="device-report-pending"><HardDrive /><div><b>Storage report pending</b><p>{device.paired ? "Enable capacity sharing in Guardrail Companion on this Windows device." : "Pair the Windows companion app to report drive capacity."}</p></div></div>;
  const age = now - Date.parse(report.receivedAt);
  const recent = now > 0 && age >= -300000 && age < 180000;
  const percent = Math.round(report.usedBytes / report.totalBytes * 100);
  return <div className="device-storage-report">
    <div className="section-bar"><b>Reported fixed volumes</b><span className={`report-freshness${recent ? " recent" : ""}`}>{recent ? "Recent capacity report" : "Report is stale"}</span></div>
    <p><strong>{capacity(report.usedBytes)}</strong> used of {capacity(report.totalBytes)}</p>
    <progress value={report.usedBytes} max={report.totalBytes} aria-label={`${device.name} reported storage used`} />
    <p>{capacity(report.freeBytes)} free · {percent}% used</p>
    <p className="source-note">Last report received {timestamp(report.receivedAt)}</p>
    {!recent && <p className="source-note">No recent report. Open the companion app and check capacity sharing and its connection.</p>}
    {detailed && <><div className="reported-volumes">{report.volumes.map((volume) => <div key={volume.id}><b>{volume.id}</b><dl className="detail-list"><dt>Total</dt><dd>{capacity(volume.totalBytes)}</dd><dt>Used</dt><dd>{capacity(volume.usedBytes)}</dd><dt>Free</dt><dd>{capacity(volume.freeBytes)}</dd></dl></div>)}</div><p className="source-note">Collected {timestamp(report.collectedAt)}. These are capacity figures reported by the app for ready fixed volumes. They do not prove the device is online or grant file access.</p></>}
  </div>;
}
