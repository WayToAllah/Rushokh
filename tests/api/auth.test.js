// الدخول والتسجيل والجلسات
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

describe("التسجيل", () => {

  it("طالب جديد بيتسجّل وياخد توكن ويبدأ في أول مرحلة", async () => {
    const r = await app.call("POST", "/auth/register", {
      body: { full_name: "  محمد  ", email: "New@Test.com", password: "password123", phone: "0100", age: 20, address: "القاهرة" },
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.token);
    assert.equal(r.data.student.email, "new@test.com", "البريد بيتحفظ بحروف صغيرة");
    const row = app.db.prepare(`SELECT * FROM students WHERE email = 'new@test.com'`).get();
    assert.equal(row.full_name, "محمد", "المسافات الزيادة بتتشال");
    assert.equal(row.current_stage_id, app.stages()[0].id);
    assert.equal(row.email_verified, 1, "من غير إعدادات إيميل الحساب بيتعتبر متأكد");
    assert.notEqual(row.password_hash, "password123", "كلمة المرور متشفّرة");
  });

  for (const [label, body] of [
    ["من غير اسم", { email: "a@t.com", password: "password123" }],
    ["من غير بريد", { full_name: "x", password: "password123" }],
    ["من غير كلمة مرور", { full_name: "x", email: "a@t.com" }],
    ["بريد غلط", { full_name: "x", email: "not-an-email", password: "password123" }],
    ["كلمة مرور قصيرة", { full_name: "x", email: "a@t.com", password: "1234567" }],
    ["اسم مسافات بس", { full_name: "   ", email: "a@t.com", password: "password123" }],
  ]) {
    it(`بيرفض التسجيل ${label} (400)`, async () => {
      const r = await app.call("POST", "/auth/register", { body });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /\S/);
    });
  }

  it("بيرفض بريد متسجّل قبل كده حتى لو بحروف كبيرة (409)", async () => {
    await app.call("POST", "/auth/register", { body: { full_name: "x", email: "dup@t.com", password: "password123" } });
    const r = await app.call("POST", "/auth/register", { body: { full_name: "y", email: "DUP@t.com", password: "password123" } });
    assert.equal(r.status, 409);
  });

  it("عمر خارج المعقول بيتحفظ فاضي بدل ما يرفض التسجيل", async () => {
    const s = await app.newStudent({ age: 500 });
    assert.equal(app.db.prepare(`SELECT age FROM students WHERE id = ?`).get(s.id).age, null);
  });

  it("5 حسابات بس من نفس الجهاز في الساعة", async () => {
    const ip = "10.200.0.1";
    for (let i = 0; i < 5; i++) {
      const r = await app.call("POST", "/auth/register", { ip, body: { full_name: "x", email: `limit${i}@t.com`, password: "password123" } });
      assert.equal(r.status, 201);
    }
    const r = await app.call("POST", "/auth/register", { ip, body: { full_name: "x", email: "limit6@t.com", password: "password123" } });
    assert.equal(r.status, 429);
  });
});

describe("الدخول", () => {

  it("نفس الخانة بتدخّل المشرف كمشرف والطالب كطالب", async () => {
    const a = await app.call("POST", "/auth/login", { body: { email: "ADMIN@rasokh.test", password: "admin123" } });
    assert.equal(a.status, 200);
    assert.equal(a.data.role, "admin");
    const s = await app.call("POST", "/auth/login", { body: { email: "ahmed@rasokh.test", password: "student123" } });
    assert.equal(s.data.role, "student");
    assert.equal(jwt.decode(s.data.token).role, "student");
  });

  it("بريد واحد ليه حساب مشرف وحساب طالب: كلمة المرور هي اللي بتحدد", async () => {
    await app.call("POST", "/auth/register", { body: { full_name: "x", email: "admin@rasokh.test", password: "student-pass-1" } });
    const asStudent = await app.call("POST", "/auth/login", { body: { email: "admin@rasokh.test", password: "student-pass-1" } });
    const asAdmin = await app.call("POST", "/auth/login", { body: { email: "admin@rasokh.test", password: "admin123" } });
    assert.equal(asStudent.data.role, "student");
    assert.equal(asAdmin.data.role, "admin");
  });

  it("كلمة مرور غلط وبريد مش موجود بيدّوا نفس الرسالة (محدش يعرف مين عنده حساب)", async () => {
    const wrong = await app.call("POST", "/auth/login", { body: { email: "ahmed@rasokh.test", password: "wrong-pass" } });
    const none = await app.call("POST", "/auth/login", { body: { email: "nobody@rasokh.test", password: "wrong-pass" } });
    assert.equal(wrong.status, 401);
    assert.equal(none.status, 401);
    assert.equal(wrong.data.error, none.data.error);
  });

  it("الطالب الموقوف مايقدرش يدخل (403)", async () => {
    const s = await app.newStudent();
    app.db.prepare(`UPDATE students SET is_blocked = 1 WHERE id = ?`).run(s.id);
    const r = await app.call("POST", "/auth/login", { body: { email: s.email, password: "password123" } });
    assert.equal(r.status, 403);
  });

  it("10 محاولات غلط بتقفل الجهاز اللي بيجرّب بس، وصاحب الحساب بيدخل عادي", async () => {
    const attacker = "10.66.6.6";
    let last;
    for (let i = 0; i < 11; i++) {
      last = await app.call("POST", "/auth/login", { ip: attacker, body: { email: "admin@rasokh.test", password: "guess" + i } });
    }
    assert.equal(last.status, 429);
    const blockedEvenWithRight = await app.call("POST", "/auth/login", { ip: attacker, body: { email: "admin@rasokh.test", password: "admin123" } });
    assert.equal(blockedEvenWithRight.status, 429, "الجهاز المقفول مقفول حتى بالباسورد الصح");
    const owner = await app.call("POST", "/auth/login", { body: { email: "admin@rasokh.test", password: "admin123" } });
    assert.equal(owner.status, 200, "المشرف الحقيقي من جهازه مش متأثر");
  });

  it("أكتر من 20 طلب دخول في الدقيقة من نفس الجهاز بيتوقف", async () => {
    const ip = "10.77.7.7";
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await app.call("POST", "/auth/login", { ip, body: { email: `x${i}@t.com`, password: "whatever1" } })).status);
    }
    assert.equal(statuses[19], 401);
    assert.equal(statuses[20], 429);
  });

  it("دخول المشرف القديم (/admin-login) بيرفض حسابات الطلاب", async () => {
    const r = await app.call("POST", "/auth/admin-login", { body: { email: "ahmed@rasokh.test", password: "student123" } });
    assert.equal(r.status, 401);
  });

  it("من غير بريد أو كلمة مرور (400)", async () => {
    assert.equal((await app.call("POST", "/auth/login", { body: { email: "a@t.com" } })).status, 400);
    assert.equal((await app.call("POST", "/auth/login", { body: { password: "x" } })).status, 400);
    assert.equal((await app.call("POST", "/auth/login", { body: { email: 5, password: [] } })).status, 400);
  });
});

