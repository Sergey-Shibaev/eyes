// Фон «Море»: сумеречное небо с низкой луной, слоистые волны, рыбки под водой и блики на гребнях.
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const BANDS = 7; // слоёв воды: от горизонта к зрителю
  const SEGMENTS = 64; // отрезков в линии гребня
  const FISH = 5;
  const GLINTS = 22;
  const STARS = 28;
  const CLOUDS = 4;

  // Опорные цвета воды: даль → середина → передний план
  const CREST = [[72, 76, 100], [24, 78, 88], [8, 30, 50]];
  const BODY = [[46, 66, 90], [13, 53, 68], [4, 16, 30]];
  const DEEP = [[34, 60, 84], [8, 40, 58], [2, 9, 20]];

  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN тоже даёт 0

  function mix3(stops, k) {
    const i = k < 0.5 ? 0 : 1;
    const q = k < 0.5 ? k * 2 : k * 2 - 1;
    const a = stops[i];
    const b = stops[i + 1];
    return `rgb(${Math.round(lerp(a[0], b[0], q))},${Math.round(lerp(a[1], b[1], q))},${Math.round(lerp(a[2], b[2], q))})`;
  }

  // Цветовые стопы градиента: list = [позиция, цвет, позиция, цвет, ...]
  function stops(grad, list) {
    for (let i = 0; i < list.length; i += 2) grad.addColorStop(list[i], list[i + 1]);
    return grad;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Круглое мягкое пятно
  function makeGlow(size, list) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    g.fillStyle = stops(g.createRadialGradient(r, r, 0, r, r, r), list);
    g.fillRect(0, 0, size, size);
    return c;
  }

  // Вытянутое облако из нескольких сплюснутых пятен
  function makeCloud() {
    const c = makeCanvas(384, 96);
    const g = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const rx = rand(60, 120);
      const ry = rand(10, 22);
      g.save();
      g.translate(rand(rx, 384 - rx), 48 + rand(-14, 14));
      g.scale(1, ry / rx);
      g.fillStyle = stops(g.createRadialGradient(0, 0, 0, 0, 0, rx), [0, 'rgba(168,136,162,0.5)', 1, 'rgba(168,136,162,0)']);
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    }
    return c;
  }

  // Лунная дорожка: мягкая по ширине, гаснет книзу
  function makeSheen() {
    const c = makeCanvas(64, 128);
    const g = c.getContext('2d');
    const tint = 'rgba(232,200,198,';
    g.fillStyle = stops(g.createLinearGradient(0, 0, 64, 0), [0, tint + '0)', 0.28, tint + '0.3)', 0.5, tint + '1)', 0.72, tint + '0.3)', 1, tint + '0)']);
    g.fillRect(0, 0, 64, 128);
    g.globalCompositeOperation = 'destination-in'; // оставляем только то, что попало под вертикальное затухание
    g.fillStyle = stops(g.createLinearGradient(0, 0, 0, 128), [0, 'rgba(0,0,0,1)', 0.5, 'rgba(0,0,0,0.35)', 1, 'rgba(0,0,0,0)']);
    g.fillRect(0, 0, 64, 128);
    return c;
  }

  function resetGlint(g) {
    g.band = Math.floor(Math.random() * BANDS);
    g.wide = Math.random() < 0.3; // часть бликов — по всей ширине, остальные под луной
    g.u = g.wide ? Math.random() : (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
    g.size = rand(10, 26);
    g.peak = g.wide ? rand(0.1, 0.26) : rand(0.25, 0.5);
    g.dur = rand(2.5, 6);
    g.life = 0;
  }

  function resetCloud(c) {
    const far = Math.random(); // 0 — высоко и близко, 1 — у горизонта и далеко
    c.sprite = Math.random() < 0.5 ? 0 : 1;
    c.y = lerp(0.4, 0.9, far);
    c.w = lerp(1, 0.5, far) * rand(0.85, 1.15);
    c.v = lerp(6, 2.5, far);
    c.a = rand(0.2, 0.36);
  }

  function create() {
    const tool = makeCanvas(1, 1).getContext('2d'); // нужен только для создания градиентов в resize()
    const moon = makeGlow(256, [
      0, 'rgba(234,210,202,0.86)', 0.085, 'rgba(232,206,200,0.82)', 0.105, 'rgba(226,190,190,0.3)',
      0.3, 'rgba(200,150,170,0.1)', 1, 'rgba(200,150,170,0)',
    ]);
    const haze = makeGlow(128, [0, 'rgba(205,135,145,0.55)', 0.5, 'rgba(190,120,150,0.18)', 1, 'rgba(190,120,150,0)']);
    const cloudSprites = [makeCloud(), makeCloud()];
    const sheen = makeSheen();
    const glint = makeGlow(64, [0, 'rgba(255,234,224,1)', 0.4, 'rgba(255,226,216,0.4)', 1, 'rgba(255,226,216,0)']); // при выводе сплющивается в овал

    let W = 0, H = 0, unit = 1, horizon = 0, moonX = 0, moonY = 0;
    let skyFill = '#0a1230';
    let time = 0;
    let calm = 0.4; // сглаженный уровень дыхания
    let seeded = false;
    const ys = new Float32Array(SEGMENTS + 1);

    const bands = [];
    for (let i = 0; i < BANDS; i++) {
      bands.push({
        f: i / (BANDS - 1), p1: rand(0, TAU), p2: rand(0, TAU), p3: rand(0, TAU), bob: rand(0, TAU),
        base: 0, strip: 0, bottom: 0, amp: 0, k1: 0, k2: 0, k3: 0, w1: 0, w2: 0, w3: 0, fill: '#06182a', // из resize()
        a1: 0, a2: 0, a3: 0, y0: 0, ampNow: 0, // из кадра
      });
    }

    const stars = [];
    for (let i = 0; i < STARS; i++) {
      const v = Math.pow(Math.random(), 1.4) * 0.78; // ближе к горизонту звёзд меньше
      stars.push({ u: Math.random(), v, r: rand(1, 1.8), a: rand(0.3, 0.75) * (1 - v), w: rand(0.2, 0.6), p: rand(0, TAU) });
    }

    const clouds = [];
    for (let i = 0; i < CLOUDS; i++) {
      const c = { u: (i + Math.random() * 0.6) / CLOUDS };
      resetCloud(c);
      clouds.push(c);
    }

    const glints = [];
    for (let i = 0; i < GLINTS; i++) {
      const g = {};
      resetGlint(g);
      g.life = Math.random() * g.dur;
      glints.push(g);
    }

    const shoal = [];
    for (let i = 0; i < FISH; i++) {
      shoal.push({ active: false, wait: 2 + i * rand(3, 7), layer: 1, dir: 1, speed: 10, size: 20, depth: 0.5, x: 0, phase: 0, beat: 3, tone: 0.2 });
    }

    // Высота поверхности слоя в точке x (фазы и амплитуда уже посчитаны для кадра)
    function surfaceY(b, x) {
      return b.y0 + b.ampNow * (0.55 * Math.sin(x * b.k1 + b.a1) + 0.27 * Math.sin(x * b.k2 + b.a2) + 0.18 * Math.sin(x * b.k3 + b.a3));
    }

    function spawnFish(fish, leader) {
      if (leader) { // спутник плывёт следом за ведущей рыбкой
        fish.layer = leader.layer;
        fish.dir = leader.dir;
        fish.speed = leader.speed;
        fish.size = leader.size * rand(0.7, 0.9);
        fish.depth = clamp01(leader.depth + rand(-0.2, 0.2));
        fish.x = leader.x - leader.dir * leader.size * unit * rand(1.6, 2.4);
      } else {
        fish.layer = Math.min(BANDS - 1, 1 + Math.floor(Math.pow(Math.random(), 0.7) * (BANDS - 1)));
        const f = bands[fish.layer].f;
        fish.dir = Math.random() < 0.5 ? -1 : 1;
        fish.speed = rand(9, 17) * (0.55 + 0.6 * f);
        fish.size = rand(20, 34) * (0.55 + 0.6 * f);
        fish.depth = Math.random();
        fish.x = fish.dir > 0 ? -fish.size * unit : W + fish.size * unit;
      }
      fish.active = true;
      fish.phase = rand(0, TAU);
      fish.beat = 2.2 + fish.speed * 0.12;
      fish.tone = lerp(0.18, 0.28, bands[fish.layer].f);
    }

    function updateFish(step) {
      const margin = 170 * unit;
      for (let n = 0; n < FISH; n++) {
        const fish = shoal[n];
        if (!fish.active) {
          fish.wait -= step;
          if (fish.wait > 0) continue;
          spawnFish(fish, null);
          const mate = shoal[(n + 1) % FISH];
          if (!mate.active && Math.random() < 0.4) spawnFish(mate, fish);
          continue;
        }
        fish.x += fish.dir * fish.speed * unit * step;
        fish.phase += step * fish.beat;
        if (fish.x < -margin || fish.x > W + margin) {
          fish.active = false;
          fish.wait = rand(4, 16);
        }
      }
    }

    function drawFish(ctx, index) {
      const b = bands[index];
      for (let n = 0; n < FISH; n++) {
        const fish = shoal[n];
        if (!fish.active || fish.layer !== index) continue;
        const L = fish.size * unit;
        const d = fish.dir * L;
        const x = fish.x;
        const room = Math.max(0, b.strip - L - b.amp * 2);
        const follow = (surfaceY(b, x) - b.y0) * (1 - fish.depth) * 0.6; // у поверхности рыбку качает волной
        const y = b.y0 + b.amp + L * 0.4 + fish.depth * room + follow + Math.sin(fish.phase * 0.31) * 1.5 * unit;
        const sway = Math.sin(fish.phase) * L * 0.07; // взмах хвоста
        const joint = sway * 0.35;
        ctx.globalAlpha = fish.tone;
        ctx.beginPath();
        ctx.moveTo(x + d * 0.5, y);
        ctx.quadraticCurveTo(x + d * 0.1, y - L * 0.3, x - d * 0.3, y + joint - L * 0.035);
        ctx.lineTo(x - d * 0.52, y + sway - L * 0.16);
        ctx.quadraticCurveTo(x - d * 0.44, y + sway, x - d * 0.52, y + sway + L * 0.16);
        ctx.lineTo(x - d * 0.3, y + joint + L * 0.035);
        ctx.quadraticCurveTo(x + d * 0.1, y + L * 0.3, x + d * 0.5, y);
        ctx.fill();
      }
    }

    function drawGlints(ctx, index) {
      const b = bands[index];
      const spread = W * (0.04 + 0.2 * b.f); // дорожка расширяется к зрителю
      const scale = unit * (0.5 + 0.9 * b.f);
      for (let n = 0; n < GLINTS; n++) {
        const g = glints[n];
        if (g.band !== index) continue;
        const k = Math.sin((Math.PI * g.life) / g.dur);
        const x = g.wide ? g.u * W : moonX + g.u * spread;
        const gw = g.size * scale;
        ctx.globalAlpha = g.peak * k * k * (0.85 + 0.15 * calm);
        ctx.drawImage(glint, x - gw / 2, surfaceY(b, x) - gw * 0.12 + 1, gw, gw * 0.24);
      }
    }

    function resize(width, height) {
      W = Math.max(0, +width || 0);
      H = Math.max(0, +height || 0);
      unit = Math.min(1.6, Math.max(0.7, Math.min(W, H) / 412));
      horizon = Math.round(H * 0.45);
      moonX = W * 0.78;
      moonY = horizon - H * 0.085;

      // Небо: глубокий синий → приглушённая бирюза → розоватая полоска у горизонта
      skyFill = stops(tool.createLinearGradient(0, 0, 0, Math.max(1, horizon)),
        [0, '#050918', 0.35, '#0c1636', 0.65, '#1a2f52', 0.86, '#2f4d60', 0.96, '#48485f', 1, '#523f58']);

      const water = H - horizon;
      const baseAt = (f) => horizon + water * 0.84 * Math.pow(f, 1.5); // дальние слои теснее — перспектива
      for (let i = 0; i < BANDS; i++) {
        const b = bands[i];
        const f = b.f;
        b.base = baseAt(f);
        b.strip = (i < BANDS - 1 ? baseAt(bands[i + 1].f) : H) - b.base;
        b.amp = lerp(0.8, 12, Math.pow(f, 1.2)) * unit;
        const wave = lerp(70, 300, f) * unit; // длина главной волны
        const v = lerp(4.5, 21, f) * unit; // её скорость, px/с: ближние слои быстрее; гребень идёт через экран не быстрее ~20 с
        b.k1 = TAU / wave;
        b.k2 = TAU / (wave * 0.43);
        b.k3 = TAU / (wave * 2.7);
        b.w1 = b.k1 * v;
        b.w2 = b.k2 * v * 0.6;
        b.w3 = b.k3 * v * 1.4;
        // светлее у гребня — слой получает объём
        b.fill = stops(tool.createLinearGradient(0, b.base - b.amp - 2, 0, b.base + Math.max(8, b.strip) * 1.25),
          [0, mix3(CREST, f), 0.32, mix3(BODY, f), 1, mix3(DEEP, f)]);
      }
      for (let i = 0; i < BANDS; i++) { // нижняя граница заливки: чуть ниже самой глубокой впадины следующего слоя
        const next = bands[i + 1];
        bands[i].bottom = next ? next.base + next.amp * 1.2 + 6 * unit + 2 : H;
      }

      if (!seeded && W > 0 && H > 0) { // чтобы первая рыбка была видна сразу
        seeded = true;
        spawnFish(shoal[0], null);
        shoal[0].x = W * rand(0.25, 0.6);
      }
    }

    function frame(ctx, t, dt, breath) {
      const step = dt > 0 ? Math.min(0.05, dt) : 0;
      time += step;
      const target = breath && breath.running ? clamp01(breath.level) : 0.4;
      calm += (target - calm) * (1 - Math.exp(-step * 1.8));

      // Небо (цвет у горизонта тянется вниз и перекрывается водой)
      ctx.globalAlpha = 1;
      ctx.fillStyle = skyFill;
      ctx.fillRect(0, 0, W, H);
      if (W < 2 || H < 2) return;

      ctx.fillStyle = 'rgb(206,214,238)';
      for (let i = 0; i < STARS; i++) {
        const s = stars[i];
        const size = s.r * unit;
        ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(time * s.w + s.p));
        ctx.fillRect(s.u * W, s.v * horizon, size, size);
      }

      // Зарево у горизонта и луна; ореол чуть ярче на вдохе
      ctx.globalAlpha = 0.3 + 0.06 * calm;
      ctx.drawImage(haze, moonX - W * 0.9, horizon - H * 0.12, W * 1.8, H * 0.24);
      const ms = 300 * unit * (1 + 0.04 * calm);
      ctx.globalAlpha = 0.86 + 0.12 * calm;
      ctx.drawImage(moon, moonX - ms / 2, moonY - ms / 2, ms, ms);

      for (let i = 0; i < CLOUDS; i++) {
        const c = clouds[i];
        const cw = c.w * Math.max(W, 360);
        c.u += (step * c.v * unit) / (W + cw);
        if (c.u > 1) { // ушло за край — вернётся слева уже другим
          c.u -= 1;
          resetCloud(c);
        }
        ctx.globalAlpha = c.a;
        ctx.drawImage(cloudSprites[c.sprite], -cw + c.u * (W + cw), horizon * c.y - cw * 0.125, cw, cw * 0.25);
      }

      for (let i = 0; i < GLINTS; i++) {
        const g = glints[i];
        g.life += step;
        if (g.life >= g.dur) resetGlint(g);
      }
      updateFish(step);

      // Вода: слои от горизонта к зрителю, на вдохе волна чуть выше и полнее
      const dx = W / SEGMENTS;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgb(178,168,198)';
      for (let i = 0; i < BANDS; i++) {
        const b = bands[i];
        b.a1 = b.p1 - time * b.w1;
        b.a2 = b.p2 + time * b.w2; // встречная рябь даёт «плеск»
        b.a3 = b.p3 - time * b.w3;
        b.ampNow = b.amp * (1 + 0.12 * calm);
        b.y0 = b.base + b.f * unit * (1.5 * Math.sin(time * 0.21 + b.bob) - 5 * (calm - 0.4));
        for (let j = 0; j <= SEGMENTS; j++) ys[j] = surfaceY(b, j * dx);

        // Контуром рисуем только волнистую кромку, тело слоя — быстрый прямоугольник до следующего слоя
        const flat = b.y0 + b.ampNow + 1;
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.fill;
        ctx.beginPath();
        ctx.moveTo(0, flat + 1);
        for (let j = 0; j <= SEGMENTS; j++) ctx.lineTo(j * dx, ys[j]);
        ctx.lineTo(W, flat + 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(0, flat, W, Math.max(0, b.bottom - flat));

        ctx.globalAlpha = lerp(0.1, 0.2, b.f); // светлая кромка гребня
        ctx.lineWidth = lerp(1, 1.6, b.f);
        ctx.beginPath();
        ctx.moveTo(0, ys[0]);
        for (let j = 1; j <= SEGMENTS; j++) ctx.lineTo(j * dx, ys[j]);
        ctx.stroke();

        drawGlints(ctx, i);
        ctx.fillStyle = 'rgb(150,190,198)';
        drawFish(ctx, i);
      }

      // Лунная дорожка поверх воды
      ctx.globalAlpha = 0.1 + 0.04 * calm;
      ctx.drawImage(sheen, moonX - W * 0.2, horizon, W * 0.4, (H - horizon) * 0.85);
      ctx.globalAlpha = 1;
    }

    return { resize, frame };
  }

  BreathBackgrounds.register({ id: 'sea', name: 'Море', create });
})();
