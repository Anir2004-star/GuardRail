import { mockEmptyDevices } from "./helpers/empty-devices";
import { test, expect, type Page, type Route } from "@playwright/test";

const apiPattern = "**/api/v1/auth/login";
const password = "  Registered Passphrase!42  ";
const accessToken = "sample-access-token-for-browser-tests";
const user = {
  id: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Registered Tester",
  firstName: "Registered", middleName: null, lastName: "Tester",
  email: "registered+example@example.org", createdAt: "2026-11-01T12:00:00.000Z",
};
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3100",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};
const success = { user, accessToken, tokenType: "Bearer", expiresIn: 900 };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({ status: 401, headers: corsHeaders }));
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : 200, headers: { ...corsHeaders, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" }, ...(route.request().method() === "OPTIONS" ? {} : { json: { user } }) }));
});

async function mockLogin(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route(apiPattern, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    await handler(route);
  });
}

async function fillLogin(page: Page, value = password) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(" Registered+Example@Example.ORG ");
  await page.getByLabel("Password", { exact: true }).fill(value);
}

test("real sign-in sends exact credentials once, includes cookies, and stores no credentials in browser storage", async ({ page, context }) => {
  const refreshToken = "test-refresh-cookie-secret";
  await context.addCookies([{ name: "guardrail_refresh", value: refreshToken, domain: "localhost", path: "/api/v1/auth", httpOnly: true, sameSite: "Lax" }]);
  let postCount = 0;
  let arrived!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockLogin(page, async (route) => {
    postCount++;
    expect(route.request().postDataJSON()).toEqual({ email: user.email, password });
    const headers = await route.request().allHeaders();
    expect(headers.cookie).toContain(`guardrail_refresh=${refreshToken}`);
    expect(headers.authorization).toBeUndefined();
    arrived();
    await gate;
    await route.fulfill({ status: 200, headers: corsHeaders, json: success });
  });
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await entered;
  try {
    await expect(page.getByRole("button", { name: "Please wait...", exact: true })).toBeDisabled();
    expect(postCount).toBe(1);
  } finally { release(); }
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await expect(page.locator(".sidebar-profile")).toContainText("Registered account");
  await expect(page.locator(".demo-banner")).toContainText("Storage data and cleanup actions are still demos");
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const secret of [password, accessToken, refreshToken, user.email, user.name]) expect(stored).not.toContain(secret);
  expect(await page.evaluate(() => document.cookie)).not.toContain(refreshToken);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.locator(".sidebar-profile")).toContainText(user.name);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".sidebar-profile")).toHaveCount(0);
  expect(postCount).toBe(1);
});

for (const [status, message] of [
  [400, "Check your email and password and try again."],
  [401, "Email or password is incorrect."],
  [403, "Sign-in is unavailable from this website address."],
  [429, "Too many login attempts. Please try again later."],
  [500, "We couldn't sign you in. Please try again later."],
] as const) {
  test(`login handles ${status} safely and allows correcting and retrying`, async ({ page }) => {
    let attempts = 0;
    await mockLogin(page, async (route) => {
      attempts++;
      await route.fulfill({ status: attempts === 1 ? status : 200, headers: corsHeaders, json: attempts === 1 ? { error: { message: "PRIVATE_BACKEND_DETAIL", password } } : success });
    });
    await fillLogin(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(message);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("PRIVATE_BACKEND_DETAIL")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    expect(attempts).toBe(2);
  });
}

test("unavailable backend shows an error and does not enter the demo dashboard", async ({ page }) => {
  await mockLogin(page, (route) => route.abort("failed"));
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Could not reach the sign-in service. Check your connection and try again.");
  await expect(page).toHaveURL(/\/login$/);
});

test("malformed success cannot establish a session or redirect", async ({ page }) => {
  await mockLogin(page, (route) => route.fulfill({ status: 200, headers: corsHeaders, json: { user, accessToken, tokenType: "Bearer", expiresIn: "900" } }));
  await fillLogin(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("The sign-in service returned an unexpected response. Please try again later.");
  await expect(page).toHaveURL(/\/login$/);
});

test("login enforces input boundaries without reapplying signup composition rules", async ({ page }) => {
  let requests = 0;
  await mockLogin(page, async (route) => {
    requests++;
    expect(route.request().postDataJSON().password).toBe("short");
    await route.fulfill({ status: 401, headers: corsHeaders, json: {} });
  });
  await fillLogin(page, "a".repeat(73));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Use no more than 72 UTF-8 bytes.");
  expect(requests).toBe(0);
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Email or password is incorrect.");
  expect(requests).toBe(1);
});

test.beforeEach(async ({ context }) => { await mockEmptyDevices(context); });
