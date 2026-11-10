"""Ядро анализатора разностных схем для u_t + a u_x = 0 (прототип).

Схема задаётся шаблоном: {(k, m): c}, что означает  sum c * y_{j+k}^{n+m} = 0,
k — сдвиг по пространству, m — по времени (m = 1 — верхний слой n+1).
Коэффициенты c — выражения sympy от числа Куранта s = a*tau/h (и, если нужно,
свободных параметров, например веса схемы).

Что считается:
  gamma_form()   — первое дифференциальное приближение в Г-форме (с производными по t),
  pi_form()      — то же в П-форме (только производные по x; процедура Уорминга–Хайетта,
                   эквивалентная решению дисперсионного соотношения относительно d/dt),
  analyze()      — порядок, ведущий член, род ошибки (диссипация/дисперсия), фазовая ошибка,
                   условия устойчивости (спектральный признак), монотонность (Годунов),
  undetermined() — метод неопределённых коэффициентов: по шаблону найти схему
                   максимального порядка (на решениях) и семейство при свободных параметрах.
"""
import numpy as np
import sympy as sp

s, a, h, tau, eps = sp.symbols('sigma a h tau epsilon', positive=True)
P, Q = sp.symbols('P Q')      # операторы d/dt и d/dx
N_ORD = 4                     # сколько порядков по h держать в разложениях


# ---------- разложение Тейлора ----------
def _residual(scheme, N=N_ORD):
    """R(P,Q)/(норм.) = (P + aQ) + sum_{r>=1} eps^r G_r(P,Q); возвращает [G_0, G_1, ...]."""
    sub = {s: a * tau / h}
    R = 0
    for (k, m), c in scheme.items():
        z = eps * (m * tau * P + k * h * Q)
        R += sp.sympify(c).subs(sub) * sum(z**n / sp.factorial(n) for n in range(N + 2))
    R = sp.expand(R)
    if sp.simplify(R.coeff(eps, 0)) != 0:
        raise ValueError('Схема не аппроксимирует: сумма коэффициентов не равна нулю')
    norm = sp.simplify(R.coeff(eps, 1).coeff(P))          # = tau * sum(m*c)
    if norm == 0:
        raise ValueError('Нет производной по времени: sum(m*c) = 0')
    G = [sp.expand(sp.simplify(R.coeff(eps, r + 1) / norm)) for r in range(N + 1)]
    if sp.simplify(G[0] - (P + a * Q)) != 0:
        raise ValueError(f'Схема не согласована с u_t + a u_x = 0: ведущая часть {sp.factor(G[0])}')
    return G


def gamma_form(scheme, N=N_ORD):
    """Г-форма: список (r, {(i, j): коэфф.}) — члены eps^r * d^i_t d^j_x u, i + j = r + 1."""
    G = _residual(scheme, N)
    out = []
    for r in range(1, N + 1):
        poly = sp.Poly(G[r], P, Q)
        terms = {mon: sp.factor(cf) for mon, cf in zip(poly.monoms(), poly.coeffs())
                 if sp.simplify(cf) != 0}
        out.append((r, terms))
    return out


def pi_form(scheme, N=N_ORD):
    """П-форма: u_t + a u_x = sum_r c_r d^{r+1}_x u; возвращает [(r, c_r)], c_r через h и sigma."""
    G = _residual(scheme, N)
    Pser = -a * Q
    for _ in range(N):            # итерация P = -aQ - sum eps^r G_r(P, Q), усечение по eps^N
        rhs = -a * Q - sum(eps**r * G[r].subs(P, Pser) for r in range(1, N + 1))
        rhs = sp.expand(rhs)
        Pser = sum(rhs.coeff(eps, r) * eps**r for r in range(N + 1))
    out = []
    for r in range(1, N + 1):
        cr = sp.expand(Pser.coeff(eps, r)).coeff(Q, r + 1)
        cr = sp.factor(sp.simplify(cr.subs(tau, s * h / a)))
        out.append((r, cr))
    return out


# ---------- анализ ----------
def _sign_condition(expr):
    """Множество s > 0, где expr > 0 (a, h > 0)."""
    try:
        e = sp.simplify(expr / (a * h**sp.degree(sp.Poly(expr, h))))
        return sp.solveset(e > 0, s, sp.Interval.open(0, sp.oo))
    except Exception:
        return None


def amplification(scheme, theta=sp.Symbol('theta', real=True)):
    """Характеристическое уравнение sum_m (sum_k c e^{ik theta}) g^(m - m_min) = 0."""
    g = sp.Symbol('g')
    mmin = min(m for _, m in scheme)
    poly = sum(sp.sympify(c) * sp.exp(sp.I * k * theta) * g**(m - mmin) for (k, m), c in scheme.items())
    return sp.expand(poly), g, theta


def stability_numeric(scheme, smax=3.0, ns=300, nth=361):
    """Спектральный признак численно: множество s in (0, smax], где max|g| <= 1 по всем theta."""
    poly, g, th = amplification(scheme)
    deg = sp.degree(poly, g)
    cfs = [sp.lambdify((s, th), poly.coeff(g, d), 'numpy') for d in range(deg, -1, -1)]
    thetas = np.linspace(0, np.pi, nth)
    ok = []
    for sv in np.linspace(smax / ns, smax, ns):
        worst = 0.0
        for t in thetas:
            co = [complex(f(sv, t)) for f in cfs]
            while co and abs(co[0]) < 1e-14:
                co = co[1:]
            if len(co) > 1:
                worst = max(worst, np.max(np.abs(np.roots(co))))
        ok.append((sv, worst <= 1 + 1e-9))
    # склеить в интервалы
    ivs, start = [], None
    for sv, good in ok + [(None, False)]:
        if good and start is None:
            start = sv
        if not good and start is not None:
            ivs.append((round(float(start), 3), round(float(prev), 3)))
            start = None
        prev = sv
    return ivs


