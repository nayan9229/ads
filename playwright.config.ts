import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx http-server -p 4173 -c-1 --silent .",
    url: "http://127.0.0.1:4173/test-page/index.html",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
