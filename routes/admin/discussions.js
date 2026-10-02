// routes/admin/discussions.js — المشرف بيتابع مناقشات الدروس: يرد، يثبّت، يمسح
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { commentsFor } = require("../../lib/comments");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// GET /api/admin/discussions?unanswered=1
// آخر التعليقات الرئيسية (الأحدث الأول) مع ردودها ومكان الدرس.
// "مستني رد" = تعليق طالب ما عليهوش رد من المشرف.
router.get("/", (req, res) => {
  const onlyUnanswered = req.query.unanswered === "1";
  const rows = db.prepare(
    `SELECT c.id, c.episode_id, e.title AS episode_title, se.name AS series_name, subj.name AS subject_name,
            NOT EXISTS (SELECT 1 FROM episode_comments r WHERE r.parent_id = c.id AND r.student_id IS NULL) AS unanswered
     FROM episode_comments c
     JOIN episodes e ON e.id = c.episode_id
     JOIN series se ON se.id = e.series_id
     JOIN stage_subject ss ON ss.id = se.stage_subject_id
     JOIN subjects subj ON subj.id = ss.subject_id
     WHERE c.parent_id IS NULL AND c.student_id IS NOT NULL
     ORDER BY c.id DESC LIMIT 200`
  ).all();

  const threadsByEpisode = new Map();
  const list = [];
  for (const r of rows) {
    if (onlyUnanswered && !r.unanswered) continue;
    if (!threadsByEpisode.has(r.episode_id)) threadsByEpisode.set(r.episode_id, commentsFor(r.episode_id));
    const thread = threadsByEpisode.get(r.episode_id).find(t => t.id === r.id);
    if (!thread) continue;
    list.push({
      ...thread,
      episode_id: r.episode_id,
      episode_title: r.episode_title,
      series_name: r.series_name,
      subject_name: r.subject_name,
      unanswered: !!r.unanswered,
    });
    if (list.length >= 100) break;
  }
  const unansweredCount = rows.filter(r => r.unanswered).length;
  res.json({ unanswered_count: unansweredCount, comments: list });
});

// رد المشرف أو تعليق جديد منه على درس. body: { body, parent_id? }
router.post("/:episodeId", (req, res) => {
  const episodeId = Number(req.params.episodeId);
  if (!db.prepare(`SELECT 1 FROM episodes WHERE id = ?`).get(episodeId)) {
    return res.status(404).json({ error: "الدرس غير موجود." });
  }
  const body = String(req.body.body ?? "").trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: "اكتب الرد الأول." });
  let parentId = null;
  if (req.body.parent_id) {
    const parent = db.prepare(`SELECT id, parent_id, episode_id FROM episode_comments WHERE id = ?`).get(Number(req.body.parent_id));
    if (!parent || parent.episode_id !== episodeId) return res.status(400).json({ error: "التعليق اللي بترد عليه مش موجود." });
    parentId = parent.parent_id || parent.id;
  }
  const info = db.prepare(
    `INSERT INTO episode_comments (episode_id, parent_id, admin_id, body) VALUES (?, ?, ?, ?)`
  ).run(episodeId, parentId, req.user.id, body);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// تثبيت تعليق رئيسي فوق المناقشة أو إلغاء تثبيته. body: { pinned: true|false }
router.patch("/comments/:id", (req, res) => {
  const info = db.prepare(`UPDATE episode_comments SET pinned = ? WHERE id = ? AND parent_id IS NULL`)
    .run(req.body.pinned ? 1 : 0, Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "التعليق غير موجود." });
  res.json({ ok: true });
});

// مسح أي تعليق (والردود اللي تحته بتتمسح معاه)
router.delete("/comments/:id", (req, res) => {
  const info = db.prepare(`DELETE FROM episode_comments WHERE id = ?`).run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "التعليق غير موجود." });
  res.json({ ok: true });
});

module.exports = router;
