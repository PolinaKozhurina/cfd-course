# Практика к §5-§6 «Паспорт явной схемы» — заготовка Maple
# Открыть: File -> Open, тип файла "Maple Input (.mpl)". Блоки выполнять по порядку.
# Уравнение переноса u_t + a u_x = 0, a > 0; r = a*tau/h; alpha = k*h.
# Всё, что относится к «уголку», написано целиком — это эталон из §5 (задание A).
restart;
assume(a > 0, h > 0, tau > 0, r > 0);

# ============ Задание B. Порядок аппроксимации: Г-форма -> П-форма ============
# Схема как функция базовой точки и шагов (пример: «уголок»).
upwind := (x, t, h, tau) -> (u(x, t + tau) - u(x, t))/tau + a*(u(x, t) - u(x - h, t))/h;

# Г-форма: разложение по Тейлору около (x,t).
Gform := collect(convert(mtaylor(upwind(x, t, h, tau), [h, tau], 3), diff), [tau, h], simplify);

# П-форма: подставляем общее решение u = F(x - a t) — все следствия уравнения
# (u_tt = a^2 u_xx, u_ttt = -a^3 u_xxx, ...) выполняются автоматически.
onSol := expr -> collect(simplify(eval(expr, u = ((x, t) -> F(x - a*t)))), [tau, h], factor):
Pform := onSol(diff(u(x,t),t) + a*diff(u(x,t),x) - Gform);
# В Pform читается первый ненулевой член: для «уголка» это (a h/2)(1-r) F''.
subs(tau = r*h/a, Pform);

# СВОЯ СХЕМА: запишите её вместо upwind и повторите три строки выше.
# schemeV := (x, t, h, tau) -> ... ;
# GformV := collect(convert(mtaylor(schemeV(x, t, h, tau), [h, tau], 4), diff), [tau, h], simplify);
# PformV := subs(tau = r*h/a, onSol(diff(u(x,t),t) + a*diff(u(x,t),x) - GformV));

# ============ Задание C. Множитель перехода ============
# Подстановка гармоники: узлу (j+p, n+s) отвечает lambda^s * exp(I*alpha*p).
# Для «уголка» u_j^{n+1} = u_j - r(u_j - u_{j-1}):
lamU := 1 - r + r*exp(-I*alpha);
modU2 := simplify(evalc(abs(lamU)^2), trig);          # 1 - 4 r (1-r) sin(alpha/2)^2
solve({modU2 <= 1, r > 0, alpha > 0, alpha < Pi}, r); # область устойчивости

# Диссипативная и дисперсионная поверхности «уголка» (сравнить с рисунками §5.4, §5.6).
gammaU := -argument(lamU)/(r*alpha);
plot3d(abs(lamU), alpha = 0.001 .. Pi, r = 0.001 .. 1, axes = boxed,
       labels = ["alpha", "r", "|lambda|"], title = "диссипативная поверхность, уголок");
plot3d(evalf(gammaU), alpha = 0.001 .. Pi, r = 0.001 .. 1, axes = boxed,
       labels = ["alpha", "r", "gamma"], title = "дисперсионная поверхность, уголок");

# СВОЯ СХЕМА: выпишите lamV руками из характеристического уравнения и постройте
# те же две поверхности; верхнюю границу по r возьмите из своей области устойчивости.
# lamV := ... ;
# modV2 := simplify(evalc(abs(lamV)^2), trig);
# gammaV := -argument(lamV)/(r*alpha);

# Трёхслойная схема (вариант В4): характеристическое уравнение квадратное.
# charEq := lambda^2 + 2*I*r*sin(alpha)*lambda - 1 = 0;
# roots := [solve(charEq, lambda)];   # физический корень -> 1 при tau -> 0

# ============ Согласование B и C ============
# Разложение |lambda| и gamma при малых alpha должно давать коэффициенты П-формы.
series(abs(lamU), alpha = 0, 4);
series(evalf(gammaU), alpha = 0, 4);

# ============ Задание D. Счёт (если считаете в Maple, а не в Python) ============
# Перенос на периоде [0,1], a = 1, N узлов, M шагов; step — процедура одного шага.
Digits := 15:
runScheme := proc(step, u0, N, r, T)
  local h, tau, M, y, n, i, x;
  h := 1.0/N; tau := r*h; M := round(T/tau);
  y := Array(0 .. N - 1, i -> evalf(u0(i*h)));
  for n to M do y := step(y, N, r); end do;
  [seq([i*h, y[i]], i = 0 .. N - 1)], M*tau;
end proc:

stepUpwind := proc(y, N, r)
  local z, i;
  z := Array(0 .. N - 1);
  for i from 0 to N - 1 do z[i] := y[i] - r*(y[i] - y[(i - 1) mod N]); end do;
  z;
end proc:

# Четыре начальных условия задания D.
u0sine   := x -> sin(2*Pi*x):
u0gauss  := x -> exp(-(x - 0.5)^2/(2*0.05^2)):
u0step   := x -> piecewise(x >= 0.5, 1, 0):
u0square := x -> piecewise(x >= 0.3 and x <= 0.6, 1, 0):

pts, Tend := runScheme(stepUpwind, u0sine, 200, 0.5, 1.0):
plots[pointplot](pts, style = line, title = "уголок, sin, r = 0.5, один оборот");
# Сравните амплитуду с |lambda|^M при alpha = 2*Pi/200 — это проверка инструмента (задание A).
evalf(abs(subs(alpha = 2*Pi/200, r = 0.5, lamU))^(1.0/0.5/0.005));
