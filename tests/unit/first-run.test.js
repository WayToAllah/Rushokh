// أول تشغيل وقاعدة البيانات: ensure-seed، seed، وترقية قاعدة بيانات قديمة
// كل حالة بتشتغل في process منفصل بقاعدة بيانات مؤقتة
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..", "..");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasokh-first-run-"));
  return { file: path.join(dir, "test.db"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function run(args, dbFile, env = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DB_PATH: dbFile, JWT_SECRET: "x".repeat(40), ADMIN_EMAIL: "", ADMIN_PASSWORD: "",
      SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", NODE_NO_WARNINGS: "1",
      ...env,
    },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const open = file => new DatabaseSync(file, { readOnly: true });

describe("أول تشغيل تلقائي (ensure-seed)", () => {
  it("قاعدة فاضية: كلمة مرور مشرف عشوائية بتظهر مرة، ومن غير admin123 ولا طالب تجريبي", () => {
    const { file, cleanup } = tempDb();
    try {
      const { code, out } = run(["db/ensure-seed.js"], file);
      assert.equal(code, 0, out);
      const printed = (out.match(/كلمة المرور:\s+(\S+)/) || [])[1];
      assert.ok(printed && printed.length >= 12, out);
      const db = open(file);
      const admin = db.prepare(`SELECT * FROM admins`).get();
      assert.equal(admin.email, "admin@rasokh.test");
      assert.ok(bcrypt.compareSync(printed, admin.password_hash));
      assert.ok(!bcrypt.compareSync("admin123", admin.password_hash));
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM students`).get().n, 0);
      assert.ok(db.prepare(`SELECT COUNT(*) n FROM stages`).get().n > 0);
      db.close();
    } finally { cleanup(); }
  });

  it("بياخد ADMIN_EMAIL و ADMIN_PASSWORD لو موجودين ومابيطبعش كلمة المرور", () => {
    const { file, cleanup } = tempDb();
    try {
      const { out } = run(["db/ensure-seed.js"], file, { ADMIN_EMAIL: "Owner@Example.com", ADMIN_PASSWORD: "my-strong-pass" });
      assert.doesNotMatch(out, /my-strong-pass/);
      const db = open(file);
      const admin = db.prepare(`SELECT * FROM admins`).get();
      assert.equal(admin.email, "owner@example.com");
      assert.ok(bcrypt.compareSync("my-strong-pass", admin.password_hash));
      db.close();
    } finally { cleanup(); }
  });

  it("قاعدة فيها بيانات: مابيلمسش حاجة", () => {
    const { file, cleanup } = tempDb();
    try {
      run(["db/ensure-seed.js"], file);
      const hashNow = () => { const db = open(file); const h = db.prepare(`SELECT password_hash FROM admins`).get().password_hash; db.close(); return h; };
      const before = hashNow();
      const { out } = run(["db/ensure-seed.js"], file);
      assert.match(out, /فيها بيانات بالفعل/);
      assert.equal(hashNow(), before);
    } finally { cleanup(); }
  });
});

describe("npm run seed", () => {
  it("بيرفض يمسح قاعدة فيها بيانات من غير --force", () => {
    const { file, cleanup } = tempDb();
    try {
      assert.equal(run(["db/seed.js"], file).code, 0);
      const second = run(["db/seed.js"], file);
      assert.equal(second.code, 1);
      assert.match(second.out, /--force/);
    } finally { cleanup(); }
  });
});

describe("ترقية قاعدة بيانات قديمة", () => {
  it("الطلاب اللي كانوا موجودين قبل تأكيد البريد بيتعتبروا متأكدين", () => {
    const { file, cleanup } = tempDb();
    try {
      // جدول الطلاب بالشكل القديم (من غير email_verified)
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, age INTEGER,
        address TEXT, password_hash TEXT NOT NULL, current_stage_id INTEGER, is_blocked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      old.exec(`INSERT INTO students (full_name, email, password_hash) VALUES ('a', 'a@t.com', 'x'), ('b', 'b@t.com', 'y')`);
      old.close();
      const { code, out } = run(["-e", "require('./db/database')"], file);
      assert.equal(code, 0, out);
      const db = open(file);
      assert.deepEqual(db.prepare(`SELECT email_verified FROM students ORDER BY id`).all().map(r => r.email_verified), [1, 1]);
      db.close();
    } finally { cleanup(); }
  });
});
