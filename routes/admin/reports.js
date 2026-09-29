// routes/admin/reports.js
// تصدير تقرير الطلاب وتقدمهم في كل مادة كملف Excel.
const express = require("express");
const ExcelJS = require("exceljs");
const db = require("../../db/database");
const { requireAuth, requireRole } = require("../../middleware/auth");
const sp = require("../../lib/stage-progress");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const TEAL = "FF0E332F";
const GOLD = "FFB9924F";
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

// تقدم طالب في مادة واحدة داخل مرحلة واحدة
function subjectProgress(studentId, stageSubjectId) {
  const ep = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN p.listened = 1 THEN 1 ELSE 0 END), 0) AS done
     FROM episodes e JOIN series s ON s.id = e.series_id
     LEFT JOIN student_episode_progress p ON p.episode_id = e.id AND p.student_id = ?
     WHERE s.stage_subject_id = ?`
  ).get(studentId, stageSubjectId);

  const bk = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN b.total_pages = 0 OR COALESCE(p.current_page, 0) >= b.total_pages THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(MIN(COALESCE(p.current_page, 0), b.total_pages)), 0) AS pages_read,
            COALESCE(SUM(b.total_pages), 0) AS pages_total
     FROM books b JOIN series s ON s.id = b.series_id
     LEFT JOIN student_book_progress p ON p.book_id = b.id AND p.student_id = ?
     WHERE s.stage_subject_id = ?`
  ).get(studentId, stageSubjectId);

  const ts = db.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM student_test_attempts a
              WHERE a.test_id = t.id AND a.student_id = ? AND a.passed = 1) THEN 1 ELSE 0 END), 0) AS passed,
            MAX((SELECT MAX(a.score) FROM student_test_attempts a WHERE a.test_id = t.id AND a.student_id = ?)) AS best
     FROM tests t JOIN series s ON s.id = t.series_id
     WHERE s.stage_subject_id = ? AND EXISTS (SELECT 1 FROM questions q WHERE q.test_id = t.id)`
  ).get(studentId, studentId, stageSubjectId);

  return { ep, bk, ts };
}

function lastActivity(studentId) {
  const row = db.prepare(
    `SELECT MAX(t) AS last FROM (
       SELECT MAX(updated_at) AS t FROM student_episode_progress WHERE student_id = ?
       UNION ALL SELECT MAX(updated_at) FROM student_book_progress WHERE student_id = ?
       UNION ALL SELECT MAX(attempted_at) FROM student_test_attempts WHERE student_id = ?
     )`
  ).get(studentId, studentId, studentId);
  return row && row.last ? toDate(row.last) : null;
}

// SQLite بيخزن الوقت UTC كنص "YYYY-MM-DD HH:MM:SS".
// Excel ما بيعرفش المناطق الزمنية، فبنحوّله لتوقيت الجهاز عشان التاريخ يطلع صح في مصر مثلاً.
function toDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T") + "Z");
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

function styleHeader(sheet) {
  const header = sheet.getRow(1);
  header.eachCell(cell => {
    cell.font = HEADER_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
  });
  header.height = 32;
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

function addPercentBar(sheet, colLetter) {
  if (sheet.rowCount < 2) return;
  sheet.addConditionalFormatting({
    ref: `${colLetter}2:${colLetter}${sheet.rowCount}`,
    rules: [{ type: "dataBar", minLength: 0, maxLength: 100, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }], color: { argb: "FF7C9683" } }],
  });
}

router.get("/students.xlsx", async (req, res, next) => {
  try {
    const students = db.prepare(
      `SELECT id, full_name, email, phone, age, address, is_blocked, created_at FROM students ORDER BY full_name`
    ).all();
    const stageIds = sp.orderedStageIds();
    const stageName = Object.fromEntries(db.prepare(`SELECT id, name FROM stages`).all().map(s => [s.id, s.name]));

    const wb = new ExcelJS.Workbook();
    wb.creator = "رسوخ";
    wb.created = new Date();

    // ---------- الورقة 1: ملخص الطلاب ----------
    const summary = wb.addWorksheet("ملخص الطلاب");
    summary.columns = [
      { header: "الطالب", key: "name", width: 28 },
      { header: "البريد الإلكتروني", key: "email", width: 30 },
      { header: "الهاتف", key: "phone", width: 16 },
      { header: "العمر", key: "age", width: 8 },
      { header: "العنوان", key: "address", width: 20 },
      { header: "الحالة", key: "status", width: 10 },
      { header: "تاريخ التسجيل", key: "created", width: 14, style: { numFmt: "yyyy-mm-dd" } },
      { header: "آخر نشاط", key: "last", width: 14, style: { numFmt: "yyyy-mm-dd" } },
      { header: "المرحلة الحالية", key: "stage", width: 16 },
      { header: "إنجاز المرحلة الحالية", key: "pct", width: 14, style: { numFmt: "0%" } },
      { header: "حلقات مسموعة", key: "ep", width: 12 },
      { header: "كتب مكتملة", key: "bk", width: 12 },
      { header: "اختبارات ناجحة", key: "ts", width: 12 },
      { header: "المراحل المكتملة", key: "done", width: 26 },
    ];

    // ---------- الورقة 2: التقدم حسب المادة ----------
    const bySubject = wb.addWorksheet("التقدم حسب المادة");
    bySubject.columns = [
      { header: "الطالب", key: "name", width: 28 },
      { header: "البريد الإلكتروني", key: "email", width: 30 },
      { header: "المرحلة", key: "stage", width: 14 },
      { header: "حالة المرحلة", key: "stageStatus", width: 12 },
      { header: "المادة", key: "subject", width: 18 },
      { header: "الحلقات المسموعة", key: "epDone", width: 12 },
      { header: "إجمالي الحلقات", key: "epTotal", width: 12 },
      { header: "الكتب المكتملة", key: "bkDone", width: 12 },
      { header: "إجمالي الكتب", key: "bkTotal", width: 12 },
      { header: "الصفحات المقروءة", key: "pagesRead", width: 12 },
      { header: "إجمالي الصفحات", key: "pagesTotal", width: 12 },
      { header: "الاختبارات الناجحة", key: "tsPassed", width: 12 },
      { header: "إجمالي الاختبارات", key: "tsTotal", width: 12 },
      { header: "أعلى درجة", key: "best", width: 10, style: { numFmt: '0"%"' } },
      { header: "نسبة الإنجاز", key: "pct", width: 12, style: { numFmt: "0%" } },
    ];

    for (const st of students) {
      const current = sp.ensureCurrentStage(st.id);
      const currentIdx = current ? stageIds.indexOf(current.id) : -1;
      const prog = current ? sp.stageProgress(st.id, current.id) : null;
      const completed = db.prepare(
        `SELECT stg.name FROM student_stage_completions c JOIN stages stg ON stg.id = c.stage_id
         WHERE c.student_id = ? ORDER BY c.completed_at`
      ).all(st.id).map(r => r.name);

      summary.addRow({
        name: st.full_name,
        email: st.email,
        phone: st.phone || "",
        age: st.age || "",
        address: st.address || "",
        status: st.is_blocked ? "موقوف" : "فعّال",
        created: toDate(st.created_at),
        last: lastActivity(st.id),
        stage: current ? current.name : "",
        pct: prog ? prog.percent / 100 : 0,
        ep: prog ? `${prog.episodes_done} / ${prog.episodes_total}` : "",
        bk: prog ? `${prog.books_done} / ${prog.books_total}` : "",
        ts: prog ? `${prog.tests_passed} / ${prog.tests_total}` : "",
        done: completed.join("، "),
      });

      // كل المواد في المراحل المفتوحة للطالب (الحالية واللي قبلها)
      for (let i = 0; i <= currentIdx; i++) {
        const stageId = stageIds[i];
        const status = i < currentIdx ? "سابقة" : "حالية";
        const subjects = db.prepare(
          `SELECT ss.id AS ss_id, subj.name FROM stage_subject ss JOIN subjects subj ON subj.id = ss.subject_id
           WHERE ss.stage_id = ? ORDER BY ss.order_index`
        ).all(stageId);

        for (const subj of subjects) {
          const { ep, bk, ts } = subjectProgress(st.id, subj.ss_id);
          const row = bySubject.addRow({
            name: st.full_name,
            email: st.email,
            stage: stageName[stageId],
            stageStatus: status,
            subject: subj.name,
            epDone: ep.done, epTotal: ep.total,
            bkDone: bk.done, bkTotal: bk.total,
            pagesRead: bk.pages_read, pagesTotal: bk.pages_total,
            tsPassed: ts.passed, tsTotal: ts.total,
            best: ts.best === null || ts.best === undefined ? "" : ts.best,
          });
          // نسبة الإنجاز كمعادلة، عشان تتحدث لو حد عدّل الأرقام في الملف
          const r = row.number;
          const total = ep.total + bk.total + ts.total;
          row.getCell("pct").value = {
            formula: `IFERROR((F${r}+H${r}+L${r})/(G${r}+I${r}+M${r}),0)`,
            result: total ? (ep.done + bk.done + ts.passed) / total : 0,
          };
        }
      }
    }

    const center = { horizontal: "center", vertical: "middle" };
    ["phone", "age", "status", "created", "last", "stage", "pct", "ep", "bk", "ts"]
      .forEach(k => { summary.getColumn(k).alignment = center; });
    ["stage", "stageStatus", "epDone", "epTotal", "bkDone", "bkTotal", "pagesRead", "pagesTotal", "tsPassed", "tsTotal", "best", "pct"]
      .forEach(k => { bySubject.getColumn(k).alignment = center; });

    styleHeader(summary);
    styleHeader(bySubject);
    addPercentBar(summary, "J");
    addPercentBar(bySubject, "O");

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rasokh-students-${today}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
