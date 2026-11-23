import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { CITIES, STATES } from "./data.mjs";
import { WIDGETS } from "./backend.mjs";
import { cardOf, closeAgent, closeToasts, drawn, EMAIL, frameOf, frameSelector, PASSWORD, PLUGIN, pickFromMenu, pluginAction, prepare, viewOf } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
const built = readFileSync(process.env.E2E_BUNDLE ?? join(here, "../dist", PLUGIN, pkg.version, "entry.js"));

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

const PRESET = "E2E preset";
const CITIES_CARD = WIDGETS.us_cities.name;
const STATES_CARD = WIDGETS.us_states.name;
const table = (frame) => frame.getByRole("region", { name: /^Data of map/ });
const rows = (frame) => table(frame).getByRole("rowheader");

let stack;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(300000);
  stack = await prepare({ browser, project: testInfo.project, widgets: ["us_cities", "us_states"] });
});

test.afterAll(async () => {
  try {
    const { presets } = await stack.call("GET", `/app/widget-plugins/${PLUGIN}/widgets/map/presets`);
    for (const preset of presets.filter((item) => item.name === PRESET)) await stack.call("DELETE", `/app/widget-plugins/${PLUGIN}/widgets/map/presets/${preset.id}`);
  } finally {
    await stack?.teardown();
  }
});

test("the stack serves the build under test", async () => {
  await drawn(stack.page, CITIES_CARD);
  expect(stack.served.length).toBeGreaterThan(0);
  const body = await stack.served.at(-1).body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(built).digest("hex"));
  await expect(stack.page.locator(frameSelector(CITIES_CARD))).toHaveAttribute("sandbox", "allow-scripts");
});

test("the cities and the states are drawn", async () => {
  const cities = await drawn(stack.page, CITIES_CARD);
  const states = await drawn(stack.page, STATES_CARD);
  await expect(cities.getByText("Northeast").first()).toBeVisible();
  await expect(states.getByText("Population (2020 Census)").first()).toBeVisible();
});

test("the card has the plugin's buttons, and its menu has the plugin's items", async () => {
  const { page } = stack;
  await expect(await pluginAction(page, CITIES_CARD, "data-table")).toBeVisible();
  await expect(await pluginAction(page, CITIES_CARD, "static")).toBeVisible();
  await expect(cardOf(page, CITIES_CARD).locator("[data-plugin-action]")).toHaveCount(2);
  await cardOf(page, CITIES_CARD).getByTestId("_navbar-controls-right").getByRole("button").last().click();
  for (const label of ["Show all data", "Reset view", "Copy view"]) await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the Data table button shows the marks as a table and is pressed while it shows", async () => {
  const { page } = stack;
  const frame = await frameOf(page, CITIES_CARD);
  const button = await pluginAction(page, CITIES_CARD, "data-table");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(table(frame)).toBeVisible();
  await expect(rows(frame)).toHaveCount(CITIES.length);
  await expect(rows(frame).first()).toHaveText(CITIES[0].city);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await frame.getByRole("button", { name: "Show data" }).click();
  await expect(table(frame)).toHaveCount(0);
  await expect(await pluginAction(page, CITIES_CARD, "data-table")).toHaveAttribute("aria-pressed", "false");
});

test("the table the reader opens in the map presses the button, and the dashboard keeps it", async () => {
  const { page } = stack;
  const frame = await frameOf(page, CITIES_CARD);
  const saved = page.waitForResponse((response) => response.url().includes("/app/dash/sync") && response.request().method() === "POST", { timeout: 30000 });
  await frame.getByRole("button", { name: "Show data" }).click();
  await expect(table(frame)).toBeVisible();
  await expect(await pluginAction(page, CITIES_CARD, "data-table")).toHaveAttribute("aria-pressed", "true");
  await saved;
  await page.waitForTimeout(1500);
  await page.reload();
  await closeAgent(page);
  const again = await frameOf(page, CITIES_CARD);
  await expect(table(again)).toBeVisible({ timeout: 45000 });
  await expect(await pluginAction(page, CITIES_CARD, "data-table")).toHaveAttribute("aria-pressed", "true");
  await (await pluginAction(page, CITIES_CARD, "data-table")).click();
  await expect(table(again)).toHaveCount(0);
});

test("Reset view and Show all data bring the map back, and Copy view says where it is", async () => {
  const { page } = stack;
  const frame = await drawn(page, CITIES_CARD);
  const start = await viewOf(page, CITIES_CARD);
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1500);
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1500);
  const closer = await viewOf(page, CITIES_CARD);
  expect(closer.zoom).toBeGreaterThan(start.zoom + 1.5);
  await pickFromMenu(page, CITIES_CARD, "Reset view");
  await page.waitForTimeout(1200);
  expect((await viewOf(page, CITIES_CARD)).zoom).toBeCloseTo(start.zoom, 1);
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1500);
  await pickFromMenu(page, CITIES_CARD, "Show all data");
  await page.waitForTimeout(1200);
  expect((await viewOf(page, CITIES_CARD)).zoom).toBeCloseTo(start.zoom, 1);
});

