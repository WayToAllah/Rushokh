// صفحة الطالب: المنهج، تعليم الحلقات، الخروج، والأمان في عرض الأسماء
const { test, expect, apiRegister, loginViaUi } = require("./helpers");

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

  test("تعليم حلقة مسموعة بيحدّث الزرار والنسبة", async ({ page, request }) => {
    await openAsNewStudent(page, request);
    const firstRow = page.locator(".item-row").first();
    await firstRow.getByRole("button").last().click();
    await expect(firstRow.getByRole("button").last()).toHaveText(/✓/);
    await expect(page.getByText("1 من 2 حلقة")).toBeVisible();
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
