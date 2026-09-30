// الصفحة الرئيسية: الدخول، إنشاء حساب، رسايل الخانات، وزرار العين
const { test, expect, uniqueEmail, loginViaUi } = require("./helpers");

test.describe("الصفحة الرئيسية", () => {
  test("بتفتح على خانة الدخول بس، وزرار إنشاء حساب بيبدّل للتسجيل وبيرجع", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#loginCard")).toBeVisible();
    await expect(page.locator("#registerCard")).toBeHidden();
    await page.getByRole("link", { name: "إنشاء حساب جديد" }).click();
    await expect(page).toHaveURL(/#register$/);
    await expect(page.locator("#registerCard")).toBeVisible();
    await expect(page.locator("#regName")).toBeFocused();
    await page.getByRole("link", { name: "تسجيل الدخول" }).click();
    await expect(page.locator("#loginCard")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#registerCard")).toBeVisible();
  });

  test("الخانات الإجبارية عليها علامة، والاختيارية مكتوب جنبها (اختياري)", async ({ page }) => {
    await page.goto("/#register");
    for (const id of ["regName", "regEmail", "regPassword"]) {
      await expect(page.locator(`label[for="${id}"] .req`)).toHaveText("*");
    }
    for (const id of ["regPhone", "regAge", "regAddress"]) {
      await expect(page.locator(`label[for="${id}"] .opt`)).toHaveText("(اختياري)");
    }
  });

  test("إرسال التسجيل فاضي بيطلّع رسالة الموقع مش فقاعة المتصفح، والخانات بتتلوّن", async ({ page }) => {
    await page.goto("/#register");
    let nativeBubble = false;
    page.on("dialog", () => { nativeBubble = true; });
    await page.getByRole("button", { name: "تسجيل", exact: true }).click();
    await expect(page.locator("#registerError")).toContainText("الاسم الكامل");
    await expect(page.locator("#regName")).toHaveClass(/invalid/);
    const bubble = await page.locator("#regName").evaluate(el => el.validationMessage !== "" && el.form.noValidate === false);
    expect(bubble || nativeBubble).toBe(false);
  });

  test("بريد مكتوب غلط وكلمة مرور قصيرة ليهم رسايل واضحة", async ({ page }) => {
    await page.goto("/#register");
    await page.locator("#regName").fill("طالب");
    await page.locator("#regEmail").fill("not-an-email");
    await page.locator("#regPassword").fill("123");
    await page.getByRole("button", { name: "تسجيل", exact: true }).click();
    await expect(page.locator("#registerError")).toContainText("البريد الإلكتروني مكتوب غلط");
    await expect(page.locator("#registerError")).toContainText("8 أحرف");
  });

  test("طالب جديد بيسجّل ويوصل لصفحته واسمه ظاهر", async ({ page }) => {
    const email = uniqueEmail("ui");
    await page.goto("/#register");
    await page.locator("#regName").fill("عبد الله التجربة");
    await page.locator("#regEmail").fill(email);
    await page.locator("#regPassword").fill("password123");
    await page.getByRole("button", { name: "تسجيل", exact: true }).click();
    await expect(page).toHaveURL(/student\.html/);
    await expect(page.locator("#studentNameLbl")).toHaveText("عبد الله التجربة");
  });

  test("نفس خانة الدخول بتودّي المشرف للوحة المشرف والطالب لصفحته", async ({ page }) => {
    await loginViaUi(page, "admin@rasokh.test", "admin123");
    await expect(page).toHaveURL(/admin\.html/);
    await page.evaluate(() => localStorage.clear());
    await loginViaUi(page, "ahmed@rasokh.test", "student123");
    await expect(page).toHaveURL(/student\.html/);
  });

  test("كلمة مرور غلط بتطلّع رسالة بالعربي ومابتدخلش", async ({ page }) => {
    await loginViaUi(page, "ahmed@rasokh.test", "wrong-password");
    await expect(page.locator("#loginError")).toContainText("غير صحيحة");
    await expect(page).toHaveURL(/\/(index\.html)?(#.*)?$/);
  });

  test("رابط نسيت كلمة المرور بيفتح شاشة البريد، ومن غير إعدادات إيميل بيقول كلّم المشرف", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
    await expect(page).toHaveURL(/#forgot$/);
    await expect(page.locator("#forgotCard")).toBeVisible();
    await expect(page.locator("#forgotEmail")).toBeFocused();
    await page.getByRole("button", { name: "ابعت الكود" }).click();
    await expect(page.locator("#forgotError")).toContainText("البريد الإلكتروني");
    await page.locator("#forgotEmail").fill("ahmed@rasokh.test");
    await page.getByRole("button", { name: "ابعت الكود" }).click();
    await expect(page.locator("#forgotError")).toContainText("المشرف");
    await expect(page.locator("#resetCard")).toBeHidden();
    await page.getByRole("link", { name: "رجوع لتسجيل الدخول" }).last().click();
    await expect(page.locator("#loginCard")).toBeVisible();
  });

  test("فتح #reset من غير ما يطلب كود بيرجّع لشاشة الدخول", async ({ page }) => {
    await page.goto("/#reset");
    await expect(page.locator("#loginCard")).toBeVisible();
    await expect(page.locator("#resetCard")).toBeHidden();
  });

  test("زرار العين بيظهر كلمة المرور ويخفيها", async ({ page }) => {
    await page.goto("/");
    const pw = page.locator("#loginPassword");
    await pw.fill("secret123");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "إظهار كلمة المرور" }).first().click();
    await expect(pw).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "إخفاء كلمة المرور" }).first().click();
    await expect(pw).toHaveAttribute("type", "password");
  });
});
