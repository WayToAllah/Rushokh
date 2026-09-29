// lib/rate-limit.js
// حد بسيط لعدد المحاولات (في الذاكرة) بدون مكتبات إضافية.

// عنوان العميل الحقيقي. خلف Cloudflare Tunnel كل الطلبات بتيجي من 127.0.0.1،
// فبنستخدم الترويسة اللي Cloudflare بيضيفها لو موجودة.
function clientIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
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
