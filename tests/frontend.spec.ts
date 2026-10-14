import { test, expect } from "@playwright/test";

test("all sidebar pages navigate and mark the active link", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/dashboard");
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  for (const name of ["Search", "Organize", "Protected items", "Assistant", "Recommendations", "Connections", "Devices", "Scan & sync", "Activity", "Restore", "Notifications", "Settings", "Help", "Dashboard"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main h1")).toBeVisible();
  }
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/is-collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".chart-wrap svg path").first()).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-dashboard.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("item approval requires selection and confirmation, then execution can be restored", async ({ page }) => {
  await page.goto("/app/proposals/newsletters");
  const approve = page.getByRole("button", { name: /Approve .* selected item/ });
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox").nth(0).check();
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: /I reviewed/ }).check();
  await approve.click();
  await expect(page.getByRole("dialog", { name: "Confirm exact selected items" })).toContainText("Weekly shopping offers");
  await page.getByRole("button", { name: "Confirm demo approval" }).click();
  await expect(page).toHaveURL(/\/app\/execution\//);
  await page.getByRole("button", { name: "Execute approved demo action" }).click();
  await expect(page.getByRole("heading", { name: "Demo execution completed" })).toBeVisible();
  await page.getByRole("link", { name: "Restore items", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Weekly shopping offers" });
  await row.getByRole("button", { name: "Restore sample" }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/app/search");
  await expect(page.getByRole("button", { name: /Weekly shopping offers/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Weekly shopping offers/ })).toBeVisible();
});

test("protection excludes an item and disconnection blocks an existing approval", async ({ page }) => {
  await page.goto("/app/search");
  await page.getByRole("row").filter({ hasText: "Weekly shopping offers" }).getByRole("button", { name: "Protect", exact: true }).click();
  await page.goto("/app/proposals/newsletters");
  await expect(page.getByRole("checkbox").nth(0)).toBeDisabled();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("checkbox", { name: /I reviewed/ }).check();
  await page.getByRole("button", { name: /Approve 1/ }).click();
  await page.getByRole("button", { name: "Confirm demo approval" }).click();
  await expect(page).toHaveURL(/\/app\/execution\//);
  const execution = page.url();
  await page.goto("/app/connections");
  await page.locator(".connection-card").filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) }).getByRole("button", { name: "Disconnect demo" }).click();
  await page.goto(execution);
  await page.getByRole("button", { name: "Execute approved demo action" }).click();
  await expect(page.getByRole("status")).toContainText("disconnected");
  await expect(page.getByRole("heading", { name: "Approved and ready" })).toBeVisible();
});

test("search filters, preview, organization, settings, and notifications persist", async ({ page }) => {
  await page.goto("/app/search");
  await page.getByRole("textbox", { name: "Search content" }).fill("Portfolio");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: /Portfolio-final/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/app/organize");
  await page.getByRole("checkbox", { name: "Select Portfolio-final.pdf" }).check();
  await page.getByRole("textbox", { name: "Destination folder or label" }).fill("Applications");
  await page.getByRole("button", { name: "Move selected" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Portfolio-final.pdf" })).toContainText("Applications");
  await page.goto("/app/settings/general");
  await page.getByLabel("Display name", { exact: true }).fill("Demo Tester");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Demo Tester");
  await page.goto("/app/notifications");
  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.getByRole("checkbox", { name: "Unread only" }).check();
  await expect(page.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
});

test("demo scan is cancellable and assistant links to recommendations", async ({ page }) => {
  await page.goto("/app/scan");
  await page.getByRole("button", { name: "Start demo scan" }).click();
  await page.getByRole("button", { name: "Cancel scan" }).click();
  await expect(page.getByRole("button", { name: "Start demo scan" })).toBeEnabled();
  await page.getByRole("button", { name: "Start demo scan" }).click();
  await expect(page.getByRole("status")).toContainText("Demo scan completed");
  await page.goto("/app/assistant");
  await page.getByRole("button", { name: "Find duplicate Google Drive files. Keep the original files in my Projects folder." }).click();
  await page.getByRole("link", { name: "Open workspace page" }).click();
  await expect(page).toHaveURL(/\/app\/proposals$/);
});

test("signup validates matching passwords and never stores a password", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Display name").fill("Frontend User");
  await page.getByLabel("Email address").fill("demo@example.com");
  await page.getByLabel("Password", { exact: true }).fill("example-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create demo workspace" }).click();
  await expect(page.getByText("Passwords must match.")).toBeVisible();
  await page.getByLabel("Confirm password").fill("example-password");
  await page.getByRole("button", { name: "Create demo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Frontend User." })).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem("guardrail-frontend-demo-v1"));
  expect(saved).not.toContain("example-password");
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("demo@example.com");
  await page.getByRole("button", { name: "Preview reset request" }).click();
  await expect(page.getByRole("status")).toContainText("No email was sent");
});

