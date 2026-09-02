// ============================================================
// CFDAnnotator — оверлей-проверялка PDF-сдач
// ------------------------------------------------------------
// Открывает модалку c рендером всех страниц исходного PDF (PDF.js)
// и прозрачным ink-слоем поверх для пометок пером/маркером/ластиком/
// штампами. Поддерживает Pointer Events: Apple Pencil, Wacom и мышь
// (для мыши давление всегда 0.5, для пера — реальное `pressure`).
// Пальцем на iPad НЕ рисуем — оставляем свайп для прокрутки.
//
// Публичный API:
//   CFDAnnotator.open({
//     assignment: { id, courseId, title },
//     student:    { uid, fio, email },
//     submission: { files, ... },
//     sourceFile: { path, name },   // один из submission.files
//     onDone:     function() {}     // после успешной отправки
//   });
//
// Зависит от: CFDHomework (js/homework.js), PDF.js (window.pdfjsLib),
// jsPDF (window.jspdf.jsPDF).
// ============================================================

(function () {
  "use strict";

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var RENDER_SCALE = 1.8;    // рендер PDF в canvas
  var EXPORT_QUALITY = 0.85; // JPEG quality в итоговом PDF

  function ensurePdfJs() {
    if (window.pdfjsLib && window.pdfjsLib.getDocument) {
      if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      }
      return Promise.resolve();
    }
    return Promise.reject(new Error("pdf.js не загружен (script на CDN не подключён)"));
  }
  function ensureJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    return Promise.reject(new Error("jsPDF не загружен"));
  }

  // ---------- Модель штрихов ----------
  // stroke: { tool: 'pen'|'highlighter'|'stamp',
  //           color, size, opacity, points: [{x,y,p}], glyph?, blend? }

  function newState(pagesCount) {
    var pages = [];
    for (var i = 0; i < pagesCount; i++) pages.push({ strokes: [], undone: [] });
    return { pages: pages, currentPage: 0 };
  }

  // ---------- Основной класс ----------

  function Annotator(opts) {
    this.opts = opts || {};
    this.pdf = null;
    this.pageCanvases = [];   // [{wrap, baseCanvas, inkCanvas, viewport, pageNum}]
    this.state = null;
    this.tool = "pen";
    this.color = "#dc2626";
    this.size = 2.2;
    this.stampGlyph = "✓";
    this.activeStroke = null;
    this.drawing = false;
    this.root = null;
    this.status = null;
    this.pdfBlob = null;
  }

  Annotator.prototype.open = async function () {
    try {
      await ensurePdfJs();
      await ensureJsPdf();
    } catch (e) {
      alert("Ошибка загрузки библиотек: " + e.message + "\nОбновите страницу и повторите.");
      return;
    }
    this._buildShell();
    document.body.style.overflow = "hidden";
    try {
      this._setStatus("Скачивание файла…");
      var dl = await CFDHomework.downloadFile(this.opts.sourceFile.path);
      this.pdfBlob = dl.blob;
      this._setStatus("Рендер PDF…");
      var buf = await dl.blob.arrayBuffer();
      var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      this.pdf = pdf;
      this.state = newState(pdf.numPages);
      await this._renderAllPages();
      this._setStatus("");
      this._updateToolbar();
    } catch (e) {
      this._setStatus("");
      alert("Не удалось открыть PDF: " + e.message);
      this.close();
    }
  };

  Annotator.prototype.close = function () {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    document.body.style.overflow = "";
    this.root = null;
  };

  Annotator.prototype._setStatus = function (msg) {
    if (this.status) this.status.textContent = msg || "";
  };

  // ---------- UI ----------

  Annotator.prototype._buildShell = function () {
    var self = this;
    var root = document.createElement("div");
    root.className = "cfd-annot-root";
    root.innerHTML =
      '<style>' +
      '.cfd-annot-root{position:fixed;inset:0;z-index:99999;background:#f5f2ec;font-family:"Source Serif 4",Georgia,serif;color:#1a1a1a;display:flex;flex-direction:column}' +
      '.cfd-annot-top{display:flex;align-items:center;gap:.6rem;padding:.5rem .8rem;background:#fff;border-bottom:1px solid #d8d0c0;box-shadow:0 1px 3px rgba(0,0,0,.05);flex-wrap:wrap}' +
      '.cfd-annot-top .title{font-family:"Playfair Display",serif;font-size:1.05rem;flex:1;min-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.cfd-annot-top .status{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:#7a6a4a}' +
      '.cfd-annot-btn{background:#fff;border:1px solid #c8bfa8;color:#3a2f1a;padding:.35rem .7rem;border-radius:5px;cursor:pointer;font-family:inherit;font-size:.88rem;display:inline-flex;align-items:center;gap:.35rem}' +
      '.cfd-annot-btn:hover{background:#fdf9f0;border-color:#8a7649}' +
      '.cfd-annot-btn.primary{background:#3a2f1a;color:#fff;border-color:#3a2f1a}' +
      '.cfd-annot-btn.primary:hover{background:#5a4a2a}' +
      '.cfd-annot-btn.danger{background:#fff;color:#c02020;border-color:#e0b0b0}' +
      '.cfd-annot-btn.danger:hover{background:#fff5f5}' +
      '.cfd-annot-btn[disabled]{opacity:.5;cursor:not-allowed}' +
      '.cfd-annot-body{flex:1;display:flex;overflow:hidden;min-height:0}' +
      '.cfd-annot-tools{width:88px;background:#fff;border-right:1px solid #d8d0c0;padding:.5rem;display:flex;flex-direction:column;gap:.4rem;overflow-y:auto;flex-shrink:0}' +
      '.cfd-annot-tool{background:#f5f2ec;border:1.5px solid transparent;border-radius:6px;padding:.35rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.15rem;font-family:inherit;font-size:.7rem;color:#3a2f1a;line-height:1}' +
      '.cfd-annot-tool:hover{background:#ede6d4}' +
      '.cfd-annot-tool.active{background:#3a2f1a;color:#fff;border-color:#3a2f1a}' +
      '.cfd-annot-tool svg{width:22px;height:22px;display:block}' +
      '.cfd-annot-tool.active svg *{stroke:#fff;fill:#fff}' +
      '.cfd-annot-swatch{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin-top:.2rem}' +
      '.cfd-annot-swatch button{width:100%;aspect-ratio:1;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}' +
      '.cfd-annot-swatch button.active{border-color:#3a2f1a;box-shadow:0 0 0 1px #fff inset}' +
      '.cfd-annot-sizes{display:flex;flex-direction:column;gap:3px;margin-top:.2rem;align-items:center}' +
      '.cfd-annot-sizes button{background:#fff;border:1px solid #c8bfa8;border-radius:4px;padding:2px 0;width:100%;cursor:pointer;font-size:.7rem;color:#3a2f1a;font-family:inherit}' +
      '.cfd-annot-sizes button.active{background:#3a2f1a;color:#fff;border-color:#3a2f1a}' +
      '.cfd-annot-tool-label{font-family:"JetBrains Mono",monospace;font-size:.66rem;color:#7a6a4a;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-top:.3rem}' +
      '.cfd-annot-pages{flex:1;overflow:auto;padding:1rem;background:#e6e0d0}' +
      '.cfd-annot-page-wrap{position:relative;margin:0 auto 1.5rem;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15);display:block}' +
      '.cfd-annot-page-wrap canvas{display:block}' +
      '.cfd-annot-ink{position:absolute;left:0;top:0;touch-action:pan-y pinch-zoom;cursor:crosshair}' +
      '.cfd-annot-page-num{position:absolute;top:-1.6rem;left:0;font-family:"JetBrains Mono",monospace;font-size:.78rem;color:#7a6a4a}' +
      '@media (max-width:700px){.cfd-annot-tools{width:72px;padding:.3rem}.cfd-annot-tool{padding:.25rem;font-size:.62rem}.cfd-annot-tool svg{width:18px;height:18px}}' +
      '</style>' +
      '<div class="cfd-annot-top">' +
        '<span class="title"></span>' +
        '<span class="status"></span>' +
        '<button class="cfd-annot-btn" data-act="undo" title="Отменить (Ctrl+Z)">↶ Отмена</button>' +
        '<button class="cfd-annot-btn" data-act="redo" title="Повторить (Ctrl+Y)">↷ Повтор</button>' +
        '<button class="cfd-annot-btn" data-act="clear" title="Стереть все пометки на текущей странице">Очистить страницу</button>' +
        '<button class="cfd-annot-btn primary" data-act="save">💾 Отправить студенту</button>' +
        '<button class="cfd-annot-btn danger" data-act="close">✕ Закрыть без сохранения</button>' +
      '</div>' +
      '<div class="cfd-annot-body">' +
        '<div class="cfd-annot-tools">' +
          '<button class="cfd-annot-tool" data-tool="pen">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21l3.5-1 11-11-2.5-2.5L4 17.5 3 21z" stroke="#3a2f1a" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 6.5l2.5 2.5" stroke="#3a2f1a" stroke-width="1.6"/></svg>' +
            '<span>Перо</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="highlighter">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M8 15l6-6 3 3-6 6H8v-3z" fill="#f6d743" stroke="#3a2f1a" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 20h14" stroke="#3a2f1a" stroke-width="1.6"/></svg>' +
            '<span>Маркер</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="eraser">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M6 18l6-12 6 3-6 12H6z" fill="#f5cfa8" stroke="#3a2f1a" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
            '<span>Ластик</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="stamp-check">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12l6 6L20 6" stroke="#0a8a3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '<span>✓</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="stamp-cross">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5L5 19" stroke="#c02020" stroke-width="3" stroke-linecap="round"/></svg>' +
            '<span>✗</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="stamp-minus">' +
            '<svg viewBox="0 0 24 24" fill="none"><text x="12" y="17" text-anchor="middle" font-size="11" font-family="Georgia" fill="#c02020" font-weight="bold">−1</text></svg>' +
            '<span>−1</span>' +
          '</button>' +
          '<div class="cfd-annot-tool-label">Цвет</div>' +
          '<div class="cfd-annot-swatch" data-swatch>' +
            '<button data-color="#dc2626" style="background:#dc2626"></button>' +
            '<button data-color="#2563eb" style="background:#2563eb"></button>' +
            '<button data-color="#059669" style="background:#059669"></button>' +
            '<button data-color="#1a1a1a" style="background:#1a1a1a"></button>' +
          '</div>' +
          '<div class="cfd-annot-tool-label">Толщина</div>' +
          '<div class="cfd-annot-sizes" data-sizes>' +
            '<button data-size="1.2">·</button>' +
            '<button data-size="2.2">•</button>' +
            '<button data-size="3.8">⬤</button>' +
          '</div>' +
        '</div>' +
        '<div class="cfd-annot-pages" data-pages></div>' +
      '</div>';
    document.body.appendChild(root);
    this.root = root;

    root.querySelector(".title").textContent =
      "Проверка · " + (this.opts.assignment.title || this.opts.assignment.id) +
      " · " + (this.opts.student.fio || this.opts.student.email || this.opts.student.uid) +
      " · " + (this.opts.sourceFile.name || "");
    this.status = root.querySelector(".status");

    // Top bar actions
    root.querySelector('[data-act="close"]').addEventListener("click", function () {
      if (self._hasAnyStroke() && !confirm("Закрыть без сохранения? Пометки будут потеряны.")) return;
      self.close();
    });
    root.querySelector('[data-act="save"]').addEventListener("click", function () { self._save(); });
    root.querySelector('[data-act="undo"]').addEventListener("click", function () { self._undo(); });
    root.querySelector('[data-act="redo"]').addEventListener("click", function () { self._redo(); });
    root.querySelector('[data-act="clear"]').addEventListener("click", function () { self._clearCurrentPage(); });

    // Tools
    root.querySelectorAll(".cfd-annot-tool").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-tool");
        self._selectTool(t);
      });
    });
    // Colors
    root.querySelectorAll("[data-swatch] button").forEach(function (b) {
      b.addEventListener("click", function () {
        self.color = b.getAttribute("data-color");
        self._updateToolbar();
      });
    });
    // Sizes
    root.querySelectorAll("[data-sizes] button").forEach(function (b) {
      b.addEventListener("click", function () {
        self.size = parseFloat(b.getAttribute("data-size"));
        self._updateToolbar();
      });
    });

    // Keyboard shortcuts
    root.tabIndex = -1;
    root.focus();
    document.addEventListener("keydown", this._kb = function (e) {
      if (!self.root) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); self._undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); self._redo(); }
      else if (e.key === "Escape") { /* пусть закрывает по кнопке, чтобы не терять случайно */ }
    });
  };

  Annotator.prototype._selectTool = function (t) {
    // stamp-check/cross/minus — три пресета «штампа»
    if (t === "stamp-check")      { this.tool = "stamp"; this.stampGlyph = "✓"; this.color = "#0a8a3a"; }
    else if (t === "stamp-cross") { this.tool = "stamp"; this.stampGlyph = "✗"; this.color = "#c02020"; }
    else if (t === "stamp-minus") { this.tool = "stamp"; this.stampGlyph = "−1"; this.color = "#c02020"; }
    else if (t === "highlighter") { this.tool = "highlighter"; }
    else if (t === "eraser")      { this.tool = "eraser"; }
    else                          { this.tool = "pen"; }
    this._activeToolKey = t;
    this._updateToolbar();
  };

  Annotator.prototype._updateToolbar = function () {
    var self = this;
    var key = this._activeToolKey || "pen";
    this.root.querySelectorAll(".cfd-annot-tool").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tool") === key);
    });
    this.root.querySelectorAll("[data-swatch] button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-color") === self.color);
    });
    this.root.querySelectorAll("[data-sizes] button").forEach(function (b) {
      b.classList.toggle("active", parseFloat(b.getAttribute("data-size")) === self.size);
    });
    // Курсор
    var pages = this.root.querySelector(".cfd-annot-pages");
    if (this.tool === "eraser") pages.style.cursor = "cell";
    else if (this.tool === "stamp") pages.style.cursor = "copy";
    else pages.style.cursor = "crosshair";
  };

  // ---------- Рендер страниц ----------

  Annotator.prototype._renderAllPages = async function () {
    var self = this;
    var box = this.root.querySelector(".cfd-annot-pages");
    box.innerHTML = "";
    this.pageCanvases = [];
    var scrollT = null;
    box.addEventListener("scroll", function () {
      if (scrollT) return;
      scrollT = setTimeout(function () { scrollT = null; self._updateCurrentPageFromScroll(); }, 80);
    });
    for (var i = 1; i <= this.pdf.numPages; i++) {
      this._setStatus("Страница " + i + " / " + this.pdf.numPages + "…");
      var page = await this.pdf.getPage(i);
      var viewport = page.getViewport({ scale: RENDER_SCALE });
      var wrap = document.createElement("div");
      wrap.className = "cfd-annot-page-wrap";
      wrap.style.width = viewport.width + "px";
      wrap.style.height = viewport.height + "px";
      var lbl = document.createElement("div");
      lbl.className = "cfd-annot-page-num";
      lbl.textContent = "стр. " + i + " / " + this.pdf.numPages;
      wrap.appendChild(lbl);
      var base = document.createElement("canvas");
      base.width = viewport.width; base.height = viewport.height;
      wrap.appendChild(base);
      var ink = document.createElement("canvas");
      ink.className = "cfd-annot-ink";
      ink.width = viewport.width; ink.height = viewport.height;
      wrap.appendChild(ink);
      box.appendChild(wrap);
      await page.render({ canvasContext: base.getContext("2d"), viewport: viewport }).promise;
      this.pageCanvases.push({
        pageIndex: i - 1,
        pageNum: i, wrap: wrap, baseCanvas: base, inkCanvas: ink, viewport: viewport,
      });
      this._attachInkHandlers(this.pageCanvases[i - 1]);
    }
    this._setStatus("");
  };

  // ---------- Ink layer: pointer events ----------

  Annotator.prototype._attachInkHandlers = function (p) {
    var self = this;
    var el = p.inkCanvas;

    function getPos(e) {
      var rect = el.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (el.width / rect.width);
      var y = (e.clientY - rect.top)  * (el.height / rect.height);
      return { x: x, y: y };
    }
    function pressureOf(e) {
      if (e.pointerType === "mouse") return 0.5;
      if (typeof e.pressure === "number" && e.pressure > 0) return e.pressure;
      return 0.5;
    }
    function acceptPointer(e) {
      // Пальцем не рисуем — оставляем прокрутку. Перо и мышь — рисуем.
      return e.pointerType !== "touch";
    }

    el.addEventListener("pointerdown", function (e) {
      if (!acceptPointer(e)) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      self.state.currentPage = p.pageIndex;
      var pos = getPos(e);
      // Штамп: клик = добавить и сразу закончить
      if (self.tool === "stamp") {
        var stroke = {
          tool: "stamp", color: self.color,
          size: Math.max(28, self.size * 12),
          glyph: self.stampGlyph,
          points: [{ x: pos.x, y: pos.y, p: 1 }],
        };
        self.state.pages[p.pageIndex].strokes.push(stroke);
        self.state.pages[p.pageIndex].undone.length = 0;
        self._redrawPage(p);
        return;
      }
      // Ластик: выбираем все штрихи, попавшие под кисть, удаляем в pointerup
      if (self.tool === "eraser") {
        self.drawing = true;
        self._eraseAt(p, pos, 14);
        return;
      }
      // Перо / маркер
      var stroke;
      if (self.tool === "highlighter") {
        stroke = {
          tool: "highlighter",
          color: (self.color === "#1a1a1a" ? "#f6d743" : self.color),
          size: Math.max(10, self.size * 6),
          opacity: 0.28,
          blend: "multiply",
          points: [{ x: pos.x, y: pos.y, p: 1 }],
        };
      } else {
        stroke = {
          tool: "pen", color: self.color, size: self.size,
          opacity: 1, blend: "source-over",
          points: [{ x: pos.x, y: pos.y, p: pressureOf(e) }],
        };
      }
      self.activeStroke = stroke;
      self.activePage = p;
      self.drawing = true;
      self.state.pages[p.pageIndex].strokes.push(stroke);
      self.state.pages[p.pageIndex].undone.length = 0;
      self._drawStrokeSegment(p, stroke, stroke.points.length - 1);
    });

    el.addEventListener("pointermove", function (e) {
      if (!self.drawing) return;
      if (!acceptPointer(e)) return;
      e.preventDefault();
      var pos = getPos(e);
      if (self.tool === "eraser") {
        self._eraseAt(p, pos, 14);
        return;
      }
      if (!self.activeStroke) return;
      self.activeStroke.points.push({ x: pos.x, y: pos.y, p: pressureOf(e) });
      self._drawStrokeSegment(p, self.activeStroke, self.activeStroke.points.length - 1);
    });

    function finish(e) {
      if (!self.drawing) return;
      self.drawing = false;
      self.activeStroke = null;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("pointerleave", function () { /* не завершаем — pointerup сработает благодаря capture */ });
  };

  // ---------- Отрисовка ----------

  Annotator.prototype._drawStrokeSegment = function (p, stroke, i) {
    var ctx = p.inkCanvas.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = stroke.blend || "source-over";
    ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.tool === "stamp") {
      var pt = stroke.points[0];
      ctx.font = "bold " + stroke.size + "px Georgia, serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(stroke.glyph, pt.x, pt.y);
      ctx.restore();
      return;
    }
    if (i <= 0) { ctx.restore(); return; }
    var a = stroke.points[i - 1], b = stroke.points[i];
    // Толщина: базовая * давление (для маркера — фикс)
    var w;
    if (stroke.tool === "highlighter") w = stroke.size;
    else w = Math.max(0.5, stroke.size * (0.5 + 1.5 * (b.p != null ? b.p : 0.5)));
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  };

  Annotator.prototype._redrawPage = function (p) {
    var ctx = p.inkCanvas.getContext("2d");
    ctx.clearRect(0, 0, p.inkCanvas.width, p.inkCanvas.height);
    var strokes = this.state.pages[p.pageIndex].strokes;
    for (var s = 0; s < strokes.length; s++) {
      var st = strokes[s];
      if (st.tool === "stamp") {
        this._drawStrokeSegment(p, st, 0);
        continue;
      }
      for (var i = 1; i < st.points.length; i++) this._drawStrokeSegment(p, st, i);
    }
  };

  // ---------- Ластик: убираем штрихи, попавшие под кисть ----------

  Annotator.prototype._eraseAt = function (p, pos, radius) {
    var page = this.state.pages[p.pageIndex];
    var r2 = radius * radius;
    var removed = false;
    var kept = [];
    for (var i = 0; i < page.strokes.length; i++) {
      var st = page.strokes[i];
      var hit = false;
      if (st.tool === "stamp") {
        var dx = st.points[0].x - pos.x, dy = st.points[0].y - pos.y;
        if (dx * dx + dy * dy <= (st.size * 0.6) * (st.size * 0.6)) hit = true;
      } else {
        for (var k = 0; k < st.points.length; k++) {
          var d = st.points[k];
          var ex = d.x - pos.x, ey = d.y - pos.y;
          if (ex * ex + ey * ey <= r2) { hit = true; break; }
        }
      }
      if (hit) { page.undone.push(st); removed = true; }
      else kept.push(st);
    }
    if (removed) {
      page.strokes = kept;
      this._redrawPage(p);
    }
  };

  // ---------- Undo / Redo / Clear ----------

  Annotator.prototype._undo = function () {
    if (!this.state) return;
    var idx = this._activePageIdx();
    var page = this.state.pages[idx];
    if (!page || !page.strokes.length) return;
    page.undone.push(page.strokes.pop());
    this._redrawPage(this.pageCanvases[idx]);
  };
  Annotator.prototype._redo = function () {
    if (!this.state) return;
    var idx = this._activePageIdx();
    var page = this.state.pages[idx];
    if (!page || !page.undone.length) return;
    page.strokes.push(page.undone.pop());
    this._redrawPage(this.pageCanvases[idx]);
  };
  Annotator.prototype._clearCurrentPage = function () {
    if (!this.state) return;
    var idx = this._activePageIdx();
    var page = this.state.pages[idx];
    if (!page || !page.strokes.length) return;
    if (!confirm("Стереть все пометки на этой странице?")) return;
    page.undone = page.undone.concat(page.strokes);
    page.strokes = [];
    this._redrawPage(this.pageCanvases[idx]);
  };

  // Активная страница = последняя, которую тронули пером ИЛИ та, что ближе
  // всех к центру видимой области. Первая имеет приоритет, если задана.
  Annotator.prototype._activePageIdx = function () {
    if (this.state && typeof this.state.currentPage === "number") return this.state.currentPage;
    return 0;
  };
  Annotator.prototype._updateCurrentPageFromScroll = function () {
    if (!this.pageCanvases.length) return;
    var box = this.root && this.root.querySelector(".cfd-annot-pages");
    if (!box) return;
    var boxRect = box.getBoundingClientRect();
    var midY = boxRect.top + boxRect.height / 2;
    var best = 0, bestDist = Infinity;
    for (var i = 0; i < this.pageCanvases.length; i++) {
      var r = this.pageCanvases[i].wrap.getBoundingClientRect();
      var d = Math.abs((r.top + r.bottom) / 2 - midY);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (this.state) this.state.currentPage = best;
  };

  Annotator.prototype._hasAnyStroke = function () {
    if (!this.state) return false;
    return this.state.pages.some(function (p) { return p.strokes.length > 0; });
  };

  // ---------- Экспорт: собрать проверенный PDF и залить ----------

  Annotator.prototype._save = async function () {
    var self = this;
    if (!this._hasAnyStroke()) {
      if (!confirm("Пометок нет. Всё равно отправить копию исходного файла как «проверено»?")) return;
    }
    var btn = this.root.querySelector('[data-act="save"]');
    btn.disabled = true;
    try {
      this._setStatus("Сборка проверенного PDF…");
      var pdf = this._buildOutputPdf();
      this._setStatus("Загрузка на сервер…");
      var origName = this.opts.sourceFile.name || "submission.pdf";
      var outName = "reviewed_" + origName.replace(/\.pdf$/i, "") + ".pdf";
      var blob = pdf.output("blob");
      var file = new File([blob], outName, { type: "application/pdf" });
      var meta = await CFDHomework.uploadReviewedFile(
        this.opts.assignment.id,
        this.opts.assignment.courseId,
        this.opts.student.uid,
        this.opts.student.fio || "",
        file,
        function (p) { self._setStatus("Загрузка… " + Math.round(p * 100) + "%"); }
      );
      var r = await CFDHomework.addReviewedFile(
        this.opts.assignment.id,
        this.opts.student.uid,
        meta,
        ""
      );
      if (!r.ok) throw new Error(r.error);
      this._setStatus("✓ Отправлено студенту");
      setTimeout(function () {
        if (typeof self.opts.onDone === "function") self.opts.onDone();
        self.close();
      }, 700);
    } catch (e) {
      this._setStatus("");
      alert("Не удалось отправить: " + e.message);
      btn.disabled = false;
    }
  };

  Annotator.prototype._buildOutputPdf = function () {
    var jsPDF = window.jspdf.jsPDF;
    var out = null;
    for (var i = 0; i < this.pageCanvases.length; i++) {
      var pc = this.pageCanvases[i];
      // Слить base + ink в один канвас
      var merged = document.createElement("canvas");
      merged.width = pc.baseCanvas.width;
      merged.height = pc.baseCanvas.height;
      var ctx = merged.getContext("2d");
      ctx.drawImage(pc.baseCanvas, 0, 0);
      ctx.drawImage(pc.inkCanvas, 0, 0);
      // Размеры страницы в pt. PDF.js: viewport.width = width_pt * scale
      // (в CSS-пикселях, численно совпадает с pt при scale=1). Значит
      // width_pt = viewport.width / RENDER_SCALE.
      var wPt = merged.width / RENDER_SCALE;
      var hPt = merged.height / RENDER_SCALE;
      // Первый init — создаём PDF в ориентации первой страницы.
      if (!out) {
        out = new jsPDF({
          unit: "pt",
          format: [wPt, hPt],
          orientation: wPt > hPt ? "landscape" : "portrait",
          compress: true,
        });
      } else {
        out.addPage([wPt, hPt], wPt > hPt ? "landscape" : "portrait");
      }
      var dataUrl = merged.toDataURL("image/jpeg", EXPORT_QUALITY);
      out.addImage(dataUrl, "JPEG", 0, 0, wPt, hPt);
    }
    return out;
  };

  // ---------- Public API ----------

  window.CFDAnnotator = {
    open: function (opts) {
      var a = new Annotator(opts);
      a.open();
      return a;
    },
  };
})();
