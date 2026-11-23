import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startBackend, WIDGETS } from "./backend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, "../screenshots");

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8012);
const BACKEND_HOST = process.env.E2E_BACKEND_HOST ?? "host.docker.internal";
const BACKEND_LISTEN = process.env.E2E_BACKEND_LISTEN ?? "0.0.0.0";
const BACKEND_NAME = "React Flow examples";
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;
const DASHBOARD_ID = process.env.E2E_DASHBOARD_ID;

const ORDER = WIDGETS.reactflow_order_flow.name;
const PIPELINE = WIDGETS.reactflow_release_pipeline.name;
const ESCALATION = WIDGETS.reactflow_escalation.name;
const ALL = [ORDER, PIPELINE, ESCALATION];

test.describe.configure({ mode: "serial" });
test.skip(
  !(EMAIL && PASSWORD && DASHBOARD_ID),
  "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test, and E2E_DASHBOARD_ID an empty dashboard of theirs to draw on",
);

let context;
let page;
let backend;
let entityUuid;
let roleUuid;

const frameEl = (name) => page.locator(`iframe[title^="${name}"]`).first();
const card = (name) =>
  frameEl(name).locator(`xpath=ancestor::*[.//p[normalize-space()="${name}"] and .//iframe[starts-with(@title,"${name}")]][1]`);
const title = (name) => card(name).locator("p").filter({ hasText: new RegExp(`^${name}$`) }).first();
const addNode = (name) => card(name).locator('[data-plugin-action="add-node"]');
const frameOf = async (name) => (await frameEl(name).elementHandle()).contentFrame();

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

async function drawn(name) {
  await expect(frameEl(name)).toBeVisible({ timeout: 45000 });
  await frameEl(name).scrollIntoViewIfNeeded();
  const frame = await frameOf(name);
  await frame.waitForFunction(() => document.querySelectorAll(".flow-node").length > 0, null, { timeout: 45000 });
  await page.waitForTimeout(600);
  return frame;
}

async function closeAgent() {
  const agent = page.getByRole("button", { name: "Close Agent" });
  await agent.waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
  if (await agent.isVisible().catch(() => false)) await agent.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(600);
}

async function openDashboard() {
  await page.goto(`/app/${DASHBOARD_ID}`);
  await closeAgent();
}

async function hoverCard(name) {
  await frameEl(name).scrollIntoViewIfNeeded();
  const box = await card(name).boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + 22);
  await page.mouse.move(box.x + box.width * 0.56, box.y + 24);
  await page.waitForTimeout(700);
}

const menuButton = (name) => card(name).getByTestId("_navbar-controls-right").getByRole("button").last();

async function revert(name) {
  await hoverCard(name);
  await menuButton(name).click();
  await page.getByRole("menuitem", { name: "Revert to source" }).click();
  await page.waitForTimeout(1500);
}

