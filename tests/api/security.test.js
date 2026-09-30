// الأمان العام: الترويسات، الطلبات الغلط، وإن كلمات المرور عمرها ما بتطلع في أي رد
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

describe("ترويسات الأمان", () => {
  it("موجودة على الصفحات وعلى الـ API، ومن غير X-Powered-By", async () => {
    for (const url of ["/", "/index.html", "/api/health"]) {
      const res = await fetch(app.base + url);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", url);
      assert.equal(res.headers.get("x-frame-options"), "DENY", url);
      assert.ok(res.headers.get("referrer-policy"), url);
      assert.equal(res.headers.get("x-powered-by"), null, url);
    }
  });
});

describe("طلبات غلط", () => {
  it("مسار API مش موجود بيرجّع 404 بالعربي", async () => {
    const r = await app.call("GET", "/nothing-here");
    assert.equal(r.status, 404);
    assert.match(r.data.error, /غير موجود/);
  });

  it("JSON مكسور (400)", async () => {
    const r = await app.call("POST", "/auth/login", { body: "{bad json", headers: { "Content-Type": "application/json" } });
    assert.equal(r.status, 400);
  });

  it("بيانات أكبر من 100KB بترجع 413 مش خطأ سيرفر", async () => {
    const r = await app.call("POST", "/auth/register", { body: { full_name: "x".repeat(150 * 1024), email: "big@t.com", password: "password123" } });
    assert.equal(r.status, 413);
  });

  it("محاولة SQL injection في الدخول مابتعديش", async () => {
    const r = await app.call("POST", "/auth/login", { body: { email: "' OR 1=1 --", password: "' OR '1'='1" } });
    assert.equal(r.status, 401);
  });

  it("الاسم اللي فيه كود بيتحفظ كنص عادي (الصفحات هي اللي بتعرضه آمن)", async () => {
    const s = await app.newStudent({ full_name: "<img src=x onerror=alert(1)>" });
    assert.equal(app.db.prepare(`SELECT full_name FROM students WHERE id = ?`).get(s.id).full_name, "<img src=x onerror=alert(1)>");
  });
});

describe("كلمات المرور مابتطلعش في أي رد", () => {
  it("ولا في ردود الطالب ولا المشرف", async () => {
    const admin = await app.adminToken();
    const s = await app.newStudent();
    const leak = /password_hash|\$2[aby]\$\d\d\$/;
    for (const [token, path] of [
      [s.token, "/curriculum"], [s.token, "/progress/me/report"], [s.token, `/progress/certificate/${app.stages()[0].id}`],
      [admin, "/admin/students"], [admin, `/admin/students/${s.id}/report`], [admin, "/admin/account/admins"],
      [admin, "/admin/account/me"], [admin, "/admin/content/tree"], [admin, "/admin/tests"],
    ]) {
      const r = await app.call("GET", path, { token });
      assert.equal(r.status, 200, path);
      assert.doesNotMatch(JSON.stringify(r.data), leak, path);
    }
  });

  it("ولا في رد الدخول أو التسجيل", async () => {
    const reg = await app.call("POST", "/auth/register", { body: { full_name: "x", email: "leak@t.com", password: "password123" } });
    const log = await app.call("POST", "/auth/login", { body: { email: "leak@t.com", password: "password123" } });
    assert.doesNotMatch(JSON.stringify(reg.data) + JSON.stringify(log.data), /password/);
  });
});
