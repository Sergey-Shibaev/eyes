// Проверка звука без браузера: подставной AudioContext записывает всё, что расписал режим.
// Запуск: node tests/sound.test.js sound/ladder.js [ещё режимы...]
// Ловит: события в прошлом, NaN, экспоненту к нулю, незаякоренные рампы, источники без stop(),
// слишком громкие пики, отсутствие звука на границе фазы, исключения, утечки после остановки.
const path = require('path');

let vnow = 1000; // виртуальные часы страницы, мс
let problems = [];
const problem = (text) => {
  if (problems.length < 12 && !problems.includes(text)) problems.push(text);
};

class Param {
  constructor(ctx, label, value) {
    this.ctx = ctx;
    this.label = label;
    this._v = value;
    this.last = value; // последнее запланированное значение
    this.anchored = false;
  }
  get value() { return this._v; }
  set value(v) {
    if (!Number.isFinite(v)) problem(`${this.label}.value = ${v}`);
    if (this.anchored) problem(`${this.label}: присвоение .value поверх автоматизации игнорируется — используйте setValueAtTime`);
    this._v = v;
    this.last = v;
  }
  _check(kind, v, t) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) problem(`${this.label}.${kind}(${v}, ${t}): не число`);
    if (t < this.ctx.currentTime - 0.3) problem(`${this.label}.${kind}: событие в прошлом на ${(this.ctx.currentTime - t).toFixed(2)} с`);
    if (/gain/.test(this.label) && v > 1.01) problem(`${this.label}.${kind}: усиление ${v} больше 1`);
  }
  setValueAtTime(v, t) { this._check('setValueAtTime', v, t); this.anchored = true; this.last = v; return this; }
  linearRampToValueAtTime(v, t) {
    this._check('linearRampToValueAtTime', v, t);
    if (!this.anchored) problem(`${this.label}: linearRamp без якоря setValueAtTime перед ним`);
    this.last = v;
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this._check('exponentialRampToValueAtTime', v, t);
    if (!(v > 0)) problem(`${this.label}: exponentialRamp к ${v} — экспонента не умеет идти к нулю`);
    if (!(this.last > 0)) problem(`${this.label}: exponentialRamp от ${this.last} — старт должен быть больше нуля`);
    if (!this.anchored) problem(`${this.label}: exponentialRamp без якоря setValueAtTime перед ним`);
    this.last = v;
    return this;
  }
  setTargetAtTime(v, t, tau) {
    this._check('setTargetAtTime', v, t);
    if (!(tau > 0)) problem(`${this.label}: setTargetAtTime с постоянной времени ${tau}`);
    this.anchored = true;
    this.last = v;
    return this;
  }
  cancelScheduledValues(t) { this.anchored = false; return this; }
  cancelAndHoldAtTime(t) { this.anchored = true; return this; }
}

class Node {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.connected = false;
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (!dest) problem(`${this.kind}.connect(undefined)`);
    this.connected = true;
    this.dest = dest;
    return dest;
  }
  disconnect() { this.connected = false; }
}

class Source extends Node {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.startAt = null;
    this.stopAt = null;
    ctx.sources.push(this);
  }
  start(t = this.ctx.currentTime) {
    if (this.startAt !== null) problem(`${this.kind}: start() вызван дважды`);
    if (!Number.isFinite(t)) problem(`${this.kind}.start(${t})`);
    if (t < this.ctx.currentTime - 0.3) problem(`${this.kind}.start: в прошлом на ${(this.ctx.currentTime - t).toFixed(2)} с`);
    this.startAt = t;
  }
  stop(t = this.ctx.currentTime) {
    if (this.startAt === null) problem(`${this.kind}: stop() до start()`);
    if (!Number.isFinite(t)) problem(`${this.kind}.stop(${t})`);
    this.stopAt = this.stopAt === null ? t : Math.min(this.stopAt, t);
  }
}

