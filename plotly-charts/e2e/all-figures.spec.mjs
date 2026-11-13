import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { FIGURES, KIND_IDS } from "./figures.mjs";
import { closeAgent, drawn, EMAIL, PASSWORD, pluginAction, prepare } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.E2E_SCREENSHOTS ? (process.env.E2E_SCREENSHOT_DIR ?? join(here, "../.screenshots")) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

const CARD = "E2E figure";
const [part, parts] = (process.env.E2E_PART ?? "1/1").split("/").map(Number);
const ids = KIND_IDS.filter((_, index) => index % parts === part - 1);
const NO_TABLE = new Set(["heatmap", "heatmap-typed", "contour", "surface", "image", "table", "indicator", "mesh3d", "cone", "empty-data"]);
const MAPS = new Set(["scattermap", "densitymap", "choroplethmap", "scattermap-white-bg"]);
const BOOT_CHECKS = ["connect-src https://ws-canary.invalid/c", "img-src https://ws-canary.invalid/i.png", "script-src-elem inline", "script-src eval"];

let stack;
const errors = [];

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(300000);
  stack = await prepare({ browser, project: testInfo.project, widgets: ["e2e_figure"] });
  stack.page.on("pageerror", (error) => {
    if (!/\$Refresh(Sig|Reg)\$|^Error: Map error\.$/.test(String(error))) errors.push(String(error));
  });
  await closeAgent(stack.page);
});

test.afterAll(async () => {
  await stack?.teardown();
});

for (const id of ids) {
  test(`${id} is drawn, listed as a table where it has points, and read by the agent`, async () => {
    test.setTimeout(120000);
    const { page } = stack;
    const figure = FIGURES[id];
    stack.backend.show(id);
    errors.length = 0;
    await page.reload();
    const frame = await drawn(page, CARD);
    await expect(frame.locator(".plotly-message")).toHaveText("", { timeout: 30000 });
    await expect
      .poll(() => frame.evaluate(() => document.querySelector(".plotly-chart")?.data?.length ?? -1), { timeout: 30000 })
      .toBe(figure.data.length);
    await expect
      .poll(() => frame.evaluate(() => document.querySelectorAll(".plotly-chart .main-svg, .plotly-chart canvas").length), { timeout: 30000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(800);

    if (SHOTS) await page.locator(`iframe[title="${CARD} (Plotly charts)"]`).screenshot({ path: join(SHOTS, `figure-${id}.png`) });

    const button = await pluginAction(page, CARD, "data-table");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(700);
    await expect(frame.locator(".plotly-message")).toHaveText("");
    const type = await frame.evaluate(() => document.querySelector(".plotly-chart").data[0]?.type);
    expect([figure.data[0]?.type, "table"], "a table or the chart, never a failure").toContain(type);
    if (NO_TABLE.has(id)) expect(type, "a figure with no points to list stays a chart").toBe(figure.data[0]?.type);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => frame.evaluate(() => document.querySelector(".plotly-chart").data[0]?.type), { timeout: 15000 }).toBe(figure.data[0]?.type);

    expect(await frame.evaluate(() => document.querySelector(".plotly-message").textContent)).toBe("");
    const violations = (await frame.evaluate(() => window.__violations ?? [])).filter((entry) => !BOOT_CHECKS.includes(entry));
    const allowed = MAPS.has(id) ? violations.filter((entry) => !/^connect-src https:\/\/basemaps\.cartocdn\.com\//.test(entry)) : violations;
    expect(allowed, id).toEqual([]);
    const own = errors;
    expect(own, id).toEqual([]);
  });
}
