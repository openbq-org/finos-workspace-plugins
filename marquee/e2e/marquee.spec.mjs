import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { quoteItem, quoteText, startBackend, STOCKS, WIDGETS } from "./backend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
const built = readFileSync(process.env.E2E_BUNDLE ?? join(here, "../dist/marquee", pkg.version, "entry.js"));

const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8013);
const BACKEND_HOST = process.env.E2E_BACKEND_HOST ?? "host.docker.internal";
const BACKEND_LISTEN = process.env.E2E_BACKEND_LISTEN ?? "0.0.0.0";
const BACKEND_NAME = "E2E Marquee backend";
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;
const CANARY = "marquee-canary.invalid";

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name a superuser of the stack under test");

let context;
let page;
let backend;
let entityUuid;
let roleUuid;
let dashboardId;
let served = [];

const names = Object.values(WIDGETS);
const SHOTS = process.env.E2E_SCREENSHOTS ? join(here, ".screenshots") : null;
const glide = (x, y) => page.mouse.move(x, y, { steps: 8 });

async function shot(name, widget) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await headerOf(widget).screenshot({ path: join(SHOTS, `${name}.png`) });
}
const iframeSelector = (name) => `iframe[title^="${name}"]`;
const headerOf = (name) => page.locator(`xpath=//iframe[starts-with(@title,"${name}")]/ancestor::*[.//p[contains(.,"${name}")]][1]`);

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

async function frameOf(name) {
  await expect(page.locator(iframeSelector(name))).toHaveCount(1, { timeout: 45000 });
  await page.locator(iframeSelector(name)).scrollIntoViewIfNeeded();
  const handle = await page.locator(iframeSelector(name)).elementHandle();
  const frame = await handle.contentFrame();
  await frame.waitForSelector(".mq", { timeout: 45000 });
  return frame;
}

const texts = (frame) =>
  frame.evaluate(() =>
    [...(document.querySelector(".mq-content")?.querySelectorAll(".mq-item") ?? [])].map((node) =>
      node.classList.contains("mq-quote") ? [...node.querySelectorAll(".mq-tick, .mq-name, .mq-price, .mq-change")].map((part) => part.textContent).join(" ") : node.textContent,
    ),
  );

const motion = (frame) =>
  frame.evaluate(() => {
    const track = document.querySelector(".mq-track");
    const animation = track.getAnimations()[0];
    const matrix = new DOMMatrix(getComputedStyle(track).transform);
    if (!animation) return { animated: false, x: matrix.m41, y: matrix.m42 };
    const timing = animation.effect.getComputedTiming();
    return { animated: true, name: animation.animationName, state: animation.playState, time: Number(animation.currentTime), x: matrix.m41, y: matrix.m42, duration: timing.duration, direction: timing.direction, iterations: timing.iterations, from: track.style.getPropertyValue("--mq-from"), to: track.style.getPropertyValue("--mq-to") };
  });

async function reload(name) {
  await page.reload();
  await page.getByRole("button", { name: "Close Agent" }).first().click({ timeout: 4000 }).catch(() => undefined);
  const frame = await frameOf(name);
  let previous = "";
  await expect(async () => {
    const now = JSON.stringify(await page.locator(iframeSelector(name)).boundingBox());
    const same = now === previous;
    previous = now;
    expect(same).toBe(true);
  }).toPass({ intervals: [250], timeout: 10000 });
  return frame;
}

async function clickVisible(frame, name, selector, text = "") {
  const target = await frame.evaluate(
    ({ selector, text }) => {
      const stage = document.querySelector(".mq-stage").getBoundingClientRect();
      const node = [...document.querySelectorAll(selector)].filter((candidate) => candidate.textContent.includes(text)).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.left >= stage.left + 24 && rect.right <= stage.right - 24 && rect.top >= stage.top && rect.bottom <= stage.bottom;
      });
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    { selector, text },
  );
  expect(target, `no visible ${selector} with ${text}`).not.toBeNull();
  const box = await page.locator(iframeSelector(name)).boundingBox();
  await page.mouse.click(box.x + target.x, box.y + target.y);
}

async function live() {
  const frame = await reload(WIDGETS.live);
  await frame.waitForSelector('.mq-dot[data-state="live"]', { timeout: 30000 });
  return frame;
}

async function openMenu(name) {
  const header = headerOf(name);
  await header.scrollIntoViewIfNeeded();
  const box = await page.locator(iframeSelector(name)).boundingBox();
  await glide(box.x + box.width / 2, box.y - 20);
  await header.locator("button").nth(3).click();
  await expect(page.getByRole("menuitem", { name: "Export", exact: true })).toBeVisible();
}

