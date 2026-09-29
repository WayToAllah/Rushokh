// routes/tests.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// ---------- جلب اختبار مع أسئلته وخياراته (بدون كشف الإجابة الصحيحة) ----------
router.get("/:id", requireAuth, requireRole("student"), (req, res) => {
  const test = db.prepare(`SELECT id, title, pass_percent FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });

  const questions = db.prepare(
    `SELECT id, text FROM questions WHERE test_id = ? ORDER BY order_index ASC`
  ).all(test.id);

  const questionsWithOptions = questions.map(q => ({
    id: q.id,
    text: q.text,
    options: db.prepare(`SELECT id, text FROM options WHERE question_id = ?`).all(q.id),
  }));

  res.json({ ...test, questions: questionsWithOptions });
});

// ---------- تسليم إجابات الاختبار وتصحيحها ----------
// body: { answers: [{ question_id, option_id }] }
router.post("/:id/attempt", requireAuth, requireRole("student"), (req, res) => {
  const test = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });

  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "صيغة الإجابات غير صحيحة." });
  }

  const questions = db.prepare(`SELECT id FROM questions WHERE test_id = ?`).all(test.id);
  let correctCount = 0;

  questions.forEach(q => {
    const submitted = answers.find(a => Number(a.question_id) === q.id);
    if (!submitted) return;
    const correctOption = db.prepare(
      `SELECT id FROM options WHERE question_id = ? AND is_correct = 1`
    ).get(q.id);
    if (correctOption && Number(submitted.option_id) === correctOption.id) {
      correctCount++;
    }
  });

  const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const passed = score >= test.pass_percent ? 1 : 0;

  db.prepare(
    `INSERT INTO student_test_attempts (student_id, test_id, score, passed, attempted_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(req.user.id, test.id, score, passed);

  res.json({
    score,
    passed: !!passed,
    correct_count: correctCount,
    total_questions: questions.length,
  });
});

module.exports = router;
