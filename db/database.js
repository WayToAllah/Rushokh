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
addColumnIfMissing("episodes", "summary", "TEXT");
addColumnIfMissing("episodes", "summary_url", "TEXT");
addColumnIfMissing("tests", "episode_id", "INTEGER REFERENCES episodes(id) ON DELETE CASCADE");

// رقم الحلقة = order_index (1، 2، 3...) ومينفعش يتكرر في نفس السلسلة.
// أي سلسلة أرقامها مكررة أو فيها صفر (البيانات القديمة كانت بتبدأ من 0) بتترقّم من 1 بنفس ترتيبها الحالي.
(function renumberEpisodes() {
  const bad = db.prepare(
    `SELECT series_id FROM episodes GROUP BY series_id
     HAVING MIN(order_index) < 1 OR COUNT(DISTINCT order_index) < COUNT(*)`
  ).all();
  if (!bad.length) return;
  const list = db.prepare(`SELECT id FROM episodes WHERE series_id = ? ORDER BY order_index ASC, id ASC`);
  const set = db.prepare(`UPDATE episodes SET order_index = ? WHERE id = ?`);
  db.exec("BEGIN");
  try {
    for (const { series_id } of bad) list.all(series_id).forEach((e, i) => set.run(i + 1, e.id));
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
})();

db.DB_PATH = DB_PATH;
module.exports = db;
