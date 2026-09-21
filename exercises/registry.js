// Реестр упражнений для глаз. Каждый файл упражнения в этой папке вызывает EyeExercises.register({...}).
//
// Упражнение — это последовательность шагов. Шаг длится целое число секунд и бывает трёх видов:
//
//   'track' — за точкой следят глазами. Где точка находится, задаёт at(p).
//   'rest'  — глаза отдыхают: закрыть, посмотреть вдаль, поморгать свободно. Точка спрятана.
//   'blink' — сознательное моргание в ритме. Точка спрятана, знак на экране «моргает» в нужном темпе,
//             а отсчёт показывает, сколько морганий осталось. Темп задаёт необязательное поле period —
//             сколько секунд длится одно моргание (по умолчанию 2.4). Шаг всегда делится на целое число
//             морганий: при dur: 8 и period: 2.4 получится 3 моргания по 2,67 с.
//
// Контракт упражнения:
//   {
//     id: 'horizontal',            // латиницей, совпадает с именем файла
//     name: 'Влево-вправо',        // название для списка
//     note: 'Одна строка о том, что это и зачем',
//     evidence: 'moderate',        // насколько польза подтверждена исследованиями:
//                                  //   'strong'   — систематические обзоры или несколько хороших испытаний
//                                  //   'moderate' — есть контролируемые испытания, но их мало или они небольшие
//                                  //   'weak'     — отдельные слабые исследования
//                                  //   'none'     — традиционная практика без доказательств (просто приятный отдых)
//     evidenceNote: 'Что именно показано и у кого — одной фразой, без обещаний',
//     steps: [                     // либо массив, либо функция () => массив
//       {
//         kind: 'track',
//         label: 'Следите за точкой',   // крупная надпись на экране
//         dur: 8,                       // секунды, целое число, не меньше 1
//         at(p) { return [Math.sin(p * 2 * Math.PI), 0]; },  // только для 'track'
//       },
//       { kind: 'rest', label: 'Посмотрите вдаль', dur: 20 },
//       { kind: 'blink', label: 'Моргайте медленно', dur: 6 },
//     ],
//   }
//
// at(p) — положение точки, где p идёт от 0 до 1 за время шага.
// Возвращает [x, y] в долях от центра поля: (0, 0) — центр, (-1, -1) — левый верхний угол,
// (1, 1) — правый нижний. Значения за пределами -1..1 обрезаются.
// Функция должна быть непрерывной внутри шага: резкий скачок взгляда лучше задать отдельным шагом.
//
// Скорость. Упражнение описывается на базовой, нарочно медленной скорости, а пользователь
// в настройках ускоряет её в 2–6 раз (см. compose ниже). Поэтому на базовой скорости точка идёт
// не быстрее 0,5 поля в секунду: тогда и на ×6 она не быстрее 3 полей в секунду. Поле на телефоне —
// около 6,5 см на расстоянии ~33 см, то есть примерно 11° поля зрения; одна доля поля (от центра
// до края) — около 5,6°. 3 поля в секунду — около 17°/с, а глаз плавно ведёт цель до 20–30°/с
// без догоняющих рывков (Meyer и др., Vision Research, 1985).
//
// Правила, которые стоит соблюдать, чтобы упражнение было безопасным и полезным:
//   • точка движется плавно, на базовой скорости не быстрее 0,5 поля в секунду;
//   • замкнутый путь (конец совпадает с началом) при ускорении проходится несколько раз подряд,
//     поэтому круги и восьмёрки лучше делать замкнутыми — шаг не укоротится, а станет больше оборотов;
//   • после каждых 2–3 шагов слежения давайте шаг отдыха;
//   • упражнение целиком — от 30 секунд до 3 минут;
//   • при резких скачках взгляда между углами давайте на каждое положение не меньше секунды.
(function (root) {
  'use strict';

  const items = [];

  // Разворачивает шаги и проверяет их: в приложение не должно попасть сломанное упражнение.
  function prepare(def) {
    const raw = typeof def.steps === 'function' ? def.steps() : def.steps;
    if (!Array.isArray(raw) || !raw.length) throw new Error(`${def.id}: нет шагов`);
    let t0 = 0;
    const steps = raw.map((s, i) => {
      const kind = s.kind === 'rest' || s.kind === 'blink' ? s.kind : 'track';
      const dur = Math.max(1, Math.round(Number(s.dur)));
      if (!Number.isFinite(dur)) throw new Error(`${def.id}: шаг ${i} без длительности`);
      if (kind === 'track' && typeof s.at !== 'function') throw new Error(`${def.id}: шаг ${i} вида track без at(p)`);
      const step = { kind, dur, t0, label: String(s.label || ''), at: kind === 'track' ? s.at : null, index: i };
      if (kind === 'blink') {
        const wanted = Number(s.period) > 0 ? Number(s.period) : 2.4;
        step.blinks = Math.max(1, Math.round(dur / wanted)); // целое число морганий на шаг
        step.period = dur / step.blinks;
      }
      t0 += dur;
      return step;
    });
    return { steps, total: t0 };
  }

  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;

  // Какой путь у шага: неподвижная точка, замкнутый (конец там же, где начало) или открытый.
  function shapeOf(step) {
    const a = step.at(0) || [0, 0];
    const b = step.at(1) || [0, 0];
    if ([0.25, 0.5, 0.75].every((p) => near(step.at(p) || [0, 0], a)) && near(a, b)) return 'still';
    return near(a, b) ? 'closed' : 'open';
  }

  // Шаг с учётом ускорения. Неподвижный взгляд и шаги без точки длятся как задумано.
  // Замкнутый путь проходится laps раз, каждый круг в speed раз быстрее — шаг почти не укорачивается.
  // Открытый путь проходится один раз, но в speed раз быстрее — шаг короче.
  function speedUp(step, speed) {
    if (step.kind !== 'track' || speed === 1) return { ...step, laps: 1 };
    const shape = shapeOf(step);
    if (shape === 'still') return { ...step, laps: 1 };
    const laps = shape === 'closed' ? Math.max(1, Math.round(speed)) : 1;
    return { ...step, laps, dur: (step.dur * laps) / speed };
  }

  root.EyeExercises = {
    register(def) {
      if (items.some((e) => e.id === def.id)) return;
      const { steps, total } = prepare(def);
      const evidence = ['strong', 'moderate', 'weak', 'none'].includes(def.evidence) ? def.evidence : 'none';
      items.push({ id: def.id, name: def.name, note: def.note || '', evidence, evidenceNote: def.evidenceNote || '', steps, total });
    },
    list() {
      return items.slice();
    },
    get(id) {
      return items.find((e) => e.id === id) || null;
    },
    // Программа занятия: несколько упражнений подряд, по кругу, с общей скоростью (1–6).
    // Возвращает то же, что и одно упражнение (steps, total), плюс parts — где какое начинается.
    compose(list, speed) {
      const k = Math.max(1, Math.min(6, Number(speed) || 1));
      const steps = [];
      const parts = [];
      let t0 = 0;
      for (const exercise of list) {
        const start = t0;
        for (const s of exercise.steps) {
          const step = speedUp(s, k);
          step.t0 = t0;
          step.exercise = exercise;
          step.index = steps.length;
          if (step.kind === 'blink') step.period = step.dur / step.blinks;
          steps.push(step);
          t0 += step.dur;
        }
        parts.push({ exercise, t0: start, total: t0 - start });
      }
      return { steps, total: t0, parts, speed: k };
    },
    // Где находится точка и какой шаг идёт в момент t секунд от начала упражнения или программы.
    at(exercise, t) {
      const time = Math.max(0, t);
      const done = Math.floor(time / exercise.total); // сколько раз упражнение уже повторилось
      const inCycle = time - done * exercise.total;
      const steps = exercise.steps;
      let i = 0;
      while (i < steps.length - 1 && inCycle >= steps[i].t0 + steps[i].dur) i++;
      const step = steps[i];
      const into = inCycle - step.t0;
      const p = Math.min(1, Math.max(0, into / step.dur));
      let x = 0;
      let y = 0;
      if (step.at) {
        // На ускорении замкнутый путь проходится laps раз: берём дробную часть, конец круга = начало
        const laps = step.laps || 1;
        const q = laps > 1 && p < 1 ? (p * laps) % 1 : p;
        const point = step.at(q) || [0, 0];
        x = Math.max(-1, Math.min(1, Number(point[0]) || 0));
        y = Math.max(-1, Math.min(1, Number(point[1]) || 0));
      }
      // Отсчёт: на моргании — сколько морганий осталось, на остальных шагах — сколько секунд.
      const left = step.kind === 'blink'
        ? Math.max(1, step.blinks - Math.floor(into / step.period))
        : Math.max(1, Math.ceil(step.dur - into));
      return { step, p, x, y, into, left, rounds: done };
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
