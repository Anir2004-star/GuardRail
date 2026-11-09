import { mockEmptyDevices } from "./helpers/empty-devices";
import { test, expect, type BrowserContext, type Route } from "@playwright/test";

const key = "guardrail.auth.coordination.v1";
const user = {
  id: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Session Tester",
  firstName: "Session", middleName: null, lastName: "Tester",
  email: "session@example.org", createdAt: "2026-11-01T12:00:00.000Z",
};
const cors = {
  "Access-Control-Allow-Origin": "http://localhost:3100",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};
test.beforeEach(async ({ context }) => {
  await context.route("**/api/v1/auth/me", (route) => route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : 200, headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" }, ...(route.request().method() === "OPTIONS" ? {} : { json: { user } }) }));
});
const token = (index: number) => `${String.fromCharCode(65 + index).repeat(42)}A`;
async function cookies(context: BrowserContext) {
  await context.addCookies([{ name: "guardrail_refresh", value: token(0), domain: "localhost", path: "/api/v1/auth", httpOnly: true, sameSite: "Lax" }]);
}
async function mock(context: BrowserContext, handler: (route: Route) => Promise<void>) {
  await context.route("**/api/v1/auth/refresh", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    await handler(route);
  });
}
function success(route: Route, index = 1, expiresIn = 900, name = user.name) {
  return route.fulfill({
    status: 200,
    headers: { ...cors, "Set-Cookie": `guardrail_refresh=${token(index)}; Path=/api/v1/auth; HttpOnly; SameSite=Lax` },
    json: { user: { ...user, name }, accessToken: `memory-access-token-${index}`, tokenType: "Bearer", expiresIn },
  });
}

test("reload restores via the HttpOnly cookie, rotates it, and never persists credentials", async ({ page, context }) => {
  await cookies(context);
  let requests = 0;
  await mock(context, async (route) => {
    const headers = await route.request().allHeaders();
    expect(headers.cookie).toContain(`guardrail_refresh=${token(requests)}`);
    expect(headers.authorization).toBeUndefined();
    expect(route.request().postData()).toBeNull();
    await success(route, ++requests);
  });
  await page.goto("/app/dashboard");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.reload();
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  expect(requests).toBe(2);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const secret of [user.email, user.name, "memory-access-token", token(0), token(1), token(2)]) expect(storage).not.toContain(secret);
  expect(await page.evaluate(() => document.cookie)).not.toContain("guardrail_refresh");
});

test("renewal runs before expiry and repeated foreground events do not duplicate requests", async ({ page, context }) => {
  await page.clock.install();
  await cookies(context);
  let requests = 0;
  await mock(context, (route) => success(route, ++requests, 60, requests === 1 ? user.name : "Renewed Tester"));
  await page.goto("/app/dashboard");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.evaluate(() => { for (let index = 0; index < 5; index++) window.dispatchEvent(new Event("focus")); });
  await page.clock.fastForward(28_000);
  expect(requests).toBe(1);
  await page.clock.fastForward(5_000);
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  expect(requests).toBe(2);
});

test("two tabs serialize cookie rotation and never reuse the same token", async ({ context }) => {
  await cookies(context);
  const used = new Set<string>();
  let requests = 0;
  let active = 0;
  let maximumActive = 0;
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await mock(context, async (route) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    const cookie = (await route.request().allHeaders()).cookie;
    expect(used.has(cookie)).toBe(false);
    used.add(cookie);
    const index = ++requests;
    if (index === 1) { arrived(); await gate; }
    await success(route, index);
    active--;
  });
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/app/dashboard");
  await entered;
  try { await second.goto("/app/dashboard"); expect(requests).toBe(1); } finally { release(); }
  await expect(first.locator(".sidebar-profile")).toContainText(user.name);
  await expect(second.locator(".sidebar-profile")).toContainText(user.name);
  expect(maximumActive).toBe(1);
  expect(requests).toBeLessThanOrEqual(2);
});

test("a lost refresh response pauses other tabs and survives reload without retrying", async ({ context }) => {
  await cookies(context);
  let requests = 0;
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await mock(context, async (route) => { requests++; arrived(); await gate; await route.abort("failed"); });
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/app/dashboard");
  await entered;
  try { await second.goto("/app/dashboard"); } finally { release(); }
  for (const page of [first, second]) {
    await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
    await page.reload();
    await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  }
  expect(requests).toBe(1);
});