class MockAudioContext {
  constructor() {
    this.epoch = vnow;
    this.state = 'suspended';
    this.sampleRate = 48000;
    this.baseLatency = 0;
    this.outputLatency = 0;
    this.seq = 0;
    this.lastSuspend = 0;
    this.nodes = [];
    this.sources = [];
    this.destination = { kind: 'destination' };
    MockAudioContext.last = this;
  }
  static resumeDelay = 0;
  get currentTime() { return (vnow - this.epoch) / 1000; }
  // resume() может быть медленным (MockAudioContext.resumeDelay, мс) и, как в браузере, выполняется в порядке вызова:
  // suspend(), вызванный после resume(), но до его завершения, побеждает — контекст остаётся усыплённым.
  resume() {
    const seq = ++this.seq;
    const apply = () => { if (this.lastSuspend < seq) this.state = 'running'; };
    if (!MockAudioContext.resumeDelay) { apply(); return Promise.resolve(); }
    return new Promise((resolve) => timeouts.push({ fn: () => { apply(); resolve(); }, at: vnow + MockAudioContext.resumeDelay }));
  }
  suspend() { this.lastSuspend = ++this.seq; this.state = 'suspended'; return Promise.resolve(); }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(this, 'gain', 1); return n; }
  createOscillator() {
    const n = new Source(this, 'oscillator');
    n.type = 'sine';
    n.frequency = new Param(this, 'frequency', 440);
    n.detune = new Param(this, 'detune', 0);
    return n;
  }
  createBufferSource() {
    const n = new Source(this, 'bufferSource');
    n.loop = false;
    n.playbackRate = new Param(this, 'playbackRate', 1);
    return n;
  }
  createBiquadFilter() {
    const n = new Node(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = new Param(this, 'filter.frequency', 350);
    n.Q = new Param(this, 'Q', 1);
    n.gain = new Param(this, 'filter.gain', 0);
    n.detune = new Param(this, 'filter.detune', 0);
    return n;
  }
  createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(this, 'pan', 0); return n; }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    return { length, sampleRate: rate, numberOfChannels: channels, duration: length / rate, getChannelData: () => data };
  }
}

// виртуальные таймеры
let intervals = [];
let timeouts = [];
const env = {
  now: () => vnow,
  AudioContext: MockAudioContext,
  setInterval: (fn, ms) => { const id = { fn, ms, next: vnow + ms }; intervals.push(id); return id; },
  clearInterval: (id) => { intervals = intervals.filter((x) => x !== id); },
  setTimeout: (fn, ms) => { timeouts.push({ fn, at: vnow + ms }); },
};

function advance(ms, step = 10) {
  const end = vnow + ms;
  while (vnow < end) {
    vnow = Math.min(end, vnow + step);
    for (const it of intervals.slice()) {
      if (vnow >= it.next) {
        it.next = vnow + it.ms;
        it.fn();
      }
    }
    for (const to of timeouts.slice()) {
      if (vnow >= to.at) {
        timeouts = timeouts.filter((x) => x !== to);
        to.fn();
      }
    }
  }
}

globalThis.self = globalThis;
require(path.resolve(__dirname, '../sound/engine.js'));
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Укажите файлы режимов: node tests/sound.test.js sound/ladder.js');
  process.exit(2);
}
for (const f of files) require(path.resolve(f));

function timelineOf(d) {
  const tl = [];
  let t0 = 0;
  d.forEach((dur, phase) => {
    if (dur > 0) tl.push({ phase, t0, dur });
    t0 += dur;
  });
  return { timeline: tl, cycle: t0 };
}

const PROGRAMS = [[4, 4, 4, 4], [4, 7, 8, 0], [4, 0, 6, 0], [6, 0, 2, 0], [1, 0, 1, 0], [2, 1, 1, 1], [13, 16, 14, 2], [60, 0, 60, 0]];

