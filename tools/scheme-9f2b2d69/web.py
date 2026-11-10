"""Связка страницы index.html с ядром core.py.
Функции получают и возвращают JSON-строки, чтобы JavaScript было просто их вызывать.
Выполняется после core.py, поэтому sp, s, analyze, ... уже определены."""
import json


def read_scheme(cells_json):
    """{"k,m": "s-1", ...}  ->  {(k, m): выражение sympy}"""
    cells = json.loads(cells_json)
    scheme = {}
    for key, text in cells.items():
        k, m = map(int, key.split(','))
        scheme[(k, m)] = sp.sympify(text.replace('^', '**'), locals={'s': s})
    return scheme


def as_set(x):
    return f'\\(\\sigma \\in {sp.latex(x)}\\)'


def report(scheme):
    """Список строк отчёта [(заголовок, текст)]."""
    r = analyze(scheme, with_stability=False)
    rows = []

    g = ' '.join(f'+ \\left({sp.latex(c)}\\right) {d_latex(i, j)}'
                 for _, terms in r['gamma'][:2] for (i, j), c in terms.items())
    rows.append(('Г-форма', f'\\[ u_t + a u_x {g} = \\dots \\]'))

    p = ' '.join(f'+ \\left({sp.latex(c)}\\right) {d_latex(0, k + 1)}'
                 for k, c in r['pi'][:3] if c != 0)
    rows.append(('П-форма', f'\\[ u_t + a u_x = {p.lstrip("+ ") or "0"} + \\dots \\]'))

    rows.append(('Порядок аппроксимации на решениях', str(r['order'])))
    if 'kind' in r:
        rows.append(('Род ведущей ошибки', r['kind']))
    if 'exact_at' in r:
        rows.append(('Ведущий член равен нулю при', as_set(r['exact_at'])))
    if 'dissipation' in r:
        rows.append(('Первый чётный член диссипативен при', as_set(r['dissipation']['dissipative_for'])))
    if 'dispersion' in r:
        rows.append(('Первый нечётный член: фаза отстаёт при', as_set(r['dispersion']['lagging_for'])))
    if r['monotone']:
        rows.append(('Монотонность (все коэффициенты явной схемы ≥ 0)', as_set(r['monotone'][1])))
    else:
        rows.append(('Монотонность', 'проверяется только для явных двухслойных схем'))

    params = set().union(*[c.free_symbols for c in scheme.values()]) - {s}
    if not params:
        st = stability_numeric(scheme, ns=150, nth=91)   # шаг по s = 0.02, реже по theta — быстрее в браузере
        text = ', '.join(f'[{lo}, {hi}]' for lo, hi in st) if st else 'неустойчива при всех s из (0, 3]'
        rows.append(('Устойчивость (спектральный признак, численно, s ≤ 3)', text))
    return rows


def analyze_cells(cells_json):
    return json.dumps(report(read_scheme(cells_json)), ensure_ascii=False)


def mnk_cells(cells_json):
    nodes = [tuple(map(int, key.split(','))) for key in json.loads(cells_json)]
    res = undetermined(nodes)
    if res is None:
        rows = [('МНК', 'На этом шаблоне нет схемы хотя бы первого порядка.')]
        return json.dumps({'rows': rows}, ensure_ascii=False)

    order, scheme, free = res
    cells = {f'{k},{m}': str(c).replace('sigma', 's').replace('**', '^')
             for (k, m), c in scheme.items()}
    rows = [('МНК', f'Максимальный порядок на шаблоне: {order}. '
                    f'Свободные параметры: {", ".join(map(str, free)) or "нет"}.')]
    if not free:
        rows += report(scheme)
    return json.dumps({'rows': rows, 'cells': cells}, ensure_ascii=False)
