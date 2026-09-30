// لوحة المشرف: الطلاب (القائمة، المنع، الحذف، النقل بين المراحل، التقرير، الإكسل) وحسابات المشرفين
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, admin;
before(async () => { app = await startApp(); admin = await app.adminToken(); });
after(() => app.close());

const as = (method, path, body) => app.call(method, path, { token: admin, body });
const stageOf = id => app.db.prepare(`SELECT current_stage_id FROM students WHERE id = ?`).get(id).current_stage_id;

// يخلّص المرحلة الحالية للطالب مباشرة في قاعدة البيانات (أسرع من الطلبات، والانتقال بيحصل مع أول طلب)
function completeStageInDb(studentId, stageId) {
  const inStage = t => `SELECT x.id FROM ${t} x JOIN series se ON se.id = x.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ?`;
  for (const { id } of app.db.prepare(inStage("episodes")).all(stageId))
    app.db.prepare(`INSERT OR REPLACE INTO student_episode_progress (student_id, episode_id, listened) VALUES (?, ?, 1)`).run(studentId, id);
  for (const b of app.db.prepare(`SELECT x.id, x.total_pages FROM books x JOIN series se ON se.id = x.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ?`).all(stageId))
    app.db.prepare(`INSERT OR REPLACE INTO student_book_progress (student_id, book_id, current_page) VALUES (?, ?, ?)`).run(studentId, b.id, b.total_pages);
  for (const { id } of app.db.prepare(inStage("tests")).all(stageId))
    app.db.prepare(`INSERT INTO student_test_attempts (student_id, test_id, score, passed) VALUES (?, ?, 100, 1)`).run(studentId, id);
}

describe("قائمة الطلاب", () => {
  it("بتعرض الطلاب الأحدث الأول، من غير كلمات مرور", async () => {
    const s = await app.newStudent();
    const r = await as("GET", "/admin/students");
    assert.equal(r.status, 200);
    assert.equal(r.data[0].email, s.email);
    assert.doesNotMatch(JSON.stringify(r.data), /password|\$2[aby]\$/);
  });

  it("المنع والتفعيل بيسروا على الدخول فورًا", async () => {
    const s = await app.newStudent();
    await as("PATCH", `/admin/students/${s.id}/block`, { is_blocked: true });
    assert.equal((await app.call("POST", "/auth/login", { body: { email: s.email, password: "password123" } })).status, 403);
    await as("PATCH", `/admin/students/${s.id}/block`, { is_blocked: false });
    assert.equal((await app.call("POST", "/auth/login", { body: { email: s.email, password: "password123" } })).status, 200);
    assert.equal((await as("PATCH", `/admin/students/999999/block`, { is_blocked: true })).status, 404);
  });

  it("حذف الطالب بيحذف تقدمه ومابيقدرش يدخل", async () => {
    const s = await app.newStudent();
    completeStageInDb(s.id, stageOf(s.id));
    await as("DELETE", `/admin/students/${s.id}`);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM student_episode_progress WHERE student_id = ?`).get(s.id).n, 0);
    assert.equal((await app.call("POST", "/auth/login", { body: { email: s.email, password: "password123" } })).status, 401);
  });
});

describe("نقل الطالب بين المراحل", () => {
  it("النقل لقدّام مباشرة من غير تأكيد", async () => {
    const s = await app.newStudent();
    const second = app.stageByName("الثانية");
    const r = await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: second.id });
    assert.equal(r.status, 200);
    assert.equal(stageOf(s.id), second.id);
  });

  it("الرجوع لمرحلة لسه ماخلّصهاش بيحصل من غير تأكيد ومن غير مسح", async () => {
    const s = await app.newStudent();
    const intro = app.stageByName("التمهيدية"), first = app.stageByName("الأولى");
    app.db.prepare(`INSERT INTO student_episode_progress (student_id, episode_id, listened) SELECT ?, e.id, 1 FROM episodes e JOIN series se ON se.id = e.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).run(s.id, intro.id);
    await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: first.id });
    const r = await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: intro.id });
    assert.equal(r.status, 200);
    assert.equal(stageOf(s.id), intro.id);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM student_episode_progress WHERE student_id = ?`).get(s.id).n, 1, "التقدم ماتمسحش");
  });

  it("الرجوع لمرحلة خلّصها بيطلب تأكيد (409)، وبعد التأكيد بيعيدها من الأول وما بيرجعش لوحده", async () => {
    const s = await app.newStudent();
    const intro = app.stageByName("التمهيدية");
    completeStageInDb(s.id, intro.id);
    await app.call("GET", "/curriculum", { token: s.token }); // الانتقال التلقائي للأولى
    assert.equal(stageOf(s.id), app.stageByName("الأولى").id);
    assert.equal((await app.call("GET", `/progress/certificate/${intro.id}`, { token: s.token })).data.eligible, true);

    const ask = await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: intro.id });
    assert.equal(ask.status, 409);
    assert.equal(ask.data.needs_reset, true);
    assert.equal(stageOf(s.id), app.stageByName("الأولى").id, "من غير تأكيد مفيش حاجة اتغيّرت");

    const ok = await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: intro.id, reset: true });
    assert.equal(ok.status, 200);
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    const now = cur.stages.find(x => x.status === "current");
    assert.equal(now.name, "التمهيدية");
    assert.equal(now.progress.percent, 0);
    assert.equal((await app.call("GET", `/progress/certificate/${intro.id}`, { token: s.token })).data.eligible, false, "الشهادة اتشالت");
  });

  it("إعادة المرحلة لطالب مابتأثرش على طالب تاني", async () => {
    const a = await app.newStudent(), b = await app.newStudent();
    const intro = app.stageByName("التمهيدية");
    completeStageInDb(a.id, intro.id);
    completeStageInDb(b.id, intro.id);
    await as("PATCH", `/admin/students/${a.id}/stage`, { stage_id: intro.id, reset: true });
    assert.ok(app.db.prepare(`SELECT COUNT(*) n FROM student_episode_progress WHERE student_id = ?`).get(b.id).n > 0);
  });

  it("مرحلة أو طالب مش موجودين", async () => {
    const s = await app.newStudent();
    assert.equal((await as("PATCH", `/admin/students/${s.id}/stage`, { stage_id: 999999 })).status, 400);
    assert.equal((await as("PATCH", `/admin/students/999999/stage`, { stage_id: app.stageByName("الأولى").id })).status, 404);
  });
});

describe("التقارير", () => {
  it("تقرير الطالب: اللي خلّصه واللي بدأه بس (من غير اللي مابدأهوش)", async () => {
    const s = await app.newStudent();
    const book = app.db.prepare(`SELECT b.* FROM books b JOIN series se ON se.id = b.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(app.stageByName("التمهيدية").id);
    await app.call("POST", "/progress/book", { token: s.token, body: { book_id: book.id, current_page: 3 } });
    const r = (await as("GET", `/admin/students/${s.id}/report`)).data;
    assert.deepEqual(r.finished, []);
    assert.equal(r.started.length, 1);
    assert.match(r.started[0], /صفحة 3 من/);
  });

  it("ملف الإكسل: ورقتين، وكل الطلاب موجودين", async () => {
    const res = await app.call("GET", "/admin/reports/students.xlsx", { token: admin, raw: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /spreadsheetml/);
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.equal(wb.worksheets.length, 2);
    const students = app.db.prepare(`SELECT COUNT(*) n FROM students`).get().n;
    assert.equal(wb.worksheets[0].rowCount, students + 1, "صف لكل طالب + العناوين");
  });

  it("الإكسل للمشرف بس", async () => {
    const student = await app.demoStudentToken();
    assert.equal((await app.call("GET", "/admin/reports/students.xlsx", { token: student })).status, 403);
  });
});

