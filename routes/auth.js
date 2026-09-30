// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { signToken } = require("../middleware/auth");
const { clientIp, createLimiter } = require("../lib/rate-limit");
const sp = require("../lib/stage-progress");
const mailer = require("../lib/mailer");
const ev = require("../lib/email-verification");

const router = express.Router();

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 10 محاولات دخول غلط لنفس البريد من نفس الجهاز كل 15 دقيقة.
// القفل على الجهاز اللي بيجرّب بس، عشان محدش يقدر يقفل حساب غيره (زي المشرف) بمحاولات غلط.
const failedLogins = createLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
// 20 عملية (دخول/تسجيل) من نفس الجهاز في الدقيقة
const perIp = createLimiter({ windowMs: 60 * 1000, max: 20 });
// 5 حسابات جديدة من نفس الجهاز في الساعة
const registrations = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
// 6 أكواد تأكيد لنفس البريد في الساعة (غير حد الدقيقة بين كل كود والتاني)
const codeSends = createLimiter({ windowMs: 60 * 60 * 1000, max: 6 });

const NEEDS_VERIFY_MSG = "لازم تأكد بريدك الإلكتروني الأول. اكتب الكود اللي وصلك على بريدك.";

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

// يبعت كود تأكيد جديد لو الحدود تسمح. بيرجّع عدد الثواني اللي لازم يستناها لو لسه بدري، أو 0.
async function sendCodeIfAllowed(student) {
  const wait = ev.secondsUntilResend(student.id);
  if (wait) return wait;
  const hourWait = codeSends.blockedFor(student.email);
  if (hourWait) return hourWait * 60;
  codeSends.hit(student.email);
  await ev.sendCode(student);
  return 0;
}

// ---------- تسجيل طالب جديد ----------
// لو تأكيد البريد شغّال: الحساب بيتعمل من غير توكن، ويتبعت كود على البريد، والطالب يدخل بعد ما يكتبه.
router.post("/register", async (req, res, next) => {
  try {
    await register(req, res);
  } catch (err) {
    next(err);
  }
});