async function exportAs(name, label) {
  await openMenu(name);
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Export widget" });
  await dialog.getByText(label, { exact: true }).click();
  await dialog.getByLabel("Save as").fill("marquee");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dialog.getByRole("button", { name: "Export" }).click()]);
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf8") };
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  backend = await startBackend({ port: BACKEND_PORT, listen: BACKEND_LISTEN });
  context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport, deviceScaleFactor: Number(process.env.E2E_SCALE ?? 1) });
  await context.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  page = await context.newPage();
  page.on("response", (response) => {
    if (/\/widget-plugins\/marquee\/.*\/files\/entry\.js/.test(response.url())) served.push(response);
  });
  await page.goto("/login");
  await page.getByPlaceholder("Email address").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await page.goto("/robots.txt");

  const plugin = await call("GET", "/plugins/marquee");
  expect(plugin.status, "the Marquee plugin is approved and enabled on this stack (see the README)").toBe("enabled");
  entityUuid = (await call("GET", "/entity/entity")).items[0].uuid;
  roleUuid = crypto.randomUUID();
  await call("POST", "/admin/role", { uuid: roleUuid, name: "E2E Marquee", description: "E2E Marquee", users: [EMAIL] });
  await call("PUT", `/admin/role/${roleUuid}/plugin-access`, { grants: [{ plugin_id: "marquee", widget_id: "*" }] });
  await call("POST", `/entity/data-backends/${entityUuid}`, { name: BACKEND_NAME, url: `http://${BACKEND_HOST}:${BACKEND_PORT}` });
  const backends = await call("GET", `/entity/data-backends/${entityUuid}`);
  const uuid = backends.find((item) => item.name === BACKEND_NAME).uuid;
  await call("PUT", `/admin/role-permissions/${roleUuid}`, [
    { uuid, type: "backend", category: "data-connectors", access: "access", widgets: ["marquee_text", "marquee_polled", "marquee_live", "marquee_click", "marquee_vertical"].map((widgetId) => ({ widgetId, access: "access" })) },
  ]);

  await page.goto("/app");
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#tabs").getByRole("button").first().click();
  await page.getByRole("button", { name: /New Dashboard/ }).click();
  await page.waitForURL(/\/app\/[a-f0-9-]+/, { timeout: 15000 });
  dashboardId = new URL(page.url()).pathname.split("/").pop();
  for (const name of names) {
    const open = page.getByRole("button", { name: "Add widgets" });
    if (await open.count()) await open.first().click();
    else await page.getByTestId("dashboard-toolbar-add-widget-button").click();
    const menu = page.getByRole("dialog");
    await menu.getByPlaceholder("Search for widgets").fill(name);
    await menu.getByText(name, { exact: true }).first().click();
    await menu.getByRole("button", { name: "Add widgets" }).click();
    await expect(menu).toBeHidden();
  }
  const close = page.getByRole("button", { name: "Close Agent" });
  if (await close.count()) await close.first().click();
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
    backend?.close();
  }
});

test("the stack serves the build under test, in a sandbox", async () => {
  const frame = await frameOf(WIDGETS.text);
  expect(frame).toBeTruthy();
  expect(served.length).toBeGreaterThan(0);
  const body = await served.at(-1).body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(built).digest("hex"));
  await expect(page.locator(iframeSelector(WIDGETS.text))).toHaveAttribute("sandbox", "allow-scripts");
});

test("a text marquee scrolls, with the speed as the length of the cycle", async () => {
  const frame = await reload(WIDGETS.text);
  await expect.poll(() => texts(frame)).toEqual(["Breaking: markets rally as tech earnings beat expectations"]);
  const first = await motion(frame);
  expect(first).toMatchObject({ animated: true, name: "mq-scroll-x", state: "running", duration: 15000, iterations: Infinity, direction: "normal" });
  await page.waitForTimeout(700);
  const second = await motion(frame);
  expect(second.time).toBeGreaterThan(first.time);
  expect(second.x).toBeLessThan(first.x);
  const groups = await frame.evaluate(() => [...document.querySelectorAll(".mq-group")].map((group) => group.querySelectorAll(".mq-content").length));
  expect(groups.length).toBe(2);
  expect(groups[0]).toBe(groups[1]);
  const hidden = await frame.evaluate(() => [...document.querySelectorAll(".mq-content")].filter((node) => node.getAttribute("aria-hidden") === "true").length);
  expect(hidden).toBe(groups[0] * 2 - 1);
  expect(await frame.evaluate(() => document.querySelector(".mq-stage").getAttribute("role"))).toBe("marquee");
});