test("Create static map adds a card with the same places, where the reader was looking", async () => {
  const { page } = stack;
  const name = `${CITIES_CARD} (static)`;
  const before = await viewOf(page, CITIES_CARD);
  await (await pluginAction(page, CITIES_CARD, "static")).click();
  await expect(page.getByText("Static map created.").first()).toBeVisible({ timeout: 15000 });
  await closeToasts(page);
  const frame = await drawn(page, name);
  await frame.getByRole("button", { name: "Show data" }).click();
  await expect(rows(frame)).toHaveCount(CITIES.length);
  expect(await rows(frame).allTextContents()).toEqual(CITIES.map((city) => city.city));
  await frame.getByRole("button", { name: "Show data" }).click();
  const copy = await viewOf(page, name);
  expect(copy.latitude).toBeCloseTo(before.latitude, 1);
  expect(copy.longitude).toBeCloseTo(before.longitude, 1);
});

test("Create static map adds the states of a shaded map with their population", async () => {
  const { page } = stack;
  const name = `${STATES_CARD} (static)`;
  await (await pluginAction(page, STATES_CARD, "static")).click();
  await expect(page.getByText("Static map created.").first()).toBeVisible({ timeout: 15000 });
  await closeToasts(page);
  const frame = await drawn(page, name);
  await frame.getByRole("button", { name: "Show data" }).click();
  await expect(rows(frame)).toHaveCount(STATES.length);
  const first = STATES.reduce((a, b) => (a.population > b.population ? a : b));
  await expect(table(frame).getByText(first.population.toLocaleString("en-US")).first()).toBeVisible();
});

test("a preset keeps the view and the data table of a card, and brings them back", async () => {
  const { page } = stack;
  const frame = await drawn(page, CITIES_CARD);
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(3500);
  await (await pluginAction(page, CITIES_CARD, "data-table")).click();
  await expect(table(frame)).toBeVisible();
  await page.waitForTimeout(2500);
  const kept = await viewOf(page, CITIES_CARD);

  await pickFromMenu(page, CITIES_CARD, "Settings");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Zoom")).toHaveValue(String(kept.zoom));
  await expect(dialog.getByLabel("Data table")).toBeChecked();
  await dialog.getByLabel("Preset name").fill(PRESET);
  await dialog.getByRole("button", { name: "Save current settings as a preset" }).click();
  await expect(dialog.locator("li[data-preset]").filter({ hasText: PRESET })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await (await pluginAction(page, CITIES_CARD, "data-table")).click();
  await expect(table(frame)).toHaveCount(0);
  await pickFromMenu(page, CITIES_CARD, "Reset view");
  await page.waitForTimeout(3500);
  expect((await viewOf(page, CITIES_CARD)).zoom).toBeLessThan(kept.zoom - 0.5);

  await pickFromMenu(page, CITIES_CARD, "Settings");
  await dialog.locator("li[data-preset]").filter({ hasText: PRESET }).getByRole("button", { name: "Apply" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(table(frame)).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2500);
  expect((await viewOf(page, CITIES_CARD)).zoom).toBeCloseTo(kept.zoom, 1);
});

test("a rectangle the reader draws and a tag the reader writes are kept in the dashboard, and are in the export", async ({}, testInfo) => {
  const { page } = stack;
  const frame = await drawn(page, CITIES_CARD);
  const toggle = frame.getByRole("button", { name: "Show data" });
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(table(frame)).toHaveCount(0);
  await frame.getByRole("button", { name: "Draw", exact: true }).click();
  await frame.getByRole("button", { name: "Rectangle" }).click();
  const box = await page.locator(frameSelector(CITIES_CARD)).boundingBox();
  await page.mouse.click(box.x + 120, box.y + 150);
  await page.waitForTimeout(400);
  await page.mouse.click(box.x + 260, box.y + 220);
  await page.waitForTimeout(400);
  await frame.getByRole("button", { name: "Done drawing" }).click();
  await toggle.click();
  await frame.getByRole("button", { name: "Add tag to New York" }).click();
  const field = frame.getByLabel("Your tag for New York");
  await field.fill("HQ");
  await field.press("Enter");
  const saved = page.waitForResponse((response) => response.url().includes("/app/dash/sync") && response.request().method() === "POST", { timeout: 30000 });
  await expect(table(frame).getByText("HQ").first()).toBeVisible();
  await saved;
  await page.waitForTimeout(2000);
  await page.reload();
  await closeAgent(page);
  const again = await drawn(page, CITIES_CARD);
  await expect(table(again).getByText("HQ").first()).toBeVisible({ timeout: 45000 });

  await pickFromMenu(page, CITIES_CARD, "Export");
  const dialog = page.getByRole("dialog").filter({ hasText: "Export widget" });
  await dialog.getByText("Map (GeoJSON)", { exact: true }).click();
  await dialog.getByLabel("Save as").fill("cities");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dialog.getByRole("button", { name: "Export" }).click()]);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const exported = JSON.parse(readFileSync(path, "utf8"));
  const names = exported.features.map((feature) => feature.properties?.name);
  for (const city of CITIES) expect(names, city.city).toContain(city.city);
  expect(exported.features.filter((feature) => feature.geometry.type === "Polygon")).toHaveLength(1);
  expect(JSON.stringify(exported)).toContain("HQ");
});
