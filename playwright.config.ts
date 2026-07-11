import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: "tmp/playwright",
  reporter: "line",
  testDir: "tests/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { height: 1_024, width: 1_536 } }
    },
    {
      name: "mobile",
      use: { hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } }
    }
  ],
  webServer: {
    command: "node dist/cli.js serve --report dist/dashboard --port 4173",
    reuseExistingServer: false,
    timeout: 15_000,
    url: "http://127.0.0.1:4173"
  }
});