test("a card that declares the size of a strip is the size of a strip, and the strip fits in it", async () => {
  for (const [name, content] of [[WIDGETS.text, ".mq-item"], [WIDGETS.live, ".mq-quote"]]) {
    const frame = await reload(name);
    await frame.waitForSelector(content);
    const box = await page.locator(iframeSelector(name)).boundingBox();
    expect(box.height).toBeLessThanOrEqual(name === WIDGETS.text ? 80 : 110);
    expect(box.width).toBeGreaterThan(900);
    const fit = await frame.evaluate((selector) => {
      const stage = document.querySelector(".mq-stage").getBoundingClientRect();
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { stage: stage.height, item: rect.height, top: rect.top - stage.top, bottom: stage.bottom - rect.bottom, clipped: document.querySelector(".mq").scrollHeight > document.querySelector(".mq").clientHeight };
    }, content);
    expect(fit.item).toBeGreaterThan(0);
    expect(fit.top).toBeGreaterThanOrEqual(-1);
    expect(fit.bottom).toBeGreaterThanOrEqual(-1);
    expect(fit.clipped).toBe(false);
  }
});

test("a quote strip shows each quote as a name, a price and a change over a small chart, as a financial strip does", async () => {
  const frame = await reload(WIDGETS.live);
  await frame.waitForSelector(".mq-quote");
  const found = await frame.evaluate(() => {
    const quote = document.querySelector(".mq-content .mq-quote");
    const rect = (selector) => quote.querySelector(selector).getBoundingClientRect();
    return {
      name: quote.querySelector(".mq-name").textContent,
      tick: getComputedStyle(quote.querySelector(".mq-tick")).display,
      price: quote.querySelector(".mq-price").textContent,
      change: quote.querySelector(".mq-change").textContent,
      changeColor: getComputedStyle(quote.querySelector(".mq-change")).color,
      priceColor: getComputedStyle(quote.querySelector(".mq-price")).color,
      sparkColor: getComputedStyle(quote.querySelector(".mq-spark")).color,
      nameTop: rect(".mq-name").top,
      priceTop: rect(".mq-price").top,
      changeTop: rect(".mq-change").top,
      sparkLeft: rect(".mq-spark").left,
      infoRight: rect(".mq-info").right,
      points: quote.querySelector("polyline").getAttribute("points").split(" ").length,
    };
  });
  expect(found.name).toBe("Apple Inc.");
  expect(found.tick).toBe("none");
  expect(found.price).toBe("185.32");
  expect(found.change).toBe("+1.2%");
  expect(found.nameTop).toBeLessThan(found.priceTop);
  expect(found.priceTop).toBeLessThan(found.changeTop);
  expect(found.sparkLeft).toBeGreaterThanOrEqual(found.infoRight);
  expect(found.changeColor).toBe(found.sparkColor);
  expect(found.changeColor).not.toBe(found.priceColor);
  expect(found.points).toBe(12);
  await shot("strip", WIDGETS.live);
});

