import { mockEmptyDevices } from "./helpers/empty-devices";
import { test, expect, type BrowserContext } from "@playwright/test";

const clientId = "123456-browser.apps.googleusercontent.com";
const nonce = "N".repeat(43);
const credential = "PRIVATE_GOOGLE_ID_CREDENTIAL";
const token = "PRIVATE_GUARDRAIL_ACCESS_TOKEN";
const user = { id: "12345678-1234-4123-8123-123456789012", email: "google@example.org", name: "Google User", firstName: "Google", middleName: null, lastName: "User", createdAt: "2026-11-07T00:00:00.000Z" };
const cors = { "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "POST, GET", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
async function setup(context: BrowserContext, status = 200, completionStatus = 200) {
  const requests: { path: string; body: unknown }[] = [];
  await context.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "application/javascript", body: `window.google={accounts:{id:{initialize:function(options){window.googleOptions=options;},renderButton:function(host){var button=document.createElement('button');button.textContent='Choose Google account';button.onclick=function(){window.googleOptions.callback({credential:'${credential}'});};host.replaceChildren(button);},cancel:function(){}}}};` }));
  await context.route("**/api/v1/auth/google/**", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith("challenge")) { await route.fulfill({ status, headers: cors, json: status === 200 ? { clientId, nonce, expiresIn: 300 } : { error: "PRIVATE_SERVER_DETAIL" } }); return; }
    if (completionStatus !== 200) { await route.fulfill({ status: completionStatus, headers: cors, json: { error: { code: "PRIVATE_DETAIL", message: credential } } }); return; }
    await route.fulfill({ status: 200, headers: { ...cors, "Set-Cookie": "guardrail_refresh=PRIVATE_REFRESH; Path=/api/v1/auth; HttpOnly; SameSite=Lax" }, json: { user, accessToken: token, tokenType: "Bearer", expiresIn: 900 } });
  });
  await context.route("**/api/v1/auth/me", async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    await route.fulfill({ headers: cors, json: { user } });
  });
  return requests;
}
test("Google login binds the SDK nonce, establishes a guarded session and stores no credentials", async ({ page, context }) => {
  const requests = await setup(context);
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose Google account" })).toBeVisible();
  expect(await page.evaluate(() => {
    const options = (window as Window & { googleOptions?: { client_id: string; nonce: string; auto_select: boolean } }).googleOptions;
    return options && { client_id: options.client_id, nonce: options.nonce, auto_select: options.auto_select };
  })).toEqual({ client_id: clientId, nonce, auto_select: false });
  await page.getByRole("button", { name: "Choose Google account" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  expect(requests.map((request) => request.body)).toEqual([{ intent: "login" }, { intent: "login", credential }]);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const secret of [credential, token, "PRIVATE_REFRESH", nonce]) expect(storage).not.toContain(secret);
});
test("Google signup explicitly sends signup intent without requiring a privacy checkbox", async ({ page, context }) => {
  const requests = await setup(context);
  await page.goto("/signup");
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByRole("button", { name: "Choose Google account" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  expect(requests[1].body).toEqual({ intent: "signup", credential });
});
test("linking requires an existing password, preserves its exact value and clears it after success", async ({ page, context }) => {
  const requests = await setup(context);
  await page.goto("/login");
  await page.getByRole("button", { name: "Link existing account with Google", exact: true }).click();
  await page.getByRole("button", { name: "Verify and link Google account" }).click();
  expect(requests).toHaveLength(0);
  const password = "  Existing Password!42  ";
  await page.getByLabel("Existing account password").fill(password);
  await page.getByRole("button", { name: "Verify and link Google account" }).click();
  await page.getByRole("button", { name: "Choose Google account" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  expect(requests[1].body).toEqual({ intent: "link", credential, password });
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(password);
});
test("unconfigured Google sign-in shows a safe error and leaves password login available", async ({ page, context }) => {
  await setup(context, 503);
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByText("Google sign-in is unavailable. Use email and password, or try again later.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("PRIVATE_SERVER_DETAIL");
});
test("cancelling Google leaves the user signed out and a fresh start requests a new challenge", async ({ page, context }) => {
  const requests = await setup(context);
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose Google account" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel Google sign-in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose Google account" })).toBeVisible();
  expect(requests.map((request) => request.body)).toEqual([{ intent: "login" }, { intent: "login" }]);
});

for (const status of [401, 409]) {
  test(`Google completion ${status} stays signed out, shows a safe error and does not retry`, async ({ page, context }) => {
    const requests = await setup(context, 200, status);
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await page.getByRole("button", { name: "Choose Google account" }).click();
    const section = page.getByRole("region", { name: "Google sign-in", exact: true });
    await expect(section.getByRole("alert")).toContainText(status === 409 ? "Sign up with Google first" : "Google sign-in could not complete");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("body")).not.toContainText(credential);
    expect(requests.filter((request) => request.path.endsWith("complete"))).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  });
}

test.beforeEach(async ({ context }) => { await mockEmptyDevices(context); });
