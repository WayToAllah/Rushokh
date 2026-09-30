// e2e/helpers.js — اختصارات مشتركة لاختبارات المتصفح
const crypto = require("crypto");
const base = require("@playwright/test");
const { expect } = base;

// الموقع بيحدّد عدد التسجيلات ومحاولات الدخول لكل جهاز، وكل الاختبارات جاية من نفس الجهاز.
// فكل اختبار بيظهر كأنه جهاز مختلف، بنفس الترويسة اللي cloudflared بيبعتها (والسيرفر بيصدّقها من 127.0.0.1 بس).
const fakeDeviceIp = () => `10.${crypto.randomInt(1, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;

const test = base.test.extend({
  page: async ({ page }, use) => {
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": fakeDeviceIp() });
    await use(page);
  },
  request: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "cf-connecting-ip": fakeDeviceIp() } });
    await use(ctx);
    await ctx.dispose();
  },
});

let n = 0;
const uniqueEmail = prefix => `${prefix}${Date.now()}_${++n}@e2e.test`;

// تسجيل حساب طالب من الـ API مباشرة (أسرع)، بيرجّع { email, password, token }
async function apiRegister(request, fullName = "طالب متصفح") {
  const email = uniqueEmail("student");
  const password = "password123";
  const r = await request.post("/api/auth/register", { data: { full_name: fullName, email, password } });
  expect(r.status()).toBe(201);
  return { email, password, token: (await r.json()).token };
}

async function apiLogin(request, email, password) {
  const r = await request.post("/api/auth/login", { data: { email, password } });
  expect(r.status()).toBe(200);
  return (await r.json()).token;
}

// الدخول من الصفحة الرئيسية زي المستخدم بالظبط
async function loginViaUi(page, email, password) {
  await page.goto("/");
  await page.getByLabel("البريد الإلكتروني").first().fill(email);
  await page.locator("#loginPassword").fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
}

// آخر كود وصل لبريد في سيرفر الإيميل الوهمي (مشروع "mail" بس). kind: "verify" أو "reset"
const MAILBOX_URL = "http://127.0.0.1:4196";
async function mailboxCode(email, kind = "verify", previous = null) {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${MAILBOX_URL}/code?to=${encodeURIComponent(email)}&kind=${kind}`);
    const { code } = await r.json();
    if (code && code !== previous) return code;
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error(`مفيش كود ${kind} وصل لـ ${email}`);
}

// مفيش سكرول بالعرض (الصفحة مش خارجة برّه الشاشة)
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

module.exports = { test, expect, uniqueEmail, apiRegister, apiLogin, loginViaUi, mailboxCode, expectNoHorizontalScroll };