test("a vertical marquee is a ticker panel taller than it is wide: a row for each quote, its columns lined up, moving up", async () => {
  const frame = await reload(WIDGETS.vertical);
  await expect.poll(async () => (await texts(frame)).length).toBe(6);
  const card = await page.locator(iframeSelector(WIDGETS.vertical)).boundingBox();
  expect(card.height).toBeGreaterThan(card.width * 1.3);
  const found = await frame.evaluate(() => {
    const stage = document.querySelector(".mq-stage").getBoundingClientRect();
    const rows = [...document.querySelector(".mq-content").querySelectorAll(".mq-quote")];
    const box = (row, selector) => row.querySelector(selector).getBoundingClientRect();
    return {
      axis: document.querySelector(".mq").dataset.axis,
      mask: getComputedStyle(document.querySelector(".mq-stage")).maskImage,
      stageHeight: stage.height,
      tops: rows.map((row) => row.getBoundingClientRect().top),
      heights: rows.map((row) => row.getBoundingClientRect().height),
      widths: rows.map((row) => row.getBoundingClientRect().width),
      stageWidth: stage.width,
      tickShown: rows.map((row) => getComputedStyle(row.querySelector(".mq-tick")).display !== "none"),
      sparkShown: rows.map((row) => getComputedStyle(row.querySelector(".mq-spark")).display !== "none"),
      ticks: rows.map((row) => row.querySelector(".mq-tick").textContent),
      names: rows.map((row) => row.querySelector(".mq-name").textContent),
      sparkLefts: rows.map((row) => Math.round(box(row, ".mq-spark").left)),
      priceRights: rows.map((row) => Math.round(box(row, ".mq-price").right)),
      changeRights: rows.map((row) => Math.round(box(row, ".mq-change").right)),
      tickLefts: rows.map((row) => Math.round(box(row, ".mq-tick").left)),
      borders: rows.map((row) => getComputedStyle(row).borderBottomWidth),
      tickColor: getComputedStyle(rows[0].querySelector(".mq-tick")).color,
      priceColor: getComputedStyle(rows[0].querySelector(".mq-price")).color,
      layout: getComputedStyle(rows[0]).display,
    };
  });
  expect(found.axis).toBe("y");
  expect(found.layout).toBe("grid");
  expect(found.mask).toMatch(/10%.*90%/);
  expect(found.mask).not.toMatch(/to right|90deg|270deg/);
  expect(found.stageHeight).toBeGreaterThan(300);
  expect(found.ticks).toEqual(["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA", "TSLA"]);
  expect(found.names[0]).toBe("Apple Inc.");
  expect(found.tickShown.every(Boolean)).toBe(true);
  expect(found.sparkShown.every(Boolean)).toBe(true);
  for (let i = 1; i < found.tops.length; i += 1) expect(found.tops[i]).toBeGreaterThanOrEqual(found.tops[i - 1] + found.heights[i - 1] - 1);
  for (const width of found.widths) expect(width).toBeGreaterThan(found.stageWidth * 0.9);
  expect(new Set(found.sparkLefts).size).toBe(1);
  expect(new Set(found.priceRights).size).toBe(1);
  expect(new Set(found.changeRights).size).toBe(1);
  expect(new Set(found.tickLefts).size).toBe(1);
  expect(found.borders.every((width) => width === "1px")).toBe(true);
  expect(found.tickColor).not.toBe(found.priceColor);
  const first = await motion(frame);
  await page.waitForTimeout(400);
  const second = await motion(frame);
  expect(first).toMatchObject({ name: "mq-scroll-y", duration: 30000, direction: "normal" });
  expect(second.y).toBeLessThan(first.y);
  await shot("vertical", WIDGETS.vertical);
});

test("the ticker panel follows the stream: the row of a quote changes in place, flashes, and the others stay", async () => {
  const frame = await reload(WIDGETS.vertical);
  await frame.waitForSelector('.mq-dot[data-state="live"]', { timeout: 30000 });
  const before = await motion(frame);
  backend.broadcast({ op: "set-item", ticker: "MSFT", value: "380.10", change: "+1.3%", tone: "up", spark: [1, 2, 3, 4, 3, 5] });
  await expect.poll(async () => (await texts(frame))[2]).toBe("MSFT Microsoft Corporation 380.10 +1.3%");
  const after = await motion(frame);
  expect(after.time).toBeGreaterThanOrEqual(before.time);
  const flashed = await frame.evaluate(() => [...document.querySelectorAll('[data-i="2"]')].every((node) => /mq-flash-[ab]/.test(node.className)));
  expect(flashed).toBe(true);
  expect(await frame.evaluate(() => [...document.querySelectorAll('[data-i="1"]')].some((node) => /mq-flash/.test(node.className)))).toBe(false);
  expect(await frame.evaluate(() => document.querySelector('[data-i="2"] polyline').getAttribute("points").split(" ").length)).toBe(6);
  await shot("vertical-update", WIDGETS.vertical);
});

test("hovering the marquee pauses it, and the card's Pause button stops it until it is pressed again", async () => {
  const frame = await reload(WIDGETS.text);
  const box = await page.locator(iframeSelector(WIDGETS.text)).boundingBox();
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await motion(frame)).state).toBe("paused");
  const held = await motion(frame);
  await page.waitForTimeout(500);
  expect((await motion(frame)).time).toBe(held.time);
  await glide(box.x + 3, box.y + box.height / 2);
  await expect.poll(async () => (await motion(frame)).state).toBe("running");

  const pause = headerOf(WIDGETS.text).locator('[data-plugin-action="pause"]');
  await pause.click({ force: true });
  await expect.poll(() => frame.evaluate(() => document.querySelector(".mq").classList.contains("is-paused"))).toBe(true);
  await glide(box.x + box.width / 2, box.y - 20);
  await expect.poll(async () => (await motion(frame)).state).toBe("paused");
  await pause.click({ force: true });
  await expect.poll(() => frame.evaluate(() => document.querySelector(".mq").classList.contains("is-paused"))).toBe(false);
  await expect.poll(async () => (await motion(frame)).state).toBe("running");
});

