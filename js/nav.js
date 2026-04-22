// ============================================================
// Unified Navigation — CFD Courses (two-level dropdowns)
// ============================================================
(function() {
  "use strict";

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
      }
    ],
    utils: [
      { href: "profile.html", label: "Профиль" }
    ]
  };

  // Auto-detect subfolder
  var loc = location.pathname;
  var prefix = '';
  if (loc.indexOf('/sem1/') >= 0 || loc.indexOf('/sem2/') >= 0) prefix = '../';
  var parts = loc.split('/');
  var fileName = parts.pop() || 'index.html';
  var folder = parts.pop() || '';
  var currentPageFull = (folder === 'sem1' || folder === 'sem2') ? folder + '/' + fileName : fileName;

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
    '}'
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

  h += '</div></div>';
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
})();