test("401 on renewal clears identity across tabs and asks for sign-in", async ({ context }) => {
  await cookies(context);
  let valid = true;
  await mock(context, (route) => valid ? success(route, 1, 60) : route.fulfill({ status: 401, headers: cors, json: {} }));
  const first = await context.newPage();
  await first.clock.install();
  await first.goto("/app/dashboard");
  await expect(first.locator(".sidebar-profile")).toContainText(user.name);
  const second = await context.newPage();
  await second.goto("/app/dashboard");
  await expect(second.locator(".sidebar-profile")).toContainText(user.name);
  valid = false;
  await first.clock.fastForward(31_000);
  for (const page of [first, second]) {
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".session-notice")).toContainText("Your session has expired");
    await expect(page.locator(".sidebar-profile")).toHaveCount(0);
  }
});

for (const status of [403, 429, 500] as const) {
  test(`refresh ${status} pauses renewal without repeated requests`, async ({ page, context }) => {
    let requests = 0;
    await mock(context, (route) => { requests++; return route.fulfill({ status, headers: cors, json: { error: { message: "PRIVATE_SERVER_DETAIL" } } }); });
    await page.goto("/app/dashboard");
    await expect(page.locator(".session-notice")).toContainText(status === 403 ? "website address" : status === 429 ? "Too many session refresh attempts" : "Automatic retries are paused");
    await page.reload();
    await expect(page.locator(".session-notice")).toBeVisible();
    expect(requests).toBe(1);
    await expect(page.getByText("PRIVATE_SERVER_DETAIL")).toHaveCount(0);
  });
}

test("transient failure retains an unexpired access session, then removes it at its deadline", async ({ page, context }) => {
  await page.clock.install();
  let requests = 0;
  await mock(context, (route) => ++requests === 1 ? success(route, 1, 60) : route.abort("failed"));
  await page.goto("/app/dashboard");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.clock.fastForward(31_000);
  await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.clock.fastForward(31_000);
  await expect(page.locator(".sidebar-profile")).toHaveCount(0);
  expect(requests).toBe(2);
});

test("an interrupted operation marker blocks automatic replay", async ({ page, context }) => {
  let requests = 0;
  await mock(context, (route) => { requests++; return success(route); });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ revision: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", state: "pending", message: "" })), { key });
  await page.goto("/app/dashboard");
  await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  expect(requests).toBe(0);
});

test("a malformed successful refresh response pauses without replaying the rotated cookie", async ({ page, context }) => {
  let requests = 0;
  await mock(context, async (route) => {
    requests++;
    await route.fulfill({ status: 200, headers: cors, json: { user, accessToken: "PRIVATE_UNTRUSTED_TOKEN", expiresIn: "900", tokenType: "Bearer" } });
  });
  await page.goto("/app/dashboard");
  await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  await page.reload();
  await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  expect(requests).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("PRIVATE_UNTRUSTED_TOKEN");
});

test("fresh sign-in recovers a paused session and enables restoration again", async ({ page, context }) => {
  let requests = 0;
  await mock(context, (route) => ++requests === 1 ? route.abort("failed") : success(route, 2));
  await context.route("**/api/v1/auth/login", (route) => route.request().method() === "OPTIONS"
    ? route.fulfill({ status: 204, headers: cors }) : success(route, 1));
  await page.goto("/app/dashboard");
  await expect(page.locator(".session-notice")).toContainText("Automatic retries are paused");
  await page.getByRole("link", { name: "Sign in again", exact: true }).click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("A registered Passphrase!42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await expect(page.locator(".session-notice")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  expect(requests).toBe(2);
});

test("unsupported coordination never attempts an unsafe refresh", async ({ page, context }) => {
  let requests = 0;
  await mock(context, (route) => { requests++; return success(route); });
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }));
  await page.goto("/app/dashboard");
  await expect(page.locator(".session-notice")).toContainText("unavailable in this browser");
  expect(requests).toBe(0);
});

