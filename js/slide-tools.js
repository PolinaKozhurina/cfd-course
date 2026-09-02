// ============================================================
// CFDSlideTools — рисование на слайдах + экспорт в PDF / PPTX
// ------------------------------------------------------------
// Публичный API:
//   CFDSlideTools.init({
//     slidesSelector:   '.slide',
//     activeClass:      'active',
//     getCurrentIndex:  function() { return currentSlideIndex; },
//     onGoToSlide:      function(i) { show(i); },  // опц., для навигации
//     hudSelector:      '.hud',                     // куда добавить кнопки
//     projectName:      'sem1-01',                  // имя файла экспорта
//   });
//
// Внешние зависимости (грузи заранее с CDN):
//   - jsPDF UMD                → window.jspdf.jsPDF
//   - html2canvas              → window.html2canvas
//   - PptxGenJS UMD (bundle)   → window.PptxGenJS
// Если какой-то из них не подгрузился — соответствующая кнопка спрячется.
// ============================================================

(function () {
  "use strict";

  var CANVAS_MAX_DIM = 3200; // ограничение размера канваса для экспорта
  var EXPORT_SCALE = 1.4;    // множитель к CSS-размеру при html2canvas
  var JPEG_QUALITY = 0.86;

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function injectStyles() {
    if (document.getElementById("cfd-st-css")) return;
    var s = document.createElement("style");
    s.id = "cfd-st-css";
    s.textContent = [
      ".cfd-st-ink{position:fixed;inset:0;z-index:900;pointer-events:none;touch-action:pan-y}",
      ".cfd-st-ink.drawing{pointer-events:auto;cursor:crosshair}",
      ".cfd-st-ink.eraser{cursor:cell}",
      ".cfd-st-panel{position:fixed;right:1rem;top:1rem;z-index:1000;background:#fff;border:1px solid #d9cfc0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:.4rem;display:none;flex-direction:column;gap:.3rem;font-family:'JetBrains Mono',monospace;font-size:.75rem;color:#2c2419}",
      ".cfd-st-panel.on{display:flex}",
      ".cfd-st-panel .row{display:flex;gap:.25rem;align-items:center;justify-content:center}",
      ".cfd-st-panel .lbl{font-size:.62rem;color:#9a8d7e;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-top:.15rem}",
      ".cfd-st-btn{background:#faf8f4;border:1px solid #d9cfc0;border-radius:4px;padding:.28rem .5rem;cursor:pointer;font:inherit;color:#2c2419;line-height:1}",
      ".cfd-st-btn:hover{border-color:#b44a2d;color:#b44a2d}",
      ".cfd-st-btn.on{background:#2c2419;color:#fff;border-color:#2c2419}",
      ".cfd-st-swatch{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}",
      ".cfd-st-swatch.on{border-color:#2c2419;box-shadow:0 0 0 1px #fff inset}",
      ".cfd-st-overlay{position:fixed;inset:0;background:rgba(20,15,10,.75);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fdf9f0;font-family:'Source Serif 4',Georgia,serif}",
      ".cfd-st-overlay .msg{font-size:1.1rem;margin-bottom:.7rem}",
      ".cfd-st-overlay .bar{width:min(60vw,420px);height:8px;background:#3a2f1a;border-radius:4px;overflow:hidden}",
      ".cfd-st-overlay .fill{height:100%;background:linear-gradient(90deg,#b44a2d,#f6d743);width:0%;transition:width .18s}",
      ".hud .cfd-hud-btn{font-family:'JetBrains Mono',monospace;font-size:.82rem;padding:.4rem .9rem;border:1px solid #d9cfc0;border-radius:5px;background:#fff;color:#6b5d4f;cursor:pointer;margin-left:.3rem}",
      ".hud .cfd-hud-btn:hover{border-color:#b44a2d;color:#b44a2d;background:#f5f0e8}",
      ".hud .cfd-hud-btn.on{background:#b44a2d;color:#fff;border-color:#b44a2d}",
      // На время экспорта отключаем анимации слайдов — иначе html2canvas
      // ловит их в полу-прозрачном состоянии.
      "body.cfd-st-exporting .slide.active .slide-content > *,body.cfd-st-exporting .slide.active .eq,body.cfd-st-exporting .slide.active .eq::after{animation:none!important;opacity:1!important;transform:none!important;filter:none!important}",
    ].join("");
    document.head.appendChild(s);
  }

  function CFDSlideTools() {}
  CFDSlideTools.prototype.init = function (opts) {
    var self = this;
    this.opts = opts || {};
    this.slidesSelector = opts.slidesSelector || ".slide";
    this.activeClass    = opts.activeClass || "active";
    this.projectName    = opts.projectName || "slides";
    // По умолчанию — определяем активный слайд из DOM (никакой связки со
    // сторонним скриптом не требуется).
    var actCls = this.activeClass, sel = this.slidesSelector;
    this.getIndex = opts.getCurrentIndex || function () {
      var all = document.querySelectorAll(sel);
      for (var k = 0; k < all.length; k++) if (all[k].classList.contains(actCls)) return k;
      return 0;
    };
    // Навигация: либо своя функция, либо «сходить» через существующий
    // window.next()/prev() (если они выставлены), либо принудительное
    // переключение active-класса. Последнее не запускает анимации/скроллы
    // родной презентации, но для экспорта достаточно.
    var self0 = this;
    this.goTo = opts.onGoToSlide || function (i) {
      var slides = document.querySelectorAll(sel);
      for (var k = 0; k < slides.length; k++) slides[k].classList.remove(actCls);
      if (slides[i]) slides[i].classList.add(actCls);
    };

    injectStyles();
    this._buildUI();

    // Перехват смены слайда: замотаем show(). Проще всего — MutationObserver
    // на активный класс, чтобы при любой смене слайда:
    //   1) сохранить текущие ink-штрихи под индексом old,
    //   2) загрузить штрихи слайда new (если были),
    //   3) сбросить холст под текущий размер.
    this._lastIndex = this.getIndex();
    this._inkStore = {}; // slideIndex → dataURL
    var mo = new MutationObserver(function () {
      var cur = self.getIndex();
      if (cur === self._lastIndex) return;
      self._saveInk(self._lastIndex);
      self._loadInk(cur);
      self._lastIndex = cur;
    });
    document.querySelectorAll(this.slidesSelector).forEach(function (s) {
      mo.observe(s, { attributes: true, attributeFilter: ["class"] });
    });

    // Ресайз — просто перерисовать текущий слайд из хранилища
    window.addEventListener("resize", function () {
      self._resizeCanvas();
      self._loadInk(self.getIndex());
    });
  };

  // ---------- UI ----------

  CFDSlideTools.prototype._buildUI = function () {
    var self = this;

    // Оверлей-канвас
    var canvas = document.createElement("canvas");
    canvas.className = "cfd-st-ink";
    document.body.appendChild(canvas);
    this.canvas = canvas;
    this._resizeCanvas();

    // Панель инструментов (появляется при включённом режиме рисования)
    var panel = el("div", "cfd-st-panel");
    panel.innerHTML =
      '<div class="row">' +
        '<button class="cfd-st-btn" data-act="pen">✒ Перо</button>' +
        '<button class="cfd-st-btn" data-act="eraser">Ластик</button>' +
      '</div>' +
      '<div class="lbl">Цвет</div>' +
      '<div class="row" data-colors>' +
        '<button class="cfd-st-swatch" data-color="#dc2626" style="background:#dc2626"></button>' +
        '<button class="cfd-st-swatch" data-color="#2563eb" style="background:#2563eb"></button>' +
        '<button class="cfd-st-swatch" data-color="#059669" style="background:#059669"></button>' +
        '<button class="cfd-st-swatch" data-color="#1a1a1a" style="background:#1a1a1a"></button>' +
        '<button class="cfd-st-swatch" data-color="#f59e0b" style="background:#f59e0b"></button>' +
      '</div>' +
      '<div class="lbl">Толщина</div>' +
      '<div class="row" data-sizes>' +
        '<button class="cfd-st-btn" data-size="1.5">·</button>' +
        '<button class="cfd-st-btn" data-size="3">•</button>' +
        '<button class="cfd-st-btn" data-size="6">⬤</button>' +
      '</div>' +
      '<div class="row" style="margin-top:.35rem">' +
        '<button class="cfd-st-btn" data-act="clear" title="Очистить этот слайд">🗑 Слайд</button>' +
        '<button class="cfd-st-btn" data-act="clear-all" title="Очистить все слайды">🗑 Все</button>' +
      '</div>';
    document.body.appendChild(panel);
    this.panel = panel;

    // HUD-кнопки
    var hud = document.querySelector(this.opts.hudSelector || ".hud");
    if (hud) {
      // Кнопка рисования
      var btnDraw = el("button", "cfd-hud-btn", "✏️ Рисовать");
      btnDraw.title = "Включить/выключить режим рисования на слайде";
      btnDraw.addEventListener("click", function () { self.toggleDraw(); });
      this.btnDraw = btnDraw;

      var btnPdf = el("button", "cfd-hud-btn", "⬇ PDF");
      btnPdf.title = "Скачать все слайды одним PDF";
      btnPdf.addEventListener("click", function () { self.exportPdf(); });

      var btnPpt = el("button", "cfd-hud-btn", "⬇ PPTX");
      btnPpt.title = "Скачать все слайды как PowerPoint";
      btnPpt.addEventListener("click", function () { self.exportPptx(); });

      // Ставим в HUD-центр рядом с кнопками навигации
      var center = hud.querySelector(".center") || hud;
      center.appendChild(btnDraw);
      center.appendChild(btnPdf);
      center.appendChild(btnPpt);
    }

    // Инструменты по умолчанию
    this.tool = "pen";
    this.color = "#dc2626";
    this.size = 3;
    this.draw = false;
    this._updatePanel();

    // Обработчики панели
    panel.addEventListener("click", function (e) {
      var t = e.target;
      var act = t.getAttribute("data-act");
      if (act === "pen")       { self.tool = "pen";    self._updatePanel(); }
      else if (act === "eraser") { self.tool = "eraser"; self._updatePanel(); }
      else if (act === "clear") { self._clearCurrent(); }
      else if (act === "clear-all") { self._clearAll(); }
      var col = t.getAttribute("data-color");
      if (col) { self.color = col; self.tool = "pen"; self._updatePanel(); }
      var sz = t.getAttribute("data-size");
      if (sz) { self.size = parseFloat(sz); self._updatePanel(); }
    });

    // Pointer-события на канвасе
    this._attachPointer();

    // Горячая клавиша D — переключение режима
    document.addEventListener("keydown", function (e) {
      if (/^(INPUT|TEXTAREA)$/i.test((e.target || {}).tagName)) return;
      if (e.key === "d" || e.key === "D" || e.key === "в" || e.key === "В") {
        e.preventDefault(); self.toggleDraw();
      }
    });
  };

  CFDSlideTools.prototype._updatePanel = function () {
    if (!this.panel) return;
    this.panel.querySelectorAll(".cfd-st-btn").forEach(function (b) { b.classList.remove("on"); });
    this.panel.querySelectorAll(".cfd-st-swatch").forEach(function (b) { b.classList.remove("on"); });
    var toolBtn = this.panel.querySelector('[data-act="' + this.tool + '"]');
    if (toolBtn) toolBtn.classList.add("on");
    var colBtn = this.panel.querySelector('[data-color="' + this.color + '"]');
    if (colBtn) colBtn.classList.add("on");
    var szBtn = this.panel.querySelector('[data-size="' + this.size + '"]');
    if (szBtn) szBtn.classList.add("on");
    this.canvas.classList.toggle("eraser", this.tool === "eraser" && this.draw);
  };

  CFDSlideTools.prototype.toggleDraw = function () {
    this.draw = !this.draw;
    this.canvas.classList.toggle("drawing", this.draw);
    this.panel.classList.toggle("on", this.draw);
    if (this.btnDraw) this.btnDraw.classList.toggle("on", this.draw);
    this._updatePanel();
  };

  CFDSlideTools.prototype._resizeCanvas = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    var ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  CFDSlideTools.prototype._attachPointer = function () {
    var self = this;
    var c = this.canvas;
    var last = null, drawingNow = false;

    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, p: (e.pressure > 0 && e.pointerType !== "mouse") ? e.pressure : 0.5 };
    }
    function acceptPen(e) { return e.pointerType !== "touch"; }

    c.addEventListener("pointerdown", function (e) {
      if (!self.draw) return;
      if (!acceptPen(e)) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
      drawingNow = true;
      last = pos(e);
      if (self.tool === "eraser") self._eraseAt(last);
      else {
        var ctx = c.getContext("2d");
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = self.color;
        ctx.lineWidth = self.size * (0.5 + 1.5 * last.p);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.01, last.y); ctx.stroke();
      }
    });
    c.addEventListener("pointermove", function (e) {
      if (!drawingNow) return;
      if (!acceptPen(e)) return;
      e.preventDefault();
      var p = pos(e);
      if (self.tool === "eraser") self._eraseAt(p);
      else {
        var ctx = c.getContext("2d");
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = self.color;
        ctx.lineWidth = self.size * (0.5 + 1.5 * p.p);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      last = p;
    });
    function finish(e) {
      if (!drawingNow) return;
      drawingNow = false;
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      // Автосохранение в стор
      self._saveInk(self.getIndex());
    }
    c.addEventListener("pointerup", finish);
    c.addEventListener("pointercancel", finish);
  };

  CFDSlideTools.prototype._eraseAt = function (p) {
    var r = 18;
    var ctx = this.canvas.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  CFDSlideTools.prototype._saveInk = function (idx) {
    if (idx == null || idx < 0) return;
    // Если холст пустой — не сохраняем, чтобы не раздувать хранилище.
    if (this._isCanvasBlank()) { delete this._inkStore[idx]; return; }
    try { this._inkStore[idx] = this.canvas.toDataURL("image/png"); } catch (_) {}
  };
  CFDSlideTools.prototype._loadInk = function (idx) {
    var ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    var url = this._inkStore[idx];
    if (!url) return;
    var img = new Image();
    img.onload = function () {
      var dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.restore();
    };
    img.src = url;
  };
  CFDSlideTools.prototype._isCanvasBlank = function () {
    var ctx = this.canvas.getContext("2d");
    var w = this.canvas.width, h = this.canvas.height;
    // Быстрая эвристика: проверяем 100 случайных пикселей
    var data = ctx.getImageData(0, 0, w, h).data;
    for (var i = 3; i < data.length; i += Math.max(4, Math.floor(data.length / 400))) {
      if (data[i] !== 0) return false;
    }
    return true;
  };
  CFDSlideTools.prototype._clearCurrent = function () {
    var ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    delete this._inkStore[this.getIndex()];
  };
  CFDSlideTools.prototype._clearAll = function () {
    if (!confirm("Стереть пометки со всех слайдов?")) return;
    this._inkStore = {};
    var ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  // ---------- Экспорт ----------

  // Ленивая подгрузка сторонней библиотеки по URL. Возвращает Promise,
  // резолвится, когда window[globalName] появится.
  function loadLib(url, globalCheck) {
    return new Promise(function (res, rej) {
      if (globalCheck()) { res(); return; }
      var s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = function () {
        // Некоторые UMD-скрипты дают глобал не сразу — ждём микро-tick
        setTimeout(function () {
          if (globalCheck()) res();
          else rej(new Error("библиотека не появилась в window: " + url));
        }, 0);
      };
      s.onerror = function () { rej(new Error("не удалось загрузить " + url)); };
      document.head.appendChild(s);
    });
  }
  CFDSlideTools.prototype._ensureExportLibs = async function (needPptx) {
    // html2canvas — нужен всем экспортам
    if (!window.html2canvas) {
      this._setProgress(0.02, "Загрузка html2canvas…");
      await loadLib("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
        function () { return !!window.html2canvas; });
    }
    if (!needPptx && !(window.jspdf && window.jspdf.jsPDF)) {
      this._setProgress(0.04, "Загрузка jsPDF…");
      await loadLib("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
        function () { return !!(window.jspdf && window.jspdf.jsPDF); });
    }
    if (needPptx && !window.PptxGenJS) {
      this._setProgress(0.04, "Загрузка PptxGenJS…");
      await loadLib("https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.min.js",
        function () { return !!window.PptxGenJS; });
    }
  };

  CFDSlideTools.prototype._showProgress = function (msg) {
    if (!this._overlay) {
      var o = document.createElement("div");
      o.className = "cfd-st-overlay";
      o.innerHTML = '<div class="msg"></div><div class="bar"><div class="fill"></div></div>';
      document.body.appendChild(o);
      this._overlay = o;
    }
    this._overlay.style.display = "flex";
    this._overlay.querySelector(".msg").textContent = msg || "";
  };
  CFDSlideTools.prototype._setProgress = function (frac, msg) {
    if (!this._overlay) return;
    this._overlay.querySelector(".fill").style.width = Math.round(frac * 100) + "%";
    if (msg) this._overlay.querySelector(".msg").textContent = msg;
  };
  CFDSlideTools.prototype._hideProgress = function () {
    if (this._overlay) this._overlay.style.display = "none";
  };

  // Пройти по всем слайдам, каждый показать → дождаться typeset → снять
  // html2canvas → вернуть массив { dataURL, w, h }.
  CFDSlideTools.prototype._captureAll = async function () {
    if (!window.html2canvas) throw new Error("html2canvas не подгружен");
    var slides = document.querySelectorAll(this.slidesSelector);
    var n = slides.length;
    var restoreIdx = this.getIndex();
    var results = [];
    // Сохраним текущий inkStore и снимем пометки на время экспорта —
    // они не всегда должны попадать в файл; в PDF/PPTX идёт только слайд.
    // (Если захочется другой поведения — легко добавить чекбокс.)
    var savedInk = this._inkStore;
    this._inkStore = {};
    var ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Скроем HUD и панель на время съёмки.
    var hud = document.querySelector(this.opts.hudSelector || ".hud");
    var prog = document.querySelector(".progress-bar");
    var prevHud  = hud  ? hud.style.display  : null;
    var prevProg = prog ? prog.style.display : null;
    if (hud)  hud.style.display  = "none";
    if (prog) prog.style.display = "none";
    this.canvas.style.display = "none";
    document.body.classList.add("cfd-st-exporting");
    try {
      for (var i = 0; i < n; i++) {
        this._setProgress(i / n, "Слайд " + (i + 1) + " / " + n + "…");
        if (this.goTo) this.goTo(i);
        else this._forceActive(slides, i);
        // Дождаться завершения анимации + MathJax
        await new Promise(function (r) { setTimeout(r, 380); });
        if (window.MathJax && window.MathJax.typesetPromise) {
          try { await window.MathJax.typesetPromise([slides[i]]); } catch (_) {}
        }
        var canvas = await window.html2canvas(slides[i], {
          backgroundColor: "#faf8f4",
          scale: EXPORT_SCALE,
          useCORS: true,
          logging: false,
          width: window.innerWidth,
          height: window.innerHeight,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          ignoreElements: function (n) {
            if (!n.classList) return false;
            return n.classList.contains("hud")
                || n.classList.contains("cfd-st-ink")
                || n.classList.contains("cfd-st-panel")
                || n.classList.contains("progress-bar")
                || n.classList.contains("cfd-st-overlay");
          },
        });
        // Ограничение по размеру — если больше CANVAS_MAX_DIM, уменьшим
        var W = canvas.width, H = canvas.height;
        if (W > CANVAS_MAX_DIM || H > CANVAS_MAX_DIM) {
          var k = CANVAS_MAX_DIM / Math.max(W, H);
          var c2 = document.createElement("canvas");
          c2.width = Math.round(W * k); c2.height = Math.round(H * k);
          c2.getContext("2d").drawImage(canvas, 0, 0, c2.width, c2.height);
          canvas = c2; W = canvas.width; H = canvas.height;
        }
        var dataURL = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        results.push({ dataURL: dataURL, w: W, h: H });
      }
      this._setProgress(1, "Собираем файл…");
    } finally {
      document.body.classList.remove("cfd-st-exporting");
      if (hud)  hud.style.display  = prevHud  || "";
      if (prog) prog.style.display = prevProg || "";
      this.canvas.style.display = "";
      this._inkStore = savedInk;
      if (this.goTo) this.goTo(restoreIdx);
      this._loadInk(restoreIdx);
    }
    return results;
  };

  CFDSlideTools.prototype._forceActive = function (slides, i) {
    for (var k = 0; k < slides.length; k++) slides[k].classList.remove(this.activeClass);
    slides[i].classList.add(this.activeClass);
  };

  CFDSlideTools.prototype.exportPdf = async function () {
    this._showProgress("Готовим PDF…");
    try {
      await this._ensureExportLibs(false);
      var imgs = await this._captureAll();
      var jsPDF = window.jspdf.jsPDF;
      // Первую страницу используем для формата
      var w = imgs[0].w, h = imgs[0].h;
      var pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w * 0.75, h * 0.75], compress: true });
      for (var i = 0; i < imgs.length; i++) {
        var iw = imgs[i].w * 0.75, ih = imgs[i].h * 0.75;
        if (i > 0) pdf.addPage([iw, ih], iw >= ih ? "landscape" : "portrait");
        pdf.addImage(imgs[i].dataURL, "JPEG", 0, 0, iw, ih);
        this._setProgress(0.9 + 0.1 * (i / imgs.length), "PDF: страница " + (i + 1) + "/" + imgs.length);
      }
      pdf.save(this.projectName + ".pdf");
    } catch (e) {
      alert("Не удалось собрать PDF: " + e.message);
    } finally {
      this._hideProgress();
    }
  };

  CFDSlideTools.prototype.exportPptx = async function () {
    this._showProgress("Готовим PowerPoint…");
    try {
      await this._ensureExportLibs(true);
      var imgs = await this._captureAll();
      var pptx = new window.PptxGenJS();
      // Формат 16:9, стандартный ppt слайд 13.333×7.5 in
      pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5
      var SW = 13.333, SH = 7.5;
      for (var i = 0; i < imgs.length; i++) {
        var slide = pptx.addSlide();
        // Вписываем изображение слайда сохраняя пропорции
        var iw = imgs[i].w, ih = imgs[i].h;
        var ratioImg = iw / ih;
        var ratioSlide = SW / SH;
        var w, h, x, y;
        if (ratioImg > ratioSlide) { w = SW; h = SW / ratioImg; x = 0; y = (SH - h) / 2; }
        else                        { h = SH; w = SH * ratioImg; y = 0; x = (SW - w) / 2; }
        slide.background = { color: "FAF8F4" };
        slide.addImage({ data: imgs[i].dataURL, x: x, y: y, w: w, h: h });
        this._setProgress(0.9 + 0.1 * (i / imgs.length), "PPTX: слайд " + (i + 1) + "/" + imgs.length);
      }
      await pptx.writeFile({ fileName: this.projectName + ".pptx" });
    } catch (e) {
      alert("Не удалось собрать PPTX: " + e.message);
    } finally {
      this._hideProgress();
    }
  };

  window.CFDSlideTools = new CFDSlideTools();
})();
