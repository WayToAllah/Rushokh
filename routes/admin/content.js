// routes/admin/content.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// ---------- عرض شجري كامل للمحتوى (كل المراحل بلا استثناء) ----------
router.get("/tree", (req, res) => {
  const stages = db.prepare(`SELECT * FROM stages ORDER BY order_index ASC`).all();

  const tree = stages.map(stage => {
    const subjects = db.prepare(
      `SELECT ss.id AS stage_subject_id, subj.id AS subject_id, subj.name, subj.icon
       FROM stage_subject ss JOIN subjects subj ON subj.id = ss.subject_id
       WHERE ss.stage_id = ? ORDER BY ss.order_index ASC`
    ).all(stage.id).map(subj => {
      const series = db.prepare(
        `SELECT * FROM series WHERE stage_subject_id = ? ORDER BY order_index ASC`
      ).all(subj.stage_subject_id).map(s => ({
        ...s,
        episodes: db.prepare(`SELECT * FROM episodes WHERE series_id = ? ORDER BY order_index ASC`).all(s.id),
        books: db.prepare(`SELECT * FROM books WHERE series_id = ?`).all(s.id),
        test: db.prepare(`SELECT * FROM tests WHERE series_id = ?`).get(s.id) || null,
      }));
      return { ...subj, series };
    });
    return { ...stage, subjects };
  });

  res.json(tree);
});

// ---------- قوائم مسطّحة (لتعبئة القوائم المنسدلة في لوحة المشرف) ----------
router.get("/stages", (req, res) => {
  res.json(db.prepare(`SELECT * FROM stages ORDER BY order_index ASC`).all());
});

router.get("/subjects", (req, res) => {
  res.json(db.prepare(`SELECT * FROM subjects ORDER BY id ASC`).all());
});

// ---------- المراحل ----------
router.post("/stages", (req, res) => {
  const { name, order_index } = req.body;
  if (!name) return res.status(400).json({ error: "اسم المرحلة مطلوب." });
  const info = db.prepare(`INSERT INTO stages (name, order_index) VALUES (?, ?)`)
    .run(name, order_index || 0);
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

router.delete("/stages/:id", (req, res) => {
  db.prepare(`DELETE FROM stages WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الأقسام ----------
router.post("/subjects", (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: "اسم القسم مطلوب." });
  const info = db.prepare(`INSERT INTO subjects (name, icon) VALUES (?, ?)`).run(name, icon || null);
  res.status(201).json({ id: Number(info.lastInsertRowid), name, icon });
});

router.delete("/subjects/:id", (req, res) => {
  db.prepare(`DELETE FROM subjects WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- ربط قسم بمرحلة ----------
router.post("/stage-subject", (req, res) => {
  const { stage_id, subject_id, order_index } = req.body;
  if (!stage_id || !subject_id) {
    return res.status(400).json({ error: "المرحلة والقسم مطلوبان." });
  }
  try {
    const info = db.prepare(
      `INSERT INTO stage_subject (stage_id, subject_id, order_index) VALUES (?, ?, ?)`
    ).run(stage_id, subject_id, order_index || 0);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(409).json({ error: "هذا القسم مرتبط بالفعل بهذه المرحلة." });
  }
});

router.delete("/stage-subject/:id", (req, res) => {
  db.prepare(`DELETE FROM stage_subject WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- السلاسل ----------
router.post("/series", (req, res) => {
  const { stage_subject_id, name, order_index } = req.body;
  if (!stage_subject_id || !name) {
    return res.status(400).json({ error: "القسم داخل المرحلة واسم السلسلة مطلوبان." });
  }
  const info = db.prepare(
    `INSERT INTO series (stage_subject_id, name, order_index) VALUES (?, ?, ?)`
  ).run(stage_subject_id, name, order_index || 0);
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
});

router.delete("/series/:id", (req, res) => {
  db.prepare(`DELETE FROM series WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الحلقات ----------
router.post("/episodes", (req, res) => {
  const { series_id, title, url, duration, order_index } = req.body;
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الحلقة مطلوبان." });
  }
  const info = db.prepare(
    `INSERT INTO episodes (series_id, title, url, duration, order_index) VALUES (?, ?, ?, ?, ?)`
  ).run(series_id, title, url || null, duration || null, order_index || 0);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

router.delete("/episodes/:id", (req, res) => {
  db.prepare(`DELETE FROM episodes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- الكتب ----------
router.post("/books", (req, res) => {
  const { series_id, title, file_url, total_pages } = req.body;
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الكتاب مطلوبان." });
  }
  const info = db.prepare(
    `INSERT INTO books (series_id, title, file_url, total_pages) VALUES (?, ?, ?, ?)`
  ).run(series_id, title, file_url || null, total_pages || 0);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

router.delete("/books/:id", (req, res) => {
  db.prepare(`DELETE FROM books WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
