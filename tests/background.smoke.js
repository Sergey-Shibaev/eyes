// Дымовой тест фонов без браузера: подставной холст, 900 кадров, смена размеров.
// Запуск: node tests/background.smoke.js backgrounds/bubbles.js [ещё файлы...]
// Ловит исключения, NaN в аргументах рисования и приёмы, которые тормозят на телефоне.
const path = require('path');

const stats = { inFrame: false, gradients: 0, createElement: 0, imageData: 0, slowProps: [], badArgs: [] };

function fakeContext(canvas) {
  const gradient = { addColorStop() {} };
  const store = { canvas };
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient' || key === 'createPattern') {
        return (...args) => {
          if (stats.inFrame) stats.gradients++;
          checkArgs(key, args);
          return gradient;
        };
      }
      if (key === 'getImageData' || key === 'putImageData' || key === 'createImageData') {
        return (...args) => {
          if (stats.inFrame) stats.imageData++;
          return { data: new Uint8ClampedArray(4 * (args[2] || 1) * (args[3] || 1)), width: args[2] || 1, height: args[3] || 1 };
        };
      }
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return (...args) => checkArgs(key, args);
    },
    set(target, key, value) {
      if (stats.inFrame && ((key === 'shadowBlur' && value > 0) || (key === 'filter' && value && value !== 'none'))) {
        if (!stats.slowProps.includes(key)) stats.slowProps.push(key);
      }
      target[key] = value;
      return true;
    },
  });
}

function checkArgs(name, args) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a) && stats.badArgs.length < 5) stats.badArgs.push(`${String(name)}(${args.join(', ')})`);
  }
}

function fakeCanvas() {
  const canvas = { width: 300, height: 150, style: {} };
  let ctx = null;
  canvas.getContext = () => (ctx ||= fakeContext(canvas));
  return canvas;
}

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.document = {
  createElement() {
    if (stats.inFrame) stats.createElement++;
    return fakeCanvas();
  },
};
globalThis.OffscreenCanvas = function (w, h) {
  if (stats.inFrame) stats.createElement++;
  const c = fakeCanvas();
  c.width = w;
  c.height = h;
  return c;
};

require(path.resolve(__dirname, '../backgrounds/registry.js'));
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Укажите файлы фонов: node tests/background.smoke.js backgrounds/bubbles.js');
  process.exit(2);
}
for (const f of files) require(path.resolve(f));

let failed = false;
for (const def of globalThis.BreathBackgrounds.list()) {
  const problems = [];
  Object.assign(stats, { inFrame: false, gradients: 0, createElement: 0, imageData: 0, slowProps: [], badArgs: [] });
  try {
    if (typeof def.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(def.id)) problems.push('id должен быть латиницей в нижнем регистре');
    if (typeof def.name !== 'string' || !def.name) problems.push('нет названия name');
    const ctx = fakeCanvas().getContext('2d');
    const bg = def.create();
    const sizes = [[360, 740], [412, 915], [800, 600], [320, 560]];
    const FRAMES = 900;
    let t = 0;
    const started = process.hrtime.bigint();
    for (let i = 0; i < FRAMES; i++) {
      if (i % 225 === 0) bg.resize(...sizes[i / 225]);
      const dt = i % 97 === 0 ? 0.05 : 1 / 60;
      t += dt;
      const cyc = (t % 16) / 16;
      const phase = Math.floor(cyc * 4);
      const p = cyc * 4 - phase;
      const breath = { level: phase === 0 ? p : phase === 1 ? 1 : phase === 2 ? 1 - p : 0, phase: i < 450 ? phase : -1, running: i < 450 };
      if (!breath.running) breath.level = 0;
      stats.inFrame = true;
      bg.frame(ctx, t, dt, breath);
      stats.inFrame = false;
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6 / FRAMES;
    const gradPerFrame = stats.gradients / FRAMES;
    if (stats.badArgs.length) problems.push(`нечисловые аргументы рисования: ${stats.badArgs.join('; ')}`);
    if (stats.imageData) problems.push('getImageData/putImageData внутри кадра');
    if (stats.createElement) problems.push('создание холстов внутри кадра — готовьте спрайты в create()/resize()');
    if (stats.slowProps.length) problems.push(`медленные свойства в кадре: ${stats.slowProps.join(', ')}`);
    if (gradPerFrame > 4) problems.push(`слишком много градиентов за кадр: ${gradPerFrame.toFixed(1)} (допустимо до 4)`);
    if (ms > 1.5) problems.push(`тяжёлый кадр даже без отрисовки: ${ms.toFixed(2)} мс`);
    console.log(`${problems.length ? 'ПЛОХО ' : 'OK    '} ${def.id.padEnd(12)} «${def.name}»  ${ms.toFixed(3)} мс/кадр, градиентов/кадр ${gradPerFrame.toFixed(2)}`);
  } catch (err) {
    problems.push(`исключение: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
    console.log(`ПЛОХО  ${def.id}`);
  }
  for (const p of problems) console.log(`         - ${p}`);
  if (problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
