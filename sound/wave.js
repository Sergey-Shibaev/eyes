// Режим «Волна»: дыхание как шум прибоя.
//   Вдох   — шум нарастает и светлеет (полосовой фильтр ползёт 400 → 1600 Гц), будто втягивают воздух.
//   Выдох  — долгое «шшш», которое темнеет и гаснет (ФНЧ 1800 → 300 Гц).
//   Задержка — еле слышная подложка; в последние три секунды тихие «туки»:
//              повыше — впереди выдох, пониже — впереди вдох.
// Сколько фазы прошло, слышно по громкости и окраске шума; метки начала фаз ставит ядро.
//
// Устройство: один зацикленный источник розового шума на всю сессию и две параллельные цепочки в api.out:
//   шум → полосовой фильтр → inGain (вдох),   шум → ФНЧ → exGain (выдох).
// Значения параметров нигде не читаются: режим сам помнит, на каком уровне оставил каждую громкость,
// и каждую фазу начинает с якоря на этом известном уровне.
// Уровни подобраны по замеру: шум ядра после полосового фильтра даёт СКЗ ≈ 0.065 (пики ≈ 0.3),
// после ФНЧ — ≈ 0.18 (пики ≈ 0.7), поэтому усиление вдоха заметно выше, чем у выдоха.
(function (root) {
  'use strict';

  const F_LOW = 293.66; // метка вдоха и задержки на выдохе, Гц
  const F_HIGH = 440; // метка выдоха и задержки на вдохе, Гц

  // вдох: полосовой фильтр
  const IN_Q = 1.2;
  const IN_F_FROM = 400;
  const IN_F_TO = 1600;
  const IN_START = 0.04; // громкость в начале вдоха
  const IN_PEAK = 0.45; // и в самом его конце
  const IN_RISE = 0.05; // с: выход на IN_START без ступеньки

  // выдох: фильтр нижних частот (у ФНЧ в Web Audio добротность задаётся в децибелах)
  const EX_Q = 0.7;
  const EX_F_FROM = 1800;
  const EX_F_TO = 300;
  const EX_PEAK = 0.3;
  const EX_END = 0.04;
  const EX_RISE = 0.4; // с: подъём «шшш» в начале выдоха…
  const EX_RISE_SHARE = 0.3; // …но не дольше этой доли короткой фазы

  const BED = 0.04; // подложка на задержках (обе цепочки)
  const BED_TAU = 0.1;
  const SILENT = 0.0001; // «тишина»: не ноль, чтобы любые рампы были законны
  const FADE_TAU = 0.07; // уход ненужной цепочки в тишину (~0.3 с)
  const RETUNE = 0.5; // с: когда цепочка уже затихла, возвращаем её фильтр на стартовую частоту

  // Страховка: если следующую фазу так и не расписали (страница спала), шум сам уходит в тишину.
  const GRACE = 0.3; // с после конца фазы; больше допуска ядра на опоздание (0.25 с)
  const TAIL_TAU = 0.12;
  const EPS = 0.002; // с: якорь новой фазы — строго после последнего события прошлой
  const NOW_MARGIN = 0.02; // с: якорь не раньше «сейчас» с запасом — звуковой поток идёт чуть впереди currentTime
  const MIN_SPAN = 0.5; // с: меньше места — автоматику фазы не расписываем

  const TICK_LAST = 3; // «туки» в последние секунды задержки
  const TICK_PEAK = 0.07;
  const TICK_BEFORE_EXHALE = 880;
  const TICK_BEFORE_INHALE = 587.33;

  // Куда setTargetAtTime успеет довести значение за dt секунд.
  const approach = (from, to, dt, tau) => to + (from - to) * Math.exp(-Math.max(0, dt) / tau);

  // Убрать будущую автоматику параметра и встать на известное значение.
  function anchor(param, t, value) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(value, t);
  }

  function create(api) {
    const ctx = api.ctx;

    const src = ctx.createBufferSource();
    src.buffer = api.noise();
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = IN_F_FROM;
    bp.Q.value = IN_Q;
    const inGain = ctx.createGain();
    inGain.gain.value = SILENT;
    src.connect(bp).connect(inGain).connect(api.out);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = EX_F_FROM;
    lp.Q.value = EX_Q;
    const exGain = ctx.createGain();
    exGain.gain.value = SILENT;
    src.connect(lp).connect(exGain).connect(api.out);

    src.start(ctx.currentTime);

    let edge = -Infinity; // конец последней расписанной фазы по аудиочасам
    let inLevel = SILENT; // громкости цепочек в момент edge
    let exLevel = SILENT;

    function ticks(ph) {
      const f = ph.nextPhase === 2 ? TICK_BEFORE_EXHALE : TICK_BEFORE_INHALE;
      for (let s = Math.max(1, ph.T - TICK_LAST); s <= ph.T - 1; s++) {
        api.blip(ph.t + s, f, { peak: TICK_PEAK, h2: 0 });
      }
    }

    function phase(ph) {
      const hold = ph.phase !== 0 && ph.phase !== 2;
      if (hold) ticks(ph); // «туки» стоят на сетке фазы и от шума не зависят

      // Границы соседних фаз считаются порознь и расходятся на миллисекунды. Якорь ставим строго после конца
      // прошлой фазы: иначе cancelScheduledValues снёс бы её последнюю рампу, и громкость провалилась бы заранее.
      // А если phase() опоздала (ph.t уже в прошлом), автоматика с якорем в прошлом применилась бы «задним числом»:
      // громкость скачком встала бы туда, где кривая должна была быть сейчас, — глухой удар в шуме. Поэтому якорь
      // не раньше текущего момента; сетка фазы (end, «туки») по-прежнему считается от ph.t.
      const a = Math.max(ph.t, edge + EPS, ctx.currentTime + NOW_MARGIN);
      const end = ph.t + ph.T;
      const span = end - a;
      if (span < MIN_SPAN) return; // звук приостанавливали, прошлая фаза ещё доигрывает — эту пропускаем

      // Известные уровни на момент a. Если фазы пропускались, страховочный хвост уже тянул их к тишине.
      const inFrom = approach(inLevel, SILENT, a - edge - GRACE, TAIL_TAU);
      const exFrom = approach(exLevel, SILENT, a - edge - GRACE, TAIL_TAU);
      anchor(inGain.gain, a, inFrom);
      anchor(exGain.gain, a, exFrom);

      if (ph.phase === 0) {
        // вдох: шум растёт и светлеет до самой границы фазы
        inGain.gain.linearRampToValueAtTime(IN_START, a + IN_RISE);
        inGain.gain.linearRampToValueAtTime(IN_PEAK, end);
        exGain.gain.setTargetAtTime(SILENT, a, FADE_TAU);
        anchor(bp.frequency, a, IN_F_FROM);
        bp.frequency.exponentialRampToValueAtTime(IN_F_TO, end);
        anchor(lp.frequency, a + RETUNE, EX_F_FROM); // цепочка выдоха уже молчит — готовим её фильтр
        inLevel = IN_PEAK;
        exLevel = approach(exFrom, SILENT, span, FADE_TAU);
      } else if (ph.phase === 2) {
        // выдох: быстрый подъём «шшш», затем оно темнеет и гаснет
        exGain.gain.linearRampToValueAtTime(EX_PEAK, a + Math.min(EX_RISE, EX_RISE_SHARE * span));
        exGain.gain.linearRampToValueAtTime(EX_END, end);
        inGain.gain.setTargetAtTime(SILENT, a, FADE_TAU);
        anchor(lp.frequency, a, EX_F_FROM);
        lp.frequency.exponentialRampToValueAtTime(EX_F_TO, end);
        anchor(bp.frequency, a + RETUNE, IN_F_FROM); // цепочка вдоха уже молчит — готовим её фильтр
        inLevel = approach(inFrom, SILENT, span, FADE_TAU);
        exLevel = EX_END;
      } else {
        // задержка: обе цепочки сходятся к еле слышной подложке; фильтры стоят, где их оставила прошлая фаза
        inGain.gain.setTargetAtTime(BED, a, BED_TAU);
        exGain.gain.setTargetAtTime(BED, a, BED_TAU);
        inLevel = approach(inFrom, BED, span, BED_TAU);
        exLevel = approach(exFrom, BED, span, BED_TAU);
      }

      // Страховочный хвост. Следующая фаза в обычном ходе снимает его своим якорем задолго до начала.
      inGain.gain.setTargetAtTime(SILENT, end + GRACE, TAIL_TAU);
      exGain.gain.setTargetAtTime(SILENT, end + GRACE, TAIL_TAU);
      edge = end;
    }

    function stop(t) {
      src.stop(t);
    }

    return { phase, stop };
  }

  root.BreathSound.register({ id: 'wave', name: 'Волна', fLow: F_LOW, fHigh: F_HIGH, create });
})(typeof self !== 'undefined' ? self : globalThis);