test("explicitly leaving during restoration prevents the late response from restoring identity", async ({ page, context }) => {
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await mock(context, async (route) => { arrived(); await gate; await success(route); });
  await page.goto("/app/dashboard");
  await entered;
  try {
    await page.getByRole("link", { name: "Back to sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally { release(); }
  await page.getByRole("link", { name: /Explore without signing in/ }).click();
  await expect(page.locator(".sidebar-profile")).toContainText("Demo workspace");
  await expect(page.locator(".sidebar-profile")).not.toContainText(user.name);
});

function completeLogout(route: Route) {
  return route.fulfill({ status: 204, headers: { ...cors, "Set-Cookie": "guardrail_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT" } });
}

test("real logout clears the cookie and all tabs, then prevents reload restoration", async ({ context }) => {
  await cookies(context);
  let refreshes = 0;
  let logouts = 0;
  await mock(context, (route) => success(route, ++refreshes));
  await context.route("**/api/v1/auth/logout", async (route) => {
    logouts++;
    expect((await route.request().allHeaders()).cookie).toContain("guardrail_refresh=");
    expect((await route.request().allHeaders()).authorization).toBeUndefined();
    expect(route.request().postData()).toBeNull();
    await completeLogout(route);
  });
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/app/dashboard");
  await expect(first.locator(".sidebar-profile")).toContainText(user.name);
  await second.goto("/app/dashboard");
  await expect(second.locator(".sidebar-profile")).toContainText(user.name);
  const before = refreshes;
  await first.locator(".sidebar-profile").click();
  await first.getByRole("button", { name: "Sign out", exact: true }).click();
  for (const page of [first, second]) await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => context.cookies()).not.toContainEqual(expect.objectContaining({ name: "guardrail_refresh" }));
  await first.goto("/app/dashboard");
  await expect(first).toHaveURL(/\/login$/);
  expect(refreshes).toBe(before);
  expect(logouts).toBe(1);
});

test("logout waits for an in-flight refresh cookie and ignores its late access session", async ({ page, context }) => {
  await page.clock.install();
  await cookies(context);
  let refreshes = 0;
  let logouts = 0;
  let arrived!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await mock(context, async (route) => {
    refreshes++;
    if (refreshes === 2) { arrived(); await gate; }
    await success(route, refreshes, 60);
  });
  await context.route("**/api/v1/auth/logout", async (route) => {
    logouts++;
    expect((await route.request().allHeaders()).cookie).toContain(`guardrail_refresh=${token(2)}`);
    await completeLogout(route);
  });
  await page.goto("/app/dashboard");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.clock.fastForward(31_000);
  await entered;
  try {
    await page.locator(".sidebar-profile").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(logouts).toBe(0);
  } finally { release(); }
  await expect.poll(() => logouts).toBe(1);
  await expect(page.locator(".session-notice")).toHaveCount(0);
  await page.goto("/app/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  expect(refreshes).toBe(2);
});

for (const failure of ["network", 403, 429, 500] as const) {
  test(`logout ${failure} clears local identity but reports failure and allows an explicit retry after reload`, async ({ page, context }) => {
    let refreshes = 0;
    let logouts = 0;
    await mock(context, (route) => success(route, ++refreshes));
    await context.route("**/api/v1/auth/logout", async (route) => {
      logouts++;
      if (logouts === 1) {
        if (failure === "network") await route.abort("failed");
        else await route.fulfill({ status: failure, headers: cors, json: { error: "PRIVATE_SERVER_DETAIL" } });
      } else await completeLogout(route);
    });
    await page.goto("/app/dashboard");
    await expect(page.locator(".sidebar-profile")).toContainText(user.name);
    await page.locator(".sidebar-profile").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".session-notice")).toContainText("server logout could not be confirmed");
    await page.reload();
    await expect(page.getByRole("button", { name: "Retry logout", exact: true })).toBeVisible();
    expect(logouts).toBe(1);
    expect(refreshes).toBe(1);
    await page.getByRole("button", { name: "Retry logout", exact: true }).click();
    await expect(page.locator(".session-notice")).toHaveCount(0);
    expect(logouts).toBe(2);
    await expect(page.getByText("PRIVATE_SERVER_DETAIL")).toHaveCount(0);
  });
}

test.beforeEach(async ({ context }) => { await mockEmptyDevices(context); });
