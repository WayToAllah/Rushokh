// صفحة الدرس: المشرف بيضيف ملخص واختبار على الحلقة، الطالب بيفتح الدرس ويتنقل بين التبويبات،
// يحل أسئلة الدرس، يكتب ملاحظة ويسأل في المناقشة، والمشرف يرد من تبويب المناقشات.
const { test, expect, apiRegister, apiLogin, loginViaUi } = require("./helpers");

test("صفحة الدرس بتبويباتها واختبار الحلقة والمناقشة", async ({ page, request }) => {
  const admin = await apiLogin(request, "admin@rasokh.test", "admin123");
  const asAdmin = { Authorization: `Bearer ${admin}` };
  const s = await apiRegister(request, "طالب الدرس");
  const cur = await (await request.get("/api/curriculum", { headers: { Authorization: `Bearer ${s.token}` } })).json();
  const series = cur.stages[0].subjects[0].series[0];
  const ep = series.episodes[0];
  const title = `أسئلة ${ep.title} ${Date.now()}`;

  // ---------- المشرف: ملخص + اختبار على الحلقة من الواجهة ----------
  await request.patch(`/api/admin/content/episodes/${ep.id}`, { headers: asAdmin, data: {
    url: "https://youtu.be/dQw4w9WgXcQ", summary: "فوائد الدرس:\n1) النية شرط.", } });
  await loginViaUi(page, "admin@rasokh.test", "admin123");
  await page.locator('.tab-btn[data-tab="tests"]').click();
  await page.locator("#testSeries").selectOption(String(series.id));
  await page.locator("#testEpisode").selectOption(String(ep.id));
  await page.locator("#testTitle").fill(title);
  await page.locator("#formTest").getByRole("button", { name: "إنشاء" }).click();
  await expect(page.locator("#msg-test")).toHaveClass(/ok/);
  await expect(page.locator(".test-card", { hasText: title })).toContainText(`الحلقة: ${ep.title}`);
  const testValue = await page.locator("#questionTest option", { hasText: title }).getAttribute("value");
  await page.locator("#questionTest").selectOption(testValue);
  await page.locator("#questionText").fill("النية شرط في العبادات");
  await page.locator('#newQuestionEditor [data-q="type"]').selectOption("true_false");
  await page.locator("#formQuestion").getByRole("button", { name: "إضافة السؤال" }).click();
  await expect(page.locator("#msg-question")).toHaveText("تمت إضافة السؤال.");
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();

  // ---------- الطالب ----------
  await loginViaUi(page, s.email, s.password);
  const row = page.locator(".item-row", { hasText: ep.title });
  await expect(row).toContainText("📝 عليه أسئلة");
  await row.getByRole("link", { name: ep.title, exact: true }).click();
  await expect(page.locator("#lessonRoot h1")).toHaveText(ep.title);
  await expect(page.locator("#lessonPlayer iframe")).toBeVisible();
  await expect(page.locator("#lessonPanel")).toContainText("النية شرط.");

  // سمعها → يتنقل لأسئلة الدرس ويقوله فاضل الاختبار
  await page.locator("#lessonListen").click();
  await expect(page.locator("#lessonBar")).toContainText("فاضل تنجح في أسئلة الدرس");
  await expect(page.getByRole("tab", { name: /أسئلة الدرس/ })).toHaveAttribute("aria-selected", "true");
  await page.locator("#lessonPanel .test-cta", { hasText: title }).getByRole("button", { name: "بدء الاختبار" }).click();
  await page.locator("#testForm .opt-label", { hasText: /^\s*صح\s*$/ }).click();
  await page.locator("#testForm").getByRole("button", { name: "تسليم الإجابات" }).click();
  await expect(page.locator(".result-banner.pass")).toBeVisible();
  await page.locator("#closeTestBtn").click();
  await expect(page.locator("#lessonBar")).toContainText("✓ الدرس خلص");

  // ملاحظاتي بتتحفظ لوحدها
  await page.getByRole("tab", { name: /ملاحظاتي/ }).click();
  await page.locator("#noteText").fill("أراجع شروط النية");
  await expect(page.locator("#noteStatus")).toHaveText("اتحفظت ✓");

  // المناقشة
  await page.getByRole("tab", { name: /المناقشة/ }).click();
  await page.locator("#commentText").fill("هل النية محلها القلب؟");
  await page.locator("#commentForm").getByRole("button", { name: "نشر" }).click();
  await expect(page.locator("#commentsList .comment")).toContainText("هل النية محلها القلب؟");
  await expect(page.getByRole("tab", { name: /المناقشة/ })).toContainText("1");

  // الرجوع للمنهج: الحلقة خلصت
  await page.locator(".crumbs a").click();
  await expect(page.locator("#lessonRoot")).toBeHidden();
  await expect(row).toContainText("✓ خلص بأسئلته");

  // الملاحظة لسه موجودة لما يرجع للدرس
  await row.getByRole("link", { name: ep.title, exact: true }).click();
  await page.getByRole("tab", { name: /ملاحظاتي/ }).click();
  await expect(page.locator("#noteText")).toHaveValue("أراجع شروط النية");

  // ---------- المشرف يرد من تبويب المناقشات ----------
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await loginViaUi(page, "admin@rasokh.test", "admin123");
  await expect(page.locator("#discBadge")).toBeVisible();
  await page.locator('.tab-btn[data-tab="discussions"]').click();
  const card = page.locator(".disc-card", { hasText: "هل النية محلها القلب؟" });
  await expect(card).toContainText("مستني رد");
  await card.locator("textarea").fill("نعم، والتلفظ بها ليس شرطًا.");
  await card.getByRole("button", { name: "رد", exact: true }).click();
  await expect(page.locator(".disc-card", { hasText: "هل النية محلها القلب؟" })).not.toContainText("مستني رد");

  // الطالب يشوف رد المشرف
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await loginViaUi(page, s.email, s.password);
  await expect(page.locator(".subject-card").first()).toBeVisible();
  // رابط الدرس المباشر بيفتح الدرس على طول (لو حد بعته لزميله مثلاً)
  await page.goto(`/student.html#lesson/${ep.id}`);
  await page.reload();
  await expect(page.locator("#lessonRoot h1")).toHaveText(ep.title);
  await page.getByRole("tab", { name: /المناقشة/ }).click();
  await expect(page.locator("#commentsList .comment.admin")).toContainText("نعم، والتلفظ بها ليس شرطًا.");
});
