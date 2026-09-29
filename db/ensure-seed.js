// db/ensure-seed.js
// بيعبّي بيانات التجربة بس لو قاعدة البيانات فاضية خالص (أول تشغيل).
// لو فيها أي بيانات، ما بيلمسش حاجة.
//
// أول تشغيل ممكن يبقى على رابط عام على طول (start.bat مع Cloudflare، أو Docker)،
// فمفيش كلمة مرور معروفة ولا طالب تجريبي: المشرف بياخد ADMIN_EMAIL / ADMIN_PASSWORD لو موجودين،
// وإلا كلمة مرور عشوائية بتظهر هنا مرة واحدة بس.

const crypto = require("crypto");
const { seed, hasAnyData } = require("./seed");

if (hasAnyData()) {
  console.log("قاعدة البيانات فيها بيانات بالفعل، لن يتم تعديلها.");
} else {
  console.log("قاعدة البيانات فاضية (أول تشغيل)، جارٍ تعبئتها ببيانات التجربة...");
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@rasokh.test").trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD || "";
  if (envPassword && envPassword.length < 8) {
    console.warn("⚠️  ADMIN_PASSWORD أقصر من 8 أحرف، هيتم تجاهلها واستخدام كلمة مرور عشوائية.");
  }
  const fromEnv = envPassword.length >= 8;
  const adminPassword = fromEnv ? envPassword : crypto.randomBytes(9).toString("base64url");

  seed({ adminEmail, adminPassword, demoStudent: false });

  console.log("");
  console.log("================ حساب المشرف ================");
  console.log(`  البريد:        ${adminEmail}`);
  console.log(`  كلمة المرور:   ${fromEnv ? "(اللي في ADMIN_PASSWORD)" : adminPassword}`);
  console.log("  اكتبهم عندك دلوقتي. بعد ما تدخل، غيّر كلمة المرور أو ضيف حسابك من تبويب \"حسابي\".");
  console.log("=============================================");
  console.log("");
}
