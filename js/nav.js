// ============================================================
// Unified Navigation — CFD Courses (two-level dropdowns)
// ============================================================
(function() {
  "use strict";

  // Apply saved theme as early as possible to minimise flash
  try { if (localStorage.getItem('cfd-theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {}

  var NAV = {
    brand: { label: "CFD", href: "index.html" },
    courses: [
      {
        id: "diff-schemes",
        label: "Разностные схемы",
        semester: "Весна 2026",
        sections: [
          { title: "Газодинамика", items: [
              { href: "sem2/flic.html", label: "FLIC" },
              { href: "sem2/godunov.html", label: "Годунов + HLLC" },
              { href: "sem2/mader.html", label: "2DE Мейдера" }
          ]},
          { title: "Несжимаемые", items: [
              { href: "sem2/pimple.html", label: "SIMPLE / PISO / PIMPLE" }
          ]},
          { title: "Сетки и параллелизм", items: [
              { href: "sem2/mesh.html", label: "Построение сеток" },
              { href: "sem2/unstruct.html", label: "КОМ неструкт." },
              { href: "sem2/mpi.html", label: "MPI декомпозиция" }
          ]}
        ],
        extras: [
          { href: "sem2/checklist.html", label: "Зачёт" },
          { href: "sem2/assignments.html", label: "Задания" }
        ]
      },
      {
        id: "sem1",
        label: "Теория разн. схем",
        semester: "Осень 2025",
        sections: [
          { title: "Основы", items: [
              { href: "sem1/s1-01.html", label: "§1 Основные понятия" },
              { href: "sem1/s1-02.html", label: "§2 Аппроксимация" },
              { href: "sem1/s1-03.html", label: "§3 Теорема Лакса" },
              { href: "sem1/s1-04.html", label: "§4 Дифф. приближение" },
              { href: "sem1/s1-05.html", label: "§5 Устойчивость" },
              { href: "sem1/s1-06.html", label: "§6 Дисперсия" }
          ]},
          { title: "Свойства схем", items: [
              { href: "sem1/s1-07.html", label: "§7 Неопр. коэфф." },
              { href: "sem1/s1-08.html", label: "§8 Монотонность" },
              { href: "sem1/s1-09.html", label: "§9 Теорема Годунова" },
              { href: "sem1/s1-10.html", label: "§10 TVD" },
              { href: "sem1/s1-11.html", label: "§11 Полож. коэфф." }
          ]},
          { title: "Газодинамика", items: [
              { href: "sem1/s1-12.html", label: "§12 Лагранж" },
              { href: "sem1/s1-13.html", label: "§13 Схема «крест»" },
              { href: "sem1/s1-14.html", label: "§14 Устойч. «крест»" },
              { href: "sem1/s1-15.html", label: "§15 Метод Годунова" }
          ]},
          { title: "Задача Римана", items: [
              { href: "sem1/s1-16.html", label: "§16 Точная задача" },
              { href: "sem1/s1-17.html", label: "§17 Точный решатель" },
              { href: "sem1/s1-18.html", label: "§18 Классификация" },
              { href: "sem1/s1-19.html", label: "§19 Рое" },
              { href: "sem1/s1-20.html", label: "§20 Ошер" },
              { href: "sem1/s1-21.html", label: "§21 HLL" },
              { href: "sem1/s1-22.html", label: "§22 HLLC" }
          ]},
          { title: "Высокий порядок", items: [
              { href: "sem1/s1-23.html", label: "§23 Колган" },
              { href: "sem1/s1-24.html", label: "§24 Колган–Родионов" },
              { href: "sem1/s1-25.html", label: "§25 ENO" },
              { href: "sem1/s1-26.html", label: "§26 WENO" },
              { href: "sem1/s1-27.html", label: "§27 МакКормак" }
          ]},
          { title: "Стабилизация", items: [
              { href: "sem1/s1-28.html", label: "§28 Диффузия" },
              { href: "sem1/s1-29.html", label: "§29 Иск. вязкость" },
              { href: "sem1/s1-30.html", label: "§30 Иск. вязкость II" }
          ]},
          { title: "Сводка", items: [
              { href: "sem1/comparison.html", label: "Сравнение методов" }
          ]}
        ]
      },
      {
        id: "sph",
        label: "Мини-курс SPH",
        semester: "1 неделя · Maple",
        sections: [
          { title: "Лекции", items: [
              { href: "sph/lec1-kernel.html", label: "Лек. 1 Ядро" },
              { href: "sph/lec2-euler.html", label: "Лек. 2 Уравнения ГД" },
              { href: "sph/lec3-integration.html", label: "Лек. 3 Leap-Frog" },
              { href: "sph/lec4-viscosity.html", label: "Лек. 4 Вязкость" },
              { href: "sph/lec5-analysis.html", label: "Лек. 5 Анализ" }
          ]},
          { title: "Лабораторные", items: [
              { href: "sph/lab1.html", label: "Лаб. 1 Реализация ядра" },
              { href: "sph/lab2.html", label: "Лаб. 2 Правые части" },
              { href: "sph/lab3.html", label: "Лаб. 3 Первый Sod" },
              { href: "sph/lab4.html", label: "Лаб. 4 Вязкость+сходимость" },
              { href: "sph/lab5.html", label: "Лаб. 5 Мини-проект" }
          ]}
        ],
        extras: [
          { href: "sph/index.html", label: "Обзор курса" },
          { href: "sph/maple-reference.html", label: "📘 Памятка Maple" }
        ]
      },
      {
        id: "mke",
        label: "Метод конечных элементов",
        semester: "Курс · МКЭ",
        sections: [
          { title: "Основы метода", items: [
              { href: "mke/lec1.html", label: "Лек. 1 Введение" },
              { href: "mke/lec2.html", label: "Лек. 2 Теор. основы" },
              { href: "mke/lec3.html", label: "Лек. 3 Матричная техника" }
          ]},
          { title: "Сетки и приложения", items: [
              { href: "mke/lec4.html", label: "Лек. 4 Расчётные сетки" },
              { href: "mke/lec5.html", label: "Лек. 5 Лаплас и Пуассон" }
          ]},
          { title: "Высокий порядок и теория", items: [
              { href: "mke/lec6.html", label: "Лек. 6 Симплексы" },
              { href: "mke/lec7.html", label: "Лек. 7 Изопараметрия" },
              { href: "mke/lec8.html", label: "Лек. 8 Свойства КЭ" }
          ]}
        ],
        extras: [
          { href: "mke/index.html", label: "Обзор курса" },
          { href: "mke/practice.html", label: "Практикум" }
        ]
      }
    ],
    utils: [
      { href: "profile.html", label: "Профиль" }
    ]
  };

  // Auto-detect subfolder
  var loc = location.pathname;
  var prefix = '';
  if (loc.indexOf('/sem1/') >= 0 || loc.indexOf('/sem2/') >= 0 || loc.indexOf('/sph/') >= 0 || loc.indexOf('/mke/') >= 0) prefix = '../';
  var parts = loc.split('/');
  var fileName = parts.pop() || 'index.html';
  var folder = parts.pop() || '';
  var currentPageFull = (folder === 'sem1' || folder === 'sem2' || folder === 'sph' || folder === 'mke') ? folder + '/' + fileName : fileName;

  function p(href) { return prefix + href; }

  // --- CSS ---
  var css = document.createElement("style");
  css.textContent = [
    '#cfd-nav{position:fixed;top:0;left:0;right:0;z-index:9998;background:#f5f0e8;border-bottom:1px solid #d9cfc0;font-family:"JetBrains Mono",monospace;font-size:11px;user-select:none}',
    '#cfd-nav .nav-inner{display:flex;align-items:center;padding:0 16px;height:38px;gap:4px}',
    '#cfd-nav .nav-brand{font-family:"Playfair Display",serif;font-size:14px;font-weight:900;color:#b44a2d;text-decoration:none;margin-right:8px;letter-spacing:-.02em}',
    '#cfd-nav .nav-items{display:flex;align-items:center;gap:2px;flex:1;min-width:0}',
    // Dropdown button (course level)
    '#cfd-nav .dd{position:relative}',
    '#cfd-nav .dd-btn{color:#6b5d4f;background:none;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;display:flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap}',
    '#cfd-nav .dd-btn:hover,#cfd-nav .dd-btn.open{background:#ede6da;color:#2c2419}',
    '#cfd-nav .dd-btn.has-active{color:#b44a2d;font-weight:600}',
    '#cfd-nav .dd-btn .arr{font-size:8px;transition:transform .2s;opacity:.5}',
    '#cfd-nav .dd-btn.open .arr{transform:rotate(180deg)}',
    // Level-1 panel: groups list
    '#cfd-nav .l1{position:absolute;top:calc(100% + 4px);left:0;background:#faf8f4;border:1px solid #d9cfc0;border-radius:8px;box-shadow:0 8px 32px rgba(44,36,25,.12);padding:8px 0;min-width:180px;display:none;z-index:9999}',
    '#cfd-nav .l1.show{display:block;animation:navF .12s ease}',
    '@keyframes navF{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
    '#cfd-nav .l1 .sem{font-size:9px;color:#9a8d7e;font-family:"JetBrains Mono",monospace;padding:2px 14px 6px;border-bottom:1px solid #ede6da;margin-bottom:2px}',
    // Group item (hoverable, opens L2)
    '#cfd-nav .grp{position:relative}',
    '#cfd-nav .grp-btn{display:flex;align-items:center;justify-content:space-between;width:100%;padding:6px 14px;color:#2c2419;background:none;border:none;cursor:pointer;font:inherit;font-size:12px;font-family:"Source Serif 4",serif;text-align:left;transition:all .1s;border-radius:0}',
    '#cfd-nav .grp-btn:hover,#cfd-nav .grp-btn.grp-open{background:#ede6da;color:#b44a2d}',
    '#cfd-nav .grp-btn.grp-active{color:#b44a2d;font-weight:600}',
    '#cfd-nav .grp-btn .garr{font-size:9px;opacity:.4;margin-left:6px}',
    // Level-2 panel: paragraphs (flies out right)
    '#cfd-nav .l2{position:absolute;top:-4px;left:100%;background:#faf8f4;border:1px solid #d9cfc0;border-radius:8px;box-shadow:0 8px 32px rgba(44,36,25,.12);padding:6px 0;min-width:190px;display:none;z-index:10000}',
    '#cfd-nav .grp:hover .l2,#cfd-nav .grp.touch-open .l2{display:block;animation:navF .1s ease}',
    '#cfd-nav .l2 a{display:block;padding:4px 14px;color:#2c2419;text-decoration:none;font-size:11.5px;transition:all .1s;font-family:"Source Serif 4",serif;white-space:nowrap}',
    '#cfd-nav .l2 a:hover{background:#ede6da;color:#b44a2d}',
    '#cfd-nav .l2 a.active{background:#b44a2d;color:#fff}',
    // Extras at bottom of L1
    '#cfd-nav .l1-sep{height:1px;background:#ede6da;margin:4px 0}',
    '#cfd-nav .l1 .ext a{display:block;padding:4px 14px;color:#6b5d4f;text-decoration:none;font-size:11px;transition:all .1s}',
    '#cfd-nav .l1 .ext a:hover{color:#b44a2d;background:#ede6da}',
    // Utility links
    '#cfd-nav .nav-link{color:#6b5d4f;text-decoration:none;padding:4px 8px;border-radius:4px;transition:all .15s;white-space:nowrap}',
    '#cfd-nav .nav-link:hover{background:#ede6da;color:#2c2419}',
    '#cfd-nav .nav-link.active{background:#b44a2d;color:#fff}',
    // Hamburger
    '#cfd-nav .ham{display:none;background:none;border:none;cursor:pointer;padding:4px;color:#6b5d4f}',
    '#cfd-nav .ham svg{display:block}',
    // Mobile
    '@media(max-width:720px){',
    '  #cfd-nav .nav-items{display:none;position:absolute;top:38px;left:0;right:0;background:#f5f0e8;border-bottom:1px solid #d9cfc0;flex-direction:column;align-items:stretch;padding:8px 12px;gap:2px;max-height:80vh;overflow-y:auto}',
    '  #cfd-nav .nav-items.mob-open{display:flex}',
    '  #cfd-nav .ham{display:block}',
    '  #cfd-nav .l1{position:static;box-shadow:none;border:none;border-radius:0;padding:0 0 0 12px;background:transparent;min-width:auto}',
    '  #cfd-nav .l2{position:static;box-shadow:none;border:none;border-radius:0;padding:0 0 0 12px;background:transparent;min-width:auto}',
    '  #cfd-nav .grp-btn{padding:6px 8px}',
    '}',
    // Theme toggle button
    '#cfd-nav .theme-btn{background:none;border:none;cursor:pointer;color:#6b5d4f;padding:4px 7px;border-radius:4px;font-size:13px;line-height:1;transition:all .15s;flex-shrink:0}',
    '#cfd-nav .theme-btn:hover{background:#ede6da;color:#2c2419}',
    // Dark theme overrides for the nav bar
    'html.dark #cfd-nav{background:#1a1611;border-bottom-color:#39322a}',
    'html.dark #cfd-nav .nav-brand{color:#e07a52}',
    'html.dark #cfd-nav .dd-btn,html.dark #cfd-nav .nav-link{color:#bcb0a0}',
    'html.dark #cfd-nav .dd-btn:hover,html.dark #cfd-nav .dd-btn.open,html.dark #cfd-nav .nav-link:hover{background:#2c261f;color:#ece3d6}',
    'html.dark #cfd-nav .dd-btn.has-active,html.dark #cfd-nav .grp-btn.grp-active{color:#e07a52}',
    'html.dark #cfd-nav .l1,html.dark #cfd-nav .l2{background:#231e18;border-color:#39322a;box-shadow:0 8px 32px rgba(0,0,0,.45)}',
    'html.dark #cfd-nav .grp-btn{color:#ece3d6}',
    'html.dark #cfd-nav .grp-btn:hover,html.dark #cfd-nav .grp-btn.grp-open{background:#2c261f;color:#e07a52}',
    'html.dark #cfd-nav .l2 a{color:#cabfae}',
    'html.dark #cfd-nav .l2 a:hover{background:#2c261f;color:#e07a52}',
    'html.dark #cfd-nav .l2 a.active{background:#e07a52;color:#1a1611}',
    'html.dark #cfd-nav .l1 .sem{color:#8d8173;border-bottom-color:#2c261f}',
    'html.dark #cfd-nav .l1-sep{background:#2c261f}',
    'html.dark #cfd-nav .l1 .ext a{color:#bcb0a0}',
    'html.dark #cfd-nav .l1 .ext a:hover{background:#2c261f;color:#e07a52}',
    'html.dark #cfd-nav .nav-link.active{background:#e07a52;color:#1a1611}',
    'html.dark #cfd-nav .nav-items{background:#1a1611;border-bottom-color:#39322a}',
    'html.dark #cfd-nav .ham{color:#bcb0a0}',
    'html.dark #cfd-nav .theme-btn{color:#bcb0a0}',
    'html.dark #cfd-nav .theme-btn:hover{background:#2c261f;color:#ece3d6}'
  ].join("\n");
  document.head.appendChild(css);

  // --- Build HTML ---
  var nav = document.createElement("div");
  nav.id = "cfd-nav";
  var h = '<div class="nav-inner">';
  h += '<a href="' + p(NAV.brand.href) + '" class="nav-brand">' + NAV.brand.label + '</a>';
  h += '<button class="ham" onclick="window._navMob()" aria-label="Меню"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5h12M3 9h12M3 13h12"/></svg></button>';
  h += '<div class="nav-items">';

  NAV.courses.forEach(function(course, ci) {
    var hasActive = false;
    course.sections.forEach(function(s) {
      s.items.forEach(function(it) { if (it.href === currentPageFull) hasActive = true; });
    });
    if (course.extras) course.extras.forEach(function(it) { if (it.href === currentPageFull) hasActive = true; });

    h += '<div class="dd" data-dd="' + ci + '">';
    h += '<button class="dd-btn' + (hasActive ? ' has-active' : '') + '" onclick="window._navDD(' + ci + ')">';
    h += course.label + ' <span class="arr">▾</span></button>';
    h += '<div class="l1" id="l1-' + ci + '">';
    h += '<div class="sem">' + course.semester + '</div>';

    course.sections.forEach(function(sec, si) {
      var grpActive = false;
      sec.items.forEach(function(it) { if (it.href === currentPageFull) grpActive = true; });
      h += '<div class="grp">';
      h += '<button class="grp-btn' + (grpActive ? ' grp-active' : '') + '">' + sec.title + ' <span class="garr">›</span></button>';
      h += '<div class="l2">';
      sec.items.forEach(function(it) {
        h += '<a href="' + p(it.href) + '"' + (it.href === currentPageFull ? ' class="active"' : '') + '>' + it.label + '</a>';
      });
      h += '</div></div>';
    });

    if (course.extras && course.extras.length) {
      h += '<div class="l1-sep"></div><div class="ext">';
      course.extras.forEach(function(it) {
        h += '<a href="' + p(it.href) + '">' + it.label + '</a>';
      });
      h += '</div>';
    }
    h += '</div></div>';
  });

  NAV.utils.forEach(function(it) {
    h += '<a href="' + p(it.href) + '" class="nav-link' + (it.href === currentPageFull ? ' active' : '') + '">' + it.label + '</a>';
  });

  h += '</div>'; // close .nav-items
  var darkNow = document.documentElement.classList.contains('dark');
  h += '<button class="theme-btn" onclick="window._navTheme()" aria-label="Переключить тему" title="Светлая / тёмная тема">' + (darkNow ? '☀' : '☾') + '</button>';
  h += '</div>'; // close .nav-inner
  nav.innerHTML = h;
  document.body.insertBefore(nav, document.body.firstChild);
  document.body.style.paddingTop = "38px";

  // --- Dropdown logic ---
  var openDD = null;
  window._navDD = function(idx) {
    var panel = document.getElementById("l1-" + idx);
    var btn = panel.parentElement.querySelector(".dd-btn");
    if (openDD === idx) {
      panel.classList.remove("show"); btn.classList.remove("open"); openDD = null;
    } else {
      if (openDD !== null) {
        var old = document.getElementById("l1-" + openDD);
        if (old) { old.classList.remove("show"); old.parentElement.querySelector(".dd-btn").classList.remove("open"); }
      }
      panel.classList.add("show"); btn.classList.add("open"); openDD = idx;
    }
  };
  window._navMob = function() {
    document.querySelector("#cfd-nav .nav-items").classList.toggle("mob-open");
  };
  window._navTheme = function() {
    var dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("cfd-theme", dark ? "dark" : "light"); } catch (e) {}
    var btn = document.querySelector("#cfd-nav .theme-btn");
    if (btn) btn.textContent = dark ? "☀" : "☾";
  };

  // Touch support for groups (tap to toggle L2 on mobile)
  document.querySelectorAll('#cfd-nav .grp-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      var grp = btn.parentElement;
      // On mobile, toggle the touch-open class
      if (window.innerWidth <= 720) {
        e.preventDefault();
        grp.classList.toggle('touch-open');
      }
    });
  });

  // Close on outside click
  document.addEventListener("click", function(e) {
    if (openDD !== null && !e.target.closest(".dd")) {
      var panel = document.getElementById("l1-" + openDD);
      if (panel) { panel.classList.remove("show"); panel.parentElement.querySelector(".dd-btn").classList.remove("open"); }
      openDD = null;
    }
  });

  // --- Floating mobile controls: in-page TOC toggle (lecture pages) + back-to-top ---
  // nav.js runs before the page's <nav class="sidebar"> is parsed, so defer until DOM is ready.
  function setupFab() {
    var lecSidebar = document.querySelector(".sidebar");
    var fab = document.createElement("div");
    fab.id = "cfd-fab";
    var fabHtml = "";
    if (lecSidebar) fabHtml += '<button class="fab-toc" onclick="window._navTOC()" aria-label="Разделы лекции" title="Разделы">☰</button>';
    fabHtml += '<button class="fab-top" onclick="window.scrollTo({top:0,behavior:\'smooth\'})" aria-label="Наверх" title="Наверх">↑</button>';
    fab.innerHTML = fabHtml;
    document.body.appendChild(fab);

    window._navTOC = function() {
      if (lecSidebar) lecSidebar.classList.toggle("mob-show");
    };
    if (lecSidebar) {
      // close the TOC overlay after picking a section, or when tapping outside it
      lecSidebar.addEventListener("click", function(e) {
        if (e.target.tagName === "A") lecSidebar.classList.remove("mob-show");
      });
      document.addEventListener("click", function(e) {
        if (lecSidebar.classList.contains("mob-show") &&
            !e.target.closest(".sidebar") && !e.target.closest(".fab-toc")) {
          lecSidebar.classList.remove("mob-show");
        }
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupFab);
  else setupFab();
})();
