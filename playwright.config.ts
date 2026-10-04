import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.test", override: false, quiet: true });
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1, retries: 0,
  reporter: "list", timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3101", trace: "off", launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  webServer: {
    command: "tsx --env-file=.env.test scripts/prepare-test-db.ts && next dev --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/api/health", reuseExistingServer: false, timeout: 120000,
  },
});
