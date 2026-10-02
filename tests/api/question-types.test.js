// أنواع الأسئلة: اختيار من متعدد، صح وغلط، أكمل، مقالي — والتصحيح وتصحيح المشرف للمقالي
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");
const { normalizeArabic } = require("../../lib/quiz");

let app, admin, testId, seriesId;
const q = {}; // ids الأسئلة حسب النوع

before(async () => {
  app = await startApp();
  admin = await app.adminToken();
  const intro = app.stageByName("التمهيدية");
  seriesId = app.db.prepare(
    `SELECT se.id FROM series se JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`
  ).get(intro.id).id;
  testId = (await app.call("POST", "/admin/tests", { token: admin, body: { series_id: seriesId, title: "اختبار الأنواع", pass_percent: 60 } })).data.id;

  const add = body => app.call("POST", "/admin/tests/questions", { token: admin, body: { test_id: testId, ...body } });
  q.mcq = (await add({ type: "mcq", text: "عدد الصلوات المفروضة؟", options: [{ text: "خمس", is_correct: true }, { text: "ست" }] })).data.id;
  q.tf = (await add({ type: "true_false", text: "الوضوء شرط لصحة الصلاة", correct: true })).data.id;
  q.fill = (await add({ type: "fill", text: "أول الأركان: ......", accepted_answers: ["الشهادتان", "شهادة أن لا إله إلا الله"] })).data.id;
  q.essay = (await add({ type: "essay", text: "اشرح فضل طلب العلم", points: 2, model_answer: "يذكر حديث من سلك طريقًا" })).data.id;
});
after(() => app.close());

const options = (qid) => app.db.prepare(`SELECT id, text, is_correct FROM options WHERE question_id = ? ORDER BY id`).all(qid);
const right = qid => options(qid).find(o => o.is_correct).id;
const wrong = qid => options(qid).find(o => !o.is_correct).id;

describe("توحيد الكتابة العربية في أكمل", () => {
  it("التشكيل والهمزات والتاء المربوطة والمسافات ما بتفرقش", () => {
    assert.equal(normalizeArabic("  الشَّهَادَتَانِ. "), normalizeArabic("الشهادتان"));
    assert.equal(normalizeArabic("إسلام"), normalizeArabic("اسلام"));
    assert.equal(normalizeArabic("صلاة"), normalizeArabic("صلاه"));
    assert.equal(normalizeArabic("مُصطفى"), normalizeArabic("مصطفي"));
    assert.notEqual(normalizeArabic("الصوم"), normalizeArabic("الصلاة"));
  });
});

describe("المشرف بيضيف كل الأنواع", () => {
  it("صح وغلط بيعمل خيارين صح وخطأ لوحده", () => {
    const o = options(q.tf);
    assert.deepEqual(o.map(x => x.text), ["صح", "خطأ"]);
    assert.equal(o[0].is_correct, 1);
  });

  it("الاختبار بيرجع للمشرف بالنوع والإجابات المقبولة والنموذجية", async () => {
    const t = (await app.call("GET", "/admin/tests", { token: admin })).data.find(x => x.id === testId);
    const byId = Object.fromEntries(t.questions.map(x => [x.id, x]));
    assert.equal(byId[q.fill].type, "fill");
    assert.deepEqual(byId[q.fill].accepted_answers, ["الشهادتان", "شهادة أن لا إله إلا الله"]);
    assert.equal(byId[q.essay].model_answer, "يذكر حديث من سلك طريقًا");
    assert.equal(byId[q.essay].points, 2);
  });

  it("بيانات ناقصة أو غلط بتترفض", async () => {
    const add = body => app.call("POST", "/admin/tests/questions", { token: admin, body: { test_id: testId, text: "س", ...body } });
    assert.equal((await add({ type: "fill", accepted_answers: ["  "] })).status, 400);
    assert.equal((await add({ type: "true_false" })).status, 400);
    assert.equal((await add({ type: "unknown" })).status, 400);
    assert.equal((await add({ type: "essay", points: 0 })).status, 400);
    assert.equal((await add({ type: "mcq", options: [{ text: "أ", is_correct: true }] })).status, 400);
  });

  it("تعديل نوع السؤال من اختيار لأكمل", async () => {
    const id = (await app.call("POST", "/admin/tests/questions", { token: admin, body: { test_id: testId, type: "mcq", text: "مؤقت", options: [{ text: "أ", is_correct: true }, { text: "ب" }] } })).data.id;
    const r = await app.call("PATCH", `/admin/tests/questions/${id}`, { token: admin, body: { type: "fill", accepted_answers: ["أ"] } });
    assert.equal(r.status, 200);
    const row = app.db.prepare(`SELECT type FROM questions WHERE id = ?`).get(id);
    assert.equal(row.type, "fill");
    assert.equal(options(id).length, 0);
    await app.call("DELETE", `/admin/tests/questions/${id}`, { token: admin });
  });
});

