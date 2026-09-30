// صفحة الطالب: المنهج، تعليم الحلقات، الخروج، والأمان في عرض الأسماء
const { test, expect, apiRegister, apiLogin, loginViaUi } = require("./helpers");

async function openAsNewStudent(page, request, name) {
  const s = await apiRegister(request, name);
  await loginViaUi(page, s.email, s.password);
  await expect(page).toHaveURL(/student\.html/);
  return s;
}

test.describe("صفحة الطالب", () => {
  test("الطالب الجديد في التمهيدية، والمراحل الجاية مقفولة", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    await expect(page.locator(".stage-banner")).toContainText("التمهيدية");
    await expect(page.getByText("0 من 2 حلقة")).toBeVisible();
  });

  test("زرار الحلقة واضح: 'علّمتها مسموعة' قبل، و'✓ اتسمعت' بعد، والنسبة بتتحدّث", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    const firstRow = page.locator(".item-row").first();
    const btn = firstRow.getByRole("button").last();
    await expect(btn).toHaveText("علّمتها مسموعة");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(firstRow.getByRole("button").last()).toHaveText("✓ اتسمعت");
    await expect(firstRow.getByRole("button").last()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1 من 2 حلقة")).toBeVisible();
  });

  test("حلقة ليها فيديو وكتاب ليه ملف: الأزرار بتشتغل، وفتح الفيديو مابيغيّرش حالة الحلقة", async ({ page, request }) => {
    const admin = await apiLogin(request, "admin@rasokh.test", "admin123");
    const s = await apiRegister(request);
    const cur = await (await request.get("/api/curriculum", { headers: { Authorization: `Bearer ${s.token}` } })).json();
    const series = cur.stages[0].subjects[0].series[0];
    const ep = series.episodes[0], book = series.books[0];
    const asAdmin = { Authorization: `Bearer ${admin}` };
    await request.patch(`/api/admin/content/episodes/${ep.id}`, { headers: asAdmin, data: { url: "https://youtu.be/dQw4w9WgXcQ" } });
    await request.patch(`/api/admin/content/books/${book.id}`, { headers: asAdmin, data: { file_url: "https://drive.google.com/file/d/abcdefgh123/view" } });

    await loginViaUi(page, s.email, s.password);
    const epRow = () => page.locator(".item-row", { hasText: ep.title });
    await epRow().locator("[data-view]").click();
    await expect(page.locator("#viewerOverlay iframe")).toBeVisible();
    await page.locator("#viewerClose").click();
    await expect(epRow().locator(".tiny-btn")).toHaveText("علّمتها مسموعة");
    await epRow().locator(".tiny-btn").click();
    await expect(epRow().locator(".tiny-btn")).toHaveText("✓ اتسمعت");

    const bookRow = () => page.locator(".item-row", { hasText: book.title });
    await bookRow().locator("input").fill("7");
    await bookRow().locator(".tiny-btn").click();
    await expect(bookRow()).toContainText("صفحة 7 من");
  });

  test("شاشة الدخول في صفحة الطالب فيها رابط نسيت كلمة المرور، وبترفض الخانات الفاضية برسالة الموقع", async ({ page }) => {
    await page.goto("/student.html");
    await expect(page.locator("#loginOverlay")).toBeVisible();
    await expect(page.getByRole("link", { name: "نسيت كلمة المرور؟" })).toHaveAttribute("href", "index.html#forgot");
    await page.locator("#loginSubmitBtn").click();
    await expect(page.locator("#loginError")).toContainText("البريد الإلكتروني");
    await expect(page.locator("#loginEmail")).toHaveClass(/invalid/);
  });

  test("اسم فيه كود بيتعرض كنص ومابيتنفذش", async ({ page, request }) => {
    const evil = `<img src=x onerror="window.__xss=1">`;
    await openAsNewStudent(page, request, evil);
    await expect(page.locator("#studentNameLbl")).toHaveText(evil);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("#studentNameLbl img").count()).toBe(0);
  });

  test("الخروج بنافذة بتصميم الموقع: إلغاء بيفضل، وخروج بيطلّع", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    let nativeDialog = false;
    page.on("dialog", d => { nativeDialog = true; d.dismiss(); });
    await page.locator("#btnLogout").click();
    const box = page.getByRole("alertdialog");
    await expect(box).toContainText("هل تريد تسجيل الخروج؟");
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(page).toHaveURL(/student\.html/);
    await page.locator("#btnLogout").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "خروج" }).click();
    await expect(page).toHaveURL(/index\.html/);
    expect(nativeDialog).toBe(false);
  });
});
