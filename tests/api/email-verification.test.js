// تأكيد البريد بالكود (مع سيرفر إيميل وهمي)
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app, mail;
before(async () => { app = await startApp({ smtp: true }); mail = app.mailbox; });
after(() => app.close());

let n = 0;
async function register(prefix = "v") {
  const email = `${prefix}${++n}@t.com`;
  const r = await app.call("POST", "/auth/register", { body: { full_name: "زائر visit http://evil.example", email, password: "password123" } });
  return { email, r };
}
const verify = (email, code) => app.call("POST", "/auth/verify-email", { body: { email, code } });
const wrongCode = code => String((Number(code) + 1) % 1000000).padStart(6, "0");
const pending = email => app.db.prepare(`SELECT v.* FROM email_verifications v JOIN students s ON s.id = v.student_id WHERE s.email = ?`).get(email);

describe("التسجيل مع تأكيد البريد", () => {
  it("مابيرجعش توكن، وبيبعت كود 6 أرقام", async () => {
    const { email, r } = await register();
    assert.equal(r.status, 201);
    assert.equal(r.data.needs_verification, true);
    assert.equal(r.data.token, undefined);
    await mail.waitFor(email);
    assert.match(mail.lastCode(email), /^\d{6}$/);
  });

  it("الإيميل مافيهوش أي نص كتبه اللي سجّل (عشان محدش يبعت رسايل باسمنا)", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const m = mail.to(email)[0];
    assert.doesNotMatch(`${m.subject} ${m.text} ${m.html}`, /evil|visit/i);
  });

  it("الكود نفسه مش متخزن، بيتخزن الـ hash بتاعه بس", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const row = pending(email);
    assert.notEqual(row.code_hash, mail.lastCode(email));
    assert.equal(row.code_hash.length, 64);
  });

  it("لو الإيميل مااتبعتش، الحساب بيتلغي والبريد يقدر يسجّل تاني (502 مش 409)", async () => {
    const body = { full_name: "x", email: "bounce1@t.com", password: "password123" };
    const first = await app.call("POST", "/auth/register", { body });
    const second = await app.call("POST", "/auth/register", { body });
    assert.equal(first.status, 502);
    assert.equal(second.status, 502);
    assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM students WHERE email = 'bounce1@t.com'`).get().n, 0);
  });
});

describe("الدخول قبل التأكيد", () => {
  it("كلمة المرور الصح بترجّع needs_verification من غير توكن، ومابتبعتش كود تاني لو القديم لسه صالح", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const r = await app.call("POST", "/auth/login", { body: { email, password: "password123" } });
    assert.equal(r.status, 403);
    assert.equal(r.data.needs_verification, true);
    assert.equal(r.data.token, undefined);
    await new Promise(res => setTimeout(res, 200));
    assert.equal(mail.to(email).length, 1);
  });

  it("كلمة المرور الغلط مابتقولش أي حاجة عن التأكيد", async () => {
    const { email } = await register();
    const r = await app.call("POST", "/auth/login", { body: { email, password: "wrong-pass" } });
    assert.equal(r.status, 401);
    assert.equal(r.data.needs_verification, undefined);
  });

  it("لو الكود انتهى، الدخول بيبعت كود جديد", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    app.db.prepare(`UPDATE email_verifications SET expires_at = 1, sent_at = sent_at - 61000 WHERE student_id = (SELECT id FROM students WHERE email = ?)`).run(email);
    await app.call("POST", "/auth/login", { body: { email, password: "password123" } });
    await mail.waitFor(email, 2);
  });
});

describe("كتابة الكود", () => {
  it("كود غلط بيقول فاضل كام محاولة، والصح بيدخّل على طول", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const code = mail.lastCode(email);
    const bad = await verify(email, wrongCode(code));
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /فاضل 4/);
    const ok = await verify(email, code);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.role, "student");
    assert.equal((await app.call("GET", "/curriculum", { token: ok.data.token })).status, 200);
    assert.equal((await app.call("POST", "/auth/login", { body: { email, password: "password123" } })).status, 200);
  });

  it("الكود بمسافات أو شرط بيتقبل", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const c = mail.lastCode(email);
    assert.equal((await verify(email, `${c.slice(0, 3)} ${c.slice(3)}`)).status, 200);
  });

  it("بعد 5 محاولات غلط الكود بيتقفل حتى لو كتب الصح", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const code = mail.lastCode(email);
    let last;
    for (let i = 0; i < 5; i++) last = await verify(email, wrongCode(code));
    assert.match(last.data.error, /محاولات غلط كتير/);
    assert.match((await verify(email, code)).data.error, /محاولات غلط كتير/);
  });

  it("كود منتهي بيطلب كود جديد", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    app.db.prepare(`UPDATE email_verifications SET expires_at = 1 WHERE student_id = (SELECT id FROM students WHERE email = ?)`).run(email);
    assert.match((await verify(email, mail.lastCode(email))).data.error, /انتهى/);
  });

  it("البريد المتأكد بالفعل مايتأكدش تاني", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    await verify(email, mail.lastCode(email));
    assert.match((await verify(email, mail.lastCode(email))).data.error, /متأكد بالفعل/);
  });

  it("بريد مش مسجّل أو كود مش 6 أرقام (400)", async () => {
    assert.equal((await verify("nobody@t.com", "123456")).status, 400);
    assert.equal((await verify("nobody@t.com", "12")).status, 400);
  });
});

describe("إعادة إرسال الكود", () => {
  it("لازم دقيقة بين كل كود والتاني، والكود الجديد بيلغي القديم", async () => {
    const { email } = await register();
    await mail.waitFor(email);
    const old = mail.lastCode(email);
    const early = await app.call("POST", "/auth/resend-code", { body: { email } });
    assert.equal(early.status, 429);
    assert.ok(early.data.wait > 0 && early.data.wait <= 60);
    app.db.prepare(`UPDATE email_verifications SET sent_at = sent_at - 61000 WHERE student_id = (SELECT id FROM students WHERE email = ?)`).run(email);
    assert.equal((await app.call("POST", "/auth/resend-code", { body: { email } })).status, 200);
    await mail.waitFor(email, 2);
    const fresh = mail.lastCode(email);
    if (fresh !== old) assert.equal((await verify(email, old)).status, 400, "القديم مابقاش شغال");
    assert.equal((await verify(email, fresh)).status, 200);
  });

  it("بريد مش مسجّل أو متأكد بالفعل: رد عادي من غير ما يبعت حاجة", async () => {
    const before = mail.messages.length;
    assert.equal((await app.call("POST", "/auth/resend-code", { body: { email: "ghost@t.com" } })).status, 200);
    assert.equal((await app.call("POST", "/auth/resend-code", { body: { email: "ahmed@rasokh.test" } })).status, 200);
    await new Promise(res => setTimeout(res, 200));
    assert.equal(mail.messages.length, before);
  });
});

describe("لوحة المشرف", () => {
  it("بتبيّن مين بريده مش متأكد", async () => {
    const { email } = await register();
    const admin = await app.adminToken();
    const list = (await app.call("GET", "/admin/students", { token: admin })).data;
    assert.equal(list.find(s => s.email === email).email_verified, 0);
    assert.equal(list.find(s => s.email === "ahmed@rasokh.test").email_verified, 1);
  });
});
