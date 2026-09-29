// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { signToken } = require("../middleware/auth");

const router = express.Router();

// ---------- تسجيل طالب جديد ----------
router.post("/register", (req, res) => {
  const { full_name, email, phone, age, address, password } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: "الاسم والبريد وكلمة المرور مطلوبة." });
  }

  const existing = db.prepare(`SELECT id FROM students WHERE email = ?`).get(email);
  if (existing) {
    return res.status(409).json({ error: "هذا البريد الإلكتروني مسجل مسبقاً." });
  }

  // المرحلة التمهيدية هي نقطة البداية الافتراضية لأي طالب جديد
  const firstStage = db.prepare(`SELECT id FROM stages ORDER BY order_index ASC LIMIT 1`).get();

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO students (full_name, email, phone, age, address, password_hash, current_stage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(full_name, email, phone || null, age || null, address || null, hash, firstStage ? firstStage.id : null);

  const token = signToken({ id: Number(info.lastInsertRowid), role: "student" });
  res.status(201).json({
    token,
    student: { id: Number(info.lastInsertRowid), full_name, email }
  });
});

// ---------- دخول طالب ----------
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "البريد وكلمة المرور مطلوبان." });
  }

  const student = db.prepare(`SELECT * FROM students WHERE email = ?`).get(email);
  if (!student || !bcrypt.compareSync(password, student.password_hash)) {
    return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
  }
  if (student.is_blocked) {
    return res.status(403).json({ error: "تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة." });
  }

  const token = signToken({ id: student.id, role: "student" });
  res.json({
    token,
    student: { id: student.id, full_name: student.full_name, email: student.email }
  });
});

// ---------- دخول مشرف ----------
router.post("/admin-login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "البريد وكلمة المرور مطلوبان." });
  }

  const admin = db.prepare(`SELECT * FROM admins WHERE email = ?`).get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "بيانات دخول المشرف غير صحيحة." });
  }

  const token = signToken({ id: admin.id, role: "admin" });
  res.json({
    token,
    admin: { id: admin.id, full_name: admin.full_name, email: admin.email }
  });
});

module.exports = router;
