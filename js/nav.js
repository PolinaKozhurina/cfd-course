// ============================================================
// Unified Navigation — CFD Courses
// ============================================================
// Подключение: <script src="js/nav.js"></script> после <body>
// ============================================================

(function() {
  "use strict";

  // --- Course / Navigation Structure ---
  // Edit this object to add new courses, semesters, lectures
  var NAV = {
    brand: { label: "CFD", href: "index.html" },
    courses: [
      {
        id: "diff-schemes",
        label: "Разностные схемы",
        semester: "Весна 2026",
        sections: [
          {
            title: "Газодинамика",
            tag: "gas",
            items: [
              { href: "flic.html", label: "FLIC" },
              { href: "godunov.html", label: "Годунов + HLLC" },
              { href: "mader.html", label: "2DE Мейдера" }
            ]
          },
          {
            title: "Несжимаемые",
            tag: "inc",
            items: [
              { href: "pimple.html", label: "SIMPLE / PISO / PIMPLE" }
            ]
          },
          {
            title: "Сетки и параллелизм",
            tag: "mesh",
            items: [
              { href: "mesh.html", label: "Построение сеток" },
              { href: "unstruct.html", label: "КОМ неструкт." },
              { href: "mpi.html", label: "MPI декомпозиция" }
            ]
          }
        ],
        extras: [
          { href: "checklist.html", label: "Зачёт" },
          { href: "assignments.html", label: "Задания" }
        ]
      }
      // === Добавляйте новые курсы здесь ===
      // {
      //   id: "first-semester",
      //   label: "Основы ЧМ",
      //   semester: "Осень 2025",
      //   sections: [ ... ],
      //   extras: [ ... ]
      // }
    ],
    utils: [
      { href: "profile.html", label: "Профиль" }
    ]
  };

  var currentPage = location.pathname.split("/").pop() || "index.html";

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
    '#cfd-nav .nav-spacer{flex:1}',
    '#cfd-nav .nav-auth{margin-left:auto}',
    // Mobile: hamburger
    '#cfd-nav .nav-hamburger{display:none;background:none;border:none;cursor:pointer;padding:4px;color:#6b5d4f}',
    '#cfd-nav .nav-hamburger svg{display:block}',
    '@media(max-width:720px){',
    '  #cfd-nav .nav-items{display:none;position:absolute;top:38px;left:0;right:0;background:#f5f0e8;border-bottom:1px solid #d9cfc0;flex-direction:column;align-items:stretch;padding:8px 12px;gap:2px}',
    '  #cfd-nav .nav-items.mobile-open{display:flex}',
    '  #cfd-nav .nav-hamburger{display:block}',
    '  #cfd-nav .nav-dropdown-btn{width:100%;justify-content:space-between}',
    '  #cfd-nav .nav-panel{position:static;box-shadow:none;border:none;border-radius:0;padding:0 0 0 12px;background:transparent}',
    '  #cfd-nav .nav-panel .section-title{padding-left:8px}',
    '  #cfd-nav .nav-panel a{padding-left:8px}',
    '  #cfd-nav .nav-link{display:block;padding:6px 8px}',
    '  #cfd-nav .nav-auth{margin-left:0;margin-top:4px}',
    '}'
  ].join("\n");
  document.head.appendChild(css);

  // --- Build HTML ---
  var nav = document.createElement("div");
  nav.id = "cfd-nav";

  var inner = '<div class="nav-inner">';
  inner += '<a href="' + NAV.brand.href + '" class="nav-brand">' + NAV.brand.label + '</a>';
  
  // Hamburger
  inner += '<button class="nav-hamburger" onclick="window._cfdNavToggleMobile()" aria-label="Меню"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 5h12M3 9h12M3 13h12"/></svg></button>';

  inner += '<div class="nav-items">';

  // Course dropdowns
  NAV.courses.forEach(function(course, ci) {
    var hasActive = false;
    course.sections.forEach(function(s) {
      s.items.forEach(function(it) { if (it.href === currentPage) hasActive = true; });
    });
    if (course.extras) course.extras.forEach(function(it) { if (it.href === currentPage) hasActive = true; });

    inner += '<div class="nav-dropdown" data-dd="' + ci + '">';
    inner += '<button class="nav-dropdown-btn' + (hasActive ? ' has-active' : '') + '" onclick="window._cfdNavToggle(' + ci + ')">';
    inner += course.label + ' <span class="arrow">▾</span></button>';
    inner += '<div class="nav-panel" id="cfd-panel-' + ci + '">';
    inner += '<div class="sem-badge">' + course.semester + '</div>';
    
    course.sections.forEach(function(sec) {
      inner += '<div class="section-title">' + sec.title + '</div>';
      sec.items.forEach(function(it) {
        inner += '<a href="' + it.href + '"' + (it.href === currentPage ? ' class="active"' : '') + '>' + it.label + '</a>';
      });
    });

    if (course.extras && course.extras.length > 0) {
      inner += '<div class="section-title">Контроль</div>';
      course.extras.forEach(function(it) {
        inner += '<a href="' + it.href + '"' + (it.href === currentPage ? ' class="active"' : '') + '>' + it.label + '</a>';
      });
    }

    inner += '</div></div>';
  });

  // Utility links (Профиль etc.)
  NAV.utils.forEach(function(it) {
    inner += '<a href="' + it.href + '" class="nav-link' + (it.href === currentPage ? ' active' : '') + '">' + it.label + '</a>';
  });

  inner += '</div>'; // .nav-items
  inner += '</div>'; // .nav-inner

  nav.innerHTML = inner;

  // Insert nav at start of body
  document.body.insertBefore(nav, document.body.firstChild);
  document.body.style.paddingTop = "38px";

  // --- Dropdown logic ---
  var openDD = null;

  window._cfdNavToggle = function(idx) {
    var panel = document.getElementById("cfd-panel-" + idx);
    var btn = panel.parentElement.querySelector(".nav-dropdown-btn");
    if (openDD === idx) {
      panel.classList.remove("show");
      btn.classList.remove("open");
      openDD = null;
    } else {
      // Close any open
      if (openDD !== null) {
        var old = document.getElementById("cfd-panel-" + openDD);
        if (old) { old.classList.remove("show"); old.parentElement.querySelector(".nav-dropdown-btn").classList.remove("open"); }
      }
      panel.classList.add("show");
      btn.classList.add("open");
      openDD = idx;
    }
  };

  window._cfdNavToggleMobile = function() {
    var items = document.querySelector("#cfd-nav .nav-items");
    items.classList.toggle("mobile-open");
  };

  // Close dropdown on outside click
  document.addEventListener("click", function(e) {
    if (openDD !== null && !e.target.closest(".nav-dropdown")) {
      var panel = document.getElementById("cfd-panel-" + openDD);
      if (panel) { panel.classList.remove("show"); panel.parentElement.querySelector(".nav-dropdown-btn").classList.remove("open"); }
      openDD = null;
    }
  });

})();
