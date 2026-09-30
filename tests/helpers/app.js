// tests/helpers/app.js
// كل ملف اختبار بيشغّل نسخة خاصة بيه من الموقع: قاعدة بيانات مؤقتة فيها بيانات التجربة، وبورت عشوائي.
// الملفات بتشتغل كل واحد في process لوحده، فمفيش ملف بيأثر على التاني.
//
//   const { startApp } = require("../helpers/app");
//   const app = await startApp();            // أو startApp({ smtp: true }) لتأكيد البريد
//   const r = await app.call("POST", "/auth/login", { body: {...} });
//   after(() => app.close());

const path = require("path");
const fs = require("fs");
const os = require("os");

let ipCounter = 0;
// كل طلب بيجي من "جهاز" مختلف، عشان حدود الطلبات لكل جهاز ما تأثرش على الاختبار (إلا لو حددنا ip بنفسنا)
const nextIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${++ipCounter & 255}`;

let started = false;

async function startApp({ smtp = false } = {}) {
  // ملفات المشروع بتتحمّل مرة واحدة في الـ process، فنسخة واحدة بس لكل ملف اختبار
  if (started) throw new Error("startApp() اتنادت مرتين في نفس الملف. استخدم نسخة واحدة للملف كله.");
  started = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasokh-test-"));
  // لازم قبل ما أي ملف من المشروع يتحمّل. القيم الفاضية بتمنع .env بتاع الجهاز إنه يدخل في الاختبار.
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.JWT_SECRET = "test-secret-".padEnd(48, "x");
  process.env.TRUST_PROXY = "";
  process.env.ADMIN_EMAIL = "";
  process.env.ADMIN_PASSWORD = "";
  process.env.SMTP_HOST = process.env.SMTP_PORT = process.env.SMTP_USER = process.env.SMTP_PASS = process.env.MAIL_FROM = "";

  let mailbox = null;
  if (smtp) {
    mailbox = await startMailbox();
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(mailbox.port);
    process.env.SMTP_USER = "sender@rasokh.test";
    process.env.SMTP_PASS = "test";
  }

  const log = console.log;
  console.log = () => {}; // رسايل الـ seed مش محتاجينها في نتيجة الاختبار
  try {
    require("../../db/seed").seed();
  } finally {
    console.log = log;
  }

  const app = require("../../server");
  const db = require("../../db/database");
  const server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, apiPath, { token, body, ip, headers, raw } = {}) {
    const res = await fetch(base + "/api" + apiPath, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "cf-connecting-ip": ip || nextIp(),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(headers || {}),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    if (raw) return res;
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* مش JSON */ }
    return { status: res.status, data, headers: res.headers };
  }

  async function login(email, password) {
    const r = await call("POST", "/auth/login", { body: { email, password } });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  let seq = 0;
  // طالب جديد برقم مميز. بيرجّع { id, email, token }
  async function newStudent(extra = {}) {
    const email = `student${Date.now()}_${++seq}@test.com`;
    const r = await call("POST", "/auth/register", { body: { full_name: "طالب اختبار", email, password: "password123", ...extra } });
    if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
    return { id: r.data.student && r.data.student.id, email, token: r.data.token };
  }

  // اختصارات للمحتوى اللي في بيانات التجربة
  const stages = () => db.prepare(`SELECT * FROM stages ORDER BY order_index, id`).all();
  const stageByName = name => db.prepare(`SELECT * FROM stages WHERE name = ?`).get(name);

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (mailbox) await mailbox.close();
    try { db.close(); } catch (e) { /* مقفولة بالفعل */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return {
    base, call, login, newStudent, db, close, mailbox, stages, stageByName,
    adminToken: () => login("admin@rasokh.test", "admin123"),
    demoStudentToken: () => login("ahmed@rasokh.test", "student123"),
  };
}

// سيرفر إيميل وهمي: بيستقبل الرسايل ويحفظها، عشان نقرا كود التأكيد من غير إيميل حقيقي
async function startMailbox() {
  const { SMTPServer } = require("smtp-server");
  const { simpleParser } = require("mailparser");
  const messages = [];
  const rejectPrefix = "bounce";
  const server = new SMTPServer({
    secure: false,
    disabledCommands: ["STARTTLS"],
    authMethods: ["PLAIN", "LOGIN"],
    logger: false,
    onAuth(auth, session, cb) { cb(null, { user: auth.username }); },
    onRcptTo(address, session, cb) {
      if (address.address.startsWith(rejectPrefix)) {
        const err = new Error("No such user");
        err.responseCode = 550;
        return cb(err);
      }
      cb();
    },
    onData(stream, session, cb) {
      simpleParser(stream).then(m => { messages.push(m); cb(); }, cb);
    },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const to = addr => messages.filter(m => m.to.value[0].address === addr);
  return {
    port: server.server.address().port,
    messages,
    to,
    lastCode(addr) {
      const m = to(addr).slice(-1)[0];
      return m ? (m.subject.match(/\d{6}/) || [])[0] : null;
    },
    async waitFor(addr, count = 1) {
      for (let i = 0; i < 100; i++) {
        if (to(addr).length >= count) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error(`no email #${count} for ${addr}`);
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { startApp };
