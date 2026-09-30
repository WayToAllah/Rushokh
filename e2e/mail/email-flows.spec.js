// تأكيد البريد ونسيت كلمة المرور من الواجهة، مع سيرفر إيميل وهمي
const { test, expect, uniqueEmail, mailboxCode } = require("../helpers");

// طالب متأكد بريده، متعمل من الـ API
async function verifiedStudent(request) {
  const email = uniqueEmail("mail");
  const r = await request.post("/api/auth/register", { data: { full_name: "طالب إيميل", email, password: "old-password" } });
  expect((await r.json()).needs_verification).toBe(true);
  const code = await mailboxCode(email, "verify");
  expect((await request.post("/api/auth/verify-email", { data: { email, code } })).status()).toBe(200);
  return email;
}

test.describe("تأكيد البريد", () => {
  test("التسجيل بيفتح شاشة الكود، والكود الصح بيدخّل صفحة الطالب", async ({ page }) => {
    const email = uniqueEmail("signup");
    await page.goto("/#register");
    await page.locator("#regName").fill("طالب جديد");
    await page.locator("#regEmail").fill(email);
    await page.locator("#regPassword").fill("password123");
    await page.getByRole("button", { name: "تسجيل", exact: true }).click();
    await expect(page.locator("#verifyCard")).toBeVisible();
    await expect(page.locator("#verifyEmail")).toHaveText(email);
    await expect(page.locator("#resendBtn")).toBeDisabled();

    await page.locator("#verifyCode").fill("000000");
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    const code = await mailboxCode(email, "verify");
    if (code !== "000000") await expect(page.locator("#verifyError")).toContainText("فاضل 4");

    await page.locator("#verifyCode").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(page.locator("#verifyCode")).toHaveValue(code);
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(page).toHaveURL(/student\.html/);
  });
});

test.describe("نسيت كلمة المرور", () => {
  test("من الدخول لكلمة مرور جديدة، والدخول بالقديمة مابقاش شغال", async ({ page, request }) => {
    const email = await verifiedStudent(request);
    await page.goto("/");
    await page.locator("#loginEmail").fill(email);
    await page.getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
    await expect(page.locator("#forgotCard")).toBeVisible();
    await expect(page.locator("#forgotEmail")).toHaveValue(email, { timeout: 2000 });
    await page.getByRole("button", { name: "ابعت الكود" }).click();

    await expect(page.locator("#resetCard")).toBeVisible();
    await expect(page.locator("#resetEmail")).toHaveText(email);
    await expect(page.locator("#resetResendBtn")).toBeDisabled();
    const code = await mailboxCode(email, "reset");

    await page.locator("#resetCode").fill(code);
    await page.locator("#resetPassword").fill("brand-new-pass");
    await page.getByRole("button", { name: "غيّر كلمة المرور" }).click();
    await expect(page).toHaveURL(/student\.html/);

    expect((await request.post("/api/auth/login", { data: { email, password: "old-password" } })).status()).toBe(401);
    expect((await request.post("/api/auth/login", { data: { email, password: "brand-new-pass" } })).status()).toBe(200);
  });

  test("كود غلط وكلمة مرور قصيرة ليهم رسايل واضحة", async ({ page, request }) => {
    const email = await verifiedStudent(request);
    await page.goto("/#forgot");
    await page.locator("#forgotEmail").fill(email);
    await page.getByRole("button", { name: "ابعت الكود" }).click();
    const code = await mailboxCode(email, "reset");

    await page.locator("#resetCode").fill(code);
    await page.locator("#resetPassword").fill("123");
    await page.getByRole("button", { name: "غيّر كلمة المرور" }).click();
    await expect(page.locator("#resetError")).toContainText("8 أحرف");

    const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
    await page.locator("#resetCode").fill(wrong);
    await page.locator("#resetPassword").fill("long-enough-pass");
    await page.getByRole("button", { name: "غيّر كلمة المرور" }).click();
    await expect(page.locator("#resetError")).toContainText("فاضل 4");
    await expect(page).toHaveURL(/#reset$/);
  });
});
