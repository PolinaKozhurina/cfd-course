// ============================================================
// Unified Navigation — CFD Courses
// ============================================================
(function() {
  "use strict";

  // All hrefs relative to site root
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
              { href: "sem1/s1-07.html", label: "§7 Неопр. коэффициенты" },
              { href: "sem1/s1-08.html", label: "§8 Монотонность" },
              { href: "sem1/s1-09.html", label: "§9 Теорема Годунова" },
              { href: "sem1/s1-10.html", label: "§10 TVD" },
              { href: "sem1/s1-11.html", label: "§11 Полож. коэфф." }
          ]},
          { title: "Газодинамика", items: [
              { href: "sem1/s1-12.html", label: "§12 Лагранж" },
              { href: "sem1/s1-13.html", label: "§13 Схема «крест»" },
              { href: "sem1/s1-14.html", label: "§14 Устойчивость «крест»" },
              { href: "sem1/s1-15.html", label: "§15 Метод Годунова" }
          ]},
          { title: "Задача Римана", items: [
              { href: "sem1/s1-16.html", label: "§16 Точная задача" },
              { href: "sem1/s1-17.html", label: "§17 Точный решатель" },
              { href: "sem1/s1-18.html", label: "§18 Классификация" },
              { href: "sem1/s1-19.html", label: "§19 Метод Рое" },
              { href: "sem1/s1-20.html", label: "§20 Метод Ошера" },
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
          ]}
        ]
      }
    ],
    utils: [
      { href: "profile.html", label: "Профиль" }
    ]
  };

  // Auto-detect subfolder and compute prefix
  var loc = location.pathname;
  var prefix = '';
  if (loc.indexOf('/sem1/') >= 0 || loc.indexOf('/sem2/') >= 0) prefix = '../';
  // Build currentPageFull = "sem1/s1-01.html" or "index.html"
  var parts = loc.split('/');
  var fileName = parts.pop() || 'index.html';
  var folder = parts.pop() || '';
  var currentPageFull = (folder === 'sem1' || folder === 'sem2') ? folder + '/' + fileName : fileName;

  function p(href) { return prefix + href; }

  // --- Inject CSS ---
  var css = document.createElement("style");
  css.textContent = [
    '#cfd-nav{position:fixed;top:0;left:0;right:0;z-index:9998;background:#f5f0e8;border-bottom:1px solid #d9cfc0;font-family:"JetBrains Mono",monospace;font-size:11px;user-select:none}',
    '#cfd-nav .nav-inner{display:flex;align-items:center;padding:0 16px;height:38px;gap:4px}',
    '#cfd-nav .nav-brand{font-family:"Playfair Display",serif;font-size:14px;font-weight:900;color:#b44a2d;text-decoration:none;margin-right:8px;letter-spacing:-.02em}',
    '#cfd-nav .nav-items{display:flex;align-items:center;gap:2px;flex:1;min-width:0}',
    '#cfd-nav .nav-dropdown{position:relative}',
    '#cfd-nav .nav-dropdown-btn{color:#6b5d4f;background:none;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;display:flex;align-items:center;gap:3px;transition:all .15s;white-space:nowrap}',
    '#cfd-nav .nav-dropdown-btn:hover,#cfd-nav .nav-dropdown-btn.open{background:#ede6da;color:#2c2419}',
    '#cfd-nav .nav-dropdown-btn.has-active{color:#b44a2d;font-weight:600}',
    '#cfd-nav .nav-dropdown-btn .arrow{font-size:8px;transition:transform .2s;opacity:.5}',
    '#cfd-nav .nav-dropdown-btn.open .arrow{transform:rotate(180deg)}',
    '#cfd-nav .nav-panel{position:absolute;top:calc(100% + 6px);left:0;background:#faf8f4;border:1px solid #d9cfc0;border-radius:8px;box-shadow:0 8px 32px rgba(44,36,25,.12);padding:12px 0;min-width:220px;display:none;z-index:9999}',
    '#cfd-nav .nav-panel.show{display:block;animation:navFade .15s ease}',
    '@keyframes navFade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
    '#cfd-nav .nav-panel .section-title{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#9a8d7e;padding:4px 16px 2px;margin-top:6px}',
    '#cfd-nav .nav-panel .section-title:first-child{margin-top:0}',
    '#cfd-nav .nav-panel a{display:block;padding:5px 16px;color:#2c2419;text-decoration:none;font-size:12px;transition:all .1s;font-family:"Source Serif 4",serif}',
    '#cfd-nav .nav-panel a:hover{background:#ede6da;color:#b44a2d}',
    '#cfd-nav .nav-panel a.active{background:#b44a2d;color:#fff}',
    '#cfd-nav .nav-panel .sem-badge{font-size:9px;color:#9a8d7e;font-family:"JetBrains Mono",monospace;padding:2px 16px 8px;border-bottom:1px solid #ede6da;margin-bottom:4px}',
    '#cfd-nav .nav-link{color:#6b5d4f;text-decoration:none;padding:4px 8px;border-radius:4px;transition:all .15s;white-space:nowrap}',
    '#cfd-nav .nav-link:hover{background:#ede6da;color:#2c2419}',
    '#cfd-nav .nav-link.active{background:#b44a2d;color:#fff}',
    '#cfd-nav .nav-hamburger{display:none;background:none;border:none;cursor:pointer;padding:4px;color:#6b5d4f}',
    '#cfd-nav .nav-hamburger svg{display:block}',
    '@media(max-width:720px){',
    '  #cfd-nav .nav-items{display:none;position:absolute;top:38px;left:0;right:0;background:#f5f0e8;border-bottom:1px solid #d9cfc0;flex-direction:column;align-items:stretch;padding:8px 12px;gap:2px}',
    '  #cfd-nav .nav-items.mobile-open{display:flex}',
    '  #cfd-nav .nav-hamburger{display:block}',
    '  #cfd-nav .nav-dropdown-btn{width:100%;justify-content:space-between}',
    '  #cfd-nav .nav-panel{position:static;box-shadow:none;border:none;border-radius:0;padding:0 0 0 12px;background:transparent}',
    '  #cfd-nav .nav-link{display:block;padding:6px 8px}',
    '}'
  ].join("\n");
  document.head.appendChild(css);

  // --- Build HTML ---
  var nav = document.createElement("div");
  nav.id = "cfd-nav";
  var inner = '<div class="nav-inner">';
  inner += '<a href="' + p(NAV.brand.href) + '" class="nav-brand">' + NAV.brand.label + '</a>';
  inner += '<button class="nav-hamburger" onclick="window._cfdNavToggleMobile()" aria-label="Меню"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5h12M3 9h12M3 13h12"/></svg></button>';
  inner += '<div class="nav-items">';

  NAV.courses.forEach(function(course, ci) {
    var hasActive = false;
    course.sections.forEach(function(s) {
      s.items.forEach(function(it) { if (it.href === currentPageFull) hasActive = true; });
    });
    if (course.extras) course.extras.forEach(function(it) { if (it.href === currentPageFull) hasActive = true; });

    inner += '<div class="nav-dropdown" data-dd="' + ci + '">';
    inner += '<button class="nav-dropdown-btn' + (hasActive ? ' has-active' : '') + '" onclick="window._cfdNavToggle(' + ci + ')">';
    inner += course.label + ' <span class="arrow">▾</span></button>';
    inner += '<div class="nav-panel" id="cfd-panel-' + ci + '">';
    inner += '<div class="sem-badge">' + course.semester + '</div>';

    course.sections.forEach(function(sec) {
      inner += '<div class="section-title">' + sec.title + '</div>';
      sec.items.forEach(function(it) {
        inner += '<a href="' + p(it.href) + '"' + (it.href === currentPageFull ? ' class="active"' : '') + '>' + it.label + '</a>';
      });
    });
    if (course.extras && course.extras.length > 0) {
      inner += '<div class="section-title">Контроль</div>';
      course.extras.forEach(function(it) {
        inner += '<a href="' + p(it.href) + '"' + (it.href === currentPageFull ? ' class="active"' : '') + '>' + it.label + '</a>';
      });
    }
    inner += '</div></div>';
  });

  NAV.utils.forEach(function(it) {
    inner += '<a href="' + p(it.href) + '" class="nav-link' + (it.href === currentPageFull ? ' active' : '') + '">' + it.label + '</a>';
  });

  inner += '</div></div>';
  nav.innerHTML = inner;

  document.body.insertBefore(nav, document.body.firstChild);
  document.body.style.paddingTop = "38px";

  // --- Dropdown logic ---
  var openDD = null;
  window._cfdNavToggle = function(idx) {
    var panel = document.getElementById("cfd-panel-" + idx);
    var btn = panel.parentElement.querySelector(".nav-dropdown-btn");
    if (openDD === idx) {
      panel.classList.remove("show"); btn.classList.remove("open"); openDD = null;
    } else {
      if (openDD !== null) {
        var old = document.getElementById("cfd-panel-" + openDD);
        if (old) { old.classList.remove("show"); old.parentElement.querySelector(".nav-dropdown-btn").classList.remove("open"); }
      }
      panel.classList.add("show"); btn.classList.add("open"); openDD = idx;
    }
  };
  window._cfdNavToggleMobile = function() {
    document.querySelector("#cfd-nav .nav-items").classList.toggle("mobile-open");
  };
  document.addEventListener("click", function(e) {
    if (openDD !== null && !e.target.closest(".nav-dropdown")) {
      var panel = document.getElementById("cfd-panel-" + openDD);
      if (panel) { panel.classList.remove("show"); panel.parentElement.querySelector(".nav-dropdown-btn").classList.remove("open"); }
      openDD = null;
    }
  });
})();
