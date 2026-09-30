// لوحة المشرف: إنشاء الاختبارات والأسئلة وتعديلها
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, admin, seriesId;
before(async () => {
  app = await startApp();
  admin = await app.adminToken();
  seriesId = app.db.prepare(`SELECT id FROM series ORDER BY id LIMIT 1`).get().id;
});
after(() => app.close());

const as = (method, path, body) => app.call(method, "/admin/tests" + path, { token: admin, body });
const options = (correctIndex, n = 3) => Array.from({ length: n }, (_, i) => ({ text: `خيار ${i + 1}`, is_correct: i === correctIndex }));

describe("الاختبارات", () => {
  it("الطالب مايقدرش يوصل لإجابات المشرف (403)", async () => {
    const student = await app.demoStudentToken();
    assert.equal((await app.call("GET", "/admin/tests", { token: student })).status, 403);
  });

  it("اختبار جديد: نسبة النجاح الافتراضية 60، وأي نسبة برّه 1-100 بترجع للافتراضي", async () => {
    for (const [given, expected] of [[undefined, 60], [75, 75], [0, 60], [150, 60], ["abc", 60]]) {
      const r = await as("POST", "", { series_id: seriesId, title: "اختبار", pass_percent: given });
      assert.equal(r.status, 201);
      assert.equal(app.db.prepare(`SELECT pass_percent FROM tests WHERE id = ?`).get(r.data.id).pass_percent, expected, String(given));
    }
  });

  it("تعديل نسبة النجاح لرقم غلط مرفوض (400)", async () => {
    const t = (await as("POST", "", { series_id: seriesId, title: "x" })).data;
    for (const bad of [0, 101, "x"]) assert.equal((await as("PATCH", `/${t.id}`, { pass_percent: bad })).status, 400);
    assert.equal((await as("PATCH", `/${t.id}`, { pass_percent: 80, title: "جديد" })).status, 200);
    assert.equal((await as("PATCH", `/999999`, { title: "x" })).status, 404);
  });

  it("اختبار لسلسلة مش موجودة (400 مش 500)", async () => {
    const r = await as("POST", "", { series_id: 999999, title: "x" });
    assert.equal(r.status, 400);
  });

  it("حذف الاختبار بيحذف أسئلته ومحاولات الطلاب", async () => {
    const t = (await as("POST", "", { series_id: seriesId, title: "هيتحذف" })).data;
    const q = (await as("POST", "/questions", { test_id: t.id, text: "س", options: options(0) })).data;
    assert.equal((await as("DELETE", `/${t.id}`)).status, 200);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM questions WHERE id = ?`).get(q.id).n, 0);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM options WHERE question_id = ?`).get(q.id).n, 0);
  });
});

describe("الأسئلة", () => {
  it("سؤال بخياراته، وبيظهر للمشرف ومعاه الإجابة الصحيحة", async () => {
    const t = (await as("POST", "", { series_id: seriesId, title: "أسئلة" })).data;
    const r = await as("POST", "/questions", { test_id: t.id, text: "  ما هو؟  ", options: options(1) });
    assert.equal(r.status, 201);
    const listed = (await as("GET", "")).data.find(x => x.id === t.id);
    assert.equal(listed.questions[0].text, "ما هو؟");
    assert.deepEqual(listed.questions[0].options.map(o => o.is_correct), [0, 1, 0]);
  });

  for (const [label, opts] of [
    ["من غير إجابة صحيحة", options(-1)],
    ["بإجابتين صح", [{ text: "أ", is_correct: true }, { text: "ب", is_correct: true }]],
    ["بخيار واحد بس", [{ text: "أ", is_correct: true }]],
    ["خياراته فاضية", [{ text: " ", is_correct: true }, { text: "", is_correct: false }]],
    ["من غير خيارات", undefined],
  ]) {
    it(`سؤال ${label} مرفوض (400)`, async () => {
      const t = (await as("POST", "", { series_id: seriesId, title: "x" })).data;
      const r = await as("POST", "/questions", { test_id: t.id, text: "س", options: opts });
      assert.equal(r.status, 400);
      assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM questions WHERE test_id = ?`).get(t.id).n, 0, "ماتحفظش نص سؤال");
    });
  }

  it("الخيارات الفاضية بتتشال والباقي بيتحفظ", async () => {
    const t = (await as("POST", "", { series_id: seriesId, title: "x" })).data;
    const q = (await as("POST", "/questions", { test_id: t.id, text: "س", options: [{ text: "أ", is_correct: true }, { text: "" }, { text: "ب" }] })).data;
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM options WHERE question_id = ?`).get(q.id).n, 2);
  });

  it("تعديل السؤال بيبدّل الخيارات كلها، ولو الجديدة غلط القديمة بتفضل زي ما هي", async () => {
    const t = (await as("POST", "", { series_id: seriesId, title: "x" })).data;
    const q = (await as("POST", "/questions", { test_id: t.id, text: "س", options: options(0, 4) })).data;
    const bad = await as("PATCH", `/questions/${q.id}`, { options: options(-1, 2) });
    assert.equal(bad.status, 400);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM options WHERE question_id = ?`).get(q.id).n, 4, "القديمة موجودة");
    const ok = await as("PATCH", `/questions/${q.id}`, { text: "س جديد", options: options(1, 2) });
    assert.equal(ok.status, 200);
    const opts = app.db.prepare(`SELECT is_correct FROM options WHERE question_id = ? ORDER BY id`).all(q.id).map(o => o.is_correct);
    assert.deepEqual(opts, [0, 1]);
  });

  it("سؤال لاختبار مش موجود (400)، وتعديل سؤال مش موجود (404)", async () => {
    assert.equal((await as("POST", "/questions", { test_id: 999999, text: "س", options: options(0) })).status, 400);
    assert.equal((await as("PATCH", `/questions/999999`, { text: "x" })).status, 404);
  });
});
