import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { KINDS, WIDGETS } from "./backend.mjs";
import { cardOf, closeAgent, closeCard, closeToasts, drawn, EMAIL, frameOf, PASSWORD, pickFromMenu, pluginAction, prepare } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SCREENSHOTS ? process.env.E2E_SCREENSHOT_DIR ?? join(here, "../.screenshots") : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

const ids = Object.keys(KINDS);
const nameOf = (id) => WIDGETS[`e2e_${id}`].name;
const BOOT_CHECKS = ["connect-src https://ws-canary.invalid/c", "img-src https://ws-canary.invalid/i.png", "script-src-elem inline", "script-src eval"];
const count = (frame, selector) => () => frame.locator(selector).count();
const CHECKS = {
  lines: (frame) => expect.poll(count(frame, ".plotly-chart .scatterlayer .trace"), { timeout: 30000 }).toBe(2),
  pie: (frame) => expect.poll(count(frame, ".plotly-chart .pielayer .slice"), { timeout: 30000 }).toBe(3),
  heatmap: (frame) => expect.poll(count(frame, ".plotly-chart .heatmaplayer image"), { timeout: 30000 }).toBeGreaterThan(0),
  geo: (frame) => expect.poll(count(frame, ".plotly-chart .geo .scatterlayer .point"), { timeout: 60000 }).toBe(3),
  tiles: (frame) => expect.poll(count(frame, ".plotly-chart .maplibregl-canvas"), { timeout: 60000 }).toBe(1),
  surface: (frame) => expect.poll(count(frame, ".plotly-chart .gl-container canvas, .plotly-chart .scene"), { timeout: 30000 }).toBeGreaterThan(0),
  latex: (frame) => expect.poll(count(frame, ".plotly-chart svg.gtitle-math"), { timeout: 30000 }).toBe(1),
  candles: (frame) => expect.poll(count(frame, ".plotly-chart .boxlayer .box"), { timeout: 30000 }).toBeGreaterThanOrEqual(3),
};

let stack;

const shot = async (name, target) => {
  if (!SHOTS) return;
  await target.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const hovered = async (name) => {
  const box = await stack.page.locator(`iframe[title="${name} (Plotly charts)"]`).boundingBox();
  await stack.page.mouse.move(box.x + box.width / 2, box.y - 20);
  await stack.page.waitForTimeout(500);
};

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(400000);
  stack = await prepare({ browser, project: testInfo.project, widgets: ids.map((id) => `e2e_${id}`) });
});

test.afterAll(async () => {
  await stack?.teardown();
});

for (const id of ids) {
  test(`${id} is drawn, with nothing on the card but the chart`, async () => {
    test.setTimeout(120000);
    const frame = await drawn(stack.page, nameOf(id));
    await CHECKS[id](frame);
    await expect(frame.locator(".plotly-message")).toHaveText("", { timeout: 30000 });
    await shot(`kind-${id}`, cardOf(stack.page, nameOf(id)));
  });
}

test("no kind needed the network, or ran what the policy refuses, beyond the frame's boot checks and the tile map's try at its own base map", async () => {
  for (const id of ids) {
    const frame = await frameOf(stack.page, nameOf(id));
    const violations = await frame.evaluate(() => window.__violations ?? []);
    const tryBaseMap = (entry) => id === "tiles" && /^connect-src https:\/\/basemaps\.cartocdn\.com\//.test(entry);
    expect(violations.filter((entry) => !BOOT_CHECKS.includes(entry) && !tryBaseMap(entry)), id).toEqual([]);
  }
});

const STATIC_OF = ["lines", "pie", "heatmap", "geo", "tiles", "surface", "latex", "candles"];

for (const id of STATIC_OF) {
  test(`Create static chart copies the ${id} figure whole, and the copy is drawn`, async () => {
    test.setTimeout(120000);
    const { page } = stack;
    await drawn(page, nameOf(id));
    await closeToasts(page);
    await (await pluginAction(page, nameOf(id), "static")).click();
    const copy = await frameOf(page, `${nameOf(id)} (static)`);
    await copy.waitForSelector(".plotly-chart.js-plotly-plot .main-svg", { timeout: 60000 });
    await expect(copy.locator(".plotly-message")).toHaveText("");
    expect(await copy.evaluate(() => document.querySelector(".plotly-chart").data.map((trace) => trace.type))).toEqual(KINDS[id].figure.data.map((trace) => trace.type));
    await CHECKS[id](copy);
    await shot(`static-${id}`, cardOf(page, `${nameOf(id)} (static)`));
    await closeCard(page, `${nameOf(id)} (static)`);
  });
}

