// سياسة المحتوى (CSP) مابتكسرش أي صفحة، وصفحة 404 بالعربي
const { test, expect, apiRegister, apiLogin, loginViaUi } = require("./helpers");

// بيجمع أي حاجة المتصفح منعها بسبب الـ CSP بتاعتنا (من أول ما الصفحة تبدأ تتحمّل).
// الحدث ده بيطلع للصفحة نفسها بس، فمشاكل جوه إطار يوتيوب مابتدخلش فيه.
async function watchCsp(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => window.__csp || []);
}

test.describe("سياسة المحتوى", () => {
  test("الصفحة الرئيسية وشاشاتها من غير أي حاجة ممنوعة، والخطوط اتحمّلت", async ({ page }) => {
    const violations = await watchCsp(page);
    for (const hash of ["", "#register", "#forgot"]) {
      await page.goto("/" + hash);
      await page.waitForLoadState("networkidle");
    }
    expect(await violations()).toEqual([]);
    // لو ملف خطوط Google اتمنع، مش هيبقى فيه ولا خط مسجّل
    expect(await page.evaluate(() => document.fonts.size)).toBeGreaterThan(0);
  });

  test("صفحة الطالب ومعاها عرض فيديو يوتيوب جوه الموقع", async ({ page, request }) => {
    const violations = await watchCsp(page);
    const admin = await apiLogin(request, "admin@rasokh.test", "admin123");
    const s = await apiRegister(request);
    const cur = await (await request.get("/api/curriculum", { headers: { Authorization: `Bearer ${s.token}` } })).json();
    const ep = cur.stages[0].subjects[0].series[0].episodes[0];
    const patch = await request.patch(`/api/admin/content/episodes/${ep.id}`, {
      headers: { Authorization: `Bearer ${admin}` }, data: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    expect(patch.status()).toBe(200);

    await loginViaUi(page, s.email, s.password);
    await expect(page).toHaveURL(/student\.html/);
    await page.locator("[data-view]").first().click();
    await expect(page.locator("#viewerOverlay iframe")).toHaveAttribute("src", /youtube\.com\/embed\/dQw4w9WgXcQ/);
    await page.waitForTimeout(500);
    expect(await violations()).toEqual([]);
  });

  test("لوحة المشرف بكل تبويباتها", async ({ page }) => {
    const violations = await watchCsp(page);
    await loginViaUi(page, "admin@rasokh.test", "admin123");
    await expect(page).toHaveURL(/admin\.html/);
    for (const tab of ["content-manage", "content-view", "tests", "students", "account"]) {
      await page.locator(`.tab-btn[data-tab="${tab}"]`).click();
    }
    await page.waitForLoadState("networkidle");
    expect(await violations()).toEqual([]);
  });
});

test.describe("صفحة 404", () => {
  test("رابط غلط بيطلّع صفحة عربي، وزرارها بيرجّع للرئيسية", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "الصفحة دي مش موجودة" })).toBeVisible();
    await page.getByRole("link", { name: "الصفحة الرئيسية" }).click();
    await expect(page.locator("#loginCard")).toBeVisible();
  });
});
