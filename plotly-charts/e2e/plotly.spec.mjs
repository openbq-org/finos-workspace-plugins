import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SALES, WIDGETS } from "./backend.mjs";
import { cardOf, closeAgent, closeCard, closeToasts, drawn, EMAIL, frameOf, frameSelector, PASSWORD, PLUGIN, pickFromMenu, pluginAction, prepare } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
const built = readFileSync(process.env.E2E_BUNDLE ?? join(here, "../dist", PLUGIN, pkg.version, "entry.js"));

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

const SALES_CARD = WIDGETS.e2e_sales.name;
const MODEBAR_CARD = WIDGETS.e2e_modebar.name;
const HUGE_CARD = WIDGETS.e2e_huge.name;
const STATIC_CARD = `${SALES_CARD} (static)`;

let stack;

const legendItems = (frame) => frame.evaluate(() => document.querySelectorAll(".plotly-chart .legend .traces").length);
const modebars = (frame) => frame.evaluate(() => document.querySelectorAll(".plotly-chart .modebar").length);
const hasTable = (frame) => frame.evaluate(() => document.querySelectorAll(".plotly-chart .table").length > 0);
const graph = (frame, read) => frame.evaluate(`(() => { const g = document.querySelector(".plotly-chart"); return (${read.toString()})(g); })()`);
const xRange = (frame) => graph(frame, (g) => g._fullLayout.xaxis.range.map(Number));
const visibility = (frame) => graph(frame, (g) => g.data.map((trace) => trace.visible ?? true));
const settle = (ms = 1500) => stack.page.waitForTimeout(ms);

async function reloaded() {
  await stack.page.reload();
  return drawn(stack.page, SALES_CARD);
}

async function press(id) {
  const button = await pluginAction(stack.page, SALES_CARD, id);
  await button.click();
  return button;
}

async function exportAs(label) {
  const { page } = stack;
  await closeToasts(page);
  await pickFromMenu(page, SALES_CARD, "Export");
  const dialog = page.getByRole("dialog").filter({ hasText: "Export widget" });
  await dialog.getByText(label, { exact: true }).click();
  await dialog.getByLabel("Save as").fill("sales");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dialog.getByRole("button", { name: "Export" }).click()]);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(300000);
  stack = await prepare({ browser, project: testInfo.project, widgets: ["e2e_sales", "e2e_modebar", "e2e_huge"] });
});

test.afterAll(async () => {
  await stack?.teardown();
});

test("the stack serves the build under test", async () => {
  await drawn(stack.page, SALES_CARD);
  expect(stack.served.length).toBeGreaterThan(0);
  const body = await stack.served.at(-1).body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(built).digest("hex"));
  await expect(stack.page.locator(frameSelector(SALES_CARD))).toHaveAttribute("sandbox", "allow-scripts");
});

test("the figure is drawn as its author made it, with its legend", async () => {
  const frame = await drawn(stack.page, SALES_CARD);
  await expect.poll(() => legendItems(frame)).toBe(3);
  expect(await frame.evaluate(() => document.querySelectorAll(".plotly-chart .bars .point").length)).toBe(9);
  expect(await frame.evaluate(() => document.querySelector(".plotly-message").textContent)).toBe("");
});

test("the card has the plugin's three buttons, and its menu has the plugin's items", async () => {
  const { page } = stack;
  for (const id of ["data-table", "modebar", "static"]) await expect(await pluginAction(page, SALES_CARD, id)).toBeVisible();
  await expect(cardOf(page, SALES_CARD).locator("[data-plugin-action]")).toHaveCount(3);
  await cardOf(page, SALES_CARD).getByTestId("_navbar-controls-right").getByRole("button").last().click();
  for (const label of ["Reset view", "Show all series", "Copy figure JSON"]) await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the modebar is off by default and the Modebar button switches it on and off", async () => {
  const frame = await drawn(stack.page, SALES_CARD);
  expect(await modebars(frame)).toBe(0);
  const button = await pluginAction(stack.page, SALES_CARD, "modebar");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => modebars(frame)).toBe(1);
  await settle();
  const again = await reloaded();
  expect(await modebars(again)).toBe(1);
  await (await pluginAction(stack.page, SALES_CARD, "modebar")).click();
  await expect.poll(() => modebars(again)).toBe(0);
});

test("a widget whose author declares the modebar starts with it on and the button pressed, and the reader can turn it off", async () => {
  const frame = await drawn(stack.page, MODEBAR_CARD);
  await expect.poll(() => modebars(frame)).toBe(1);
  const button = await pluginAction(stack.page, MODEBAR_CARD, "modebar");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect.poll(() => modebars(frame)).toBe(0);
  await settle();
  await stack.page.reload();
  const again = await drawn(stack.page, MODEBAR_CARD);
  expect(await modebars(again)).toBe(0);
});

test("Data table lists the plotted points, and the chart comes back", async () => {
  const frame = await drawn(stack.page, SALES_CARD);
  const button = await pluginAction(stack.page, SALES_CARD, "data-table");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => hasTable(frame)).toBe(true);
  expect(await frame.evaluate(() => document.querySelector(".plotly-chart .bars"))).toBeNull();
  const cells = await graph(frame, (g) => [g.data[0].type, ...g.data[0].header.values, ...g.data[0].cells.values.flat()]);
  expect(cells).toEqual(["table", "Month", "emea", "apac", "amer", "Jan", "Feb", "Mar", 100, 114, 121, 105, 104, 131, 90, 99, 87]);
  await (await pluginAction(stack.page, SALES_CARD, "data-table")).click();
  await expect.poll(() => hasTable(frame)).toBe(false);
  await expect.poll(() => frame.evaluate(() => document.querySelectorAll(".plotly-chart .bars .point").length)).toBe(9);
});

