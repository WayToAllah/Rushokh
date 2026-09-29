// routes/admin/students.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");
const sp = require("../../lib/stage-progress");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// ---------- قائمة الطلاب ----------
router.get("/", (req, res) => {
  const students = db.prepare(
    `SELECT st.id, st.full_name, st.email, st.phone, st.age, st.is_blocked,
            st.current_stage_id, stg.name AS stage_name
     FROM students st LEFT JOIN stages stg ON stg.id = st.current_stage_id
     ORDER BY st.created_at DESC`
  ).all();
  res.json(students);
});

// ---------- منع / تفعيل طالب ----------
router.patch("/:id/block", (req, res) => {
  const { is_blocked } = req.body;
  const info = db.prepare(`UPDATE students SET is_blocked = ? WHERE id = ?`)
    .run(is_blocked ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "الطالب غير موجود." });
  res.json({ ok: true });
});

// ---------- نقل طالب لمرحلة معيّنة يدويًا (لتصحيح الأخطاء مثلاً) ----------
router.patch("/:id/stage", (req, res) => {
  const stage = db.prepare(`SELECT id, name FROM stages WHERE id = ?`).get(req.body.stage_id);
  if (!stage) return res.status(400).json({ error: "المرحلة غير موجودة." });
  const info = db.prepare(`UPDATE students SET current_stage_id = ? WHERE id = ?`).run(stage.id, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "الطالب غير موجود." });
  res.json({ ok: true, stage_name: stage.name });
});

// ---------- كلمة مرور جديدة لطالب نسي كلمة المرور ----------
router.patch("/:id/password", (req, res) => {
  const { MIN_PASSWORD } = require("../auth");
  const pw = typeof req.body.new_password === "string" ? req.body.new_password : "";
  if (pw.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.` });
  }
  const bcrypt = require("bcryptjs");
  const info = db.prepare(`UPDATE students SET password_hash = ? WHERE id = ?`)
    .run(bcrypt.hashSync(pw, 10), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "الطالب غير موجود." });
  res.json({ ok: true });
});

// ---------- حذف طالب ----------
router.delete("/:id", (req, res) => {
  db.prepare(`DELETE FROM students WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- تقرير طالب محدد: تم الانتهاء منه / بدأ ولم ينتهِ (بدون ذكر ما لم يبدأ) ----------
router.get("/:id/report", (req, res) => {
  const studentId = req.params.id;
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(studentId);
  if (!student) return res.status(404).json({ error: "الطالب غير موجود." });
  const stage = sp.ensureCurrentStage(student.id);
  if (!stage) return res.json({ finished: [], started: [] });

  const episodes = db.prepare(
    `SELECT e.title, s.name AS series_name, subj.name AS subject_name,
            COALESCE(p.listened, 0) AS listened
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).all(studentId, stage.id);

  const books = db.prepare(
    `SELECT b.title, b.total_pages, subj.name AS subject_name,
            COALESCE(p.current_page, 0) AS current_page
     FROM books b
     JOIN series s ON s.id = b.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).all(studentId, stage.id);

  // "تم الانتهاء منه": حلقة استمع لها، أو كتاب أنهى صفحاته
  const finished = [
    ...episodes.filter(e => e.listened).map(e => `${e.subject_name} / ${e.series_name} — ${e.title}`),
    ...books.filter(b => b.total_pages > 0 && b.current_page >= b.total_pages).map(b => `${b.subject_name} — ${b.title}`),
  ];

  // "بدأ فيه ولم ينتهِ": كتاب قرأ منه صفحات لكن لم يكمل (الحلقات ليس لها حالة "بدأ" جزئية، فتُستثنى)
  const started = books
    .filter(b => b.current_page > 0 && b.current_page < b.total_pages)
    .map(b => `${b.subject_name} — ${b.title} (صفحة ${b.current_page} من ${b.total_pages})`);

  const completedStages = db.prepare(
    `SELECT stg.name, c.completed_at FROM student_stage_completions c
     JOIN stages stg ON stg.id = c.stage_id
     WHERE c.student_id = ? ORDER BY c.completed_at ASC`
  ).all(studentId);

  res.json({
    stage_name: stage.name,
    progress: sp.stageProgress(student.id, stage.id),
    completed_stages: completedStages,
    finished,
    started,
  });
});

module.exports = router;
