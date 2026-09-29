// routes/progress.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("student"));

// ---------- تحديث حالة "تم السماع" لحلقة ----------
router.post("/episode", (req, res) => {
  const { episode_id, listened } = req.body;
  const episode = db.prepare(`SELECT id FROM episodes WHERE id = ?`).get(episode_id);
  if (!episode) return res.status(404).json({ error: "الحلقة غير موجودة." });

  db.prepare(
    `INSERT INTO student_episode_progress (student_id, episode_id, listened, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, episode_id)
     DO UPDATE SET listened = excluded.listened, updated_at = datetime('now')`
  ).run(req.user.id, episode_id, listened ? 1 : 0);

  res.json({ ok: true });
});

// ---------- تحديث رقم الصفحة الحالية لكتاب ----------
router.post("/book", (req, res) => {
  const { book_id, current_page } = req.body;
  const book = db.prepare(`SELECT id, total_pages FROM books WHERE id = ?`).get(book_id);
  if (!book) return res.status(404).json({ error: "الكتاب غير موجود." });

  let page = parseInt(current_page, 10);
  if (isNaN(page) || page < 0) page = 0;
  if (page > book.total_pages) page = book.total_pages;

  db.prepare(
    `INSERT INTO student_book_progress (student_id, book_id, current_page, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, book_id)
     DO UPDATE SET current_page = excluded.current_page, updated_at = datetime('now')`
  ).run(req.user.id, book_id, page);

  res.json({ ok: true, current_page: page });
});

// ---------- تقرير الطالب: تم الانتهاء منه / قيد الدراسة ----------
router.get("/me/report", (req, res) => {
  const studentId = req.user.id;
  const student = db.prepare(`SELECT * FROM students WHERE id = ?`).get(studentId);
  if (!student || !student.current_stage_id) {
    return res.json({ completed: [], in_progress: [] });
  }

  const episodes = db.prepare(
    `SELECT e.id, e.title, s.name AS series_name, subj.name AS subject_name,
            COALESCE(p.listened, 0) AS listened
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).all(studentId, student.current_stage_id);

  const books = db.prepare(
    `SELECT b.id, b.title, b.total_pages, subj.name AS subject_name,
            COALESCE(p.current_page, 0) AS current_page
     FROM books b
     JOIN series s ON s.id = b.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).all(studentId, student.current_stage_id);

  const completed = [
    ...episodes.filter(e => e.listened).map(e => ({ type: "episode", title: e.title, context: `${e.subject_name} / ${e.series_name}` })),
    ...books.filter(b => b.current_page >= b.total_pages && b.total_pages > 0).map(b => ({ type: "book", title: b.title, context: b.subject_name })),
  ];

  const in_progress = [
    ...episodes.filter(e => !e.listened).map(e => ({ type: "episode", title: e.title, context: `${e.subject_name} / ${e.series_name}` })),
    ...books.filter(b => b.current_page < b.total_pages).map(b => ({ type: "book", title: b.title, context: `${b.subject_name} — صفحة ${b.current_page} من ${b.total_pages}` })),
  ];

  res.json({ completed, in_progress });
});

// ---------- شهادة المرحلة: نسبة الإنجاز + بيانات الشهادة إن اكتملت ----------
router.get("/certificate/:stageId", (req, res) => {
  const studentId = req.user.id;
  const stageId = req.params.stageId;

  const episodesCount = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN p.listened = 1 THEN 1 ELSE 0 END) AS done
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).get(studentId, stageId);

  const booksCount = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(p.current_page,0) >= b.total_pages AND b.total_pages > 0 THEN 1 ELSE 0 END) AS done
     FROM books b
     JOIN series s ON s.id = b.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).get(studentId, stageId);

  const total = (episodesCount.total || 0) + (booksCount.total || 0);
  const done = (episodesCount.done || 0) + (booksCount.done || 0);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const student = db.prepare(`SELECT full_name FROM students WHERE id = ?`).get(studentId);
  const stage = db.prepare(`SELECT name FROM stages WHERE id = ?`).get(stageId);

  res.json({
    eligible: percent === 100 && total > 0,
    percent,
    stage_name: stage ? stage.name : null,
    student_name: student ? student.full_name : null,
    total_episodes: episodesCount.total || 0,
    total_books: booksCount.total || 0,
  });
});

module.exports = router;
