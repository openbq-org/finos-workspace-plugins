import { expect, test } from "@playwright/test";
import { WIDGETS } from "./backend.mjs";
import { CASES } from "./hostile.mjs";
import { closeAgent, EMAIL, frameOf, PASSWORD, prepare } from "./harness.mjs";

test.describe.configure({ mode: process.env.E2E_CONTINUE ? "default" : "serial" });
test.skip(!(EMAIL && PASSWORD), "E2E_USER_EMAIL and E2E_USER_PASSWORD name an administrator of the stack under test");

const PROBE = WIDGETS.map_probe.name;
const SOURCES = WIDGETS.map_probe_sources.name;
const SHELL_PROBES = /ws-canary\.invalid|^script-src/;

let stack;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(300000);
  stack = await prepare({ browser, project: testInfo.project, widgets: ["map_probe", "map_probe_sources"] });
});

test.afterAll(async () => {
  await stack?.teardown();
});

async function show(body, name = PROBE) {
  stack.backend.serve(body);
  await stack.page.reload();
  await closeAgent(stack.page);
  const frame = await frameOf(stack.page, name);
  await frame.waitForFunction(
    () => {
      if (document.querySelector('[role="toolbar"][aria-label="Map view"]')) return true;
      const message = document.querySelector('p[role="alert"], p[role="status"]');
      return Boolean(message && !/^Loading/.test(message.textContent ?? ""));
    },
    null,
    { timeout: 90000 },
  );
  return frame;
}

const message = (frame) => frame.evaluate(() => document.querySelector('p[role="alert"], p[role="status"]')?.textContent ?? "");
const drawn = (frame) => frame.evaluate(() => Boolean(document.querySelector('[role="toolbar"][aria-label="Map view"]')));
const violations = async (frame) => (await frame.evaluate(() => window.__violations ?? [])).filter((entry) => !SHELL_PROBES.test(entry));

for (const hostile of CASES) {
  test(hostile.name, async () => {
    const frame = await show(hostile.body);
    expect(await frame.evaluate(() => document.readyState), "the frame answers").toBe("complete");
    expect(await frame.evaluate(() => window.__pwned ?? null), "script ran in the frame").toBeNull();
    expect(await stack.page.evaluate(() => window.__pwned ?? null), "script ran in the host").toBeNull();
    expect(await frame.evaluate(() => document.querySelectorAll("img, iframe, [onerror], [onload], [onclick]").length), "elements made from the data").toBe(0);

    const shown = await drawn(frame);
    const said = await message(frame);
    if (hostile.drawn) expect(shown, said).toBe(true);
    if (hostile.refused) {
      expect(shown).toBe(false);
      expect(said).toMatch(hostile.refused);
      expect(said.length).toBeLessThanOrEqual(2500);
    }
    if (hostile.status) expect(said).toMatch(hostile.status);
    if (hostile.settles) expect(shown || said.length > 0).toBe(true);
    if (hostile.pollutes) {
      expect(await frame.evaluate(() => ({}).polluted ?? null)).toBeNull();
      expect(await stack.page.evaluate(() => ({}).polluted ?? null)).toBeNull();
    }

    if (shown && (hostile.table || hostile.only || hostile.longest)) {
      const toggle = frame.getByRole("button", { name: "Show data" });
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
      const table = frame.getByRole("region", { name: /^Data of map/ });
      await expect(table).toBeVisible();
      const heads = await table.getByRole("rowheader").allTextContents();
      for (const text of hostile.table ?? []) await expect(table.getByText(text, { exact: true }).first()).toBeVisible();
      if (hostile.only) {
        const expected = hostile.body.filter((row) => hostile.only.test(row.label)).length;
        expect(heads.length).toBe(expected);
        for (const head of heads) expect(head).toMatch(hostile.only);
      }
      if (hostile.longest) for (const head of heads) expect(head.length).toBeLessThanOrEqual(hostile.longest);
      expect(await frame.evaluate(() => window.__pwned ?? null)).toBeNull();
    }

    expect(await violations(frame), "the browser blocked a request").toEqual([]);
  });
}

test("hostile map sources are refused with their reasons, and none of them is ever requested", async () => {
  const REFUSED = ["insecure.example", "tiles.example", "passwd", "javascript", "alert"];
  const urls = [];
  stack.page.context().on("request", (request) => urls.push(request.url()));
  stack.page.context().on("requestfailed", (request) => urls.push(request.url()));
  const frame = await show([{ label: "a", lat: 40.7, lon: -74, value: 1 }], SOURCES);
  await frame.waitForTimeout(6000);
  expect(await drawn(frame)).toBe(true);
  await expect(frame.getByText(/6 map sources are not drawn/).first()).toBeVisible();
  await frame.getByRole("button", { name: "Details" }).click();
  const text = await frame.evaluate(() => document.body.innerText);
  expect(text).toContain("6 map sources are not drawn: script: its url is not taken: it does not start with http:// or https://; data: ");
  expect(text).toContain("dots: its url is not taken: its path has a dot segment");
  expect(text).not.toContain("unlisted:");
  const blocked = (await frame.evaluate(() => window.__violations ?? [])).filter((entry) => !SHELL_PROBES.test(entry)).join("\n");
  for (const refused of REFUSED) {
    expect(blocked, refused).not.toContain(refused);
    expect(urls.filter((url) => url.includes(refused)), refused).toEqual([]);
  }
  expect(await frame.evaluate(() => window.__pwned ?? null)).toBeNull();
  const reports = await stack.call("GET", "/plugins/map-widget/csp-reports");
  const mine = reports.filter((report) => Date.parse(report.last_seen) >= stack.started - 2000).map((report) => `${report.directive} ${report.origin}`).join("\n");
  for (const refused of REFUSED) expect(mine, refused).not.toContain(refused);
});