describe("حسابات المشرفين", () => {
  it("تغيير كلمة المرور محتاج الحالية الصح وجديدة 8 أحرف", async () => {
    await as("POST", "/admin/account/admins", { full_name: "مشرف", email: "pw@t.com", password: "password123" });
    const token = await app.login("pw@t.com", "password123");
    const call = body => app.call("POST", "/admin/account/password", { token, body });
    assert.equal((await call({ current_password: "wrong", new_password: "newpass123" })).status, 400);
    assert.equal((await call({ current_password: "password123", new_password: "short" })).status, 400);
    assert.equal((await call({ current_password: "password123", new_password: "newpass123" })).status, 200);
    await app.login("pw@t.com", "newpass123");
  });

  it("إضافة مشرف: بريد صحيح وكلمة مرور 8 أحرف، ومن غير تكرار", async () => {
    assert.equal((await as("POST", "/admin/account/admins", { full_name: "x", email: "bad", password: "password123" })).status, 400);
    assert.equal((await as("POST", "/admin/account/admins", { full_name: "x", email: "a2@t.com", password: "short" })).status, 400);
    assert.equal((await as("POST", "/admin/account/admins", { full_name: "x", email: "a2@t.com", password: "password123" })).status, 201);
    assert.equal((await as("POST", "/admin/account/admins", { full_name: "x", email: "A2@t.com", password: "password123" })).status, 409);
  });

  it("قائمة المشرفين من غير كلمات مرور، والمشرف مايقدرش يحذف نفسه", async () => {
    const list = (await as("GET", "/admin/account/admins")).data;
    assert.doesNotMatch(JSON.stringify(list), /password|\$2[aby]\$/);
    const me = (await as("GET", "/admin/account/me")).data;
    assert.equal((await as("DELETE", `/admin/account/admins/${me.id}`)).status, 400);
  });
});
