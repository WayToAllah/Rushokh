// routes/lessons.js
// صفحة الدرس (الحلقة) للطالب: الفيديو والملخص واختبارات الحلقة وملاحظاته الخاصة والمناقشة.
const express = require("express");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const sp = require("../lib/stage-progress");
const quiz = require("../lib/quiz");
const { createLimiter } = require("../lib/rate-limit");
const { commentsFor } = require("../lib/comments");

const router = express.Router();
router.use(requireAuth, requireRole("student"));

// 10 تعليقات كل 5 دقايق للطالب الواحد، عشان محدش يغرق المناقشة
const commentLimiter = createLimiter({ windowMs: 5 * 60 * 1000, max: 10 });

// بيجيب الحلقة لو الطالب مسموح له يشوفها، وإلا بيرد بالخطأ ويرجّع null
function loadEpisode(req, res) {
  const id = Number(req.params.id);
  const ep = Number.isInteger(id) ? db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) : null;
  if (!ep) { res.status(404).json({ error: "الدرس غير موجود." }); return null; }
  if (!sp.canAccessStage(req.user.id, sp.stageIdOf("episode", ep.id))) {
    res.status(403).json({ error: "هذا الدرس في مرحلة لم تُفتح لك بعد." });
    return null;
  }
  return ep;
}

// ---------- بيانات الدرس كلها ----------
router.get("/:id", (req, res) => {
  const ep = loadEpisode(req, res);
  if (!ep) return;
  const studentId = req.user.id;

  const ctx = db.prepare(
    `SELECT s.id AS series_id, s.name AS series_name, subj.id AS subject_id, subj.name AS subject_name,
            st.id AS stage_id, st.name AS stage_name
     FROM series s
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     JOIN stages st ON st.id = ss.stage_id
     WHERE s.id = ?`
  ).get(ep.series_id);

  // الحلقة اللي قبلها واللي بعدها في نفس السلسلة
  const siblings = db.prepare(
    `SELECT id, title FROM episodes WHERE series_id = ? ORDER BY order_index ASC, id ASC`
  ).all(ep.series_id);
  const idx = siblings.findIndex(x => x.id === ep.id);

  const listened = db.prepare(
    `SELECT listened FROM student_episode_progress WHERE student_id = ? AND episode_id = ?`
  ).get(studentId, ep.id);
  const tests = quiz.episodeTests(ep.id).map(t => quiz.testStatus(studentId, t));
  const note = db.prepare(
    `SELECT body, updated_at FROM student_episode_notes WHERE student_id = ? AND episode_id = ?`
  ).get(studentId, ep.id);
  const books = db.prepare(
    `SELECT b.id, b.title, b.file_url, b.total_pages, COALESCE(p.current_page, 0) AS current_page
     FROM books b LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE b.series_id = ? ORDER BY b.order_index ASC, b.id ASC`
  ).all(studentId, ep.series_id);
  const commentsCount = db.prepare(`SELECT COUNT(*) AS n FROM episode_comments WHERE episode_id = ?`).get(ep.id).n;

  const isListened = !!(listened && listened.listened);
  res.json({
    id: ep.id,
    title: ep.title,
    url: ep.url,
    duration: ep.duration,
    summary: ep.summary,
    summary_url: ep.summary_url,
    ...ctx,
    listened: isListened,
    done: isListened && tests.every(t => t.passed),
    tests,
    books,
    note: note ? note.body : "",
    note_updated_at: note ? note.updated_at : null,
    comments_count: commentsCount,
    position: idx + 1,
    count: siblings.length,
    prev: idx > 0 ? siblings[idx - 1] : null,
    next: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null,
  });
});

// ---------- ملاحظاتي (خاصة بالطالب) ----------
router.put("/:id/note", (req, res) => {
  const ep = loadEpisode(req, res);
  if (!ep) return;
  const body = String(req.body.body ?? "").slice(0, 10000);
  if (!body.trim()) {
    db.prepare(`DELETE FROM student_episode_notes WHERE student_id = ? AND episode_id = ?`).run(req.user.id, ep.id);
    return res.json({ ok: true, updated_at: null });
  }
  db.prepare(
    `INSERT INTO student_episode_notes (student_id, episode_id, body, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(student_id, episode_id) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
  ).run(req.user.id, ep.id, body);
  const row = db.prepare(`SELECT updated_at FROM student_episode_notes WHERE student_id = ? AND episode_id = ?`).get(req.user.id, ep.id);
  res.json({ ok: true, updated_at: row.updated_at });
});

// ---------- المناقشة ----------
router.get("/:id/comments", (req, res) => {
  const ep = loadEpisode(req, res);
  if (!ep) return;
  res.json(commentsFor(ep.id, { studentId: req.user.id }));
});

// body: { body, parent_id? } — parent_id للرد على تعليق رئيسي
router.post("/:id/comments", (req, res) => {
  const ep = loadEpisode(req, res);
  if (!ep) return;
  const body = String(req.body.body ?? "").trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: "اكتب تعليقك الأول." });

  let parentId = null;
  if (req.body.parent_id) {
    const parent = db.prepare(`SELECT id, parent_id, episode_id FROM episode_comments WHERE id = ?`).get(Number(req.body.parent_id));
    if (!parent || parent.episode_id !== ep.id) return res.status(400).json({ error: "التعليق اللي بترد عليه مش موجود." });
    parentId = parent.parent_id || parent.id; // الردود كلها تحت التعليق الرئيسي
  }

  const key = "c" + req.user.id;
  const wait = commentLimiter.blockedFor(key);
  if (wait) return res.status(429).json({ error: `كتبت تعليقات كتير ورا بعض، استنى ${wait} دقيقة.` });
  commentLimiter.hit(key);

  const info = db.prepare(
    `INSERT INTO episode_comments (episode_id, parent_id, student_id, body) VALUES (?, ?, ?, ?)`
  ).run(ep.id, parentId, req.user.id, body);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// الطالب يمسح تعليقه هو بس
router.delete("/comments/:commentId", (req, res) => {
  const info = db.prepare(`DELETE FROM episode_comments WHERE id = ? AND student_id = ?`)
    .run(Number(req.params.commentId), req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: "التعليق غير موجود." });
  res.json({ ok: true });
});

module.exports = router;
