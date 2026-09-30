// lib/email-codes.js
// أكواد من 6 أرقام بتتبعت على البريد: تأكيد البريد (email_verifications) واستعادة كلمة المرور (password_resets).
// كل كود: صالح 15 دقيقة، و5 محاولات غلط بالكتير، وكود جديد كل دقيقة بالكتير.
// الكود نفسه مش بيتخزن، بيتخزن الـ hash بتاعه بس.
// الإيميل مافيهوش أي نص كتبه المستخدم (زي الاسم)، عشان محدش يستخدم الموقع يبعت رسايل باسمنا.

const crypto = require("crypto");
const db = require("../db/database");
const mailer = require("./mailer");

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashOf = code => crypto.createHash("sha256").update(code).digest("hex");

function emailBody(code, { intro, footer }) {
  const text = `السلام عليكم،\n\n${intro}: ${code}\n\nالكود صالح لمدة 15 دقيقة.\n${footer}`;
  const html = `
<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#F5F0E2;padding:24px;">
  <div style="max-width:420px;margin:0 auto;background:#FBF8EE;border-radius:12px;border-top:4px solid #B9924F;padding:24px;color:#1B2C28;">
    <h2 style="margin:0 0 12px;color:#0E332F;">رسوخ</h2>
    <p style="margin:0 0 8px;">السلام عليكم،</p>
    <p style="margin:0 0 8px;">${intro}:</p>
    <p dir="ltr" style="margin:16px 0;font-size:30px;font-weight:bold;letter-spacing:8px;text-align:center;color:#1F5951;">${code}</p>
    <p style="margin:0;color:#4A5C56;font-size:13px;">الكود صالح لمدة 15 دقيقة. ${footer}</p>
  </div>
</div>`;
  return { text, html };
}

// table: جدول الأكواد (عمود student_id مفتاح). subject/intro/footer: نص الإيميل.
function createCodeStore({ table, subject, intro, footer }) {
  const pending = studentId => db.prepare(`SELECT * FROM ${table} WHERE student_id = ?`).get(studentId);

  return {
    // ثواني لازم يستناها قبل ما يطلب كود جديد (0 = يقدر دلوقتي)
    secondsUntilResend(studentId) {
      const p = pending(studentId);
      if (!p) return 0;
      return Math.max(0, Math.ceil((p.sent_at + RESEND_AFTER_MS - Date.now()) / 1000));
    },

    hasValidCode(studentId) {
      const p = pending(studentId);
      return !!p && p.expires_at > Date.now() && p.attempts < MAX_ATTEMPTS;
    },

    // يعمل كود جديد (بيلغي أي كود قديم) ويبعته. لو الإرسال فشل الكود بيتشال، والخطأ بيترمي للي نادى.
    async sendCode(student) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const now = Date.now();
      db.prepare(
        `INSERT INTO ${table} (student_id, code_hash, expires_at, attempts, sent_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(student_id) DO UPDATE SET
           code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`
      ).run(student.id, hashOf(code), now + CODE_TTL_MS, now);
      try {
        await mailer.send({ to: student.email, subject: `${subject}: ${code}`, ...emailBody(code, { intro, footer }) });
      } catch (err) {
        db.prepare(`DELETE FROM ${table} WHERE student_id = ?`).run(student.id);
        throw err;
      }
    },

    // { status: "ok" } أو "wrong" (ومعاه left = المحاولات الباقية) أو "locked" أو "expired".
    // الكود الصح بيتشال بعد ما يتستخدم، واللي نادى هو اللي بيعمل الخطوة اللي بعده.
    checkCode(studentId, code) {
      const p = pending(studentId);
      if (!p || p.expires_at <= Date.now()) return { status: "expired" };
      if (p.attempts >= MAX_ATTEMPTS) return { status: "locked" };

      const ok = crypto.timingSafeEqual(Buffer.from(hashOf(code), "hex"), Buffer.from(p.code_hash, "hex"));
      if (!ok) {
        db.prepare(`UPDATE ${table} SET attempts = attempts + 1 WHERE student_id = ?`).run(studentId);
        const left = MAX_ATTEMPTS - p.attempts - 1;
        return left > 0 ? { status: "wrong", left } : { status: "locked" };
      }
      db.prepare(`DELETE FROM ${table} WHERE student_id = ?`).run(studentId);
      return { status: "ok" };
    },
  };
}

// رسالة الخطأ المناسبة لنتيجة checkCode (غير "ok")
function codeError(result) {
  if (result.status === "wrong") return `الكود غلط. فاضل ${result.left} ${result.left === 1 ? "محاولة" : "محاولات"}.`;
  if (result.status === "locked") return "محاولات غلط كتير. اطلب كود جديد.";
  return "الكود انتهى. اطلب كود جديد.";
}

const verification = createCodeStore({
  table: "email_verifications",
  subject: "كود تأكيد بريدك في رسوخ",
  intro: "كود تأكيد بريدك في منصة رسوخ",
  footer: "لو ما عملتش حساب في رسوخ، تجاهل الرسالة دي.",
});

const passwordReset = createCodeStore({
  table: "password_resets",
  subject: "كود تغيير كلمة المرور في رسوخ",
  intro: "كود تغيير كلمة المرور في منصة رسوخ",
  footer: "لو ماطلبتش تغيير كلمة المرور، تجاهل الرسالة دي وكلمة مرورك هتفضل زي ما هي.",
});

module.exports = { verification, passwordReset, codeError };
