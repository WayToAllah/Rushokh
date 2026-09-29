// scripts/create-admin.js
// إنشاء حساب مشرف حقيقي من سطر الأوامر، واختياريًا حذف المشرف التجريبي.
// التشغيل:  npm run create-admin

const readline = require("readline");
const bcrypt = require("bcryptjs");
const db = require("../db/database");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
// بيقرأ سطر واحد بعد السؤال (بيشتغل سواء بتكتب بإيدك أو بتبعت الإجابات جاهزة)
async function ask(q) {
  process.stdout.write(q);
  const { value, done } = await lines.next();
  return done ? "" : String(value).trim();
}

(async () => {
  console.log("\n=== إنشاء حساب مشرف ===\n");
  const full_name = await ask("الاسم: ");
  const email = (await ask("البريد الإلكتروني: ")).toLowerCase();
  const password = await ask("كلمة المرور (8 أحرف على الأقل): ");

  if (!full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log("❌ الاسم وبريد إلكتروني صحيح مطلوبان.");
    return rl.close();
  }
  if (password.length < 8) {
    console.log("❌ كلمة المرور لازم تكون 8 أحرف على الأقل.");
    return rl.close();
  }

  const existing = db.prepare(`SELECT id FROM admins WHERE lower(email) = ?`).get(email);
  const hash = bcrypt.hashSync(password, 10);
  if (existing) {
    db.prepare(`UPDATE admins SET full_name = ?, password_hash = ? WHERE id = ?`).run(full_name, hash, existing.id);
    console.log("✅ المشرف موجود بالفعل، تم تحديث اسمه وكلمة المرور.");
  } else {
    db.prepare(`INSERT INTO admins (full_name, email, password_hash) VALUES (?, ?, ?)`).run(full_name, email, hash);
    console.log("✅ تم إنشاء حساب المشرف.");
  }

  const demo = db.prepare(`SELECT id FROM admins WHERE email = 'admin@rasokh.test'`).get();
  if (demo && email !== "admin@rasokh.test") {
    const ans = await ask("\nيوجد حساب المشرف التجريبي admin@rasokh.test. احذفه؟ (y/n): ");
    if (ans.toLowerCase().startsWith("y")) {
      db.prepare(`DELETE FROM admins WHERE id = ?`).run(demo.id);
      console.log("🗑  تم حذف المشرف التجريبي.");
    }
  }
  rl.close();
})();
