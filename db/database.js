// db/database.js
// الاتصال بقاعدة بيانات SQLite وتهيئتها باستخدام node:sqlite المدمج مع Node.js
// (يتطلب Node.js >= 22.5.0). هذا يغنينا عن تثبيت حزمة native تحتاج بيئة بناء.

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

// عشان السكريبتات (seed / ensure-seed / create-admin) تقرا .env زي السيرفر بالظبط (DB_PATH و ADMIN_* مثلاً)
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "rasokh.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

// تنفيذ ملف المخطط عند أول تشغيل (CREATE TABLE IF NOT EXISTS، آمن للتكرار)
const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
db.exec(schemaSql);

// ترقيات لقواعد البيانات القديمة: إضافة أعمدة جديدة من غير ما نمسح أي بيانات
// بيرجّع true لو العمود اتضاف دلوقتي
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (cols.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
addColumnIfMissing("series", "url", "TEXT");
addColumnIfMissing("books", "order_index", "INTEGER NOT NULL DEFAULT 0");
// الطلاب اللي سجّلوا قبل تأكيد البريد بيتعتبروا متأكدين، عشان محدش منهم يتقفل برّه
if (addColumnIfMissing("students", "email_verified", "INTEGER NOT NULL DEFAULT 0")) {
  db.exec(`UPDATE students SET email_verified = 1`);
}

// أنواع الأسئلة: الأسئلة القديمة كلها اختيار من متعدد بدرجة واحدة
addColumnIfMissing("questions", "type", "TEXT NOT NULL DEFAULT 'mcq'");
addColumnIfMissing("questions", "points", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("questions", "answer_key", "TEXT");
addColumnIfMissing("student_test_attempts", "status", "TEXT NOT NULL DEFAULT 'graded'");

db.DB_PATH = DB_PATH;
module.exports = db;
