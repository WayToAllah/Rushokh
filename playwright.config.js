// playwright.config.js — اختبارات المتصفح (npm run test:e2e)
// على الجهاز بيستخدم متصفح Edge المتسطّب (مش محتاج تنزيل متصفح). في GitHub Actions بيستخدم Chromium.
const { defineConfig } = require("@playwright/test");

const PORT = 4199;

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  workers: 1, // كل الاختبارات على نفس السيرفر وقاعدة البيانات
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.PW_CHANNEL || (process.env.CI ? undefined : "msedge"),
    viewport: { width: 1280, height: 800 },
    locale: "ar-EG",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/serve.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30 * 1000,
  },
});
