import { expect } from "@playwright/test";
import { BACKEND_NAME, WIDGETS, startBackend } from "./backend.mjs";

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8041);
export const BACKEND_HOST = process.env.E2E_BACKEND_HOST ?? "host.docker.internal";
export const BACKEND_LISTEN = process.env.E2E_BACKEND_LISTEN ?? "0.0.0.0";
export const EMAIL = process.env.E2E_USER_EMAIL;
export const PASSWORD = process.env.E2E_USER_PASSWORD;
export const PLUGIN = "map-widget";

export async function closeAgent(page) {
  const agent = page.getByRole("button", { name: "Close Agent" });
  await agent.waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
  if (await agent.isVisible().catch(() => false)) await agent.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(600);
}

export async function closeToasts(page) {
  for (const toast of await page.getByRole("button", { name: "Close toast" }).all()) await toast.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

export const frameSelector = (name) => `iframe[title="${name} (Map)"]`;

export async function prepare({ browser, project, widgets }) {
  const started = Date.now();
  const backend = await startBackend({ port: BACKEND_PORT, listen: BACKEND_LISTEN });
  const context = await browser.newContext({ baseURL: project.use.baseURL, viewport: project.use.viewport });
  await context.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const served = [];
  page.on("response", (response) => {
    if (new RegExp(`/widget-plugins/${PLUGIN}/.*/files/entry\\.js`).test(response.url())) served.push(response);
  });
  await page.goto("/login");
  await page.getByPlaceholder("Email address").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await page.goto("/robots.txt");

  const call = async (method, path, data) => {
    const url = new URL(path, API_URL).toString();
    const answer = await page.evaluate(
      async (request) => {
        const response = await fetch(request.url, {
          method: request.method,
          credentials: "include",
          headers: { "X-Workspace-Client": "web", ...(request.body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: request.body,
        });
        return { status: response.status, text: await response.text() };
      },
      { url, method, body: data === undefined ? undefined : JSON.stringify(data) },
    );
    expect(answer.status, `${method} ${path}: ${answer.text}`).toBeLessThan(300);
    return answer.text ? JSON.parse(answer.text) : null;
  };

  const plugin = await call("GET", `/plugins/${PLUGIN}`);
  expect(plugin.status, "the Map plugin is approved and enabled on this stack (see the README)").toBe("enabled");
  const entityUuid = (await call("GET", "/entity/entity")).items[0].uuid;
  const roleUuid = crypto.randomUUID();
  await call("POST", "/admin/role", { uuid: roleUuid, name: "E2E Map", description: "E2E Map", users: [EMAIL] });
  await call("PUT", `/admin/role/${roleUuid}/plugin-access`, { grants: [{ plugin_id: PLUGIN, widget_id: "*" }] });
  await call("POST", `/entity/data-backends/${entityUuid}`, { name: BACKEND_NAME, url: `http://${BACKEND_HOST}:${BACKEND_PORT}` });
  const backends = await call("GET", `/entity/data-backends/${entityUuid}`);
  const uuid = backends.find((item) => item.name === BACKEND_NAME).uuid;
  await call("PUT", `/admin/role-permissions/${roleUuid}`, [
    { uuid, type: "backend", category: "data-connectors", access: "access", widgets: Object.keys(WIDGETS).map((widgetId) => ({ widgetId, access: "access" })) },
  ]);

  await page.goto("/app");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 15000 });
  const dashboardId = new URL(page.url()).pathname.split("/").pop();
  await closeAgent(page);
  for (const id of widgets) {
    const toolbar = page.getByTestId("dashboard-toolbar-add-widget-button");
    if (await toolbar.count()) await toolbar.click();
    else await page.getByRole("button", { name: "Add widgets" }).click();
    const menu = page.getByRole("dialog");
    await menu.getByPlaceholder("Search for widgets").fill(WIDGETS[id].name);
    await menu.getByText(WIDGETS[id].name, { exact: true }).first().click();
    await menu.getByRole("button", { name: "Add widgets" }).click();
    await expect(menu).toBeHidden();
  }

  const teardown = async () => {
    try {
      if (dashboardId) {
        await page.keyboard.press("Escape");
        const tab = page.locator(`#tab-${dashboardId}`);
        await tab.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Delete" }).click();
        const confirm = page.getByRole("button", { name: "Yes, delete" });
        await expect(async () => {
          if (await confirm.isVisible()) await confirm.click();
          await expect(tab).toHaveCount(0, { timeout: 500 });
        }).toPass({ timeout: 10000 });
      }
    } finally {
      await call("DELETE", `/entity/data-backends/${entityUuid}/${encodeURIComponent(BACKEND_NAME)}`).catch(() => undefined);
      await call("DELETE", `/admin/role/${roleUuid}`).catch(() => undefined);
      await context.close();
      backend.server.close();
    }
  };

  return { page, call, backend, started, served, dashboardId, entityUuid, roleUuid, teardown };
}

export async function frameOf(page, name) {
  const card = page.locator(frameSelector(name));
  let scrolled = false;
  await expect(async () => {
    if ((await card.count()) === 1) return;
    await page.mouse.move(278, 500);
    await page.mouse.wheel(0, scrolled ? 600 : -20000);
    scrolled = true;
    throw new Error("the card is not on the page yet");
  }).toPass({ timeout: 90000, intervals: [250, 400] });
  await card.scrollIntoViewIfNeeded();
  const handle = await card.elementHandle();
  return handle.contentFrame();
}

export async function drawn(page, name) {
  const frame = await frameOf(page, name);
  await frame.waitForSelector("canvas.maplibregl-canvas", { timeout: 60000 });
  await frame.waitForSelector('[role="toolbar"][aria-label="Map view"]', { timeout: 60000 });
  return frame;
}

export const cardOf = (page, name) =>
  page
    .locator(frameSelector(name))
    .locator(`xpath=ancestor::*[.//p[normalize-space()="${name}"] and .//iframe[@title="${name} (Map)"]][1]`);

export async function hoverHeader(page, name) {
  const box = await page.locator(frameSelector(name)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y - 20);
  await page.waitForTimeout(400);
}

export async function pluginAction(page, name, id) {
  await hoverHeader(page, name);
  return cardOf(page, name).locator(`[data-plugin-action="${id}"]`);
}

export async function pickFromMenu(page, name, label) {
  await hoverHeader(page, name);
  await cardOf(page, name).getByTestId("_navbar-controls-right").getByRole("button").last().click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

export async function viewOf(page, name) {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await pickFromMenu(page, name, "Copy view");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 }).toMatch(/^-?[\d.]+, -?[\d.]+, zoom [\d.]+$/);
  const [latitude, longitude, zoom] = (await page.evaluate(() => navigator.clipboard.readText())).match(/-?[\d.]+/g).map(Number);
  await closeToasts(page);
  return { latitude, longitude, zoom };
}