test("Pause freezes the updates as well as the movement, and the next press shows the current prices", async () => {
  const frame = await live();
  const pause = headerOf(WIDGETS.live).locator('[data-plugin-action="pause"]');
  const box = await page.locator(iframeSelector(WIDGETS.live)).boundingBox();
  await glide(box.x + box.width / 2, box.y - 20);
  await pause.click({ force: true });
  await expect.poll(async () => (await motion(frame)).state).toBe("paused");
  await expect(frame.locator(".mq-paused")).toBeVisible();
  const held = await texts(frame);
  backend.broadcast({ op: "set-item", ticker: "AAPL", value: "190.00", change: "+3.0%", tone: "up" });
  backend.broadcast({ op: "set-item", ticker: "GOOGL", value: "139.00", change: "-1.9%", tone: "down" });
  await page.waitForTimeout(1500);
  expect(await texts(frame)).toEqual(held);
  const frozen = await motion(frame);
  await page.waitForTimeout(500);
  expect((await motion(frame)).time).toBe(frozen.time);
  await glide(box.x + box.width / 2, box.y - 20);
  await pause.click({ force: true });
  await expect.poll(async () => (await texts(frame)).slice(0, 2)).toEqual(["AAPL Apple Inc. 190.00 +3.0%", "GOOGL Alphabet Inc. 139.00 -1.9%"]);
  await expect.poll(async () => (await motion(frame)).state).toBe("running");
  await expect(frame.locator(".mq-paused")).toBeHidden();
});

test("the stream shows its state, and one price changes without restarting the animation", async () => {
  const frame = await live();
  await expect.poll(() => texts(frame)).toEqual(STOCKS.map((stock) => quoteText(quoteItem(stock))));
  const tones = await frame.evaluate(() => [...document.querySelector(".mq-content").querySelectorAll(".mq-item")].map((node) => [...node.classList].find((name) => name.startsWith("mq-tone-"))));
  expect(tones).toEqual(["mq-tone-up", "mq-tone-down", "mq-tone-up", "mq-tone-up"]);
  const before = await motion(frame);
  backend.broadcast({ op: "set-item", ticker: "GOOGL", value: "142.10", change: "+0.2%", tone: "up" });
  await expect.poll(async () => (await texts(frame))[1]).toBe("GOOGL Alphabet Inc. 142.10 +0.2%");
  const after = await motion(frame);
  expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(after.name).toBe("mq-scroll-x");
  const everywhere = await frame.evaluate(() => [...document.querySelectorAll('[data-i="1"]')].map((node) => [node.querySelector(".mq-price").textContent, node.classList.contains("mq-tone-up"), /mq-flash-[ab]/.test(node.className)]));
  expect(everywhere.length).toBeGreaterThan(1);
  expect(everywhere.every(([price, up, flash]) => price === "142.10" && up && flash)).toBe(true);
  expect(await frame.evaluate(() => document.querySelector(".mq-dot").getAttribute("title"))).toBe("Live");
  await shot("live-prices", WIDGETS.live);
});

test("the stream adds, removes and replaces", async () => {
  const frame = await live();
  backend.broadcast({ op: "set-item", ticker: "NVDA", label: "NVIDIA Corporation", value: "480.00", change: "+3.0%", tone: "up", spark: [1, 2, 3] });
  await expect.poll(async () => (await texts(frame)).length).toBe(5);
  backend.broadcast({ op: "remove-item", ticker: "AMZN" });
  await expect.poll(async () => (await texts(frame)).some((text) => text.startsWith("AMZN"))).toBe(false);
  backend.broadcast({ op: "set-item", ticker: "AAPL", text: "AAPL $186.25 +1.8%", tone: "down", style: { fontWeight: "bold" } });
  await expect.poll(async () => (await texts(frame))[0]).toBe("AAPL $186.25 +1.8%");
  const aapl = await frame.evaluate(() => {
    const node = document.querySelector('[data-i="0"]');
    return { down: node.classList.contains("mq-tone-down"), up: node.classList.contains("mq-tone-up"), weight: node.style.fontWeight };
  });
  expect(aapl).toEqual({ down: true, up: false, weight: "bold" });
  backend.broadcast({ op: "set-content", text: "Prices are down", speed: 10, separator: " | " });
  await expect.poll(() => texts(frame)).toEqual(["Prices are down"]);
  expect((await motion(frame)).duration).toBe(10000);
  expect(await frame.evaluate(() => document.querySelector(".mq-sep").textContent)).toBe(" | ");
  backend.broadcast({ op: "set-content", items: STOCKS.map(quoteItem) });
  await expect.poll(async () => (await texts(frame)).length).toBe(4);
});

