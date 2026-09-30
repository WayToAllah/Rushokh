// فحص الصحة اللي خدمة المراقبة بتسأله
const { it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

it("السيرفر وقاعدة البيانات شغّالين: 200", async () => {
  const r = await app.call("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

it("لو قاعدة البيانات وقفت: 503 عشان المراقبة تنبّه", async () => {
  app.db.close();
  const r = await app.call("GET", "/health");
  assert.equal(r.status, 503);
  assert.equal(r.data.ok, false);
});