async function pointAt(locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function shoot(name, locator) {
  await (locator ?? page).screenshot({ path: join(SHOTS, `${name}.png`), animations: "allow", caret: "hide", timeout: 20000 });
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  backend = await startBackend({ port: BACKEND_PORT, listen: BACKEND_LISTEN });
  context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
  });
  page = await context.newPage();

  await page.goto("/login");
  await page.getByPlaceholder("Email address").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await page.goto("/robots.txt");

  await page.keyboard.press("Escape");

  const plugin = await call("GET", "/plugins/react-flow");
  expect(plugin.status, "the React Flow plugin is approved and enabled on this stack (see the README)").toBe("enabled");
  entityUuid = (await call("GET", "/entity/entity")).items[0].uuid;
  roleUuid = crypto.randomUUID();
  const roleName = `${BACKEND_NAME} ${roleUuid.slice(0, 8)}`;
  await call("POST", "/admin/role", { uuid: roleUuid, name: roleName, description: BACKEND_NAME, users: [EMAIL] });
  await call("PUT", `/admin/role/${roleUuid}/plugin-access`, { grants: [{ plugin_id: "react-flow", widget_id: "*" }] });
  let backends = await call("GET", `/entity/data-backends/${entityUuid}`);
  if (!backends.some((item) => item.name === BACKEND_NAME)) {
    await call("POST", `/entity/data-backends/${entityUuid}`, { name: BACKEND_NAME, url: `http://${BACKEND_HOST}:${BACKEND_PORT}` });
    backends = await call("GET", `/entity/data-backends/${entityUuid}`);
  }
  const uuid = backends.find((item) => item.name === BACKEND_NAME).uuid;
  await call("PUT", `/admin/role-permissions/${roleUuid}`, [
    {
      uuid,
      type: "backend",
      category: "data-connectors",
      access: "access",
      widgets: Object.keys(WIDGETS).map((widgetId) => ({ widgetId, access: "access" })),
    },
  ]);

  await page.goto(`/app/${DASHBOARD_ID}`);
  const agent = page.getByRole("button", { name: "Close Agent" });
  if (await agent.isVisible().catch(() => false)) await agent.click();

  const anyTitle = page.locator("p").filter({ hasText: new RegExp(`^(${ALL.join("|")})$`) }).first();
  const emptyState = page.getByRole("button", { name: "Add widgets" }).first();
  await expect(anyTitle.or(emptyState)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);

  const missing = [];
  const onDashboard = async (name) =>
    (await page.locator("p").filter({ hasText: new RegExp(`^${name}$`) }).count()) > 0;
  for (const name of ALL) if (!(await onDashboard(name))) missing.push(name);
  if (missing.length) {
    const toolbar = page.getByTestId("dashboard-toolbar-add-widget-button");
    const empty = page.getByRole("button", { name: "Add widgets" }).first();
    await (await toolbar.isVisible().catch(() => false) ? toolbar : empty).click();
    const menu = page.getByRole("dialog");
    for (const name of missing) {
      await menu.getByPlaceholder("Search for widgets").fill(name);
      await expect(menu.getByText(name, { exact: true }).first()).toBeVisible();
      await menu.getByText(name, { exact: true }).first().click();
      await menu.getByPlaceholder("Search for widgets").fill("");
    }
    await menu.getByRole("button", { name: "Add widgets" }).click();
    await expect(menu).toBeHidden();
    await page.waitForTimeout(5000);
    await page.reload();
    for (const name of ALL)
      await expect(page.locator("p").filter({ hasText: new RegExp(`^${name}$`) }).first()).toBeVisible({ timeout: 30000 });
  }
});

test.afterAll(async () => {
  try {
    if (page && roleUuid) await call("DELETE", `/admin/role/${roleUuid}`).catch(() => undefined);
  } finally {
    await context?.close();
    backend?.server.close();
  }
});

async function margins(frame) {
  return frame.evaluate(() => {
    const stage = document.querySelector(".flow-stage").getBoundingClientRect();
    const boxes = [...document.querySelectorAll(".react-flow__node")].map((node) => node.getBoundingClientRect());
    return {
      horizontal: Math.abs(Math.min(...boxes.map((box) => box.left)) - stage.left - (stage.right - Math.max(...boxes.map((box) => box.right)))),
      vertical: Math.abs(Math.min(...boxes.map((box) => box.top)) - stage.top - (stage.bottom - Math.max(...boxes.map((box) => box.bottom)))),
    };
  });
}

