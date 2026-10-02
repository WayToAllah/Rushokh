// lib/quiz.js
// أنواع الأسئلة والتصحيح.
//   mcq        اختيار من متعدد: خيارات وواحد بس صح
//   true_false صح وغلط: خياران ثابتين "صح" و"خطأ" وواحد بس صح
//   fill       أكمل: الطالب بيكتب، والإجابة بتتقارن بقائمة إجابات مقبولة بعد توحيد الكتابة العربية
//   essay      مقالي: المشرف بيصححه ويدّي درجة، ولحد ما يصححه المحاولة "قيد التصحيح"

const db = require("../db/database");

const TYPES = ["mcq", "true_false", "fill", "essay"];
const TYPE_LABELS = { mcq: "اختيار من متعدد", true_false: "صح وغلط", fill: "أكمل", essay: "مقالي" };
const MAX_ANSWER = 5000;

// توحيد الكتابة العربية للمقارنة: من غير تشكيل ولا تطويل، والهمزات والألف المقصورة والتاء المربوطة واحدة،
// ومن غير علامات ترقيم في الأول والآخر، والمسافات المتكررة مسافة واحدة.
function normalizeArabic(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // التشكيل وعلامات القرآن
    .replace(/ـ/g, "")                             // التطويل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/^[\s.,،؛;:!?؟"'«»()\-]+|[\s.,،؛;:!?؟"'«»()\-]+$/g, "")
    .trim();
}

function parseAccepted(answerKey) {
  try {
    const list = JSON.parse(answerKey || "[]");
    return Array.isArray(list) ? list.filter(x => typeof x === "string" && x.trim()) : [];
  } catch (e) {
    return [];
  }
}

function questionsOf(testId) {
  return db.prepare(
    `SELECT id, text, type, points, answer_key FROM questions WHERE test_id = ? ORDER BY order_index ASC, id ASC`
  ).all(testId);
}

// الأسئلة زي ما الطالب بيشوفها: من غير أي إجابة صحيحة
function questionsForStudent(testId) {
  return questionsOf(testId).map(q => {
    const out = { id: q.id, text: q.text, type: q.type, points: q.points };
    if (q.type === "mcq" || q.type === "true_false") {
      out.options = db.prepare(`SELECT id, text FROM options WHERE question_id = ? ORDER BY id ASC`).all(q.id);
    }
    return out;
  });
}

// تصحيح محاولة: بيرجّع إجابات جاهزة للحفظ + الدرجات
function gradeAnswers(testId, submitted) {
  const byQuestion = new Map();
  (Array.isArray(submitted) ? submitted : []).forEach(a => {
    if (a && a.question_id !== undefined) byQuestion.set(Number(a.question_id), a);
  });

  const rows = [];
  let earned = 0, total = 0, correctCount = 0, pendingCount = 0;

  for (const q of questionsOf(testId)) {
    const a = byQuestion.get(q.id) || {};
    const max = Math.max(1, q.points || 1);
    total += max;
    const row = { question_id: q.id, option_id: null, answer_text: null, is_correct: 0, points_awarded: 0, max_points: max };

    if (q.type === "mcq" || q.type === "true_false") {
      const optionId = Number(a.option_id) || null;
      const correct = db.prepare(`SELECT id FROM options WHERE question_id = ? AND is_correct = 1`).get(q.id);
      const valid = optionId && db.prepare(`SELECT 1 FROM options WHERE id = ? AND question_id = ?`).get(optionId, q.id);
      row.option_id = valid ? optionId : null;
      row.is_correct = correct && valid && optionId === correct.id ? 1 : 0;
    } else if (q.type === "fill") {
      const text = typeof a.text === "string" ? a.text.trim().slice(0, 500) : "";
      row.answer_text = text || null;
      const given = normalizeArabic(text);
      row.is_correct = given && parseAccepted(q.answer_key).some(x => normalizeArabic(x) === given) ? 1 : 0;
    } else if (q.type === "essay") {
      const text = typeof a.text === "string" ? a.text.trim().slice(0, MAX_ANSWER) : "";
      row.answer_text = text || null;
      if (text) {
        row.is_correct = null;       // مستني المشرف
        row.points_awarded = null;
        pendingCount++;
      }
      // مقالي فاضي = صفر على طول، مفيش حاجة تتصحح
    }

    if (row.is_correct === 1) {
      row.points_awarded = max;
      earned += max;
      correctCount++;
    }
    rows.push(row);
  }

  return { rows, earned, total, correctCount, pendingCount };
}

