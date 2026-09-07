// Обнаружение свежего деплоя сайта, пока вкладка открыта.
// Страница админки/профиля может жить во вкладке сутками: JS в ней остаётся
// старым, даже если сайт уже обновился. Здесь при возврате во вкладку
// (не чаще раза в минуту) делаем HEAD текущей страницы и сравниваем ETag
// с тем, что был при загрузке. Если отличается — плашка «перезагрузите».
(function () {
  "use strict";
  var startTag = null, lastCheck = 0, shown = false;
  function head() {
    return fetch(location.pathname + "?_=" + Date.now(), { method: "HEAD", cache: "no-store" })
      .then(function (r) { return r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : null; })
      .catch(function () { return null; });
  }
  function toast() {
    if (shown) return; shown = true;
    var d = document.createElement("div");
    d.setAttribute("role", "status");
    d.style.cssText = "position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);z-index:2147483600;" +
      "background:#3a2f1a;color:#fff;padding:.6rem .9rem;border-radius:8px;font:14px/1.35 system-ui,sans-serif;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:.7rem;align-items:center;max-width:92vw";
    d.innerHTML = "<span>Сайт обновился. Чтобы работать с новой версией, перезагрузите страницу.</span>" +
      "<button type=\"button\" style=\"background:#fff;color:#3a2f1a;border:0;border-radius:6px;padding:.35rem .7rem;cursor:pointer;font:inherit;font-weight:600\">Перезагрузить</button>";
    d.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  function check() {
    var now = Date.now();
    if (now - lastCheck < 60 * 1000) return;
    lastCheck = now;
    head().then(function (tag) {
      if (tag == null) return;
      if (startTag == null) { startTag = tag; return; }
      if (tag !== startTag) toast();
    });
  }
  if (typeof fetch !== "function") return;
  head().then(function (tag) { if (tag) startTag = tag; lastCheck = Date.now(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
  window.addEventListener("focus", check);
  setInterval(check, 10 * 60 * 1000);
})();
