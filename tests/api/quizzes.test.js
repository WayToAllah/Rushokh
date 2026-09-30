// الاختبارات عند الطالب: الأسئلة من غير الإجابات، والتصحيح في السيرفر
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, introTest, questions;
before(async () => {
  app = await startApp();
  const intro = app.stageByName("التمهيدية");
  introTest = app.db.prepare(
    `SELECT t.* FROM tests t JOIN series se ON se.id = t.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ?`
  ).get(intro.id);
  questions = app.db.prepare(`SELECT id FROM questions WHERE test_id = ? ORDER BY order_index`).all(introTest.id).map(q => ({
    id: q.id,
    right: app.db.prepare(`SELECT id FROM options WHERE question_id = ? AND is_correct = 1`).get(q.id).id,
    wrong: app.db.prepare(`SELECT id FROM options WHERE question_id = ? AND is_correct = 0 LIMIT 1`).get(q.id).id,
  }));
});
after(() => app.close());

const attempt = (token, answers, id = introTest.id) => app.call("POST", `/tests/${id}/attempt`, { token, body: { answers } });

describe("فتح الاختبار", () => {
  it("الأسئلة والخيارات بتوصل من غير ما تكشف الإجابة الصحيحة", async () => {
    const s = await app.newStudent();
    const r = await app.call("GET", `/tests/${introTest.id}`, { token: s.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.questions.length, questions.length);
    assert.doesNotMatch(JSON.stringify(r.data), /is_correct/);
    for (const q of r.data.questions) assert.ok(q.options.length >= 2);
  });

  it("اختبار مش موجود (404)", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("GET", "/tests/999999", { token: s.token })).status, 404);
    assert.equal((await attempt(s.token, [], 999999)).status, 404);
  });
});

describe("التصحيح", () => {
  it("كل الإجابات صح: 100% وناجح", async () => {
    const s = await app.newStudent();
    const r = await attempt(s.token, questions.map(q => ({ question_id: q.id, option_id: q.right })));
    assert.equal(r.data.score, 100);
    assert.equal(r.data.passed, true);
    assert.equal(r.data.correct_count, questions.length);
  });

  it("كل الإجابات غلط: صفر وراسب", async () => {
    const s = await app.newStudent();
    const r = await attempt(s.token, questions.map(q => ({ question_id: q.id, option_id: q.wrong })));
    assert.equal(r.data.score, 0);
    assert.equal(r.data.passed, false);
  });

  it("السؤال اللي ماتجاوبش بيتحسب غلط، ونسبة النجاح بالظبط بتنجّح", async () => {
    const s = await app.newStudent();
    app.db.prepare(`UPDATE tests SET pass_percent = 50 WHERE id = ?`).run(introTest.id);
    try {
      const r = await attempt(s.token, [{ question_id: questions[0].id, option_id: questions[0].right }]);
      assert.equal(r.data.score, Math.round(100 / questions.length));
      assert.equal(r.data.passed, r.data.score >= 50);
    } finally {
      app.db.prepare(`UPDATE tests SET pass_percent = 60 WHERE id = ?`).run(introTest.id);
    }
  });

  it("إجابة بخيار من سؤال تاني، أو سؤال مش في الاختبار، مابتتحسبش صح", async () => {
    const s = await app.newStudent();
    const r = await attempt(s.token, [
      { question_id: questions[0].id, option_id: questions[1].right },
      { question_id: 999999, option_id: questions[1].right },
    ]);
    assert.equal(r.data.correct_count, 0);
  });

  it("صيغة إجابات غلط (400)", async () => {
    const s = await app.newStudent();
    assert.equal((await attempt(s.token, "all correct")).status, 400);
    assert.equal((await app.call("POST", `/tests/${introTest.id}/attempt`, { token: s.token, body: {} })).status, 400);
  });

  it("اختبار من غير أسئلة مايتسلّمش (400)", async () => {
    const empty = app.db.prepare(`INSERT INTO tests (series_id, title) VALUES (?, 'فاضي')`).run(introTest.series_id);
    try {
      const s = await app.newStudent();
      assert.equal((await attempt(s.token, [], Number(empty.lastInsertRowid))).status, 400);
    } finally {
      app.db.prepare(`DELETE FROM tests WHERE id = ?`).run(empty.lastInsertRowid);
    }
  });

  it("المحاولات بتتسجّل: آخر نتيجة بتظهر، والنجاح مرة بيفضل محسوب حتى لو رسب بعدها", async () => {
    const s = await app.newStudent();
    await attempt(s.token, questions.map(q => ({ question_id: q.id, option_id: q.right })));
    await attempt(s.token, questions.map(q => ({ question_id: q.id, option_id: q.wrong })));
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    const all = cur.stages.flatMap(st => st.subjects.flatMap(sub => sub.series.flatMap(se => se.tests)));
    const t = all.find(x => x.id === introTest.id);
    assert.equal(t.last_score, 0);
    assert.equal(t.passed, true);
    const n = app.db.prepare(`SELECT COUNT(*) n FROM student_test_attempts WHERE student_id = (SELECT id FROM students WHERE email = ?)`).get(s.email).n;
    assert.equal(n, 2);
  });
});
