// ============================================================
// CFDAnnotator — оверлей-проверялка PDF-сдач
// ------------------------------------------------------------
// Открывает модалку c рендером всех страниц исходного PDF (PDF.js)
// и прозрачным ink-слоем поверх для пометок пером/маркером/ластиком/
// штампами, плюс стикеры-заметки (печатный текст + рукопись).
// Поддерживает Pointer Events: Apple Pencil, Wacom и мышь
// (для мыши давление всегда 0.5, для пера — реальное `pressure`).
// Пальцем на iPad НЕ рисуем — оставляем свайп для прокрутки.
//
// Совместная проверка. Все пометки сразу пишутся в Firestore
//   hw_annotations/{aid}_{uid}_{hash(file)}_p{page} = { aid, courseId, uid,
//     fileKey, fileName, page, items: { id: item }, updatedAt }
// и приходят по onSnapshot всем преподавателям курса, открывшим тот же
// файл, — каждый видит пометки другого «вживую», с подписью автора.
// item: { id, t:'pen'|'highlighter'|'stamp'|'note', c, s, o, b, g, pts,
//         by, byName, at, (note:) x, y, text, ink:[{c,s,pts}] }
// Координаты штрихов нормированы к странице (0…10000), поэтому не зависят
// от масштаба рендера. Кнопка «Отправить студенту» собирает PDF со всеми
// пометками всех авторов; сами пометки в Firestore остаются.
// Если Firestore недоступен — работает локально, как раньше.
//
// Публичный API:
//   CFDAnnotator.open({
//     assignment: { id, courseId, title },
//     student:    { uid, fio, email },
//     submission: { files, ... },
//     sourceFile: { path, name },   // один из submission.files
//     sourceBlob: Blob,             // опц.: PDF уже на руках (сдача-ссылка,
//                                   //   файл с диска) — path не нужен
//     onDone:     function() {}     // после успешной отправки
//   });
//
// Зависит от: CFDHomework (js/homework.js), PDF.js (window.pdfjsLib),
// jsPDF (window.jspdf.jsPDF), firebase compat (опционально, для совместной
// проверки).
// ============================================================

