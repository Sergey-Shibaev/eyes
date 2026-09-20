// Детектор «швов» в живых фонах. Прогоняет 8 минут анимации на подставном холсте и ищет объекты,
// которые внезапно появились или исчезли посреди экрана (а не уплыли за край и не растаяли плавно).
// Запуск: node tests/background.seam.js backgrounds/bubbles.js [ещё файлы...]
const path = require('path');

const W = 360;
const H = 740;
const FPS = 20;
const MINUTES = 8;
const MIN_SIZE = 7; // мелочь вроде звёзд и планктона может мерцать
const MIN_ALPHA = 0.12; // слабее — считаем, что объект плавно проявляется или тает
const EDGE = 8; // объект должен быть целиком внутри экрана с таким запасом

let frameItems = [];

function makeContext(canvas) {
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const state = { globalAlpha: 1, canvas };
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const put = (x, y, size) => {
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    frameItems.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], size: size * scale, alpha: state.globalAlpha });
  };
  const gradient = { addColorStop() {} };
  const api = {
    save() { stack.push([m.slice(), state.globalAlpha]); },
    restore() { const s = stack.pop(); if (s) { m = s[0]; state.globalAlpha = s[1]; } },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = mul(m, [c, s, -s, c, 0, 0]); },
    transform(a, b, c, d, e, f) { m = mul(m, [a, b, c, d, e, f]); },
    setTransform(a, b, c, d, e, f) { m = typeof a === 'number' ? [a, b, c, d, e, f] : [1, 0, 0, 1, 0, 0]; },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    drawImage(img, ...a) {
      if (!main) return;
      const [x, y, w, h] = a.length >= 8 ? a.slice(4) : a.length >= 4 ? a : [a[0], a[1], img.width || 0, img.height || 0];
      if (w < W * 0.9 || h < H * 0.5) put(x + w / 2, y + h / 2, Math.max(w, h));
    },
    arc(x, y, r) { if (main) put(x, y, r * 2); },
    ellipse(x, y, rx, ry) { if (main) put(x, y, Math.max(rx, ry) * 2); },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => gradient,
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }),
  };
  let main = false;
  const proxy = new Proxy(state, {
    get(t, k) {
      if (k === '__main') return (v) => { main = v; };
      if (k in api) return api[k];
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return proxy;
}

function fakeCanvas() {
  const canvas = { width: 300, height: 150, style: {} };
  let ctx = null;
  canvas.getContext = () => (ctx ||= makeContext(canvas));
  return canvas;
}

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.document = { createElement: () => fakeCanvas() };
globalThis.OffscreenCanvas = function (w, h) { const c = fakeCanvas(); c.width = w; c.height = h; return c; };

require(path.resolve(__dirname, '../backgrounds/registry.js'));
for (const f of process.argv.slice(2)) require(path.resolve(f));

const inside = (it) => it.x - it.size / 2 > EDGE && it.x + it.size / 2 < W - EDGE && it.y - it.size / 2 > EDGE && it.y + it.size / 2 < H - EDGE;
const solid = (it) => it.alpha >= MIN_ALPHA && it.size >= MIN_SIZE && inside(it);
const near = (a, list) => {
  const reach = Math.max(14, a.size * 0.6);
  return list.some((b) => Math.abs(a.x - b.x) <= reach && Math.abs(a.y - b.y) <= reach);
};

for (const def of globalThis.BreathBackgrounds.list()) {
  const ctx = fakeCanvas().getContext('2d');
  const bg = def.create();
  bg.resize(W, H);
  const dt = 1 / FPS;
  let t = 0;
  let prev = null;
  const events = [];
  let appeared = 0;
  let vanished = 0;
  let tracked = 0;
  for (let i = 0; i < FPS * 60 * MINUTES; i++) {
    t += dt;
    const c = (t % 16) / 4;
    const phase = Math.floor(c);
    const p = c - phase;
    frameItems = [];
    ctx.__main(true);
    bg.frame(ctx, t, dt, { level: phase === 0 ? p : phase === 1 ? 1 : phase === 2 ? 1 - p : 0, phase, running: true });
    ctx.__main(false);
    const cur = frameItems;
    if (prev) {
      for (const it of cur) {
        if (solid(it) && !near(it, prev)) {
          appeared++;
          if (events.length < 6) events.push(`t=${t.toFixed(1)}с появился: x=${it.x.toFixed(0)} y=${it.y.toFixed(0)} размер=${it.size.toFixed(0)} непрозрачность=${it.alpha.toFixed(2)}`);
        }
      }
      for (const it of prev) {
        if (solid(it) && !near(it, cur)) {
          vanished++;
          if (events.length < 6) events.push(`t=${t.toFixed(1)}с исчез: x=${it.x.toFixed(0)} y=${it.y.toFixed(0)} размер=${it.size.toFixed(0)} непрозрачность=${it.alpha.toFixed(2)}`);
        }
      }
    }
    tracked += cur.filter(solid).length;
    prev = cur;
  }
  const total = appeared + vanished;
  const perFrame = (tracked / (FPS * 60 * MINUTES)).toFixed(1);
  console.log(`${total ? 'ШВЫ?  ' : 'OK    '} ${def.id.padEnd(12)} «${def.name}»  за ${MINUTES} мин: внезапно появилось ${appeared}, внезапно исчезло ${vanished} (отслеживалось объектов на кадр: ${perFrame})`);
  for (const e of events) console.log(`         - ${e}`);
}
