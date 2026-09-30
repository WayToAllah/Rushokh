// الأمان العام: الترويسات، الطلبات الغلط، وإن كلمات المرور عمرها ما بتطلع في أي رد
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../helpers/app");

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

describe("ترويسات الأمان", () => {
  it("موجودة على الصفحات وعلى الـ API، ومن غير X-Powered-By", async () => {
    for (const url of ["/", "/index.html", "/api/health"]) {
      const res = await fetch(app.base + url);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", url);
      assert.equal(res.headers.get("x-frame-options"), "DENY", url);
      assert.ok(res.headers.get("referrer-policy"), url);
      assert.equal(res.headers.get("x-powered-by"), null, url);
    }
  });
});

describe("سياسة المحتوى وHTTPS", () => {
  it("CSP موجودة: سكريبتات وطلبات من الموقع بس، والموقع مايتفتحش جوه موقع تاني", async () => {
    const csp = (await fetch(app.base + "/")).headers.get("content-security-policy");
    assert.ok(csp, "مفيش CSP");
    for (const part of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
      assert.ok(csp.includes(part), `ناقص: ${part}`);
    }
    assert.match(csp, /font-src[^;]*fonts\.gstatic\.com/);
    assert.match(csp, /frame-src[^;]*https:/, "الفيديوهات المتضمّنة لازم تشتغل");
  });

  it("Permissions-Policy بيقفل الكاميرا والمايك والموقع الجغرافي", async () => {
    const pp = (await fetch(app.base + "/")).headers.get("permissions-policy");
    for (const f of ["camera=()", "microphone=()", "geolocation=()"]) assert.ok(pp.includes(f), f);
  });

  it("HSTS بيتبعت بس لما الزيارة HTTPS (عشان localhost يفضل شغّال)", async () => {
    const plain = await fetch(app.base + "/");
    assert.equal(plain.headers.get("strict-transport-security"), null);
    const viaHttps = await fetch(app.base + "/", { headers: { "x-forwarded-proto": "https" } });
    assert.match(viaHttps.headers.get("strict-transport-security"), /max-age=\d{7,}/);
  });
});

