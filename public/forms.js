// public/forms.js
// رسايل الخانات الناقصة أو الغلط بتصميم الموقع، بدل فقاعة المتصفح.
//   RasokhForms.guard(form, message => { صندوق الخطأ.textContent = message; ... });
// guard بيتحقق قبل أي كود تاني مربوط بإرسال الفورم، ولو فيه مشكلة بيوقف الإرسال، بيلوّن الخانات،
// وبيقول اسم الخانة (من الـ label بتاعها) وإيه الغلط فيها.

(function (global) {
  const style = document.createElement("style");
  style.textContent = `
    input.invalid, select.invalid, textarea.invalid{border-color:var(--terracotta, #A8503A);}
  `;
  document.head.appendChild(style);

  // اسم الخانة زي ما المستخدم شايفه: الـ label بتاعها من غير "(اختياري...)" و"*"
  function labelOf(el) {
    let label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
    if (!label) {
      let prev = el.previousElementSibling;
      if (!prev && el.parentElement && el.parentElement.classList.contains("pw-wrap")) prev = el.parentElement.previousElementSibling;
      if (prev && prev.tagName === "LABEL") label = prev;
    }
    if (!label) label = el.closest("label");
    const text = label ? label.childNodes[0].textContent : (el.placeholder || "");
    return text.replace(/\(.*?\)/g, "").replace(/\*/g, "").trim() || "الخانة";
  }

  function messageFor(bad) {
    const msgs = [];
    const missing = bad.filter(el => el.validity.valueMissing);
    const toFill = missing.filter(el => el.tagName !== "SELECT").map(labelOf);
    const toPick = missing.filter(el => el.tagName === "SELECT").map(labelOf);
    if (toFill.length === 1) msgs.push(`املأ خانة "${toFill[0]}".`);
    else if (toFill.length) msgs.push(`املأ الخانات دي: ${toFill.join("، ")}.`);
    if (toPick.length) msgs.push(`اختار ${toPick.join(" و")}.`);

    bad.filter(el => !el.validity.valueMissing).forEach(el => {
      const name = labelOf(el);
      const v = el.validity;
      if (el.dataset.invalidMsg) msgs.push(el.dataset.invalidMsg);
      else if (el.type === "email") msgs.push(`${name} مكتوب غلط.`);
      else if (el.type === "url") msgs.push(`${name} لازم يبدأ بـ http:// أو https://`);
      else if (v.tooShort) msgs.push(`${name} لازم تكون ${el.minLength} أحرف على الأقل.`);
      else if (v.badInput) msgs.push(`${name} لازم يكون رقم.`);
      else if (v.rangeUnderflow || v.rangeOverflow) {
        if (el.min !== "" && el.max !== "") msgs.push(`${name} لازم يكون بين ${el.min} و${el.max}.`);
        else if (el.min !== "") msgs.push(`${name} لازم يكون ${el.min} أو أكتر.`);
        else msgs.push(`${name} لازم يكون ${el.max} أو أقل.`);
      } else msgs.push(`${name} مكتوب غلط.`);
    });
    return msgs.join(" ");
  }

  // بيرجّع true لو الفورم سليم. غير كده بيعرض الرسالة ويحط التركيز على أول خانة فيها مشكلة.
  function check(form, showError) {
    const fields = [...form.querySelectorAll("input, select, textarea")].filter(el => el.willValidate);
    const bad = fields.filter(el => !el.checkValidity());
    fields.forEach(el => el.classList.toggle("invalid", bad.includes(el)));
    if (!bad.length) return true;
    showError(messageFor(bad));
    bad[0].focus();
    return false;
  }

  function guard(form, showError) {
    form.noValidate = true;
    // capture عشان يشتغل قبل أي كود إرسال تاني على نفس الفورم، وstopImmediatePropagation عشان يوقفه
    form.addEventListener("submit", e => {
      if (!check(form, showError)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    form.addEventListener("input", e => { if (e.target.classList) e.target.classList.remove("invalid"); });
    form.addEventListener("change", e => { if (e.target.classList) e.target.classList.remove("invalid"); });
  }

  global.RasokhForms = { check, guard, labelOf };
})(window);
