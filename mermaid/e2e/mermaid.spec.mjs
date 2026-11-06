import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { JSDOM } from "jsdom";
import { audit } from "./audit.mjs";
import { startBackend, WIDGET } from "./backend.mjs";
import { CANARY, CASES } from "./hostile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
const built = readFileSync(process.env.E2E_BUNDLE ?? join(here, "../dist/mermaid", pkg.version, "entry.js"));

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8011);
const BACKEND_HOST = process.env.E2E_BACKEND_HOST ?? "host.docker.internal";
const BACKEND_LISTEN = process.env.E2E_BACKEND_LISTEN ?? "0.0.0.0";
const BACKEND_NAME = "E2E hostile diagrams";
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

let context;
let page;
let backend;
let entityUuid;
let roleUuid;
let dashboardId;
let started;
let served = [];

const iframeSelector = `iframe[title^="${WIDGET}"]`;
const card = () => page.locator("div.group\\/widget").filter({ hasText: WIDGET });

async function call(method, path, data) {
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
}

async function settle(frame) {
  await frame.waitForFunction(
    () => document.querySelector(".mermaid-canvas svg") || document.querySelector(".mermaid-message")?.textContent,
    null,
    { timeout: 45000 },
  );
}

async function frameOf() {
  await expect(page.locator(iframeSelector)).toHaveCount(1, { timeout: 45000 });
  const handle = await page.locator(iframeSelector).elementHandle();
  return handle.contentFrame();
}

async function show(diagram) {
  backend.serve(diagram);
  await page.reload();
  const frame = await frameOf();
  await settle(frame);
  return frame;
}

async function exportAs(label) {
  const target = card();
  await target.hover();
  await target.getByTestId("_navbar-controls-right").getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Export widget" });
  await dialog.getByText(label, { exact: true }).click();
  await dialog.getByLabel("Save as").fill("hostile");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dialog.getByRole("button", { name: "Export" }).click()]);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  started = Date.now();
  backend = await startBackend({ port: BACKEND_PORT, listen: BACKEND_LISTEN });
  const baseURL = testInfo.project.use.baseURL;
  context = await browser.newContext({ baseURL, viewport: testInfo.project.use.viewport });
  await context.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  page = await context.newPage();
  page.on("response", (response) => {
    if (/\/widget-plugins\/mermaid\/.*\/files\/entry\.js/.test(response.url())) served.push(response);
  });
  await page.goto("/login");
  await page.getByPlaceholder("Email address").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await page.goto("/robots.txt");

  const plugin = await call("GET", "/plugins/mermaid");
  expect(plugin.status, "the Mermaid plugin is approved and enabled on this stack (see the README)").toBe("enabled");
  entityUuid = (await call("GET", "/entity/entity")).items[0].uuid;
  roleUuid = crypto.randomUUID();
  await call("POST", "/admin/role", { uuid: roleUuid, name: "E2E Mermaid", description: "E2E Mermaid", users: [EMAIL] });
  await call("PUT", `/admin/role/${roleUuid}/plugin-access`, { grants: [{ plugin_id: "mermaid", widget_id: "*" }] });
  await call("POST", `/entity/data-backends/${entityUuid}`, { name: BACKEND_NAME, url: `http://${BACKEND_HOST}:${BACKEND_PORT}` });
  const backends = await call("GET", `/entity/data-backends/${entityUuid}`);
  const uuid = backends.find((item) => item.name === BACKEND_NAME).uuid;
  await call("PUT", `/admin/role-permissions/${roleUuid}`, [
    { uuid, type: "backend", category: "data-connectors", access: "access", widgets: [{ widgetId: "hostile_diagram", access: "access" }] },
  ]);

  backend.serve("flowchart LR\n  A --> B");
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 15000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop();
  await page.getByRole("button", { name: "Add widgets" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByPlaceholder("Search for widgets").fill(WIDGET);
  await menu.getByText(WIDGET, { exact: true }).first().click();
  await menu.getByRole("button", { name: "Add widgets" }).click();
  await expect(menu).toBeHidden();
});

test.afterAll(async () => {
  try {
    if (page && dashboardId) {
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
    if (page && entityUuid) await call("DELETE", `/entity/data-backends/${entityUuid}/${encodeURIComponent(BACKEND_NAME)}`).catch(() => undefined);
    if (page && roleUuid) await call("DELETE", `/admin/role/${roleUuid}`).catch(() => undefined);
    await context?.close();
    backend?.server.close();
  }
});

test("the stack serves the build under test", async () => {
  const frame = await show("flowchart LR\n  A --> B");
  expect(frame).toBeTruthy();
  expect(served.length).toBeGreaterThan(0);
  const body = await served.at(-1).body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(built).digest("hex"));
  await expect(page.locator(iframeSelector)).toHaveAttribute("sandbox", "allow-scripts");
});

