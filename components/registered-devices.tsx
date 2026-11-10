"use client";

import Link from "next/link";
import { DevicePairingPanel } from "./device-pairing-panel";
import { DeviceStorageReport } from "./device-storage-report";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, HardDrive, Laptop, LoaderCircle, RefreshCcw, Smartphone, Tablet, X } from "lucide-react";
import { useAuthSession } from "./auth-store";
import { DEVICES_CHANGED, getRegisteredDevice, getRegisteredDevices, registerAccountDevice, removeAccountDevice, renameAccountDevice, type DeviceRegistration, type RegisteredDevice } from "@/lib/device-api";

const deviceIcon = (type: RegisteredDevice["type"]) => type === "Laptop" ? Laptop : type === "Tablet" ? Tablet : Smartphone;
const dateLabel = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
function useDeviceRecords(id?: string) {
  const session = useAuthSession((state) => state.session);
  const scope = session ? `${session.user.id}:${session.accessToken}:${id ?? "list"}` : "anonymous";
  const epoch = useRef(0);
  const [state, setState] = useState<{ scope: string; devices: RegisteredDevice[]; loading: boolean; error: string; missing: boolean }>({ scope: "", devices: [], loading: true, error: "", missing: false });
  const load = useCallback(async (background = false) => {
    const request = ++epoch.current;
    if (!background) setState({ scope, devices: [], loading: true, error: "", missing: false });
    if (!session) { setState({ scope, devices: [], loading: false, error: "Sign in to access your devices.", missing: false }); return; }
    const result = id ? await getRegisteredDevice(id) : await getRegisteredDevices();
    const current = useAuthSession.getState().session;
    if (request !== epoch.current || current?.user.id !== session.user.id || current.accessToken !== session.accessToken) return;
    if (result.ok) {
      const devices = "devices" in result.data ? result.data.devices : [result.data.device];
      setState({ scope, devices, loading: false, error: "", missing: false });
    } else if (!background || result.kind === "not-found") setState({ scope, devices: [], loading: false, error: result.kind === "not-found" ? "Device not found." : result.message, missing: result.kind === "not-found" });
  }, [scope, session, id]);
  useEffect(() => {
    const refresh = () => { void load(); };
    refresh(); window.addEventListener(DEVICES_CHANGED, refresh);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30000);
    return () => { ++epoch.current; window.removeEventListener(DEVICES_CHANGED, refresh); window.clearInterval(timer); };
  }, [load]);
  return { ...(state.scope === scope ? state : { devices: [], loading: true, error: "", missing: false }), reload: load };
}
function RecordDialog({ device, mode, close, removed }: { device?: RegisteredDevice; mode: "register" | "rename" | "remove"; close: () => void; removed?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [fields, setFields] = useState<DeviceRegistration>({ requestId: "", name: device?.name ?? "", type: device?.type ?? "Laptop", brand: device?.brand ?? "", model: device?.model ?? "", os: device?.os ?? "" });
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false; dialog.current?.close(); }; }, []);
  const title = mode === "register" ? "Register a device" : mode === "rename" ? "Rename device" : "Remove device";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (submitting.current) return;
    if (mode !== "remove" && (!fields.name.trim() || Array.from(fields.name).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127))) { setError("Enter a device name without control characters."); return; }
    submitting.current = true; setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    const result = mode === "register" ? await registerAccountDevice({ ...fields, requestId: requestId.current })
      : mode === "rename" ? await renameAccountDevice(device!.id, fields.name) : await removeAccountDevice(device!.id);
    submitting.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (result.ok) { close(); if (mode === "remove") removed?.(); }
    else setError(result.message);
  }
  return <dialog className="item-dialog" aria-label={title} ref={dialog} onCancel={(event) => { if (busy) event.preventDefault(); else close(); }}>
    <div className="panel-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close device dialog" disabled={busy} onClick={close}><X /></button></div>
    {mode === "register" && <p>Save this device to your account. Generate a pairing code from the saved device details when your companion app is ready.</p>}
    {mode === "remove" && <p>Remove <b>{device?.name}</b> from your account? This revokes companion app access and removes the registration record. Files on the device are not deleted.</p>}
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      {mode !== "remove" && <label>Device name<input autoFocus required maxLength={60} value={fields.name} disabled={busy} onChange={(event) => setFields({ ...fields, name: event.target.value })} placeholder="My laptop" /></label>}
      {mode === "register" && <>
        <label>Device type<select value={fields.type} disabled={busy} onChange={(event) => setFields({ ...fields, type: event.target.value as RegisteredDevice["type"] })}>{["Laptop", "Smartphone", "Tablet"].map((type) => <option key={type}>{type}</option>)}</select></label>
        {([ ["brand", "Brand (optional)"], ["model", "Model (optional)"], ["os", "Operating system (optional)"] ] as const).map(([key, label]) => <label key={key}>{label}<input value={fields[key]} maxLength={80} disabled={busy} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></label>)}
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="submit" className={mode === "remove" ? "danger-button" : "button small"} disabled={busy}>{busy ? "Saving..." : mode === "register" ? "Register device" : mode === "rename" ? "Save name" : "Remove device"}</button><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button></div>
    </form>
  </dialog>;
}
function RecordCard({ device, overview = false }: { device: RegisteredDevice; overview?: boolean }) {
  const [action, setAction] = useState<"rename" | "remove" | null>(null);
  const Icon = deviceIcon(device.type);
  return <article className={`work-panel device-card${overview ? " overview-source" : ""}`}>
    <div className="device-card-head"><span className="device-icon"><Icon /></span><span className="status-pill registered"><i />{device.paired ? "Paired" : "Registered"}</span></div>
    <h2>{device.name}</h2><p>{[device.type, device.brand, device.model, device.os].filter(Boolean).join(" · ")}</p>
    <DeviceStorageReport device={device} />
    <p className="source-note">Registered {dateLabel(device.createdAt)}</p>
    <div className="card-actions"><Link className="button small" href={`/app/devices/${device.id}`}>View details</Link>{!overview && <><button type="button" className="secondary" onClick={() => setAction("rename")}>Rename device</button><button type="button" className="text-button danger-text" onClick={() => setAction("remove")}>Remove</button></>}</div>
    {action && <RecordDialog mode={action} device={device} close={() => setAction(null)} />}
  </article>;
}
export function RegisteredDevicesPage({ embedded = false, overview = false }: { embedded?: boolean; overview?: boolean }) {
  const records = useDeviceRecords(); const [adding, setAdding] = useState(false);
  const controls = <><button type="button" className="secondary" disabled={records.loading} onClick={() => void records.reload()}><RefreshCcw size={15} /> Refresh devices</button><button type="button" className="button small" onClick={() => setAdding(true)}>Add device</button></>;
  return <>
    {overview ? <div className="section-bar"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>Registered devices</h2></div><Link className="secondary" href="/app/devices">Manage devices</Link></div>
      : embedded ? <div className="embedded-device-actions account-device-actions">{controls}</div> : <div className="page-heading"><div><span className="eyebrow">MY DEVICES</span><h1>My devices</h1><p>Register and manage the devices saved to your account.</p></div><div className="heading-actions">{controls}</div></div>}
    {!overview && <div className="demo-notice page-demo-notice"><CircleAlert /><span>Pair Guardrail Companion on Windows to share drive capacity. Folder scanning and cleanup are coming later.</span></div>}
    {records.loading ? <p role="status"><LoaderCircle className="spin" size={18} /> Loading your devices...</p>
      : records.error ? <div className="work-panel"><p className="field-error" role="alert">{records.error}</p><button type="button" className="secondary" onClick={() => void records.reload()}>Retry devices</button></div>
        : records.devices.length ? <div className="device-grid">{(overview ? records.devices.slice(0, 2) : records.devices).map((device) => <RecordCard device={device} key={device.id} overview={overview} />)}</div>
          : <div className="empty-state"><HardDrive /><h3>No devices registered</h3><p>Save your first device to this account.</p><button type="button" className="button small" onClick={() => setAdding(true)}>Add your first device</button></div>}
    {adding && <RecordDialog mode="register" close={() => setAdding(false)} />}
  </>;
}
export function RegisteredDeviceDetailsPage({ id }: { id: string }) {
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  return valid ? <DeviceDetails id={id} /> : <MissingDevice />;
}
function MissingDevice() { return <><Link className="breadcrumb" href="/app/devices">← My devices</Link><div className="empty-state"><HardDrive /><h1>Device not found</h1><p>This device may have been removed or belongs to another account.</p><Link className="button small" href="/app/devices">Back to devices</Link></div></>; }
function DeviceDetails({ id }: { id: string }) {
  const records = useDeviceRecords(id); const router = useRouter(); const [action, setAction] = useState<"rename" | "remove" | null>(null);
  const device = records.devices[0];
  if (records.loading) return <p role="status">Loading your device...</p>;
  if (records.missing) return <MissingDevice />;
  if (records.error || !device) return <div className="work-panel"><p className="field-error" role="alert">{records.error || "Could not load your device."}</p><button type="button" className="secondary" onClick={() => void records.reload()}>Retry device</button><Link href="/app/devices">Back to devices</Link></div>;
  const Icon = deviceIcon(device.type);
  return <><Link className="breadcrumb" href="/app/devices">← My devices</Link><div className="page-heading"><div className="device-title"><span className="device-icon large"><Icon /></span><div><span className="status-pill registered"><i />{device.paired ? "Paired" : "Registered"}</span><h1>{device.name}</h1><p>{device.type}</p></div></div><div className="heading-actions"><button type="button" className="secondary" onClick={() => setAction("rename")}>Rename</button><button type="button" className="text-button danger-text" onClick={() => setAction("remove")}>Remove device</button></div></div>
    <section className="detail-grid"><article className="work-panel"><span className="eyebrow">DEVICE DETAILS</span><dl className="detail-list"><dt>Type</dt><dd>{device.type}</dd><dt>Brand</dt><dd>{device.brand || "Not provided"}</dd><dt>Model</dt><dd>{device.model || "Not provided"}</dd><dt>Operating system</dt><dd>{device.os || "Not provided"}</dd><dt>Registered</dt><dd>{dateLabel(device.createdAt)}</dd><dt>Updated</dt><dd>{dateLabel(device.updatedAt)}</dd></dl></article><DevicePairingPanel key={device.id} device={device} /><article className="work-panel"><span className="eyebrow">DRIVE CAPACITY</span><h2>Storage report</h2><DeviceStorageReport device={device} detailed /></article></section>
    {action && <RecordDialog mode={action} device={device} close={() => setAction(null)} removed={() => router.replace("/app/devices")} />}
  </>;
}
