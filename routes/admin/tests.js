// routes/admin/tests.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// ---------- عرض كل الاختبارات مع أسئلتها ----------
router.get("/", (req, res) => {
  const tests = db.prepare(
    `SELECT t.*, s.name AS series_name FROM tests t JOIN series s ON s.id = t.series_id`
  ).all();
  const withQuestions = tests.map(t => ({
    ...t,
    questions: db.prepare(`SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC`).all(t.id)
      .map(q => ({ ...q, options: db.prepare(`SELECT * FROM options WHERE question_id = ?`).all(q.id) }))
  }));
  res.json(withQuestions);
});

// ---------- إنشاء اختبار جديد لسلسلة ----------
router.post("/", (req, res) => {
  const { series_id, title, pass_percent } = req.body;
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الاختبار مطلوبان." });
  }
  const info = db.prepare(
    `INSERT INTO tests (series_id, title, pass_percent) VALUES (?, ?, ?)`
  ).run(series_id, title, pass_percent || 60);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

router.delete("/:id", (req, res) => {
  db.prepare(`DELETE FROM tests WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- إضافة سؤال باختياراته الأربعة (مع تحديد الصحيح) ----------
// body: { test_id, text, options: [{text, is_correct}, ...] }
router.post("/questions", (req, res) => {
  const { test_id, text, order_index, options } = req.body;
  if (!test_id || !text || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: "الاختبار، نص السؤال، وخياران على الأقل مطلوبة." });
  }
  const hasCorrect = options.some(o => o.is_correct);
  if (!hasCorrect) {
    return res.status(400).json({ error: "يجب تحديد إجابة صحيحة واحدة على الأقل." });
  }

  const qInfo = db.prepare(
    `INSERT INTO questions (test_id, text, order_index) VALUES (?, ?, ?)`
  ).run(test_id, text, order_index || 0);
  const questionId = Number(qInfo.lastInsertRowid);

  options.forEach(o => {
    db.prepare(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`)
      .run(questionId, o.text, o.is_correct ? 1 : 0);
  });

  res.status(201).json({ id: questionId });
});

router.delete("/questions/:id", (req, res) => {
  db.prepare(`DELETE FROM questions WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
