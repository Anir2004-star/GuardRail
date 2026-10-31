import { test, expect, type Page, type Route } from "@playwright/test";

const apiPattern = "**/api/v1/auth/register";
const samplePassword = "  My strong Passphrase!42  ";
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3100",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function fillSignup(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill(" Frontend ");
  await page.getByLabel("Middle name (optional)").fill(" Demo ");
  await page.getByLabel("Last name", { exact: true }).fill(" User ");
  await page.getByLabel("Email address").fill(" Signup+Example@Example.ORG ");
  await page.getByLabel("Password", { exact: true }).fill(samplePassword);
  await page.getByLabel("Confirm password").fill(samplePassword);
  await page.getByRole("checkbox").check();
}

async function mockSignup(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route(apiPattern, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    await handler(route);
  });
}

test("signup sends only registration fields, shows pending/success and never saves credentials", async ({ page }) => {
  let postCount = 0;
  let postedBody: unknown;
  let postedHeaders: Record<string, string> = {};
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { arrived = resolve; });
  await mockSignup(page, async (route) => {
    postCount++;
    postedBody = route.request().postDataJSON();
    postedHeaders = route.request().headers();
    arrived();
    await gate;
    await route.fulfill({ status: 201, headers: corsHeaders, json: { user: { id: "registration-test-id", email: "signup+example@example.org" } } });
  });
  await fillSignup(page);
  const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await entered;
  try {
    await expect(page.getByRole("button", { name: "Please wait...", exact: true })).toBeDisabled();
    expect(postCount).toBe(1);
    expect(postedBody).toEqual({ firstName: "Frontend", middleName: "Demo", lastName: "User", email: "signup+example@example.org", password: samplePassword });
    expect(postedHeaders.authorization).toBeUndefined();
    expect(postedHeaders.cookie).toBeUndefined();
  } finally {
    release();
  }
  await expect(page.getByRole("status")).toContainText("Account created. Please sign in.");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("button", { name: "Account created", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm password")).toHaveValue("");
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore);
  expect(postCount).toBe(1);
  await page.getByRole("link", { name: "Go to sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Explore the demo. Real sign-in is not connected yet.")).toBeVisible();
});

test("signup maps backend validation errors to fields and supports correcting them", async ({ page }) => {
  let attempt = 0;
  await mockSignup(page, async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 400, headers: corsHeaders, json: { error: { code: "VALIDATION_ERROR", fields: { firstName: ["Check your first name."], email: ["Check your email address."] } } } });
    } else {
      await route.fulfill({ status: 201, headers: corsHeaders, json: { user: { id: "corrected-user" } } });
    }
  });
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("#first-name-error")).toHaveText("Check your first name.");
  await expect(page.locator("#email-error")).toHaveText("Check your email address.");
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account created. Please sign in.");
});

test("signup shows a duplicate-email error without navigating or revealing server details", async ({ page }) => {
  await mockSignup(page, async (route) => {
    await route.fulfill({ status: 409, headers: corsHeaders, json: { error: { message: "PRIVATE_DATABASE_DETAILS" } } });
  });
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("#email-error")).toHaveText("An account with this email already exists.");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText("PRIVATE_DATABASE_DETAILS")).toHaveCount(0);
});

for (const [status, message] of [
  [403, "Signup is unavailable from this website address."],
  [429, "Too many signup attempts. Please try again later."],
  [500, "We couldn't create your account. Please try again later."],
] as const) {
  test(`signup handles HTTP ${status} and allows a later retry`, async ({ page }) => {
    await mockSignup(page, async (route) => {
      await route.fulfill({ status, headers: corsHeaders, json: { error: { message: "PRIVATE_SERVER_DETAILS" } } });
    });
    await fillSignup(page);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(message);
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();
    await expect(page.getByText("PRIVATE_SERVER_DETAILS")).toHaveCount(0);
  });
}

test("signup handles an unreachable backend without saving passwords", async ({ page }) => {
  await mockSignup(page, async (route) => { await route.abort("connectionrefused"); });
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Could not reach the signup service. Check your connection and try again.");
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(samplePassword);
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();
});

test("signup rejects an unexpected success payload instead of displaying a false confirmation", async ({ page }) => {
  await mockSignup(page, async (route) => { await route.fulfill({ status: 201, headers: corsHeaders, json: {} }); });
  await fillSignup(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("The signup service returned an unexpected response. Please try again later.");
  await expect(page.getByRole("status")).toHaveCount(0);
});