def monotonicity(scheme):
    """Явная двухслойная схема y^{n+1}_j = sum b_k y^n_{j+k} монотонна <=> все b_k >= 0."""
    layers = {m for _, m in scheme}
    up = [(k, c) for (k, m), c in scheme.items() if m == 1]
    if layers != {0, 1} or len(up) != 1 or up[0][0] != 0:
        return None
    c1 = sp.sympify(up[0][1])
    b = {k: sp.simplify(-sp.sympify(c) / c1) for (k, m), c in scheme.items() if m == 0}
    conds = [sp.solveset(bk >= 0, s, sp.Interval.open(0, sp.oo)) for bk in b.values()]
    return b, sp.Intersection(*conds)


def analyze(scheme, N=N_ORD, with_stability=True):
    rep = {'gamma': gamma_form(scheme, N), 'pi': pi_form(scheme, N)}
    pi = [(r, c) for r, c in rep['pi'] if sp.simplify(c) != 0]
    rep['order'] = pi[0][0] if pi else f'> {N}'
    if pi:
        r0, c0 = pi[0]
        rep['leading'] = (r0, c0)
        rep['exact_at'] = sp.solveset(sp.numer(sp.together(c0)), s, sp.Interval.open(0, sp.oo))
    diss = next(((r, c) for r, c in pi if (r + 1) % 2 == 0), None)
    disp = next(((r, c) for r, c in pi if (r + 1) % 2 == 1), None)
    if diss:  # c d^{2q}_x: диссипативен при (-1)^{q+1} c > 0
        q = (diss[0] + 1) // 2
        rep['dissipation'] = dict(term=diss, dissipative_for=_sign_condition((-1)**(q + 1) * diss[1]))
    if disp:  # c d^{2q+1}_x: фазовая скорость a - (-1)^q c k^{2q}; отставание при (-1)^q c > 0
        q = disp[0] // 2
        rep['dispersion'] = dict(term=disp, lagging_for=_sign_condition((-1)**q * disp[1]))
    if pi:
        rep['kind'] = 'диссипативная' if (pi[0][0] + 1) % 2 == 0 else 'дисперсионная'
    rep['monotone'] = monotonicity(scheme)
    if with_stability and not (set().union(*[sp.sympify(c).free_symbols for c in scheme.values()]) - {s}):
        rep['stable_numeric'] = stability_numeric(scheme)
    return rep


# ---------- метод неопределённых коэффициентов ----------
def undetermined(nodes, max_order=6):
    """По узлам шаблона [(k, m)] найти коэффициенты максимального порядка на решениях.
    Условия: sum c = 0, sum m c = 1 (нормировка), и разложение sum c exp(xi(k - m s))
    обнуляется до степени xi^p. Возвращает (порядок, схема, свободные параметры)."""
    cs = {nd: sp.Symbol(f'c_{nd[0]}_{nd[1]}'.replace('-', 'm')) for nd in nodes}
    xi = sp.Symbol('xi')
    E = sp.expand(sum(c * sp.exp(xi * (k - m * s)).series(xi, 0, max_order + 3).removeO()
                      for (k, m), c in cs.items()))
    eqs = [sp.Eq(sum(m * c for (k, m), c in cs.items()), 1)]
    best = None
    for p in range(0, max_order + 2):
        eqs.append(sp.Eq(E.coeff(xi, p), 0))
        sol = sp.solve(eqs, list(cs.values()), dict=True)
        if not sol:
            break
        best = (p, sol[0])           # обнулены xi^0..xi^p => R/tau = O(h^p), порядок p
    if best is None or best[0] < 1:
        return None
    order, sol = best
    scheme = {nd: sp.factor(c.subs(sol)) for nd, c in cs.items()}
    free = sorted(set().union(*[v.free_symbols for v in scheme.values()]) - {s}, key=str)
    return order, scheme, free


# ---------- вывод ----------
def d_latex(i, j):
    n = i + j
    den = (f'\\partial t^{{{i}}}' if i > 1 else '\\partial t' if i else '') + \
          (f'\\partial x^{{{j}}}' if j > 1 else '\\partial x' if j else '')
    return f'\\frac{{\\partial^{{{n}}} u}}{{{den}}}' if n > 1 else f'\\frac{{\\partial u}}{{{den}}}'


def gamma_latex(gf, upto=2):
    parts = ['u_t + a u_x']
    for r, terms in gf[:upto]:
        for (i, j), c in terms.items():
            parts.append(f'+ \\left({sp.latex(c)}\\right) {d_latex(i, j)}')
    return ' '.join(parts) + f' = O(\\varepsilon^{{{upto + 1}}})'


def pi_latex(pf, upto=3):
    parts = [f'+ \\left({sp.latex(c)}\\right) {d_latex(0, r + 1)}' for r, c in pf[:upto] if c != 0]
    return 'u_t + a u_x = ' + (' '.join(parts).lstrip('+ ') or '0')
