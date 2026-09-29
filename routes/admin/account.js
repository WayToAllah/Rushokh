// routes/admin/account.js
// حساب المشرف: بياناته، تغيير كلمة المرور، وإدارة المشرفين.
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");
const { MIN_PASSWORD } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/me", (req, res) => {
  const me = db.prepare(`SELECT id, full_name, email FROM admins WHERE id = ?`).get(req.user.id);
  res.json(me);
});

// ---------- تغيير كلمة المرور ----------
router.post("/password", (req, res) => {
  const { current_password, new_password } = req.body;
  const me = db.prepare(`SELECT * FROM admins WHERE id = ?`).get(req.user.id);
  if (!me || typeof current_password !== "string" || !bcrypt.compareSync(current_password, me.password_hash)) {
    return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة." });
  }
  if (typeof new_password !== "string" || new_password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.` });
  }
  db.prepare(`UPDATE admins SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(new_password, 10), me.id);
  res.json({ ok: true });
});

// ---------- المشرفين ----------
router.get("/admins", (req, res) => {
  res.json(db.prepare(`SELECT id, full_name, email, created_at FROM admins ORDER BY id ASC`).all());
});

router.post("/admins", (req, res) => {
  const full_name = String(req.body.full_name || "").trim().slice(0, 100);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!full_name || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "الاسم وبريد إلكتروني صحيح مطلوبان." });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.` });
  }
  if (db.prepare(`SELECT id FROM admins WHERE lower(email) = ?`).get(email)) {
    return res.status(409).json({ error: "يوجد مشرف بهذا البريد بالفعل." });
  }
  const info = db.prepare(`INSERT INTO admins (full_name, email, password_hash) VALUES (?, ?, ?)`)
    .run(full_name, email, bcrypt.hashSync(password, 10));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.delete("/admins/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "لا يمكنك حذف حسابك الحالي." });
  const count = db.prepare(`SELECT COUNT(*) AS n FROM admins`).get().n;
  if (count <= 1) return res.status(400).json({ error: "لا يمكن حذف آخر مشرف." });
  db.prepare(`DELETE FROM admins WHERE id = ?`).run(id);
  res.json({ ok: true });
});

module.exports = router;
