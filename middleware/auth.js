// middleware/auth.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../db/database");

// مفتاح توقيع الجلسات:
// 1) من متغير البيئة JWT_SECRET لو موجود
// 2) وإلا من ملف db/.jwt-secret (يتولّد عشوائيًا أول مرة ويفضل ثابت بعد كده)
// مفيش أي مفتاح افتراضي مكتوب في الكود، عشان محدش يقدر يزوّر جلسة من قراية الكود.
function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  if (process.env.JWT_SECRET) {
    console.warn("⚠️  JWT_SECRET قصير جدًا (أقل من 16 حرف)، هيتم تجاهله واستخدام مفتاح عشوائي.");
  }
  const file = path.join(__dirname, "..", "db", ".jwt-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (e) { /* الملف مش موجود لسه */ }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const JWT_SECRET = loadSecret();

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// يتحقق من التوكن، وكمان إن صاحبه لسه موجود ومش ممنوع (عشان المنع والحذف يسري فورًا)
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "الرجاء تسجيل الدخول أولاً." });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "الجلسة منتهية أو غير صالحة، الرجاء تسجيل الدخول مجدداً." });
  }

  if (decoded.role === "student") {
    const st = db.prepare(`SELECT is_blocked FROM students WHERE id = ?`).get(decoded.id);
    if (!st) return res.status(401).json({ error: "الحساب غير موجود، الرجاء تسجيل الدخول مجدداً." });
    if (st.is_blocked) return res.status(403).json({ error: "تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة." });
  } else if (decoded.role === "admin") {
    const ad = db.prepare(`SELECT id FROM admins WHERE id = ?`).get(decoded.id);
    if (!ad) return res.status(401).json({ error: "الحساب غير موجود، الرجاء تسجيل الدخول مجدداً." });
  } else {
    return res.status(401).json({ error: "جلسة غير صالحة." });
  }

  req.user = { id: decoded.id, role: decoded.role };
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "ليست لديك صلاحية للوصول لهذا المورد." });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole };
