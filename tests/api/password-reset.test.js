// نسيت كلمة المرور: كود على البريد وكلمة مرور جديدة (مع سيرفر إيميل وهمي)
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, mail;
before(async () => { app = await startApp({ smtp: true }); mail = app.mailbox; });
after(() => app.close());

// طالب متأكد بريده (بنعلّمه في قاعدة البيانات مباشرة عشان نركّز على استعادة كلمة المرور)
let n = 0;
async function verifiedStudent() {
  const email = `reset${++n}@t.com`;
  await app.call("POST", "/auth/register", { body: { full_name: "x", email, password: "old-password" } });
  app.db.prepare(`UPDATE students SET email_verified = 1 WHERE email = ?`).run(email);
  await mail.waitFor(email); // كود التأكيد بتاع التسجيل
  return email;
}
const forgot = email => app.call("POST", "/auth/forgot-password", { body: { email } });
const reset = (email, code, new_password = "new-password-1") => app.call("POST", "/auth/reset-password", { body: { email, code, new_password } });
const wrongCode = code => String((Number(code) + 1) % 1000000).padStart(6, "0");
const loginStatus = async (email, password) => (await app.call("POST", "/auth/login", { body: { email, password } })).status;

describe("طلب الكود", () => {
  it("بيبعت إيميل منفصل عن تأكيد البريد، فيه كود 6 أرقام ومن غير أي نص كتبه المستخدم", async () => {
    const email = await verifiedStudent();
    const r = await forgot(email);
    assert.equal(r.status, 200);
    await mail.waitFor(email, 2);
    const m = mail.to(email)[1];
    assert.match(m.subject, /كلمة المرور/);
    assert.match(mail.lastCode(email), /^\d{6}$/);
    assert.doesNotMatch(`${m.text} ${m.html}`, /old-password/);
  });

  it("بريد مش متسجّل: نفس الرد من غير ما يتبعت حاجة (محدش يعرف مين عنده حساب)", async () => {
    const before = mail.messages.length;
    const r = await forgot("nobody-here@t.com");
    assert.equal(r.status, 200);
    await new Promise(res => setTimeout(res, 200));
    assert.equal(mail.messages.length, before);
  });

  it("طلب تاني في نفس الدقيقة مرفوض، سواء البريد متسجّل أو لأ", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    assert.equal((await forgot(email)).status, 429);
    await forgot("ghost-twice@t.com");
    assert.equal((await forgot("ghost-twice@t.com")).status, 429);
  });

  it("الطالب الموقوف مابيوصلوش كود", async () => {
    const email = await verifiedStudent();
    app.db.prepare(`UPDATE students SET is_blocked = 1 WHERE email = ?`).run(email);
    const count = mail.to(email).length;
    assert.equal((await forgot(email)).status, 200);
    await new Promise(res => setTimeout(res, 200));
    assert.equal(mail.to(email).length, count);
  });

  it("بريد مكتوب غلط (400)", async () => {
    assert.equal((await forgot("not-an-email")).status, 400);
  });
});

describe("كلمة المرور الجديدة", () => {
  it("الكود الصح بيغيّر كلمة المرور ويدخّل على طول، والقديمة مابقتش شغالة", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    await mail.waitFor(email, 2);
    const r = await reset(email, mail.lastCode(email));
    assert.equal(r.status, 200);
    assert.equal(r.data.role, "student");
    assert.equal((await app.call("GET", "/curriculum", { token: r.data.token })).status, 200);
    assert.equal(await loginStatus(email, "old-password"), 401);
    assert.equal(await loginStatus(email, "new-password-1"), 200);
  });

  it("الكود مايتستخدمش مرتين", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    await mail.waitFor(email, 2);
    const code = mail.lastCode(email);
    assert.equal((await reset(email, code)).status, 200);
    assert.equal((await reset(email, code, "another-pass-2")).status, 400);
  });

  it("كود غلط بيقول فاضل كام محاولة، وبعد 5 بيتقفل حتى لو الصح", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    await mail.waitFor(email, 2);
    const code = mail.lastCode(email);
    const first = await reset(email, wrongCode(code));
    assert.match(first.data.error, /فاضل 4/);
    for (let i = 0; i < 4; i++) await reset(email, wrongCode(code));
    assert.match((await reset(email, code)).data.error, /محاولات غلط كتير/);
    assert.equal(await loginStatus(email, "old-password"), 200, "كلمة المرور ماتغيّرتش");
  });

  it("كلمة مرور جديدة قصيرة بتترفض من غير ما تضيّع محاولة", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    await mail.waitFor(email, 2);
    assert.equal((await reset(email, mail.lastCode(email), "short")).status, 400);
    assert.equal(app.db.prepare(`SELECT attempts FROM password_resets WHERE student_id = (SELECT id FROM students WHERE email = ?)`).get(email).attempts, 0);
    assert.equal((await reset(email, mail.lastCode(email))).status, 200);
  });

  it("كود منتهي بيطلب كود جديد", async () => {
    const email = await verifiedStudent();
    await forgot(email);
    await mail.waitFor(email, 2);
    app.db.prepare(`UPDATE password_resets SET expires_at = 1 WHERE student_id = (SELECT id FROM students WHERE email = ?)`).run(email);
    assert.match((await reset(email, mail.lastCode(email))).data.error, /انتهى/);
  });

  it("كود تأكيد البريد مايشتغلش كود لتغيير كلمة المرور", async () => {
    const email = `mix${++n}@t.com`;
    await app.call("POST", "/auth/register", { body: { full_name: "x", email, password: "old-password" } });
    await mail.waitFor(email);
    assert.equal((await reset(email, mail.lastCode(email))).status, 400);
  });

  it("طالب بريده ماتأكدش: تغيير كلمة المرور بالكود بيأكد بريده كمان", async () => {
    const email = `unverified${++n}@t.com`;
    await app.call("POST", "/auth/register", { body: { full_name: "x", email, password: "old-password" } });
    await mail.waitFor(email);
    await forgot(email);
    await mail.waitFor(email, 2);
    assert.equal((await reset(email, mail.lastCode(email))).status, 200);
    assert.equal(app.db.prepare(`SELECT email_verified FROM students WHERE email = ?`).get(email).email_verified, 1);
    assert.equal(await loginStatus(email, "new-password-1"), 200);
  });
});
