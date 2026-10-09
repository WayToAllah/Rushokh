// بحث عربي بسيط: التشكيل والهمزات والتاء المربوطة والألف المقصورة ما بتفرقش
(function (global) {
  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }
  // كل كلمات البحث لازم تكون موجودة (بأي ترتيب)
  function matches(text, query) {
    const t = norm(text);
    return norm(query).split(" ").filter(Boolean).every(w => t.includes(w));
  }
  global.RasokhSearch = { norm, matches };
})(window);
