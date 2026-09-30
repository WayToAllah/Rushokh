// lib/email-verification.js
// كود تأكيد البريد: 6 أرقام، صالح 15 دقيقة، 5 محاولات غلط بالكتير، وكود جديد كل دقيقة بالكتير.
// الكود نفسه مش بيتخزن، بيتخزن الـ hash بتاعه بس.
// الإيميل مافيهوش أي نص كتبه اللي بيسجّل (زي الاسم)، عشان محدش يستخدم التسجيل يبعت رسايل باسمنا.

const crypto = require("crypto");
const db = require("../db/database");
const mailer = require("./mailer");

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashOf = code => crypto.createHash("sha256").update(code).digest("hex");

function pending(studentId) {
  return db.prepare(`SELECT * FROM email_verifications WHERE student_id = ?`).get(studentId);
}

// ثواني لازم يستناها قبل ما يطلب كود جديد (0 = يقدر دلوقتي)
function secondsUntilResend(studentId) {
  const p = pending(studentId);
  if (!p) return 0;
  return Math.max(0, Math.ceil((p.sent_at + RESEND_AFTER_MS - Date.now()) / 1000));
}

function hasValidCode(studentId) {
  const p = pending(studentId);
  return !!p && p.expires_at > Date.now() && p.attempts < MAX_ATTEMPTS;
}

function emailBody(code) {
  const text =
    `السلام عليكم،\n\nكود تأكيد بريدك في منصة رسوخ: ${code}\n\n` +
    `الكود صالح لمدة 15 دقيقة.\nلو ما عملتش حساب في رسوخ، تجاهل الرسالة دي.`;
  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#F5F0E2;padding:24px;">
  <div style="max-width:420px;margin:0 auto;background:#FBF8EE;border-radius:12px;border-top:4px solid #B9924F;padding:24px;color:#1B2C28;">
    <h2 style="margin:0 0 12px;color:#0E332F;">رسوخ</h2>
    <p style="margin:0 0 8px;">السلام عليكم،</p>
    <p style="margin:0 0 8px;">كود تأكيد بريدك:</p>
    <p dir="ltr" style="margin:16px 0;font-size:30px;font-weight:bold;letter-spacing:8px;text-align:center;color:#1F5951;">${code}</p>
    <p style="margin:0;color:#4A5C56;font-size:13px;">الكود صالح لمدة 15 دقيقة. لو ما عملتش حساب في رسوخ، تجاهل الرسالة دي.</p>
  </div>
</div>`;
  return { text, html };
}

// يعمل كود جديد (بيلغي أي كود قديم) ويبعته. لو الإرسال فشل الكود بيتشال، والخطأ بيترمي للي نادى.
async function sendCode(student) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const now = Date.now();
  db.prepare(
    `INSERT INTO email_verifications (student_id, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(student_id) DO UPDATE SET
       code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`
  ).run(student.id, hashOf(code), now + CODE_TTL_MS, now);
  try {
    await mailer.send({ to: student.email, subject: `كود تأكيد بريدك في رسوخ: ${code}`, ...emailBody(code) });
  } catch (err) {
    db.prepare(`DELETE FROM email_verifications WHERE student_id = ?`).run(student.id);
    throw err;
  }
}

// { status: "ok" } أو "wrong" (ومعاه left = المحاولات الباقية) أو "locked" أو "expired"
function checkCode(studentId, code) {
  const p = pending(studentId);
  if (!p || p.expires_at <= Date.now()) return { status: "expired" };
  if (p.attempts >= MAX_ATTEMPTS) return { status: "locked" };

  const ok = crypto.timingSafeEqual(Buffer.from(hashOf(code), "hex"), Buffer.from(p.code_hash, "hex"));
  if (!ok) {
    db.prepare(`UPDATE email_verifications SET attempts = attempts + 1 WHERE student_id = ?`).run(studentId);
    const left = MAX_ATTEMPTS - p.attempts - 1;
    return left > 0 ? { status: "wrong", left } : { status: "locked" };
  }

  db.prepare(`DELETE FROM email_verifications WHERE student_id = ?`).run(studentId);
  db.prepare(`UPDATE students SET email_verified = 1 WHERE id = ?`).run(studentId);
  return { status: "ok" };
}

module.exports = { sendCode, checkCode, hasValidCode, secondsUntilResend };
