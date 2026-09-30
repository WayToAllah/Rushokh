// رحلة الطالب: المنهج، المراحل المقفولة، التقدم، الانتقال التلقائي، الشهادة، والتقرير
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

const current = cur => cur.stages.find(s => s.status === "current");
const allItems = stage => stage.subjects.flatMap(sub => sub.series);

// يخلّص كل حاجة في المرحلة الحالية: يسمع الحلقات، يخلّص الكتب، وينجح في الاختبارات
async function finishCurrentStage(token) {
  const cur = (await app.call("GET", "/curriculum", { token })).data;
  const stage = current(cur);
  let advanced = null;
  for (const series of allItems(stage)) {
    for (const e of series.episodes) {
      advanced = (await app.call("POST", "/progress/episode", { token, body: { episode_id: e.id, listened: true } })).data.advanced_to || advanced;
    }
    for (const b of series.books) {
      advanced = (await app.call("POST", "/progress/book", { token, body: { book_id: b.id, current_page: b.total_pages } })).data.advanced_to || advanced;
    }
    for (const t of series.tests) {
      const answers = app.db.prepare(
        `SELECT q.id AS question_id, o.id AS option_id FROM questions q JOIN options o ON o.question_id = q.id AND o.is_correct = 1 WHERE q.test_id = ?`
      ).all(t.id);
      advanced = (await app.call("POST", `/tests/${t.id}/attempt`, { token, body: { answers } })).data.advanced_to || advanced;
    }
  }
  return { stage, advanced };
}

describe("المنهج", () => {
  it("الطالب الجديد: أول مرحلة حالية وفيها محتوى، والباقي مقفول ومن غير محتوى", async () => {
    const s = await app.newStudent();
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.deepEqual(cur.stages.map(x => x.status), ["current", "locked", "locked", "locked"]);
    assert.equal(cur.stages[0].name, "التمهيدية");
    assert.ok(cur.stages[0].subjects.length > 0);
    for (const locked of cur.stages.slice(1)) {
      assert.deepEqual(locked.subjects, [], "المرحلة المقفولة مابترجعش محتواها");
      assert.equal(locked.progress, null);
    }
  });

  it("المنهج عمره ما بيكشف الإجابة الصحيحة", async () => {
    const s = await app.newStudent();
    const raw = JSON.stringify((await app.call("GET", "/curriculum", { token: s.token })).data);
    assert.doesNotMatch(raw, /is_correct/);
  });

  it("المشرف بيرتّب المحتوى والطالب بيشوفه بنفس الترتيب", async () => {
    const s = await app.newStudent();
    const eps = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0].episodes.map(e => e.id);
    const admin = await app.adminToken();
    await app.call("POST", "/admin/content/reorder", { token: admin, body: { kind: "episodes", ids: [...eps].reverse() } });
    const after = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0].episodes.map(e => e.id);
    assert.deepEqual(after, [...eps].reverse());
  });
});

