"""Связка страницы index.html с ядром core.py.
Функции получают и возвращают JSON-строки, чтобы JavaScript было просто их вызывать.
Выполняется после core.py, поэтому sp, s, analyze, ... уже определены."""
import json


def read_scheme(cells_json):
    """{"k,m": "s-1", ...}  ->  {(k, m): выражение sympy}"""
    scheme = {}
    for key, text in json.loads(cells_json).items():
        k, m = map(int, key.split(','))
        scheme[(k, m)] = sp.sympify(text.replace('^', '**'), locals={'s': s})
    return scheme


def as_set(x):
    return f'\\(\\sigma \\in {sp.latex(x)}\\)'


def report(scheme):
    """Отчёт для страницы: формулы, порядок, род ошибки, список свойств."""
    r = analyze(scheme, with_stability=False)

    g = ' '.join(f'+ \\left({sp.latex(c)}\\right) {d_latex(i, j)}'
                 for _, terms in r['gamma'][:2] for (i, j), c in terms.items())
    p = ' '.join(f'+ \\left({sp.latex(c)}\\right) {d_latex(0, k + 1)}'
                 for k, c in r['pi'][:3] if c != 0)

    props = []
    if 'exact_at' in r:
        props.append(('Ведущий член равен нулю', as_set(r['exact_at'])))
    if 'dissipation' in r:
        props.append(('Первый чётный член диссипативен', as_set(r['dissipation']['dissipative_for'])))
    if 'dispersion' in r:
        props.append(('Первый нечётный член: фаза отстаёт', as_set(r['dispersion']['lagging_for'])))
    if r['monotone']:
        props.append(('Монотонность (коэффициенты явной схемы ≥ 0)', as_set(r['monotone'][1])))
    else:
        props.append(('Монотонность', 'проверяется только для явных двухслойных схем'))

    stability = None
    params = set().union(*[c.free_symbols for c in scheme.values()]) - {s}
    if not params:
        st = stability_numeric(scheme, ns=150, nth=91)   # шаг по s = 0.02
        stability = ', '.join(f'[{lo}, {hi}]' for lo, hi in st) if st else 'нет при s ≤ 3'

    return {
        'gamma': f'u_t + a u_x {g} = \\dots',
        'pi': f'u_t + a u_x = {p.lstrip("+ ") or "0"} + \\dots',
        'order': str(r['order']),
        'kind': r.get('kind', '—'),
        'stability': stability,
        'props': props,
    }


def analyze_cells(cells_json):
    return json.dumps({'report': report(read_scheme(cells_json))}, ensure_ascii=False)


def mnk_cells(cells_json):
    nodes = [tuple(map(int, key.split(','))) for key in json.loads(cells_json)]
    res = undetermined(nodes)
    if res is None:
        return json.dumps({'message': 'На этом шаблоне нет схемы хотя бы первого порядка.'},
                          ensure_ascii=False)

    order, scheme, free = res
    cells = {f'{k},{m}': str(c).replace('sigma', 's').replace('**', '^')
             for (k, m), c in scheme.items()}
    message = (f'Максимальный порядок на шаблоне: {order}. '
               f'Свободные параметры: {", ".join(map(str, free)) or "нет"}.')
    answer = {'message': message, 'cells': cells}
    if not free:
        answer['report'] = report(scheme)
    return json.dumps(answer, ensure_ascii=False)
