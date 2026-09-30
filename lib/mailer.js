// lib/mailer.js
// إرسال الإيميلات (كود تأكيد البريد) عن طريق SMTP، زي Gmail.
// بيشتغل بس لو SMTP_HOST و SMTP_USER و SMTP_PASS موجودين في .env. غير كده تأكيد البريد مقفول
// والتسجيل بيشتغل زي الأول.
// المكتبة بتتحمّل وقت الحاجة بس، عشان الموقع يقوم عادي حتى لو لسه بتتسطّب أثناء التحديث.

let transporter = null;

function enabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    const nodemailer = require("nodemailer");
    const port = parseInt(process.env.SMTP_PORT, 10) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = اتصال مشفّر من الأول، 587 = بيتشفّر بعد الاتصال (STARTTLS)
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

function send({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || `رسوخ <${process.env.SMTP_USER}>`;
  return getTransporter().sendMail({ from, to, subject, text, html });
}

// بيتنادى مرة عند تشغيل السيرفر: يكتب في الشباك لو تأكيد البريد شغّال، ولو إعدادات الإيميل سليمة
async function checkOnStartup() {
  if (!enabled()) {
    console.log("📧 تأكيد البريد مقفول (مفيش إعدادات SMTP في .env)، والتسجيل شغّال من غيره.");
    return;
  }
  try {
    await getTransporter().verify();
    console.log(`📧 تأكيد البريد شغّال، والأكواد هتتبعت من ${process.env.SMTP_USER}`);
  } catch (err) {
    console.error("⚠️  إعدادات الإيميل (SMTP) فيها مشكلة، ومحدش هيقدر يسجّل لحد ما تتصلح:", err.message);
  }
}

module.exports = { enabled, send, checkOnStartup };
