// routes/admin/tests.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

function text(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function passPercent(v) {
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= 1 && n <= 100 ? n : null;
}

// الخيارات: خياران على الأقل، كل خيار له نص، وإجابة صحيحة واحدة بالظبط
function cleanOptions(options) {
  if (!Array.isArray(options)) return { error: "الخيارات مطلوبة." };
  const list = options
    .map(o => ({ text: text(o && o.text, 300), is_correct: !!(o && o.is_correct) }))
    .filter(o => o.text);
  if (list.length < 2) return { error: "لازم خياران على الأقل ليهم نص." };
  const correct = list.filter(o => o.is_correct).length;
  if (correct !== 1) return { error: "لازم تحدد إجابة صحيحة واحدة بالظبط." };
  return { list };
}

// ---------- عرض كل الاختبارات مع أسئلتها ----------
router.get("/", (req, res) => {
  const tests = db.prepare(
    `SELECT t.*, s.name AS series_name FROM tests t JOIN series s ON s.id = t.series_id ORDER BY t.id ASC`
  ).all();
  const withQuestions = tests.map(t => ({
    ...t,
    questions: db.prepare(`SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC`).all(t.id)
      .map(q => ({ ...q, options: db.prepare(`SELECT * FROM options WHERE question_id = ? ORDER BY id ASC`).all(q.id) }))
  }));
  res.json(withQuestions);
});

// ---------- إنشاء اختبار جديد لسلسلة ----------
router.post("/", (req, res) => {
  const { series_id } = req.body;
  const title = text(req.body.title, 200);
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الاختبار مطلوبان." });
  }
  const info = db.prepare(
    `INSERT INTO tests (series_id, title, pass_percent) VALUES (?, ?, ?)`
  ).run(series_id, title, passPercent(req.body.pass_percent) || 60);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

// ---------- تعديل عنوان الاختبار أو نسبة النجاح ----------
router.patch("/:id", (req, res) => {
  const test = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });
  const title = "title" in req.body ? text(req.body.title, 200) : test.title;
  const pass = "pass_percent" in req.body ? passPercent(req.body.pass_percent) : test.pass_percent;
  if (!title) return res.status(400).json({ error: "عنوان الاختبار مطلوب." });
  if (!pass) return res.status(400).json({ error: "نسبة النجاح لازم تكون رقم من 1 لـ 100." });
  db.prepare(`UPDATE tests SET title = ?, pass_percent = ? WHERE id = ?`).run(title, pass, test.id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare(`DELETE FROM tests WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- إضافة سؤال باختياراته (مع تحديد الصحيح) ----------
// body: { test_id, text, options: [{text, is_correct}, ...] }
router.post("/questions", (req, res) => {
  const { test_id } = req.body;
  const qText = text(req.body.text, 1000);
  if (!test_id || !qText) return res.status(400).json({ error: "الاختبار ونص السؤال مطلوبان." });
  const opts = cleanOptions(req.body.options);
  if (opts.error) return res.status(400).json({ error: opts.error });

  const order = db.prepare(`SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM questions WHERE test_id = ?`).get(test_id).n;
  db.exec("BEGIN");
  try {
    const questionId = Number(db.prepare(
      `INSERT INTO questions (test_id, text, order_index) VALUES (?, ?, ?)`
    ).run(test_id, qText, order).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`);
    opts.list.forEach(o => ins.run(questionId, o.text, o.is_correct ? 1 : 0));
    db.exec("COMMIT");
    res.status(201).json({ id: questionId });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

// ---------- تعديل سؤال: النص والخيارات (الخيارات القديمة بتتبدل بالجديدة) ----------
router.patch("/questions/:id", (req, res) => {
  const q = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(req.params.id);
  if (!q) return res.status(404).json({ error: "السؤال غير موجود." });
  const qText = "text" in req.body ? text(req.body.text, 1000) : q.text;
  if (!qText) return res.status(400).json({ error: "نص السؤال مطلوب." });
  let opts = null;
  if ("options" in req.body) {
    opts = cleanOptions(req.body.options);
    if (opts.error) return res.status(400).json({ error: opts.error });
  }
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE questions SET text = ? WHERE id = ?`).run(qText, q.id);
    if (opts) {
      db.prepare(`DELETE FROM options WHERE question_id = ?`).run(q.id);
      const ins = db.prepare(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`);
      opts.list.forEach(o => ins.run(q.id, o.text, o.is_correct ? 1 : 0));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  res.json({ ok: true });
});

router.delete("/questions/:id", (req, res) => {
  db.prepare(`DELETE FROM questions WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