async function runMode(def) {
  problems = [];
  let created = 0;
  let seconds = 0;
  for (const d of PROGRAMS) {
    intervals = [];
    timeouts = [];
    const sound = globalThis.BreathSound.mount(env);
    sound.setMode(def.id);
    sound.setVolume(0.6);
    const { timeline, cycle } = timelineOf(d);
    const startedAt = vnow + 120;
    await sound.start({ startedAt, timeline, cycle });
    const ctx = MockAudioContext.last;
    const before = ctx.sources.length;
    const runMs = Math.min(3 * cycle, 130) * 1000;
    advance(runMs);
    created += ctx.sources.length - before;
    seconds += runMs / 1000;

    // на каждой границе фазы должен начинаться хотя бы один звук (метка)
    const epoch = ctx.epoch;
    for (let c = 0; (c + 1) * cycle * 1000 <= runMs; c++) {
      for (const e of timeline) {
        const at = (startedAt + (c * cycle + e.t0) * 1000 - epoch) / 1000;
        const onMark = ctx.sources.filter((s) => s.startAt !== null && Math.abs(s.startAt - at) < 0.004).length;
        if (!onMark) problem(`${d.join('-')}: нет звука на границе фазы ${e.phase} (t=${at.toFixed(2)})`);
        // метка ядра — это 3 синуса колокольчика или 2 синуса первого «тука»; больше — режим положил свой тик на метку
        const expected = e.phase === 0 || e.phase === 2 ? 3 : 2;
        if (onMark > expected) problem(`${d.join('-')}: на границе фазы ${e.phase} ${onMark} источников вместо ${expected} — тик режима попал на метку (k = N?)`);
      }
    }

    // одноразовые звуки режима стоят только на целых секундах фазы 1..T-1: не на метке следующей фазы и не после конца
    const sessionStart = (startedAt - epoch) / 1000;
    for (const s of ctx.sources) {
      if (s.startAt === null || s.startAt < sessionStart - 0.001) continue; // непрерывные источники стартуют до первой фазы
      let rel = (s.startAt - sessionStart) % cycle;
      if (rel > cycle - 0.01) rel -= cycle; // 15.9999… — это метка начала цикла
      const e = timeline.find((x) => rel >= x.t0 - 0.01 && rel < x.t0 + x.dur - 0.01) || timeline[0];
      let off = rel - e.t0;
      if (off > e.dur - 0.01) off -= e.dur; // дрожание на границе: это метка следующей фазы
      if (Math.abs(off) < 0.125) continue; // метка ядра (и второй «тук» через 0.12 с)
      const k = Math.round(off);
      if (Math.abs(off - k) > 0.004 || k < 1 || k > e.dur - 1) {
        problem(`${d.join('-')}: тик фазы ${e.phase} (T=${e.dur}) на ${off.toFixed(3)} с — не на целой секунде 1..T-1`);
      }
    }

    // остановка посреди фазы, затем повторный запуск и смена режима на ходу
    const stopAt = ctx.currentTime;
    sound.stop();
    advance(1500);
    for (const s of ctx.sources) {
      if (s.startAt !== null && s.stopAt === null) problem(`${d.join('-')}: ${s.kind} запущен и никогда не остановлен (утечка)`);
      if (s.startAt !== null && s.stopAt !== null && s.stopAt > stopAt + 1 && s.stopAt - s.startAt > 70) {
        problem(`${d.join('-')}: ${s.kind} звучит ещё ${(s.stopAt - stopAt).toFixed(0)} с после остановки`);
      }
    }
    if (ctx.state !== 'suspended') problem(`${d.join('-')}: после остановки контекст не усыплён`);
  }

  // страница «спала»: редкие тики таймера, затем провал в 70 секунд
  {
    intervals = [];
    timeouts = [];
    const sound = globalThis.BreathSound.mount(env);
    sound.setMode(def.id);
    const { timeline, cycle } = timelineOf([4, 7, 8, 0]);
    await sound.start({ startedAt: vnow + 120, timeline, cycle });
    advance(20000, 1000);
    vnow += 70000;
    advance(25000);
    sound.setMode('off');
    advance(1000);
    sound.setMode(def.id);
    await sound.demo();
    advance(10000);
    if (sound.playing) problem('проба звука (demo) не остановилась сама');
    advance(1000);
  }

  const perMinute = (created / seconds) * 60;
  if (perMinute > 400) problem(`слишком много одноразовых узлов: ${perMinute.toFixed(0)} источников в минуту`);
  const ok = problems.length === 0;
  console.log(`${ok ? 'OK    ' : 'ПЛОХО '} ${def.id.padEnd(8)} «${def.name}»  источников в минуту: ${perMinute.toFixed(0)}`);
  for (const p of problems) console.log(`         - ${p}`);
  return ok;
}

