// routes/admin/content.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// الروابط لازم تبدأ بـ http:// أو https:// (عشان محدش يحط رابط javascript: يشغّل كود عند الطالب)
function safeUrl(v) {
  if (v === undefined || v === null || String(v).trim() === "") return { ok: true, value: null };
  const s = String(v).trim();
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return { ok: true, value: u.toString() };
  } catch (e) { /* رابط غير صالح */ }
  return { ok: false };
}

function text(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// الترتيب التالي داخل نفس المجموعة (عشان العنصر الجديد يتحط في الآخر)
function nextOrder(table, parentCol, parentId) {
  const row = parentCol
    ? db.prepare(`SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM ${table} WHERE ${parentCol} = ?`).get(parentId)
    : db.prepare(`SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM ${table}`).get();
  return row.n;
}

// تعديل جزئي: بيغيّر بس الحقول اللي اتبعتت. fields = { اسم_الحقل: دالة تحقق ترجع {ok, value, error} }
function patchRow(table, id, body, fields) {
  const sets = [], values = [];
  for (const [col, check] of Object.entries(fields)) {
    if (!(col in body)) continue;
    const r = check(body[col]);
    if (!r.ok) return { status: 400, error: r.error };
    sets.push(`${col} = ?`);
    values.push(r.value);
  }
  if (!sets.length) return { status: 400, error: "مفيش حاجة للتعديل." };
  const info = db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  if (info.changes === 0) return { status: 404, error: "العنصر غير موجود." };
  return { status: 200 };
}

const required = (label, max) => v => {
  const t = text(v, max);
  return t ? { ok: true, value: t } : { ok: false, error: `${label} مطلوب.` };
};
const optional = max => v => ({ ok: true, value: text(v, max) });
const urlField = label => v => {
  const l = safeUrl(v);
  return l.ok ? { ok: true, value: l.value } : { ok: false, error: `${label} يجب أن يبدأ بـ http:// أو https://` };
};
const pages = v => {
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= 0 ? { ok: true, value: n } : { ok: false, error: "عدد الصفحات لازم يكون رقم صفر أو أكبر." };
};
const orderNum = v => ({ ok: true, value: parseInt(v, 10) || 0 });

function sendPatch(res, result) {
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
}

// ---------- عرض شجري كامل للمحتوى (كل المراحل بلا استثناء) ----------
router.get("/tree", (req, res) => {
  const stages = db.prepare(`SELECT * FROM stages ORDER BY order_index ASC, id ASC`).all();

  const tree = stages.map(stage => {
    const subjects = db.prepare(
      `SELECT ss.id AS stage_subject_id, subj.id AS subject_id, subj.name, subj.icon
       FROM stage_subject ss JOIN subjects subj ON subj.id = ss.subject_id
       WHERE ss.stage_id = ? ORDER BY ss.order_index ASC, ss.id ASC`
    ).all(stage.id).map(subj => {
      const series = db.prepare(
        `SELECT * FROM series WHERE stage_subject_id = ? ORDER BY order_index ASC, id ASC`
      ).all(subj.stage_subject_id).map(s => ({
        ...s,
        episodes: db.prepare(`SELECT * FROM episodes WHERE series_id = ? ORDER BY order_index ASC, id ASC`).all(s.id),
        books: db.prepare(`SELECT * FROM books WHERE series_id = ? ORDER BY order_index ASC, id ASC`).all(s.id),
        tests: db.prepare(`SELECT * FROM tests WHERE series_id = ? ORDER BY id ASC`).all(s.id),
      }));
      return { ...subj, series };
    });
    return { ...stage, subjects };
  });

  res.json(tree);
});

// ---------- قوائم مسطّحة (لتعبئة القوائم المنسدلة في لوحة المشرف) ----------
router.get("/stages", (req, res) => {
  res.json(db.prepare(`SELECT * FROM stages ORDER BY order_index ASC, id ASC`).all());
});

router.get("/subjects", (req, res) => {
  res.json(db.prepare(`SELECT * FROM subjects ORDER BY id ASC`).all());
});

// ---------- المراحل ----------
router.post("/stages", (req, res) => {
  const name = text(req.body.name, 100);
  if (!name) return res.status(400).json({ error: "اسم المرحلة مطلوب." });
  const order = req.body.order_index === undefined || req.body.order_index === ""
    ? nextOrder("stages") : parseInt(req.body.order_index, 10) || 0;
  const info = db.prepare(`INSERT INTO stages (name, order_index) VALUES (?, ?)`).run(name, order);
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

router.patch("/stages/:id", (req, res) => {
  sendPatch(res, patchRow("stages", req.params.id, req.body, {
    name: required("اسم المرحلة", 100),
    order_index: orderNum,
  }));
});

router.delete("/stages/:id", (req, res) => {
  db.prepare(`DELETE FROM stages WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الأقسام ----------
router.post("/subjects", (req, res) => {
  const name = text(req.body.name, 100);
  if (!name) return res.status(400).json({ error: "اسم القسم مطلوب." });
  const icon = text(req.body.icon, 10);
  const info = db.prepare(`INSERT INTO subjects (name, icon) VALUES (?, ?)`).run(name, icon);
  res.status(201).json({ id: Number(info.lastInsertRowid), name, icon });
});

router.patch("/subjects/:id", (req, res) => {
  sendPatch(res, patchRow("subjects", req.params.id, req.body, {
    name: required("اسم القسم", 100),
    icon: optional(10),
  }));
});

router.delete("/subjects/:id", (req, res) => {
  db.prepare(`DELETE FROM subjects WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- ربط قسم بمرحلة ----------
router.post("/stage-subject", (req, res) => {
  const { stage_id, subject_id } = req.body;
  if (!stage_id || !subject_id) {
    return res.status(400).json({ error: "المرحلة والقسم مطلوبان." });
  }
  try {
    const info = db.prepare(
      `INSERT INTO stage_subject (stage_id, subject_id, order_index) VALUES (?, ?, ?)`
    ).run(stage_id, subject_id, nextOrder("stage_subject", "stage_id", stage_id));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    // الربط مكرر بس هو اللي رسالته "مرتبط بالفعل"، أي خطأ تاني (مرحلة أو قسم مش موجود) بيروح للمعالج العام
    if (!/UNIQUE constraint failed/.test(err.message)) throw err;
    res.status(409).json({ error: "هذا القسم مرتبط بالفعل بهذه المرحلة." });
  }
});

router.delete("/stage-subject/:id", (req, res) => {
  db.prepare(`DELETE FROM stage_subject WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- السلاسل ----------
router.post("/series", (req, res) => {
  const { stage_subject_id } = req.body;
  const name = text(req.body.name, 150);
  if (!stage_subject_id || !name) {
    return res.status(400).json({ error: "القسم داخل المرحلة واسم السلسلة مطلوبان." });
  }
  const link = safeUrl(req.body.url);
  if (!link.ok) return res.status(400).json({ error: "رابط السلسلة يجب أن يبدأ بـ http:// أو https://" });
  const info = db.prepare(
    `INSERT INTO series (stage_subject_id, name, url, order_index) VALUES (?, ?, ?, ?)`
  ).run(stage_subject_id, name, link.value, nextOrder("series", "stage_subject_id", stage_subject_id));
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

// تعديل اسم السلسلة أو رابطها (قائمة تشغيل يوتيوب مثلاً). رابط فاضي = مسح الرابط.
router.patch("/series/:id", (req, res) => {
  sendPatch(res, patchRow("series", req.params.id, req.body, {
    name: required("اسم السلسلة", 150),
    url: urlField("رابط السلسلة"),
  }));
});

router.delete("/series/:id", (req, res) => {
  db.prepare(`DELETE FROM series WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الحلقات ----------
// رقم الحلقة (order_index) بيبدأ من 1 ومينفعش يتكرر في نفس السلسلة
function nextEpisodeNumber(seriesId) {
  return db.prepare(`SELECT COALESCE(MAX(order_index), 0) + 1 AS n FROM episodes WHERE series_id = ?`).get(seriesId).n;
}

// بيرجّع { value } أو { error } — exceptId: الحلقة اللي بتتعدل نفسها
function checkEpisodeNumber(seriesId, raw, exceptId = null) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { error: "رقم الحلقة لازم يكون رقم صحيح من 1 لـ 9999." };
  const taken = db.prepare(
    `SELECT id, title FROM episodes WHERE series_id = ? AND order_index = ? AND id != ?`
  ).get(seriesId, n, exceptId || 0);
  if (taken) {
    return { error: `الرقم ${n} مستخدم بالفعل للحلقة "${taken.title}" في نفس السلسلة. أول رقم فاضي: ${nextEpisodeNumber(seriesId)}.` };
  }
  return { value: n };
}

router.post("/episodes", (req, res) => {
  const { series_id } = req.body;
  const title = text(req.body.title, 200);
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الحلقة مطلوبان." });
  }
  const link = safeUrl(req.body.url);
  if (!link.ok) return res.status(400).json({ error: "رابط الحلقة يجب أن يبدأ بـ http:// أو https://" });
  const summaryLink = safeUrl(req.body.summary_url);
  if (!summaryLink.ok) return res.status(400).json({ error: "رابط ملف الملخص يجب أن يبدأ بـ http:// أو https://" });
  // رقم الحلقة اختياري: لو مش مكتوب بتاخد الرقم اللي بعد آخر حلقة
  let number = nextEpisodeNumber(series_id);
  if (req.body.number !== undefined && req.body.number !== null && String(req.body.number).trim() !== "") {
    const chk = checkEpisodeNumber(series_id, req.body.number);
    if (chk.error) return res.status(400).json({ error: chk.error });
    number = chk.value;
  }
  const info = db.prepare(
    `INSERT INTO episodes (series_id, title, url, duration, summary, summary_url, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(series_id, title, link.value, text(req.body.duration, 30), text(req.body.summary, 50000), summaryLink.value, number);
  res.status(201).json({ id: Number(info.lastInsertRowid), title, number });
});

router.patch("/episodes/:id", (req, res) => {
  req.body = { ...req.body };
  delete req.body.order_index; // الترتيب بيتغير بس من "number" (بعد التأكد إنه مش متكرر) أو من ↑↓
  if ("number" in req.body) {
    const ep = db.prepare(`SELECT id, series_id FROM episodes WHERE id = ?`).get(req.params.id);
    if (!ep) return res.status(404).json({ error: "العنصر غير موجود." });
    const chk = checkEpisodeNumber(ep.series_id, req.body.number, ep.id);
    if (chk.error) return res.status(400).json({ error: chk.error });
    req.body = { ...req.body, order_index: chk.value };
    delete req.body.number;
  }
  sendPatch(res, patchRow("episodes", req.params.id, req.body, {
    order_index: v => ({ ok: true, value: v }), // اتأكدنا منه فوق
    title: required("عنوان الحلقة", 200),
    url: urlField("رابط الحلقة"),
    duration: optional(30),
    summary: optional(50000),
    summary_url: urlField("رابط ملف الملخص"),
  }));
});

router.delete("/episodes/:id", (req, res) => {
  db.prepare(`DELETE FROM episodes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الكتب ----------
router.post("/books", (req, res) => {
  const { series_id } = req.body;
  const title = text(req.body.title, 200);
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الكتاب مطلوبان." });
  }
  const link = safeUrl(req.body.file_url);
  if (!link.ok) return res.status(400).json({ error: "رابط الكتاب يجب أن يبدأ بـ http:// أو https://" });
  const info = db.prepare(
    `INSERT INTO books (series_id, title, file_url, total_pages, order_index) VALUES (?, ?, ?, ?, ?)`
  ).run(series_id, title, link.value, Math.max(0, parseInt(req.body.total_pages, 10) || 0),
    nextOrder("books", "series_id", series_id));
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

router.patch("/books/:id", (req, res) => {
  sendPatch(res, patchRow("books", req.params.id, req.body, {
    title: required("عنوان الكتاب", 200),
    file_url: urlField("رابط الكتاب"),
    total_pages: pages,
  }));
});

router.delete("/books/:id", (req, res) => {
  db.prepare(`DELETE FROM books WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- إعادة الترتيب ----------
// body: { kind, ids: [...] } — الترتيب الجديد هو ترتيب الـ ids في القائمة
const ORDERABLE = {
  stages: "stages",
  "stage-subject": "stage_subject",
  series: "series",
  episodes: "episodes",
  books: "books",
};

router.post("/reorder", (req, res) => {
  const table = ORDERABLE[req.body.kind];
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (!table || ids.length === 0) return res.status(400).json({ error: "بيانات الترتيب غير صحيحة." });
  const stmt = db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`);
  db.exec("BEGIN");
  try {
    // الحلقات أرقامها من 1 (رقم الحلقة اللي بيظهر للمشرف)، والباقي ترتيب داخلي من 0
    const start = table === "episodes" ? 1 : 0;
    ids.forEach((id, i) => stmt.run(i + start, id));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  res.json({ ok: true });
});

module.exports = router;
