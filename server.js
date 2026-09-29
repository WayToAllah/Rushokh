// server.js
require("dotenv").config();
const path = require("path");
const express = require("express");

const { router: authRoutes } = require("./routes/auth");
const curriculumRoutes = require("./routes/curriculum");
const progressRoutes = require("./routes/progress");
const testRoutes = require("./routes/tests");
const adminContentRoutes = require("./routes/admin/content");
const adminTestRoutes = require("./routes/admin/tests");
const adminStudentRoutes = require("./routes/admin/students");
const adminAccountRoutes = require("./routes/admin/account");
const adminReportRoutes = require("./routes/admin/reports");

const app = express();
app.disable("x-powered-by");

// ترويسات أمان أساسية
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "rasokh-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/admin/content", adminContentRoutes);
app.use("/api/admin/tests", adminTestRoutes);
app.use("/api/admin/students", adminStudentRoutes);
app.use("/api/admin/account", adminAccountRoutes);
app.use("/api/admin/reports", adminReportRoutes);

app.use("/api", (req, res) => res.status(404).json({ error: "المسار غير موجود." }));

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "صيغة البيانات المرسلة غير صحيحة." });
  }
  console.error(err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 خادم رسوخ يعمل على http://localhost:${PORT}`);
  require("./lib/backup").startAutoBackup();
});