test("the modebar shows on a chart and takes its own button off the header's count", async () => {
  const { page } = stack;
  const frame = await drawn(page, nameOf("lines"));
  await (await pluginAction(page, nameOf("lines"), "modebar")).click();
  await expect(frame.locator(".plotly-chart .modebar")).toHaveCount(1, { timeout: 15000 });
  await hovered(nameOf("lines"));
  await shot("modebar-lines", cardOf(page, nameOf("lines")));
  await (await pluginAction(page, nameOf("lines"), "modebar")).click();
  await expect(frame.locator(".plotly-chart .modebar")).toHaveCount(0, { timeout: 15000 });
});

test("the data table of a line chart and of a candlestick list their points", async () => {
  const { page } = stack;
  const rowsOf = (frame) => frame.evaluate(() => { const [t] = document.querySelector(".plotly-chart").data; return [t.type, ...(t.header?.values ?? [])]; });
  for (const [id, header] of [["lines", ["Day", "price", "average"]], ["candles", ["x", "open", "high", "low", "close"]]]) {
    const frame = await drawn(page, nameOf(id));
    await (await pluginAction(page, nameOf(id), "data-table")).click();
    await expect.poll(() => rowsOf(frame), { timeout: 15000 }).toEqual(["table", ...header]);
    await shot(`table-${id}`, cardOf(page, nameOf(id)));
    await (await pluginAction(page, nameOf(id), "data-table")).click();
    await expect.poll(() => frame.evaluate(() => document.querySelector(".plotly-chart").data[0].type)).not.toBe("table");
  }
});

test("a heatmap has no data table to show and stays a chart", async () => {
  const frame = await drawn(stack.page, nameOf("heatmap"));
  await (await pluginAction(stack.page, nameOf("heatmap"), "data-table")).click();
  await stack.page.waitForTimeout(1500);
  expect(await frame.evaluate(() => document.querySelector(".plotly-chart").data[0].type)).toBe("heatmap");
  await (await pluginAction(stack.page, nameOf("heatmap"), "data-table")).click();
});

test("the menu items and the buttons on the dashboard", async () => {
  const { page } = stack;
  await closeAgent(page);
  await closeToasts(page);
  await drawn(page, nameOf("lines"));
  await hovered(nameOf("lines"));
  await cardOf(page, nameOf("lines")).getByTestId("_navbar-controls-right").getByRole("button").last().click();
  await expect(page.getByRole("menuitem", { name: "Reset view", exact: true })).toBeVisible();
  await shot("menu-lines", page);
  await page.keyboard.press("Escape");
  await pickFromMenu(page, nameOf("lines"), "Reset view");
});

test("the site's light mode redraws the figures that follow it, keeps a zoom, and dark mode brings the dark back", async () => {
  const { page } = stack;
  const paper = (frame) => frame.evaluate(() => document.querySelector(".plotly-chart")._fullLayout.paper_bgcolor);
  const lines = await drawn(page, nameOf("lines"));
  await lines.evaluate(() => window.Plotly.relayout(document.querySelector(".plotly-chart"), { "xaxis.range": ["2026-01-02", "2026-01-03"] }));
  await page.waitForTimeout(1500);
  const dark = await paper(lines);
  await closeAgent(page);
  await page.keyboard.press("Control+m");
  try {
    await expect.poll(() => paper(lines), { timeout: 20000 }).not.toBe(dark);
    expect(await paper(lines)).toBe("white");
    expect(await lines.evaluate(() => document.querySelector(".plotly-chart")._fullLayout.xaxis.range)).toEqual(["2026-01-02", "2026-01-03"]);
    const geo = await drawn(page, nameOf("geo"));
    await expect.poll(() => geo.evaluate(() => document.querySelector(".plotly-chart")._fullLayout.geo.bgcolor), { timeout: 20000 }).toBe("white");
    await shot("light-geo", cardOf(page, nameOf("geo")));
    await shot("light-lines", cardOf(page, nameOf("lines")));
    const pie = await drawn(page, nameOf("pie"));
    await shot("light-pie", cardOf(page, nameOf("pie")));
    expect(await paper(pie)).toBe("white");
  } finally {
    await page.keyboard.press("Control+m");
    await page.waitForTimeout(1500);
  }
  await expect.poll(() => paper(lines), { timeout: 20000 }).toBe(dark);
});
