// routes/account.js
// حساب الطالب: تغيير كلمة المرور.
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/database");
const { requireAuth, requireRole } = require("../middleware/auth");
const { MIN_PASSWORD } = require("./auth");

const router = express.Router();
router.use(requireAuth, requireRole("student"));

router.post("/password", (req, res) => {
  const { current_password, new_password } = req.body;
  const me = db.prepare(`SELECT id, password_hash FROM students WHERE id = ?`).get(req.user.id);
  if (!me || typeof current_password !== "string" || !bcrypt.compareSync(current_password, me.password_hash)) {
    return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة." });
  }
  if (typeof new_password !== "string" || new_password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD} أحرف على الأقل.` });
  }
  db.prepare(`UPDATE students SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(new_password, 10), me.id);
  res.json({ ok: true });
});

module.exports = router;