test("two diagrams on a dashboard", async () => {
  await openDashboard();
  await drawn(ORDER);
  await revert(ORDER);
  await drawn(ORDER);
  await drawn(PIPELINE);
  await drawn(ESCALATION);
  for (const name of ALL) {
    const frame = await frameOf(name);
    await expect.poll(async () => Object.values(await margins(frame)).every((gap) => gap <= 8), { timeout: 8000, message: `${name} is centred in its card` }).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
  await shoot("01-dashboard");
});

test("the card's Add node button", async () => {
  await openDashboard();
  await drawn(ORDER);
  await hoverCard(ORDER);
  await expect(addNode(ORDER)).toBeVisible({ timeout: 10000 });
  await pointAt(addNode(ORDER));
  await page.waitForTimeout(1200);
  await shoot("02-add-node-button", card(ORDER));
});

test("Add node puts a box in the middle of the view", async () => {
  await openDashboard();
  const frame = await drawn(ORDER);
  const before = await frame.evaluate(() => document.querySelectorAll(".flow-node").length);
  await hoverCard(ORDER);
  await addNode(ORDER).click();
  await frame.waitForFunction((count) => document.querySelectorAll(".flow-node").length > count, before, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shoot("03-add-node-result", card(ORDER));
});

const nodeBar = (frame) => frame.locator('[data-flow-bar="node"]');
const edgeBar = (frame) => frame.locator('[data-flow-bar="edge"]');

async function typeInto(bar, label, text) {
  const field = bar.getByLabel(label, { exact: true });
  await field.fill(text);
  await field.press("Enter");
}

test("the selection bar styles the new box", async () => {
  await openDashboard();
  const frame = await drawn(ORDER);
  await frame.locator(".flow-node").filter({ hasText: "New step" }).click();
  const bar = nodeBar(frame);
  await expect(bar).toBeVisible();

  await typeInto(bar, "Label", "Quality check");
  await typeInto(bar, "Note", "Reviewer sign-off");
  await bar.locator('[data-flow-shape="diamond"]').click();
  await bar.locator('[data-flow-accent="warning"]').click();
  await bar.locator('[data-flow-kind="default"]').click();

  const styled = frame.locator(".flow-node.flow-shape-diamond.flow-accent-warning").filter({ hasText: "Quality check" });
  await expect(styled).toBeVisible();
  await expect(styled).toContainText("Reviewer sign-off");
  await page.waitForTimeout(1500);
  await shoot("04-node-style-bar", card(ORDER));

  await openDashboard();
  const reloaded = await drawn(ORDER);
  await expect(
    reloaded.locator(".flow-node.flow-shape-diamond.flow-accent-warning").filter({ hasText: "Quality check" }),
  ).toBeVisible();
});

test("the selection bar styles an arrow", async () => {
  await openDashboard();
  const frame = await drawn(ORDER);
  await frame.locator(".react-flow__edge-textwrapper").filter({ hasText: "clear" }).click();
  const bar = edgeBar(frame);
  await expect(bar).toBeVisible();

  await typeInto(bar, "Label", "all clear");
  await bar.locator('[data-flow-accent="positive"]').click();
  await bar.getByRole("button", { name: "Moving" }).click();
  await expect(frame.locator(".react-flow__edge.animated")).toHaveCount(2);
  await page.waitForTimeout(1500);
  await shoot("05-arrow-style-bar", card(ORDER));

  await openDashboard();
  const reloaded = await drawn(ORDER);
  await expect(reloaded.locator(".react-flow__edge-text").filter({ hasText: "all clear" })).toBeVisible();
});

test("Revert to source in the card's menu", async () => {
  await openDashboard();
  await drawn(ORDER);
  await hoverCard(ORDER);
  await menuButton(ORDER).click();
  const item = page.getByRole("menuitem", { name: "Revert to source" });
  await expect(item).toBeVisible();
  await page.waitForTimeout(400);
  await shoot("06-card-menu", card(ORDER));
  await item.click();
  await drawn(ORDER);
  await page.waitForTimeout(500);
});

test("the same diagrams in light mode", async () => {
  await page.goto("/app/settings");
  await page.getByText("Light mode", { exact: true }).click();
  await page.waitForTimeout(500);
  await page.goto(`/app/${DASHBOARD_ID}`);
  await drawn(ORDER);
  await drawn(PIPELINE);
  await drawn(ESCALATION);
  await shoot("07-dashboard-light");
  await page.goto("/app/settings");
  await page.getByText("Dark mode", { exact: true }).click();
  await page.waitForTimeout(500);
});
