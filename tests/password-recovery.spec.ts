import { test, expect, type BrowserContext, type Route } from "@playwright/test";

const token = "A".repeat(43);
const password = "  New recovery Passphrase!42  ";
const message = "If an account exists for that email, a password reset link will be sent.";
const cors = {
  "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
async function api(context: BrowserContext, endpoint: string, handler: (route: Route) => Promise<void>) {
  await context.route(`**/api/v1/auth/${endpoint}`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    await handler(route);
  });
}
async function fillReset(page: import("@playwright/test").Page) {
  await page.goto(`/reset-password#token=${token}`);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
}
const clearCookie = "guardrail_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

test("forgot password sends only normalized email, omits cookies, shows pending/generic success and stores no submitted data", async ({ page, context }) => {
  await context.addCookies([{ name: "guardrail_refresh", value: token, domain: "localhost", path: "/api/v1/auth", httpOnly: true }]);
  let arrived!: () => void;
  let release!: () => void;
  let posts = 0;
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await api(context, "forgot-password", async (route) => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ email: "person@example.org" });
    expect((await route.request().allHeaders()).cookie).toBeUndefined();
    arrived(); await gate;
    await route.fulfill({ status: 202, headers: cors, json: { message } });
  });
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(" Person@Example.ORG ");
  const before = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await entered;
  try { await expect(page.getByRole("button", { name: "Please wait...", exact: true })).toBeDisabled(); } finally { release(); }
  await expect(page.locator("form").getByRole("status")).toHaveText(message);
  await expect(page).toHaveURL(/\/forgot-password$/);
  expect(posts).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).toBe(before);
});

for (const [status, expected] of [
  [403, "Password recovery is unavailable from this website address."],
  [429, "Too many password recovery attempts. Please try again later."],
  [503, "Password recovery is temporarily unavailable. Please try again later."],
] as const) {
  test(`forgot-password ${status} shows a safe error`, async ({ page, context }) => {
    await api(context, "forgot-password", (route) => route.fulfill({ status, headers: cors, json: { error: "PRIVATE_BACKEND_DETAIL" } }));
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill("person@example.org");
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(expected);
    await expect(page.getByText("PRIVATE_BACKEND_DETAIL")).toHaveCount(0);
  });
}

test("reset removes the URL secret, sends exact new password, clears cookie and offers separate sign-in", async ({ page, context }) => {
  await context.addCookies([{ name: "guardrail_refresh", value: token, domain: "localhost", path: "/api/v1/auth", httpOnly: true }]);
  let posts = 0;
  await api(context, "reset-password", async (route) => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ token, password });
    const headers = await route.request().allHeaders();
    expect(headers.referer).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toContain("guardrail_refresh=");
    await route.fulfill({ status: 204, headers: { ...cors, "Set-Cookie": clearCookie } });
  });
  await fillReset(page);
  await expect(page).toHaveURL("http://localhost:3100/reset-password");
  expect(await page.locator("body").textContent()).not.toContain(token);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Password changed. Sign in with your new password.");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect.poll(() => context.cookies()).not.toContainEqual(expect.objectContaining({ name: "guardrail_refresh" }));
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(token);
  expect(storage).not.toContain(password);
  expect(posts).toBe(1);
  await page.getByRole("link", { name: "Go to sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("new-password rules and confirmation block invalid submissions without consuming the link", async ({ page, context }) => {
  let posts = 0;
  await api(context, "reset-password", async (route) => { posts++; await route.fulfill({ status: 204, headers: cors }); });
  await fillReset(page);
  await page.getByLabel("New password", { exact: true }).fill("weak");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Use at least 15 characters.");
  expect(posts).toBe(0);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill("different");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Passwords must match.");
  expect(posts).toBe(0);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  expect(posts).toBe(1);
});

for (const fragment of ["", "#token=invalid", `#token=${token}&token=${token}`]) {
  test(`missing or malformed reset fragment ${fragment.slice(0, 20)} never submits a password`, async ({ page, context }) => {
    let posts = 0;
    await api(context, "reset-password", async (route) => { posts++; await route.abort("failed"); });
    await page.goto(`/reset-password${fragment}`);
    await expect(page.locator(".auth-box").getByRole("alert")).toContainText("Reset link is invalid or expired");
    await expect(page.getByRole("button", { name: "Change password", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL("http://localhost:3100/reset-password");
    expect(posts).toBe(0);
  });
}

test("expired or reused server tokens remove the form and offer a new reset request", async ({ page, context }) => {
  await api(context, "reset-password", (route) => route.fulfill({ status: 400, headers: cors, json: { error: { code: "INVALID_RESET_TOKEN", message: "PRIVATE_ERROR" } } }));
  await fillReset(page);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.locator(".auth-box").getByRole("alert")).toContainText("Reset link is invalid or expired");
  await expect(page.getByRole("link", { name: "Request a new link", exact: true })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("an uncertain reset response does not retry automatically or claim success", async ({ page, context }) => {
  let posts = 0;
  await api(context, "reset-password", async (route) => { posts++; await route.abort("failed"); });
  await fillReset(page);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Could not confirm the password change");
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("a confirmed password reset clears the browser session across open tabs", async ({ context }) => {
  const user = { id: "71e23186-bc0e-4f4c-bdf5-ac0df68cf038", name: "Reset Tester", firstName: "Reset", middleName: null, lastName: "Tester", email: "reset@example.org", createdAt: "2026-11-01T12:00:00.000Z" };
  await api(context, "refresh", (route) => route.fulfill({ status: 200, headers: cors, json: { user, accessToken: "memory-reset-access", tokenType: "Bearer", expiresIn: 900 } }));
  await api(context, "me", (route) => route.fulfill({ status: 200, headers: cors, json: { user } }));
  await api(context, "reset-password", (route) => route.fulfill({ status: 204, headers: { ...cors, "Set-Cookie": clearCookie } }));
  const workspace = await context.newPage();
  await workspace.goto("/app/dashboard");
  await expect(workspace.locator(".sidebar-profile")).toContainText(user.name);
  const reset = await context.newPage();
  await fillReset(reset);
  await reset.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(reset.getByRole("status")).toContainText("Password changed");
  await expect(workspace).toHaveURL(/\/login$/);
});
