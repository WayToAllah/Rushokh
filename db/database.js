// db/database.js
// الاتصال بقاعدة بيانات SQLite وتهيئتها باستخدام node:sqlite المدمج مع Node.js
// (يتطلب Node.js >= 22.5.0). هذا يغنينا عن تثبيت حزمة native تحتاج بيئة بناء.

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "rasokh.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

// تنفيذ ملف المخطط عند أول تشغيل (CREATE TABLE IF NOT EXISTS، آمن للتكرار)
const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schemaSql);

module.exports = db;
