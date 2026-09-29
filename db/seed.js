// db/seed.js
// تعبئة قاعدة البيانات ببيانات تجريبية: مراحل، أقسام، سلاسل، حلقات، كتب، اختبار، ومشرف افتراضي.
// التشغيل: npm run seed

const bcrypt = require("bcryptjs");
const db = require("./database");

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function clearAll() {
  const tables = [
    "student_stage_completions", "student_test_attempts", "options", "questions", "tests",
    "student_book_progress", "student_episode_progress",
    "books", "episodes", "series", "stage_subject",
    "subjects", "stages", "students", "admins"
  ];
  tables.forEach(t => db.exec(`DELETE FROM ${t};`));
}

// الافتراضي (npm run seed) بيانات تجربة معروفة. أول تشغيل تلقائي (ensure-seed) بيبعت كلمة مرور غير معروفة ومن غير طالب تجريبي.
function seed({ adminEmail = "admin@rasokh.test", adminPassword = "admin123", demoStudent = true } = {}) {
  clearAll();

  // ---- مشرف افتراضي ----
  const adminHash = bcrypt.hashSync(adminPassword, 10);
  run(
    `INSERT INTO admins (full_name, email, password_hash) VALUES (?, ?, ?)`,
    ["مشرف المنصة", adminEmail, adminHash]
  );

  // ---- المراحل ----
  const stageNames = ["التمهيدية", "الأولى", "الثانية", "الثالثة"];
  const stageIds = {};
  stageNames.forEach((name, i) => {
    const info = run(`INSERT INTO stages (name, order_index) VALUES (?, ?)`, [name, i]);
    stageIds[name] = Number(info.lastInsertRowid);
  });

  // ---- الأقسام ----
  const subjectDefs = [
    { name: "الفقه", icon: "⚖️" },
    { name: "التفسير", icon: "📜" },
    { name: "الحديث", icon: "📗" },
    { name: "مصطلح الحديث", icon: "🔖" },
  ];
  const subjectIds = {};
  subjectDefs.forEach(s => {
    const info = run(`INSERT INTO subjects (name, icon) VALUES (?, ?)`, [s.name, s.icon]);
    subjectIds[s.name] = Number(info.lastInsertRowid);
  });

  // ---- المرحلة التمهيدية: قسم الفقه، سلسلة قصيرة + كتاب + اختبار ----
  const introSS = Number(run(
    `INSERT INTO stage_subject (stage_id, subject_id, order_index) VALUES (?, ?, 0)`,
    [stageIds["التمهيدية"], subjectIds["الفقه"]]
  ).lastInsertRowid);
  const introSeries = Number(run(
    `INSERT INTO series (stage_subject_id, name, order_index) VALUES (?, ?, 0)`,
    [introSS, "مدخل إلى طلب العلم"]
  ).lastInsertRowid);
  const introEpisodeIds = [["فضل العلم وآدابه", "25 د"], ["كيف تطلب العلم", "30 د"]].map(([title, duration], i) =>
    Number(run(`INSERT INTO episodes (series_id, title, duration, order_index) VALUES (?, ?, ?, ?)`,
      [introSeries, title, duration, i]).lastInsertRowid)
  );
  const introBookId = Number(run(`INSERT INTO books (series_id, title, total_pages) VALUES (?, ?, ?)`,
    [introSeries, "حلية طالب العلم", 40]).lastInsertRowid);
  const introTestId = Number(run(`INSERT INTO tests (series_id, title, pass_percent) VALUES (?, ?, 60)`,
    [introSeries, "اختبار المدخل"]).lastInsertRowid);
  [
    { text: "ما أول ما يبدأ به طالب العلم؟", options: ["إخلاص النية لله", "جمع الكتب", "الشهرة"], correct: 0 },
    { text: "من آداب طالب العلم:", options: ["الكبر", "التواضع", "الجدال"], correct: 1 },
  ].forEach((q, qi) => {
    const qId = Number(run(`INSERT INTO questions (test_id, text, order_index) VALUES (?, ?, ?)`,
      [introTestId, q.text, qi]).lastInsertRowid);
    q.options.forEach((t, oi) => run(`INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`,
      [qId, t, oi === q.correct ? 1 : 0]));
  });

  // ---- ربط أقسام "الفقه، التفسير، الحديث" بالمرحلة الأولى ----
  const stageSubjectIds = {};
  ["الفقه", "التفسير", "الحديث"].forEach((subjName, i) => {
    const info = run(
      `INSERT INTO stage_subject (stage_id, subject_id, order_index) VALUES (?, ?, ?)`,
      [stageIds["الأولى"], subjectIds[subjName], i]
    );
    stageSubjectIds[subjName] = Number(info.lastInsertRowid);
  });

  // ---- سلسلة: شرح الأصول الثلاثة (قسم الفقه) ----
  const seriesFiqh = Number(run(
    `INSERT INTO series (stage_subject_id, name, order_index) VALUES (?, ?, 0)`,
    [stageSubjectIds["الفقه"], "شرح الأصول الثلاثة"]
  ).lastInsertRowid);

  const fiqhEpisodes = [
    ["المقدمة وبيان أهمية العلم", "38 د"],
    ["معرفة الله عز وجل", "41 د"],
    ["معرفة دين الإسلام وأركانه", "35 د"],
    ["معرفة النبي صلى الله عليه وسلم", "40 د"],
    ["أدلة البعث والنشور", "29 د"],
  ];
  fiqhEpisodes.forEach(([title, duration], i) => {
    run(
      `INSERT INTO episodes (series_id, title, duration, order_index) VALUES (?, ?, ?, ?)`,
      [seriesFiqh, title, duration, i]
    );
  });
  run(
    `INSERT INTO books (series_id, title, total_pages) VALUES (?, ?, ?)`,
    [seriesFiqh, "متن الأصول الثلاثة", 24]
  );

  // ---- اختبار لسلسلة الأصول الثلاثة ----
  const testId = Number(run(
    `INSERT INTO tests (series_id, title, pass_percent) VALUES (?, ?, 60)`,
    [seriesFiqh, "اختبار الأصول الثلاثة - الوحدة الأولى"]
  ).lastInsertRowid);

  const questionsData = [
    {
      text: "كم عدد الأصول التي وجب على كل مسلم تعلمها بحسب الرسالة؟",
      options: ["أصلان", "ثلاثة أصول", "أربعة أصول", "خمسة أصول"],
      correct: 1,
    },
    {
      text: "ما هو أول واجب على المكلف؟",
      options: ["الصلاة", "الزكاة", "معرفة الله سبحانه وتعالى", "الصيام"],
      correct: 2,
    },
    {
      text: "بِمَ تُعرف دلائل الربوبية عند المصنف؟",
      options: ["بالنظر في المخلوقات وآيات الله", "بالتقليد فقط", "بالمنطق الفلسفي", "لا يمكن معرفتها"],
      correct: 0,
    },
  ];
  questionsData.forEach((q, qi) => {
    const qId = Number(run(
      `INSERT INTO questions (test_id, text, order_index) VALUES (?, ?, ?)`,
      [testId, q.text, qi]
    ).lastInsertRowid);
    q.options.forEach((optText, oi) => {
      run(
        `INSERT INTO options (question_id, text, is_correct) VALUES (?, ?, ?)`,
        [qId, optText, oi === q.correct ? 1 : 0]
      );
    });
  });

  // ---- سلسلة: تفسير جزء عم (قسم التفسير) ----
  const seriesTafsir = Number(run(
    `INSERT INTO series (stage_subject_id, name, order_index) VALUES (?, ?, 0)`,
    [stageSubjectIds["التفسير"], "تفسير جزء عم"]
  ).lastInsertRowid);
  [["تفسير سورة النبأ", "52 د"], ["تفسير سورة النازعات", "47 د"], ["تفسير سورة عبس", "33 د"]]
    .forEach(([title, duration], i) => {
      run(`INSERT INTO episodes (series_id, title, duration, order_index) VALUES (?, ?, ?, ?)`,
        [seriesTafsir, title, duration, i]);
    });
  run(`INSERT INTO books (series_id, title, total_pages) VALUES (?, ?, ?)`,
    [seriesTafsir, "تفسير جزء عم - ابن عثيمين", 180]);

  // ---- سلسلة: الأربعون النووية (قسم الحديث) ----
  const seriesHadith = Number(run(
    `INSERT INTO series (stage_subject_id, name, order_index) VALUES (?, ?, 0)`,
    [stageSubjectIds["الحديث"], "الأربعون النووية"]
  ).lastInsertRowid);
  [["حديث إنما الأعمال بالنيات", "44 د"], ["حديث بني الإسلام على خمس", "39 د"]]
    .forEach(([title, duration], i) => {
      run(`INSERT INTO episodes (series_id, title, duration, order_index) VALUES (?, ?, ?, ?)`,
        [seriesHadith, title, duration, i]);
    });
  run(`INSERT INTO books (series_id, title, total_pages) VALUES (?, ?, ?)`,
    [seriesHadith, "متن الأربعين النووية", 16]);

  // ---- طالب تجريبي ----
  if (demoStudent) {
    const studentHash = bcrypt.hashSync("student123", 10);
    const ahmedId = Number(run(
      `INSERT INTO students (full_name, email, phone, age, address, password_hash, current_stage_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["أحمد بن سالم العتيبي", "ahmed@rasokh.test", "0500000000", 22, "الرياض", studentHash, stageIds["الأولى"]]
    ).lastInsertRowid);

    // أحمد أتم التمهيدية بالكامل (عشان تظهر شهادتها في التجربة)
    introEpisodeIds.forEach(id => run(
      `INSERT INTO student_episode_progress (student_id, episode_id, listened) VALUES (?, ?, 1)`, [ahmedId, id]));
    run(`INSERT INTO student_book_progress (student_id, book_id, current_page) VALUES (?, ?, 40)`, [ahmedId, introBookId]);
    run(`INSERT INTO student_test_attempts (student_id, test_id, score, passed) VALUES (?, ?, 100, 1)`, [ahmedId, introTestId]);
    run(`INSERT INTO student_stage_completions (student_id, stage_id) VALUES (?, ?)`, [ahmedId, stageIds["التمهيدية"]]);
  }

  console.log("✅ تم تعبئة قاعدة البيانات بنجاح.");
}

function hasAnyData() {
  const n = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return n("students") + n("admins") + n("stages") + n("subjects") > 0;
}

module.exports = { seed, hasAnyData };

// التشغيل من سطر الأوامر: npm run seed
// بيرفض يمسح قاعدة بيانات فيها بيانات، إلا مع --force (وبيعمل نسخة احتياطية الأول)
if (require.main === module) {
  const force = process.argv.includes("--force");
  if (hasAnyData() && !force) {
    console.log("");
    console.log("⛔ قاعدة البيانات فيها بيانات بالفعل (طلاب أو محتوى)، ومش هيتم مسحها.");
    console.log("   الأمر ده بيمسح كل حاجة ويرجّع بيانات التجربة.");
    console.log("   لو متأكد إنك عايز تمسح كل البيانات، اكتب:");
    console.log("   npm run seed -- --force");
    console.log("");
    process.exit(1);
  }
  if (hasAnyData()) {
    const file = require("../lib/backup").backupNow();
    if (file) console.log(`💾 نسخة احتياطية قبل المسح: ${file}`);
  }
  seed();
  console.log("   دخول المشرف   -> admin@rasokh.test / admin123");
  console.log("   دخول الطالب   -> ahmed@rasokh.test / student123");
  console.log("   ⚠️ دي بيانات تجربة معروفة، ما تفتحش الموقع بيها لحد.");
}
