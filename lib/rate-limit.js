// lib/rate-limit.js
// حد بسيط لعدد المحاولات (في الذاكرة) بدون مكتبات إضافية.

// عنوان العميل الحقيقي. ترويسات العنوان أي حد يقدر يكتبها بإيده، فبنصدّقها بس لما تيجي من بروكسي نعرفه:
// - cloudflared شغّال على نفس الجهاز (start.bat): الطلب بيوصل من 127.0.0.1، وCloudflare هو اللي بيحط cf-connecting-ip
// - استضافة ورا بروكسي (Hugging Face مثلاً): TRUST_PROXY=1، وبناخد آخر عنوان في x-forwarded-for لأن البروكسي هو اللي ضافه
// أي طلب تاني (من الشبكة مباشرة مثلاً) بياخد عنوان الاتصال نفسه وبنتجاهل الترويسات.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function clientIp(req) {
  const direct = req.socket.remoteAddress || "unknown";
  const cf = req.headers["cf-connecting-ip"];
  if (cf && LOOPBACK.has(direct)) return String(cf).trim();
  if (process.env.TRUST_PROXY === "1") {
    const hops = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return direct;
}

function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> { count, resetAt }

  // تنظيف دوري عشان الذاكرة ما تكبرش
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.min(windowMs, 60 * 1000)).unref();

  return {
    // هل الـ key ده تعدّى الحد؟ لو أيوه يرجّع عدد الدقايق الباقية
    blockedFor(key) {
      const v = hits.get(key);
      if (!v || v.resetAt <= Date.now()) return 0;
      return v.count >= max ? Math.ceil((v.resetAt - Date.now()) / 60000) : 0;
    },
    hit(key) {
      const now = Date.now();
      const v = hits.get(key);
      if (!v || v.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else v.count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { clientIp, createLimiter };
