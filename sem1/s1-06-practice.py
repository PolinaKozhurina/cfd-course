# -*- coding: utf-8 -*-
"""Практика к §5-§6: паспорт явной схемы для уравнения переноса u_t + a u_x = 0.

Заготовка. Всё, что относится к схеме «уголок», написано целиком — это эталон
из §5, на нём в задании A проверяется, что инструмент считает правильно.
Схему своего варианта вы дописываете сами: функция шага и множитель перехода.

Запуск:  python s1-06-practice.py
Нужны numpy и matplotlib.
"""
import numpy as np
import matplotlib.pyplot as plt

A = 1.0            # скорость переноса
L = 1.0            # длина отрезка, условия периодические

# --------------------------------------------------------------------------
# Начальные условия (все четыре из задания D)
# --------------------------------------------------------------------------
def u0_sine(x):    return np.sin(2 * np.pi * x / L)
def u0_gauss(x):   return np.exp(-(x - 0.5 * L) ** 2 / (2 * 0.05 ** 2))
def u0_step(x):    return np.where(x >= 0.5 * L, 1.0, 0.0)
def u0_square(x):  return np.where((x >= 0.3 * L) & (x <= 0.6 * L), 1.0, 0.0)

PROFILES = {'sine': u0_sine, 'gauss': u0_gauss, 'step': u0_step, 'square': u0_square}


def grid(N):
    """Равномерная сетка на [0, L) — последний узел совпадает с первым по периоду."""
    h = L / N
    return np.arange(N) * h, h


def exact(u0, x, t):
    """Точное решение: начальный профиль, сдвинутый на A*t по периоду."""
    return u0(np.mod(x - A * t, L))


# --------------------------------------------------------------------------
# Шаг схемы. u — массив значений на слое n, возвращается слой n+1.
# np.roll(u, +1) — это u_{j-1}, np.roll(u, -1) — это u_{j+1} (периодичность даром).
# --------------------------------------------------------------------------
def step_upwind(u, r):
    """Эталон: «уголок» (§5.3). Первый порядок, схемная вязкость a h (1-r)/2."""
    return u - r * (u - np.roll(u, 1))


def step_variant(u, r, q=0.0):
    """ЗДЕСЬ схема вашего варианта (двухслойная).

    Аргумент q нужен только варианту В6. Верните массив значений слоя n+1.
    """
    raise NotImplementedError('впишите схему своего варианта')


def step_variant3(u_new_prev, u_prev, r):
    """ЗДЕСЬ трёхслойная схема (вариант В4): по слоям n и n-1 вернуть слой n+1."""
    raise NotImplementedError('впишите трёхслойную схему своего варианта')


def run(step, u0, r, N, T, **kw):
    """Двухслойная схема: M = T/tau шагов. Возвращает x, численное и точное решение."""
    x, h = grid(N)
    tau = r * h / A
    M = int(round(T / tau))
    u = u0(x)
    for _ in range(M):
        u = step(u, r, **kw)
    return x, u, exact(u0, x, M * tau)


def run3(step3, start_step, u0, r, N, T, **kw):
    """Трёхслойная схема: первый слой считается двухслойной схемой start_step."""
    x, h = grid(N)
    tau = r * h / A
    M = int(round(T / tau))
    u_old = u0(x)
    u = start_step(u_old, r)
    for _ in range(M - 1):
        u_old, u = u, step3(u, u_old, r, **kw)
    return x, u, exact(u0, x, M * tau)


# --------------------------------------------------------------------------
# Меры качества (задание D)
# --------------------------------------------------------------------------
def norms(u, ue, h):
    e = u - ue
    return {'L1': h * np.sum(np.abs(e)),
            'L2': np.sqrt(h * np.sum(e ** 2)),
            'C': np.max(np.abs(e)),
            'TV': np.sum(np.abs(np.roll(u, -1) - u)),
            'min': u.min(), 'max': u.max()}


# --------------------------------------------------------------------------
# Множитель перехода и поверхности (задания A и C)
# --------------------------------------------------------------------------
def lam_upwind(alpha, r):
    """λ «уголка»: 1 - r + r e^{-i alpha}."""
    return 1 - r + r * np.exp(-1j * alpha)


def lam_variant(alpha, r, q=0.0):
    """ЗДЕСЬ множитель перехода вашего варианта — формулой, полученной вручную.

    Для трёхслойной схемы верните тот корень квадратного уравнения, который при
    tau -> 0 стремится к единице (физический); второй разберите отдельно.
    """
    raise NotImplementedError('впишите λ(alpha, r) своего варианта')


def surfaces(lam, r_max=1.0, n_a=121, n_r=81, title=''):
    """Диссипативная |λ|(alpha, r) и дисперсионная gamma = arg λ /(r alpha)."""
    alpha = np.linspace(1e-6, np.pi, n_a)
    r = np.linspace(1e-6, r_max, n_r)
    AL, R = np.meshgrid(alpha, r, indexing='ij')
    lv = lam(AL, R)
    mod = np.abs(lv)
    gamma = np.angle(lv) / (-R * AL)      # знак: волна бежит вправо, arg λ < 0
    fig = plt.figure(figsize=(11, 4.5))
    for k, (Z, name) in enumerate(((mod, r'$|\lambda|$'), (gamma, r'$\gamma$')), start=1):
        ax = fig.add_subplot(1, 2, k, projection='3d')
        ax.plot_surface(AL, R, Z, cmap='viridis', linewidth=0, antialiased=True)
        ax.set_xlabel(r'$\alpha = kh$'); ax.set_ylabel('r'); ax.set_zlabel(name)
        ax.set_title(name + ('  ' + title if title else ''))
    fig.tight_layout()
    return fig


# --------------------------------------------------------------------------
# Задание A: инструмент проверяется на «уголке»
# --------------------------------------------------------------------------
if __name__ == '__main__':
    surfaces(lam_upwind, r_max=1.0, title='«уголок»')

    N, T, r = 200, 1.0, 0.5
    for name in ('sine', 'gauss', 'step', 'square'):
        x, u, ue = run(step_upwind, PROFILES[name], r, N, T)
        h = L / N
        m = norms(u, ue, h)
        print('%-7s r=%.2f  L1=%.3e  L2=%.3e  C=%.3e  TV=%.3f  min=%+.3f  max=%+.3f'
              % (name, r, m['L1'], m['L2'], m['C'], m['TV'], m['min'], m['max']))

    x, u, ue = run(step_upwind, u0_sine, r, N, T)
    plt.figure(figsize=(7, 3.4))
    plt.plot(x, ue, label='точное'); plt.plot(x, u, label='«уголок», r = 0.5')
    plt.legend(); plt.tight_layout()
    plt.show()
