"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthSession } from "./auth-store";
import { decideAccountPairing, DEVICES_CHANGED, disconnectAccountDevice, getAccountPairing, startAccountPairing, type DevicePairing, type RegisteredDevice } from "@/lib/device-api";

export function DevicePairingPanel({ device }: { device: RegisteredDevice }) {
  const session = useAuthSession((state) => state.session);
  const [pairing, setPairing] = useState<DevicePairing | null>(null);
  const [issuedCode, setCode] = useState<{ id: string; value: string } | null>(null); const [error, setError] = useState("");
  const code = issuedCode?.id === pairing?.id ? issuedCode?.value : "";
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState(false); const [now, setNow] = useState(0);
  const alive = useRef(false); const epoch = useRef(0); const working = useRef(false);
  const scope = `${device.id}:${session?.user.id}:${session?.accessToken}`;
  const current = useRef(scope); current.current = scope;
  const load = useCallback(async () => {
    if (working.current) return;
    const request = ++epoch.current;
    const result = await getAccountPairing(device.id);
    if (!alive.current || current.current !== scope || request !== epoch.current || useAuthSession.getState().session?.accessToken !== session?.accessToken) return;
    setLoaded(true); setNow(Date.now());
    if (!result.ok) { setError(result.message); return; }
    setError("");
    setPairing(result.data.pairing);
  }, [device.id, scope, session?.accessToken]);
  const previousPairing = useRef<DevicePairing | null>(null);
  useEffect(() => {
    const previous = previousPairing.current; previousPairing.current = pairing;
    if (previous?.id !== pairing?.id || previous?.claimId !== pairing?.claimId) setChecked(false);
    if (previous && previous.state !== "Completed" && pairing?.state === "Completed") window.dispatchEvent(new Event(DEVICES_CHANGED));
  }, [pairing]);
  useEffect(() => {
    alive.current = true; setPairing(null); setCode(null); setChecked(false); setLoaded(false);
    void load();
    const timer = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { alive.current = false; ++epoch.current; window.clearInterval(timer); };
  }, [load]);
  async function act(action: "start" | "approve" | "reject" | "cancel" | "disconnect") {
    if (working.current || (action === "approve" && !checked)) return;
    working.current = true; ++epoch.current; setBusy(true); setError("");
    if (action === "start") setCode(null);
    const result = action === "start" ? await startAccountPairing(device.id) : action === "disconnect" ? await disconnectAccountDevice(device.id) : pairing ? await decideAccountPairing(device.id, pairing, action) : null;
    working.current = false;
    if (!alive.current || current.current !== scope) return;
    setBusy(false); setNow(Date.now());
    if (!result) return;
    if (!result.ok) { setError(result.message); return; }
    setChecked(false);
    if (result.data && "pairing" in result.data) setPairing(result.data.pairing);
    setCode(result.data && "pairing" in result.data && "code" in result.data && typeof result.data.code === "string" ? { id: result.data.pairing.id, value: result.data.code } : null);
  }
  const expired = !!pairing && ["Waiting", "Claimed", "Approved"].includes(pairing.state) && now >= Date.parse(pairing.expiresAt);
  const state = expired ? "Expired" : pairing?.state;
  const active = !!state && ["Waiting", "Claimed", "Approved"].includes(state);
  return <article className="work-panel pairing-panel">
    <span className="eyebrow">DEVICE PAIRING</span><h2>{device.paired ? "Companion app paired" : "Pair your companion app"}</h2>
    <p>Open Guardrail Companion on Windows and enter the code below. After pairing, you can enable drive capacity sharing in the app. Folder scanning and cleanup are coming later.</p>
    {device.paired && <><p>Credential valid until {new Date(device.credentialExpiresAt!).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. Pairing does not indicate whether the device is online.</p><button type="button" className="secondary" disabled={busy} onClick={() => void act("disconnect")}>Disconnect companion app</button><p className="source-note">Disconnecting revokes app access and cancels pending pairing. Your files stay on the device.</p></>}
    {!loaded && <p role="status">Loading pairing...</p>}
    {active && <p>Code expires at {new Date(pairing!.expiresAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC.</p>}
    {state === "Waiting" && <>{code ? <><p>Enter this code in the companion app on your device:</p><output className="pairing-code" aria-label="Pairing code">{code}</output><p>Share it only with the device you want to pair.</p></> : <p>The code is shown once. Generate a new code if you no longer have it.</p>}<p role="status">Waiting for your companion app...</p></>}
    {state === "Claimed" && pairing?.candidate && <><h3>Check the requesting app</h3><p>Reported by the app: <b>{pairing.candidate.appName}</b>, {pairing.candidate.platform}{pairing.candidate.appVersion ? ` (${pairing.candidate.appVersion})` : ""}. These details are not independently verified.</p><p>Compare this number with the number shown in your companion app:</p><output className="pairing-code" aria-label="Comparison number">{pairing.comparisonCode}</output><label className="pairing-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => setChecked(event.target.checked)} />The numbers match on my device.</label><div className="card-actions"><button type="button" className="button small" disabled={busy || !checked} onClick={() => void act("approve")}>Approve pairing</button><button type="button" className="secondary" disabled={busy} onClick={() => void act("reject")}>Reject app</button></div></>}
    {state === "Approved" && <p role="status">Approved. Waiting for the companion app to collect its credential.</p>}
    {state === "Completed" && device.paired && <p role="status">Pairing complete.</p>}
    {state && ["Expired", "Cancelled", "Rejected"].includes(state) && <p role="status">Pairing {state.toLowerCase()}. Generate a new code to try again.</p>}
    <div className="card-actions">{loaded && <button type="button" className="button small" disabled={busy} onClick={() => void act("start")}>{active ? "Generate a new code" : device.paired ? "Pair a replacement app" : "Generate pairing code"}</button>}{active && <button type="button" className="secondary" disabled={busy} onClick={() => void act("cancel")}>Cancel pairing</button>}<button type="button" className="text-button" disabled={busy} onClick={() => void load()}>Refresh pairing</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </article>;
}