describe("التحويل على الدومين", () => {
  const http = require("http");
  const req = (method, path, headers) => new Promise((resolve, reject) => {
    const r = http.request(app.base + path, { method, headers }, res => { res.resume(); res.on("end", () => resolve(res)); });
    r.on("error", reject);
    r.end();
  });

  it("www بيتحوّل للدومين من غير www، بنفس الصفحة والـ query", async () => {
    const res = await req("GET", "/student.html?x=1", { host: "www.rusuokh.com", "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "https" });
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.location, "https://rusuokh.com/student.html?x=1");
  });

  it("زيارة http عن طريق Cloudflare بتتحوّل لـ https، والطلب اللي فيه بيانات بـ 308", async () => {
    const get = await req("GET", "/", { host: "rusuokh.com", "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "http" });
    assert.equal(get.statusCode, 301);
    assert.equal(get.headers.location, "https://rusuokh.com/");
    const post = await req("POST", "/api/auth/login", { host: "rusuokh.com", "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "http" });
    assert.equal(post.statusCode, 308);
  });

  it("زيارة https عن طريق Cloudflare، وlocalhost، مابيتحوّلوش", async () => {
    const https = await req("GET", "/", { host: "rusuokh.com", "cf-connecting-ip": "1.2.3.4", "x-forwarded-proto": "https" });
    assert.equal(https.statusCode, 200);
    const local = await req("GET", "/", {});
    assert.equal(local.statusCode, 200);
    const lan = await req("GET", "/", { "x-forwarded-proto": "http" });
    assert.equal(lan.statusCode, 200, "من غير Cloudflare مفيش تحويل");
  });
});

describe("ضغط الردود", () => {
  // بنستخدم http مباشرة عشان fetch بيفك الضغط لوحده ومش بيوضّح الحجم الحقيقي
  const http = require("http");
  const rawGet = (path, headers = {}) => new Promise((resolve, reject) => {
    http.get(app.base + path, { headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, size: Buffer.concat(chunks).length }));
    }).on("error", reject);
  });

  it("الصفحات والـ API الكبيرة بتتبعت مضغوطة وحجمها بيقل كتير", async () => {
    const plain = await rawGet("/student.html");
    const gz = await rawGet("/student.html", { "Accept-Encoding": "gzip" });
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.ok(gz.size < plain.size / 3, `${gz.size} مش أصغر كفاية من ${plain.size}`);

    const token = await app.adminToken();
    const tree = await rawGet("/api/admin/content/tree", { "Accept-Encoding": "gzip", Authorization: "Bearer " + token, "cf-connecting-ip": "10.3.3.3" });
    assert.equal(tree.status, 200);
    assert.equal(tree.headers["content-encoding"], "gzip");
  });

  it("المتصفح اللي مابيدعمش الضغط بياخد الرد عادي", async () => {
    const r = await rawGet("/student.html", { "Accept-Encoding": "identity" });
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.status, 200);
  });
});

describe("صفحة 404", () => {
  it("أي رابط مش موجود بيرجّع صفحة عربي بتصميم الموقع وفيها رابط للرئيسية", async () => {
    for (const path of ["/nope", "/some/deep/path.html", "/admin"]) {
      const res = await fetch(app.base + path);
      assert.equal(res.status, 404, path);
      assert.match(res.headers.get("content-type"), /text\/html/);
      const html = await res.text();
      assert.match(html, /الصفحة دي مش موجودة/);
      assert.match(html, /href="\/"/);
      assert.doesNotMatch(html, /Cannot GET/);
    }
  });

  it("مسارات الـ API المش موجودة لسه بترجّع JSON", async () => {
    const r = await app.call("GET", "/nothing");
    assert.equal(r.status, 404);
    assert.equal(typeof r.data, "object");
  });
});

describe("طلبات غلط", () => {
  it("مسار API مش موجود بيرجّع 404 بالعربي", async () => {
    const r = await app.call("GET", "/nothing-here");
    assert.equal(r.status, 404);
    assert.match(r.data.error, /غير موجود/);
  });

  it("JSON مكسور (400)", async () => {
    const r = await app.call("POST", "/auth/login", { body: "{bad json", headers: { "Content-Type": "application/json" } });
    assert.equal(r.status, 400);
  });

  it("بيانات أكبر من 100KB بترجع 413 مش خطأ سيرفر", async () => {
    const r = await app.call("POST", "/auth/register", { body: { full_name: "x".repeat(150 * 1024), email: "big@t.com", password: "password123" } });
    assert.equal(r.status, 413);
  });

  it("محاولة SQL injection في الدخول مابتعديش", async () => {
    const r = await app.call("POST", "/auth/login", { body: { email: "' OR 1=1 --", password: "' OR '1'='1" } });
    assert.equal(r.status, 401);
  });

  it("الاسم اللي فيه كود بيتحفظ كنص عادي (الصفحات هي اللي بتعرضه آمن)", async () => {
    const s = await app.newStudent({ full_name: "<img src=x onerror=alert(1)>" });
    assert.equal(app.db.prepare(`SELECT full_name FROM students WHERE id = ?`).get(s.id).full_name, "<img src=x onerror=alert(1)>");
  });
});

describe("كلمات المرور مابتطلعش في أي رد", () => {
  it("ولا في ردود الطالب ولا المشرف", async () => {
    const admin = await app.adminToken();
    const s = await app.newStudent();
    const leak = /password_hash|\$2[aby]\$\d\d\$/;
    for (const [token, path] of [
      [s.token, "/curriculum"], [s.token, "/progress/me/report"], [s.token, `/progress/certificate/${app.stages()[0].id}`],
      [admin, "/admin/students"], [admin, `/admin/students/${s.id}/report`], [admin, "/admin/account/admins"],
      [admin, "/admin/account/me"], [admin, "/admin/content/tree"], [admin, "/admin/tests"],
    ]) {
      const r = await app.call("GET", path, { token });
      assert.equal(r.status, 200, path);
      assert.doesNotMatch(JSON.stringify(r.data), leak, path);
    }
  });

  it("ولا في رد الدخول أو التسجيل", async () => {
    const reg = await app.call("POST", "/auth/register", { body: { full_name: "x", email: "leak@t.com", password: "password123" } });
    const log = await app.call("POST", "/auth/login", { body: { email: "leak@t.com", password: "password123" } });
    assert.doesNotMatch(JSON.stringify(reg.data) + JSON.stringify(log.data), /password/);
  });
});
