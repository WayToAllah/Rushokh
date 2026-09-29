// routes/curriculum.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const sp = require("../lib/stage-progress");

const router = express.Router();

// يبني شجرة كاملة: مرحلة -> أقسام -> سلاسل -> حلقات/كتب/اختبار (بدون إجابات الاختبار الصحيحة)
function buildSubjectsForStage(stageId, studentId) {
  const stageSubjects = db.prepare(
    `SELECT ss.id AS stage_subject_id, s.id AS subject_id, s.name, s.icon
     FROM stage_subject ss JOIN subjects s ON s.id = ss.subject_id
     WHERE ss.stage_id = ? ORDER BY ss.order_index ASC, ss.id ASC`
  ).all(stageId);

  return stageSubjects.map(subj => {
    const seriesRows = db.prepare(
      `SELECT id, name, url FROM series WHERE stage_subject_id = ? ORDER BY order_index ASC, id ASC`
    ).all(subj.stage_subject_id);

    const series = seriesRows.map(s => {
      const episodes = db.prepare(
        `SELECT e.id, e.title, e.duration, e.url,
                COALESCE(p.listened, 0) AS listened
         FROM episodes e
         LEFT JOIN student_episode_progress p
           ON p.episode_id = e.id AND p.student_id = ?
         WHERE e.series_id = ? ORDER BY e.order_index ASC, e.id ASC`
      ).all(studentId, s.id);

      const books = db.prepare(
        `SELECT b.id, b.title, b.total_pages, b.file_url,
                COALESCE(p.current_page, 0) AS current_page
         FROM books b
         LEFT JOIN student_book_progress p
           ON p.book_id = b.id AND p.student_id = ?
         WHERE b.series_id = ? ORDER BY b.order_index ASC, b.id ASC`
      ).all(studentId, s.id);

      // كل اختبارات السلسلة اللي فيها أسئلة، مع آخر نتيجة وهل نجح فيها قبل كده
      const tests = db.prepare(
        `SELECT t.id, t.title, t.pass_percent FROM tests t
         WHERE t.series_id = ? AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id)
         ORDER BY t.id ASC`
      ).all(s.id).map(t => {
        const last = db.prepare(
          `SELECT score FROM student_test_attempts
           WHERE student_id = ? AND test_id = ? ORDER BY id DESC LIMIT 1`
        ).get(studentId, t.id);
        const everPassed = db.prepare(
          `SELECT 1 FROM student_test_attempts WHERE student_id = ? AND test_id = ? AND passed = 1 LIMIT 1`
        ).get(studentId, t.id);
        return { ...t, last_score: last ? last.score : null, passed: !!everPassed };
      });

      return { id: s.id, name: s.name, url: s.url, episodes, books, tests };
    });

    return { id: subj.subject_id, name: subj.name, icon: subj.icon, series };
  });
}

// GET /api/curriculum  -> المنهج الكامل للطالب صاحب التوكن، بحالة كل مرحلة
router.get("/", requireAuth, requireRole("student"), (req, res) => {
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(req.user.id);
  if (!student) return res.status(404).json({ error: "الطالب غير موجود." });

  sp.advanceIfComplete(student.id); // لو المرحلة اكتملت (مثلاً اتحذف محتوى باقي) ينقله
  const current = sp.ensureCurrentStage(student.id);
  const ids = sp.orderedStageIds();
  const currentIdx = current ? ids.indexOf(current.id) : -1;
  const allStages = db.prepare(`SELECT * FROM stages ORDER BY order_index ASC, id ASC`).all();

  const stages = allStages.map((stage, idx) => {
    let status;
    if (idx < currentIdx) status = "completed";
    else if (idx === currentIdx) status = "current";
    else status = "locked";

    return {
      id: stage.id,
      name: stage.name,
      status,
      progress: status === "locked" ? null : sp.stageProgress(student.id, stage.id),
      subjects: status === "locked" ? [] : buildSubjectsForStage(stage.id, student.id)
    };
  });

  res.json({ student_name: student.full_name, stages });
});

module.exports = router;
