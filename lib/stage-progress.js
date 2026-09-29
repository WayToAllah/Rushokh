// lib/stage-progress.js
// كل منطق "المرحلة": حساب تقدم الطالب في مرحلة، هل يحق له الوصول لعنصر معيّن،
// والانتقال التلقائي للمرحلة التالية عند إتمام المرحلة الحالية.
//
// المرحلة تُعتبر مكتملة لما:
//   - يكون فيها محتوى (حلقة أو كتاب واحد على الأقل)
//   - وكل الحلقات "تم السماع"، وكل الكتب وصلت لآخر صفحة
//   - وكل اختبارات المرحلة اللي فيها أسئلة اتنجح فيها (أي محاولة ناجحة تكفي)

const db = require("../db/database");

function firstStage() {
  return db.prepare(`SELECT * FROM stages ORDER BY order_index ASC, id ASC LIMIT 1`).get();
}

function nextStageAfter(stage) {
  return db.prepare(
    `SELECT * FROM stages
     WHERE order_index > ? OR (order_index = ? AND id > ?)
     ORDER BY order_index ASC, id ASC LIMIT 1`
  ).get(stage.order_index, stage.order_index, stage.id);
}

// ترتيب المراحل (الأصغر أولاً) كقائمة ids، عشان المقارنة تبقى ثابتة حتى لو اتكرر order_index
function orderedStageIds() {
  return db.prepare(`SELECT id FROM stages ORDER BY order_index ASC, id ASC`).all().map(r => r.id);
}

// يرجّع المرحلة الحالية للطالب. لو ملوش مرحلة (مثلاً اتحذفت) يحطه في أول مرحلة.
function ensureCurrentStage(studentId) {
  const student = db.prepare(`SELECT id, current_stage_id FROM students WHERE id = ?`).get(studentId);
  if (!student) return null;
  let stage = student.current_stage_id
    ? db.prepare(`SELECT * FROM stages WHERE id = ?`).get(student.current_stage_id)
    : null;
  if (!stage) {
    stage = firstStage();
    db.prepare(`UPDATE students SET current_stage_id = ? WHERE id = ?`).run(stage ? stage.id : null, studentId);
  }
  return stage || null;
}

// هل المرحلة دي مفتوحة للطالب؟ (الحالية أو أي مرحلة قبلها)
function canAccessStage(studentId, stageId) {
  const current = ensureCurrentStage(studentId);
  if (!current) return false;
  const ids = orderedStageIds();
  const target = ids.indexOf(Number(stageId));
  return target !== -1 && target <= ids.indexOf(current.id);
}

// المرحلة اللي بينتمي لها عنصر: episode | book | test
function stageIdOf(kind, id) {
  const table = { episode: "episodes", book: "books", test: "tests" }[kind];
  if (!table) return null;
  const row = db.prepare(
    `SELECT ss.stage_id AS stage_id FROM ${table} x
     JOIN series s ON s.id = x.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     WHERE x.id = ?`
  ).get(id);
  return row ? row.stage_id : null;
}

function stageProgress(studentId, stageId) {
  const ep = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN p.listened = 1 THEN 1 ELSE 0 END), 0) AS done
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).get(studentId, stageId);

  const bk = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN b.total_pages > 0 AND COALESCE(p.current_page, 0) >= b.total_pages THEN 1
                              WHEN b.total_pages = 0 THEN 1 ELSE 0 END), 0) AS done
     FROM books b
     JOIN series s ON s.id = b.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE ss.stage_id = ?`
  ).get(studentId, stageId);

  // الاختبارات اللي فيها أسئلة بس (الاختبار الفاضي مستحيل حد ينجح فيه)
  const ts = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN EXISTS (
              SELECT 1 FROM student_test_attempts a
              WHERE a.test_id = t.id AND a.student_id = ? AND a.passed = 1
            ) THEN 1 ELSE 0 END), 0) AS passed
     FROM tests t
     JOIN series s ON s.id = t.series_id
     JOIN stage_subject ss ON ss.id = s.stage_subject_id
     WHERE ss.stage_id = ? AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id)`
  ).get(studentId, stageId);

  const contentTotal = ep.total + bk.total;
  const total = contentTotal + ts.total;
  const done = ep.done + bk.done + ts.passed;

  return {
    episodes_total: ep.total,
    episodes_done: ep.done,
    books_total: bk.total,
    books_done: bk.done,
    tests_total: ts.total,
    tests_passed: ts.passed,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    complete: contentTotal > 0 && done === total,
  };
}

function completionOf(studentId, stageId) {
  return db.prepare(
    `SELECT * FROM student_stage_completions WHERE student_id = ? AND stage_id = ?`
  ).get(studentId, stageId);
}

// يتنادى بعد أي تقدم (حلقة، كتاب، اختبار). لو المرحلة الحالية اكتملت:
// يسجّل إتمامها (عشان الشهادة) وينقل الطالب للمرحلة اللي بعدها لو موجودة.
// يرجّع اسم المرحلة الجديدة لو حصل انتقال، أو null.
function advanceIfComplete(studentId) {
  let current = ensureCurrentStage(studentId);
  let movedTo = null;

  // حلقة عشان لو فيه مرحلة اتقفلت قبل كده وكانت مكتملة بالفعل
  for (let guard = 0; current && guard < 50; guard++) {
    const progress = stageProgress(studentId, current.id);
    if (!progress.complete) break;

    if (!completionOf(studentId, current.id)) {
      db.prepare(
        `INSERT INTO student_stage_completions (student_id, stage_id, completed_at)
         VALUES (?, ?, datetime('now'))`
      ).run(studentId, current.id);
    }

    const next = nextStageAfter(current);
    if (!next) break; // آخر مرحلة
    db.prepare(`UPDATE students SET current_stage_id = ? WHERE id = ?`).run(next.id, studentId);
    movedTo = next.name;
    current = next;
  }
  return movedTo;
}

module.exports = {
  firstStage,
  ensureCurrentStage,
  canAccessStage,
  stageIdOf,
  stageProgress,
  completionOf,
  advanceIfComplete,
  orderedStageIds,
};
