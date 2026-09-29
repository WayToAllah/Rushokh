// public/password-eye.js
// زرار عين جنب كل خانة كلمة مرور: يظهر/يخفي اللي اتكتب.
// الإظهار بيحصل في متصفح الشخص نفسه بس، ومفيش أي حاجة زيادة بتتبعت للسيرفر.

(function () {
  const ICON_SHOW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_HIDE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const style = document.createElement("style");
  style.textContent = `
    .pw-wrap{position:relative; display:block;}
    .pw-wrap > input{display:block;}
    .pw-eye{
      position:absolute; top:0; bottom:0; inset-inline-end:4px;
      width:36px; padding:0; border:none; background:none; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      color:var(--ink-soft, #4A5C56); opacity:.7;
    }
    .pw-eye:hover, .pw-eye[aria-pressed="true"]{opacity:1;}
    input::-ms-reveal{display:none;} /* Edge بيحط عين من عنده، نشيلها عشان ما يبقاش فيه اتنين */
  `;
  document.head.appendChild(style);

  function enhance(input) {
    if (input.dataset.eye) return;
    input.dataset.eye = "1";

    // الغلاف بياخد هوامش الخانة، عشان الزرار يتوسّط الخانة نفسها والتصميم ما يتغيرش
    const cs = getComputedStyle(input);
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    wrap.style.margin = `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`;
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.margin = "0";
    input.style.paddingInlineEnd = "42px";

    const btn = document.createElement("button");
    btn.type = "button"; // مهم: من غير كده الزرار يبعت الفورم
    btn.className = "pw-eye";
    wrap.appendChild(btn);

    function set(show) {
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? ICON_HIDE : ICON_SHOW;
      const label = show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور";
      btn.setAttribute("aria-label", label);
      btn.title = label;
      btn.setAttribute("aria-pressed", String(show));
    }
    set(false);
    btn.addEventListener("click", () => set(input.type === "password"));

    // يرجع مخفي عند الإرسال، عشان المتصفح يعرض حفظ كلمة المرور عادي
    if (input.form) input.form.addEventListener("submit", () => set(false), true);
  }

  function run() {
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
