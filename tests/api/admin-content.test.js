// لوحة المشرف: إدارة المحتوى (مراحل، أقسام، سلاسل، حلقات، كتب) والترتيب
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, admin;
before(async () => { app = await startApp(); admin = await app.adminToken(); });
after(() => app.close());

const as = (method, path, body) => app.call(method, "/admin/content" + path, { token: admin, body });

// ينشئ مرحلة كاملة صغيرة: مرحلة -> قسم -> سلسلة -> حلقتين + كتاب
async function buildStage(name) {
  const stage = (await as("POST", "/stages", { name })).data;
  const subject = (await as("POST", "/subjects", { name: `قسم ${name}`, icon: "📘" })).data;
  const link = (await as("POST", "/stage-subject", { stage_id: stage.id, subject_id: subject.id })).data;
  const series = (await as("POST", "/series", { stage_subject_id: link.id, name: `سلسلة ${name}` })).data;
  const ep1 = (await as("POST", "/episodes", { series_id: series.id, title: "حلقة 1", url: "https://youtu.be/abcdefghijk" })).data;
  const ep2 = (await as("POST", "/episodes", { series_id: series.id, title: "حلقة 2" })).data;
  const book = (await as("POST", "/books", { series_id: series.id, title: "كتاب", total_pages: 30 })).data;
  return { stage, subject, link, series, ep1, ep2, book };
}

describe("الصلاحيات", () => {
  it("كل مسارات المحتوى للمشرف بس", async () => {
    const student = await app.demoStudentToken();
    for (const [m, p] of [["GET", "/tree"], ["POST", "/stages"], ["PATCH", "/episodes/1"], ["DELETE", "/books/1"], ["POST", "/reorder"]]) {
      const body = m === "GET" || m === "DELETE" ? undefined : {};
      assert.equal((await app.call(m, "/admin/content" + p, { token: student, body })).status, 403, `${m} ${p}`);
      assert.equal((await app.call(m, "/admin/content" + p, { body })).status, 401, `${m} ${p} من غير دخول`);
    }
  });
});

describe("الإضافة", () => {
  it("مرحلة كاملة بتظهر في الشجرة بالترتيب، والعناصر الجديدة بتتحط في الآخر", async () => {
    const built = await buildStage("الرابعة");
    const tree = (await as("GET", "/tree")).data;
    assert.equal(tree[tree.length - 1].name, "الرابعة", "المرحلة الجديدة آخر واحدة");
    const series = tree.find(s => s.id === built.stage.id).subjects[0].series[0];
    assert.deepEqual(series.episodes.map(e => e.title), ["حلقة 1", "حلقة 2"]);
    assert.equal(series.books[0].total_pages, 30);
    assert.equal(series.episodes[0].url, "https://youtu.be/abcdefghijk");
  });

  it("الأسماء والعناوين مطلوبة (400)", async () => {
    assert.equal((await as("POST", "/stages", { name: "  " })).status, 400);
    assert.equal((await as("POST", "/subjects", {})).status, 400);
    assert.equal((await as("POST", "/series", { stage_subject_id: 1 })).status, 400);
    assert.equal((await as("POST", "/episodes", { series_id: 1, title: "" })).status, 400);
    assert.equal((await as("POST", "/books", { title: "x" })).status, 400);
  });

  it("الروابط لازم http أو https، وأي رابط javascript: مرفوض", async () => {
    const { series } = await buildStage("روابط");
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.com/a", "not a url"]) {
      assert.equal((await as("POST", "/episodes", { series_id: series.id, title: "x", url })).status, 400, url);
      assert.equal((await as("POST", "/books", { series_id: series.id, title: "x", file_url: url })).status, 400, url);
      assert.equal((await as("PATCH", `/series/${series.id}`, { url })).status, 400, url);
    }
  });

  it("عدد صفحات سالب بيتحفظ صفر", async () => {
    const { series } = await buildStage("صفحات");
    const b = (await as("POST", "/books", { series_id: series.id, title: "x", total_pages: -5 })).data;
    assert.equal(app.db.prepare(`SELECT total_pages FROM books WHERE id = ?`).get(b.id).total_pages, 0);
  });

  it("ربط نفس القسم بنفس المرحلة مرتين (409)", async () => {
    const { stage, subject } = await buildStage("ربط");
    const r = await as("POST", "/stage-subject", { stage_id: stage.id, subject_id: subject.id });
    assert.equal(r.status, 409);
  });

  it("عنصر لأب مش موجود بيرجّع رسالة واضحة (400) مش خطأ سيرفر (500)", async () => {
    for (const [path, body] of [
      ["/stage-subject", { stage_id: 999999, subject_id: 1 }],
      ["/series", { stage_subject_id: 999999, name: "x" }],
      ["/episodes", { series_id: 999999, title: "x" }],
      ["/books", { series_id: 999999, title: "x" }],
    ]) {
      const r = await as("POST", path, body);
      assert.equal(r.status, 400, `${path}: ${r.status} ${JSON.stringify(r.data)}`);
      assert.match(r.data.error, /غير موجود/);
    }
  });
});

