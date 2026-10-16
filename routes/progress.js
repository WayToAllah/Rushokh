// routes/progress.js
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const sp = require("../lib/stage-progress");

const router = express.Router();
router.use(requireAuth, requireRole("student"));

// ---------- تحديث حالة "تم السماع" لحلقة ----------
router.post("/episode", (req, res) => {
  const { episode_id, listened } = req.body;
  const stageId = sp.stageIdOf("episode", episode_id);
  if (!stageId) return res.status(404).json({ error: "الحلقة غير موجودة." });
  if (!sp.canAccessStage(req.user.id, stageId)) {
    return res.status(403).json({ error: "هذه الحلقة في مرحلة لم تُفتح لك بعد." });
  }

  db.prepare(
    `INSERT INTO student_episode_progress (student_id, episode_id, listened, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, episode_id)
     DO UPDATE SET listened = excluded.listened, updated_at = datetime('now')`
  ).run(req.user.id, episode_id, listened ? 1 : 0);

  res.json({ ok: true, advanced_to: sp.advanceIfComplete(req.user.id) });
});

// ---------- تحديث رقم الصفحة الحالية لكتاب ----------
router.post("/book", (req, res) => {
  const { book_id, current_page } = req.body;
  const book = db.prepare(`SELECT id, total_pages FROM books WHERE id = ?`).get(book_id);
  if (!book) return res.status(404).json({ error: "الكتاب غير موجود." });
  if (!sp.canAccessStage(req.user.id, sp.stageIdOf("book", book_id))) {
    return res.status(403).json({ error: "هذا الكتاب في مرحلة لم تُفتح لك بعد." });
  }

  let page = parseInt(current_page, 10);
  if (isNaN(page) || page < 0) page = 0;
  if (page > book.total_pages) page = book.total_pages;

  db.prepare(
    `INSERT INTO student_book_progress (student_id, book_id, current_page, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, book_id)
     DO UPDATE SET current_page = excluded.current_page, updated_at = datetime('now')`
  ).run(req.user.id, book_id, page);

  res.json({ ok: true, current_page: page, advanced_to: sp.advanceIfComplete(req.user.id) });
});

