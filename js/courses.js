// ============================================================
// Реестр курсов cfd-course
// ------------------------------------------------------------
// Один источник правды для UI и правил. Если добавляете курс —
// правьте только этот файл + обзорную карточку в index.html.
// Ключ id используется в:
//   - users.courseGroups.{id}       (рабочая группа по курсу)
//   - enrollments/{uid}_{id}        (заявка на курс)
//   - individual_grades/{uid}_{id}  (оценка по курсу)
//   - groups/{id}_group_NN          (данные рабочей группы)
// ============================================================

window.CFD_COURSES = [
  { id: 'nm',   short: 'ЧМ',       name: 'Численные методы',                          semester: 'Семестр',        path: 'nm/'   },
  { id: 'sem1', short: 'Теория',   name: 'Теория разностных схем',                    semester: 'Осень 2025',     path: 'sem1/' },
  { id: 'sem2', short: 'Разн. схемы', name: 'Разностные схемы и параллельная реализация', semester: 'Весна 2026', path: 'sem2/' },
  { id: 'mke',  short: 'МКЭ',      name: 'Метод конечных элементов',                  semester: 'Курс',           path: 'mke/'  },
  { id: 'sph',  short: 'SPH',      name: 'Метод сглаженных частиц (SPH)',             semester: 'Мини-курс',      path: 'sph/'  },
];

window.CFD_COURSE_BY_ID = {};
window.CFD_COURSES.forEach(function(c){ window.CFD_COURSE_BY_ID[c.id] = c; });
