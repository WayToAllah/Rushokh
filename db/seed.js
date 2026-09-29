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
    "student_test_attempts", "options", "questions", "tests",
    "student_book_progress", "student_episode_progress",
    "books", "episodes", "series", "stage_subject",
    "subjects", "stages", "students", "admins"
  ];
  tables.forEach(t => db.exec(`DELETE FROM ${t};`));
}

function seed() {
  clearAll();

  // ---- مشرف افتراضي ----
  const adminHash = bcrypt.hashSync("admin123", 10);
  run(
    `INSERT INTO admins (full_name, email, password_hash) VALUES (?, ?, ?)`,
    ["مشرف المنصة", "admin@rasokh.test", adminHash]
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
  const studentHash = bcrypt.hashSync("student123", 10);
  run(
    `INSERT INTO students (full_name, email, phone, age, address, password_hash, current_stage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["أحمد بن سالم العتيبي", "ahmed@rasokh.test", "0500000000", 22, "الرياض", studentHash, stageIds["الأولى"]]
  );

  console.log("✅ تم تعبئة قاعدة البيانات بنجاح.");
  console.log("   دخول المشرف   -> admin@rasokh.test / admin123");
  console.log("   دخول الطالب   -> ahmed@rasokh.test / student123");
}

seed();
