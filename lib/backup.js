// lib/backup.js
// نسخ احتياطي تلقائي لقاعدة البيانات في مجلد backups/ (بيتعمل عند تشغيل السيرفر وكل 12 ساعة).
// بيحتفظ بآخر 30 نسخة. VACUUM INTO بيعمل نسخة سليمة حتى والسيرفر شغّال.

const fs = require("fs");
const path = require("path");
const db = require("../db/database");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const KEEP = 30;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function backupNow() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `rasokh-${stamp()}.db`);
    if (fs.existsSync(file)) return file;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^rasokh-.*\.db$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - KEEP)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    return file;
  } catch (err) {
    console.error("⚠️  تعذّر عمل نسخة احتياطية:", err.message);
    return null;
  }
}

function startAutoBackup() {
  const file = backupNow();
  if (file) console.log(`💾 نسخة احتياطية: backups/${path.basename(file)}`);
  setInterval(backupNow, 12 * 60 * 60 * 1000).unref();
}

module.exports = { backupNow, startAutoBackup, BACKUP_DIR };
