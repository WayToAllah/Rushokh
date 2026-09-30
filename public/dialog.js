// public/dialog.js
// نوافذ تأكيد وتنبيه بتصميم الموقع، بدل رسايل المتصفح الرمادي (confirm / alert).
//   if (!(await RasokhDialog.confirm("حذف السؤال؟", { title: "حذف", okText: "حذف", danger: true }))) return;
//   RasokhDialog.alert(err.message);
// النص بيتحط كنص عادي (textContent)، فمفيش خطر لو الرسالة جاية من السيرفر.

(function (global) {
  const style = document.createElement("style");
  style.textContent = `
    .rd-backdrop{
      position:fixed; inset:0; z-index:1000;
      background:rgba(14,20,18,.55);
      display:flex; align-items:center; justify-content:center; padding:16px;
      animation:rd-fade .15s ease-out;
    }
    .rd-box{
      width:100%; max-width:400px;
      background:var(--bg-raised, #FBF8EE); color:var(--ink, #1B2C28);
      border-radius:16px; border-top:4px solid var(--gold, #B9924F);
      box-shadow:0 30px 60px rgba(0,0,0,.3);
      padding:22px 24px 20px;
      font-family:inherit;
      animation:rd-pop .18s ease-out;
    }
    .rd-box.rd-danger{border-top-color:var(--terracotta, #A8503A);}
    .rd-title{font-family:'Amiri', serif; font-size:1.3rem; color:var(--teal-900, #0E332F); margin:0 0 6px;}
    .rd-danger .rd-title{color:var(--terracotta, #A8503A);}
    .rd-msg{margin:0; font-size:.92rem; line-height:1.9; color:var(--ink-soft, #4A5C56); white-space:pre-line;}
    .rd-actions{display:flex; gap:10px; margin-top:22px;}
    .rd-actions button{
      flex:1; padding:11px 14px; border-radius:8px;
      font-family:inherit; font-size:.9rem; font-weight:600; cursor:pointer;
      transition:background .15s ease;
    }
    .rd-ok{background:var(--teal-700, #1F5951); color:#fff; border:1px solid var(--teal-700, #1F5951);}
    .rd-ok:hover{background:var(--teal-900, #0E332F);}
    .rd-danger .rd-ok{background:var(--terracotta, #A8503A); border-color:var(--terracotta, #A8503A);}
    .rd-danger .rd-ok:hover{background:#8C3F2C;}
    .rd-cancel{background:transparent; color:var(--ink-soft, #4A5C56); border:1px solid var(--line, #DCD3B8);}
    .rd-cancel:hover{background:var(--line-soft, #E9E2CB);}
    .rd-actions button:focus-visible{outline:2px solid var(--gold, #B9924F); outline-offset:2px;}
    @keyframes rd-fade{from{opacity:0}}
    @keyframes rd-pop{from{opacity:0; transform:translateY(8px) scale(.98)}}
    @media (prefers-reduced-motion: reduce){ .rd-backdrop, .rd-box{animation:none;} }
  `;
  document.head.appendChild(style);

  let seq = 0;

  // بيرجّع Promise: true لو داس الزرار الأساسي، false لو لغى (زرار إلغاء، Esc، أو برّه النافذة)
  function open({ message, title, okText, cancelText, danger }) {
    return new Promise(resolve => {
      const id = "rd" + (++seq);
      const lastFocus = document.activeElement;

      const backdrop = document.createElement("div");
      backdrop.className = "rd-backdrop";
      const box = document.createElement("div");
      box.className = "rd-box" + (danger ? " rd-danger" : "");
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", id + "-t");
      box.setAttribute("aria-describedby", id + "-m");

      const h = document.createElement("h2");
      h.className = "rd-title";
      h.id = id + "-t";
      h.textContent = title;
      const p = document.createElement("p");
      p.className = "rd-msg";
      p.id = id + "-m";
      p.textContent = message;

      const actions = document.createElement("div");
      actions.className = "rd-actions";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "rd-ok";
      ok.textContent = okText;
      actions.appendChild(ok);
      let cancel = null;
      if (cancelText) {
        cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "rd-cancel";
        cancel.textContent = cancelText;
        actions.appendChild(cancel);
      }

      box.append(h, p, actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === "Tab") {
          // التنقل بـ Tab يفضل جوه النافذة
          const btns = [...actions.querySelectorAll("button")];
          const i = btns.indexOf(document.activeElement);
          e.preventDefault();
          btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
        }
      }
      ok.addEventListener("click", () => close(true));
      if (cancel) cancel.addEventListener("click", () => close(false));
      backdrop.addEventListener("click", e => { if (e.target === backdrop) close(false); });
      document.addEventListener("keydown", onKey, true);

      // في الحذف والحاجات الخطيرة، "إلغاء" هو اللي عليه التركيز عشان Enter بالغلط ما يمسحش حاجة
      (danger && cancel ? cancel : ok).focus();
    });
  }

  global.RasokhDialog = {
    confirm(message, opts = {}) {
      return open({
        message,
        title: opts.title || "تأكيد",
        okText: opts.okText || "تأكيد",
        cancelText: opts.cancelText || "إلغاء",
        danger: !!opts.danger,
      });
    },
    alert(message, opts = {}) {
      return open({ message, title: opts.title || "تنبيه", okText: opts.okText || "حسنًا" }).then(() => undefined);
    },
  };
})(window);
