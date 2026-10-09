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
    await expect(page.locator(".stage-banner")).toContainText("0 من 2 حلقة");
  });

  test("الاستماع بيتعلّم من جوه الدرس بس، وبيظهر في المنهج بعد الرجوع والنسبة بتتحدّث", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    const firstRow = page.locator(".item-row").first();
    await expect(firstRow.getByRole("button")).toHaveCount(0); // مفيش زرار استماع برّه
    await expect(firstRow.locator(".listen-badge")).toHaveCount(0);
    await firstRow.locator(".item-title-link").click();
    const btn = page.locator("#lessonListen");
    await expect(btn).toHaveText("علّمتها مسموعة");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(page.locator("#lessonListen")).toHaveText("✓ اتسمعت");
    await expect(page.locator("#lessonListen")).toHaveAttribute("aria-pressed", "true");
    await page.locator(".crumbs a").first().click();
    await expect(firstRow.locator(".listen-badge")).toHaveText("✓ اتسمعت");
    await expect(page.locator(".stage-banner")).toContainText("1 من 2 حلقة");
  });

  test("البحث بيلاقي الدروس المفتوحة بس، ومسار الدرس بيفتح السلسلة، والسلسلة بتتفتح وتتقفل بالسهم", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    const title = await page.locator(".item-title-link").first().textContent();
    // مرحلة مقفولة: الطالب الجديد ما يلاقيش حاجة منها
    await page.locator("#curSearch").fill("معرفة دين الاسلام");
    await expect(page.locator("#searchResults")).toContainText("مفيش نتايج");
    await page.locator("#curSearch").fill(title.slice(0, 6));
    await expect(page.locator(".search-result").first()).toContainText(title);
    await page.locator(".search-result").first().click();
    await expect(page.locator("#lessonRoot h1")).toHaveText(title);

    // المسار: دوسة على اسم السلسلة بترجّع للمنهج والسلسلة مفتوحة
    const crumbs = page.locator(".crumbs a");
    await crumbs.last().click();
    await expect(page.locator("#lessonRoot")).toBeHidden();
    await expect(page.locator("#curSearch")).toHaveValue("");
    await expect(page.locator(".series-block.open").first()).toBeVisible();

    const series = page.locator(".series-block").first();
    await series.locator(".series-toggle").click();
    await expect(series).not.toHaveClass(/open/);
    await expect(series.locator(".item-row").first()).toBeHidden();
    await series.locator(".series-toggle").click();
    await expect(series.locator(".item-row").first()).toBeVisible();
  });

  test("حلقة ليها فيديو وكتاب ليه ملف: الدرس بيفتح في صفحته، والرجوع بيرجّع للمنهج من غير ما الحالة تتغير", async ({ page, request }) => {
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
    await epRow().getByRole("link", { name: ep.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#lesson/${ep.id}$`));
    await expect(page.locator("#lessonPlayer iframe")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#lessonRoot")).toBeHidden();
    await expect(epRow().locator(".listen-badge")).toHaveCount(0);

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
