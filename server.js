// server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const curriculumRoutes = require("./routes/curriculum");
const progressRoutes = require("./routes/progress");
const testRoutes = require("./routes/tests");
const adminContentRoutes = require("./routes/admin/content");
const adminTestRoutes = require("./routes/admin/tests");
const adminStudentRoutes = require("./routes/admin/students");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "rasokh-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/admin/content", adminContentRoutes);
app.use("/api/admin/tests", adminTestRoutes);
app.use("/api/admin/students", adminStudentRoutes);

// معالجة الأخطاء العامة
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 خادم رسوخ يعمل على http://localhost:${PORT}`);
});
