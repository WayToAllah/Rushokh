// routes/tests.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const sp = require("../lib/stage-progress");
const quiz = require("../lib/quiz");

const router = express.Router();

// ---------- جلب اختبار مع أسئلته (من غير أي إجابة صحيحة) ----------
// كل سؤال: { id, text, type, points, options? } — الخيارات بس لاختيار من متعدد وصح وغلط
router.get("/:id", requireAuth, requireRole("student"), (req, res) => {
  const test = db.prepare(`SELECT id, title, pass_percent FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });
  if (!sp.canAccessStage(req.user.id, sp.stageIdOf("test", test.id))) {
    return res.status(403).json({ error: "هذا الاختبار في مرحلة لم تُفتح لك بعد." });
  }
  res.json({ ...test, questions: quiz.questionsForStudent(test.id) });
});

// ---------- تسليم إجابات الاختبار وتصحيحها ----------
// body: { answers: [{ question_id, option_id }  (اختيار / صح وغلط)
//                   { question_id, text }       (أكمل / مقالي)] }
router.post("/:id/attempt", requireAuth, requireRole("student"), (req, res) => {
  const test = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });
  if (!sp.canAccessStage(req.user.id, sp.stageIdOf("test", test.id))) {
    return res.status(403).json({ error: "هذا الاختبار في مرحلة لم تُفتح لك بعد." });
  }

  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "صيغة الإجابات غير صحيحة." });
  }

  const graded = quiz.gradeAnswers(test.id, answers);
  if (graded.rows.length === 0) {
    return res.status(400).json({ error: "هذا الاختبار لا يحتوي على أسئلة بعد." });
  }
  const saved = quiz.saveAttempt(req.user.id, test, graded);

  res.json({
    score: saved.score,
    passed: saved.passed,
    status: saved.status,                         // graded | pending
    pending_count: graded.pendingCount,           // أسئلة مقالية مستنية تصحيح المشرف
    correct_count: graded.correctCount,
    total_questions: graded.rows.length,
    // صح/غلط لكل سؤال من غير ما نكشف الإجابة الصحيحة (null = مستني تصحيح)
    results: graded.rows.map(r => ({ question_id: r.question_id, correct: r.is_correct === null ? null : !!r.is_correct })),
    advanced_to: sp.advanceIfComplete(req.user.id),
  });
});

// ---------- نتيجة آخر محاولة بالتفصيل (بعد تصحيح المقالي مثلاً) ----------
// بيعرض إجابة الطالب ودرجته وملاحظة المصحح، من غير ما يكشف الإجابة الصحيحة للاختيار والأكمل
router.get("/:id/result", requireAuth, requireRole("student"), (req, res) => {
  const test = db.prepare(`SELECT id, title, pass_percent FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });
  const attempt = db.prepare(
    `SELECT id, score, passed, status, attempted_at FROM student_test_attempts
     WHERE student_id = ? AND test_id = ? ORDER BY id DESC LIMIT 1`
  ).get(req.user.id, test.id);
  if (!attempt) return res.status(404).json({ error: "لسه ما امتحنتش الاختبار ده." });

  const answers = db.prepare(
    `SELECT q.text AS question, q.type, a.answer_text, o.text AS option_text,
            a.is_correct, a.points_awarded, a.max_points, a.feedback
     FROM student_answers a
     JOIN questions q ON q.id = a.question_id
     LEFT JOIN options o ON o.id = a.option_id
     WHERE a.attempt_id = ? ORDER BY q.order_index ASC, q.id ASC`
  ).all(attempt.id).map(a => ({
    question: a.question,
    type: a.type,
    your_answer: a.option_text || a.answer_text || null,
    correct: a.is_correct === null ? null : !!a.is_correct,
    points: a.points_awarded,
    max_points: a.max_points,
    feedback: a.feedback,
  }));

  res.json({ test: test.title, pass_percent: test.pass_percent, ...attempt, passed: !!attempt.passed, answers });
});

module.exports = router;