test("a zoom and a hidden series survive a reload, and Reset view and Show all series undo them", async () => {
  let frame = await drawn(stack.page, SALES_CARD);
  expect(await xRange(frame)).toEqual([-0.5, 2.5]);
  await frame.evaluate(() => window.Plotly.relayout(document.querySelector(".plotly-chart"), { "xaxis.range": [0.5, 1.5] }));
  await frame.locator(".plotly-chart .legend .traces").nth(1).locator(".legendtoggle").click();
  await expect.poll(() => visibility(frame)).toEqual([true, "legendonly", true]);
  await settle();
  frame = await reloaded();
  expect(await xRange(frame)).toEqual([0.5, 1.5]);
  expect(await visibility(frame)).toEqual([true, "legendonly", true]);

  await pickFromMenu(stack.page, SALES_CARD, "Show all series");
  await expect.poll(() => visibility(frame)).toEqual([true, true, true]);
  expect(await xRange(frame)).toEqual([0.5, 1.5]);

  await pickFromMenu(stack.page, SALES_CARD, "Reset view");
  await expect.poll(() => xRange(frame)).toEqual([-0.5, 2.5]);
  await settle();
  frame = await reloaded();
  expect(await xRange(frame)).toEqual([-0.5, 2.5]);
  expect(await visibility(frame)).toEqual([true, true, true]);
});

test("Create static chart adds a card with the same bars and no endpoint", async () => {
  const { page } = stack;
  await drawn(page, SALES_CARD);
  await (await pluginAction(page, SALES_CARD, "static")).click();
  const copy = await frameOf(page, STATIC_CARD);
  await copy.waitForSelector(".plotly-chart.js-plotly-plot .main-svg", { timeout: 60000 });
  const data = await graph(copy, (g) => g.data.map((trace) => ({ type: trace.type, name: trace.name, x: trace.x, y: trace.y })));
  expect(data).toEqual(SALES.data.map(({ type, name, x, y }) => ({ type, name, x, y })));
  expect(await graph(copy, (g) => [g.layout.title.text ?? g.layout.title, g.layout.barmode, g.layout.xaxis.title.text ?? g.layout.xaxis.title])).toEqual(["Sales", "group", "Month"]);
  await closeCard(page, STATIC_CARD);
  const again = await drawn(page, SALES_CARD);
  expect(await again.evaluate(() => document.querySelectorAll(".plotly-chart .bars .point").length)).toBe(9);
});

test("a static chart keeps where the reader was looking", async () => {
  const { page } = stack;
  const source = await drawn(page, SALES_CARD);
  await source.evaluate(() => window.Plotly.relayout(document.querySelector(".plotly-chart"), { "xaxis.range": [0.5, 1.5] }));
  await source.locator(".plotly-chart .legend .traces").nth(2).locator(".legendtoggle").click();
  await settle();
  await closeToasts(page);
  await (await pluginAction(page, SALES_CARD, "static")).click();
  const frame = await frameOf(page, STATIC_CARD);
  await frame.waitForSelector(".plotly-chart.js-plotly-plot .main-svg", { timeout: 60000 });
  expect(await xRange(frame)).toEqual([0.5, 1.5]);
  expect(await visibility(frame)).toEqual([true, true, "legendonly"]);
  await closeCard(page, STATIC_CARD);
  await pickFromMenu(page, SALES_CARD, "Reset view");
  await pickFromMenu(page, SALES_CARD, "Show all series");
});

test("a figure too big for a static chart says so, and adds nothing", async () => {
  const { page } = stack;
  await drawn(page, HUGE_CARD);
  const before = await page.locator("iframe[title$='(Plotly charts)']").count();
  await closeToasts(page);
  await (await pluginAction(page, HUGE_CARD, "static")).click();
  await expect(page.getByText(/a static chart holds at most 371 KiB/).first()).toBeVisible({ timeout: 15000 });
  expect(await page.locator("iframe[title$='(Plotly charts)']").count()).toBe(before);
  await closeToasts(page);
});

test("the export dialog gives the data, the figure, a PNG and an SVG", async () => {
  await drawn(stack.page, SALES_CARD);
  const csv = await exportAs("Data (CSV)");
  expect(csv.name).toBe("sales.csv");
  expect(csv.bytes.toString("utf8")).toBe("Month,emea,apac,amer\nJan,100,105,90\nFeb,114,104,99\nMar,121,131,87");
  const figure = await exportAs("Figure (Plotly JSON)");
  expect(JSON.parse(figure.bytes.toString("utf8"))).toEqual(SALES);
  const png = await exportAs("Chart (PNG)");
  expect(png.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.bytes.length).toBeGreaterThan(2000);
  const svg = await exportAs("Chart (SVG)");
  expect(svg.bytes.toString("utf8")).toMatch(/^<svg/);
});

test("Copy figure JSON puts the figure on the clipboard", async () => {
  const { page } = stack;
  await drawn(page, SALES_CARD);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await pickFromMenu(page, SALES_CARD, "Copy figure JSON");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 }).not.toBe("");
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(SALES);
  await closeToasts(page);
});

const BOOT_CHECKS = ["connect-src https://ws-canary.invalid/c", "img-src https://ws-canary.invalid/i.png", "script-src-elem inline", "script-src eval"];

test("the frame asked the network for nothing, and ran nothing the policy refuses, beyond its own boot checks", async () => {
  const frame = await drawn(stack.page, SALES_CARD);
  const violations = await frame.evaluate(() => window.__violations ?? []);
  expect(violations.filter((entry) => !BOOT_CHECKS.includes(entry))).toEqual([]);
  await closeAgent(stack.page);
});