(function () {
  "use strict";

  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var RENDER_SCALE = 1.8;    // рендер PDF в canvas
  var EXPORT_QUALITY = 0.85; // JPEG quality в итоговом PDF
  var NOTE_INK_W = 480, NOTE_INK_H = 220;   // логический размер канваса рукописи в заметке
  var AUTHOR_COLORS = ["#d97706", "#2563eb", "#059669", "#9333ea", "#dc2626", "#0e7490"];

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

  // ---------- Утилиты ----------
  function fnv(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function encPts(points, W, H) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var q = points[i];
      out.push(Math.round(q.x / W * 10000) + "," + Math.round(q.y / H * 10000) + "," + Math.round((q.p != null ? q.p : 0.5) * 100));
    }
    return out.join(";");
  }
  function decPts(str, W, H) {
    if (!str) return [];
    var parts = str.split(";"), out = [];
    for (var i = 0; i < parts.length; i++) {
      var a = parts[i].split(",");
      out.push({ x: (+a[0]) / 10000 * W, y: (+a[1]) / 10000 * H, p: (+a[2]) / 100 });
    }
    return out;
  }
  function initials(name) {
    var w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "?";
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[1][0]).toUpperCase();
  }
  function authorColor(email) {
    var h = 0; for (var i = 0; i < (email || "").length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
  }
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- Модель ----------
  // stroke: { id, tool: 'pen'|'highlighter'|'stamp', color, size, opacity, blend,
  //           glyph?, points: [{x,y,p}], by, byName, at }
  // note:   { id, x, y (0..1), text, ink: [{c,s,pts}], by, byName, at, color }

  function newState(pagesCount) {
    var pages = [];
    for (var i = 0; i < pagesCount; i++) pages.push({ strokes: [], notes: [] });
    return { pages: pages, currentPage: 0 };
  }

  // ---------- Основной класс ----------

  function Annotator(opts) {
    this.opts = opts || {};
    this.pdf = null;
    this.pageCanvases = [];   // [{holder, wrap, baseCanvas, inkCanvas, viewport, pageIndex, noteEls}]
    this.state = null;
    this.tool = "pen";
    this.color = "#dc2626";
    this.size = 2.2;
    this.stampGlyph = "✓";
    this.activeStroke = null;
    this.activePage = null;
    this.drawing = false;
    this.erased = {};          // pageIndex -> [ids], накоплено за один проход ластика
    this.myUndo = [];          // [{page, item}] — мои действия для Ctrl+Z
    this.myRedo = [];
    this.root = null;
    this.status = null;
    this.pdfBlob = null;
    this.db = null;
    this.unsub = null;
    this.me = { email: "", name: "преподаватель", uid: "" };
    this.authors = {};         // email -> name
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
    // Другие фиксированные окна страницы (например, таблица сдач в админке)
    // прячем сами, чтобы проверялка ни при каких стилях не оказалась «за» ними;
    // при закрытии возвращаем.
    this._hidden = [];
    try {
      var others = document.querySelectorAll(".hw-subs-modal, [data-hide-under-annotator]");
      for (var oi = 0; oi < others.length; oi++) {
        var el = others[oi];
        if (el === this.root || getComputedStyle(el).display === "none") continue;
        this._hidden.push({ el: el, display: el.style.display });
        el.style.display = "none";
      }
    } catch (_) {}
    try {
      var blob = this.opts.sourceBlob || null;
      if (!blob) {
        this._setStatus("Скачивание файла…");
        var self = this;
        var dl = await CFDHomework.downloadFile(this.opts.sourceFile.path, function (p) {
          self._setStatus("Скачивание файла… " + Math.round(p * 100) + "%");
        });
        blob = dl.blob;
      }
      this.pdfBlob = blob;
      this._setStatus("Рендер PDF…");
      var buf = await blob.arrayBuffer();
      var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      this.pdf = pdf;
      this.state = newState(pdf.numPages);
      await this._renderAllPages();
      this._setStatus("");
      this._updateToolbar();
      await this._syncInit();
    } catch (e) {
      this._setStatus("");
      alert("Не удалось открыть PDF: " + e.message);
      this.close();
    }
  };

  Annotator.prototype.close = function () {
    if (this.unsub) { try { this.unsub(); } catch (_) {} this.unsub = null; }
    if (this._kb) document.removeEventListener("keydown", this._kb);
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    document.body.style.overflow = "";
    this.root = null;
    var hidden = this._hidden || []; this._hidden = [];
    for (var hi = 0; hi < hidden.length; hi++) {
      try { hidden[hi].el.style.display = hidden[hi].display || "flex"; } catch (_) {}
    }
    if (typeof this.opts.onClose === "function") { try { this.opts.onClose(); } catch (_) {} }
  };

  Annotator.prototype._setStatus = function (msg) {
    if (this.status) this.status.textContent = msg || "";
  };

  // ---------- Совместная проверка: Firestore ----------

  Annotator.prototype._syncInit = async function () {
    var self = this;
    if (typeof firebase === "undefined" || !firebase.firestore || !firebase.auth) return;
    var u = firebase.auth().currentUser;
    if (!u) return;
    var f = this.opts.sourceFile || {};
    this.fileKey = this.opts.assignment.id + "_" + this.opts.student.uid + "_" + fnv(f.path || f.name || "file");
    this.db = firebase.firestore();
    this.me = { email: u.email || "", name: u.displayName || u.email || "преподаватель", uid: u.uid };
    try {
      var d = await this.db.collection("users").doc(u.uid).get();
      if (d.exists && d.data().fio) this.me.name = d.data().fio;
    } catch (_) {}
    this.authors[this.me.email] = this.me.name;
    this.unsub = this.db.collection("hw_annotations")
      .where("courseId", "==", this.opts.assignment.courseId)
      .where("fileKey", "==", this.fileKey)
      .onSnapshot(function (snap) { self._applySnapshot(snap); }, function (err) {
        console.warn("hw_annotations", err);
        self._setStatus("Совместные пометки недоступны (" + (err.code || err.message) + ") — работаем локально");
        self.db = null;
      });
  };

  Annotator.prototype._docRef = function (pageIndex) {
    return this.db.collection("hw_annotations").doc(this.fileKey + "_p" + pageIndex);
  };
  Annotator.prototype._docBase = function (pageIndex) {
    var f = this.opts.sourceFile || {};
    return {
      aid: this.opts.assignment.id, courseId: this.opts.assignment.courseId, uid: this.opts.student.uid,
      fileKey: this.fileKey, fileName: f.name || "", filePath: f.path || "", page: pageIndex,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
  };
  // Записать/обновить элемент (patch — поля элемента; merge вглубь).
  Annotator.prototype._syncPut = function (pageIndex, id, patch) {
    if (!this.db) return Promise.resolve();
    var self = this;
    var doc = this._docBase(pageIndex); doc.items = {}; doc.items[id] = patch;
    return this._docRef(pageIndex).set(doc, { merge: true }).catch(function (e) {
      self._setStatus("Не сохранилось: " + (e.code || e.message));
    });
  };
  Annotator.prototype._syncDel = function (pageIndex, ids) {
    if (!this.db || !ids.length) return Promise.resolve();
    var self = this;
    var doc = this._docBase(pageIndex); doc.items = {};
    ids.forEach(function (id) { doc.items[id] = firebase.firestore.FieldValue.delete(); });
    return this._docRef(pageIndex).set(doc, { merge: true }).catch(function (e) {
      self._setStatus("Не удалилось: " + (e.code || e.message));
    });
  };

  Annotator.prototype._strokeToItem = function (p, st) {
    return {
      id: st.id, t: st.tool, c: st.color, s: st.size, o: st.opacity != null ? st.opacity : 1,
      b: st.blend || "source-over", g: st.glyph || "", pts: encPts(st.points, p.baseW, p.baseH),
      by: st.by, byName: st.byName, at: st.at,
    };
  };
  Annotator.prototype._itemToStroke = function (p, it) {
    return {
      id: it.id, tool: it.t, color: it.c, size: it.s, opacity: it.o, blend: it.b, glyph: it.g,
      points: decPts(it.pts, p.baseW, p.baseH), by: it.by, byName: it.byName, at: it.at,
    };
  };

  Annotator.prototype._applySnapshot = function (snap) {
    var self = this;
    this.synced = true;
    snap.forEach(function (doc) {
      var data = doc.data() || {};
      var pageIndex = data.page;
      var p = self.pageCanvases[pageIndex];
      if (!p) return;
      var items = data.items || {};
      var list = Object.keys(items).map(function (k) { var it = items[k]; it.id = it.id || k; return it; });
      list.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      var strokes = [], notes = [];
      list.forEach(function (it) {
        if (it.by && it.byName) self.authors[it.by] = it.byName;
        if (it.t === "note") notes.push(it);
        else strokes.push(self._itemToStroke(p, it));
      });
      // штрих, который рисуется прямо сейчас, ещё не записан — оставляем его сверху
      if (self.drawing && self.activeStroke && self.activePage === p) strokes.push(self.activeStroke);
      self.state.pages[pageIndex].strokes = strokes;
      self.state.pages[pageIndex].notes = notes;
      self._redrawPage(p);
      self._renderNotes(p);
    });
    this._renderAuthors();
  };

  Annotator.prototype._renderAuthors = function () {
    var el = this.root && this.root.querySelector(".cfd-annot-authors");
    if (!el) return;
    var self = this;
    var names = Object.keys(this.authors).map(function (em) {
      var mine = em === self.me.email;
      return '<span class="cfd-annot-author" style="border-color:' + authorColor(em) + '"><i style="background:' + authorColor(em) + '"></i>' + esc(mine ? "Вы" : self.authors[em]) + "</span>";
    });
    el.innerHTML = names.length ? "Пометки: " + names.join(" ") : "";
  };

  // ---------- Зум ----------

  Annotator.prototype._applyZoom = function () {
    if (!this.pageCanvases.length) return;
    var z = this.zoom || 1;
    for (var i = 0; i < this.pageCanvases.length; i++) {
      var pc = this.pageCanvases[i];
      pc.holder.style.width = (pc.baseW * z) + "px";
      pc.holder.style.height = (pc.baseH * z) + "px";
      pc.wrap.style.transform = "scale(" + z + ")";
    }
    var val = this.root && this.root.querySelector(".cfd-annot-zoom-val");
    if (val) val.textContent = Math.round(z * 100) + "%";
  };

  Annotator.prototype._zoomBy = function (delta, centerClientX, centerClientY) {
    var box = this.root && this.root.querySelector(".cfd-annot-pages");
    if (!box) return;
    var oldZ = this.zoom || 1;
    var newZ = Math.max(0.25, Math.min(4, oldZ * delta));
    if (Math.abs(newZ - oldZ) < 0.001) return;
    var rect = box.getBoundingClientRect();
    var cx = (centerClientX != null) ? (centerClientX - rect.left) : rect.width / 2;
    var cy = (centerClientY != null) ? (centerClientY - rect.top)  : rect.height / 2;
    var sx = (box.scrollLeft + cx) / oldZ;
    var sy = (box.scrollTop + cy) / oldZ;
    this.zoom = newZ;
    this._applyZoom();
    box.scrollLeft = sx * newZ - cx;
    box.scrollTop  = sy * newZ - cy;
  };

  Annotator.prototype._zoomFit = function () {
    var box = this.root && this.root.querySelector(".cfd-annot-pages");
    if (!box || !this.pageCanvases.length) return;
    var maxW = this.pageCanvases[0].baseW;
    for (var i = 0; i < this.pageCanvases.length; i++) {
      if (this.pageCanvases[i].baseW > maxW) maxW = this.pageCanvases[i].baseW;
    }
    var avail = box.clientWidth - 32;
    this.zoom = Math.max(0.25, Math.min(4, avail / maxW));
    this._applyZoom();
    box.scrollLeft = 0;
    box.scrollTop = 0;
  };

  Annotator.prototype._zoomReset = function () {
    this.zoom = 1;
    this._applyZoom();
  };

  // ---------- UI ----------

  Annotator.prototype._buildShell = function () {
    var self = this;
    var root = document.createElement("div");
    root.className = "cfd-annot-root";
    root.innerHTML =
      '<style>' +
      '.cfd-annot-root{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483000;background:#f5f2ec;font-family:"Source Serif 4",Georgia,serif;color:#1a1a1a;display:flex;flex-direction:column}' +
      '.cfd-annot-top{display:flex;align-items:center;gap:.5rem;padding:.5rem .8rem;background:#fff;border-bottom:1px solid #d8d0c0;box-shadow:0 1px 3px rgba(0,0,0,.05);flex-wrap:wrap}' +
      '.cfd-annot-who{display:flex;flex-direction:column;gap:.05rem;padding:.28rem .7rem;background:linear-gradient(180deg,#fff8dc,#f6e9b8);border:1px solid #d5b558;border-radius:6px;min-width:0;max-width:52ch}' +
      '.cfd-annot-who .who-name{font-family:"Playfair Display",serif;font-size:1rem;font-weight:700;color:#3a2f1a;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cfd-annot-who .who-meta{font-family:"JetBrains Mono",monospace;font-size:.7rem;color:#7a6a4a;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cfd-annot-top .title{font-family:"Playfair Display",serif;font-size:.92rem;color:#5a4a2a;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.cfd-annot-top .status{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:#7a6a4a}' +
      '.cfd-annot-authors{font-family:"JetBrains Mono",monospace;font-size:.72rem;color:#7a6a4a;display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}' +
      '.cfd-annot-author{display:inline-flex;align-items:center;gap:.3rem;border:1px solid;border-radius:999px;padding:.05rem .5rem .05rem .3rem;color:#3a2f1a;background:#fff}' +
      '.cfd-annot-author i{width:9px;height:9px;border-radius:50%;display:inline-block}' +
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
      '.cfd-annot-swatch button{width:100%;height:30px;aspect-ratio:1;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}' +
      '.cfd-annot-swatch button.active{border-color:#3a2f1a;box-shadow:0 0 0 1px #fff inset}' +
      '.cfd-annot-sizes{display:flex;flex-direction:column;gap:3px;margin-top:.2rem;align-items:center}' +
      '.cfd-annot-sizes button{background:#fff;border:1px solid #c8bfa8;border-radius:4px;padding:2px 0;width:100%;cursor:pointer;font-size:.7rem;color:#3a2f1a;font-family:inherit}' +
      '.cfd-annot-sizes button.active{background:#3a2f1a;color:#fff;border-color:#3a2f1a}' +
      '.cfd-annot-tool-label{font-family:"JetBrains Mono",monospace;font-size:.66rem;color:#7a6a4a;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-top:.3rem}' +
      '.cfd-annot-pages{flex:1;overflow:auto;padding:1rem;background:#e6e0d0}' +
      '.cfd-annot-page-wrap{position:absolute;left:0;top:0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15);display:block;transform-origin:0 0;will-change:transform}' +
      '.cfd-annot-page-wrap canvas{display:block}' +
      '.cfd-annot-ink{position:absolute;left:0;top:0;touch-action:pan-y;cursor:crosshair}' +
      '.cfd-annot-page-num{position:absolute;top:-1.6rem;left:0;font-family:"JetBrains Mono",monospace;font-size:.78rem;color:#7a6a4a}' +
      '.cfd-annot-zoom{display:inline-flex;align-items:center;gap:2px;background:#fdf9f0;border:1px solid #c8bfa8;border-radius:5px;padding:2px}' +
      '.cfd-annot-zoom .cfd-annot-zoom-btn{border:none;padding:.15rem .5rem;font-size:.95rem;min-width:1.8rem;background:transparent}' +
      '.cfd-annot-zoom .cfd-annot-zoom-btn:hover{background:#f0e6ce}' +
      '.cfd-annot-zoom-val{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:#5a4a2a;min-width:3rem;text-align:center;user-select:none}' +
      '.cfd-annot-page-holder{margin:0 auto 1.5rem;display:block}' +
      // --- заметки-стикеры ---
      '.cfd-note{position:absolute;z-index:5;font-family:"Source Serif 4",Georgia,serif}' +
      '.cfd-note-pin{width:30px;height:30px;border-radius:5px 5px 5px 13px;color:#fff;font:bold 12px "JetBrains Mono",monospace;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3);border:1px solid rgba(0,0,0,.25);user-select:none;touch-action:none}' +
      '.cfd-note-pin.open{outline:2px solid #3a2f1a}' +
      '.cfd-note-box{position:absolute;left:36px;top:0;width:280px;background:#fff8c8;border:1px solid #d5b558;box-shadow:0 6px 18px rgba(0,0,0,.28);border-radius:6px;padding:6px;font-size:14px;cursor:default}' +
      '.cfd-note-box[hidden]{display:none}' +
      '.cfd-note-head{display:flex;align-items:center;gap:.3rem;font:11px "JetBrains Mono",monospace;color:#5a4a2a;margin-bottom:4px}' +
      '.cfd-note-head .cfd-note-by{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.cfd-note-head button{background:#fff;border:1px solid #c8bfa8;border-radius:4px;cursor:pointer;font-size:12px;padding:1px 6px;color:#3a2f1a}' +
      '.cfd-note-text{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;border:1px solid #e3cf8a;border-radius:4px;padding:5px 6px;font:14px/1.35 "Source Serif 4",Georgia,serif;background:#fffdf3;color:#1a1a1a}' +
      '.cfd-note-inkwrap{margin-top:5px;font:10px "JetBrains Mono",monospace;color:#7a6a4a}' +
      '.cfd-note-ink{display:block;width:100%;height:122px;background:#fffdf3;border:1px dashed #d5b558;border-radius:4px;touch-action:none;cursor:crosshair}' +
      '.cfd-note-foot{display:flex;justify-content:space-between;align-items:center;margin-top:3px}' +
      '.cfd-note-foot button{background:none;border:none;color:#7a6a4a;cursor:pointer;font:10px "JetBrains Mono",monospace;text-decoration:underline;padding:0}' +
      '@media (max-width:700px){.cfd-annot-tools{width:72px;padding:.3rem}.cfd-annot-tool{padding:.25rem;font-size:.62rem}.cfd-annot-tool svg{width:18px;height:18px}}' +
      '</style>' +
      '<div class="cfd-annot-top">' +
        '<div class="cfd-annot-who" title=""><span class="who-name"></span><span class="who-meta"></span></div>' +
        '<span class="title"></span>' +
        '<span class="cfd-annot-authors" title="Пометки сохраняются автоматически и видны всем преподавателям курса, открывшим этот файл"></span>' +
        '<span class="status"></span>' +
        '<div class="cfd-annot-zoom" title="Масштаб (Ctrl+колесо, Ctrl± , Ctrl+0)">' +
          '<button class="cfd-annot-btn cfd-annot-zoom-btn" data-act="zoom-out">−</button>' +
          '<button class="cfd-annot-btn cfd-annot-zoom-btn" data-act="zoom-fit" title="Вписать по ширине">↔</button>' +
          '<span class="cfd-annot-zoom-val">100%</span>' +
          '<button class="cfd-annot-btn cfd-annot-zoom-btn" data-act="zoom-in">+</button>' +
        '</div>' +
        '<button class="cfd-annot-btn" data-act="undo" title="Отменить моё последнее действие (Ctrl+Z)">↶ Отмена</button>' +
        '<button class="cfd-annot-btn" data-act="redo" title="Повторить (Ctrl+Y)">↷ Повтор</button>' +
        '<button class="cfd-annot-btn" data-act="clear" title="Стереть все пометки на текущей странице (всех авторов)">Очистить страницу</button>' +
        '<button class="cfd-annot-btn primary" data-act="save" title="Собрать PDF со всеми пометками и положить студенту в «проверено»">💾 Отправить студенту</button>' +
        '<button class="cfd-annot-btn danger" data-act="close" title="Пометки уже сохранены и останутся; студенту они уйдут только по кнопке «Отправить»">✕ Закрыть</button>' +
      '</div>' +
      '<div class="cfd-annot-body">' +
        '<div class="cfd-annot-tools">' +
          '<button class="cfd-annot-tool" data-tool="pen">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21l3.5-1 11-11-2.5-2.5L4 17.5 3 21z" stroke="#3a2f1a" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 6.5l2.5 2.5" stroke="#3a2f1a" stroke-width="1.6"/></svg>' +
            '<span>Перо</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="highlighter" title="Полупрозрачный маркер: проведите по строке">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M8 15l6-6 3 3-6 6H8v-3z" fill="#f6d743" stroke="#3a2f1a" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 20h14" stroke="#3a2f1a" stroke-width="1.6"/></svg>' +
            '<span>Маркер</span>' +
          '</button>' +
          '<button class="cfd-annot-tool" data-tool="note" title="Стикер с заметкой: щёлкните по странице, напечатайте или напишите пером">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16v12l-4 4H4V4z" fill="#ffe680" stroke="#3a2f1a" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 20v-4h4" stroke="#3a2f1a" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h10M7 12h7" stroke="#3a2f1a" stroke-width="1.4"/></svg>' +
            '<span>Заметка</span>' +
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
            '<button data-color="#f6d743" style="background:#f6d743" title="Жёлтый (маркер)"></button>' +
            '<button data-color="#fb923c" style="background:#fb923c" title="Оранжевый (маркер)"></button>' +
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
    // Дублируем ключевые стили инлайном: даже если <style> внутри root не
    // применился, оверлей остаётся на весь экран и поверх всего.
    root.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483000";
    document.body.appendChild(root);
    this.root = root;

    var stu = this.opts.student || {};
    var whoName = stu.fio || stu.email || stu.uid || "—";
    var whoMetaParts = [];
    if (stu.studyGroup) whoMetaParts.push(stu.studyGroup);
    if (stu.email && stu.fio) whoMetaParts.push(stu.email);
    root.querySelector(".who-name").textContent = whoName;
    root.querySelector(".who-meta").textContent = whoMetaParts.join(" · ");
    root.querySelector(".cfd-annot-who").title =
      whoName + (whoMetaParts.length ? "  (" + whoMetaParts.join(" · ") + ")" : "");
    root.querySelector(".title").textContent =
      "✏️ " + (this.opts.assignment.title || this.opts.assignment.id) +
      " · " + (this.opts.sourceFile.name || "");
    this.status = root.querySelector(".status");

    root.querySelector('[data-act="close"]').addEventListener("click", function () {
      if (!self.db && self._hasAnyStroke() && !confirm("Совместное сохранение недоступно: пометки будут потеряны. Закрыть?")) return;
      self.close();
    });
    root.querySelector('[data-act="save"]').addEventListener("click", function () { self._save(); });
    root.querySelector('[data-act="undo"]').addEventListener("click", function () { self._undo(); });
    root.querySelector('[data-act="redo"]').addEventListener("click", function () { self._redo(); });
    root.querySelector('[data-act="clear"]').addEventListener("click", function () { self._clearCurrentPage(); });
    root.querySelector('[data-act="zoom-in"]').addEventListener("click", function () { self._zoomBy(1.15); });
    root.querySelector('[data-act="zoom-out"]').addEventListener("click", function () { self._zoomBy(1 / 1.15); });
    root.querySelector('[data-act="zoom-fit"]').addEventListener("click", function () { self._zoomFit(); });

    root.querySelectorAll(".cfd-annot-tool").forEach(function (btn) {
      btn.addEventListener("click", function () { self._selectTool(btn.getAttribute("data-tool")); });
    });
    root.querySelectorAll("[data-swatch] button").forEach(function (b) {
      b.addEventListener("click", function () { self.color = b.getAttribute("data-color"); self._updateToolbar(); });
    });
    root.querySelectorAll("[data-sizes] button").forEach(function (b) {
      b.addEventListener("click", function () { self.size = parseFloat(b.getAttribute("data-size")); self._updateToolbar(); });
    });

    root.tabIndex = -1;
    root.focus();
    document.addEventListener("keydown", this._kb = function (e) {
      if (!self.root) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "TEXTAREA" || tag === "INPUT") return;      // печатаем в заметке
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); self._undo(); }
      else if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); self._redo(); }
      else if (ctrl && (e.key === "=" || e.key === "+")) { e.preventDefault(); self._zoomBy(1.15); }
      else if (ctrl && e.key === "-") { e.preventDefault(); self._zoomBy(1 / 1.15); }
      else if (ctrl && e.key === "0") { e.preventDefault(); self._zoomReset(); }
    });
    var pagesEl = root.querySelector(".cfd-annot-pages");
    pagesEl.addEventListener("wheel", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      self._zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }, { passive: false });
    pagesEl.addEventListener("gesturestart", function (e) { e.preventDefault(); self._gestureStartZoom = self.zoom || 1; });
    pagesEl.addEventListener("gesturechange", function (e) {
      e.preventDefault();
      if (!self._gestureStartZoom) return;
      self._zoomBy((self._gestureStartZoom * e.scale) / (self.zoom || 1), e.clientX, e.clientY);
    });
    pagesEl.addEventListener("gestureend", function () { self._gestureStartZoom = null; });
  };

  Annotator.prototype._selectTool = function (t) {
    if (t === "stamp-check")      { this.tool = "stamp"; this.stampGlyph = "✓"; this.color = "#0a8a3a"; }
    else if (t === "stamp-cross") { this.tool = "stamp"; this.stampGlyph = "✗"; this.color = "#c02020"; }
    else if (t === "stamp-minus") { this.tool = "stamp"; this.stampGlyph = "−1"; this.color = "#c02020"; }
    else if (t === "highlighter") { this.tool = "highlighter"; if (this.color === "#1a1a1a") this.color = "#f6d743"; }
    else if (t === "eraser")      { this.tool = "eraser"; }
    else if (t === "note")        { this.tool = "note"; }
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
    var pages = this.root.querySelector(".cfd-annot-pages");
    if (this.tool === "eraser") pages.style.cursor = "cell";
    else if (this.tool === "stamp" || this.tool === "note") pages.style.cursor = "copy";
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
      var holder = document.createElement("div");
      holder.className = "cfd-annot-page-holder";
      holder.style.position = "relative";
      holder.style.width = viewport.width + "px";
      holder.style.height = viewport.height + "px";
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
      holder.appendChild(wrap);
      box.appendChild(holder);
      await page.render({ canvasContext: base.getContext("2d"), viewport: viewport }).promise;
      this.pageCanvases.push({
        pageIndex: i - 1, pageNum: i,
        holder: holder, wrap: wrap, baseCanvas: base, inkCanvas: ink, viewport: viewport,
        baseW: viewport.width, baseH: viewport.height, noteEls: {},
      });
      this._attachInkHandlers(this.pageCanvases[i - 1]);
    }
    this._setStatus("");
    this._zoomFit();
  };

  // ---------- Ink layer: pointer events ----------

  Annotator.prototype._attachInkHandlers = function (p) {
    var self = this;
    var el = p.inkCanvas;

    function getPos(e) {
      var rect = el.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * (el.width / rect.width), y: (e.clientY - rect.top) * (el.height / rect.height) };
    }
    function pressureOf(e) {
      if (e.pointerType === "mouse") return 0.5;
      if (typeof e.pressure === "number" && e.pressure > 0) return e.pressure;
      return 0.5;
    }
    function acceptPointer(e) { return e.pointerType !== "touch"; }

    el.addEventListener("pointerdown", function (e) {
      // Заметку можно поставить и пальцем — это не рисование
      if (self.tool === "note") {
        e.preventDefault();
        self.state.currentPage = p.pageIndex;
        self._createNote(p, getPos(e));
        return;
      }
      if (!acceptPointer(e)) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      self.state.currentPage = p.pageIndex;
      var pos = getPos(e);
      if (self.tool === "stamp") {
        var stroke = self._newStroke({
          tool: "stamp", color: self.color, size: Math.max(28, self.size * 12), glyph: self.stampGlyph,
          opacity: 1, blend: "source-over", points: [{ x: pos.x, y: pos.y, p: 1 }],
        });
        self.state.pages[p.pageIndex].strokes.push(stroke);
        self._redrawPage(p);
        self._commitStroke(p, stroke);
        return;
      }
      if (self.tool === "eraser") {
        self.drawing = true;
        self.erased[p.pageIndex] = self.erased[p.pageIndex] || [];
        self._eraseAt(p, pos, 14);
        return;
      }
      var st;
      if (self.tool === "highlighter") {
        st = self._newStroke({
          tool: "highlighter", color: (self.color === "#1a1a1a" ? "#f6d743" : self.color),
          size: Math.max(10, self.size * 6), opacity: 0.28, blend: "multiply",
          points: [{ x: pos.x, y: pos.y, p: 1 }],
        });
      } else {
        st = self._newStroke({
          tool: "pen", color: self.color, size: self.size, opacity: 1, blend: "source-over",
          points: [{ x: pos.x, y: pos.y, p: pressureOf(e) }],
        });
      }
      self.activeStroke = st;
      self.activePage = p;
      self.drawing = true;
      self.state.pages[p.pageIndex].strokes.push(st);
      self._drawStrokeSegment(p, st, st.points.length - 1);
    });

    el.addEventListener("pointermove", function (e) {
      if (!self.drawing) return;
      if (!acceptPointer(e)) return;
      e.preventDefault();
      var pos = getPos(e);
      if (self.tool === "eraser") { self._eraseAt(p, pos, 14); return; }
      if (!self.activeStroke) return;
      self.activeStroke.points.push({ x: pos.x, y: pos.y, p: pressureOf(e) });
      // маркер рисуется целиком одним путём (иначе полупрозрачные сегменты
      // накладываются и получаются «бусы»), перо — посегментно
      if (self.activeStroke.tool === "highlighter") self._redrawPage(p);
      else self._drawStrokeSegment(p, self.activeStroke, self.activeStroke.points.length - 1);
    });

    function finish(e) {
      if (!self.drawing) return;
      self.drawing = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (self.tool === "eraser") {
        var ids = self.erased[p.pageIndex] || [];
        self.erased[p.pageIndex] = [];
        if (ids.length) self._syncDel(p.pageIndex, ids);
        return;
      }
      var st = self.activeStroke;
      self.activeStroke = null; self.activePage = null;
      if (st) self._commitStroke(p, st);
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
  };

  Annotator.prototype._newStroke = function (base) {
    base.id = newId(); base.by = this.me.email; base.byName = this.me.name; base.at = Date.now();
    return base;
  };
  // Штрих закончен: в Firestore + в мой стек отмены
  Annotator.prototype._commitStroke = function (p, st) {
    var item = this._strokeToItem(p, st);
    this.myUndo.push({ page: p.pageIndex, item: item });
    this.myRedo.length = 0;
    this._syncPut(p.pageIndex, item.id, item);
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
      if (st.tool === "stamp") { this._drawStrokeSegment(p, st, 0); continue; }
      if (st.tool === "highlighter") { this._drawWholePath(ctx, st); continue; }
      for (var i = 1; i < st.points.length; i++) this._drawStrokeSegment(p, st, i);
    }
  };

  // Весь штрих одним путём с постоянной толщиной (маркер): альфа накладывается один раз
  Annotator.prototype._drawWholePath = function (ctx, st) {
    if (!st.points.length) return;
    ctx.save();
    ctx.globalCompositeOperation = st.blend || "multiply";
    ctx.globalAlpha = st.opacity != null ? st.opacity : 0.28;
    ctx.strokeStyle = st.color; ctx.lineWidth = st.size; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(st.points[0].x, st.points[0].y);
    if (st.points.length === 1) ctx.lineTo(st.points[0].x + 0.1, st.points[0].y);
    for (var i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
    ctx.stroke();
    ctx.restore();
  };

  // ---------- Ластик ----------

  Annotator.prototype._eraseAt = function (p, pos, radius) {
    var page = this.state.pages[p.pageIndex];
    var r2 = radius * radius, removed = false, kept = [];
    for (var i = 0; i < page.strokes.length; i++) {
      var st = page.strokes[i], hit = false;
      if (st.tool === "stamp") {
        var dx = st.points[0].x - pos.x, dy = st.points[0].y - pos.y;
        if (dx * dx + dy * dy <= (st.size * 0.6) * (st.size * 0.6)) hit = true;
      } else {
        for (var k = 0; k < st.points.length; k++) {
          var ex = st.points[k].x - pos.x, ey = st.points[k].y - pos.y;
          if (ex * ex + ey * ey <= r2) { hit = true; break; }
        }
      }
      if (hit) {
        removed = true;
        (this.erased[p.pageIndex] = this.erased[p.pageIndex] || []).push(st.id);
        this.myUndo.push({ page: p.pageIndex, item: this._strokeToItem(p, st), deleted: true });
      } else kept.push(st);
    }
    if (removed) { page.strokes = kept; this._redrawPage(p); }
  };

  // ---------- Undo / Redo / Clear (только свои действия; в Firestore) ----------

  Annotator.prototype._undo = function () {
    if (!this.state || !this.myUndo.length) return;
    var a = this.myUndo.pop();
    var p = this.pageCanvases[a.page];
    if (a.deleted) {                    // отменяем стирание — возвращаем штрих
      this.state.pages[a.page].strokes.push(this._itemToStroke(p, a.item));
      this._syncPut(a.page, a.item.id, a.item);
    } else {
      this.state.pages[a.page].strokes = this.state.pages[a.page].strokes.filter(function (s) { return s.id !== a.item.id; });
      this._syncDel(a.page, [a.item.id]);
    }
    this.myRedo.push(a);
    this._redrawPage(p);
  };
  Annotator.prototype._redo = function () {
    if (!this.state || !this.myRedo.length) return;
    var a = this.myRedo.pop();
    var p = this.pageCanvases[a.page];
    if (a.deleted) {
      this.state.pages[a.page].strokes = this.state.pages[a.page].strokes.filter(function (s) { return s.id !== a.item.id; });
      this._syncDel(a.page, [a.item.id]);
    } else {
      this.state.pages[a.page].strokes.push(this._itemToStroke(p, a.item));
      this._syncPut(a.page, a.item.id, a.item);
    }
    this.myUndo.push(a);
    this._redrawPage(p);
  };
  Annotator.prototype._clearCurrentPage = function () {
    if (!this.state) return;
    var idx = this._activePageIdx();
    var page = this.state.pages[idx];
    if (!page || (!page.strokes.length && !page.notes.length)) return;
    if (!confirm("Стереть все пометки и заметки на этой странице (всех авторов)?")) return;
    var ids = page.strokes.map(function (s) { return s.id; }).concat(page.notes.map(function (n) { return n.id; }));
    page.strokes = []; page.notes = [];
    this._redrawPage(this.pageCanvases[idx]);
    this._renderNotes(this.pageCanvases[idx]);
    this._syncDel(idx, ids);
  };

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
    return this.state.pages.some(function (p) { return p.strokes.length > 0 || p.notes.length > 0; });
  };

  // ---------- Заметки-стикеры ----------

  Annotator.prototype._createNote = function (p, pos) {
    var note = {
      id: newId(), t: "note", x: pos.x / p.baseW, y: pos.y / p.baseH, text: "", ink: [],
      by: this.me.email, byName: this.me.name, at: Date.now(), color: authorColor(this.me.email),
    };
    this.state.pages[p.pageIndex].notes.push(note);
    this._renderNotes(p);
    var el = p.noteEls[note.id];
    if (el) { this._toggleNote(el, true); var ta = el.querySelector(".cfd-note-text"); if (ta) ta.focus(); }
    this.myUndo.push({ page: p.pageIndex, item: note });
    this.myRedo.length = 0;
    this._syncPut(p.pageIndex, note.id, note);
  };

  // Синхронизировать DOM стикеров страницы с state.pages[i].notes
  Annotator.prototype._renderNotes = function (p) {
    var self = this;
    var notes = this.state.pages[p.pageIndex].notes;
    var alive = {};
    notes.forEach(function (n) {
      alive[n.id] = true;
      var el = p.noteEls[n.id];
      if (!el) { el = self._buildNoteEl(p, n); p.noteEls[n.id] = el; p.wrap.appendChild(el); }
      self._updateNoteEl(p, el, n);
    });
    Object.keys(p.noteEls).forEach(function (id) {
      if (!alive[id]) { var el = p.noteEls[id]; if (el.parentNode) el.parentNode.removeChild(el); delete p.noteEls[id]; }
    });
  };

  Annotator.prototype._buildNoteEl = function (p, note) {
    var self = this;
    var el = document.createElement("div");
    el.className = "cfd-note";
    el.setAttribute("data-id", note.id);
    el.innerHTML =
      '<div class="cfd-note-pin" title="Заметка: нажмите, чтобы открыть; тяните, чтобы переместить"></div>' +
      '<div class="cfd-note-box" hidden>' +
        '<div class="cfd-note-head"><span class="cfd-note-by"></span>' +
          '<button data-n="del" title="Удалить заметку">🗑</button><button data-n="fold" title="Свернуть">▾</button></div>' +
        '<textarea class="cfd-note-text" placeholder="Напечатайте замечание…"></textarea>' +
        '<div class="cfd-note-inkwrap">или напишите пером:' +
          '<canvas class="cfd-note-ink" width="' + NOTE_INK_W + '" height="' + NOTE_INK_H + '"></canvas></div>' +
        '<div class="cfd-note-foot"><span class="cfd-note-saved"></span><button data-n="clearink">стереть рукопись</button></div>' +
      '</div>';
    var pin = el.querySelector(".cfd-note-pin");
    var box = el.querySelector(".cfd-note-box");
    var ta = el.querySelector(".cfd-note-text");
    var cv = el.querySelector(".cfd-note-ink");
    var pageIndex = p.pageIndex;

    // --- пин: тап = открыть/закрыть, перетаскивание = переместить ---
    var drag = null;
    pin.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      pin.setPointerCapture(e.pointerId);
      drag = { x0: e.clientX, y0: e.clientY, moved: false };
    });
    pin.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.moved = true;
      var rect = p.inkCanvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (p.inkCanvas.width / rect.width);
      var y = (e.clientY - rect.top) * (p.inkCanvas.height / rect.height);
      el.style.left = Math.max(0, Math.min(p.baseW - 30, x - 15)) + "px";
      el.style.top = Math.max(0, Math.min(p.baseH - 30, y - 15)) + "px";
    });
    function pinUp(e) {
      if (!drag) return;
      try { pin.releasePointerCapture(e.pointerId); } catch (_) {}
      var n = self._findNote(pageIndex, note.id);
      if (drag.moved && n) {
        n.x = (parseFloat(el.style.left) + 15) / p.baseW; n.y = (parseFloat(el.style.top) + 15) / p.baseH;
        self._syncPut(pageIndex, n.id, { x: n.x, y: n.y });
      } else {
        self._toggleNote(el);
      }
      drag = null;
    }
    pin.addEventListener("pointerup", pinUp);
    pin.addEventListener("pointercancel", pinUp);

    // --- кнопки ---
    el.querySelector('[data-n="fold"]').addEventListener("click", function (e) { e.stopPropagation(); self._toggleNote(el, false); });
    el.querySelector('[data-n="del"]').addEventListener("click", function (e) {
      e.stopPropagation();
      var n = self._findNote(pageIndex, note.id);
      if (!n) return;
      if ((n.text || n.ink.length) && !confirm("Удалить заметку?")) return;
      self.state.pages[pageIndex].notes = self.state.pages[pageIndex].notes.filter(function (q) { return q.id !== n.id; });
      self._renderNotes(p);
      self.myUndo.push({ page: pageIndex, item: n, deleted: true });
      self._syncDel(pageIndex, [n.id]);
    });
    el.querySelector('[data-n="clearink"]').addEventListener("click", function (e) {
      e.stopPropagation();
      var n = self._findNote(pageIndex, note.id);
      if (!n) return;
      n.ink = [];
      self._drawNoteInk(cv, n);
      self._syncPut(pageIndex, n.id, { ink: [] });
    });
    // --- текст: автосохранение ---
    var tT = null;
    ta.addEventListener("input", function () {
      var n = self._findNote(pageIndex, note.id);
      if (!n) return;
      n.text = ta.value;
      el.querySelector(".cfd-note-saved").textContent = "…";
      clearTimeout(tT);
      tT = setTimeout(function () {
        self._syncPut(pageIndex, n.id, { text: n.text }).then(function () {
          el.querySelector(".cfd-note-saved").textContent = self.db ? "сохранено" : "";
        });
      }, 600);
    });
    ["pointerdown", "pointermove", "pointerup", "wheel"].forEach(function (ev) {
      box.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: ev === "wheel" });
    });
    // --- рукопись в заметке ---
    (function () {
      var cur = null;
      function pos(e) {
        var r = cv.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height), p: (e.pointerType === "mouse" || !e.pressure) ? 0.5 : e.pressure };
      }
      cv.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch") return;
        e.preventDefault(); e.stopPropagation();
        cv.setPointerCapture(e.pointerId);
        cur = { c: self.color === "#f6d743" || self.color === "#fb923c" ? "#1a1a1a" : self.color, s: 2.2, points: [pos(e)] };
      });
      cv.addEventListener("pointermove", function (e) {
        if (!cur) return;
        e.preventDefault(); e.stopPropagation();
        cur.points.push(pos(e));
        var ctx = cv.getContext("2d"), a = cur.points[cur.points.length - 2], b = cur.points[cur.points.length - 1];
        ctx.save(); ctx.strokeStyle = cur.c; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(0.6, cur.s * (0.5 + 1.5 * b.p));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
      });
      function up(e) {
        if (!cur) return;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
        var n = self._findNote(pageIndex, note.id);
        if (n && cur.points.length > 1) {
          n.ink.push({ c: cur.c, s: cur.s, pts: encPts(cur.points, cv.width, cv.height) });
          self._syncPut(pageIndex, n.id, { ink: n.ink });
        }
        cur = null;
      }
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);
    })();
    return el;
  };

  Annotator.prototype._findNote = function (pageIndex, id) {
    var list = this.state.pages[pageIndex].notes;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Annotator.prototype._toggleNote = function (el, open) {
    var box = el.querySelector(".cfd-note-box"), pin = el.querySelector(".cfd-note-pin");
    var willOpen = (open != null) ? open : box.hidden;
    box.hidden = !willOpen;
    pin.classList.toggle("open", willOpen);
    el.style.zIndex = willOpen ? 9 : 5;
    // не вылезать за правый край страницы
    if (willOpen) {
      var p = this.pageCanvases[this._pageIndexOfEl(el)];
      if (p) {
        var left = parseFloat(el.style.left) || 0;
        box.style.left = (left + 36 + 290 > p.baseW) ? (-290) + "px" : "36px";
      }
    }
  };
  Annotator.prototype._pageIndexOfEl = function (el) {
    for (var i = 0; i < this.pageCanvases.length; i++) if (this.pageCanvases[i].wrap === el.parentNode) return i;
    return 0;
  };

  Annotator.prototype._updateNoteEl = function (p, el, n) {
    var pin = el.querySelector(".cfd-note-pin");
    var col = n.color || authorColor(n.by);
    el.style.left = Math.round(n.x * p.baseW - 15) + "px";
    el.style.top = Math.round(n.y * p.baseH - 15) + "px";
    pin.style.background = col;
    pin.textContent = initials(n.byName || n.by);
    var mine = n.by === this.me.email;
    el.querySelector(".cfd-note-by").textContent = (mine ? "Вы" : (n.byName || n.by || "")) + (n.at ? " · " + fmtTime(n.at) : "");
    var ta = el.querySelector(".cfd-note-text");
    if (document.activeElement !== ta && ta.value !== (n.text || "")) ta.value = n.text || "";
    this._drawNoteInk(el.querySelector(".cfd-note-ink"), n);
  };

  Annotator.prototype._drawNoteInk = function (cv, n, scaleTo) {
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    (n.ink || []).forEach(function (s) {
      var pts = decPts(s.pts, cv.width, cv.height);
      ctx.save(); ctx.strokeStyle = s.c || "#1a1a1a"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (var i = 1; i < pts.length; i++) {
        ctx.lineWidth = Math.max(0.6, (s.s || 2.2) * (0.5 + 1.5 * (pts[i].p != null ? pts[i].p : 0.5)) * (scaleTo || 1));
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      }
      ctx.restore();
    });
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
        this.opts.assignment.id, this.opts.assignment.courseId, this.opts.student.uid,
        this.opts.student.fio || "", file,
        function (p) { self._setStatus("Загрузка… " + Math.round(p * 100) + "%"); }
      );
      var r = await CFDHomework.addReviewedFile(this.opts.assignment.id, this.opts.student.uid, meta, "");
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

  // Заметки на странице при экспорте: стикер + развёрнутый блок с текстом и рукописью
  Annotator.prototype._paintNotesForExport = function (ctx, p) {
    var self = this;
    var notes = this.state.pages[p.pageIndex].notes;
    var W = p.baseW, H = p.baseH;
    var BOX_W = 320, PAD = 10, FONT = 17, LH = 22;
    notes.forEach(function (n) {
      var col = n.color || authorColor(n.by);
      var px = n.x * W, py = n.y * H;
      // текст с переносами
      ctx.font = FONT + "px Georgia, serif";
      var lines = [];
      String(n.text || "").split("\n").forEach(function (para) {
        var words = para.split(/\s+/), cur = "";
        words.forEach(function (w) {
          var t = cur ? cur + " " + w : w;
          if (ctx.measureText(t).width <= BOX_W - 2 * PAD || !cur) cur = t; else { lines.push(cur); cur = w; }
        });
        lines.push(cur);
      });
      var inkH = (n.ink && n.ink.length) ? Math.round((BOX_W - 2 * PAD) * NOTE_INK_H / NOTE_INK_W) : 0;
      var boxH = PAD + 18 + lines.length * LH + (inkH ? inkH + 8 : 0) + PAD;
      var bx = px + 22, by = py - 12;
      if (bx + BOX_W > W - 4) bx = px - 22 - BOX_W;
      if (bx < 4) bx = 4;
      if (by + boxH > H - 4) by = Math.max(4, H - 4 - boxH);
      // блок
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = "#fff8c8"; ctx.fillRect(bx, by, BOX_W, boxH);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, BOX_W, boxH);
      ctx.fillStyle = col; ctx.font = "bold 12px Georgia, serif"; ctx.textBaseline = "top";
      ctx.fillText((n.byName || n.by || "") + (n.at ? " · " + fmtTime(n.at) : ""), bx + PAD, by + 6);
      ctx.fillStyle = "#1a1a1a"; ctx.font = FONT + "px Georgia, serif";
      var ty = by + PAD + 18;
      lines.forEach(function (ln) { ctx.fillText(ln, bx + PAD, ty); ty += LH; });
      if (inkH) {
        var tmp = document.createElement("canvas"); tmp.width = NOTE_INK_W; tmp.height = NOTE_INK_H;
        this_drawInk(tmp, n);
        ctx.drawImage(tmp, bx + PAD, ty + 4, BOX_W - 2 * PAD, inkH);
      }
      // стикер и линия к нему
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx + (bx > px ? 0 : BOX_W), by + 12); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(px - 10, py - 10, 20, 20);
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(initials(n.byName || n.by), px, py + 1);
      ctx.restore();
    });
    function this_drawInk(cv, n) { self._drawNoteInk(cv, n); }
  };

  Annotator.prototype._buildOutputPdf = function () {
    var jsPDF = window.jspdf.jsPDF;
    var out = null;
    for (var i = 0; i < this.pageCanvases.length; i++) {
      var pc = this.pageCanvases[i];
      var merged = document.createElement("canvas");
      merged.width = pc.baseCanvas.width;
      merged.height = pc.baseCanvas.height;
      var ctx = merged.getContext("2d");
      ctx.drawImage(pc.baseCanvas, 0, 0);
      ctx.drawImage(pc.inkCanvas, 0, 0);
      this._paintNotesForExport(ctx, pc);
      var wPt = merged.width / RENDER_SCALE;
      var hPt = merged.height / RENDER_SCALE;
      if (!out) {
        out = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation: wPt > hPt ? "landscape" : "portrait", compress: true });
      } else {
        out.addPage([wPt, hPt], wPt > hPt ? "landscape" : "portrait");
      }
      out.addImage(merged.toDataURL("image/jpeg", EXPORT_QUALITY), "JPEG", 0, 0, wPt, hPt);
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
