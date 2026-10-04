import { defineConfig, devices } from "@playwright/test";
import { createTestWallet } from "./tests/helpers/wallet.ts";

const PORT = 5174;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      CMX_DB: "memory",
      CMX_FAKE_PRICES: "1",
      CMX_FAKE_CHAIN: "1",
      ADMIN_STAKE_ADDRESSES: createTestWallet("e2e-admin").rewardAddress,
    },
  },
});
