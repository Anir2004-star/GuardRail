import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { RegisteredDevice } from "../lib/device-api";
import type { DevicePairing } from "../lib/device-api";

test.beforeEach(async ({ page }) => {
  // Observe protocol launch requests without opening real native apps during tests.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    const launches: string[] = [];
    Object.assign(window, { guardrailTestLaunches: launches });
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (target?.href.startsWith("guardrail-companion:")) { event.preventDefault(); launches.push(target.href); }
    }, true);
  });
});

const cors = { "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
const profiles = {
  A: { id: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Device Owner A", firstName: "Device", middleName: null, lastName: "Owner A", email: "a@example.org", createdAt: "2026-11-01T12:00:00.000Z" },
  B: { id: "81e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Device Owner B", firstName: "Device", middleName: null, lastName: "Owner B", email: "b@example.org", createdAt: "2026-11-01T12:00:00.000Z" },
};
type Owner = keyof typeof profiles;
type Stored = { owner: Owner; device: RegisteredDevice; requestId: string };
async function backend(context: BrowserContext) {
  const state = { owner: "A" as Owner, refreshes: 0, posts: 0, writes: [] as { method: string; body: Record<string, unknown> | null; authorization: string }[], records: new Map<string, Stored>(), failNext: 0, loseNext: false, malformedNext: false, rejectNext: false, holdNextList: null as { entered: () => void; gate: Promise<void> } | null };
  const session = () => ({ user: profiles[state.owner], accessToken: `device-access-${state.owner}-${++state.refreshes}`, tokenType: "Bearer", expiresIn: 900 });
  await context.addCookies([{ name: "guardrail_refresh", value: "A".repeat(43), domain: "localhost", path: "/api/v1/auth", httpOnly: true }]);
  await context.route("**/api/v1/auth/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) {
      const owner = route.request().headers().authorization?.includes("-B-") ? "B" : "A";
      await route.fulfill({ headers: cors, json: { user: profiles[owner] } });
    } else if (path.endsWith("/logout")) {
      await route.fulfill({ status: 204, headers: { ...cors, "Set-Cookie": "guardrail_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT" } });
    } else {
      if (path.endsWith("/login")) state.owner = route.request().postDataJSON().email === profiles.B.email ? "B" : "A";
      await route.fulfill({ headers: { ...cors, "Set-Cookie": "guardrail_refresh=" + "B".repeat(43) + "; Path=/api/v1/auth; HttpOnly; SameSite=Lax" }, json: session() });
    }
  });
  await context.route("**/api/v1/devices**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const headers = await request.allHeaders();
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toMatch(/^Bearer device-access-[AB]-\d+$/);
    const owner: Owner = headers.authorization.includes("-B-") ? "B" : "A";
    const id = new URL(request.url()).pathname.replace(/^\/api\/v1\/devices\/?/, "");
    const method = request.method();
    if (method === "GET" && (id.endsWith("/pairing") || id.endsWith("/folder-scan"))) { await route.fulfill({ headers: cors, json: id.endsWith("/pairing") ? { pairing: null } : { scan: null } }); return; }
    if (method === "GET") {
      if (!id) {
        const devices = [...state.records.values()].filter((entry) => entry.owner === owner).map((entry) => entry.device);
        const held = state.holdNextList; state.holdNextList = null;
        if (held) { held.entered(); await held.gate; }
        await route.fulfill({ headers: cors, json: { devices } });
      }
      else {
        const found = state.records.get(id);
        await route.fulfill(found?.owner === owner ? { headers: cors, json: { device: found.device } } : { status: 404, headers: cors, json: { error: { code: "DEVICE_NOT_FOUND" } } });
      }
      return;
    }
    const body = method === "DELETE" ? null : request.postDataJSON() as Record<string, unknown>;
    state.writes.push({ method, body, authorization: headers.authorization });
    if (method === "POST") state.posts++;
    if (state.rejectNext) { state.rejectNext = false; await route.fulfill({ status: 401, headers: cors }); return; }
    if (state.failNext) { const status = state.failNext; state.failNext = 0; await route.fulfill({ status, headers: cors, json: { error: { code: status === 409 ? "DEVICE_LIMIT_REACHED" : "PRIVATE_BACKEND_DETAIL" } } }); return; }
    if (method === "POST") {
      let stored = [...state.records.values()].find((entry) => entry.owner === owner && entry.requestId === body!.requestId);
      if (!stored) {
        const device: RegisteredDevice = { id: randomUUID(), name: String(body!.name).trim(), type: body!.type as RegisteredDevice["type"], brand: String(body!.brand ?? "").trim() || null, model: String(body!.model ?? "").trim() || null, os: String(body!.os ?? "").trim() || null, createdAt: "2026-11-09T04:00:00.000Z", updatedAt: "2026-11-09T04:00:00.000Z", status: "registered", paired: false, storage: null };
        stored = { owner, device, requestId: String(body!.requestId) }; state.records.set(device.id, stored);
      }
      if (state.loseNext) { state.loseNext = false; await route.abort("failed"); return; }
      if (state.malformedNext) { state.malformedNext = false; await route.fulfill({ status: 201, headers: cors, json: { device: { ...stored.device, paired: true } } }); return; }
      await route.fulfill({ status: 201, headers: cors, json: { device: stored.device } }); return;
    }
    const stored = state.records.get(id);
    if (!stored || stored.owner !== owner) { await route.fulfill({ status: 404, headers: cors }); return; }
    if (method === "DELETE") { state.records.delete(id); await route.fulfill({ status: 204, headers: cors }); }
    else { stored.device = { ...stored.device, name: String(body!.name).trim(), updatedAt: "2026-11-09T05:00:00.000Z" }; await route.fulfill({ headers: cors, json: { device: stored.device } }); }
  });
  return state;
}
async function register(page: Page, name = "Private workstation") {
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Register a device", exact: true });
  await dialog.getByLabel("Device name", { exact: true }).fill(name);
  await dialog.getByLabel("Brand (optional)").fill("ACER");
  await dialog.getByLabel("Operating system (optional)").fill("Windows");
  await dialog.getByRole("button", { name: "Register device", exact: true }).click();
}
async function logout(page: Page) { await page.locator(".sidebar-profile").click(); await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/); }