test("the stream sets the pause and the speed, and a bad message changes nothing", async () => {
  const frame = await live();
  backend.broadcast({ op: "set-content", paused: true });
  await expect.poll(async () => (await motion(frame)).state).toBe("paused");
  backend.broadcast({ op: "set-content", paused: false });
  await expect.poll(async () => (await motion(frame)).state).toBe("running");
  const before = await texts(frame);
  for (const bad of ['{"op":', "not json", JSON.stringify({ op: "explode" }), JSON.stringify([1, 2]), JSON.stringify({ op: "set-item" }), JSON.stringify({ op: "set-content", speed: "fast" })]) backend.broadcast(bad);
  backend.broadcast({ op: "set-item", ticker: "AAPL", html: `<img src="https://${CANARY}/x.png" onerror="window.__pwned=1"><script>window.__pwned=1</script><a href="javascript:window.__pwned=1">x</a>safe`, style: { backgroundColor: `url(https://${CANARY}/y)` } });
  await expect.poll(async () => (await texts(frame))[0]).toBe("xsafe");
  expect(await frame.evaluate(() => window.__pwned ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__pwned ?? null)).toBeNull();
  expect(await frame.evaluate(() => document.querySelector(".mq-content").querySelectorAll("img, script").length)).toBe(0);
  expect(await frame.evaluate((canary) => (window.__violations ?? []).filter((entry) => entry.includes(canary)), CANARY)).toEqual([]);
  expect((await texts(frame)).slice(1)).toEqual(before.slice(1));
});

test("a stream that drops comes back, and the dot says so", async () => {
  const frame = await live();
  backend.dropSockets();
  await expect.poll(() => frame.evaluate(() => document.querySelector(".mq-dot").dataset.state), { timeout: 15000 }).not.toBe("live");
  await frame.waitForSelector('.mq-dot[data-state="live"]', { timeout: 30000 });
  backend.broadcast({ op: "set-item", ticker: "MSFT", text: "MSFT back", tone: "neutral" });
  await expect.poll(async () => (await texts(frame))[2]).toBe("MSFT back");
});

test("each direction moves the content that way", async () => {
  const frame = await live();
  const expected = { left: ["x", -1], right: ["x", 1], up: ["y", -1], down: ["y", 1] };
  for (const [direction, [axis, sign]] of Object.entries(expected)) {
    backend.broadcast({ op: "set-content", direction, speed: 60, behavior: "scroll" });
    await expect.poll(async () => (await frame.evaluate(() => document.querySelector(".mq").dataset.direction))).toBe(direction);
    await expect(async () => {
      const first = await motion(frame);
      await page.waitForTimeout(400);
      const second = await motion(frame);
      expect(second.name).toBe(axis === "x" ? "mq-scroll-x" : "mq-scroll-y");
      expect(second.direction).toBe(sign < 0 ? "normal" : "reverse");
      expect(Math.sign(second[axis] - first[axis])).toBe(sign);
    }).toPass({ timeout: 8000 });
  }
});

test("alternate bounces, slide goes once and stops, and static stays and takes turns", async () => {
  const frame = await live();
  backend.broadcast({ op: "set-content", behavior: "alternate", direction: "left", speed: 20 });
  await expect.poll(async () => (await motion(frame)).name).toBe("mq-travel-x");
  const bounce = await motion(frame);
  expect(bounce).toMatchObject({ direction: "alternate", iterations: Infinity });
  const stage = await frame.evaluate(() => ({ stage: document.querySelector(".mq-stage").clientWidth, content: document.querySelector(".mq-content").offsetWidth }));
  const from = Number.parseFloat(bounce.from);
  const to = Number.parseFloat(bounce.to);
  expect(from).toBeGreaterThan(to);
  expect(Math.max(from, to)).toBe(Math.max(0, stage.stage - stage.content));
  expect(Math.min(from, to)).toBe(Math.min(0, stage.stage - stage.content));
  await shot("alternate", WIDGETS.live);

  backend.broadcast({ op: "set-content", behavior: "slide", direction: "left", speed: 1 });
  await expect.poll(async () => (await motion(frame)).state, { timeout: 10000 }).toBe("finished");
  const slid = await motion(frame);
  expect(slid.iterations).toBe(1);
  expect(Math.round(slid.x)).toBe(Math.round(Number.parseFloat(slid.to)));
  expect(await frame.evaluate(() => document.querySelector(".mq-content").querySelectorAll(".mq-item").length)).toBeGreaterThan(0);

  backend.broadcast({ op: "set-content", behavior: "static", speed: 1 });
  await expect.poll(async () => (await motion(frame)).animated).toBe(false);
  await expect.poll(async () => (await texts(frame)).length, { timeout: 5000 }).toBe(1);
  const seen = new Set();
  await expect(async () => {
    seen.add((await texts(frame))[0]);
    expect(seen.size).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 10000, intervals: [300] });
  expect(await frame.evaluate(() => document.querySelector(".mq-sep"))).toBeNull();
  await shot("static", WIDGETS.live);
});

