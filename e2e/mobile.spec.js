// شاشة موبايل: مفيش صفحة بتخرج برّه الشاشة بالعرض
const { test, expect, apiRegister, loginViaUi, expectNoHorizontalScroll } = require("./helpers");

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.describe("الموبايل", () => {
  test("الصفحة الرئيسية (دخول وتسجيل)", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalScroll(page);
    await page.goto("/#register");
    await expect(page.locator("#registerCard")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("صفحة الطالب", async ({ page, request }) => {
    const s = await apiRegister(request);
    await loginViaUi(page, s.email, s.password);
    await expect(page.locator(".stage-banner")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("لوحة المشرف بكل تبويباتها", async ({ page }) => {
    await loginViaUi(page, "admin@rasokh.test", "admin123");
    await expect(page).toHaveURL(/admin\.html/);
    for (const tab of ["content-manage", "content-view", "tests", "students", "account"]) {
      await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
      await expectNoHorizontalScroll(page);
    }
  });
});
