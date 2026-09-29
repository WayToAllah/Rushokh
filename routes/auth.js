// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { signToken } = require("../middleware/auth");
const { clientIp, createLimiter } = require("../lib/rate-limit");
const sp = require("../lib/stage-progress");

const router = express.Router();

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 10 محاولات دخول غلط لنفس البريد كل 15 دقيقة
const failedLogins = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
// 20 عملية (دخول/تسجيل) من نفس الجهاز في الدقيقة
const perIp = createLimiter({ windowMs: 60 * 1000, max: 20 });
// 5 حسابات جديدة من نفس الجهاز في الساعة
const registrations = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

router.use((req, res, next) => {
  const ip = clientIp(req);
  if (perIp.blockedFor(ip)) {
    return res.status(429).json({ error: "طلبات كثيرة جدًا، حاول مرة أخرى بعد دقيقة." });
  }
  perIp.hit(ip);
  next();
});

function normEmail(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function cleanText(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// ---------- تسجيل طالب جديد ----------
router.post("/register", (req, res) => {
  const ip = clientIp(req);
  const wait = registrations.blockedFor(ip);
  if (wait) return res.status(429).json({ error: `تم إنشاء حسابات كثيرة من هذا الجهاز، حاول بعد ${wait} دقيقة.` });

  const full_name = cleanText(req.body.full_name, 100);
  const email = normEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: "الاسم والبريد وكلمة المرور مطلوبة." });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return res.status(400).json({ error: "البريد الإلكتروني غير صحيح." });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.` });
  }

  let age = parseInt(req.body.age, 10);
  if (isNaN(age) || age < 5 || age > 120) age = null;

  const existing = db.prepare(`SELECT id FROM students WHERE lower(email) = ?`).get(email);
  if (existing) {
    return res.status(409).json({ error: "هذا البريد الإلكتروني مسجل مسبقاً." });
  }

  const first = sp.firstStage();
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO students (full_name, email, phone, age, address, password_hash, current_stage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(full_name, email, cleanText(req.body.phone, 30), age, cleanText(req.body.address, 200), hash, first ? first.id : null);

  registrations.hit(ip);
  const id = Number(info.lastInsertRowid);
  res.status(201).json({ token: signToken({ id, role: "student" }), student: { id, full_name, email } });
});

// دخول عام للطالب والمشرف مع حد للمحاولات الغلط
function login(table, role, wrongMsg) {
  return (req, res) => {
    const email = normEmail(req.body.email);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!email || !password) {
      return res.status(400).json({ error: "البريد وكلمة المرور مطلوبان." });
    }

    const key = role + ":" + email;
    const wait = failedLogins.blockedFor(key);
    if (wait) {
      return res.status(429).json({ error: `محاولات دخول خاطئة كثيرة، حاول مرة أخرى بعد ${wait} دقيقة.` });
    }

    const user = db.prepare(`SELECT * FROM ${table} WHERE lower(email) = ?`).get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      failedLogins.hit(key);
      return res.status(401).json({ error: wrongMsg });
    }
    if (role === "student" && user.is_blocked) {
      return res.status(403).json({ error: "تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة." });
    }

    failedLogins.reset(key);
    const profile = { id: user.id, full_name: user.full_name, email: user.email };
    res.json({ token: signToken({ id: user.id, role }), [role]: profile });
  };
}

router.post("/login", login("students", "student", "البريد الإلكتروني أو كلمة المرور غير صحيحة."));
router.post("/admin-login", login("admins", "admin", "بيانات دخول المشرف غير صحيحة."));

module.exports = { router, MIN_PASSWORD };