// ---------- تقرير الطالب: تم الانتهاء منه / قيد الدراسة (للمرحلة الحالية) ----------
router.get("/me/report", (req, res) => {
  const studentId = req.user.id;
  const stage = sp.ensureCurrentStage(studentId);
  if (!stage) return res.json({ completed: [], in_progress: [] });

  const episodes = db.prepare(
    `SELECT e.id, e.title, e.series_id, s.name AS series_name, subj.name AS subject_name,
            CASE WHEN COALESCE(p.listened, 0) = 1 AND NOT EXISTS (
              -- الحلقة ما تتحسبش خلصت لو عليها اختبار لسه ما اتنجحش فيه
              SELECT 1 FROM tests t WHERE t.episode_id = e.id
                AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id)
                AND NOT EXISTS (SELECT 1 FROM student_test_attempts a WHERE a.test_id = t.id AND a.student_id = p.student_id AND a.passed = 1)
            ) THEN 1 ELSE 0 END AS listened
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE ss.stage_id = ?
     ORDER BY e.order_index, e.id`
  ).all(studentId, stage.id);

  const books = db.prepare(
    `SELECT b.id, b.title, b.series_id, b.total_pages, subj.name AS subject_name,
            COALESCE(p.current_page, 0) AS current_page
     FROM books b
     JOIN series s ON s.id = b.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).all(studentId, stage.id);

  const completed = [
    ...episodes.filter(e => e.listened).map(e => ({ type: "episode", title: e.title, context: `${e.subject_name} / ${e.series_name}` })),
    ...books.filter(b => b.current_page >= b.total_pages && b.total_pages > 0).map(b => ({ type: "book", title: b.title, context: b.subject_name })),
  ];

  const in_progress = [
    ...episodes.filter(e => !e.listened).map(e => ({ type: "episode", title: e.title, context: `${e.subject_name} / ${e.series_name}` })),
    ...books.filter(b => b.current_page < b.total_pages).map(b => ({ type: "book", title: b.title, context: `${b.subject_name} — صفحة ${b.current_page} من ${b.total_pages}` })),
  ];

  // ---- التقدّم لكل سلسلة: كل حلقة = وحدة، كل كتاب = وحدة بنسبة صفحاته، كل اختبار على السلسلة = وحدة ----
  const seriesRows = db.prepare(
    `SELECT s.id, s.name, subj.name AS subject_name
     FROM series s
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     WHERE ss.stage_id = ?
     ORDER BY ss.order_index, ss.id, s.order_index, s.id`
  ).all(stage.id);
  const seriesTests = db.prepare(
    `SELECT t.series_id,
            EXISTS (SELECT 1 FROM student_test_attempts a WHERE a.test_id = t.id AND a.student_id = ? AND a.passed = 1) AS passed
     FROM tests t
     JOIN series s ON s.id = t.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     WHERE ss.stage_id = ? AND t.episode_id IS NULL
       AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id)`
  ).all(studentId, stage.id);

  const series = seriesRows.map(sr => {
    const eps = episodes.filter(e => e.series_id === sr.id);
    const bks = books.filter(b => b.series_id === sr.id && b.total_pages > 0);
    const tsts = seriesTests.filter(t => t.series_id === sr.id);
    const total = eps.length + bks.length + tsts.length;
    const done = eps.filter(e => e.listened).length
      + bks.reduce((sum, b) => sum + Math.min(1, b.current_page / b.total_pages), 0)
      + tsts.filter(t => t.passed).length;
    return {
      id: sr.id,
      name: sr.name,
      subject_name: sr.subject_name,
      percent: total ? Math.floor((done / total) * 100) : 0,
      episodes_done: eps.filter(e => e.listened).length,
      episodes_total: eps.length,
      books_done: bks.filter(b => b.current_page >= b.total_pages).length,
      books_total: bks.length,
      tests_passed: tsts.filter(t => t.passed).length,
      tests_total: tsts.length,
      items: [
        ...eps.map(e => ({ type: "episode", title: e.title, done: !!e.listened })),
        ...bks.map(b => ({ type: "book", title: b.title, done: b.current_page >= b.total_pages, current_page: b.current_page, total_pages: b.total_pages })),
      ],
    };
  }).filter(x => x.items.length || x.tests_total);

  res.json({ stage_name: stage.name, completed, in_progress, series });
});

// ---------- شهادة مرحلة ----------
// تُصرف لو الطالب أتم المرحلة (مسجّلة في student_stage_completions) أو لو مكتملة الآن.
router.get("/certificate/:stageId", (req, res) => {
  const studentId = req.user.id;
  const stageId = Number(req.params.stageId);
  const stage = db.prepare(`SELECT id, name FROM stages WHERE id = ?`).get(stageId);
  if (!stage) return res.status(404).json({ error: "المرحلة غير موجودة." });

  sp.advanceIfComplete(studentId); // يسجّل الإتمام لو المرحلة اكتملت ولسه ما اتسجلتش
  const progress = sp.stageProgress(studentId, stageId);
  const completion = sp.completionOf(studentId, stageId);
  const student = db.prepare(`SELECT full_name, gender FROM students WHERE id = ?`).get(studentId);

  res.json({
    eligible: !!completion,
    percent: completion ? 100 : progress.percent,
    stage_name: stage.name,
    student_name: student ? student.full_name : null,
    gender: student ? student.gender || null : null,
    total_episodes: progress.episodes_total,
    total_books: progress.books_total,
    total_tests: progress.tests_total,
    tests_passed: progress.tests_passed,
    completed_at: completion ? completion.completed_at : null,
    certificate_no: completion ? "RSK-" + String(completion.id).padStart(6, "0") : null,
  });
});

module.exports = router;
