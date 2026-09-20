// Режим «Поющий тон»: непрерывный мягкий тон, похожий на поющую чашу.
//   вдох                — тон плавно поднимается (ре → ля, квинта) и крепнет;
//   задержка на вдохе   — стоит наверху: сразу чуть приглушается («дошли»), затем затихает, как чаша после удара;
//   выдох               — снова «удар» и плавный спуск с затиханием;
//   задержка на выдохе  — стоит внизу, почти не слышен.
// Высота тона показывает, сколько фазы прошло. На задержках высота не меняется, поэтому их конец
// предупреждают тихие «туки» в последние секунды — на октаву выше тона, чтобы он их не заглушал.
// Метки начала фаз (колокольчики и двойные «туки») ставит ядро.
(function (root) {
  'use strict';

  const F_LOW = 293.66; // ре первой октавы — «пол»
  const F_HIGH = 440; // ля — «потолок»; ровно квинта: шире звучит как сирена
  const DETUNE = 4; // центы: два генератора на −4 и +4 дают медленное живое «пение»
  const LP_FREQ = 1200; // фильтр снимает резкие обертоны треугольной волны
  const LP_Q = 0.7;

  // Уровни toneGain. Генераторов два, поэтому пик сигнала вдвое больше: 0.14 → 0.28.
  const G_SILENT = 0.0001;
  const G_SOFT = 0.04; // начало вдоха и конец выдоха
  const G_FULL = 0.14; // конец вдоха и начало выдоха
  const G_HOLD_HIGH = 0.05; // сюда затихает тон на верхней задержке
  const G_HOLD_DAMP = 0.08; // …начиная с этого уровня: двойной «тук» метки звучит на той же высоте (ля)
  //                           и в полном тоне (0.14 × 2 генератора ≈ 0.24 пика против 0.13 у «тука») тонул бы.
  //                           Сам быстрый спад — ясный знак «дошли, держим». G_HOLD_DAMP = G_FULL отключает приглушение.
  const DAMP = 0.12; // с — длительность этого приглушения
  const G_HOLD_LOW = 0.025; // нижняя задержка: почти тишина
  const FADE = 0.3; // с — нарастание в начале вдоха и выдоха
  const HOLD_LOW_TAU = 0.3; // с — как быстро тон уходит вниз на нижней задержке
  const GLIDE = 0.15; // с — доезд до нужной высоты, если фаза началась не с неё (необычный цикл, страница спала)
  const REST_DELAY = 0.5; // следующая фаза не пришла (страница уснула): через столько секунд после конца фазы
  const REST_TAU = 1; //    тон сам уходит к G_HOLD_LOW, а не гудит громко, пока страница не проснётся
  const EPS = 0.001; // с — зазор после конца прошлой фазы, см. phase()
  const NOW_MARGIN = 0.02; // с — запас от «сейчас» для опоздавшей фазы: звуковой поток чуть впереди currentTime
  const TICKS = 3; // сколько последних секунд задержки отмечать «туками»
  const TICK = { peak: 0.07, attack: 0.005, tau: 0.03, h2: 0 };

  // Уровень параметра после setTargetAtTime(to, t0, tau), начатого с уровня from.
  // param.value не отражает автоматизацию надёжно, поэтому текущий уровень считаем сами.
  const decay = (from, to, t0, tau) => (x) => (x <= t0 ? from : to + (from - to) * Math.exp(-(x - t0) / tau));

  function create(api) {
    const { ctx, out, fLow, fHigh } = api;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = LP_FREQ;
    filter.Q.value = LP_Q;
    const toneGain = ctx.createGain();
    toneGain.gain.value = G_SILENT;
    filter.connect(toneGain);
    toneGain.connect(out);
    const oscs = [-DETUNE, DETUNE].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = fLow;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start();
      return osc;
    });

    let prevEnd = -1; // конец последней расписанной фазы, аудиочасы
    let freqEnd = fLow; // частота, на которой она закончилась
    let gainAt = decay(G_SILENT, G_SILENT, 0, 1); // уровень toneGain после неё как функция времени

    function phase(ph) {
      const t = ph.t;
      const end = t + ph.T;
      // Рампы прошлой фазы кончаются в prevEnd, а t из-за дрожания часов может оказаться на несколько мс раньше.
      // Событие, вставленное раньше конца идущей рампы (как и cancelScheduledValues раньше него), ломает рампу:
      // параметр прыгает к её началу. Поэтому якорь — строго после prevEnd. А если phase() опоздала (t в прошлом),
      // якорь в прошлом дал бы скачок на уже «пройденную» часть кривой — тогда плавно стартуем от текущего момента.
      // Сдвигается только якорь непрерывного тона: сетка фазы (end, «туки») по-прежнему считается от t.
      const a = Math.max(t, prevEnd + EPS, ctx.currentTime + NOW_MARGIN);
      if (end - a < 0.05) return; // часы прыгнули назад почти на целую фазу — оставляем как есть

      const rising = ph.phase === 0;
      const falling = ph.phase === 2;
      const f0 = ph.phase === 0 || ph.phase === 3 ? fLow : fHigh; // откуда фаза начинается
      const f1 = rising ? fHigh : falling ? fLow : f0; // где заканчивается
      const glide = Math.min(GLIDE, (end - a) / 4);
      for (const osc of oscs) {
        const p = osc.frequency;
        p.cancelScheduledValues(a);
        p.setValueAtTime(freqEnd, a); // от известного значения: без скачка, даже если задержки в цикле нет
        if (freqEnd !== f0) p.exponentialRampToValueAtTime(f0, a + glide);
        if (f1 !== f0) p.exponentialRampToValueAtTime(f1, end);
      }

      const g = toneGain.gain;
      const g0 = gainAt(a);
      g.cancelScheduledValues(a);
      g.setValueAtTime(g0, a);
      if (rising || falling) {
        const fade = Math.min(FADE, (end - a) / 3);
        // вдох: за fade выходим на прямую G_SOFT → G_FULL (на первой фазе — из тишины);
        // выдох: «удар» до G_FULL и долгий спад до G_SOFT
        const afterFade = falling ? G_FULL : G_SOFT + ((G_FULL - G_SOFT) * (a + fade - t)) / ph.T;
        const last = falling ? G_SOFT : G_FULL;
        g.linearRampToValueAtTime(afterFade, a + fade);
        g.linearRampToValueAtTime(last, end);
        // страховка от «застрял громко»; следующая phase() отменит её раньше, чем она начнётся
        g.setTargetAtTime(G_HOLD_LOW, end + REST_DELAY, REST_TAU);
        gainAt = decay(last, G_HOLD_LOW, end + REST_DELAY, REST_TAU);
      } else {
        const high = ph.phase === 1;
        const to = high ? G_HOLD_HIGH : G_HOLD_LOW;
        const tau = high ? ph.T / 3 : HOLD_LOW_TAU; // наверху затихает всю задержку, как чаша после удара
        // наверху — сначала короткое приглушение до G_HOLD_DAMP (см. константу), потом долгий спад; внизу — сразу спад
        const damp = high ? Math.min(DAMP, (end - a) / 4) : 0;
        const g1 = high ? Math.min(g0, G_HOLD_DAMP) : g0;
        const t1 = a + damp;
        if (damp > 0) g.linearRampToValueAtTime(g1, t1);
        g.setTargetAtTime(to, t1, tau);
        const ring = decay(g1, to, t1, tau);
        gainAt = damp > 0 ? (x) => (x < t1 ? g0 + ((g1 - g0) * (x - a)) / damp : ring(x)) : ring;
        // «туки» перед концом задержки: ровно по секундам, на октаву выше стоящего тона
        for (let s = Math.max(1, ph.T - TICKS); s <= ph.T - 1; s++) api.blip(t + s, 2 * f0, TICK);
      }
      prevEnd = end;
      freqEnd = f1;
    }

    function stop(t) {
      for (const osc of oscs) osc.stop(t);
    }

    return { phase, stop };
  }

  root.BreathSound.register({
    id: 'tone',
    name: 'Поющий тон',
    fLow: F_LOW,
    fHigh: F_HIGH,
    // Тон уезжает от высоты колокольчика; на коротких фазах — быстро, поэтому там колокольчик гасим раньше.
    bellTau: (T) => Math.min(0.35, 0.15 + 0.05 * T),
    create,
  });
})(typeof self !== 'undefined' ? self : globalThis);