test("registered devices persist across reload, appear in connections/settings, rename and remove without sample storage", async ({ page, context }) => {
  const state = await backend(context);
  await page.goto("/app/devices");
  await expect(page.getByRole("heading", { name: "No devices registered" })).toBeVisible();
  await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  expect(state.posts).toBe(1);
  expect(Object.keys(state.writes[0].body!).sort()).toEqual(["requestId", "name", "type", "brand", "model", "os"].sort());
  expect(String(state.writes[0].body!.requestId)).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator(".device-grid")).toContainText("Storage report pending");
  await expect(page.locator(".device-grid")).not.toContainText("GB used");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain("Private workstation");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  await page.goto("/app/connections");
  await expect(page.locator(".device-grid")).toContainText("Private workstation");
  await page.goto("/app/settings/devices");
  await expect(page.locator(".device-grid")).toContainText("Private workstation");
  await page.getByRole("link", { name: "View details", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pair your companion app" })).toBeVisible();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename device", exact: true });
  await rename.getByLabel("Device name", { exact: true }).fill("Travel laptop");
  await rename.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Travel laptop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove device", exact: true }).click();
  const remove = page.getByRole("dialog", { name: "Remove device", exact: true });
  await expect(remove).toContainText("Files on the device are not deleted");
  await remove.getByRole("button", { name: "Remove device", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/devices$/);
  await expect(page.getByRole("heading", { name: "No devices registered" })).toBeVisible();
  expect(state.records.size).toBe(0);
});
test("logout and another account's login never show the first owner's devices or enable foreign detail access", async ({ page, context }) => {
  const state = await backend(context);
  await page.goto("/app/devices"); await register(page, "Owner A private laptop");
  await expect(page.getByRole("heading", { name: "Owner A private laptop" })).toBeVisible();
  const id = [...state.records.keys()][0];
  await logout(page);
  await page.getByLabel("Email address").fill(profiles.B.email);
  await page.getByLabel("Password", { exact: true }).fill("Owner B Password!42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator("body")).not.toContainText("Owner A private laptop");
  await page.goto("/app/devices");
  await expect(page.getByRole("heading", { name: "No devices registered" })).toBeVisible();
  await page.goto(`/app/devices/${id}`);
  await expect(page.getByRole("heading", { name: "Device not found", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Owner A private laptop");
});
test("a lost registration response is not retried automatically; an explicit retry reuses its request ID", async ({ page, context }) => {
  const state = await backend(context); state.loseNext = true;
  await page.goto("/app/devices"); await register(page, "Retry-safe laptop");
  const dialog = page.getByRole("dialog", { name: "Register a device" });
  await expect(dialog.getByRole("alert")).toContainText("Could not confirm the device change");
  expect(state.posts).toBe(1); expect(state.records.size).toBe(1);
  await dialog.getByRole("button", { name: "Register device", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retry-safe laptop", exact: true })).toBeVisible();
  expect(state.posts).toBe(2); expect(state.records.size).toBe(1);
  expect(state.writes[0].body!.requestId).toBe(state.writes[1].body!.requestId);
});
test("a definite unauthorized write renews once and retries with the same registration request", async ({ page, context }) => {
  const state = await backend(context); state.rejectNext = true;
  await page.goto("/app/devices"); await register(page, "Renewed session laptop");
  await expect(page.getByRole("heading", { name: "Renewed session laptop", exact: true })).toBeVisible();
  expect(state.posts).toBe(2); expect(state.records.size).toBe(1);
  expect(state.writes[0].authorization).not.toBe(state.writes[1].authorization);
  expect(state.writes[0].body!.requestId).toBe(state.writes[1].body!.requestId);
});
test("a successful registration reloads fresh data even while an older list response is pending", async ({ page, context }) => {
  const state = await backend(context);
  await page.goto("/app/devices");
  await expect(page.getByRole("heading", { name: "No devices registered" })).toBeVisible();
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Register a device" });
  await dialog.getByLabel("Device name", { exact: true }).fill("Fresh device snapshot");
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { entered = resolve; });
  state.holdNextList = { entered, gate };
  await page.evaluate(() => window.dispatchEvent(new Event("guardrail:devices-changed")));
  await arrived;
  try {
    await dialog.getByRole("button", { name: "Register device", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fresh device snapshot", exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "Fresh device snapshot", exact: true })).toBeVisible();
  expect(state.posts).toBe(1);
});
for (const status of [403, 409, 429]) {
  test(`device write ${status} keeps the form retryable and shows a local safe error`, async ({ page, context }) => {
    const state = await backend(context); state.failNext = status;
    await page.goto("/app/devices"); await register(page);
    const dialog = page.getByRole("dialog", { name: "Register a device" });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).not.toContainText("PRIVATE_BACKEND_DETAIL");
    await expect(dialog.getByRole("button", { name: "Register device", exact: true })).toBeEnabled();
    expect(state.records.size).toBe(0); expect(state.posts).toBe(1);
  });
}
test("malformed registration success does not claim a device was paired or silently repeat the write", async ({ page, context }) => {
  const state = await backend(context); state.malformedNext = true;
  await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Could not confirm the device change");
  expect(state.posts).toBe(1);
});
test("explicit demo mode keeps sample pairing isolated from all real device APIs", async ({ page, context }) => {
  let calls = 0;
  await context.route("**/api/v1/devices**", async (route) => { calls++; await route.fulfill({ status: 500 }); });
  await page.goto("/login");
  await page.getByRole("link", { name: /Explore without signing in/ }).click();
  await page.goto("/app/devices");
  await expect(page.getByText("Sample device data.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a demo device" })).toBeVisible();
  expect(calls).toBe(0);
});

async function pairingBackend(context: BrowserContext, state: Awaited<ReturnType<typeof backend>>, id: string) {
  const fixture = { pairing: null as DevicePairing | null, starts: 0, approvals: 0, fail: 0, lose: false };
  await context.route(`**/api/v1/devices/${id}/pairing**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    expect(request.headers().authorization).toMatch(/^Bearer device-access-A-/);
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") { await route.fulfill({ headers: cors, json: { pairing: fixture.pairing } }); return; }
    if (fixture.fail) { const status = fixture.fail; fixture.fail = 0; await route.fulfill({ status, headers: cors, json: { error: { message: "PRIVATE_TOKEN" } } }); return; }
    if (path.endsWith("/pairing")) {
      fixture.starts++;
      fixture.pairing = { id: randomUUID(), state: "Waiting", expiresAt: new Date(Date.now() + 900000).toISOString(), claimId: null, comparisonCode: null, candidate: null };
      if (fixture.lose) { fixture.lose = false; await route.abort("failed"); return; }
      await route.fulfill({ status: 201, headers: cors, json: { pairing: fixture.pairing, code: "ABCD-EFGH-JKLM" } }); return;
    }
    if (path.endsWith("/approve")) {
      fixture.approvals++; expect(request.postDataJSON()).toEqual({ claimId: fixture.pairing!.claimId }); fixture.pairing!.state = "Approved";
    } else fixture.pairing!.state = path.endsWith("/reject") ? "Rejected" : "Cancelled";
    await route.fulfill({ headers: cors, json: { pairing: fixture.pairing } });
  });
  await context.route(`**/api/v1/devices/${id}/disconnect`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const stored = state.records.get(id)!; stored.device = { ...stored.device, status: "registered", paired: false, pairedAt: null, credentialExpiresAt: null, storage: null };
    if (fixture.pairing && fixture.pairing.state !== "Completed") fixture.pairing.state = "Cancelled";
    await route.fulfill({ status: 204, headers: cors });
  });
  return fixture;
}
test("pairing requires comparison approval, stays pending until exchange and can be disconnected", async ({ page, context }) => {
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; const fixture = await pairingBackend(context, state, id);
  await page.goto(`/app/devices/${id}`);
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveText("ABCD-EFGH-JKLM");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("ABCD-EFGH-JKLM");
  await page.reload(); await expect(page.getByText("The code is shown once.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Generate a new code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
  fixture.pairing = { ...fixture.pairing!, state: "Claimed", claimId: randomUUID(), comparisonCode: "123456", candidate: { appName: "Guardrail companion", platform: "Windows", appVersion: "0.1" } };
  await page.getByRole("button", { name: "Refresh pairing", exact: true }).click();
  await expect(page.getByLabel("Comparison number", { exact: true })).toHaveText("123456");
  await expect(page.getByRole("button", { name: "Approve pairing", exact: true })).toBeDisabled();
  await page.getByLabel("The numbers match on my device.").check();
  await page.getByRole("button", { name: "Approve pairing", exact: true }).click();
  await expect(page.getByText("Approved. Waiting for the companion app to collect its credential.", { exact: true })).toBeVisible();
  expect(state.records.get(id)!.device.paired).toBe(false); expect(fixture.approvals).toBe(1);
  fixture.pairing!.state = "Completed";
  state.records.get(id)!.device = { ...state.records.get(id)!.device, paired: true, status: "paired", pairedAt: new Date().toISOString(), credentialExpiresAt: new Date(Date.now() + 2592000000).toISOString() };
  await page.getByRole("button", { name: "Refresh pairing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Companion app paired" })).toBeVisible();
  await expect(page.locator(".pairing-panel")).toContainText("does not indicate whether the device is online");
  await page.getByRole("button", { name: "Disconnect companion app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pair your companion app" })).toBeVisible();
  expect(state.records.get(id)!.device.paired).toBe(false);
});

test("pairing code copies with feedback and becomes unavailable after fifteen minutes", async ({ page, context }) => {
  await page.clock.install();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; await pairingBackend(context, state, id);
  await page.goto(`/app/devices/${id}`);
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveText("ABCD-EFGH-JKLM");
  await expect(page.locator(".pairing-panel")).toContainText("Expires 15 minutes after generation");
  await page.getByRole("button", { name: "Copy pairing code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy pairing code", exact: true })).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ABCD-EFGH-JKLM");
  await page.clock.fastForward(14 * 60000);
  await expect(page.getByRole("button", { name: "Copy pairing code", exact: true })).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(page.locator(".pairing-panel")).toContainText("Pairing expired");
  await expect(page.getByRole("button", { name: "Copy pairing code", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
});

test("blocked clipboard access offers manual copying without claiming success", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard blocked"); } } });
  });
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; await pairingBackend(context, state, id);
  await page.goto(`/app/devices/${id}`);
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await page.getByRole("button", { name: "Copy pairing code", exact: true }).click();
  await expect(page.locator(".pairing-panel")).toContainText("Select and copy the code manually");
  await expect(page.getByRole("button", { name: "Copy pairing code", exact: true })).toHaveText("Copy");
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveText("ABCD-EFGH-JKLM");
});

test("generating a code requests the companion after two seconds, with a manual fallback and no code in the link", async ({ page, context }) => {
  await page.clock.install();
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; await pairingBackend(context, state, id);
  await page.goto(`/app/devices/${id}`);
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
  const launches = () => page.evaluate(() => (window as unknown as { guardrailTestLaunches: string[] }).guardrailTestLaunches);
  expect(await launches()).toEqual([]);
  await page.clock.fastForward(2100);
  expect(await launches()).toEqual(["guardrail-companion://open"]);
  await page.clock.fastForward(6000);
  expect(await launches()).toHaveLength(1);
  await page.getByRole("link", { name: "Open Guardrail Companion", exact: true }).click();
  expect(await launches()).toHaveLength(2);
  await page.getByRole("button", { name: "Generate a new code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel pairing", exact: true }).click();
  await expect(page.locator(".pairing-panel")).toContainText("Pairing cancelled");
  await page.clock.fastForward(2100);
  expect(await launches()).toHaveLength(2);
});
test("pairing cancellation, rejection, expiry and lost responses remain recoverable without automatic writes", async ({ page, context }) => {
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; const fixture = await pairingBackend(context, state, id);
  await page.goto(`/app/devices/${id}`); fixture.lose = true;
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.locator(".pairing-panel").getByRole("alert")).toContainText("Could not confirm the device change"); expect(fixture.starts).toBe(1);
  await page.getByRole("button", { name: "Refresh pairing", exact: true }).click();
  await expect(page.getByText("The code is shown once.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel pairing", exact: true }).click();
  await expect(page.getByText("Pairing cancelled.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
  fixture.pairing = { ...fixture.pairing!, state: "Claimed", claimId: randomUUID(), comparisonCode: "654321", candidate: { appName: "Unknown app", platform: "Windows", appVersion: null } };
  await page.getByRole("button", { name: "Refresh pairing", exact: true }).click();
  await page.getByRole("button", { name: "Reject app", exact: true }).click();
  await expect(page.getByText("Pairing rejected.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
  fixture.pairing!.expiresAt = new Date(0).toISOString();
  await page.getByRole("button", { name: "Refresh pairing", exact: true }).click();
  await expect(page.getByText("Pairing expired.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve pairing", exact: true })).toHaveCount(0);
  fixture.fail = 429; await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
  await expect(page.locator(".pairing-panel").getByRole("alert")).toContainText("Too many device changes");
  await expect(page.locator("body")).not.toContainText("PRIVATE_TOKEN");
});

function withCapacity(device: RegisteredDevice): RegisteredDevice {
  return { ...device, paired: true, status: "paired", pairedAt: new Date().toISOString(), credentialExpiresAt: new Date(Date.now() + 2592000000).toISOString(), storage: {
    collectedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
    totalBytes: 768 * 1024 ** 3, freeBytes: 228 * 1024 ** 3, usedBytes: 540 * 1024 ** 3,
    volumes: [{ id: "C:\\", totalBytes: 512 * 1024 ** 3, freeBytes: 128 * 1024 ** 3, usedBytes: 384 * 1024 ** 3 }, { id: "D:\\", totalBytes: 256 * 1024 ** 3, freeBytes: 100 * 1024 ** 3, usedBytes: 156 * 1024 ** 3 }],
  } };
}
test("real capacity displays in cards and details, becomes stale, and clears after disconnect", async ({ page, context }) => {
  await page.clock.install();
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; const stored = state.records.get(id)!; stored.device = withCapacity(stored.device);
  await pairingBackend(context, state, id);
  await page.getByRole("button", { name: "Refresh devices", exact: true }).click();
  await expect(page.locator(".device-grid")).toContainText("540.0 GiB");
  await expect(page.locator(".device-grid")).toContainText("228.0 GiB free");
  await expect(page.locator(".device-grid")).toContainText("Recent capacity report");
  await page.getByRole("link", { name: "View details", exact: true }).click();
  await expect(page.locator(".reported-volumes")).toContainText("C:\\"); await expect(page.locator(".reported-volumes")).toContainText("D:\\");
  await expect(page.getByRole("progressbar")).toHaveAttribute("max", String(768 * 1024 ** 3));
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("totalBytes");
  await page.clock.fastForward(181000);
  await expect(page.locator(".device-storage-report")).toContainText("Report is stale");
  await page.getByRole("button", { name: "Disconnect companion app", exact: true }).click();
  await expect(page.locator(".device-report-pending")).toContainText("Storage report pending");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});
test("background capacity refresh preserves an active pairing code and shows newer reported values", async ({ page, context }) => {
  await page.clock.install();
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; const stored = state.records.get(id)!; stored.device = withCapacity(stored.device);
  await pairingBackend(context, state, id); await page.goto(`/app/devices/${id}`);
  await page.getByRole("button", { name: "Pair a replacement app", exact: true }).click();
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveText("ABCD-EFGH-JKLM");
  stored.device.storage = { ...stored.device.storage!, totalBytes: 512 * 1024 ** 3, freeBytes: 100 * 1024 ** 3, usedBytes: 412 * 1024 ** 3,
    volumes: [{ id: "C:\\", totalBytes: 512 * 1024 ** 3, freeBytes: 100 * 1024 ** 3, usedBytes: 412 * 1024 ** 3 }] };
  await page.clock.fastForward(31000);
  await expect(page.locator(".device-storage-report")).toContainText("412.0 GiB");
  await expect(page.getByLabel("Pairing code", { exact: true })).toHaveText("ABCD-EFGH-JKLM");
});
test("impossible capacity responses are rejected without displaying invented measurements", async ({ page, context }) => {
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const stored = [...state.records.values()][0]; stored.device = withCapacity(stored.device); stored.device.storage!.freeBytes = stored.device.storage!.totalBytes + 1;
  await page.getByRole("button", { name: "Refresh devices", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("unexpected response");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

for (const width of [390, 768, 1440]) {
  test(`device detail cards keep content and pairing controls inside their borders at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await backend(context); await page.goto("/app/devices"); await register(page);
    await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
    const id = [...state.records.keys()][0]; await pairingBackend(context, state, id);
    await page.goto(`/app/devices/${id}`);
    await expect(page.getByRole("heading", { name: "Pair your companion app", exact: true })).toBeVisible();
    const insets = await page.locator(".detail-grid > article").evaluateAll((cards) => cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      const first = card.firstElementChild!.getBoundingClientRect();
      const style = getComputedStyle(card);
      return { left: first.left - bounds.left, top: first.top - bounds.top, right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom) };
    }));
    expect(insets).toHaveLength(4);
    for (const inset of insets) {
      expect(inset.left).toBeGreaterThanOrEqual(16); expect(inset.top).toBeGreaterThanOrEqual(16);
      expect(inset.right).toBeGreaterThanOrEqual(16); expect(inset.bottom).toBeGreaterThanOrEqual(16);
    }
    await page.getByRole("button", { name: "Generate pairing code", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy pairing code", exact: true })).toBeVisible();
    const contained = await page.locator(".pairing-panel").evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll("button, .pairing-code-row")].every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= bounds.left + 15 && rect.right <= bounds.right - 15 && rect.bottom <= bounds.bottom - 15;
      });
    });
    expect(contained).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/device-layout-${width}.png`, fullPage: true });
  });
}

test("folder scan metadata appears only for the paired owner, refreshes and clears after disconnect", async ({ page, context }) => {
  const state = await backend(context); await page.goto("/app/devices"); await register(page);
  await expect(page.getByRole("heading", { name: "Private workstation", exact: true })).toBeVisible();
  const id = [...state.records.keys()][0]; const stored = state.records.get(id)!; stored.device = withCapacity(stored.device);
  await pairingBackend(context, state, id);
  let scan: Record<string, unknown> | null = null;
  await context.route(`**/api/v1/devices/${id}/folder-scan`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    expect(route.request().headers().authorization).toMatch(/^Bearer device-access-A-/);
    await route.fulfill({ headers: cors, json: { scan } });
  });
  await page.goto(`/app/devices/${id}`);
  const panel = page.locator(".device-folder-scan");
  await expect(panel).toContainText("No folder scan received yet");
  const now = new Date().toISOString();
  scan = { scanId: randomUUID(), folderName: "My sample folder", startedAt: now, finishedAt: now, receivedAt: now, fileCount: 1, totalBytes: 2097152, skippedCount: 2, limitReached: true,
    types: [{ type: ".pdf", count: 1, bytes: 2097152 }], largestFiles: [{ relativePath: "documents/report.pdf", type: ".pdf", bytes: 2097152, modifiedAt: now }] };
  await panel.getByRole("button", { name: "Refresh scan", exact: true }).click();
  await expect(panel).toContainText("My sample folder"); await expect(panel).toContainText("Partial coverage");
  await expect(panel.getByRole("cell", { name: "documents/report.pdf", exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "2.0 MiB", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("report.pdf");
  await page.getByRole("button", { name: "Disconnect companion app", exact: true }).click();
  await expect(panel).toContainText("Pair the companion app before scanning");
  await expect(panel).not.toContainText("report.pdf");
});
