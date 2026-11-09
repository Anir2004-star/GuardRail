import { mockEmptyDevices } from "./helpers/empty-devices";
import { test, expect, type BrowserContext, type Route } from "@playwright/test";

const user = {
  id: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Verified Tester",
  firstName: "Verified", middleName: null, lastName: "Tester",
  email: "verified@example.org", createdAt: "2026-11-01T12:00:00.000Z",
};
const cors = {
  "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const response = (index: number) => ({ user: { ...user, name: "Unverified preview" }, accessToken: `guard-token-${index}`, tokenType: "Bearer", expiresIn: 900 });
async function routeApi(context: BrowserContext, endpoint: string, handler: (route: Route) => Promise<void>) {
  await context.route(`**/api/v1/auth/${endpoint}`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    await handler(route);
  });
}

test("direct anonymous workspace access waits for restoration then redirects; explicit demo sends no protected requests", async ({ page, context }) => {
  let release!: () => void;
  let arrived!: () => void;
  let privateRequests = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await routeApi(context, "refresh", async (route) => { arrived(); await gate; await route.fulfill({ status: 401, headers: cors }); });
  await routeApi(context, "me", async (route) => { privateRequests++; await route.fulfill({ status: 401, headers: cors }); });
  await page.goto("/app/dashboard");
  await entered;
  try {
    await expect(page.getByRole("heading", { name: "Checking your session" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Google account storage" })).toHaveCount(0);
    await expect(page.locator(".app-sidebar")).toHaveCount(0);
  } finally { release(); }
  await expect(page).toHaveURL(/\/login$/);
  expect(privateRequests).toBe(0);
  await page.getByRole("link", { name: /Explore without signing in/ }).click();
  await expect(page.getByRole("heading", { name: "Google account storage" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".sidebar-profile")).toContainText("Demo workspace");
  expect(privateRequests).toBe(0);
});

test("a protected page waits for me, sends its bearer token without cookies and shows the verified database profile", async ({ page, context }) => {
  await context.addCookies([{ name: "guardrail_refresh", value: "A".repeat(43), domain: "localhost", path: "/api/v1/auth", httpOnly: true, sameSite: "Lax" }]);
  await routeApi(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: response(1) }));
  let release!: () => void;
  let arrived!: () => void;
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await routeApi(context, "me", async (route) => {
    const headers = await route.request().allHeaders();
    expect(headers.authorization).toBe("Bearer guard-token-1");
    expect(headers.cookie).toBeUndefined();
    arrived(); await gate;
    await route.fulfill({ status: 200, headers: cors, json: { user } });
  });
  await page.goto("/app/dashboard");
  await entered;
  try { await expect(page.locator(".app-sidebar")).toHaveCount(0); } finally { release(); }
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await expect(page.locator(".sidebar-profile")).not.toContainText("Unverified preview");
});

test("a rejected access token refreshes once and retries the read using its replacement", async ({ page, context }) => {
  let refreshes = 0;
  const tokens: string[] = [];
  await routeApi(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: response(++refreshes) }));
  await routeApi(context, "me", async (route) => {
    const authorization = (await route.request().allHeaders()).authorization;
    tokens.push(authorization);
    await route.fulfill({ status: authorization === "Bearer guard-token-1" ? 401 : 200, headers: cors, json: { user } });
  });
  await page.goto("/app/dashboard");
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  expect(refreshes).toBe(2);
  expect(tokens).toContain("Bearer guard-token-1");
  expect(tokens).toContain("Bearer guard-token-2");
});

test("an account rejected again after renewal redirects without rendering private workspace content", async ({ page, context }) => {
  let refreshes = 0;
  await routeApi(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: response(++refreshes) }));
  await routeApi(context, "me", (route) => route.fulfill({ status: 401, headers: cors, json: { error: "PRIVATE_ACCOUNT_DETAIL" } }));
  await page.goto("/app/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  await expect(page.getByText("PRIVATE_ACCOUNT_DETAIL")).toHaveCount(0);
  expect(refreshes).toBe(2);
});

for (const failure of ["connection", 403, 500] as const) {
  test(`account check ${failure} shows an error without exposing content or blaming the password, and allows retry`, async ({ page, context }) => {
    let reads = 0;
    let refreshes = 0;
    await routeApi(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: response(++refreshes) }));
    await routeApi(context, "me", async (route) => {
      reads++;
      if (reads === 1 && failure === "connection") await route.abort("failed");
      else await route.fulfill({ status: reads === 1 ? failure as number : 200, headers: cors, json: reads === 1 ? { error: "PRIVATE_SERVICE_DETAIL" } : { user } });
    });
    await page.goto("/app/dashboard");
    await expect(page.getByRole("heading", { name: "Unable to verify your account" })).toBeVisible();
    await expect(page.locator(".app-sidebar")).toHaveCount(0);
    await expect(page.getByText("Email or password is incorrect.")).toHaveCount(0);
    await expect(page.getByText("PRIVATE_SERVICE_DETAIL")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry account check", exact: true }).click();
    await expect(page.locator(".sidebar-profile")).toContainText(user.name);
    expect(refreshes).toBe(1);
  });
}

test("public pages stay accessible and their demo link explicitly enables only sample workspace access", async ({ page, context }) => {
  let authRequests = 0;
  await context.route("**/api/v1/auth/**", async (route) => { authRequests++; await route.abort("failed"); });
  await page.goto("/features");
  await expect(page.locator("main h1")).toBeVisible();
  await page.getByRole("link", { name: "Explore demo", exact: true }).click();
  await expect(page.locator(".sidebar-profile")).toContainText("Demo workspace");
  expect(authRequests).toBe(0);
});

test("a paused restoration without an access token offers sign-in rather than an ineffective account retry", async ({ page, context }) => {
  let refreshes = 0;
  await routeApi(context, "refresh", async (route) => { refreshes++; await route.abort("failed"); });
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { name: "Unable to verify your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry account check", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to sign in", exact: true })).toBeVisible();
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  expect(refreshes).toBe(1);
});

test("a stored coordination marker cannot impersonate an authenticated user", async ({ page, context }) => {
  let privateRequests = 0;
  await page.addInitScript(() => localStorage.setItem("guardrail.auth.coordination.v1", JSON.stringify({
    revision: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", state: "active", message: "", accessToken: "FORGED_TOKEN",
  })));
  await routeApi(context, "refresh", (route) => route.fulfill({ status: 401, headers: cors }));
  await routeApi(context, "me", async (route) => { privateRequests++; await route.abort("failed"); });
  await page.goto("/app/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
  expect(privateRequests).toBe(0);
});

test("leaving during an account check prevents a late response from displaying the workspace", async ({ page, context }) => {
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await routeApi(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: response(1) }));
  await routeApi(context, "me", async (route) => { arrived(); await gate; await route.fulfill({ status: 200, headers: cors, json: { user } }); });
  await page.goto("/app/dashboard");
  await entered;
  try {
    await page.getByRole("link", { name: "Back to sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  } finally { release(); }
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
});

test.beforeEach(async ({ context }) => { await mockEmptyDevices(context); });
