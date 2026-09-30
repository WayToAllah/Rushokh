// lib/rate-limit.js: حد المحاولات، وتحديد عنوان الزائر الحقيقي
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { clientIp, createLimiter } = require("../../lib/rate-limit");

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

describe("createLimiter", () => {
  it("بيقفل بعد الحد، وبيرجّع الدقايق الباقية، والـ reset بيفك القفل", () => {
    const l = createLimiter({ windowMs: 60 * 1000, max: 3 });
    for (let i = 0; i < 3; i++) { assert.equal(l.blockedFor("k"), 0); l.hit("k"); }
    assert.equal(l.blockedFor("k"), 1);
    assert.equal(l.blockedFor("other"), 0, "كل مفتاح لوحده");
    l.reset("k");
    assert.equal(l.blockedFor("k"), 0);
  });

  it("القفل بيخلص لما المدة تعدّي", async () => {
    const l = createLimiter({ windowMs: 50, max: 1 });
    l.hit("k");
    assert.ok(l.blockedFor("k") > 0);
    await new Promise(r => setTimeout(r, 70));
    assert.equal(l.blockedFor("k"), 0);
  });
});

describe("clientIp", () => {
  afterEach(() => { delete process.env.TRUST_PROXY; });

  it("cloudflared على نفس الجهاز: بياخد cf-connecting-ip", () => {
    assert.equal(clientIp(req("127.0.0.1", { "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(req("::1", { "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(req("::ffff:127.0.0.1", { "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
  });

  it("زائر من الشبكة بيزوّر الترويسات: بنتجاهلها وناخد عنوانه الحقيقي", () => {
    assert.equal(clientIp(req("192.168.1.50", { "cf-connecting-ip": "1.1.1.1" })), "192.168.1.50");
    assert.equal(clientIp(req("192.168.1.50", { "x-forwarded-for": "1.1.1.1" })), "192.168.1.50");
  });

  it("TRUST_PROXY=1: آخر عنوان في x-forwarded-for (اللي البروكسي ضافه)", () => {
    process.env.TRUST_PROXY = "1";
    assert.equal(clientIp(req("10.0.0.2", { "x-forwarded-for": "1.1.1.1, 198.51.100.7" })), "198.51.100.7");
    assert.equal(clientIp(req("10.0.0.2", {})), "10.0.0.2");
  });
});
