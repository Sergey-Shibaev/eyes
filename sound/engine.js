// Звуковое сопровождение дыхания: можно заниматься с закрытыми глазами.
//
// Ядро отвечает за общее: AudioContext, расписание фаз по аудиочасам, метки начала фаз
// (низкий колокольчик — вдох, высокий — выдох, двойной «тук» — задержка), громкость, остановку без щелчков.
// Режимы звучания лежат в отдельных файлах этой папки и подключаются через BreathSound.register({...}).
//
// Контракт режима:
//   {
//     id: 'ladder',                  // латиницей, совпадает с именем файла
//     name: 'Лесенка',               // название для настроек
//     fLow: 293.66, fHigh: 587.33,   // «пол» и «потолок» высоты, Гц (метки используют их же)
//     bellTau(T) { return 0.35; },   // необязательно: затухание колокольчика для фазы длиной T секунд
//     create(api) {                  // новый экземпляр на каждую сессию
//       return {
//         phase(ph) {},              // расписать звук одной фазы (метку начала фазы ядро ставит само)
//         stop(t) {},                // сессия окончена: остановить непрерывные источники ко времени t
//       };
//     },
//   }
//   api = { ctx, out, fLow, fHigh, blip(t, f, opts), noise() }
//     out  — GainNode сессии: всё звучащее подключать только к нему;
//     blip — короткий одноразовый «тук»: opts = { peak = 0.1, attack = 0.005, tau = 0.03, h2 = 0.3 (доля обертона 2f) };
//     noise — общий AudioBuffer розового шума (3 с, моно), создаётся один раз.
//   ph = { phase: 0 вдох | 1 задержка на вдохе | 2 выдох | 3 задержка на выдохе,
//          t — начало фазы в секундах аудиочасов (может быть чуть в прошлом, до 0.25 с — это нормально),
//          T — длительность в секундах, nextPhase — какая фаза следующая, first — первая фаза сессии }
(function (root) {
  'use strict';

  const LOOKAHEAD = 1.5; // на сколько секунд вперёд расписываем звук
  const TICK = 200; // как часто планировщик проверяет расписание, мс
  const MASTER = 0.8; // потолок общей громкости
  const modes = [];

  function register(def) {
    if (!modes.some((m) => m.id === def.id)) modes.push(def);
  }

  // env нужен только тестам: подставные часы, таймеры и AudioContext.
  function mount(env) {
    env = env || {};
    const now = env.now || (() => performance.now());
    const setTimer = env.setInterval || ((fn, ms) => setInterval(fn, ms));
    const clearTimer = env.clearInterval || ((id) => clearInterval(id));
    const later = env.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const AudioCtx = env.AudioContext || root.AudioContext || root.webkitAudioContext;

    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let modeId = 'off';
    let volume = 0.6;
    let session = null;
    let lastInfo = null; // расписание сессии приложения; null — приложение звук остановило (или проба доиграла)
    let startToken = 0;
    let pending = 0; // сколько вызовов start() сейчас ждут ctx.resume()

    const supported = () => !!AudioCtx;

    function ensureContext() {
      if (ctx) return;
      ctx = new AudioCtx();
      // iPhone по умолчанию глушит звук страницы боковым переключателем «без звука».
      // 'playback' говорит системе, что звук — суть занятия, как у аудиоплеера.
      try {
        if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback';
      } catch {}
      master = ctx.createGain();
      master.gain.value = MASTER * volume;
      master.connect(ctx.destination);
    }

    // Момент по часам страницы (performance.now, мс) → секунды аудиочасов, с поправкой на задержку вывода.
    function toAudio(ms) {
      const latency = Math.min(0.2, ctx.outputLatency || ctx.baseLatency || 0);
      return ctx.currentTime + (ms - now()) / 1000 - latency;
    }

    /* ---------- Одноразовые звуки ---------- */

    function blip(out, t, f, opts) {
      const o = opts || {};
      const peak = o.peak === undefined ? 0.1 : o.peak;
      const attack = o.attack === undefined ? 0.005 : o.attack;
      const tau = o.tau === undefined ? 0.03 : o.tau;
      const h2 = o.h2 === undefined ? 0.3 : o.h2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + attack);
      env.gain.setTargetAtTime(0, t + attack, tau);
      env.connect(out);
      const end = t + attack + tau * 7;
      const partials = h2 > 0 ? [[f, 1], [f * 2, h2]] : [[f, 1]];
      voices(env, partials, t, end);
    }

    // Синусы-составляющие одноразового звука: все стартуют и глохнут вместе; отзвучав — отцепляем огибающую
    // от выхода сессии, чтобы отработавшие узлы не висели на нём до сборки мусора.
    function voices(env, partials, t, end) {
      let last = null;
      for (const [freq, level] of partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g);
        g.connect(env);
        osc.start(t);
        osc.stop(end);
        last = osc;
      }
      last.onended = () => env.disconnect();
    }

    // Мягкий колокольчик: основной тон и два обертона, долгое затухание.
    function bell(out, t, f, tau, maxLength) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.008);
      env.gain.setTargetAtTime(0, t + 0.008, tau);
      env.connect(out);
      const end = t + Math.min(tau * 6, maxLength + 1.5);
      voices(env, [[f, 0.22], [f * 2, 0.07], [f * 2.76, 0.03]], t, end);
    }

    function mark(s, ph) {
      const def = s.def;
      const low = ph.phase === 0 || ph.phase === 3;
      const f = low ? def.fLow : def.fHigh;
      // Опоздавшую метку (медленный resume на первом вдохе) играем «сейчас»: у звука, начатого в прошлом,
      // атака уже «пройдена» — колокольчик щёлкает, а короткий «тук» и вовсе не слышен.
      const t = Math.max(ph.t, ctx.currentTime);
      if (ph.phase === 0 || ph.phase === 2) {
        bell(s.out, t, f, def.bellTau ? def.bellTau(ph.T) : 0.35, ph.T);
      } else {
        blip(s.out, t, f);
        blip(s.out, t + 0.12, f);
      }
    }

    function noise() {
      if (noiseBuffer) return noiseBuffer;
      const length = Math.floor(ctx.sampleRate * 3);
      const overlap = Math.floor(ctx.sampleRate * 0.05); // запас за концом кольца — для бесшовного стыка
      const raw = new Float32Array(length + overlap);
      // розовый шум, фильтр Пола Келлета
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < raw.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      // Буфер крутится по кольцу, а у розового шума конец и начало не совпадают: на стыке была бы ступенька —
      // глухой щелчок каждые 3 с. Поэтому продолжение шума за концом вплавляем в начало (равномощный кроссфейд):
      // последний отсчёт кольца переходит в первый так же гладко, как любые соседние.
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      data.set(raw.subarray(0, length));
      for (let i = 0; i < overlap; i++) {
        const w = i / overlap;
        data[i] = raw[i] * Math.sqrt(w) + raw[length + i] * Math.sqrt(1 - w);
      }
      return noiseBuffer;
    }

    /* ---------- Расписание ---------- */

    // Расписываем каждую фазу целиком на её границе, с запасом LOOKAHEAD.
    function pump() {
      const s = session;
      if (!s || !ctx || ctx.state !== 'running') return;
      const nowMs = now();
      for (;;) {
        if (s.once && s.c > 0) {
          if (nowMs > s.startedAt + s.cycle * 1000 + 300) stop();
          return;
        }
        const e = s.timeline[s.k];
        const startMs = s.startedAt + (s.c * s.cycle + e.t0) * 1000;
        if (startMs > nowMs + LOOKAHEAD * 1000) return;
        const first = s.c === 0 && s.k === 0;
        // Курсор двигаем до вызова режима: если phase() бросит исключение, та же фаза (и её метка) не повторится
        // на каждом тике таймера — очередь на следующем тике просто продолжится.
        s.k++;
        if (s.k >= s.timeline.length) {
          s.k = 0;
          s.c++;
        }
        // Фазу, начало которой давно прошло (страница спала), пропускаем: пачка звуков «вдогонку» хуже тишины.
        if (nowMs - startMs < 250) {
          const next = s.timeline[s.k];
          const ph = { phase: e.phase, t: toAudio(startMs), T: e.dur, nextPhase: next.phase, first };
          mark(s, ph);
          s.voice.phase(ph);
        }
      }
    }

    /**
     * Запуск звука сессии. Вызывать из обработчика нажатия (иначе браузер не даст включить звук).
     * info = { startedAt — момент начала первого вдоха по performance.now(), мс;
     *          timeline — [{ phase, t0, dur }] фазы с ненулевой длительностью, секунды от начала цикла;
     *          cycle — длина цикла в секундах; once — сыграть один цикл и остановиться }
     */
    async function start(info) {
      halt();
      lastInfo = info;
      if (modeId === 'off' || !supported() || !info.timeline.length || !(info.cycle > 0)) return;
      const def = modes.find((m) => m.id === modeId);
      if (!def) return;
      ensureContext();
      const token = ++startToken;
      pending++;
      try {
        await ctx.resume();
      } catch {}
      pending--;
      if (token !== startToken) {
        // пока ждали, сессию остановили или перезапустили; если остановили — контекст уже разбужен зря, усыпим
        later(sleepIfIdle, 450);
        return;
      }

      const out = ctx.createGain();
      out.gain.value = 1;
      out.connect(master);
      const api = { ctx, out, fLow: def.fLow, fHigh: def.fHigh, blip: (t, f, opts) => blip(out, t, f, opts), noise };
      session = { def, out, voice: def.create(api), startedAt: info.startedAt, timeline: info.timeline, cycle: info.cycle, once: !!info.once, c: 0, k: 0, timer: 0 };
      // перезапуск посреди сессии (сменили режим звука): сразу переходим к текущему циклу
      const elapsed = (now() - info.startedAt) / 1000;
      if (!info.once && elapsed > info.cycle) session.c = Math.floor(elapsed / info.cycle);
      session.timer = setTimer(pump, TICK);
      pump();
    }

    // Тишина — не тратим батарею. Но не усыпляем, пока звучит сессия или start() ещё ждёт ctx.resume():
    // suspend() после уже вызванного resume() оставил бы новую сессию беззвучной.
    function sleepIfIdle() {
      if (ctx && !session && !pending && ctx.state === 'running') ctx.suspend();
    }

    // Глушит текущую сессию без щелчка. lastInfo не трогает: по нему звук можно поднять снова (setMode, wake).
    function halt() {
      startToken++;
      const s = session;
      session = null;
      if (!s) return;
      clearTimer(s.timer);
      const t = ctx.currentTime;
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setValueAtTime(1, t);
      s.out.gain.setTargetAtTime(0, t, 0.03);
      try {
        s.voice.stop(t + 0.3);
      } catch {}
      later(() => {
        s.out.disconnect();
        sleepIfIdle();
      }, 450);
    }

    // Приложение остановило сессию (или проба доиграла).
    function stop() {
      lastInfo = null;
      halt();
    }

    // Смена режима на ходу: пока приложение не вызвало stop(), сессия жива, даже если сейчас звук выключен
    // или start() ещё ждёт resume() — поднимаем её заново по сохранённому расписанию.
    function setMode(id) {
      const next = id === 'off' || modes.some((m) => m.id === id) ? id : 'off';
      if (next === modeId) return;
      modeId = next;
      if (lastInfo && !lastInfo.once) start(lastInfo);
      else halt();
    }

    function setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.setTargetAtTime(MASTER * volume, ctx.currentTime, 0.05);
    }

    // Проба звука в настройках: один короткий цикл вдох — задержка — выдох.
    function demo() {
      return start({
        startedAt: now() + 150,
        timeline: [{ phase: 0, t0: 0, dur: 3 }, { phase: 1, t0: 3, dur: 2 }, { phase: 2, t0: 5, dur: 3 }],
        cycle: 8,
        once: true,
      });
    }

    // После звонка или сворачивания браузер мог усыпить звук. Пока аудиочасы стояли, всё уже расписанное
    // «съехало» относительно часов страницы и после простого resume() зазвучало бы с опозданием поверх нового.
    // Поэтому не будим, а перезапускаем сессию с чистым выходом: старое расписание глушится вместе со старым out.
    function wake() {
      if (session && ctx && ctx.state !== 'running') start(lastInfo);
    }

    return {
      start,
      stop,
      demo,
      wake,
      setMode,
      setVolume,
      supported,
      get mode() { return modeId; },
      get playing() { return !!session; },
    };
  }

  root.BreathSound = { register, mount, list: () => modes.slice() };
})(typeof self !== 'undefined' ? self : globalThis);