for (const hostile of CASES) {
  test(hostile.name, async () => {
    const frame = await show(hostile.diagram);
    const message = (await frame.evaluate(() => document.querySelector(".mermaid-message").textContent)) ?? "";
    const drawn = await frame.evaluate(() => !!document.querySelector(".mermaid-canvas svg"));

    expect(await frame.evaluate(() => window.__pwned ?? null), "script ran in the frame").toBeNull();
    expect(await page.evaluate(() => window.__pwned ?? null), "script ran in the host").toBeNull();

    if (hostile.refused) {
      expect(drawn).toBe(false);
      expect(message).toMatch(hostile.refused);
      expect(message.length).toBeLessThanOrEqual(2100);
    } else if (hostile.settles) {
      expect(drawn || message.length > 0).toBe(true);
    } else if (!hostile.optional) {
      expect(drawn, message).toBe(true);
    }

    if (drawn) {
      const found = await frame.evaluate(`(${audit.toString()})(document.querySelector(".mermaid-canvas"), false)`);
      expect(found, "the drawing in the frame").toEqual([]);
    }

    const violations = await frame.evaluate(() => window.__violations ?? []);
    expect(violations.filter((entry) => entry.includes(CANARY)), "the browser had to block a request to the canary host").toEqual([]);

    if (hostile.links) {
      const urls = await frame.evaluate(() => [...document.querySelectorAll(".mermaid-canvas a")].map((a) => a.getAttribute("href") ?? a.getAttribute("xlink:href")));
      const opened = [];
      for (const [index] of urls.entries()) {
        await frame.locator(".mermaid-canvas a").nth(index).click({ force: true });
        const dialog = page.getByRole("dialog").filter({ hasText: "Opening External Link" });
        if (await dialog.isVisible().catch(() => false)) {
          opened.push(((await dialog.locator(".ws-hyper-link").first().textContent()) ?? "").trim());
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await expect(dialog).toBeHidden();
        } else {
          await page.waitForTimeout(500);
          if (await dialog.isVisible().catch(() => false)) {
            opened.push(((await dialog.locator(".ws-hyper-link").first().textContent()) ?? "").trim());
            await dialog.getByRole("button", { name: "Cancel" }).click();
          }
        }
      }
      expect(opened.sort()).toEqual([...hostile.links].sort());
    }

    if (drawn) {
      const svg = await exportAs("Diagram (SVG)");
      const doc = new JSDOM(svg.bytes.toString("utf8"), { contentType: "image/svg+xml" }).window.document;
      expect(audit(doc.documentElement.parentNode, true), "the exported SVG").toEqual([]);
      const png = await exportAs("Diagram (PNG)");
      expect(png.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.bytes.length).toBeGreaterThan(1000);
    }
  });
}

test("a drag that starts on a link pans the diagram and opens nothing, and a click on it still opens", async () => {
  const frame = await show('flowchart LR\n  A --> B\n  click A "https://example.com/docs"');
  const transform = () => frame.evaluate(() => document.querySelector(".mermaid-canvas").style.transform);
  const link = frame.locator(".mermaid-canvas a").first();
  const box = await link.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const before = await transform();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 30, { steps: 6 });
  await page.mouse.up();
  const dialog = page.getByRole("dialog").filter({ hasText: "Opening External Link" });
  await page.waitForTimeout(500);
  await expect(dialog).toBeHidden();
  expect(await transform()).not.toBe(before);
  await page.mouse.dblclick(box.x + box.width + 300, box.y + box.height + 120);
  await expect.poll(transform).toBe(before);
  await link.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ws-hyper-link").first()).toHaveText("https://example.com/docs");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a plain wheel scrolls the dashboard and Ctrl with the wheel zooms", async () => {
  const frame = await show("flowchart LR\n  A --> B");
  const transform = () => frame.evaluate(() => document.querySelector(".mermaid-canvas").style.transform);
  const before = await transform();
  const box = await page.locator(iframeSelector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  expect(await transform()).toBe(before);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(transform).not.toBe(before);
});

test("the host's policy report names nothing the hostile diagrams asked for", async () => {
  const reports = await call("GET", "/plugins/mermaid/csp-reports");
  const since = started - 2000;
  const hits = reports.filter((report) => Date.parse(report.last_seen) >= since && `${report.directive} ${report.origin}`.includes(CANARY));
  expect(hits).toEqual([]);
});