test("the endpoint is asked again on its interval and the card follows it", async () => {
  const frame = await reload(WIDGETS.polled);
  const read = async () => Number(((await texts(frame))[0] ?? "").replace("Answer number ", ""));
  await expect.poll(read).toBeGreaterThan(0);
  const first = await read();
  await expect.poll(read, { timeout: 15000 }).toBeGreaterThan(first + 1);
  expect(backend.requests.filter((entry) => entry.startsWith("/polled")).length).toBeGreaterThan(3);
});

test("a click writes the clicked text to the card's parameter, and the endpoint is asked with it", async () => {
  const frame = await reload(WIDGETS.click);
  const box = await page.locator(iframeSelector(WIDGETS.click)).boundingBox();
  await glide(box.x + box.width / 2, box.y + box.height / 2);
  expect(await frame.evaluate(() => document.querySelector(".mq").classList.contains("is-clickable"))).toBe(true);
  await clickVisible(frame, WIDGETS.click, ".mq-item", "AAPL up");
  await expect.poll(() => backend.requests.some((entry) => entry.startsWith("/click?") && new URL(`http://x${entry}`).searchParams.get("value") === "AAPL up"), { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await texts(frame)).includes("You clicked AAPL up"), { timeout: 15000 }).toBe(true);
  await clickVisible(frame, WIDGETS.click, ".mq-item", "GOOGL down");
  await expect.poll(() => backend.requests.some((entry) => entry.startsWith("/click?") && new URL(`http://x${entry}`).searchParams.get("value") === "GOOGL"), { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await texts(frame)).includes("You clicked GOOGL"), { timeout: 15000 }).toBe(true);
});

