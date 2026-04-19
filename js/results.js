// ============================================================
// Results Verification Module
// ============================================================
// Эталонные значения для всех тестов.
// Студент вводит свои числа → JS сравнивает → показывает ✓/✗
// Результаты сохраняются в Firestore через CFDAuth.submitResults()
// ============================================================

const CFDResults = {
  // Reference values: { testId: { fieldName: { value, tolerance, unit, description } } }
  reference: {
    // ===== FLIC: Sod shock tube =====
    sod_flic: {
      rho_06:  { value: 0.4263, tol: 0.05, unit: "",       desc: "ρ при x=0.6 (между ВР и КР)" },
      p_06:    { value: 0.3031, tol: 0.05, unit: "",       desc: "P при x=0.6" },
      u_06:    { value: 0.9274, tol: 0.05, unit: "",       desc: "u при x=0.6" },
      rho_075: { value: 0.2656, tol: 0.05, unit: "",       desc: "ρ при x=0.75 (между КР и УВ)" },
      p_075:   { value: 0.3031, tol: 0.05, unit: "",       desc: "P при x=0.75" },
      u_075:   { value: 0.9274, tol: 0.05, unit: "",       desc: "u при x=0.75" },
    },

    // ===== Godunov+HLLC: Sod =====
    sod_godunov: {
      rho_06:  { value: 0.4263, tol: 0.05, unit: "",       desc: "ρ при x=0.6" },
      p_06:    { value: 0.3031, tol: 0.05, unit: "",       desc: "P при x=0.6" },
      u_06:    { value: 0.9274, tol: 0.05, unit: "",       desc: "u при x=0.6" },
      rho_075: { value: 0.2656, tol: 0.05, unit: "",       desc: "ρ при x=0.75" },
    },

    // ===== Mader 2DE: Sod =====
    sod_mader: {
      rho_06:  { value: 0.4263, tol: 0.05, unit: "",       desc: "ρ при x=0.6" },
      p_06:    { value: 0.3031, tol: 0.05, unit: "",       desc: "P при x=0.6" },
      u_06:    { value: 0.9274, tol: 0.05, unit: "",       desc: "u при x=0.6" },
    },

    // ===== Mader 2DE: Detonation CJ =====
    det_mader: {
      D_CJ:    { value: 0.88,   tol: 0.03, unit: "см/мкс", desc: "Скорость детонации D_CJ" },
      P_CJ:    { value: 0.356,  tol: 0.05, unit: "Мбар",   desc: "Давление Чепмена-Жуге P_CJ" },
      rho_det: { value: 2.453,  tol: 0.05, unit: "г/см³",  desc: "Плотность за фронтом" },
    },

    // ===== SIMPLE: Cavity Re=100 =====
    cavity_simple: {
      u_center:{ value: -0.2109,tol: 0.05, unit: "",       desc: "min u(y) на x=0.5 (Ghia)" },
      v_center:{ value: 0.1753, tol: 0.05, unit: "",       desc: "max v(x) на y=0.5 (Ghia)" },
      niter:   { value: 5000,   tol: 0.50, unit: "",       desc: "Итераций до сходимости" },
    },

    // ===== PISO: Cavity Re=100 =====
    cavity_piso: {
      u_center:{ value: -0.2109,tol: 0.05, unit: "",       desc: "min u(y) на x=0.5" },
    },

    // ===== Taylor-Green vortex =====
    taylor_green: {
      decay_t5:{ value: 0.3727, tol: 0.05, unit: "",       desc: "max|u|/max|u₀| при t=5 (ν=0.01)" },
    },

    // ===== Backward step =====
    step_re100: {
      xr_h:    { value: 3.0,    tol: 0.15, unit: "",       desc: "xr/h при Re=100" },
    },
    step_re200: {
      xr_h:    { value: 5.0,    tol: 0.15, unit: "",       desc: "xr/h при Re=200" },
    },
    step_re400: {
      xr_h:    { value: 8.2,    tol: 0.15, unit: "",       desc: "xr/h при Re=400" },
    },

    // ===== Unstructured: NACA Cp =====
    naca_cp: {
      cl:      { value: 0.0,    tol: 0.10, unit: "",       desc: "Cl (коэфф. подъёмной силы, α=0)" },
    },

    // ===== MPI decomposition =====
    mpi_decomp: {
      imbalance:{ value: 0.0,   tol: 0.15, unit: "",       desc: "Дисбаланс нагрузки (0=идеал)" },
    },
  },

  // Verify a set of values against reference
  verify: function(testId, submitted) {
    const ref = this.reference[testId];
    if (!ref) return { error: "Неизвестный тест: " + testId };

    const results = {};
    let allPass = true;

    for (const [key, spec] of Object.entries(ref)) {
      if (!(key in submitted)) {
        results[key] = { status: "missing", desc: spec.desc };
        allPass = false;
        continue;
      }

      const val = parseFloat(submitted[key]);
      if (isNaN(val)) {
        results[key] = { status: "invalid", desc: spec.desc };
        allPass = false;
        continue;
      }

      const absErr = Math.abs(val - spec.value);
      const relErr = spec.value !== 0
        ? absErr / Math.abs(spec.value)
        : absErr;

      const pass = relErr <= spec.tol;
      if (!pass) allPass = false;

      results[key] = {
        status: pass ? "pass" : "fail",
        submitted: val,
        expected: spec.value,
        relError: relErr,
        tolerance: spec.tol,
        desc: spec.desc,
        unit: spec.unit,
      };
    }

    return { testId, allPass, results };
  },

  // Generate HTML table for verification results
  renderTable: function(verification) {
    let html = '<table class="vtable">';
    html += '<thead><tr><th>Параметр</th><th>Ваше значение</th><th>Эталон</th><th>Ошибка</th><th>Допуск</th><th>Статус</th></tr></thead><tbody>';

    for (const [key, r] of Object.entries(verification.results)) {
      if (r.status === "missing") {
        html += `<tr><td>${r.desc}</td><td colspan="4">—</td><td class="fail">Не заполнено</td></tr>`;
      } else if (r.status === "invalid") {
        html += `<tr><td>${r.desc}</td><td colspan="4">—</td><td class="fail">Некорректное число</td></tr>`;
      } else {
        const errPct = (r.relError * 100).toFixed(1);
        const tolPct = (r.tolerance * 100).toFixed(0);
        html += `<tr>
          <td>${r.desc}</td>
          <td>${r.submitted.toFixed(4)} ${r.unit}</td>
          <td>${r.expected.toFixed(4)} ${r.unit}</td>
          <td>${errPct}%</td>
          <td>${tolPct}%</td>
          <td class="${r.status}">${r.status === "pass" ? "✓" : "✗"}</td>
        </tr>`;
      }
    }

    html += '</tbody></table>';
    if (verification.allPass) {
      html += '<p class="pass" style="font-weight:600;margin-top:.5rem">✓ Все значения в пределах допуска</p>';
    } else {
      html += '<p class="fail" style="font-weight:600;margin-top:.5rem">✗ Есть значения за пределами допуска</p>';
    }
    return html;
  },

  // Create an input form for a test
  renderForm: function(testId, containerId) {
    const ref = this.reference[testId];
    if (!ref) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    let html = `<div class="result-form" data-test="${testId}">`;
    for (const [key, spec] of Object.entries(ref)) {
      html += `<div class="ctrl" style="margin-bottom:.5rem">
        <label>${spec.desc} ${spec.unit ? '(' + spec.unit + ')' : ''}</label>
        <input type="number" step="any" id="res_${testId}_${key}" placeholder="${spec.value}">
      </div>`;
    }
    html += `<div style="display:flex;gap:.5rem;margin-top:.6rem">
      <button class="run-btn" onclick="CFDResults.checkAndSubmit('${testId}','${containerId}')">Проверить и отправить</button>
    </div>
    <div id="res_output_${testId}" style="margin-top:.8rem"></div>
    </div>`;

    container.innerHTML = html;
  },

  // Check values and submit to Firestore
  checkAndSubmit: async function(testId, containerId) {
    const ref = this.reference[testId];
    const submitted = {};

    for (const key of Object.keys(ref)) {
      const el = document.getElementById(`res_${testId}_${key}`);
      if (el && el.value) submitted[key] = el.value;
    }

    const verification = this.verify(testId, submitted);
    const outputEl = document.getElementById(`res_output_${testId}`);
    outputEl.innerHTML = this.renderTable(verification);

    // Submit to Firestore if auth is available
    if (typeof CFDAuth !== 'undefined' && CFDAuth.getUser()) {
      const ok = await CFDAuth.submitResults(testId, {
        ...submitted,
        allPass: verification.allPass,
        timestamp: new Date().toISOString(),
      });
      if (ok) {
        outputEl.innerHTML += '<p style="color:#1a6b5a;font-size:.82rem;margin-top:.3rem">✓ Результаты сохранены в базу</p>';
      }
    } else {
      outputEl.innerHTML += '<p style="color:#6b5d4f;font-size:.82rem;margin-top:.3rem">Войдите, чтобы сохранить результаты в базу</p>';
    }
  },
};
