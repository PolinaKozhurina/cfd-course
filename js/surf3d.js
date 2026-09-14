/* Интерактивные диссипативные и дисперсионные поверхности разностных схем
 * (в духе атласа Головизнина–Соловьёва). Чистый canvas, без библиотек.
 *
 * Подключение: <div class="surf3d" data-scheme="upwind" data-kind="diss"></div>
 *              <script src="../js/surf3d.js"></script>
 * Поверхность z = |q(r, kh)| («диссипация») или z = γ(r, kh) = arg q/(r·kh) («дисперсия»)
 * над прямоугольником r ∈ [0, r_max], kh ∈ [−π, π]. Мышью — вращение; выпадающие
 * списки — выбор схемы и величины.
 */
(function () {
  "use strict";
  var PI = Math.PI;
  function C(re, im) { return { re: re, im: im }; }
  function cexp(w) { return C(Math.cos(w), Math.sin(w)); }
  function cmul(a, b) { return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cadd(a, b) { return C(a.re + b.re, a.im + b.im); }
  function csub(a, b) { return C(a.re - b.re, a.im - b.im); }
  function cscale(a, s) { return C(a.re * s, a.im * s); }
  function cinv(a) { var d = a.re * a.re + a.im * a.im; return C(a.re / d, -a.im / d); }
  function cabs(a) { return Math.hypot(a.re, a.im); }
  function carg(a) { return Math.atan2(a.im, a.re); }
  function csqrt(a) { var m = cabs(a), r = Math.sqrt((m + a.re) / 2), i = Math.sqrt(Math.max(0, (m - a.re) / 2)); return C(r, a.im < 0 ? -i : i); }

  /* соглашение атласа: u_j^n = q^n e^{-i kh j}; узел (j+p, n+m) → q^m e^{-i kh p} */
  var SCHEMES = {
    upwind:   { name: "явный «уголок» (A)", rmax: 1, q: function (r, w) { return cadd(C(1 - r, 0), cscale(cexp(w), r)); } },
    implicit: { name: "неявный «уголок» (B)", rmax: 2, q: function (r, w) { return cinv(csub(C(1 + r, 0), cscale(cexp(w), r))); } },
    central:  { name: "явная центральная (F) — неустойчива", rmax: 1, q: function (r, w) { return C(1, r * Math.sin(w)); } },
    lw:       { name: "Лакс–Вендрофф", rmax: 1, q: function (r, w) { return C(1 - r * r * (1 - Math.cos(w)), r * Math.sin(w)); } },
    bw:       { name: "Бим–Уорминг", rmax: 2, q: function (r, w) {
                  var E = cexp(w), E2 = cmul(E, E);
                  var a = cadd(cadd(C(3, 0), cscale(E, -4)), E2);       // 3 − 4E + E²
                  var b = cadd(cadd(C(1, 0), cscale(E, -2)), E2);       // 1 − 2E + E²
                  return cadd(cadd(C(1, 0), cscale(a, -r / 2)), cscale(b, r * r / 2)); } },
    leapfrog: { name: "«крест» (реальный корень)", rmax: 1, q: function (r, w) {
                  var s = r * Math.sin(w); return cadd(C(0, s), csqrt(C(1 - s * s, 0))); } },
    leapfrog2:{ name: "«крест» (паразитный корень)", rmax: 1, parasitic: true, q: function (r, w) {
                  var s = r * Math.sin(w); return csub(C(0, s), csqrt(C(1 - s * s, 0))); } }
  };

  function surfaceData(key, kind, nr, nw) {
    var S = SCHEMES[key], Z = [], zmin = 0, zmax = kind === "diss" ? 1.05 : 1.5;
    if (key === "central" && kind === "diss") zmax = 1.5;
    if (S.parasitic && kind === "disp") { zmin = -1.5; zmax = 0.5; }
    for (var i = 0; i <= nr; i++) {
      var r = S.rmax * i / nr, row = new Array(nw + 1);
      if (kind === "diss") {
        for (var j = 0; j <= nw; j++) row[j] = Math.min(zmax, cabs(S.q(r, -PI + 2 * PI * j / nw)));
      } else {
        /* непрерывный аргумент: от kh = 0 в обе стороны */
        var j0 = nw / 2, base = S.parasitic ? PI : 0, args = new Array(nw + 1), prev, v, j;
        prev = carg(S.q(r, 0)) - base; prev = ((prev + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI; args[j0] = prev;
        for (j = j0 + 1; j <= nw; j++) { v = carg(S.q(r, -PI + 2 * PI * j / nw)) - base; while (v - prev > PI) v -= 2 * PI; while (v - prev < -PI) v += 2 * PI; args[j] = v; prev = v; }
        prev = args[j0];
        for (j = j0 - 1; j >= 0; j--) { v = carg(S.q(r, -PI + 2 * PI * j / nw)) - base; while (v - prev > PI) v -= 2 * PI; while (v - prev < -PI) v += 2 * PI; args[j] = v; prev = v; }
        for (j = 0; j <= nw; j++) { var w = -PI + 2 * PI * j / nw; var g = (Math.abs(w) < 1e-9 || r < 1e-9) ? 1 : args[j] / (r * w); row[j] = Math.max(zmin, Math.min(zmax, g)); }
      }
      Z.push(row);
    }
    return { Z: Z, zmin: zmin, zmax: zmax, rmax: S.rmax };
  }

  function lerp(c1, c2, t) { t = Math.max(0, Math.min(1, t)); return "rgb(" + Math.round(c1[0] + (c2[0] - c1[0]) * t) + "," + Math.round(c1[1] + (c2[1] - c1[1]) * t) + "," + Math.round(c1[2] + (c2[2] - c1[2]) * t) + ")"; }

  function mount(el) {
    var key = el.getAttribute("data-scheme") || "upwind", kind = el.getAttribute("data-kind") || "diss";
    var nr = 26, nw = 36, az = -0.62, elv = 0.50, dragging = false, lx = 0, ly = 0;
    el.innerHTML = "";
    el.style.cssText += ";border:1px solid var(--border,#d9cfc0);border-radius:8px;padding:.6rem;background:var(--bg2,#f5f0e8)";
    var bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:.4rem;font-family:'JetBrains Mono',monospace;font-size:.75rem";
    var selS = document.createElement("select"), selK = document.createElement("select");
    Object.keys(SCHEMES).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = SCHEMES[k].name; if (k === key) o.selected = true; selS.appendChild(o); });
    [["diss", "диссипация: |q(r, kh)|"], ["disp", "дисперсия: γ(r, kh) = arg q / (r·kh)"]].forEach(function (p) { var o = document.createElement("option"); o.value = p[0]; o.textContent = p[1]; if (p[0] === kind) o.selected = true; selK.appendChild(o); });
    [selS, selK].forEach(function (s) { s.style.cssText = "font-family:inherit;font-size:inherit;padding:3px 6px;border:1px solid var(--border,#d9cfc0);border-radius:4px;background:#fff;color:#2c2419"; });
    var hint = document.createElement("span"); hint.textContent = "перетаскивайте мышью, чтобы повернуть"; hint.style.color = "#9a8d7e";
    bar.appendChild(selS); bar.appendChild(selK); bar.appendChild(hint); el.appendChild(bar);
    var cv = document.createElement("canvas"); cv.style.cssText = "width:100%;height:auto;display:block;background:#fff;border-radius:6px;cursor:grab;touch-action:none"; el.appendChild(cv);
    var data;
    function rebuild() { key = selS.value; kind = selK.value; data = surfaceData(key, kind, nr, nw); draw(); }
    function draw() {
      var W = 900, H = 600; cv.width = W; cv.height = H; var ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      var Z = data.Z, zlo = data.zmin, zhi = data.zmax, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(elv), se = Math.sin(elv);
      function proj(x, y, z) { /* x,y ∈ [0,1]; z нормирован в [0,0.6] */
        var zz = (z - zlo) / (zhi - zlo) * 0.6, X = (x - 0.5) * ca - (y - 0.5) * sa, Y = (x - 0.5) * sa + (y - 0.5) * ca;
        var sx = W * 0.5, sy = W * 0.5;
        return [W / 2 + sx * X, H * 0.56 - sy * (Y * se + (zz - 0.3) * ce)];
      }
      function depth(x, y) { return (x - 0.5) * sa + (y - 0.5) * ca; }
      var pal = kind === "diss" ? [[31, 95, 82], [243, 239, 228]] : [[45, 74, 134], [241, 238, 230]];
      // бокс сзади
      ctx.strokeStyle = "#c9bfae"; ctx.lineWidth = 1;
      var corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      ctx.beginPath();
      corners.forEach(function (c, i) { var n = corners[(i + 1) % 4]; var a = proj(c[0], c[1], zlo), b = proj(n[0], n[1], zlo); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); var a2 = proj(c[0], c[1], zhi), b2 = proj(n[0], n[1], zhi); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(a2[0], a2[1]); });
      ctx.stroke();
      // грани
      var faces = [];
      for (var i = 0; i < nr; i++) for (var j = 0; j < nw; j++) {
        var x = (2 * i + 1) / (2 * nr), y = (2 * j + 1) / (2 * nw);
        faces.push([depth(x, y), i, j]);
      }
      faces.sort(function (a, b) { return b[0] - a[0]; });
      faces.forEach(function (f) {
        var i = f[1], j = f[2], pts = [[i / nr, j / nw, Z[i][j]], [(i + 1) / nr, j / nw, Z[i + 1][j]], [(i + 1) / nr, (j + 1) / nw, Z[i + 1][j + 1]], [i / nr, (j + 1) / nw, Z[i][j + 1]]];
        var zm = (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4;
        ctx.beginPath(); pts.forEach(function (p, k) { var s = proj(p[0], p[1], p[2]); if (k) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }); ctx.closePath();
        ctx.fillStyle = lerp(pal[0], pal[1], (zm - zlo) / (zhi - zlo)); ctx.fill(); ctx.strokeStyle = "rgba(46,74,66,.5)"; ctx.lineWidth = .5; ctx.stroke();
      });
      // плоскость z = 1
      if (zlo < 1 && 1 < zhi) { ctx.beginPath(); corners.forEach(function (c, k) { var s = proj(c[0], c[1], 1); if (k) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }); ctx.closePath(); ctx.fillStyle = "rgba(107,93,79,.22)"; ctx.fill(); ctx.strokeStyle = "#6b5d4f"; ctx.lineWidth = 1; ctx.stroke(); }
      // подписи
      ctx.fillStyle = "#2c2419"; ctx.font = "15px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      var rt = data.rmax === 1 ? [0, 0.5, 1] : [0, 0.5, 1, 1.5, 2];
      rt.forEach(function (v) { var s = proj(v / data.rmax, 0, zlo); ctx.fillText(String(v), s[0], s[1] + 18); });
      var s = proj(0.5, -0.12, zlo); ctx.font = "italic 17px 'Source Serif 4', serif"; ctx.fillText("r = cτ/h", s[0], s[1] + 22);
      ctx.font = "15px 'JetBrains Mono', monospace"; ctx.textAlign = "left";
      [[0, "−π"], [0.5, "0"], [1, "π"]].forEach(function (p) { var s = proj(1, p[0], zlo); ctx.fillText(p[1], s[0] + 8, s[1] + 5); });
      s = proj(1.1, 0.5, zlo); ctx.font = "italic 17px 'Source Serif 4', serif"; ctx.fillText("kh", s[0] + 8, s[1] + 5);
      ctx.textAlign = "right"; ctx.font = "15px 'JetBrains Mono', monospace";
      var zt = kind === "diss" ? [0, 0.5, 1] : (zlo < 0 ? [-1.5, -1, -0.5, 0, 0.5] : [0, 0.5, 1, 1.5]);
      zt.forEach(function (v) { var s = proj(0, 0, v); ctx.fillText(String(v), s[0] - 8, s[1] + 5); });
      s = proj(0, 0, zhi); ctx.font = "italic 17px 'Source Serif 4', serif"; ctx.fillText(kind === "diss" ? "|q|" : "γ", s[0] - 8, s[1] - 8);
      ctx.textAlign = "left"; ctx.font = "600 16px 'Source Serif 4', serif"; ctx.fillText((kind === "diss" ? "диссипативная поверхность — " : "дисперсионная поверхность — ") + SCHEMES[key].name, 14, 24);
    }
    selS.addEventListener("change", rebuild); selK.addEventListener("change", rebuild);
    cv.addEventListener("pointerdown", function (e) { dragging = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
    cv.addEventListener("pointermove", function (e) { if (!dragging) return; az += (e.clientX - lx) * 0.01; elv = Math.max(0.05, Math.min(1.4, elv + (e.clientY - ly) * 0.01)); lx = e.clientX; ly = e.clientY; draw(); });
    cv.addEventListener("pointerup", function () { dragging = false; cv.style.cursor = "grab"; });
    rebuild();
  }
  function init() { document.querySelectorAll(".surf3d").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
