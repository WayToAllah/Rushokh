// صفحة الدرس: اختبار على حلقة، الملخص، ملاحظاتي، والمناقشة
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, admin, seriesId, epId, ep2Id, testId, lockedEpId;

before(async () => {
  app = await startApp();
  admin = await app.adminToken();
  const intro = app.stageByName("التمهيدية");
  seriesId = app.db.prepare(
    `SELECT se.id FROM series se JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`
  ).get(intro.id).id;
  const addEp = body => app.call("POST", "/admin/content/episodes", { token: admin, body: { series_id: seriesId, ...body } });
  epId = (await addEp({ title: "درس الطهارة", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", summary: "الطهارة شرط لصحة الصلاة.", summary_url: "https://example.com/t.pdf" })).data.id;
  ep2Id = (await addEp({ title: "درس الصلاة" })).data.id;

  testId = (await app.call("POST", "/admin/tests", { token: admin, body: { series_id: seriesId, episode_id: epId, title: "أسئلة درس الطهارة" } })).data.id;
  await app.call("POST", "/admin/tests/questions", { token: admin, body: { test_id: testId, type: "true_false", text: "الطهارة شرط للصلاة", correct: true } });

  // سلسلة في مرحلة بعد التمهيدية (مقفولة على الطالب الجديد)
  const laterSeries = app.db.prepare(
    `SELECT se.id FROM series se JOIN stage_subject ss ON ss.id = se.stage_subject_id
     WHERE ss.stage_id != ? LIMIT 1`
  ).get(intro.id).id;
  lockedEpId = (await app.call("POST", "/admin/content/episodes", { token: admin, body: { series_id: laterSeries, title: "درس مقفول" } })).data.id;
});
after(() => app.close());

const opts = tid => app.db.prepare(
  `SELECT o.id, o.is_correct FROM options o JOIN questions q ON q.id = o.question_id WHERE q.test_id = ?`
).all(tid);

describe("اختبار على حلقة", () => {
  it("المشرف يربط الاختبار بحلقة من نفس السلسلة بس", async () => {
    const other = app.db.prepare(`SELECT id FROM episodes WHERE series_id != ? LIMIT 1`).get(seriesId);
    const bad = await app.call("POST", "/admin/tests", { token: admin, body: { series_id: seriesId, episode_id: other.id, title: "غلط" } });
    assert.equal(bad.status, 400);
    const list = (await app.call("GET", "/admin/tests", { token: admin })).data;
    assert.equal(list.find(t => t.id === testId).episode_title, "درس الطهارة");
  });

  it("الاختبار بيظهر تحت الحلقة مش تحت السلسلة، والحلقة ما تخلصش غير بعد النجاح", async () => {
    const s = await app.newStudent();
    const findEp = cur => cur.stages.flatMap(st => st.subjects).flatMap(x => x.series).flatMap(x => x.episodes).find(e => e.id === epId);
    const findSeries = cur => cur.stages.flatMap(st => st.subjects).flatMap(x => x.series).find(x => x.id === seriesId);

    let cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.equal(findEp(cur).tests.length, 1);
    assert.equal(findSeries(cur).tests.find(t => t.id === testId), undefined);

    await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: epId, listened: true } });
    cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.equal(findEp(cur).listened, 1);
    assert.equal(findEp(cur).done, false, "سمع الحلقة بس لسه ما نجحش في اختبارها");

    const right = opts(testId).find(o => o.is_correct);
    const q = app.db.prepare(`SELECT id FROM questions WHERE test_id = ?`).get(testId);
    await app.call("POST", `/tests/${testId}/attempt`, { token: s.token, body: { answers: [{ question_id: q.id, option_id: right.id }] } });
    cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.equal(findEp(cur).done, true);
  });

  it("اختبار الحلقة بيتحسب في تقدم المرحلة", async () => {
    const s = await app.newStudent();
    const stage = app.stageByName("التمهيدية");
    const before = (await app.call("GET", "/curriculum", { token: s.token })).data.stages.find(x => x.id === stage.id).progress;
    assert.ok(before.tests_total >= 1);
  });
});