function scoreOf(earned, total) {
  return total > 0 ? Math.round((earned / total) * 100) : 0;
}

// حفظ محاولة جديدة بإجاباتها. لو فيها مقالي مستني تصحيح، النتيجة "قيد التصحيح" ومش ناجحة لسه
function saveAttempt(studentId, test, graded) {
  const status = graded.pendingCount > 0 ? "pending" : "graded";
  const score = scoreOf(graded.earned, graded.total);
  const passed = status === "graded" && score >= test.pass_percent ? 1 : 0;

  db.exec("BEGIN");
  try {
    const attemptId = Number(db.prepare(
      `INSERT INTO student_test_attempts (student_id, test_id, score, passed, status, attempted_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(studentId, test.id, score, passed, status).lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO student_answers (attempt_id, question_id, option_id, answer_text, is_correct, points_awarded, max_points, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`
    );
    graded.rows.forEach(r => ins.run(attemptId, r.question_id, r.option_id, r.answer_text, r.is_correct, r.points_awarded, r.max_points, r.is_correct));
    db.exec("COMMIT");
    return { attemptId, status, score, passed: !!passed };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// المشرف صحح الأسئلة المقالية في محاولة: grades = [{ answer_id, points, feedback }]
// بيرجّع { error } أو { attempt } بعد إعادة حساب الدرجة
function gradeEssays(attemptId, grades) {
  const attempt = db.prepare(`SELECT * FROM student_test_attempts WHERE id = ?`).get(attemptId);
  if (!attempt) return { status: 404, error: "المحاولة غير موجودة." };
  const test = db.prepare(`SELECT * FROM tests WHERE id = ?`).get(attempt.test_id);
  if (!test) return { status: 404, error: "الاختبار غير موجود." };

  const essays = db.prepare(
    `SELECT a.* FROM student_answers a JOIN questions q ON q.id = a.question_id
     WHERE a.attempt_id = ? AND q.type = 'essay' AND a.answer_text IS NOT NULL`
  ).all(attemptId);
  const given = new Map((Array.isArray(grades) ? grades : []).map(g => [Number(g && g.answer_id), g]));

  for (const e of essays) {
    const g = given.get(e.id);
    if (!g && e.points_awarded === null) return { status: 400, error: "لازم تدّي درجة لكل الأسئلة المقالية." };
    if (!g) continue;
    const pts = Number(g.points);
    if (!Number.isFinite(pts) || pts < 0 || pts > e.max_points) {
      return { status: 400, error: `الدرجة لازم تكون من 0 لـ ${e.max_points}.` };
    }
  }

  db.exec("BEGIN");
  try {
    const upd = db.prepare(
      `UPDATE student_answers SET points_awarded = ?, is_correct = ?, feedback = ?, graded_at = datetime('now') WHERE id = ?`
    );
    for (const e of essays) {
      const g = given.get(e.id);
      if (!g) continue;
      const pts = Math.round(Number(g.points) * 2) / 2; // نص درجة بالكتير
      const feedback = typeof g.feedback === "string" && g.feedback.trim() ? g.feedback.trim().slice(0, 1000) : null;
      upd.run(pts, pts >= e.max_points ? 1 : 0, feedback, e.id);
    }
    const sums = db.prepare(
      `SELECT COALESCE(SUM(points_awarded), 0) AS earned, COALESCE(SUM(max_points), 0) AS total FROM student_answers WHERE attempt_id = ?`
    ).get(attemptId);
    const score = scoreOf(sums.earned, sums.total);
    const passed = score >= test.pass_percent ? 1 : 0;
    db.prepare(`UPDATE student_test_attempts SET score = ?, passed = ?, status = 'graded' WHERE id = ?`).run(score, passed, attemptId);
    db.exec("COMMIT");
    return { attempt: { ...attempt, score, passed: !!passed, status: "graded" } };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

module.exports = { TYPES, TYPE_LABELS, normalizeArabic, parseAccepted, questionsForStudent, gradeAnswers, saveAttempt, gradeEssays, scoreOf };