describe("التعديل", () => {
  it("التعديل بيغيّر الحقول المبعوتة بس", async () => {
    const { ep1 } = await buildStage("تعديل");
    assert.equal((await as("PATCH", `/episodes/${ep1.id}`, { title: "عنوان جديد" })).status, 200);
    const row = app.db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(ep1.id);
    assert.equal(row.title, "عنوان جديد");
    assert.equal(row.url, "https://youtu.be/abcdefghijk", "الرابط ماتغيّرش");
  });

  it("رابط فاضي بيمسح الرابط", async () => {
    const { ep1 } = await buildStage("مسح رابط");
    await as("PATCH", `/episodes/${ep1.id}`, { url: "" });
    assert.equal(app.db.prepare(`SELECT url FROM episodes WHERE id = ?`).get(ep1.id).url, null);
  });

  it("عنوان فاضي، أو مفيش حاجة تتعدل، أو صفحات سالبة (400)؛ وعنصر مش موجود (404)", async () => {
    const { ep1, book } = await buildStage("تعديل غلط");
    assert.equal((await as("PATCH", `/episodes/${ep1.id}`, { title: "  " })).status, 400);
    assert.equal((await as("PATCH", `/episodes/${ep1.id}`, {})).status, 400);
    assert.equal((await as("PATCH", `/books/${book.id}`, { total_pages: -1 })).status, 400);
    assert.equal((await as("PATCH", `/episodes/999999`, { title: "x" })).status, 404);
  });

  it("تعديل الحلقة مابيضيّعش إن الطالب سمعها", async () => {
    const intro = app.stageByName("التمهيدية");
    const ep = app.db.prepare(`SELECT e.id FROM episodes e JOIN series se ON se.id = e.series_id JOIN stage_subject ss ON ss.id = se.stage_subject_id WHERE ss.stage_id = ? LIMIT 1`).get(intro.id);
    const s = await app.newStudent();
    await app.call("POST", "/progress/episode", { token: s.token, body: { episode_id: ep.id, listened: true } });
    await as("PATCH", `/episodes/${ep.id}`, { title: "بعد التعديل" });
    const listened = app.db.prepare(`SELECT listened FROM student_episode_progress WHERE episode_id = ?`).get(ep.id).listened;
    assert.equal(listened, 1);
  });
});

describe("الترتيب والحذف", () => {
  it("إعادة ترتيب المراحل والحلقات", async () => {
    const { series, ep1, ep2 } = await buildStage("ترتيب");
    assert.equal((await as("POST", "/reorder", { kind: "episodes", ids: [ep2.id, ep1.id] })).status, 200);
    const tree = (await as("GET", "/tree")).data;
    const s = tree.flatMap(st => st.subjects.flatMap(sub => sub.series)).find(x => x.id === series.id);
    assert.deepEqual(s.episodes.map(e => e.id), [ep2.id, ep1.id]);
  });

  it("بيانات ترتيب غلط (400)", async () => {
    assert.equal((await as("POST", "/reorder", { kind: "students", ids: [1] })).status, 400);
    assert.equal((await as("POST", "/reorder", { kind: "episodes", ids: [] })).status, 400);
    assert.equal((await as("POST", "/reorder", { kind: "episodes", ids: "1,2" })).status, 400);
  });

  it("حذف سلسلة بيحذف حلقاتها وكتبها واختباراتها وتقدم الطلاب فيها", async () => {
    const { series, ep1, book } = await buildStage("حذف");
    app.db.prepare(`INSERT INTO tests (series_id, title) VALUES (?, 'x')`).run(series.id);
    const s = await app.newStudent();
    app.db.prepare(`INSERT INTO student_episode_progress (student_id, episode_id, listened) VALUES (?, ?, 1)`).run(s.id, ep1.id);
    assert.equal((await as("DELETE", `/series/${series.id}`)).status, 200);
    const count = (sql, ...p) => app.db.prepare(sql).get(...p).n;
    assert.equal(count(`SELECT COUNT(*) n FROM episodes WHERE series_id = ?`, series.id), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM books WHERE id = ?`, book.id), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM tests WHERE series_id = ?`, series.id), 0);
    assert.equal(count(`SELECT COUNT(*) n FROM student_episode_progress WHERE episode_id = ?`, ep1.id), 0);
  });

  it("حذف المرحلة الحالية لطالب بيرجّعه لأول مرحلة بدل ما يضيع", async () => {
    const { stage } = await buildStage("مرحلة هتتحذف");
    const s = await app.newStudent();
    app.db.prepare(`UPDATE students SET current_stage_id = ? WHERE id = ?`).run(stage.id, s.id);
    await as("DELETE", `/stages/${stage.id}`);
    const cur = (await app.call("GET", "/curriculum", { token: s.token })).data;
    assert.equal(cur.stages.find(x => x.status === "current").name, "التمهيدية");
  });
});