describe("بيانات الدرس", () => {
  it("بترجع الفيديو والملخص والسابق والتالي واختبارات الحلقة", async () => {
    const s = await app.newStudent();
    const r = await app.call("GET", `/lessons/${epId}`, { token: s.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.title, "درس الطهارة");
    assert.equal(r.data.summary, "الطهارة شرط لصحة الصلاة.");
    assert.equal(r.data.summary_url, "https://example.com/t.pdf");
    assert.equal(r.data.tests[0].id, testId);
    assert.equal(r.data.next.id, ep2Id);
    assert.equal(r.data.series_id, seriesId);
    assert.ok(r.data.stage_id && r.data.subject_id, "المسار محتاج أرقام المرحلة والقسم عشان يبقى روابط");
    assert.ok(r.data.subject_name);
  });

  it("درس في مرحلة مقفولة مش بيفتح، ولا المشرف بيفتحه من هنا", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("GET", `/lessons/${lockedEpId}`, { token: s.token })).status, 403);
    assert.equal((await app.call("GET", `/lessons/999999`, { token: s.token })).status, 404);
    assert.equal((await app.call("GET", `/lessons/${epId}`, { token: admin })).status, 403);
  });

  it("المشرف يعدّل الملخص، والرابط لازم يكون http", async () => {
    assert.equal((await app.call("PATCH", `/admin/content/episodes/${ep2Id}`, { token: admin, body: { summary_url: "javascript:alert(1)" } })).status, 400);
    assert.equal((await app.call("PATCH", `/admin/content/episodes/${ep2Id}`, { token: admin, body: { summary: "ملخص جديد" } })).status, 200);
    const s = await app.newStudent();
    assert.equal((await app.call("GET", `/lessons/${ep2Id}`, { token: s.token })).data.summary, "ملخص جديد");
  });
});

describe("ملاحظاتي", () => {
  it("بتتحفظ للطالب نفسه بس", async () => {
    const a = await app.newStudent();
    const b = await app.newStudent();
    const r = await app.call("PUT", `/lessons/${epId}/note`, { token: a.token, body: { body: "راجع شروط الوضوء" } });
    assert.equal(r.status, 200);
    assert.equal((await app.call("GET", `/lessons/${epId}`, { token: a.token })).data.note, "راجع شروط الوضوء");
    assert.equal((await app.call("GET", `/lessons/${epId}`, { token: b.token })).data.note, "");
    await app.call("PUT", `/lessons/${epId}/note`, { token: a.token, body: { body: "  " } });
    assert.equal((await app.call("GET", `/lessons/${epId}`, { token: a.token })).data.note, "");
  });
});

describe("المناقشة", () => {
  it("طالب يسأل، طالب تاني يشوف ويرد، والمشرف يرد ويثبّت ويمسح", async () => {
    const a = await app.newStudent();
    const b = await app.newStudent();
    assert.equal((await app.call("POST", `/lessons/${epId}/comments`, { token: a.token, body: { body: "  " } })).status, 400);
    const c1 = (await app.call("POST", `/lessons/${epId}/comments`, { token: a.token, body: { body: "هل التيمم يرفع الحدث؟" } })).data.id;

    let list = (await app.call("GET", `/lessons/${epId}/comments`, { token: b.token })).data;
    const mine = list.find(c => c.id === c1);
    assert.equal(mine.mine, false);
    assert.equal(mine.is_admin, false);
    await app.call("POST", `/lessons/${epId}/comments`, { token: b.token, body: { body: "سؤال حلو", parent_id: c1 } });

    // المشرف شايفه مستني رد
    let d = (await app.call("GET", "/admin/discussions?unanswered=1", { token: admin })).data;
    assert.ok(d.comments.find(c => c.id === c1));
    assert.ok(d.unanswered_count >= 1);
    assert.equal((await app.call("POST", `/admin/discussions/${epId}`, { token: admin, body: { body: "فيه خلاف، راجع الدرس الجاي", parent_id: c1 } })).status, 201);
    d = (await app.call("GET", "/admin/discussions?unanswered=1", { token: admin })).data;
    assert.equal(d.comments.find(c => c.id === c1), undefined);

    assert.equal((await app.call("PATCH", `/admin/discussions/comments/${c1}`, { token: admin, body: { pinned: true } })).status, 200);
    list = (await app.call("GET", `/lessons/${epId}/comments`, { token: a.token })).data;
    assert.equal(list[0].id, c1);
    assert.equal(list[0].pinned, true);
    assert.equal(list[0].mine, true);
    assert.equal(list[0].replies.length, 2);
    assert.equal(list[0].replies[1].is_admin, true);
    assert.equal(list[0].replies[1].author, "المشرف");

    // طالب ما يمسحش تعليق غيره
    assert.equal((await app.call("DELETE", `/lessons/comments/${c1}`, { token: b.token })).status, 404);
    assert.equal((await app.call("DELETE", `/admin/discussions/comments/${c1}`, { token: admin })).status, 200);
    list = (await app.call("GET", `/lessons/${epId}/comments`, { token: a.token })).data;
    assert.equal(list.find(c => c.id === c1), undefined, "الردود بتتمسح مع التعليق");
  });

  it("ما ينفعش تعلّق على درس مقفول، والطالب ما يدخلش على إدارة المناقشات", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("POST", `/lessons/${lockedEpId}/comments`, { token: s.token, body: { body: "سؤال" } })).status, 403);
    assert.equal((await app.call("GET", "/admin/discussions", { token: s.token })).status, 403);
  });

  it("حد للتعليقات ورا بعض", async () => {
    const s = await app.newStudent();
    let last;
    for (let i = 0; i < 11; i++) {
      last = await app.call("POST", `/lessons/${epId}/comments`, { token: s.token, body: { body: "تعليق " + i } });
    }
    assert.equal(last.status, 429);
  });
});
