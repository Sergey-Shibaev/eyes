// Проверка фоновой музыки без браузера: подставные AudioContext, fetch и service worker.
// Запуск: node tests/music.test.js
// Ловит: музыка не вступает; звук не усыпляется после остановки; щелчок и наложение
// при быстром «Остановить → Начать»; «нет сети» запоминается навсегда; 55 МБ остаются
// в памяти после выключения; двойное скачивание при первом визите; зависшее скачивание.
const path = require('path');

let failed = false;
function check(name, ok, detail) {
  console.log(`${ok ? 'OK    ' : 'ПЛОХО '} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed = true;
}

const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 20) {
  for (let i = 0; i < n; i++) await tick();
}

/* ---------- Подставной Web Audio ---------- */

class Param {
  constructor(ctx, v) {
    this.ctx = ctx;
    this.events = [{ t: 0, v, type: 'set' }];
  }
  get value() {
    return this.at(this.ctx.currentTime);
  }
  set value(v) {
    this.events = [{ t: this.ctx.currentTime, v, type: 'set' }];
  }
  at(t) {
    let v = this.events[0].v;
    let prev = this.events[0];
    for (const e of this.events) {
      if (e.t > t) {
        if (e.type === 'ramp') v = prev.v + ((e.v - prev.v) * (t - prev.t)) / (e.t - prev.t);
        if (e.type === 'target') v = prev.v; // для проверок хватит грубо
        return v;
      }
      v = e.v;
      prev = e;
    }
    return v;
  }
  setValueAtTime(v, t) {
    this.events.push({ t, v, type: 'set' });
  }
  linearRampToValueAtTime(v, t) {
    this.events.push({ t, v, type: 'ramp' });
  }
  setTargetAtTime(v, t) {
    this.events.push({ t, v, type: 'target' });
  }
  cancelScheduledValues(t) {
    this.events = this.events.filter((e, i) => i === 0 || e.t < t);
  }
  cancelAndHoldAtTime(t) {
    const v = this.at(t);
    this.cancelScheduledValues(t);
    this.events.push({ t, v, type: 'set' });
  }
}

class Node {
  constructor(ctx) {
    this.ctx = ctx;
    this.outs = new Set();
  }
  connect(n) {
    this.outs.add(n);
    return n;
  }
  disconnect() {
    this.outs.clear();
  }
}

class Ctx {
  constructor() {
    Ctx.all.push(this);
    this.currentTime = 0;
    this.state = 'suspended';
    this.sources = [];
    this.decodes = 0;
    this.destination = new Node(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain() {
    const n = new Node(this);
    n.gain = new Param(this, 1);
    return n;
  }
  createBufferSource() {
    const n = new Node(this);
    n.start = (t, offset) => {
      n.startedAt = t;
      n.offset = offset;
    };
    n.stop = (t) => {
      n.stopAt = t;
    };
    this.sources.push(n);
    return n;
  }
  decodeAudioData(data) {
    this.decodes++;
    if (data.detached) throw new Error('буфер уже отдан');
    data.detached = true; // как в браузере: буфер забирается
    return Ctx.decodeGate.then(() => ({ duration: 155.87, bytes: data.byteLength }));
  }
  // Время идёт: срабатывают onended у остановленных источников
  advance(sec) {
    this.currentTime += sec;
    for (const s of this.sources) {
      if (s.stopAt !== undefined && s.stopAt <= this.currentTime && !s.ended) {
        s.ended = true;
        if (s.onended) s.onended();
      }
    }
  }
}
Ctx.all = [];
Ctx.decodeGate = Promise.resolve();

// Громкость, с которой источник реально слышен: произведение всех усилений по пути до выхода
const level = (ctx, s) => {
  let v = 1;
  let n = s;
  for (let hops = 0; n && n !== ctx.destination && hops < 10; hops++) {
    n = [...n.outs][0];
    if (n && n.gain) v *= n.gain.at(ctx.currentTime);
  }
  return n === ctx.destination ? v : 0;
};
const playing = (ctx) => ctx.sources.filter((s) => s.startedAt !== undefined && !s.ended);

/* ---------- Подставная сеть ---------- */

function makeNet() {
  const net = {
    calls: [],
    offline: false,
    hang: false,
    fetch(url, opts) {
      net.calls.push(url);
      if (net.offline) return Promise.reject(new TypeError('нет сети'));
      if (url.endsWith('loop.json')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ loopStart: 0.5, loopEnd: 155.37 }) });
      }
      if (net.hang) {
        return new Promise((resolve, reject) => {
          if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('прервано')));
        });
      }
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBufferLike(2495259) });
    },
    mp3() {
      return net.calls.filter((u) => u.endsWith('loop.mp3')).length;
    },
  };
  return net;
}
class ArrayBufferLike {
  constructor(n) {
    this.byteLength = n;
  }
  slice() {
    return new ArrayBufferLike(this.byteLength);
  }
}

function fresh({ controller = true } = {}) {
  const net = makeNet();
  global.fetch = net.fetch;
  global.AudioContext = Ctx;
  global.AbortController = AbortController;
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { controller: controller ? {} : null } }, configurable: true, writable: true });
  delete require.cache[path.resolve(__dirname, '..', 'music.js')];
  require(path.resolve(__dirname, '..', 'music.js'));
  Ctx.all = [];
  Ctx.decodeGate = Promise.resolve();
  return { net, music: AppMusic.mount() };
}

(async () => {
  // 1. Обычное занятие: музыка вступает, нарастает до громкости ползунка, после остановки звук засыпает
  {
    const { music } = fresh();
    music.setVolume(0.5);
    music.setEnabled(true);
    await settle();
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    const s = playing(ctx);
    check('музыка вступает после «Начать»', s.length === 1 && s[0].loop && s[0].offset === 0.5 && s[0].loopEnd === 155.37);
    ctx.advance(3);
    check('через 3 с громкость = ползунок (0,5)', Math.abs(level(ctx, s[0]) - 0.5) < 1e-6, level(ctx, s[0]));
    music.stop();
    check('сразу после «Остановить» звук ещё не усыплён (идёт затухание)', ctx.state === 'running');
    ctx.advance(0.6);
    check('на середине затухания громкость вдвое меньше', Math.abs(level(ctx, s[0]) - 0.25) < 0.02, level(ctx, s[0]));
    ctx.advance(1);
    await settle();
    check('после затухания звук усыплён', ctx.state === 'suspended' && playing(ctx).length === 0);
  }

  // 2. «Остановить», пока файл ещё раскодируется: звук не остаётся бодрствовать вхолостую
  {
    const { music } = fresh();
    music.setEnabled(true);
    await settle();
    let open;
    Ctx.decodeGate = new Promise((r) => (open = r));
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    music.stop();
    await settle();
    open();
    await settle();
    check('остановили во время загрузки — звук усыплён и ничего не играет', ctx.state === 'suspended' && playing(ctx).length === 0);
  }

  // 3. Быстро «Остановить → Начать»: прежнее звучание плавно стихает, новое плавно нарастает, без скачков
  {
    const { music } = fresh();
    music.setEnabled(true);
    await settle();
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    ctx.advance(3);
    const [old] = playing(ctx);
    music.stop();
    ctx.advance(0.3);
    const before = level(ctx, old);
    music.start();
    await settle();
    const now = playing(ctx);
    const neu = now.find((s) => s !== old);
    check('при быстром перезапуске прежнее звучание не прыгает по громкости', Math.abs(level(ctx, old) - before) < 1e-6, `${before} → ${level(ctx, old)}`);
    check('новое звучание начинается с тишины', neu && level(ctx, neu) === 0);
    ctx.advance(1.0);
    check('прежнее стихает до нуля к своему концу', level(ctx, old) < 0.02, level(ctx, old));
    ctx.advance(0.5);
    await settle();
    check('прежнее остановлено, звук не усыплён — играет новое', old.ended && ctx.state === 'running' && playing(ctx).length === 1);
  }

  // 4. Первый запуск без сети: когда сеть появилась, следующее «Начать» уже с музыкой
  {
    const { music, net } = fresh();
    net.offline = true;
    const first = await music.available();
    music.start();
    await settle();
    music.stop();
    net.offline = false;
    const second = await music.available();
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    check('«нет сети» не запоминается навсегда', first === false && second === true && playing(ctx).length === 1);
  }

  // 5. Музыку выключили, пока файл раскодировался: 55 МБ не остаются в памяти
  {
    const { music } = fresh();
    music.setEnabled(true);
    await settle();
    let open;
    Ctx.decodeGate = new Promise((r) => (open = r));
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    music.stop();
    music.setEnabled(false);
    open();
    await settle();
    Ctx.decodeGate = Promise.resolve();
    music.setEnabled(true);
    music.start();
    await settle();
    check('после выключения раскодированный звук не держится (раскодирован заново)', ctx.decodes === 2 && playing(ctx).length === 1, `раскодировок: ${ctx.decodes}`);
  }

  // 6. Первый визит: страницей ещё не управляет service worker — заранее файл не качаем
  {
    const { music, net } = fresh({ controller: false });
    music.setEnabled(true);
    await settle();
    check('без service worker заранее ничего не качается', net.mp3() === 0);
    music.start();
    await settle();
    check('…а по «Начать» файл скачивается и играет', net.mp3() === 1 && playing(Ctx.all[0]).length === 1);
  }
  {
    const { music, net } = fresh({ controller: true });
    music.setEnabled(true);
    await settle();
    music.start();
    await settle();
    check('под service worker файл достаётся заранее и по «Начать» не качается снова', net.mp3() === 1 && playing(Ctx.all[0]).length === 1);
  }

  // 7. Связь зависла: попытка обрывается по времени, следующее «Начать» пробует снова
  {
    const timers = [];
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    global.setTimeout = (fn, ms) => {
      timers.push(fn);
      return timers.length;
    };
    global.clearTimeout = () => {};
    const { music, net } = fresh();
    net.hang = true;
    music.start();
    await settle();
    check('пока связь висит — тишина', playing(Ctx.all[0]).length === 0);
    timers.forEach((fn) => fn());
    await settle();
    music.stop();
    net.hang = false;
    music.start();
    await settle();
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
    check('после обрыва по времени следующее «Начать» с музыкой', net.mp3() === 2 && playing(Ctx.all[0]).length === 1, `запросов mp3: ${net.mp3()}`);
  }

  // 8. Громкость ползунка меняется и во время тишины — новое звучание сразу с ней
  {
    const { music } = fresh();
    music.setEnabled(true);
    await settle();
    music.start();
    await settle();
    const ctx = Ctx.all[0];
    music.stop();
    ctx.advance(2);
    await settle();
    music.setVolume(0.8);
    music.start();
    await settle();
    ctx.advance(3);
    check('громкость, выставленная в паузе, применяется', Math.abs(level(ctx, playing(ctx)[0]) - 0.8) < 1e-6);
  }

  process.exit(failed ? 1 : 0);
})();
