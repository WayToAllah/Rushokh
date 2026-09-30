// playwright.config.js — اختبارات المتصفح (npm run test:e2e)
// على الجهاز بيستخدم متصفح Edge المتسطّب (مش محتاج تنزيل متصفح). في GitHub Actions بيستخدم Chromium.
// نسختين من الموقع: "main" من غير إيميل، و"mail" بسيرفر إيميل وهمي لاختبارات تأكيد البريد ونسيت كلمة المرور.
const { defineConfig } = require("@playwright/test");

const PORT = 4199;
const MAIL_PORT = 4197;
const MAILBOX_PORT = 4196;

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  workers: 1, // كل الاختبارات على نفس السيرفر وقاعدة البيانات
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    channel: process.env.PW_CHANNEL || (process.env.CI ? undefined : "msedge"),
    viewport: { width: 1280, height: 800 },
    locale: "ar-EG",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "main", testIgnore: /[\\/]mail[\\/]/, use: { baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "mail", testMatch: /[\\/]mail[\\/].*\.spec\.js$/, use: { baseURL: `http://127.0.0.1:${MAIL_PORT}` } },
  ],
  webServer: [
    {
      command: "node e2e/serve.js",
      url: `http://127.0.0.1:${PORT}/api/health`,
      env: { E2E_PORT: String(PORT) },
      reuseExistingServer: false,
      timeout: 30 * 1000,
    },
    {
      command: "node e2e/serve.js",
      url: `http://127.0.0.1:${MAIL_PORT}/api/health`,
      env: { E2E_PORT: String(MAIL_PORT), E2E_MAIL: "1", E2E_MAILBOX_PORT: String(MAILBOX_PORT) },
      reuseExistingServer: false,
      timeout: 30 * 1000,
    },
  ],
});
