// scripts/smoke-test.js
// اختبار سريع لأهم سيناريوهات المنصة. شغّله والسيرفر شغّال على قاعدة بيانات تجريبية:
//   npm run seed && npm start      (في شباك)
//   node scripts/smoke-test.js     (في شباك تاني)
// اختياري: BASE=http://localhost:4000 node scripts/smoke-test.js

const BASE = (process.env.BASE || "http://localhost:4000") + "/api";
let failures = 0;

function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra !== undefined ? "  → " + JSON.stringify(extra) : ""}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

(async () => {
  const uniq = Date.now();
  // كل طلب ليه "جهاز" مختلف عشان حد الطلبات لكل جهاز ما يأثرش على الاختبار نفسه
  let ipN = 0;
  const ip = () => ({ "cf-connecting-ip": `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}` });

  // ---------- الأمان ----------
  const jwt = require("jsonwebtoken");
  const forged = jwt.sign({ id: 1, role: "admin" }, "rasokh-dev-secret-change-me");
  const r1 = await call("GET", "/admin/students", { token: forged });
  check("توكن مشرف مزيّف بالمفتاح القديم مرفوض", r1.status === 401, r1.status);

  const weak = await call("POST", "/auth/register", { headers: ip(), body: { full_name: "ضعيف", email: `weak${uniq}@t.com`, password: "1" } });
  check("كلمة مرور قصيرة مرفوضة", weak.status === 400, weak.status);

  let lastStatus;
  for (let i = 0; i < 11; i++) {
    lastStatus = (await call("POST", "/auth/login", { headers: ip(), body: { email: "ahmed@rasokh.test", password: "wrong-pass" } })).status;
  }
  check("المحاولة رقم 11 الغلط بتتقفل (429)", lastStatus === 429, lastStatus);

  const admin = await call("POST", "/auth/admin-login", { headers: ip(), body: { email: "ADMIN@rasokh.test", password: "admin123" } });
  check("دخول المشرف (البريد بحروف كبيرة يشتغل)", admin.status === 200, admin.status);
  const A = admin.data && admin.data.token;

  const oneBox = await call("POST", "/auth/login", { headers: ip(), body: { email: "admin@rasokh.test", password: "admin123" } });
  check("خانة الدخول الواحدة بتدخّل المشرف كمشرف", oneBox.status === 200 && oneBox.data.role === "admin", oneBox.data && oneBox.data.role);

  // ---------- طالب جديد يمشي في المراحل ----------
  const reg = await call("POST", "/auth/register", { headers: ip(), body: { full_name: "<img src=x onerror=alert(1)>", email: `stu${uniq}@t.com`, password: "password123" } });
  check("تسجيل طالب جديد", reg.status === 201, reg.status);
  const T = reg.data.token;

  const stuLogin = await call("POST", "/auth/login", { headers: ip(), body: { email: `stu${uniq}@t.com`, password: "password123" } });
  check("نفس الخانة بتدخّل الطالب كطالب", stuLogin.status === 200 && stuLogin.data.role === "student", stuLogin.data && stuLogin.data.role);

  let cur = await call("GET", "/curriculum", { token: T });
  let current = cur.data.stages.find(s => s.status === "current");
  check("الطالب الجديد يبدأ في التمهيدية وفيها محتوى", current.name === "التمهيدية" && current.subjects.length > 0, current.name);

  const locked = cur.data.stages.find(s => s.status === "locked");
  const tree = await call("GET", "/admin/content/tree", { token: A });
  const lockedEp = tree.data.find(s => s.id === locked.id).subjects[0].series[0].episodes[0];
  const blocked = await call("POST", "/progress/episode", { token: T, body: { episode_id: lockedEp.id, listened: true } });
  check("ما يقدرش يعلّم حلقة في مرحلة مقفولة", blocked.status === 403, blocked.status);

  const series = current.subjects[0].series[0];
  let adv = null;
  for (const e of series.episodes) {
    adv = (await call("POST", "/progress/episode", { token: T, body: { episode_id: e.id, listened: true } })).data.advanced_to;
  }
  for (const b of series.books) {
    adv = (await call("POST", "/progress/book", { token: T, body: { book_id: b.id, current_page: b.total_pages } })).data.advanced_to;
  }
  check("خلّص الحلقات والكتب بس لسه ما نجحش في الاختبار: ما يعدّيش", adv === null, adv);

  const test = series.tests[0];
  const full = await call("GET", `/tests/${test.id}`, { token: T });
  const wrongAnswers = full.data.questions.map(q => ({ question_id: q.id, option_id: q.options[q.options.length - 1].id }));
  const fail = await call("POST", `/tests/${test.id}/attempt`, { token: T, body: { answers: wrongAnswers } });
  check("رسب في الاختبار: ما يعدّيش", fail.data.passed === false && fail.data.advanced_to === null, fail.data);

  const cert0 = await call("GET", `/progress/certificate/${current.id}`, { token: T });
  check("الشهادة مش متاحة قبل النجاح", cert0.data.eligible === false, cert0.data.percent);

  const tAdmin = (await call("GET", "/admin/tests", { token: A })).data.find(t => t.id === test.id);
  const rightAnswers = tAdmin.questions.map(q => ({ question_id: q.id, option_id: q.options.find(o => o.is_correct).id }));
  const pass = await call("POST", `/tests/${test.id}/attempt`, { token: T, body: { answers: rightAnswers } });
  check("نجح في الاختبار: عدّى للمرحلة الأولى تلقائيًا", pass.data.passed === true && pass.data.advanced_to === "الأولى", pass.data.advanced_to);

  cur = await call("GET", "/curriculum", { token: T });
  check("المنهج بقى يعرض الأولى كمرحلة حالية", cur.data.stages.find(s => s.status === "current").name === "الأولى");

  const cert1 = await call("GET", `/progress/certificate/${current.id}`, { token: T });
  check("شهادة التمهيدية متاحة وبرقم", cert1.data.eligible === true && /^RSK-\d{6}$/.test(cert1.data.certificate_no), cert1.data.certificate_no);

  // ---------- المشرف ----------
  const stu = (await call("GET", "/admin/students", { token: A })).data.find(s => s.id === reg.data.student.id);
  check("الاسم اللي فيه كود محفوظ كنص (الصفحة هي اللي لازم تعرضه آمن)", stu.full_name.includes("<img"));
  const move = await call("PATCH", `/admin/students/${stu.id}/stage`, { token: A, body: { stage_id: current.id } });
  check("المشرف ينقل الطالب يدويًا", move.status === 200, move.data);

  const blk = await call("PATCH", `/admin/students/${stu.id}/block`, { token: A, body: { is_blocked: true } });
  const afterBlock = await call("GET", "/curriculum", { token: T });
  check("الطالب الممنوع بيتوقف فورًا حتى بجلسته القديمة", blk.status === 200 && afterBlock.status === 403, afterBlock.status);
  await call("DELETE", `/admin/students/${stu.id}`, { token: A });

  const badUrl = await call("POST", "/admin/content/episodes", { token: A, body: { series_id: series.id, title: "x", url: "javascript:alert(1)" } });
  check("رابط javascript: مرفوض", badUrl.status === 400, badUrl.status);

  const pw = await call("POST", "/admin/account/password", { token: A, body: { current_password: "wrong", new_password: "newpassword1" } });
  check("تغيير كلمة المرور بباسورد حالي غلط مرفوض", pw.status === 400, pw.status);

  // ---------- التعديل والترتيب ----------
  const H = { token: A };
  // طالب جديد (أحمد اتقفل مؤقتًا من اختبار المحاولات الغلط فوق)، ونحطه في المرحلة الأولى
  const reg2 = await call("POST", "/auth/register", { headers: ip(), body: { full_name: "طالب التعديل", email: `edit${uniq}@t.com`, password: "password123" } });
  const T2 = reg2.data.token;
  let t2 = (await call("GET", "/admin/content/tree", H)).data;
  await call("PATCH", `/admin/students/${reg2.data.student.id}/stage`, { ...H, body: { stage_id: t2.find(s => s.name === "الأولى").id } });
  const s1 = t2.find(s => s.name === "الأولى").subjects[0].series[0];
  const ep0 = s1.episodes[0];
  await call("POST", "/progress/episode", { token: T2, body: { episode_id: ep0.id, listened: true } });

  const editEp = await call("PATCH", `/admin/content/episodes/${ep0.id}`, { ...H, body: { title: "عنوان معدّل", url: "https://youtu.be/dQw4w9WgXcQ" } });
  const curAfter = (await call("GET", "/curriculum", { token: T2 })).data;
  const epAfter = curAfter.stages.find(s => s.status === "current").subjects[0].series[0].episodes.find(e => e.id === ep0.id);
  check("تعديل الحلقة اتحفظ، والطالب ما خسرش إنه سمعها", editEp.status === 200 && epAfter.title === "عنوان معدّل" && epAfter.listened === 1, epAfter);

  const emptyTitle = await call("PATCH", `/admin/content/episodes/${ep0.id}`, { ...H, body: { title: "  " } });
  check("عنوان فاضي مرفوض", emptyTitle.status === 400, emptyTitle.status);

  const reversed = [...s1.episodes.map(e => e.id)].reverse();
  const ro = await call("POST", "/admin/content/reorder", { ...H, body: { kind: "episodes", ids: reversed } });
  const order = (await call("GET", "/curriculum", { token: T2 })).data.stages.find(s => s.status === "current").subjects[0].series[0].episodes.map(e => e.id);
  check("ترتيب الحلقات اتغيّر عند الطالب", ro.status === 200 && JSON.stringify(order) === JSON.stringify(reversed), order);

  const newEp = await call("POST", "/admin/content/episodes", { ...H, body: { series_id: s1.id, title: "حلقة جديدة في الآخر" } });
  const lastEp = (await call("GET", "/admin/content/tree", H)).data.find(s => s.name === "الأولى").subjects[0].series[0].episodes.slice(-1)[0];
  check("الحلقة الجديدة بتتحط في آخر السلسلة", lastEp.id === newEp.data.id, lastEp.title);

  const editBook = await call("PATCH", `/admin/content/books/${s1.books[0].id}`, { ...H, body: { total_pages: 30, file_url: "https://drive.google.com/file/d/abcdefgh/view" } });
  check("تعديل الكتاب (الصفحات والرابط)", editBook.status === 200, editBook.status);

  const q = (await call("GET", "/admin/tests", H)).data[0].questions[0];
  const twoCorrect = await call("PATCH", `/admin/tests/questions/${q.id}`, { ...H, body: { options: [{ text: "أ", is_correct: true }, { text: "ب", is_correct: true }] } });
  check("سؤال بإجابتين صح مرفوض", twoCorrect.status === 400, twoCorrect.data);
  const editQ = await call("PATCH", `/admin/tests/questions/${q.id}`, { ...H, body: { text: "سؤال معدّل؟", options: [{ text: "صح", is_correct: true }, { text: "غلط", is_correct: false }] } });
  const qAfter = (await call("GET", "/admin/tests", H)).data[0].questions[0];
  check("تعديل السؤال والخيارات", editQ.status === 200 && qAfter.text === "سؤال معدّل؟" && qAfter.options.length === 2, qAfter.options.map(o => o.text));

  const editTest = await call("PATCH", `/admin/tests/${qAfter.test_id}`, { ...H, body: { pass_percent: 150 } });
  check("نسبة نجاح أكبر من 100 مرفوضة", editTest.status === 400, editTest.status);

  // ---------- كلمات المرور ----------
  const reset = await call("PATCH", `/admin/students/${reg2.data.student.id}/password`, { ...H, body: { new_password: "resetpass1" } });
  const loginNew = await call("POST", "/auth/login", { headers: ip(), body: { email: `edit${uniq}@t.com`, password: "resetpass1" } });
  check("المشرف حط كلمة مرور جديدة للطالب والطالب دخل بيها", reset.status === 200 && loginNew.status === 200, loginNew.status);

  const selfWrong = await call("POST", "/account/password", { token: loginNew.data.token, body: { current_password: "wrong", new_password: "whatever123" } });
  const selfOk = await call("POST", "/account/password", { token: loginNew.data.token, body: { current_password: "resetpass1", new_password: "student123" } });
  check("الطالب غيّر كلمة المرور بنفسه (وبالحالية الغلط اترفض)", selfWrong.status === 400 && selfOk.status === 200, [selfWrong.status, selfOk.status]);
  const adminCantUseStudentRoute = await call("POST", "/account/password", { ...H, body: { current_password: "x", new_password: "yyyyyyyy" } });
  check("مسار كلمة مرور الطالب مقفول على المشرف", adminCantUseStudentRoute.status === 403, adminCantUseStudentRoute.status);

  console.log(failures ? `\n❌ ${failures} اختبار فشل` : "\n✅ كل الاختبارات نجحت");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
