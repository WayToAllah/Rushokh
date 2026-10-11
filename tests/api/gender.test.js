// النوع (ذكر / أنثى): في التسجيل، وللحسابات القديمة، وفي الشهادة وقائمة المشرف
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

describe("النوع", () => {
  it("بيتحفظ مع التسجيل، وقيمة غلط بتترفض", async () => {
    const s = await app.newStudent({ gender: "female" });
    assert.equal(app.db.prepare(`SELECT gender FROM students WHERE id = ?`).get(s.id).gender, "female");
    const bad = await app.call("POST", "/auth/register", { body: { full_name: "س", email: "g-bad@test.com", password: "password123", gender: "x" } });
    assert.equal(bad.status, 400);
  });

  it("الحساب القديم من غير نوع: المنهج بيرجّع gender فاضي، والطالب يختاره مرة", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("GET", "/curriculum", { token: s.token })).data.gender, null);
    assert.equal((await app.call("POST", "/account/gender", { token: s.token, body: { gender: "other" } })).status, 400);
    assert.equal((await app.call("POST", "/account/gender", { token: s.token, body: { gender: "male" } })).status, 200);
    assert.equal((await app.call("GET", "/curriculum", { token: s.token })).data.gender, "male");
  });

  it("الشهادة وقائمة الطلاب عند المشرف فيهم النوع", async () => {
    const s = await app.newStudent({ gender: "female" });
    const stage = app.stageByName("التمهيدية");
    assert.equal((await app.call("GET", `/progress/certificate/${stage.id}`, { token: s.token })).data.gender, "female");
    const admin = await app.adminToken();
    const list = (await app.call("GET", "/admin/students", { token: admin })).data;
    assert.equal(list.find(x => x.id === s.id).gender, "female");
  });
});