async function register(req, res) {
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
  const needsVerify = mailer.enabled();
  const info = db.prepare(
    `INSERT INTO students (full_name, email, phone, age, address, password_hash, current_stage_id, email_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(full_name, email, cleanText(req.body.phone, 30), age, cleanText(req.body.address, 200), hash,
        first ? first.id : null, needsVerify ? 0 : 1);

  registrations.hit(ip);
  const id = Number(info.lastInsertRowid);

  if (needsVerify) {
    try {
      await sendCodeIfAllowed({ id, email });
    } catch (err) {
      // من غير كود مايقدرش يأكد، فبنلغي التسجيل عشان يقدر يجرّب تاني بنفس البريد
      db.prepare(`DELETE FROM students WHERE id = ?`).run(id);
      console.error("⚠️  تعذّر إرسال كود التأكيد:", err.message);
      return res.status(502).json({ error: "تعذّر إرسال كود التأكيد على البريد ده. اتأكد إن البريد صحيح وحاول تاني." });
    }
    return res.status(201).json({ needs_verification: true, email });
  }
  res.status(201).json({ token: signToken({ id, role: "student" }), student: { id, full_name, email } });
}

// ---------- تأكيد البريد بالكود ----------
// الكود بيثبت إن البريد بتاعه، فبعد التأكيد بيدخل على طول.
router.post("/verify-email", (req, res) => {
  const email = normEmail(req.body.email);
  const code = String(req.body.code || "").replace(/\D/g, "");
  const st = db.prepare(`SELECT * FROM students WHERE lower(email) = ?`).get(email);
  if (!st || code.length !== 6) return res.status(400).json({ error: "الكود غير صحيح." });
  if (st.email_verified) return res.status(400).json({ error: "البريد ده متأكد بالفعل، ادخل بكلمة المرور." });

  const result = ev.checkCode(st.id, code);
  if (result.status === "wrong") {
    return res.status(400).json({ error: `الكود غلط. فاضل ${result.left} ${result.left === 1 ? "محاولة" : "محاولات"}.` });
  }
  if (result.status === "locked") {
    return res.status(400).json({ error: "محاولات غلط كتير. اطلب كود جديد." });
  }
  if (result.status === "expired") {
    return res.status(400).json({ error: "الكود انتهى. اطلب كود جديد." });
  }
  if (st.is_blocked) {
    return res.status(403).json({ error: "تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة." });
  }
  const profile = { id: st.id, full_name: st.full_name, email: st.email };
  res.json({ token: signToken({ id: st.id, role: "student" }), role: "student", student: profile });
});

// ---------- كود تأكيد جديد ----------
router.post("/resend-code", async (req, res, next) => {
  try {
    const email = normEmail(req.body.email);
    const st = db.prepare(`SELECT id, email, email_verified FROM students WHERE lower(email) = ?`).get(email);
    if (!mailer.enabled() || !st || st.email_verified) return res.json({ ok: true });
    const wait = await sendCodeIfAllowed(st);
    if (wait) return res.status(429).json({ error: `استنى ${wait} ثانية قبل ما تطلب كود جديد.`, wait });
    res.json({ ok: true });
  } catch (err) {
    console.error("⚠️  تعذّر إرسال كود التأكيد:", err.message);
    res.status(502).json({ error: "تعذّر إرسال الكود دلوقتي، حاول تاني بعد شوية." });
  }
});

const TABLES = { admin: "admins", student: "students" };

// هاش وهمي: لو البريد مش موجود بنقارن بيه برضه، عشان وقت الرد ما يكشفش مين عنده حساب
const DUMMY_HASH = bcrypt.hashSync("rasokh-no-such-account", 10);

function findAccount(role, email, password) {
  const user = db.prepare(`SELECT * FROM ${TABLES[role]} WHERE lower(email) = ?`).get(email);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  return ok && user ? user : null;
}

// دخول مع حد للمحاولات الغلط. roles بالترتيب: أول حساب كلمة مروره صح هو اللي بيدخل.
function login(roles, wrongMsg) {
  return async (req, res, next) => {
    try {
      await doLogin(req, res, roles, wrongMsg);
    } catch (err) {
      next(err);
    }
  };
}

async function doLogin(req, res, roles, wrongMsg) {
  const email = normEmail(req.body.email);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!email || !password) {
    return res.status(400).json({ error: "البريد وكلمة المرور مطلوبان." });
  }

  const key = clientIp(req) + "|" + email;
  const wait = failedLogins.blockedFor(key);
  if (wait) {
    return res.status(429).json({ error: `محاولات دخول خاطئة كثيرة، حاول مرة أخرى بعد ${wait} دقيقة.` });
  }

  let user = null, role = null;
  for (const r of roles) {
    user = findAccount(r, email, password);
    if (user) { role = r; break; }
  }
  if (!user) {
    failedLogins.hit(key);
    return res.status(401).json({ error: wrongMsg });
  }
  if (role === "student" && user.is_blocked) {
    return res.status(403).json({ error: "تم إيقاف هذا الحساب، يرجى التواصل مع الإدارة." });
  }

  failedLogins.reset(key);

  // بريد لسه ما اتأكدش: مفيش دخول، ولو مفيش كود صالح نبعت واحد جديد
  if (role === "student" && !user.email_verified && mailer.enabled()) {
    if (!ev.hasValidCode(user.id)) {
      try {
        await sendCodeIfAllowed(user);
      } catch (err) {
        console.error("⚠️  تعذّر إرسال كود التأكيد:", err.message);
      }
    }
    return res.status(403).json({ error: NEEDS_VERIFY_MSG, needs_verification: true, email: user.email });
  }

  const profile = { id: user.id, full_name: user.full_name, email: user.email };
  res.json({ token: signToken({ id: user.id, role }), role, [role]: profile });
}

// دخول واحد للكل: المشرف يروح لوحة المشرف، والطالب صفحته.
// لو نفس البريد ليه حساب مشرف وحساب طالب، كلمة المرور هي اللي بتحدد (المشرف الأول).
router.post("/login", login(["admin", "student"], "البريد الإلكتروني أو كلمة المرور غير صحيحة."));
// دخول المشرف بس (متساب للسكريبتات والاختبارات)
router.post("/admin-login", login(["admin"], "بيانات دخول المشرف غير صحيحة."));

module.exports = { router, MIN_PASSWORD };