describe("الجلسات (التوكن)", () => {

  it("من غير توكن (401)", async () => {
    assert.equal((await app.call("GET", "/curriculum")).status, 401);
    assert.equal((await app.call("GET", "/admin/students")).status, 401);
  });

  it("توكن متزوّر بمفتاح تاني أو المفتاح القديم المكتوب في الكود (401)", async () => {
    for (const secret of ["rasokh-dev-secret-change-me", "some-other-secret"]) {
      const forged = jwt.sign({ id: 1, role: "admin" }, secret);
      assert.equal((await app.call("GET", "/admin/students", { token: forged })).status, 401);
    }
  });

  it("توكن منتهي (401)", async () => {
    const expired = jwt.sign({ id: 1, role: "admin", exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    assert.equal((await app.call("GET", "/admin/students", { token: expired })).status, 401);
  });

  it("توكن بدور مش معروف (401)", async () => {
    const odd = jwt.sign({ id: 1, role: "teacher" }, process.env.JWT_SECRET);
    assert.equal((await app.call("GET", "/curriculum", { token: odd })).status, 401);
  });

  it("الطالب مايقدرش يستخدم مسارات المشرف، والمشرف مايقدرش يستخدم مسارات الطالب (403)", async () => {
    const student = await app.demoStudentToken();
    const admin = await app.adminToken();
    assert.equal((await app.call("GET", "/admin/students", { token: student })).status, 403);
    assert.equal((await app.call("GET", "/curriculum", { token: admin })).status, 403);
  });

  it("الطالب اللي اتحذف أو اتوقف بتقف جلسته المفتوحة فورًا", async () => {
    const a = await app.newStudent();
    const b = await app.newStudent();
    assert.equal((await app.call("GET", "/curriculum", { token: a.token })).status, 200);
    app.db.prepare(`DELETE FROM students WHERE id = ?`).run(a.id);
    app.db.prepare(`UPDATE students SET is_blocked = 1 WHERE id = ?`).run(b.id);
    assert.equal((await app.call("GET", "/curriculum", { token: a.token })).status, 401);
    assert.equal((await app.call("GET", "/curriculum", { token: b.token })).status, 403);
  });

  it("المشرف اللي اتحذف بتقف جلسته (401)", async () => {
    const admin = await app.adminToken();
    const add = await app.call("POST", "/admin/account/admins", { token: admin, body: { full_name: "م", email: "second@t.com", password: "password123" } });
    const second = await app.login("second@t.com", "password123");
    await app.call("DELETE", `/admin/account/admins/${add.data.id}`, { token: admin });
    assert.equal((await app.call("GET", "/admin/students", { token: second })).status, 401);
  });
});

describe("كلمة مرور الطالب", () => {

  it("الطالب بيغيّر كلمة مروره بالحالية الصح بس", async () => {
    const s = await app.newStudent();
    const wrong = await app.call("POST", "/account/password", { token: s.token, body: { current_password: "nope", new_password: "newpass123" } });
    assert.equal(wrong.status, 400);
    const short = await app.call("POST", "/account/password", { token: s.token, body: { current_password: "password123", new_password: "short" } });
    assert.equal(short.status, 400);
    const ok = await app.call("POST", "/account/password", { token: s.token, body: { current_password: "password123", new_password: "newpass123" } });
    assert.equal(ok.status, 200);
    await app.login(s.email, "newpass123");
  });

  it("المشرف بيحط كلمة مرور جديدة لطالب نسي، والطالب بيدخل بيها", async () => {
    const s = await app.newStudent();
    const admin = await app.adminToken();
    const r = await app.call("PATCH", `/admin/students/${s.id}/password`, { token: admin, body: { new_password: "reset12345" } });
    assert.equal(r.status, 200);
    await app.login(s.email, "reset12345");
    const missing = await app.call("PATCH", `/admin/students/999999/password`, { token: admin, body: { new_password: "reset12345" } });
    assert.equal(missing.status, 404);
  });
});
