import { test, expect, type BrowserContext, type Route } from "@playwright/test";

const token = "A".repeat(43);
const message = "If an account needs verification, a verification link will be sent.";
const cors = { "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Credentials": "true" };
async function api(context: BrowserContext, routeName: string, handler: (route: Route) => Promise<void>) {
  await context.route(`**/api/v1/auth/${routeName}`, async (route) => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
    await handler(route);
  });
}
async function signup(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill("Email");
  await page.getByLabel("Last name", { exact: true }).fill("Verification");
  await page.getByLabel("Email address", { exact: true }).fill(" Person@Example.ORG ");
  await page.getByLabel("Password", { exact: true }).fill("Signup Password!42");
  await page.getByLabel("Confirm password", { exact: true }).fill("Signup Password!42");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}
for (const queued of [true, false]) {
  test(`signup acknowledges account creation with verification email queued=${queued} and supports resend without another registration`, async ({ page, context }) => {
    let registrations = 0;
    await api(context, "register", async (route) => { registrations++; await route.fulfill({ status: 201, headers: cors, json: { user: { id: "test-account" }, emailVerificationRequired: true, verificationEmailQueued: queued } }); });
    await api(context, "resend-verification", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ email: "person@example.org" });
      expect((await route.request().allHeaders()).cookie).toBeUndefined();
      await route.fulfill({ status: 202, headers: cors, json: { message } });
    });
    await signup(page);
    await expect(page.locator(".auth-box").getByRole("status")).toContainText(queued ? "verify your address before signing in" : "could not be queued");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Resend verification email", exact: true }).click();
    await expect(page.getByRole("form", { name: "Resend email verification" }).getByRole("status")).toHaveText(message);
    expect(registrations).toBe(1);
    await expect(page).toHaveURL(/\/signup$/);
  });
}
test("unverified login clears the password and offers resend for the submitted email without creating a session", async ({ page, context }) => {
  await api(context, "login", (route) => route.fulfill({ status: 403, headers: cors, json: { error: { code: "EMAIL_NOT_VERIFIED", message: "PRIVATE_SERVER_DETAIL" } } }));
  await api(context, "resend-verification", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: "person@example.org" });
    await route.fulfill({ status: 202, headers: cors, json: { message } });
  });
  await page.goto("/login");
  await page.getByLabel("Email address").fill(" Person@Example.ORG ");
  await page.getByLabel("Password", { exact: true }).fill("Existing Password!42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".auth-box").getByRole("alert")).toHaveText("Verify your email before signing in.");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("PRIVATE_SERVER_DETAIL");
  await page.getByRole("button", { name: "Resend verification email", exact: true }).click();
  await expect(page.getByRole("form", { name: "Resend email verification" }).getByRole("status")).toHaveText(message);
  await expect(page).toHaveURL(/\/login$/);
});
test("verification strips the secret URL, waits for manual confirmation, omits cookies and requires separate sign-in", async ({ page, context }) => {
  await context.addCookies([{ name: "guardrail_refresh", value: "existing-private-cookie", domain: "localhost", path: "/api/v1/auth", httpOnly: true }]);
  let posts = 0;
  await api(context, "verify-email", async (route) => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ token });
    expect((await route.request().allHeaders()).cookie).toBeUndefined();
    expect((await route.request().allHeaders()).referer).toBeUndefined();
    await route.fulfill({ status: 204, headers: cors });
  });
  await page.goto(`/verify-email#token=${token}`);
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(token);
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await expect(page.locator("body")).not.toContainText(token);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator(".auth-box").getByRole("status")).toHaveText("Your email address is confirmed. You can now sign in to your workspace.");
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(posts).toBe(1);
  expect((await context.cookies()).find((cookie) => cookie.name === "guardrail_refresh")?.value).toBe("existing-private-cookie");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
});
for (const fragment of ["", "#token=invalid", `#token=${token}&token=${token}`]) {
  test(`invalid verification fragment ${fragment.slice(0, 20)} cannot submit and offers resend`, async ({ page, context }) => {
    let posts = 0;
    await api(context, "verify-email", async (route) => { posts++; await route.fulfill({ status: 204, headers: cors }); });
    await page.goto(`/verify-email${fragment}`);
    await expect(page.locator(".auth-box").getByRole("alert")).toContainText("Verification link is invalid or expired");
    await expect(page.getByRole("button", { name: "Verify email", exact: true })).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Resend email verification" })).toBeVisible();
    expect(posts).toBe(0);
  });
}
test("expired or reused verification links remove the confirm action and offer a new link", async ({ page, context }) => {
  await api(context, "verify-email", (route) => route.fulfill({ status: 400, headers: cors, json: { error: "PRIVATE_TOKEN_DETAIL" } }));
  await page.goto(`/verify-email#token=${token}`);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator(".auth-box").getByRole("alert")).toContainText("Verification link is invalid or expired");
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
});
test("lost verification response is reported honestly without automatic retry", async ({ page, context }) => {
  let posts = 0;
  await api(context, "verify-email", async (route) => { posts++; await route.abort("failed"); });
  await page.goto(`/verify-email#token=${token}`);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.locator(".auth-box").getByRole("alert")).toHaveText("Could not confirm email verification. Try signing in, or request a new link.");
  expect(posts).toBe(1);
  await expect(page.getByText("Your email address is confirmed. You can now sign in to your workspace.")).toHaveCount(0);
});
for (const [status, expected] of [[403, "Email verification is unavailable from this website address."], [429, "Too many email verification attempts. Please try again later."], [503, "Email verification is temporarily unavailable. Please try again later."]] as const) {
  test(`resend ${status} shows a safe retryable error`, async ({ page, context }) => {
    await api(context, "resend-verification", (route) => route.fulfill({ status, headers: cors, json: { error: "PRIVATE_DETAIL" } }));
    await page.goto("/verify-email");
    await page.getByLabel("Email address").fill("person@example.org");
    await page.getByRole("button", { name: "Resend verification email" }).click();
    await expect(page.getByRole("form", { name: "Resend email verification" }).getByRole("alert")).toHaveText(expected);
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeEnabled();
  });
}