describe("المراحل المقفولة", () => {
  it("الطالب مايقدرش يعلّم حلقة أو كتاب أو يفتح اختبار في مرحلة لسه ما وصلهاش (403)", async () => {
    const s = await app.newStudent();
    const first = app.stageByName("الأولى");
    const ep = app.db.prepare(`SELECT e.id FROM episodes e JOIN series se ON se.id = e.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(first.id);
    const bk = app.db.prepare(`SELECT b.id FROM books b JOIN series se ON se.id = b.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(first.id);
    const ts = app.db.prepare(`SELECT t.id FROM tests t JOIN series se ON se.id = t.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(first.id);
    assert.equal((await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: ep.id, listened: true } })).status, 403);
    assert.equal((await app.call("POST", "/progress/book", { token: s.token, body: { book_id: bk.id, current_page: 3 } })).status, 403);
    assert.equal((await app.call("GET", `/tests/${ts.id}`, { token: s.token })).status, 403);
    assert.equal((await app.call("POST", `/tests/${ts.id}/attempt`, { token: s.token, body: { answers: [] } })).status, 403);
  });

  it("حلقة أو كتاب مش موجودين (404)", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: 999999, listened: true } })).status, 404);
    assert.equal((await app.call("POST", "/progress/book", { token: s.token, body: { book_id: 999999, current_page: 1 } })).status, 404);
    assert.equal((await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: "abc" } })).status, 404);
  });
});

describe("التقدم", () => {
  it("رقم صفحة الكتاب بيتظبط بين صفر وعدد الصفحات", async () => {
    const s = await app.newStudent();
    const book = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0].books[0];
    const set = async page => (await app.call("POST", "/progress/book", { token: s.token, body: { book_id: book.id, current_page: page } })).data.current_page;
    assert.equal(await set(999), book.total_pages);
    assert.equal(await set(-5), 0);
    assert.equal(await set("abc"), 0);
    assert.equal(await set(12), 12);
  });

  it("الحلقة بتتعلّم مسموعة وبترجع لأ", async () => {
    const s = await app.newStudent();
    const ep = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0].episodes[0];
    const listened = async () => allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0].episodes.find(e => e.id === ep.id).listened;
    await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: ep.id, listened: true } });
    assert.equal(await listened(), 1);
    await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: ep.id, listened: false } });
    assert.equal(await listened(), 0);
  });

  it("تقرير الطالب بيفصل اللي خلّصه عن اللي لسه فيه", async () => {
    const s = await app.newStudent();
    const series = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0];
    await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: series.episodes[0].id, listened: true } });
    await app.call("POST", "/progress/book", { token: s.token, body: { book_id: series.books[0].id, current_page: 5 } });
    const rep = (await app.call("GET", "/progress/me/report", { token: s.token })).data;
    assert.equal(rep.stage_name, "التمهيدية");
    assert.deepEqual(rep.completed.map(x => x.title), [series.episodes[0].title]);
    assert.ok(rep.in_progress.some(x => x.title === series.books[0].title && /صفحة 5/.test(x.context)));
  });
});

describe("الانتقال بين المراحل والشهادة", () => {
  it("مابيعدّيش بالحلقات والكتب بس، لازم ينجح في الاختبار", async () => {
    const s = await app.newStudent();
    const series = allItems(current((await app.call("GET", "/curriculum", { token: s.token })).data))[0];
    for (const e of series.episodes) await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: e.id, listened: true } });
    const last = await app.call("POST", "/progress/book", { token: s.token, body: { book_id: series.books[0].id, current_page: series.books[0].total_pages } });
    assert.equal(last.data.advanced_to, null);
    const cert = (await app.call("GET", `/progress/certificate/${app.stageByName("التمهيدية").id}`, { token: s.token })).data;
    assert.equal(cert.eligible, false);
    assert.ok(cert.percent > 0 && cert.percent < 100, `النسبة بين 0 و100: ${cert.percent}`);
  });

  it("لما يخلّص كل حاجة بيعدّي تلقائيًا وتطلعله شهادة برقم", async () => {
    const s = await app.newStudent();
    const { stage, advanced } = await finishCurrentStage(s.token);
    assert.equal(advanced, "الأولى");
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.deepEqual(cur.stages.map(x => x.status), ["completed", "current", "locked", "locked"]);
    const cert = (await app.call("GET", `/progress/certificate/${stage.id}`, { token: s.token })).data;
    assert.equal(cert.eligible, true);
    assert.equal(cert.percent, 100);
    assert.match(cert.certificate_no, /^RSK-\d{6}$/);
    assert.ok(cert.completed_at);
  });

  it("المرحلة اللي خلّصها بتفضل مفتوحة يراجع فيها", async () => {
    const s = await app.newStudent();
    const { stage } = await finishCurrentStage(s.token);
    const ep = allItems(stage)[0].episodes[0];
    const r = await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: ep.id, listened: true } });
    assert.equal(r.status, 200);
  });

  it("اختبار من غير أسئلة مابيوقفش الطالب", async () => {
    const intro = app.stageByName("التمهيدية");
    const series = app.db.prepare(`SELECT se.id FROM series se JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(intro.id);
    const empty = app.db.prepare(`INSERT INTO tests (series_id, title) VALUES (?, 'اختبار فاضي')`).run(series.id);
    try {
      const s = await app.newStudent();
      const { advanced } = await finishCurrentStage(s.token);
      assert.equal(advanced, "الأولى");
    } finally {
      app.db.prepare(`DELETE FROM tests WHERE id = ?`).run(empty.lastInsertRowid);
    }
  });

  it("مرحلة من غير محتوى ماتتحسبش مكتملة: الطالب بيقف عندها لحد ما يتضاف فيها حاجة", async () => {
    const s = await app.newStudent();
    await finishCurrentStage(s.token); // التمهيدية -> الأولى
    const { advanced } = await finishCurrentStage(s.token); // الأولى -> الثانية (فاضية)
    assert.equal(advanced, "الثانية");
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.equal(current(cur).name, "الثانية", "ماعدّاش لوحده للتالتة");
    assert.equal(current(cur).progress.percent, 0);
  });

  it("شهادة مرحلة مش موجودة (404)", async () => {
    const s = await app.newStudent();
    assert.equal((await app.call("GET", "/progress/certificate/999999", { token: s.token })).status, 404);
  });
});
