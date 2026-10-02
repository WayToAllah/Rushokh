// routes/admin/tests.js
const express = require("express");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

function text(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function passPercent(v) {
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= 1 && n <= 100 ? n : null;
}

// الخيارات: خياران على الأقل، كل خيار له نص، وإجابة صحيحة واحدة بالظبط
function cleanOptions(options) {
  if (!Array.isArray(options)) return { error: "الخيارات مطلوبة." };
  const list = options
    .map(o => ({ text: text(o && o.text, 300), is_correct: !!(o && o.is_correct) }))
    .filter(o => o.text);
  if (list.length < 2) return { error: "لازم خياران على الأقل ليهم نص." };
  const correct = list.filter(o => o.is_correct).length;
  if (correct !== 1) return { error: "لازم تحدد إجابة صحيحة واحدة بالظبط." };
  return { list };
}

const quiz = require("../../lib/quiz");
const sp = require("../../lib/stage-progress");

// بيجهّز بيانات السؤال حسب نوعه. بيرجّع { error } أو { type, points, answer_key, options }
// - mcq: options [{text, is_correct}] — خياران على الأقل وواحد بس صح
// - true_false: correct: true | false (الخيارات "صح" و"خطأ" بتتعمل لوحدها)
// - fill: accepted_answers ["...", ...] — إجابة مقبولة واحدة على الأقل
// - essay: model_answer (اختياري) إجابة نموذجية تساعد المصحح
function cleanQuestion(body, current) {
  const type = body.type !== undefined ? String(body.type) : (current ? current.type : "mcq");
  if (!quiz.TYPES.includes(type)) return { error: "نوع السؤال غير معروف." };

  let points = body.points !== undefined ? parseInt(body.points, 10) : (current ? current.points : 1);
  if (!Number.isInteger(points) || points < 1 || points > 100) return { error: "درجة السؤال لازم تكون رقم من 1 لـ 100." };

  const out = { type, points, answer_key: null, options: null };
  const typeChanged = current && current.type !== type;

  if (type === "mcq") {
    if (body.options !== undefined || !current || typeChanged) {
      const opts = cleanOptions(body.options);
      if (opts.error) return opts;
      out.options = opts.list;
    }
  } else if (type === "true_false") {
    if (body.correct !== undefined || !current || typeChanged) {
      if (typeof body.correct !== "boolean") return { error: "حدد الإجابة الصحيحة: صح ولا خطأ." };
      out.options = [{ text: "صح", is_correct: body.correct }, { text: "خطأ", is_correct: !body.correct }];
    }
  } else if (type === "fill") {
    const list = body.accepted_answers !== undefined ? body.accepted_answers
      : (current && !typeChanged ? quiz.parseAccepted(current.answer_key) : undefined);
    const clean = (Array.isArray(list) ? list : [])
      .map(x => text(x, 300)).filter(Boolean)
      .filter((x, i, arr) => arr.findIndex(y => quiz.normalizeArabic(y) === quiz.normalizeArabic(x)) === i)
      .slice(0, 20);
    if (!clean.length) return { error: "اكتب إجابة مقبولة واحدة على الأقل." };
    out.answer_key = JSON.stringify(clean);
    out.options = [];
  } else if (type === "essay") {
    out.answer_key = body.model_answer !== undefined ? text(body.model_answer, 3000)
      : (current && !typeChanged ? current.answer_key : null);
    out.options = [];
  }
  return out;
}

// السؤال زي ما المشرف بيشوفه
function adminQuestion(q) {
  const out = { ...q, options: db.prepare(`SELECT * FROM options WHERE question_id = ? ORDER BY id ASC`).all(q.id) };
  if (q.type === "fill") out.accepted_answers = quiz.parseAccepted(q.answer_key);
  if (q.type === "essay") out.model_answer = q.answer_key || "";
  return out;
}

// ---------- عرض كل الاختبارات مع أسئلتها ----------
router.get("/", (req, res) => {
  const tests = db.prepare(
    `SELECT t.*, s.name AS series_name, e.title AS episode_title
     FROM tests t JOIN series s ON s.id = t.series_id LEFT JOIN episodes e ON e.id = t.episode_id
     ORDER BY t.id ASC`
  ).all();
  const withQuestions = tests.map(t => ({
    ...t,
    questions: db.prepare(`SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC`).all(t.id)
      .map(adminQuestion)
  }));
  res.json(withQuestions);
});

// الحلقة لازم تكون من نفس السلسلة. فاضي = اختبار على السلسلة كلها
function episodeFor(seriesId, episodeId) {
  if (episodeId === undefined || episodeId === null || episodeId === "") return { value: null };
  const ep = db.prepare(`SELECT id, series_id FROM episodes WHERE id = ?`).get(Number(episodeId));
  if (!ep || ep.series_id !== Number(seriesId)) return { error: "الحلقة دي مش من نفس السلسلة." };
  return { value: ep.id };
}

// ---------- إنشاء اختبار جديد لسلسلة أو لحلقة منها ----------
// body: { series_id, title, pass_percent?, episode_id? }
router.post("/", (req, res) => {
  const { series_id } = req.body;
  const title = text(req.body.title, 200);
  if (!series_id || !title) {
    return res.status(400).json({ error: "السلسلة وعنوان الاختبار مطلوبان." });
  }
  const ep = episodeFor(series_id, req.body.episode_id);
  if (ep.error) return res.status(400).json({ error: ep.error });
  const info = db.prepare(
    `INSERT INTO tests (series_id, title, pass_percent, episode_id) VALUES (?, ?, ?, ?)`
  ).run(series_id, title, passPercent(req.body.pass_percent) || 60, ep.value);
  res.status(201).json({ id: Number(info.lastInsertRowid), title });
});

// ---------- تعديل عنوان الاختبار أو نسبة النجاح ----------
router.patch("/:id", (req, res) => {
  const test = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(req.params.id);
  if (!test) return res.status(404).json({ error: "الاختبار غير موجود." });
  const title = "title" in req.body ? text(req.body.title, 200) : test.title;
  const pass = "pass_percent" in req.body ? passPercent(req.body.pass_percent) : test.pass_percent;
  if (!title) return res.status(400).json({ error: "عنوان الاختبار مطلوب." });
  if (!pass) return res.status(400).json({ error: "نسبة النجاح لازم تكون رقم من 1 لـ 100." });
  const ep = "episode_id" in req.body ? episodeFor(test.series_id, req.body.episode_id) : { value: test.episode_id };
  if (ep.error) return res.status(400).json({ error: ep.error });
  db.prepare(`UPDATE tests SET title = ?, pass_percent = ?, episode_id = ? WHERE id = ?`).run(title, pass, ep.value, test.id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare(`DELETE FROM tests WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- إضافة سؤال (أي نوع) ----------
// body: { test_id, text, type, points, options | correct | accepted_answers | model_answer }
router.post("/questions", (req, res) => {
  const { test_id } = req.body;
  const qText = text(req.body.text, 1000);
  if (!test_id || !qText) return res.status(400).json({ error: "الاختبار ونص السؤال مطلوبان." });
  const q = cleanQuestion(req.body, null);
  if (q.error) return res.status(400).json({ error: q.error });

  const order = db.prepare(`SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM questions WHERE test_id = ?`).get(test_id).n;
  db.exec("BEGIN");
  try {
    const questionId = Number(db.prepare(
      `INSERT INTO questions (test_id, text, type, points, answer_key, order_index) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(test_id, qText, q.type, q.points, q.answer_key, order).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`);
    q.options.forEach(o => ins.run(questionId, o.text, o.is_correct ? 1 : 0));
    db.exec("COMMIT");
    res.status(201).json({ id: questionId });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
});

// ---------- تعديل سؤال: النص والنوع والدرجة والإجابات ----------
// الحقول اللي ما اتبعتتش بتفضل زي ما هي. لو النوع اتغيّر لازم تبعت إجابات النوع الجديد.
router.patch("/questions/:id", (req, res) => {
  const current = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(req.params.id);
  if (!current) return res.status(404).json({ error: "السؤال غير موجود." });
  const qText = "text" in req.body ? text(req.body.text, 1000) : current.text;
  if (!qText) return res.status(400).json({ error: "نص السؤال مطلوب." });
  const q = cleanQuestion(req.body, current);
  if (q.error) return res.status(400).json({ error: q.error });

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE questions SET text = ?, type = ?, points = ?, answer_key = ? WHERE id = ?`)
      .run(qText, q.type, q.points, q.answer_key, current.id);
    if (q.options) {
      db.prepare(`DELETE FROM options WHERE question_id = ?`).run(current.id);
      const ins = db.prepare(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`);
      q.options.forEach(o => ins.run(current.id, o.text, o.is_correct ? 1 : 0));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  res.json({ ok: true });
});

// ---------- التصحيح: المحاولات اللي فيها مقالي مستني درجة ----------
router.get("/reviews", (req, res) => {
  const attempts = db.prepare(
    `SELECT a.id, a.attempted_at, a.score, st.id AS student_id, st.full_name, st.email,
            t.id AS test_id, t.title AS test_title, t.pass_percent, se.name AS series_name
     FROM student_test_attempts a
     JOIN students st ON st.id = a.student_id
     JOIN tests t ON t.id = a.test_id
     JOIN series se ON se.id = t.series_id
     WHERE a.status = 'pending'
     ORDER BY a.attempted_at ASC, a.id ASC`
  ).all();
  const result = attempts.map(a => ({
    ...a,
    essays: db.prepare(
      `SELECT ans.id AS answer_id, q.text AS question, q.answer_key AS model_answer,
              ans.answer_text, ans.max_points, ans.points_awarded, ans.feedback
       FROM student_answers ans JOIN questions q ON q.id = ans.question_id
       WHERE ans.attempt_id = ? AND q.type = 'essay' AND ans.answer_text IS NOT NULL
       ORDER BY q.order_index ASC, q.id ASC`
    ).all(a.id),
    // درجة باقي الأسئلة اللي اتصححت لوحدها
    auto: db.prepare(
      `SELECT COALESCE(SUM(points_awarded), 0) AS earned, COALESCE(SUM(max_points), 0) AS total
       FROM student_answers WHERE attempt_id = ?`
    ).get(a.id),
  }));
  res.json(result);
});

// body: { grades: [{ answer_id, points, feedback }] }
router.post("/reviews/:attemptId", (req, res) => {
  const r = quiz.gradeEssays(Number(req.params.attemptId), req.body.grades);
  if (r.error) return res.status(r.status).json({ error: r.error });
  const advancedTo = sp.advanceIfComplete(r.attempt.student_id);
  res.json({ ok: true, score: r.attempt.score, passed: r.attempt.passed, advanced_to: advancedTo });
});

router.delete("/questions/:id", (req, res) => {
  db.prepare(`DELETE FROM questions WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
