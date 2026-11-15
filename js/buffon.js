// Анимация задачи Бюффона (ЧМ §8.5): иглы на расчерченной плоскости, пространство исходов (θ, y)
// и сходимость оценки π ≈ 2N/n. Подключение: <div class="buffon-anim"></div> + <script src="../js/buffon.js" defer>.
// Игла длины l = a (шаг прямых). Пересечение: y ≤ (l/2) sin θ, где y — расстояние от середины до ближайшей прямой.
(function () {
  'use strict';
  var PI = Math.PI, P = 2 / PI, SIGREL = Math.sqrt((1 - P) / P);   // относительное отклонение одного броска для оценки π
  var CSS = '.buffon-anim{border:1px solid var(--border);border-radius:8px;background:var(--bg2);padding:.55rem .7rem .5rem;margin:.8rem 0;font-size:.9rem}' +
    '.buffon-anim .bf-ctl{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-bottom:.45rem}' +
    '.buffon-anim button,.buffon-anim select{font-family:"JetBrains Mono",monospace;font-size:.74rem;padding:.28rem .6rem;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);cursor:pointer}' +
    '.buffon-anim button.bf-main{border-color:var(--accent);color:var(--accent);font-weight:600}' +
    '.buffon-anim .bf-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}' +
    '.buffon-anim .bf-cell{display:flex;flex-direction:column;align-items:center;min-width:0}' +
    '.buffon-anim .bf-ttl{font-weight:600;font-size:.8rem;color:var(--text);margin-bottom:.15rem;text-align:center}' +
    '.buffon-anim canvas{width:100%;height:auto;display:block;background:var(--bg);border-radius:4px}' +
    '.buffon-anim .bf-stat{margin-top:.45rem;font-family:"JetBrains Mono",monospace;font-size:.76rem;color:var(--text);line-height:1.5}' +
    '.buffon-anim .bf-last{font-family:"JetBrains Mono",monospace;font-size:.74rem;color:var(--text2);min-height:1.2em}' +
    '@media (max-width:700px){.buffon-anim .bf-row{grid-template-columns:1fr}}';

  function fmt(x, d) { return x.toFixed(d).replace('.', ','); }
  function col(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  }

  function Widget(root) {
    root.innerHTML =
      '<div class="bf-ctl">' +
      '<button class="bf-main" type="button">▶ Бросать</button>' +
      '<button class="bf-one" type="button">+1 игла</button>' +
      '<button class="bf-reset" type="button">Сброс</button>' +
      '<select class="bf-speed" aria-label="Скорость">' +
      '<option value="slow" selected>по одной, с разбором</option>' +
      '<option value="1">60 игл в секунду</option>' +
      '<option value="50">3 000 игл в секунду</option>' +
      '<option value="2000">120 000 игл в секунду</option></select>' +
      '</div>' +
      '<div class="bf-row">' +
      '<div class="bf-cell"><div class="bf-ttl">бросание иглы, l = a</div><canvas class="bf-a" width="380" height="250"></canvas></div>' +
      '<div class="bf-cell"><div class="bf-ttl">пространство исходов (θ, y)</div><canvas class="bf-b" width="380" height="250"></canvas></div>' +
      '<div class="bf-cell"><div class="bf-ttl">оценка π = 2N / n</div><canvas class="bf-c" width="380" height="250"></canvas></div>' +
      '</div>' +
      '<div class="bf-last"></div><div class="bf-stat"></div>';
    this.root = root;
    this.ca = root.querySelector('.bf-a'); this.cb = root.querySelector('.bf-b'); this.cc = root.querySelector('.bf-c');
    this.stat = root.querySelector('.bf-stat'); this.last = root.querySelector('.bf-last');
    this.btn = root.querySelector('.bf-main'); this.speed = root.querySelector('.bf-speed');
    var self = this;
    this.btn.addEventListener('click', function (e) { e.stopPropagation(); self.toggle(); });
    root.querySelector('.bf-one').addEventListener('click', function (e) { e.stopPropagation(); self.pause(); self.throwOne(true); self.draw(); });
    root.querySelector('.bf-reset').addEventListener('click', function (e) { e.stopPropagation(); self.pause(); self.reset(); });
    this.speed.addEventListener('change', function (e) { e.stopPropagation(); if (self.running) { self.pause(); self.play(); } });
    root.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter' || /^Arrow/.test(e.key)) e.stopPropagation(); });
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    this.reset();
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(root);
    new MutationObserver(function () { self.draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  Widget.prototype.reset = function () {
    this.N = 0; this.n = 0; this.needles = []; this.pts = []; this.hist = []; this.lastN = null;
    this.last.textContent = 'Нажмите «▶ Бросать» или «+1 игла». В режиме «по одной» для каждой иглы показаны y и θ.';
    this.draw();
  };

  // Один бросок. Координаты на плоскости — в единицах a; прямые y = 0, 1, 2, 3, 4, поле [0, 4.4] × [0, 4].
  Widget.prototype.throwOne = function (keep) {
    var cx = 0.25 + Math.random() * 3.9, cy = Math.random() * 4, th = Math.random() * PI;
    var fr = cy - Math.floor(cy), d = Math.min(fr, 1 - fr), near = fr < 0.5 ? Math.floor(cy) : Math.floor(cy) + 1;
    var hit = d <= 0.5 * Math.sin(th);
    this.N++; if (hit) this.n++;
    var nd = { cx: cx, cy: cy, th: th, d: d, near: near, hit: hit };
    this.needles.push(nd); if (this.needles.length > 150) this.needles.shift();
    if (this.pts.length < 6000) this.pts.push(nd);
    var N = this.N;
    if (this.n > 0 && (N <= 200 || N % Math.max(1, Math.floor(N / 200)) === 0)) this.hist.push([N, 2 * N / this.n]);
    this.lastN = nd;
    return nd;
  };

  Widget.prototype.toggle = function () { if (this.running) this.pause(); else this.play(); };
  Widget.prototype.pause = function () {
    this.running = false; this.btn.textContent = '▶ Бросать';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };
  Widget.prototype.play = function () {
    var self = this; this.running = true; this.btn.textContent = '⏸ Пауза';
    var mode = this.speed.value;
    if (mode === 'slow') {
      var step = function () { if (!self.running) return; self.throwOne(true); self.draw(); self.timer = setTimeout(step, 1100); };
      step();
    } else {
      var k = parseInt(mode, 10);
      var frame = function () {
        if (!self.running) return;
        for (var i = 0; i < k; i++) self.throwOne(false);
        self.draw();
        if (self.N >= 2000000) { self.pause(); return; }
        self.raf = requestAnimationFrame(frame);
      };
      frame();
    }
  };

  function prep(cv) {
    var w = cv.clientWidth || 380, h = Math.round(w * 250 / 380), r = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
    var g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
    return { g: g, w: w, h: h };
  }

  Widget.prototype.draw = function () {
    var C = { ink: col('--text', '#2c2419'), mute: col('--text3', '#9a8d7e'), mute2: col('--text2', '#6b5d4f'), hit: col('--accent', '#b44a2d'),
      miss: col('--accent3', '#3a5ba0'), grn: col('--accent2', '#1a6b5a'), bg3: col('--bg3', '#ede6da') };
    var slow = this.speed.value === 'slow', L = this.lastN;
    // ---- 1. плоскость
    var A = prep(this.ca), g = A.g, s = Math.min((A.w - 16) / 4.4, (A.h - 16) / 4.3), ox = (A.w - 4.4 * s) / 2, oy = (A.h - 4 * s) / 2;
    var X = function (u) { return ox + u * s; }, Y = function (v) { return oy + v * s; };
    g.strokeStyle = C.mute; g.lineWidth = 1.3;
    for (var k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(X(0), Y(k)); g.lineTo(X(4.4), Y(k)); g.stroke(); }
    var nn = this.needles, lw = nn.length > 60 ? 1.4 : 2;
    for (var i = 0; i < nn.length; i++) {
      var q = nn[i], dx = 0.5 * Math.cos(q.th), dy = 0.5 * Math.sin(q.th), last = (q === L && slow);
      g.globalAlpha = last ? 1 : (slow ? 0.55 : 0.7);
      g.strokeStyle = q.hit ? C.hit : C.miss; g.lineWidth = last ? 3.2 : lw;
      g.beginPath(); g.moveTo(X(q.cx - dx), Y(q.cy + dy)); g.lineTo(X(q.cx + dx), Y(q.cy - dy)); g.stroke();
    }
    g.globalAlpha = 1;
    if (slow && L) {     // разбор последней иглы: середина, расстояние y до ближайшей прямой, угол θ
      g.fillStyle = C.ink; g.beginPath(); g.arc(X(L.cx), Y(L.cy), 3.5, 0, 2 * PI); g.fill();
      g.setLineDash([4, 3]); g.strokeStyle = C.grn; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(L.cx), Y(L.cy)); g.lineTo(X(L.cx), Y(L.near)); g.stroke();
      g.beginPath(); g.moveTo(X(L.cx), Y(L.cy)); g.lineTo(X(L.cx) + 30, Y(L.cy)); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(X(L.cx), Y(L.cy), 18, -L.th, 0); g.stroke();
      g.fillStyle = C.grn; g.font = 'italic 14px Georgia,serif';
      g.fillText('y', X(L.cx) - 12, (Y(L.cy) + Y(L.near)) / 2 + 5); g.fillText('θ', X(L.cx) + 21, Y(L.cy) - 6);
    }
    // ---- 2. пространство исходов
    var B = prep(this.cb); g = B.g;
    var bx = 34, by = 10, bw = B.w - 46, bh = B.h - 36;
    var TX = function (t) { return bx + t / PI * bw; }, TY = function (v) { return by + bh - v / 0.5 * bh; };
    g.fillStyle = C.bg3; g.beginPath(); g.moveTo(TX(0), TY(0));
    for (var j = 0; j <= 80; j++) { var t = PI * j / 80; g.lineTo(TX(t), TY(0.5 * Math.sin(t))); }
    g.closePath(); g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
    var pts = this.pts, r = pts.length > 1500 ? 1.1 : (pts.length > 300 ? 1.6 : 2.6);
    for (i = 0; i < pts.length; i++) {
      q = pts[i]; g.fillStyle = q.hit ? C.hit : C.miss;
      g.fillRect(TX(q.th) - r, TY(q.d) - r, 2 * r, 2 * r);
    }
    g.strokeStyle = C.hit; g.lineWidth = 1.8; g.beginPath();
    for (j = 0; j <= 80; j++) { t = PI * j / 80; if (j) g.lineTo(TX(t), TY(0.5 * Math.sin(t))); else g.moveTo(TX(t), TY(0)); }
    g.stroke();
    g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    g.fillStyle = C.ink; g.font = '12px Georgia,serif';
    g.fillText('0', bx - 3, by + bh + 14); g.fillText('π', bx + bw - 4, by + bh + 14); g.fillText('θ', bx + bw / 2, by + bh + 16);
    g.fillText('a/2', 4, by + 10); g.fillText('y', 14, by + bh / 2);
    g.font = 'italic 12px Georgia,serif'; var lab = 'y = (l/2) sin θ', lw2 = g.measureText(lab).width, lx = bx + bw - lw2 - 6, ly = by + 16;
    g.fillStyle = col('--bg', '#faf8f4'); g.globalAlpha = 0.9; g.fillRect(lx - 3, ly - 12, lw2 + 6, 16); g.globalAlpha = 1;
    g.fillStyle = C.hit; g.fillText(lab, lx, ly);
    if (slow && L) {
      g.strokeStyle = C.grn; g.setLineDash([4, 3]); g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(TX(L.th), TY(0)); g.lineTo(TX(L.th), TY(L.d)); g.lineTo(TX(0), TY(L.d)); g.stroke(); g.setLineDash([]);
      g.strokeStyle = C.ink; g.lineWidth = 2; g.beginPath(); g.arc(TX(L.th), TY(L.d), 6, 0, 2 * PI); g.stroke();
    }
    // ---- 3. сходимость
    var Cc = prep(this.cc); g = Cc.g;
    var cx0 = 40, cy0 = 10, cw = Cc.w - 50, ch = Cc.h - 36, lmax = 6.3, ylo = 2.6, yhi = 3.7;
    var LX = function (N) { return cx0 + Math.log(N) / Math.LN10 / lmax * cw; }, LY = function (v) { return cy0 + ch - (v - ylo) / (yhi - ylo) * ch; };
    g.save(); g.beginPath(); g.rect(cx0, cy0, cw, ch); g.clip();
    g.fillStyle = C.bg3; g.beginPath();
    for (j = 0; j <= 60; j++) { var NN = Math.pow(10, lmax * j / 60); g.lineTo(LX(NN), LY(PI + 3 * PI * SIGREL / Math.sqrt(NN))); }
    for (j = 60; j >= 0; j--) { NN = Math.pow(10, lmax * j / 60); g.lineTo(LX(NN), LY(PI - 3 * PI * SIGREL / Math.sqrt(NN))); }
    g.closePath(); g.fill();
    g.strokeStyle = C.mute2; g.setLineDash([5, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(LX(1), LY(PI)); g.lineTo(LX(Math.pow(10, lmax)), LY(PI)); g.stroke(); g.setLineDash([]);
    var hs = this.hist;
    if (hs.length) {
      g.strokeStyle = C.grn; g.lineWidth = 1.8; g.beginPath();
      for (i = 0; i < hs.length; i++) { if (i) g.lineTo(LX(hs[i][0]), LY(hs[i][1])); else g.moveTo(LX(hs[i][0]), LY(hs[i][1])); }
      g.stroke();
      g.fillStyle = C.grn; g.beginPath(); g.arc(LX(hs[hs.length - 1][0]), LY(hs[hs.length - 1][1]), 3.5, 0, 2 * PI); g.fill();
    }
    g.restore();
    g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(cx0, cy0, cw, ch);
    g.fillStyle = C.ink; g.font = '11px Georgia,serif';
    for (k = 0; k <= 6; k += 2) g.fillText(k === 0 ? '1' : '10' , LX(Math.pow(10, k)) - (k ? 8 : 3), cy0 + ch + 14);
    g.font = '8px Georgia,serif'; for (k = 2; k <= 6; k += 2) g.fillText(String(k), LX(Math.pow(10, k)) + 4, cy0 + ch + 9);
    g.font = '11px Georgia,serif';
    g.fillText('N', cx0 + cw - 10, cy0 + ch + 26 > Cc.h ? cy0 + ch + 14 : cy0 + ch + 26);
    [2.8, 3.0, 3.2, 3.4, 3.6].forEach(function (v) { g.fillText(fmt(v, 1), 6, LY(v) + 4); });
    g.fillStyle = C.mute2; g.font = 'italic 11px Georgia,serif'; g.fillText('π ± 3σ', LX(10) + 4, LY(PI + 3 * PI * SIGREL / Math.sqrt(10)) + 14);
    // ---- текст
    var N = this.N, n = this.n;
    if (N) {
      var p = n / N, est = n ? 2 * N / n : NaN, se = n && n < N ? est * Math.sqrt((1 - p) / (p * N)) : NaN;
      this.stat.innerHTML = 'бросков N = ' + N.toLocaleString('ru-RU') + ' · пересечений n = ' + n.toLocaleString('ru-RU') +
        ' · доля n/N = ' + fmt(p, 4) + (n ? ' · π ≈ 2N/n = ' + fmt(est, 4) + (isFinite(se) ? ' ± ' + fmt(se, 4) + ' (станд. ошибка)' : '') + ' · ошибка ' + fmt(Math.abs(est - PI), 4) : '');
    } else this.stat.textContent = 'бросков N = 0';
    if (slow && L) {
      this.last.textContent = 'игла ' + N + ': y = ' + fmt(L.d, 2) + 'a, θ = ' + Math.round(L.th * 180 / PI) + '°, (l/2) sin θ = ' + fmt(0.5 * Math.sin(L.th), 2) + 'a → ' +
        (L.hit ? 'y ≤ (l/2) sin θ, пересекает' : 'y > (l/2) sin θ, не пересекает');
    } else if (N && !slow) this.last.textContent = 'Красные — пересекли прямую, синие — нет. Справа: зелёная кривая — оценка π, серая полоса — интервал π ± 3σ/√N.';
  };

  function init() {
    var els = document.querySelectorAll('.buffon-anim');
    if (!els.length) return;
    if (!document.getElementById('buffon-css')) { var st = document.createElement('style'); st.id = 'buffon-css'; st.textContent = CSS; document.head.appendChild(st); }
    for (var i = 0; i < els.length; i++) if (!els[i].__bf) els[i].__bf = new Widget(els[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
