// routes/curriculum.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// يبني شجرة كاملة: مرحلة -> أقسام -> سلاسل -> حلقات/كتب/اختبار (بدون إجابات الاختبار الصحيحة)
function buildSubjectsForStage(stageId, studentId) {
  const stageSubjects = db.prepare(
    `SELECT ss.id AS stage_subject_id, s.id AS subject_id, s.name, s.icon
     FROM stage_subject ss JOIN subjects s ON s.id = ss.subject_id
     WHERE ss.stage_id = ? ORDER BY ss.order_index ASC`
  ).all(stageId);

  return stageSubjects.map(subj => {
    const seriesRows = db.prepare(
      `SELECT id, name FROM series WHERE stage_subject_id = ? ORDER BY order_index ASC`
    ).all(subj.stage_subject_id);

    const series = seriesRows.map(s => {
      const episodes = db.prepare(
        `SELECT e.id, e.title, e.duration, e.url,
                COALESCE(p.listened, 0) AS listened
         FROM episodes e
         LEFT JOIN student_episode_progress p
           ON p.episode_id = e.id AND p.student_id = ?
         WHERE e.series_id = ? ORDER BY e.order_index ASC`
      ).all(studentId, s.id);

      const books = db.prepare(
        `SELECT b.id, b.title, b.total_pages,
                COALESCE(p.current_page, 0) AS current_page
         FROM books b
         LEFT JOIN student_book_progress p
           ON p.book_id = b.id AND p.student_id = ?
         WHERE b.series_id = ? `
      ).all(studentId, s.id);

      const test = db.prepare(
        `SELECT id, title, pass_percent FROM tests WHERE series_id = ? LIMIT 1`
      ).get(s.id);

      let testPayload = null;
      if (test) {
        const lastAttempt = db.prepare(
          `SELECT score, passed FROM student_test_attempts
           WHERE student_id = ? AND test_id = ? ORDER BY attempted_at DESC LIMIT 1`
        ).get(studentId, test.id);
        testPayload = { ...test, last_score: lastAttempt ? lastAttempt.score : null };
      }

      return { id: s.id, name: s.name, episodes, books, test: testPayload };
    });

    return { id: subj.subject_id, name: subj.name, icon: subj.icon, series };
  });
}

// GET /api/curriculum  -> المنهج الكامل للطالب صاحب التوكن، بحالة كل مرحلة
router.get("/", requireAuth, requireRole("student"), (req, res) => {
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(req.user.id);
  if (!student) return res.status(404).json({ error: "الطالب غير موجود." });

  const allStages = db.prepare(`SELECT * FROM stages ORDER BY order_index ASC`).all();
  const currentOrder = student.current_stage_id
    ? (db.prepare(`SELECT order_index FROM stages WHERE id = ?`).get(student.current_stage_id) || {}).order_index
    : -1;

  const stages = allStages.map(stage => {
    let status;
    if (stage.order_index < currentOrder) status = "completed";
    else if (stage.order_index === currentOrder) status = "current";
    else status = "locked";

    return {
      id: stage.id,
      name: stage.name,
      status,
      subjects: status === "locked" ? [] : buildSubjectsForStage(stage.id, student.id)
    };
  });

  res.json({ student_name: student.full_name, stages });
});

module.exports = router;