describe("الطالب", () => {
  it("بيشوف الأسئلة بأنواعها من غير أي إجابة", async () => {
    const s = await app.newStudent();
    const r = await app.call("GET", `/tests/${testId}`, { token: s.token });
    assert.equal(r.status, 200);
    const types = Object.fromEntries(r.data.questions.map(x => [x.id, x]));
    assert.equal(types[q.tf].options.length, 2);
    assert.equal(types[q.fill].options, undefined);
    assert.equal(types[q.essay].type, "essay");
    assert.doesNotMatch(JSON.stringify(r.data), /is_correct|answer_key|accepted|الشهادتان|سلك طريقًا/);
  });

  it("من غير مقالي: النتيجة بتطلع على طول، وأكمل بيقبل اختلاف التشكيل", async () => {
    const s = await app.newStudent();
    const r = await app.call("POST", `/tests/${testId}/attempt`, { token: s.token, body: { answers: [
      { question_id: q.mcq, option_id: right(q.mcq) },
      { question_id: q.tf, option_id: right(q.tf) },
      { question_id: q.fill, text: "الشَّهادَتانِ" },
      { question_id: q.essay, text: "" },
    ] } });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "graded");
    // 3 من 5 درجات (المقالي فاضي وعليه درجتين)
    assert.equal(r.data.score, 60);
    assert.equal(r.data.passed, true);
    const res = Object.fromEntries(r.data.results.map(x => [x.question_id, x.correct]));
    assert.equal(res[q.fill], true);
    assert.equal(res[q.essay], false);
  });

  it("بمقالي: قيد التصحيح، ومش بيتحسب نجاح لحد ما المشرف يصحح", async () => {
    const s = await app.newStudent();
    const r = await app.call("POST", `/tests/${testId}/attempt`, { token: s.token, body: { answers: [
      { question_id: q.mcq, option_id: right(q.mcq) },
      { question_id: q.tf, option_id: wrong(q.tf) },
      { question_id: q.fill, text: "الصلاة" },
      { question_id: q.essay, text: "طلب العلم فريضة، ومن سلك طريقًا يلتمس فيه علمًا سهّل الله له طريقًا إلى الجنة." },
    ] } });
    assert.equal(r.data.status, "pending");
    assert.equal(r.data.passed, false);
    assert.equal(r.data.pending_count, 1);

    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    const t = cur.stages.flatMap(st => st.subjects).flatMap(x => x.series).flatMap(x => x.tests).find(x => x.id === testId);
    assert.equal(t.pending, true);
    assert.equal(t.passed, false);

    // المشرف بيشوفها في قائمة التصحيح
    const reviews = (await app.call("GET", "/admin/tests/reviews", { token: admin })).data;
    const mine = reviews.find(x => x.student_id === s.id);
    assert.ok(mine, "المحاولة لازم تظهر في التصحيح");
    assert.equal(mine.essays.length, 1);
    assert.equal(mine.essays[0].model_answer, "يذكر حديث من سلك طريقًا");
    assert.equal(mine.essays[0].max_points, 2);

    // درجة أكبر من المسموح بترفض
    const bad = await app.call("POST", `/admin/tests/reviews/${mine.id}`, { token: admin, body: { grades: [{ answer_id: mine.essays[0].answer_id, points: 3 }] } });
    assert.equal(bad.status, 400);
    const none = await app.call("POST", `/admin/tests/reviews/${mine.id}`, { token: admin, body: { grades: [] } });
    assert.equal(none.status, 400);

    // 1 (اختيار) + 2 (مقالي) من 5 = 60% ناجح
    const ok = await app.call("POST", `/admin/tests/reviews/${mine.id}`, { token: admin, body: { grades: [{ answer_id: mine.essays[0].answer_id, points: 2, feedback: "ممتاز" }] } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.score, 60);
    assert.equal(ok.data.passed, true);

    const after = (await app.call("GET", "/admin/tests/reviews", { token: admin })).data;
    assert.equal(after.find(x => x.id === mine.id), undefined, "بعد التصحيح ما تظهرش تاني");

    // الطالب بيشوف درجته وملاحظة المصحح
    const result = (await app.call("GET", `/tests/${testId}/result`, { token: s.token })).data;
    assert.equal(result.status, "graded");
    assert.equal(result.passed, true);
    const essay = result.answers.find(a => a.type === "essay");
    assert.equal(essay.points, 2);
    assert.equal(essay.feedback, "ممتاز");
    assert.doesNotMatch(JSON.stringify(result), /الشهادتان/, "ما يكشفش الإجابة المقبولة في أكمل");
  });

  it("الطالب ما يقدرش يفتح قائمة التصحيح ولا يصحح", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("GET", "/admin/tests/reviews", { token: s.token })).status, 403);
    assert.equal((await app.call("POST", "/admin/tests/reviews/1", { token: s.token, body: { grades: [] } })).status, 403);
  });
});
