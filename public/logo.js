// اللوجو: لو فيه ملف public/logo.png بيظهر مكان كلمة "رسوخ" في الهيدر والختم، ولو مش موجود بيفضل الاسم زي ما هو.
// عشان تحط اللوجو: ارفع صورة باسم logo.png (يفضّل خلفية شفافة) في فولدر public على GitHub.
(function () {
  const img = new Image();
  img.onload = function () {
    document.querySelectorAll("[data-logo]").forEach(function (el) {
      const logo = document.createElement("img");
      logo.src = img.src;
      logo.alt = "رسوخ";
      logo.className = "site-logo";
      el.replaceWith(logo);
    });
    document.querySelectorAll(".seal-mark").forEach(function (el) { el.classList.add("has-logo"); });
  };
  img.src = "/logo.png";
})();