// Ядро: гонки start()/stop(), смена режима на ходу, пробуждение, исключение в режиме, опоздавшая первая метка.
const flush = () => new Promise((resolve) => setImmediate(resolve)); // дать сработать продолжениям после await
async function runEngine(def) {
  problems = [];
  const info = () => timelineOf([4, 7, 8, 0]);
  const fresh = () => {
    intervals = [];
    timeouts = [];
    MockAudioContext.resumeDelay = 0;
    const sound = globalThis.BreathSound.mount(env);
    sound.setMode(def.id);
    return sound;
  };
  const outsOnMaster = (ctx) => {
    const master = ctx.nodes.find((n) => n.dest === ctx.destination);
    return ctx.nodes.filter((n) => n.connected && n.dest === master).length;
  };

  // 1. stop() во время ожидания resume(): сессии нет, контекст должен уснуть
  {
    const sound = fresh();
    const p = sound.start({ startedAt: vnow + 120, ...info() });
    sound.stop();
    await p;
    advance(1000);
    if (sound.playing) problem('start+stop: сессия играет после stop()');
    if (MockAudioContext.last.state !== 'suspended') problem('start+stop: контекст остался разбуженным без сессии');
  }

  // 2. stop(), затем новый start() до истечения 450 мс при медленном resume(): усыплять новую сессию нельзя
  {
    const sound = fresh();
    await sound.start({ startedAt: vnow + 120, ...info() });
    advance(2000);
    sound.stop();
    advance(440);
    MockAudioContext.resumeDelay = 50;
    const p = sound.start({ startedAt: vnow + 120, ...info() });
    advance(100);
    await p;
    const ctx = MockAudioContext.last;
    if (!sound.playing) problem('перезапуск за 450 мс: сессия не запустилась');
    if (ctx.state !== 'running') problem('перезапуск за 450 мс: контекст усыплён под новой сессией');
    const before = ctx.sources.length;
    advance(3000);
    if (ctx.sources.length === before) problem('перезапуск за 450 мс: новая сессия молчит');
    sound.stop();
    advance(1000);
  }

  // 3. звук включили в настройках посреди идущей сессии (режим был «выкл.»), и выключили/включили снова
  {
    const sound = fresh();
    sound.setMode('off');
    await sound.start({ startedAt: vnow + 120, ...info() });
    if (sound.playing) problem('режим «выкл.»: сессия почему-то звучит');
    sound.setMode(def.id);
    await flush();
    advance(200);
    if (!sound.playing) problem('setMode на ходу: звук не включился в идущей сессии');
    sound.setMode('off');
    await flush();
    advance(1500);
    if (sound.playing) problem('setMode(off) на ходу: сессия не заглушена');
    if (MockAudioContext.last.state !== 'suspended') problem('setMode(off) на ходу: контекст не усыплён');
    sound.setMode(def.id);
    await flush();
    if (!sound.playing) problem('setMode после «выкл.»: сессия приложения не поднялась снова');
    sound.stop();
    sound.setMode('off');
    sound.setMode(def.id);
    await flush();
    if (sound.playing) problem('setMode после stop(): звук запустился без сессии приложения');
  }

  // 4. браузер усыпил контекст посреди сессии — wake() должен вернуть звук и не оставить старый выход подключённым
  {
    const sound = fresh();
    await sound.start({ startedAt: vnow + 120, ...info() });
    advance(3000);
    const ctx = MockAudioContext.last;
    ctx.suspend();
    advance(5000);
    sound.wake();
    await flush();
    advance(600);
    if (!sound.playing || ctx.state !== 'running') problem('wake: звук не вернулся после усыпления контекста');
    if (outsOnMaster(ctx) !== 1) problem(`wake: к мастеру подключено выходов сессий: ${outsOnMaster(ctx)}, ожидался 1`);
    const before = ctx.sources.length;
    advance(20000);
    if (ctx.sources.length === before) problem('wake: после пробуждения фазы не расписываются');
    sound.stop();
    advance(1000);
  }

  // 5. проба звука прерывается сменой режима, а по окончании не мешает включать режим
  {
    const sound = fresh();
    await sound.demo();
    advance(1000);
    sound.setMode('off');
    advance(100);
    if (sound.playing) problem('demo: смена режима не остановила пробу');
    sound.setMode(def.id);
    await flush();
    if (sound.playing) problem('demo: setMode после пробы запустил звук без сессии');
  }

  // 6. медленный resume(): первая фаза опаздывает, но её метка должна начаться «сейчас», а не в прошлом
  {
    const sound = fresh();
    MockAudioContext.resumeDelay = 300;
    const p = sound.start({ startedAt: vnow + 120, ...info() });
    advance(300);
    await p;
    const ctx = MockAudioContext.last;
    const t0 = ctx.currentTime;
    if (!ctx.sources.some((s) => s.startAt !== null && Math.abs(s.startAt - t0) < 0.004)) problem('опоздавшая первая фаза: метки нет');
    if (ctx.sources.some((s) => s.startAt !== null && s.startAt < t0 - 1e-6)) problem('опоздавшая первая фаза: звук запущен в прошлом');
    sound.stop();
    advance(1000);
  }

  // 7. режим бросает исключение в phase(): метка фазы не должна повторяться на каждом тике таймера
  {
    globalThis.BreathSound.register({
      id: 'throwing',
      name: 'Сломанный',
      fLow: 300,
      fHigh: 400,
      create: () => ({ phase() { throw new Error('сломанный режим'); }, stop() {} }),
    });
    intervals = [];
    timeouts = [];
    MockAudioContext.resumeDelay = 0;
    const sound = globalThis.BreathSound.mount(env);
    sound.setMode('throwing');
    const startedAt = vnow + 120;
    const { timeline, cycle } = timelineOf([4, 7, 8, 0]);
    let thrown = 0;
    try {
      await sound.start({ startedAt, timeline, cycle });
    } catch { thrown++; }
    for (let i = 0; i < 30; i++) {
      try { advance(200); } catch { thrown++; }
    }
    const ctx = MockAudioContext.last;
    const at = (startedAt - ctx.epoch) / 1000;
    const marks = ctx.sources.filter((s) => s.startAt !== null && Math.abs(s.startAt - at) < 0.004).length;
    if (!thrown) problem('исключение из phase() проглочено — тест его не увидел');
    if (marks !== 3) problem(`исключение в phase(): метка первой фазы сыграна ${marks / 3} раз(а), ожидался 1`);
    const at2 = at + 4;
    if (!ctx.sources.some((s) => s.startAt !== null && Math.abs(s.startAt - at2) < 0.004)) problem('исключение в phase(): следующая фаза не расписана');
    sound.stop();
    advance(1000);
  }

  MockAudioContext.resumeDelay = 0;
  const ok = problems.length === 0;
  console.log(`${ok ? 'OK    ' : 'ПЛОХО '} engine   «ядро»  (проверено с режимом ${def.id})`);
  for (const p of problems) console.log(`         - ${p}`);
  return ok;
}

(async () => {
  let failed = false;
  const defs = globalThis.BreathSound.list();
  if (!defs.length) {
    console.log('ПЛОХО  ни один режим не зарегистрировался (BreathSound.register)');
    process.exit(1);
  }
  try {
    if (!(await runEngine(defs[0]))) failed = true;
  } catch (err) {
    failed = true;
    console.log(`ПЛОХО  engine: исключение: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err}`);
  }
  for (const def of defs) {
    try {
      if (typeof def.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(def.id)) problem('id должен быть латиницей в нижнем регистре');
      if (!(def.fLow > 0 && def.fHigh > 0)) problem('нужны fLow и fHigh в герцах');
      if (!(await runMode(def))) failed = true;
    } catch (err) {
      failed = true;
      console.log(`ПЛОХО  ${def.id}: исключение: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
