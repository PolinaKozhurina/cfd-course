// ============================================================
// slide-notes.js — заметки докладчика для слайдов (только admin/superadmin)
// ------------------------------------------------------------
// Заметки хранятся ЗАШИФРОВАННЫМИ в <deck>.notes.enc.json (AES-256-GCM,
// см. tools/notes_encrypt.py); ключ — Firestore notes_keys/{cid}, правила
// отдают его только admin'у курса. После authReady с ролью admin скрипт
// читает ключ, расшифровывает заметки в браузере и показывает.
// Совместимость: если в странице ещё лежат <aside class="notes" hidden>
// (незашифрованная колода), они вырезаются из DOM и используются как есть.
//
// Управление (только для админа):
//   N (или Т)          — показать/скрыть панель заметок на текущем слайде
//   кнопка «🗨 заметки» в HUD — то же самое
//   кнопка «🖥 докладчик» — открыть окно докладчика (?presenter=1):
//       в нём только заметки + заголовок текущего и следующего слайда,
//       синхронизация с основным окном через BroadcastChannel,
//       ← / → в окне докладчика листают основной экран.
//
// Требует подключённых firebase-*-compat, firebase-config.js, auth.js.
// ============================================================
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (!slides.length) return;

  // ---- 1. Вырезать заметки из DOM (студент их не видит даже в инспекторе)
  var NOTES = slides.map(function (s) {
    var a = s.querySelector('aside.notes');
    if (!a) return null;
    var html = a.innerHTML;
    a.parentNode.removeChild(a);
    return html;
  });
  var cid = document.documentElement.getAttribute('data-course') || '';
  var notesLoaded = NOTES.some(function (n) { return n; });
  var notesError = '';

  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Загрузить и расшифровать заметки (один раз). Требует admin-роли:
  // иначе Firestore не отдаст ключ.
  var notesPromise = null;
  function loadNotes() {
    if (notesLoaded) return Promise.resolve();
    if (notesPromise) return notesPromise;
    notesPromise = (async function () {
      try {
        var encUrl = location.pathname.split('/').pop().replace(/\.html?$/i, '') + '.notes.enc.json';
        var r = await fetch(encUrl, { cache: 'no-cache' });
        if (!r.ok) { notesError = 'файл заметок не найден'; return; }
        var enc = await r.json();
        var d = await firebase.firestore().collection('notes_keys').doc(cid).get();
        if (!d.exists || !d.data().key) { notesError = 'ключ заметок не задан в админке (Лабы → ключ заметок)'; return; }
        var key = await crypto.subtle.importKey('raw', b64ToBytes(d.data().key), { name: 'AES-GCM' }, false, ['decrypt']);
        var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.ct));
        var arr = JSON.parse(new TextDecoder().decode(pt));
        for (var i = 0; i < slides.length; i++) NOTES[i] = arr[i] || null;
        notesLoaded = true;
      } catch (e) {
        notesError = /permission/i.test(String(e)) ? 'нет доступа к ключу заметок' : ('не удалось расшифровать заметки: ' + (e.message || e));
      }
    })();
    return notesPromise;
  }

  var TITLES = slides.map(function (s) {
    var h = s.querySelector('h1, h2');
    return h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
  });

  var deck = (location.pathname.split('/').pop() || 'slides').replace(/\.html$/, '');
  var isPresenter = /[?&]presenter/.test(location.search);
  var chan = ('BroadcastChannel' in window) ? new BroadcastChannel('cfd-slides-' + deck) : null;

  function curIndex() {
    for (var i = 0; i < slides.length; i++) if (slides[i].classList.contains('active')) return i;
    return 0;
  }

  // ---- 2. Основное окно: транслировать номер слайда и принимать команды
  var lastSent = -1;
  function broadcast() {
    if (!chan || isPresenter) return;
    var i = curIndex();
    if (i === lastSent) return;
    lastSent = i;
    chan.postMessage({ type: 'slide', i: i });
  }
  var mo = new MutationObserver(function () { broadcast(); onSlideChange(); });
  slides.forEach(function (s) { mo.observe(s, { attributes: true, attributeFilter: ['class'] }); });
  if (chan && !isPresenter) {
    chan.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'cmd' && m.cmd === 'next' && typeof window.next === 'function') window.next();
      else if (m.type === 'cmd' && m.cmd === 'prev' && typeof window.prev === 'function') window.prev();
      else if (m.type === 'hello') { lastSent = -1; broadcast(); }
    };
  }

  // ---- 3. CSS
  var css = document.createElement('style');
  css.textContent = [
    '.cfd-notes{position:fixed;right:1rem;bottom:3.8rem;width:min(440px,42vw);max-height:62vh;overflow:auto;z-index:250;',
    '  background:#fffdf7;color:var(--text,#2c2419);border:1px solid var(--border,#d9cfc0);border-left:4px solid var(--accent,#b44a2d);',
    '  border-radius:8px;padding:.7rem .95rem .8rem;box-shadow:0 8px 28px rgba(44,36,25,.18);font-size:.62em;line-height:1.45}',
    'html.dark .cfd-notes{background:#221d17}',
    '.cfd-notes-h{font-family:"JetBrains Mono",monospace;font-size:.72em;letter-spacing:.1em;text-transform:uppercase;color:var(--accent,#b44a2d);margin-bottom:.45rem;display:flex;justify-content:space-between;gap:.6rem}',
    '.cfd-notes-h span{color:var(--text3,#9a8d7e);letter-spacing:0;text-transform:none}',
    '.cfd-notes p{margin:.3rem 0}',
    '.cfd-notes .q{font-weight:600}',
    '.cfd-notes .q::before{content:"Спросить · ";color:var(--accent,#b44a2d);font-family:"JetBrains Mono",monospace;font-weight:500;font-size:.85em}',
    '.cfd-notes .a::before{content:"Ждём · ";color:var(--accent2,#1a6b5a);font-family:"JetBrains Mono",monospace;font-size:.85em}',
    '.cfd-notes .t{color:var(--text2,#6b5d4f);font-style:italic}',
    '.cfd-notes .t::before{content:"Ловушка · ";color:var(--accent3,#3a5ba0);font-family:"JetBrains Mono",monospace;font-style:normal;font-size:.85em}',
    '.cfd-notes .n::before{content:"Заметка · ";color:var(--text3,#9a8d7e);font-family:"JetBrains Mono",monospace;font-size:.85em}',
    '.cfd-notes-empty{color:var(--text3,#9a8d7e);font-style:italic}',
    '.cfd-notes-btn{font-family:"JetBrains Mono",monospace;font-size:.82rem;padding:.4rem .9rem;border:1px solid var(--border,#d9cfc0);border-radius:5px;background:#fff;color:var(--text2,#6b5d4f);cursor:pointer}',
    '.cfd-notes-btn.on{border-color:var(--accent,#b44a2d);color:var(--accent,#b44a2d)}',
    'html.dark .cfd-notes-btn{background:#221d17}',
    // presenter window
    'html.cfd-presenter .slide,html.cfd-presenter .hud,html.cfd-presenter .progress,html.cfd-presenter .cfd-st-panel,html.cfd-presenter .cfd-st-canvas{display:none!important}',
    'html.cfd-presenter body{overflow:auto}',
    '.cfd-pres{max-width:1100px;margin:0 auto;padding:1.4rem 1.8rem;font-size:20px;line-height:1.5}',
    '.cfd-pres .cur{font-family:"Playfair Display",serif;font-weight:700;font-size:1.35em;color:var(--accent,#b44a2d);margin:.2rem 0 .1rem}',
    '.cfd-pres .nxt{font-family:"JetBrains Mono",monospace;font-size:.7em;color:var(--text3,#9a8d7e);margin-bottom:.9rem}',
    '.cfd-pres .cfd-notes{position:static;width:auto;max-height:none;font-size:1em;box-shadow:none}',
    '.cfd-pres .hint{font-family:"JetBrains Mono",monospace;font-size:.66em;color:var(--text3,#9a8d7e);margin-top:1rem}'
  ].join('\n');
  document.head.appendChild(css);

  // ---- 4. Панель заметок в основном окне
  var panel = document.createElement('div');
  panel.className = 'cfd-notes';
  panel.hidden = true;
  document.body.appendChild(panel);
  var enabled = false, visible = false, btnNotes = null;

  function renderNotes(target, i) {
    var h = NOTES[i];
    var empty = notesLoaded
      ? '<p class="cfd-notes-empty">Заметок к этому слайду нет.</p>'
      : (notesError ? '<p class="cfd-notes-empty">' + notesError + '</p>' : '<p class="cfd-notes-empty">…расшифровка заметок</p>');
    target.innerHTML =
      '<div class="cfd-notes-h">Преподавателю <span>слайд ' + (i + 1) + ' / ' + slides.length + ' · N — скрыть</span></div>' +
      (h || empty);
    if (h && window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([target]).catch(function () {});
    if (!notesLoaded && !notesError) loadNotes().then(function () { if (target.isConnected) renderNotes(target, i); });
  }
  function setVisible(v) {
    visible = !!v;
    panel.hidden = !visible;
    if (btnNotes) btnNotes.classList.toggle('on', visible);
    if (visible) renderNotes(panel, curIndex());
  }
  function onSlideChange() {
    if (enabled && visible && !isPresenter) renderNotes(panel, curIndex());
  }

  function activateMain() {
    var center = document.querySelector('.hud .center');
    if (center) {
      btnNotes = document.createElement('button');
      btnNotes.className = 'cfd-notes-btn';
      btnNotes.type = 'button';
      btnNotes.title = 'Заметки докладчика (N)';
      btnNotes.textContent = '🗨 заметки';
      btnNotes.addEventListener('click', function () { setVisible(!visible); });
      center.appendChild(btnNotes);
      var btnPres = document.createElement('button');
      btnPres.className = 'cfd-notes-btn';
      btnPres.type = 'button';
      btnPres.title = 'Окно докладчика на втором экране';
      btnPres.textContent = '🖥 докладчик';
      btnPres.addEventListener('click', function () {
        window.open(location.pathname + '?presenter=1', 'cfd-presenter-' + deck, 'width=960,height=640');
      });
      center.appendChild(btnPres);
    }
    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|TEXTAREA)$/i.test((e.target || {}).tagName)) return;
      var k = e.key.toLowerCase();
      if (k === 'n' || k === 'т') { e.preventDefault(); setVisible(!visible); }
    });
  }

  // ---- 5. Окно докладчика
  function activatePresenter() {
    document.documentElement.classList.add('cfd-presenter');
    var box = document.createElement('div');
    box.className = 'cfd-pres';
    box.innerHTML = '<div class="cur"></div><div class="nxt"></div><div class="cfd-notes"></div>' +
      '<div class="hint">← / → листают основной экран · окно синхронизируется автоматически</div>';
    document.body.appendChild(box);
    var cur = box.querySelector('.cur'), nxt = box.querySelector('.nxt'), notes = box.querySelector('.cfd-notes');
    function render(i) {
      cur.textContent = (i + 1) + '. ' + (TITLES[i] || '');
      nxt.textContent = (i + 1 < slides.length) ? ('дальше → ' + (i + 2) + '. ' + TITLES[i + 1]) : 'последний слайд';
      renderNotes(notes, i);
      document.title = 'Докладчик · ' + (i + 1) + '/' + slides.length;
    }
    render(0);
    if (chan) {
      chan.onmessage = function (ev) { var m = ev.data || {}; if (m.type === 'slide') render(m.i); };
      chan.postMessage({ type: 'hello' });
    }
    document.addEventListener('keydown', function (e) {
      if (!chan) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); chan.postMessage({ type: 'cmd', cmd: 'next' }); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); chan.postMessage({ type: 'cmd', cmd: 'prev' }); }
    }, true);
  }

  // ---- 6. Включение по роли
  function isAdmin() { return window._userRole === 'admin' || window._userRole === 'superadmin'; }
  function activate() {
    if (enabled) return;
    if (!isAdmin()) return;
    enabled = true;
    if (isPresenter) activatePresenter(); else activateMain();
  }
  window.addEventListener('authReady', activate);
  if (window._userRole) activate();
})();