test("mobile navigation and pages fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.locator(".app-sidebar")).not.toHaveClass(/open/);
  for (const route of ["/", "/login", "/signup", "/features", "/privacy", "/app/dashboard", "/app/search", "/app/proposals", "/app/proposals/newsletters", "/app/connections", "/app/devices", "/app/assistant", "/app/settings/storage"]) {
    await page.goto(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true);
  }
  await page.screenshot({ path: "test-results/mobile-settings.png", fullPage: true });
});

test("Gmail and Drive filters match the scope and cloud usage includes mock Trash", async ({ page }) => {
  await page.goto("/app/search");
  await expect(page.getByRole("combobox", { name: "Provider filter" }).locator("option")).toHaveText(["All providers", "Gmail", "Google Drive"]);
  await page.getByRole("combobox", { name: "Provider filter" }).selectOption("Gmail");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Provider filter" }).selectOption("Google Drive");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await expect(page.getByRole("button", { name: /Project-diagram.png/ })).toBeVisible();
  await page.goto("/app/dashboard");
  await expect(page.locator(".storage-legend")).toContainText("17 MB");
  await expect(page.locator(".storage-legend")).toContainText("5.039 GB");
  await expect(page.locator(".chart-center")).toContainText("5.056 GB");
  await page.goto("/app/connections");
  await expect(page.locator(".connection-card")).toHaveCount(2);
});

test("device pairing, details, cleanup, rename, disconnect, and reset stay simulated", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && message.text().toLowerCase().includes("hydration")) hydrationErrors.push(message.text()); });
  await page.goto("/app/devices");
  await expect(page.getByText("Last updated 11 Oct 2026, 9:30 AM").first()).toBeVisible();
  await page.getByRole("button", { name: "Add device", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a demo device" });
  await dialog.getByRole("button", { name: /Smartphone/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toContainText("companion app is not available yet");
  await dialog.getByRole("button", { name: "Try demo pairing" }).click();
  await dialog.getByLabel("Device pairing code").fill("123456");
  await dialog.getByRole("button", { name: "Verify code" }).click();
  await expect(dialog.getByRole("alert")).toContainText("does not match");
  const code = (await dialog.locator(".companion-sample > div").textContent())!.trim();
  await dialog.getByLabel("Device pairing code").fill(code);
  await dialog.getByRole("button", { name: "Verify code" }).click();
  await expect(dialog).toContainText("Connect this device to your account?");
  await dialog.getByRole("button", { name: "Confirm connection" }).click();
  await dialog.getByRole("link", { name: "View device" }).click();
  await expect(page.getByRole("heading", { name: "Anirban’s phone" })).toBeVisible();
  await page.getByRole("checkbox", { name: /course-assets/ }).check();
  await page.getByRole("button", { name: "Review selected items" }).click();
  const cleanup = page.getByRole("dialog", { name: "Review selected demo cleanup files" });
  await expect(cleanup).toContainText("course-assets.zip");
  await cleanup.getByRole("button", { name: "Confirm simulated cleanup" }).click();
  await expect(page.getByRole("status")).toContainText("Used storage was not reduced");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("dialog", { name: "Rename demo device" }).getByLabel("Device name").fill("Renamed phone");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Renamed phone" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Renamed phone" })).toBeVisible();
  for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  expect(hydrationErrors).toEqual([]);
  await page.screenshot({ path: "test-results/device-dashboard.png", fullPage: true });
});

test("sender protection excludes cleanup candidates and appearance is saved", async ({ page }) => {
  await page.goto("/app/settings/preferences");
  await page.getByLabel("Protected Gmail senders (comma separated)").fill("offers@example.com");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.goto("/app/proposals/newsletters");
  await expect(page.getByRole("checkbox").nth(0)).toBeDisabled();
  await expect(page.getByRole("checkbox").nth(1)).toBeDisabled();
  await expect(page.getByRole("checkbox").nth(2)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Approve/ })).toBeDisabled();
  await page.goto("/app/settings/appearance");
  await page.getByLabel("Workspace appearance").selectOption("charcoal");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", "charcoal");
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-appearance", "charcoal");
  await page.screenshot({ path: "test-results/charcoal-settings.png", fullPage: true });
});
