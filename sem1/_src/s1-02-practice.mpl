# Практика к §2 «Аппроксимация, устойчивость, сходимость» — заготовка Maple
# Открыть: File -> Open, тип файла "Maple Input (.mpl)". Выполнять блоки по порядку (!!! или Ctrl+Enter).
# Уравнение переноса: u_t + a u_x = 0, a > 0.  Сетка: шаг h по x, tau по t.
restart;

# ================= Задание A. Явный «уголок» (2.17) =================
# Схема как функция от базовой точки (x,t) и шагов; u — произвольная гладкая функция.
scheme := (x, t, h, tau) -> (u(x, t + tau) - u(x, t))/tau + a*(u(x, t) - u(x - h, t))/h;

# Шаг 1–2 алгоритма §2.8: разложение всех значений по Тейлору около (x,t).
# mtaylor(..., [h, tau], N) оставляет члены степени < N по h и tau вместе.
L1 := convert(mtaylor(scheme(x, t, h, tau), [h, tau], 3), diff):
L1 := collect(L1, [tau, h], simplify);

# Шаг 3–4: исходное уравнение и разность Ru = Lu - L1u.
Lu := diff(u(x, t), t) + a*diff(u(x, t), x):
Ru := collect(simplify(Lu - L1), [tau, h]);
# Порядок на произвольной функции: младшие степени tau и h в Ru.

# На РЕШЕНИИ: подставляем общее решение u = F(x - a t) (все дифференциальные
# следствия u_tt = a^2 u_xx, u_xt = -a u_xx, ... выполняются автоматически).
onSol := expr -> collect(simplify(eval(expr, u = ((x, t) -> F(x - a*t)))), [tau, h], factor):
RuSol := onSol(Ru);
# Вопрос: при каком соотношении tau и h член первого порядка обращается в нуль?
# (сравните с задачей 9 ДЗ №1)

# ================= Задание B. Схема варианта =================
# Впишите свою схему вместо В3 (Лакс–Вендрофф), приведённого как пример.
schemeV := (x, t, h, tau) -> (u(x, t + tau) - u(x, t))/tau + a*(u(x + h, t) - u(x - h, t))/(2*h)
    - a^2*tau/2*(u(x - h, t) - 2*u(x, t) + u(x + h, t))/h^2;

L1V := collect(convert(mtaylor(schemeV(x, t, h, tau), [h, tau], 4), diff), [tau, h], simplify);
RuV := collect(simplify(Lu - L1V), [tau, h]);        # порядок на произвольной функции
RuVSol := onSol(RuV);                                  # порядок на решении

# Та же схема, другая базовая точка: сдвигаем аргументы (пример: (x, t + tau/2)).
# Разложение идёт около (x,t), поэтому в схему подставляем t - tau/2.
L1Vshift := collect(convert(mtaylor(schemeV(x, t - tau/2, h, tau), [h, tau], 4), diff), [tau, h], simplify);
RuVshiftSol := onSol(simplify(Lu - L1Vshift));
# Сравните порядок с RuVSol. Изменились ли коэффициенты? порядок?

# ================= Задание C. Схема Лакса и закон предельного перехода =================
schemeL := (x, t, h, tau) -> (u(x, t + tau) - (u(x - h, t) + u(x + h, t))/2)/tau
    + a*(u(x + h, t) - u(x - h, t))/(2*h);
L1L := collect(convert(mtaylor(schemeL(x, t, h, tau), [h, tau], 4), diff), [tau, h], simplify);
# Закон tau = h^2/mu: остаётся один малый параметр h.
L1Lpar := collect(convert(mtaylor(subs(tau = h^2/mu, schemeL(x, t, h, tau)), [h], 3), diff), h, simplify);
# Закон tau = kappa*h:
L1Lhyp := collect(convert(mtaylor(subs(tau = kappa*h, schemeL(x, t, h, tau)), [h], 3), diff), h, simplify);
# Вопросы: какое уравнение аппроксимирует схема при tau = h^2/mu? каков порядок при tau = kappa*h?

# ================= Задание D. Аппроксимация без сходимости =================
# x' = 2t, x(0) = 0, точное решение x = t^2. Двухшаговый метод:
#   (X_i - 3 X_{i-1} + 2 X_{i-2})/tau = f_{i-1} - 2 f_{i-2},  f(t,x) = 2t.
f := (t, x) -> 2*t:
# Невязка на точном решении (проекция t^2 на сетку):
resid := simplify((t^2 - 3*(t - tau)^2 + 2*(t - 2*tau)^2)/tau - (f(t - tau, 0) - 2*f(t - 2*tau, 0)));
# Точное решение разностной задачи: rsolve решает линейную рекуррентность.
rec := X(i) - 3*X(i - 1) + 2*X(i - 2) = tau*(f((i - 1)*tau, 0) - 2*f((i - 2)*tau, 0)):
solExact := factor(rsolve({rec, X(0) = 0, X(1) = tau^2}, X(i)));
# Стартовое значение с погрешностью eps:
solPert := simplify(rsolve({rec, X(0) = 0, X(1) = tau^2 + eps}, X(i)));
errPert := simplify(solPert - (i*tau)^2);
# Возмущение 1e-16 через 100 шагов (tau = 0.01, T = 1):
evalf(subs(eps = 1e-16, tau = 1e-2, i = 100, errPert));
# Вопросы: есть ли аппроксимация? устойчивость по Опр. 3? сходимость по Опр. 1?

# ================= Задание E (если осталось время). Порядок сходимости численно =================
# «Уголок» для u_t + u_x = 0, u0 = sin(2 pi x), период [0,1], T = 1, sigma = tau/h.
Digits := 15:
runCorner := proc(N, sigma, T)
  local h, tau, M, y, ynew, i, n, errC, xi;
  h := 1.0/N; tau := sigma*h; M := round(T/tau);
  y := Array(0 .. N - 1, i -> evalf(sin(2*Pi*i*h)));
  for n to M do
    ynew := Array(0 .. N - 1);
    for i from 0 to N - 1 do
      ynew[i] := y[i] - sigma*(y[i] - y[(i - 1) mod N]);
    end do;
    y := ynew;
  end do;
  errC := 0;
  for i from 0 to N - 1 do
    xi := i*h;
    errC := max(errC, abs(y[i] - evalf(sin(2*Pi*(xi - M*tau)))));
  end do;
  errC;
end proc:
errs := [seq(runCorner(N, 0.5, 1.0), N in [20, 40, 80, 160])];
orders := [seq(evalf(log[2](errs[k]/errs[k + 1])), k = 1 .. 3)];
# При sigma = 1 схема точна (задача 9 ДЗ №1): ожидается машинный нуль.
runCorner(40, 1.0, 1.0);
