// أنواع الأسئلة من أولها لآخرها: المشرف بيضيف صح وغلط وأكمل ومقالي، الطالب بيحل،
// والنتيجة "قيد التصحيح" لحد ما المشرف يصحح المقالي من تبويب التصحيح، وبعدها الطالب بيشوف درجته والملاحظة.
const { test, expect, apiRegister, loginViaUi } = require("./helpers");

test("اختبار بأنواع أسئلة مختلفة وتصحيح المقالي", async ({ page, request }) => {
  const title = `اختبار الأنواع ${Date.now()}`;

  // ---------- المشرف بيعمل الاختبار ----------
  await loginViaUi(page, "admin@rasokh.test", "admin123");
  await expect(page).toHaveURL(/admin\.html/);
  await page.locator('.tab-btn[data-tab="tests"]').click();
  await page.locator("#testSeries").selectOption({ index: 0 });
  await page.locator("#testTitle").fill(title);
  await page.locator("#formTest").getByRole("button", { name: "إنشاء" }).click();
  await expect(page.locator("#msg-test")).toHaveClass(/ok/);

  const testValue = await page.locator("#questionTest option", { hasText: title }).getAttribute("value");
  const editor = page.locator("#newQuestionEditor");
  const addQuestion = async (type, text, fill) => {
    await page.locator("#questionTest").selectOption(testValue);
    await page.locator("#questionText").fill(text);
    await editor.locator('[data-q="type"]').selectOption(type);
    await fill();
    await page.locator("#formQuestion").getByRole("button", { name: "إضافة السؤال" }).click();
    await expect(page.locator("#msg-question")).toHaveText("تمت إضافة السؤال.");
  };

  // الخانات المستخبية ما بتطلبش تتملا: سؤال صح وغلط من غير خيارات بيتضاف عادي
  await addQuestion("true_false", "الوضوء سنة وليس شرطًا للصلاة", async () => {
    await editor.locator('[data-panel="true_false"] input[value="false"]').check();
  });
  await addQuestion("fill", "أول أركان الإسلام: ......", async () => {
    await editor.locator('[data-q="accepted"]').fill("الشهادتان\nشهادة أن لا إله إلا الله");
  });
  // أكمل من غير إجابات مقبولة بيقول الخانة الناقصة بالاسم
  await page.locator("#questionText").fill("سؤال ناقص");
  await editor.locator('[data-q="type"]').selectOption("fill");
  await editor.locator('[data-q="accepted"]').fill("");
  await page.locator("#formQuestion").getByRole("button", { name: "إضافة السؤال" }).click();
  await expect(page.locator("#msg-question")).toContainText("الإجابات المقبولة");

  await addQuestion("essay", "اشرح فضل طلب العلم", async () => {
    await editor.locator('[data-q="points"]').fill("2");
    await editor.locator('[data-q="model"]').fill("حديث من سلك طريقًا يلتمس فيه علمًا");
  });

  const card = page.locator(".test-card", { hasText: title });
  await expect(card.locator(".qtype-pill")).toHaveText(["صح وغلط", "أكمل", "مقالي · 2 درجات"]);
  await expect(card).toContainText("الصحيح: خطأ");
  await expect(card).toContainText("المقبول: الشهادتان / شهادة أن لا إله إلا الله");

  // ---------- الطالب بيحل ----------
  const student = await apiRegister(request, "طالب الأنواع");
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await loginViaUi(page, student.email, student.password);
  await expect(page).toHaveURL(/student\.html/);

  const cta = page.locator(".test-cta", { hasText: title });
  await cta.getByRole("button", { name: "بدء الاختبار" }).click();
  const form = page.locator("#testForm");
  await expect(form.locator(".q-block")).toHaveCount(3);
  await form.locator(".q-block").nth(0).getByText("خطأ").click();
  await form.locator(".fill-input").fill("الشَّهادتانِ");
  await form.locator(".essay-input").fill("طلب العلم فريضة على كل مسلم، ومن سلك طريقًا يلتمس فيه علمًا سهّل الله له به طريقًا إلى الجنة.");
  await form.getByRole("button", { name: "تسليم الإجابات" }).click();

  await expect(page.locator(".result-banner.wait")).toContainText("مستنية تصحيح المشرف");
  await expect(page.locator(".marks .mark.ok")).toHaveCount(2);
  await expect(page.locator(".marks .mark.wait")).toHaveCount(1);
  await page.locator("#closeTestBtn").click();
  await expect(cta).toContainText("قيد التصحيح");

  // ---------- المشرف بيصحح ----------
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await loginViaUi(page, "admin@rasokh.test", "admin123");
  await expect(page.locator("#reviewsBadge")).toBeVisible();
  await page.locator('.tab-btn[data-tab="reviews"]').click();
  const review = page.locator(".review-card", { hasText: title });
  await expect(review).toContainText("طالب الأنواع");
  await expect(review.locator(".student-answer")).toContainText("طلب العلم فريضة");
  await review.locator("[data-answer]").fill("1.5");
  await review.locator("[data-feedback]").fill("إجابة طيبة، كان ممكن تذكر الدليل كاملًا");
  await review.getByRole("button", { name: "حفظ التصحيح" }).click();
  // 1 + 1 + 1.5 من 4 = 88%
  await expect(page.locator("#reviewsList")).toContainText("اتصحح: 88% — ناجح");

  // ---------- الطالب بيشوف درجته ----------
  await page.locator("#btnLogout").click();
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await loginViaUi(page, student.email, student.password);
  await expect(cta).toContainText("✓ ناجح — آخر نتيجة: 88%");
  await cta.getByRole("button", { name: "📄 نتيجتي" }).click();
  const review2 = page.locator(".answer-review");
  await expect(review2).toContainText("1.5 من 2");
  await expect(review2).toContainText("إجابة طيبة");
  await expect(page.locator("#testModalBody")).not.toContainText("شهادة أن لا إله إلا الله");
});