test("an endpoint that sends hostile markup gets plain safe content, and nothing is requested from elsewhere", async () => {
  backend.serve("text", {
    items: [
      { html: `<img src="https://${CANARY}/a.png" onerror="window.__pwned=1"><script>window.__pwned=1</script><b onmouseover="window.__pwned=1">bold</b> <a href="javascript:window.__pwned=1">js</a> <a href="https://example.com/ok">ok</a> <span style="background:url(https://${CANARY}/b.png);color:red">styled</span> <iframe src="https://${CANARY}/c"></iframe>` },
      { text: "<img src=x onerror=window.__pwned=1> as text", ticker: "T" },
    ],
  });
  const frame = await reload(WIDGETS.text);
  await expect.poll(async () => (await texts(frame)).length).toBe(2);
  expect(await frame.evaluate(() => window.__pwned ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__pwned ?? null)).toBeNull();
  const found = await frame.evaluate(() => {
    const first = document.querySelector(".mq-content");
    return {
      forbidden: first.querySelectorAll("img, script, iframe, object, embed, svg, form").length,
      handlers: [...first.querySelectorAll("*")].flatMap((node) => [...node.attributes].map((attribute) => attribute.name)).filter((name) => /^on/i.test(name)),
      hrefs: [...first.querySelectorAll("a")].map((node) => node.getAttribute("href")),
      styles: [...first.querySelectorAll("[style]")].map((node) => node.getAttribute("style")),
      text: first.querySelectorAll(".mq-item")[1].textContent,
    };
  });
  expect(found.forbidden).toBe(0);
  expect(found.handlers).toEqual([]);
  expect(found.hrefs).toEqual([null, "https://example.com/ok"]);
  expect(found.styles.some((style) => style.includes(CANARY) || /url\(/.test(style))).toBe(false);
  expect(found.styles).toContain("color:red");
  expect(found.text).toBe("<img src=x onerror=window.__pwned=1> as text");
  expect(await frame.evaluate((canary) => (window.__violations ?? []).filter((entry) => entry.includes(canary)), CANARY)).toEqual([]);
  expect(await page.evaluate((canary) => (window.__violations ?? []).filter((entry) => entry.includes(canary)), CANARY)).toEqual([]);
  expect(backend.requests.filter((entry) => entry.includes(CANARY))).toEqual([]);
});

test("markup keeps the space between a bold run and the text after it", async () => {
  backend.serve("text", { items: [{ html: "<b>Reminder</b> Quarterly review on Thursday" }, "<b>Maintenance</b> Saturday 02:00-04:00 UTC"] });
  const frame = await reload(WIDGETS.text);
  await expect.poll(async () => (await texts(frame)).length).toBe(2);
  const gaps = await frame.evaluate(() =>
    [...document.querySelector(".mq-content").querySelectorAll(".mq-item")].map((item) => {
      const bold = item.querySelector("b");
      const range = document.createRange();
      range.setStart(bold.nextSibling, 1);
      range.setEnd(bold.nextSibling, 2);
      return range.getBoundingClientRect().left - bold.getBoundingClientRect().right;
    }),
  );
  expect(gaps).toHaveLength(2);
  for (const gap of gaps) expect(gap).toBeGreaterThan(2);
});

test("a link in the content asks the host to open it, with the host's confirmation", async () => {
  backend.serve("text", { items: [{ html: '<a href="https://example.com/docs">read the docs</a>' }] });
  const frame = await reload(WIDGETS.text);
  await clickVisible(frame, WIDGETS.text, ".mq-content a");
  const dialog = page.getByRole("dialog").filter({ hasText: "Opening External Link" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ws-hyper-link").first()).toHaveText("https://example.com/docs");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("the export dialog offers the items, and the files hold what the card shows", async () => {
  backend.serve("text", { items: [{ ticker: "AAPL", text: "AAPL $185.32 +1.2%", tone: "up" }, { text: "=SUM(1,1)" }, { html: "<b>Rich</b> text" }] });
  const frame = await reload(WIDGETS.text);
  await expect.poll(async () => (await texts(frame)).length).toBe(3);
  const json = await exportAs(WIDGETS.text, "Items (JSON)");
  expect(json.name).toMatch(/\.json$/);
  expect(JSON.parse(json.text)).toEqual([
    { ticker: "AAPL", text: "AAPL $185.32 +1.2%", tone: "up" },
    { ticker: "", text: "=SUM(1,1)", tone: "" },
    { ticker: "", text: "Rich text", tone: "" },
  ]);
  const csv = await exportAs(WIDGETS.text, "Items (CSV)");
  expect(csv.text).toBe(`ticker,text,tone\nAAPL,AAPL $185.32 +1.2%,up\n,"'=SUM(1,1)",\n,Rich text,\n`);
  const text = await exportAs(WIDGETS.text, "Text (TXT)");
  expect(text.text).toBe("AAPL $185.32 +1.2%\n=SUM(1,1)\nRich text");
});

test("the marquee follows the site's light and dark mode", async () => {
  const frame = await live();
  const read = () =>
    frame.evaluate(() => ({
      mode: document.querySelector(".mq-host").dataset.mode,
      color: getComputedStyle(document.querySelector(".mq")).color,
      background: getComputedStyle(document.querySelector(".mq-host")).backgroundColor,
    }));
  const first = await read();
  await shot(`mode-${first.mode}`, WIDGETS.live);
  await page.keyboard.press("Control+m");
  try {
    await expect.poll(async () => (await read()).mode).not.toBe(first.mode);
    const second = await read();
    expect(second.color).not.toBe(first.color);
    expect(second.background).not.toBe(first.background);
    await frame.waitForSelector(".mq-item");
    await shot(`mode-${second.mode}`, WIDGETS.live);
  } finally {
    await page.keyboard.press("Control+m");
  }
  await expect.poll(async () => (await read()).mode).toBe(first.mode);
});

test("with reduced motion nothing moves, and the content can be read by scrolling", async () => {
  backend.serve("text", "Breaking: markets rally as tech earnings beat expectations");
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    const frame = await reload(WIDGETS.text);
    await expect.poll(async () => (await texts(frame)).length).toBe(1);
    expect((await motion(frame)).animated).toBe(false);
    const found = await frame.evaluate(() => ({
      clones: [...document.querySelectorAll(".mq-clone")].map((node) => getComputedStyle(node).display),
      overflow: getComputedStyle(document.querySelector(".mq-stage")).overflowX,
    }));
    expect(found.clones.every((display) => display === "none")).toBe(true);
    expect(found.overflow).toBe("auto");
  } finally {
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
});
