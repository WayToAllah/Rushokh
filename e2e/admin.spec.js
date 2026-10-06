// لوحة المشرف: إضافة محتوى، الحذف بتأكيد، ونقل طالب لمرحلة خلّصها
const { test, expect, apiRegister, apiLogin, loginViaUi } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await loginViaUi(page, "admin@rasokh.test", "admin123");
  await expect(page).toHaveURL(/admin\.html/);
});

test.describe("لوحة المشرف", () => {
  test("فورم فاضي بيطلّع رسالة الموقع في مكانها بدل فقاعة المتصفح", async ({ page }) => {
    await page.locator("#formStage").getByRole("button", { name: "إضافة" }).click();
    await expect(page.locator("#msg-stage")).toHaveText('املأ خانة "اسم المرحلة".');
    await expect(page.locator("#msg-stage")).toHaveClass(/err/);
    await expect(page.locator("#stageName")).toHaveClass(/invalid/);
    expect(await page.locator("#formStage").evaluate(f => f.noValidate)).toBe(true);
    await page.locator("#stageName").fill("x");
    await expect(page.locator("#stageName")).not.toHaveClass(/invalid/);
  });

  test("رابط حلقة مكتوب غلط بيقول لازم يبدأ بـ http", async ({ page }) => {
    await page.locator("#episodeTitle").fill("حلقة");
    await page.locator("#episodeUrl").fill("youtube.com/watch?v=abc");
    await page.locator("#formEpisode").getByRole("button", { name: "إضافة" }).click();
    await expect(page.locator("#msg-episode")).toContainText("http://");
  });

  test("رقم الحلقة بيتملى لوحده، والرقم المكرر بيترفض قبل ما يتبعت، والسلسلة بتفضل مختارة بعد الإضافة", async ({ page }) => {
    const num = page.locator("#episodeNumber");
    const intro = await page.locator("#episodeSeries option", { hasText: "مدخل إلى طلب العلم" }).first().getAttribute("value");
    await page.locator("#episodeSeries").selectOption(intro);
    await expect(page.locator("#episodeNumberHint")).toContainText("الأرقام المستخدمة");
    const next = Number(await num.inputValue());
    await num.fill("1");
    await expect(page.locator("#episodeNumberHint")).toContainText("الرقم 1 مستخدم");
    await page.locator("#episodeTitle").fill("حلقة مكررة");
    await page.locator("#formEpisode").getByRole("button", { name: "إضافة" }).click();
    await expect(page.locator("#msg-episode")).toContainText("الرقم 1 مستخدم");
    await num.fill(String(next));
    const series = await page.locator("#episodeSeries").inputValue();
    await page.locator("#formEpisode").getByRole("button", { name: "إضافة" }).click();
    await expect(page.locator("#msg-episode")).toHaveText("تمت إضافة الحلقة.");
    await expect(page.locator("#episodeSeries")).toHaveValue(series);
    await expect(num).toHaveValue(String(next + 1));
  });

  test("سؤال من غير نص وخيارات بيقول الخانات الناقصة بالاسم", async ({ page }) => {
    await page.locator('.tab-btn[data-tab="tests"]').click();
    await page.locator("#formQuestion").getByRole("button").last().click();
    await expect(page.locator("#msg-question")).toContainText("نص السؤال");
    await expect(page.locator("#msg-question")).toContainText("خيار 1");
  });

  test("تقرير الإكسل بيتحمّل", async ({ page }) => {
    await page.locator('.tab-btn[data-tab="students"]').click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Excel/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("إضافة مرحلة من الفورم وتظهر في عرض المحتوى", async ({ page }) => {
    const name = `مرحلة ${Date.now()}`;
    await page.locator("#stageName").fill(name);
    await page.locator("#formStage").getByRole("button", { name: "إضافة" }).click();
    await page.locator('.tab-btn[data-tab="content-view"]').click();
    await expect(page.locator("#tab-content-view")).toContainText(name);
  });

  test("حذف طالب بيطلب تأكيد أحمر، والإلغاء بيسيبه", async ({ page, request }) => {
    const s = await apiRegister(request, "طالب للحذف");
    await page.locator('.tab-btn[data-tab="students"]').click();
    const row = page.locator("tr", { hasText: s.email });
    await row.locator("[data-delstudent]").click();
    const box = page.getByRole("alertdialog");
    await expect(box).toContainText("حذف الطالب");
    await expect(box.getByRole("button", { name: "إلغاء" })).toBeFocused();
    await box.getByRole("button", { name: "إلغاء" }).click();
    await expect(row).toBeVisible();
    await row.locator("[data-delstudent]").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
    await expect(page.locator("tr", { hasText: s.email })).toHaveCount(0);
  });

  test("رجوع طالب لمرحلة خلّصها: تأكيدين، وبعدها بيعيدها من الأول", async ({ page, request }) => {
    const s = await apiRegister(request, "طالب هيعيد");
    // يخلّص التمهيدية من الـ API
    const token = await apiLogin(request, s.email, s.password);
    const headers = { Authorization: `Bearer ${token}` };
    const cur = await (await request.get("/api/curriculum", { headers })).json();
    const series = cur.stages[0].subjects[0].series[0];
    for (const e of series.episodes) await request.post("/api/progress/episode", { headers, data: { episode_id: e.id, listened: true } });
    for (const b of series.books) await request.post("/api/progress/book", { headers, data: { book_id: b.id, current_page: b.total_pages } });
    const adminToken = await apiLogin(request, "admin@rasokh.test", "admin123");
    const tests = await (await request.get("/api/admin/tests", { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    const t = tests.find(x => x.id === series.tests[0].id);
    const answers = t.questions.map(q => ({ question_id: q.id, option_id: q.options.find(o => o.is_correct).id }));
    const passed = await (await request.post(`/api/tests/${t.id}/attempt`, { headers, data: { answers } })).json();
    expect(passed.advanced_to).toBe("الأولى");

    await page.locator('.tab-btn[data-tab="students"]').click();
    const select = page.locator("tr", { hasText: s.email }).locator("select.stage-select");
    await select.selectOption({ label: "التمهيدية" });
    const box = page.getByRole("alertdialog");
    await expect(box).toContainText("نقل الطالب");
    await box.getByRole("button", { name: "نقل" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("إعادة المرحلة");
    await page.getByRole("alertdialog").getByRole("button", { name: "يعيدها من الأول" }).click();
    await expect(page.locator("tr", { hasText: s.email }).locator("select.stage-select")).toHaveValue(String(cur.stages[0].id));

    const after = await (await request.get("/api/curriculum", { headers })).json();
    const current = after.stages.find(x => x.status === "current");
    expect(current.name).toBe("التمهيدية");
    expect(current.progress.percent).toBe(0);
  });
});
