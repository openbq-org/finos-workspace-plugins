import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  workers: 1,
  retries: 0,
  timeout: 180000,
  reporter: [["list"]],
  outputDir: ".results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:1420",
    ignoreHTTPSErrors: true,
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
