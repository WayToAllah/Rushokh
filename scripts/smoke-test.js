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

  // ---------- طالب جديد يمشي في المراحل ----------
  const reg = await call("POST", "/auth/register", { headers: ip(), body: { full_name: "<img src=x onerror=alert(1)>", email: `stu${uniq}@t.com`, password: "password123" } });
  check("تسجيل طالب جديد", reg.status === 201, reg.status);
  const T = reg.data.token;

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

  console.log(failures ? `\n❌ ${failures} اختبار فشل` : "\n✅ كل الاختبارات نجحت");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
