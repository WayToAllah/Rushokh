// server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const db = require("./db/database");

const { router: authRoutes } = require("./routes/auth");
const curriculumRoutes = require("./routes/curriculum");
const progressRoutes = require("./routes/progress");
const testRoutes = require("./routes/tests");
const accountRoutes = require("./routes/account");
const adminContentRoutes = require("./routes/admin/content");
const adminTestRoutes = require("./routes/admin/tests");
const adminStudentRoutes = require("./routes/admin/students");
const adminAccountRoutes = require("./routes/admin/account");
const adminReportRoutes = require("./routes/admin/reports");

const app = express();
app.disable("x-powered-by");

// على الدومين: www.rusuokh.com بيتحوّل لـ rusuokh.com (عشان الدخول يبقى على عنوان واحد)، وhttp بيتحوّل لـ https.
// http بيتعرف من x-forwarded-proto اللي Cloudflare بيبعته، فـ localhost والشبكة الداخلية مش بيتأثروا.
app.use((req, res, next) => {
  const host = String(req.headers.host || "");
  const insecure = !!req.headers["cf-connecting-ip"] && req.headers["x-forwarded-proto"] === "http";
  const www = /^www\./i.test(host);
  if (!insecure && !www) return next();
  // 308 للطلبات اللي فيها بيانات (POST...) عشان المتصفح يعيدها زي ما هي
  const status = req.method === "GET" || req.method === "HEAD" ? 301 : 308;
  res.redirect(status, `https://${host.replace(/^www\./i, "")}${req.originalUrl}`);
});

// سياسة المحتوى (CSP): المتصفح مايشغّلش ولا يحمّل غير اللي هنا.
// - السكريبتات من الموقع نفسه بس (الصفحات فيها كود جوّاها، فـ 'unsafe-inline' لسه لازم لحد ما يتنقل لملفات)
// - الخطوط من Google Fonts، والطلبات (fetch) للموقع نفسه بس، فأي كود دخيل مايقدرش يبعت بيانات لبرّه
// - الفيديو والكتب المعروضة جوه الموقع (يوتيوب، Drive، PDF، MP3...) من أي رابط https
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "frame-src 'self' https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// ترويسات الأمان
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  // HSTS: المتصفح يفتح الموقع بـ HTTPS دايمًا. بتتبعت بس لما الزيارة نفسها HTTPS
  // (Cloudflare بيبلّغ بـ x-forwarded-proto)، عشان http://localhost يفضل شغّال.
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

// ضغط الردود (gzip): الصفحات وبيانات المنهج بتصغر حوالي 80%، وده فرق كبير على نت الموبايل.
// المكتبة بتتحمّل لو موجودة، عشان الموقع يقوم عادي حتى لو لسه بتتسطّب أثناء التحديث.
try {
  app.use(require("compression")());
} catch (e) {
  console.warn("⚠️  مكتبة الضغط مش متسطّبة لسه، الموقع شغّال من غير ضغط. شغّل npm install وبعدين شغّل الموقع تاني.");
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// فحص الصحة (خدمة المراقبة بتسأله كل كام دقيقة): السيرفر شغّال وقاعدة البيانات بترد
app.get("/api/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, service: "rasokh-backend" });
  } catch (err) {
    console.error("⚠️  فحص الصحة: قاعدة البيانات مش بترد:", err.message);
    res.status(503).json({ ok: false, error: "قاعدة البيانات مش بترد." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/admin/content", adminContentRoutes);
app.use("/api/admin/tests", adminTestRoutes);
app.use("/api/admin/students", adminStudentRoutes);
app.use("/api/admin/account", adminAccountRoutes);
app.use("/api/admin/reports", adminReportRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "المسار غير موجود." }));

// أي رابط تاني مش موجود: صفحة "مش موجودة" بالعربي بتصميم الموقع
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "صيغة البيانات المرسلة غير صحيحة." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "حجم البيانات المرسلة كبير جدًا." });
  }
  // عنصر بيشاور على حاجة مش موجودة (مثلاً حلقة لسلسلة اتحذفت): ده غلط في الطلب مش في السيرفر
  if (/FOREIGN KEY constraint failed/.test(err.message || "")) {
    return res.status(400).json({ error: "العنصر المرتبط غير موجود، ممكن يكون اتحذف. حدّث الصفحة وحاول تاني." });
  }
  console.error(err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
});

// الاختبارات بتستورد app وتشغّله على بورت عشوائي، فالتشغيل الفعلي بس لما الملف ده يتشغّل مباشرة
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🚀 خادم رسوخ يعمل على http://localhost:${PORT}`);
    require("./lib/backup").startAutoBackup();
    require("./lib/mailer").checkOnStartup();
  });
}
