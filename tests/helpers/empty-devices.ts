import type { BrowserContext } from "@playwright/test";

// Authentication tests isolate their concern from the real device API. Demo
// tests do not use it; signed-in fixtures start with no registered devices.
export async function mockEmptyDevices(context: BrowserContext) {
  await context.route("**/api/v1/devices", (route) => route.fulfill({
    status: route.request().method() === "OPTIONS" ? 204 : route.request().method() === "GET" ? 200 : 400,
    headers: { "Access-Control-Allow-Origin": "http://localhost:3100", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" },
    ...(route.request().method() === "OPTIONS" ? {} : { json: { devices: [] } }),
  }));
}
