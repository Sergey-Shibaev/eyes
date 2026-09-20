// Фон «Светлячки»: тёплая летняя ночь над лугом.
// Небо с луной, свечения, дымка, лес и пучки травы рисуются заранее в небольшие холсты;
// в кадре остаются блиты готовых картинок и пара путей для камышей.
(function () {
  'use strict';
  if (typeof BreathBackgrounds === 'undefined') return;

  const TAU = Math.PI * 2;
  const MAX_FLIES = 48;
  const STARS = 20;
  const SCENE_H = 280; // высота полосы пейзажа, в условных единицах u
  const HORIZON = 150; // горизонт от низа экрана, в u
  const CLUMP_W = 170; // ширина пучка травы, в u
  // Оттенки светлячков: лайм, весенняя зелень, мята — в стороне от жёлтого цвета интерфейса
  const FLY_RGB = ['178,238,118', '150,236,136', '132,234,176'];
  // Глубина: дальние мелкие и тусклые, средние, ближние — крупные размытые «боке»
  const DEPTH = [
    { size: [9, 15], alpha: 0.62, speed: [4, 8], roam: [60, 130], top: 0.26, bottom: 75 },
    { size: [20, 32], alpha: 0.85, speed: [6, 11], roam: [80, 160], top: 0.36, bottom: 45 },
    { size: [36, 56], alpha: 0.36, speed: [8, 14], roam: [100, 190], top: 0.44, bottom: 15 },
  ];
  // Качающаяся трава: средний и ближний планы (sink — насколько основание утоплено под экран)
  const GRASS = [
    { h: 100, sink: 2, blades: 20, wide: 1, top: '#061a19', bottom: '#020d0d', sway: 0.035, lean: 0.02 },
    { h: 84, sink: 22, blades: 17, wide: 1.6, top: '#031110', bottom: '#010606', sway: 0.05, lean: 0.03 },
  ];

  // Небо: [позиция в долях высоты до горизонта, r, g, b]; ниже горизонта цвет уходит к GROUND
  const SKY = [[0, 6, 13, 29], [0.45, 10, 26, 46], [0.8, 14, 47, 58], [1, 22, 69, 65]];
  const GROUND = [1, 14, 47, 45];
  // Луна в дымке: [радиус в долях ореола, r, g, b, непрозрачность]. Запекается в небо целиком:
  // живой полупрозрачный слой поверх тёмного неба снова дал бы кольца
  const MOON = [[0, 228, 238, 228, 0.25], [0.03, 228, 238, 228, 0.215], [0.065, 176, 210, 212, 0.117], [0.32, 150, 196, 205, 0.054], [1, 150, 196, 205, 0]];
  const MOON_X = 0.76, MOON_Y = 0.12, MOON_R = 0.75; // центр в долях экрана, радиус ореола в долях меньшей стороны

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const mix = (range, k) => range[0] + (range[1] - range[0]) * k;
  const quad = (a, b, c, s) => (1 - s) * (1 - s) * a + 2 * (1 - s) * s * b + s * s * c;

  // Кусочно-линейная таблица [позиция, значения...]: результат пишется в out без выделения памяти
  function ramp(table, x, out) {
    let i = 0;
    while (i < table.length - 2 && x > table[i + 1][0]) i++;
    const a = table[i], b = table[i + 1], k = clamp((x - a[0]) / (b[0] - a[0] || 1), 0, 1);
    for (let j = 1; j < a.length; j++) out[j - 1] = a[j] + (b[j] - a[j]) * k;
  }

  // Повторяемый генератор: пейзаж не «перетасовывается» при каждой смене размера
  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sized(canvas, w, h) {
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    return canvas.getContext('2d');
  }

  // Мягкое радиальное пятно; при h < w получается вытянутый эллипс (дымка)
  function glowSprite(w, h, stops) {
    const canvas = document.createElement('canvas');
    const g = sized(canvas, w, h);
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], 'rgba(' + stops[i][1] + ',' + stops[i][2] + ')');
    g.scale(1, h / w);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
    return canvas;
  }

  function vGradient(g, y0, y1, top, bottom) {
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    return grad;
  }

  // Небо с широким ореолом луны запекается попиксельно с шумом в пол-уровня яркости:
  // без него тёмный градиент на хорошем экране в темноте распадается на полосы и кольца
  function paintSky(canvas, W, H, u) {
    const k = Math.min(1, 960 / Math.max(W, H)); // разрешения CSS-пикселей хватает, мягкий фон растягивается без потерь
    const w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k));
    const g = sized(canvas, w, h), img = g.createImageData(w, h), d = img.data;
    const hz = clamp((H - HORIZON * u) / H, 0.3, 0.95);
    const table = SKY.map((s) => [s[0] * hz, s[1], s[2], s[3]]).concat([GROUND]);
    const mx = W * MOON_X * k, my = H * MOON_Y * k, mr = Math.min(W, H) * MOON_R * k;
    const row = [0, 0, 0], halo = [0, 0, 0, 0];
    for (let y = 0, o = 0; y < h; y++) {
      ramp(table, y / (h - 1), row);
      for (let x = 0; x < w; x++, o += 4) {
        let r = row[0], gr = row[1], b = row[2];
        const q2 = ((x - mx) * (x - mx) + (y - my) * (y - my)) / (mr * mr);
        if (q2 < 1) {
          ramp(MOON, Math.sqrt(q2), halo);
          const a = halo[3];
          r += (halo[0] - r) * a;
          gr += (halo[1] - gr) * a;
          b += (halo[2] - b) * a;
        }
        const n = Math.random() - 0.5; // Uint8ClampedArray округляет сам — получается честный дизеринг
        d[o] = r + n;
        d[o + 1] = gr + n;
        d[o + 2] = b + n;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // Травинка: два плавных изгиба от основания к острому кончику
  function addBlade(g, x, baseY, height, halfW, lean) {
    const midX = x + lean * 0.15, midY = baseY - height * 0.55;
    g.moveTo(x - halfW, baseY);
    g.quadraticCurveTo(midX - halfW * 0.5, midY, x + lean, baseY - height);
    g.quadraticCurveTo(midX + halfW * 0.5, midY, x + halfW, baseY);
    g.closePath();
  }

  // Пучок травы одним путём: высокие стебли ближе к середине, низкие — по всей ширине
  function paintClump(canvas, layer, u, dpr, rnd) {
    const w = CLUMP_W * u, h = layer.h * u;
    const g = sized(canvas, w * dpr, h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = vGradient(g, 0, h, layer.top, layer.bottom);
    g.beginPath();
    g.rect(0, h * 0.93, w, h * 0.07);
    for (let i = 0; i < layer.blades * 2.5; i++) {
      const tall = i < layer.blades;
      const x = w * (tall ? 0.1 + 0.4 * (rnd() + rnd()) : rnd());
      const bh = h * (tall ? 0.45 + 0.55 * Math.pow(rnd(), 1.5) : 0.18 + 0.3 * rnd());
      const lean = clamp((rnd() - 0.5) * 0.7 * bh, 3 - x, w - 3 - x);
      addBlade(g, x, h, bh, (0.9 + rnd()) * layer.wide * u, lean);
      if (tall && i % 5 === 0) { // колосок на кончике
        const rot = Math.atan2(lean, bh) * 0.9, cx = x + lean, cy = h - bh + 3 * u;
        g.moveTo(cx + 1.2 * u * Math.cos(rot), cy + 1.2 * u * Math.sin(rot));
        g.ellipse(cx, cy, 1.2 * u, 5 * u, rot, 0, TAU);
      }
    }
    g.fill();
  }

  // Волнистая кромка леса: |sin| даёт округлые кроны с острыми просветами
  function ridge(g, W, bottom, horizon, u, color, base, a1, a2, a3, k, p) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, bottom);
    for (let x = 0; x <= W + 4; x += 4) {
      const n = (x / u) * k;
      const crown = base + a1 * Math.sin(n * 0.006 + p) + a2 * Math.abs(Math.sin(n * 0.035 + p * 2)) + a3 * Math.abs(Math.sin(n * 0.083 + p * 3));
      g.lineTo(x, horizon - crown * u);
    }
    g.lineTo(W + 4, bottom);
    g.fill();
  }

  // Неподвижная часть пейзажа: два яруса леса, отдельные деревья, луг и дальняя трава
  function paintScenery(canvas, W, u, dpr, rnd) {
    const h = SCENE_H * u, horizon = h - HORIZON * u, grassY = h - 70 * u;
    const g = sized(canvas, W * dpr, h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    ridge(g, W, h, horizon, u, '#0d2e31', 30, 14, 12, 6, 1, rnd() * TAU);
    ridge(g, W, h, horizon, u, '#092325', 14, 9, 10, 5, 1.5, rnd() * TAU);
    for (let i = 0, n = 2 + Math.floor(W / (260 * u)); i < n; i++) {
      const tx = W * (0.05 + 0.9 * rnd()), th = (42 + 40 * rnd()) * u;
      g.fillRect(tx - 1.5 * u, horizon - th, 3 * u, th);
      g.beginPath();
      for (let j = 0; j < 11; j++) { // крона — купол из кругов: шире внизу, уже к макушке
        const k = rnd(), r = (7 + 8 * rnd()) * (1.1 - 0.4 * k) * u;
        const cx = tx + (rnd() - 0.5) * (1.2 - k) * 46 * u, cy = horizon - th * (0.45 + 0.55 * k);
        g.moveTo(cx + r, cy);
        g.arc(cx, cy, r, 0, TAU);
      }
      g.fill();
    }
    // луг: светлее у горизонта, к зрителю темнеет и сливается с дальней травой
    ridge(g, W, h, horizon, u, vGradient(g, horizon, grassY, '#143c39', '#08201f'), 0, 2.5, 0, 0, 2, rnd() * TAU);
    g.fillStyle = vGradient(g, grassY - 58 * u, grassY + 12 * u, '#0b2927', '#061a19');
    g.beginPath();
    g.rect(0, grassY + 8 * u, W, h - grassY);
    for (let i = 0, n = (W / u) * 1.4; i < n; i++) {
      const bh = (18 + 40 * Math.pow(rnd(), 1.4)) * u;
      addBlade(g, W * rnd(), grassY + (4 + 10 * rnd()) * u, bh, (0.6 + 0.6 * rnd()) * u, (rnd() - 0.5) * 0.6 * bh);
    }
    g.fill();
  }

  BreathBackgrounds.register({
    id: 'fireflies',
    name: 'Светлячки',
    create() {
      const sharp = [], bokeh = [];
      for (let i = 0; i < 3; i++) {
        const c = FLY_RGB[i];
        sharp.push(glowSprite(96, 96, [[0, '240,255,224', 1], [0.1, c, 0.9], [0.28, c, 0.3], [0.6, c, 0.07], [1, c, 0]]));
        bokeh.push(glowSprite(128, 128, [[0, c, 0.55], [0.5, c, 0.46], [0.78, c, 0.16], [1, c, 0]]));
      }
      const starSprite = glowSprite(32, 32, [[0, '228,238,246', 1], [0.3, '205,224,240', 0.4], [1, '205,224,240', 0]]);
      const mistSprite = glowSprite(256, 64, [[0, '150,202,196', 1], [0.5, '150,202,196', 0.42], [1, '150,202,196', 0]]);
      const skyCanvas = document.createElement('canvas');
      const scenery = document.createElement('canvas');
      const grassSprites = GRASS.map(() => [0, 1, 2].map(() => document.createElement('canvas')));
      const clumps = [[], []];
      const reeds = [];
      const seed = (Math.random() * 1e9) | 0;

      const stars = [];
      for (let i = 0; i < STARS; i++) {
        let fx, fy;
        do { // звезда не должна просвечивать сквозь диск луны
          fx = Math.random();
          fy = 0.03 + 0.6 * Math.pow(Math.random(), 1.3);
        } while (Math.abs(fx - MOON_X) < 0.08 && Math.abs(fy - 0.15) < 0.07);
        stars.push({ fx, fy, r: 1.4 + 1.6 * Math.random(), a: 0.25 + 0.45 * Math.random(), rate: 0.3 + 0.7 * Math.random(), ph: Math.random() * TAU });
      }
      // Полосы дымки: up — высота над низом (u), w — ширина в долях экрана, speed — u/с
      const mist = [
        { x: 0, k: Math.random(), up: 150, w: 1.3, h: 70, speed: 3, alpha: 0.1 },
        { x: 0, k: Math.random(), up: 118, w: 1.0, h: 55, speed: 5, alpha: 0.08 },
        { x: 0, k: Math.random(), up: 70, w: 1.5, h: 60, speed: 7, alpha: 0.06 },
      ];
      const flies = [];
      for (let i = 0; i < MAX_FLIES; i++) {
        const layer = i % 8 === 0 ? 2 : i % 8 < 4 ? 1 : 0;
        flies.push({
          layer, sprite: (layer === 2 ? bokeh : sharp)[i % 3], alpha: DEPTH[layer].alpha,
          homeX: 0.06 + 0.88 * Math.random(), homeY: Math.pow(Math.random(), 0.55), // чаще ближе к лугу
          kSize: Math.random(), kSpeed: Math.random(), kRoam: Math.random(),
          x: 0, y: 0, hx: 0, hy: 0, size: 0, speed: 0, roam: 0,
          heading: Math.random() * TAU, turn: 0, turnTarget: 0, turnTimer: 0,
          phase: Math.random() * TAU, rate: TAU / (4.5 + 5 * Math.random()), sharp: 1.4 + 1.6 * Math.random(), seed: Math.random() * 100,
        });
      }

      let W = 0, H = 0, u = 1, dpr = 0, count = 0, ready = false;
      let level = 0.4, exhale = 0, gust = 1;

      // Ветер: две медленные волны, бегущие вдоль луга; gust — плавные порывы
      const wind = (x, t) => (0.6 * Math.sin(t * 0.55 - x * 0.011) + 0.4 * Math.sin(t * 0.31 + x * 0.006 + 1.7)) * gust;

      function layClumps(list, rnd) {
        list.length = 0;
        const step = CLUMP_W * u * 0.55;
        for (let x = -step * 0.5; x < W + step; x += step) {
          list.push({ x: x + (rnd() - 0.5) * step * 0.5, sprite: (rnd() * 3) | 0, flip: rnd() < 0.5 ? -1 : 1, sx: 0.9 + 0.3 * rnd(), sy: 0.82 + 0.3 * rnd() });
        }
      }

      // Пучки качаются сдвигом вокруг основания — волна ветра проходит по лугу
      function drawGrass(ctx, li, t) {
        const layer = GRASS[li], list = clumps[li], w = CLUMP_W * u, h = layer.h * u, baseY = H + layer.sink * u;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const bend = (layer.sway * wind(c.x, t) + layer.lean * exhale) * c.sy;
          ctx.save();
          ctx.transform(c.flip * c.sx, 0, -bend, c.sy, c.x, baseY);
          ctx.drawImage(grassSprites[li][c.sprite], -w / 2, -h, w, h);
          ctx.restore();
        }
      }

      function drawReeds(ctx, t) {
        const baseY = H + 2;
        ctx.fillStyle = ctx.strokeStyle = '#031211';
        ctx.beginPath();
        for (let i = 0; i < reeds.length; i++) {
          const r = reeds[i];
          r.bend = r.lean + (0.06 * wind(r.x, t) + 0.035 * exhale) * r.h;
          addBlade(ctx, r.x, baseY, r.h, 1.2 * u, r.bend);
          addBlade(ctx, r.x + r.dir * 2 * u, baseY, r.h * 0.62, 2 * u, r.dir * r.h * 0.3 + r.bend * 0.5);
        }
        ctx.fill();
        // початки — толстые скруглённые отрезки вдоль верхней части стебля
        ctx.lineCap = 'round';
        ctx.lineWidth = 5.5 * u;
        ctx.beginPath();
        for (let i = 0; i < reeds.length; i++) {
          const r = reeds[i], x1 = r.x + r.bend * 0.15, y1 = baseY - r.h * 0.55, x2 = r.x + r.bend, y2 = baseY - r.h;
          ctx.moveTo(quad(r.x, x1, x2, 0.74), quad(baseY, y1, y2, 0.74));
          ctx.lineTo(quad(r.x, x1, x2, 0.9), quad(baseY, y1, y2, 0.9));
        }
        ctx.stroke();
      }

      function drawMist(ctx, p, dt) {
        const pw = p.w * W, ph = p.h * u;
        p.x += p.speed * u * dt;
        if (p.x > W) p.x = -pw; // возвращается из-за левого края, шва не видно
        ctx.globalAlpha = p.alpha;
        ctx.drawImage(mistSprite, p.x, H - p.up * u - ph / 2, pw, ph);
      }

      // Один слой светлячков: движение и отрисовка за один проход, без выделения памяти
      function flyPass(ctx, layer, t, dt) {
        const swell = 1 + 0.08 * level, shine = 0.88 + 0.12 * level;
        for (let i = 0; i < count; i++) {
          const f = flies[i];
          if (f.layer !== layer) continue;
          // курс меняется плавно: скорость поворота тянется к редкой случайной цели
          f.turnTimer -= dt;
          if (f.turnTimer <= 0) {
            f.turnTimer = 2.5 + 4.5 * Math.random();
            f.turnTarget = (Math.random() * 2 - 1) * 0.4;
          }
          f.turn += (f.turnTarget - f.turn) * Math.min(1, dt * 0.9);
          f.heading += f.turn * dt;
          // мягкий возврат к «дому», если улетел слишком далеко
          const dx = f.hx - f.x, dy = f.hy - f.y, away = Math.sqrt(dx * dx + dy * dy) - f.roam;
          if (away > 0) {
            const want = Math.atan2(dy, dx) - f.heading;
            f.heading += Math.atan2(Math.sin(want), Math.cos(want)) * Math.min(1, away / (80 * u)) * dt * 0.8;
          }
          const v = f.speed * (0.75 + 0.25 * Math.sin(t * 0.23 + f.seed));
          f.x += Math.cos(f.heading) * v * dt;
          f.y += Math.sin(f.heading) * v * dt * 0.75;
          // собственный медленный ритм свечения
          f.phase += f.rate * dt;
          if (f.phase > TAU) f.phase -= TAU;
          const glow = 0.07 + 0.93 * Math.pow(0.5 + 0.5 * Math.sin(f.phase), f.sharp);
          const a = f.alpha * glow * (0.8 + 0.2 * Math.sin(t * 0.17 + f.seed)) * shine;
          if (a < 0.012) continue;
          const d = f.size * (0.8 + 0.2 * glow) * swell;
          ctx.globalAlpha = a;
          ctx.drawImage(f.sprite, f.x - d / 2, f.y + Math.sin(t * 0.7 + f.seed * 3) * 2.5 * u - d / 2, d, d);
        }
        ctx.globalAlpha = 1;
      }

      return {
        resize(width, height) {
          const oldW = W, oldH = H;
          W = Math.max(0, +width || 0);
          H = Math.max(0, +height || 0);
          ready = W > 0 && H > 0;
          if (!ready) return;
          const fresh = !(oldW > 0 && oldH > 0);
          // u зависит в основном от ширины: скрытие адресной строки не перестраивает пейзаж
          const newU = clamp(Math.min(W, H * 0.62) / 400, 0.75, 1.3);
          const newDpr = clamp(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1, 2);
          const rescaled = newU !== u || newDpr !== dpr;
          u = newU;
          dpr = newDpr;
          if (rescaled || W !== oldW || H !== oldH) paintSky(skyCanvas, W, H, u);
          if (rescaled) {
            const rnd = seeded(seed + 1);
            for (let li = 0; li < GRASS.length; li++) for (let k = 0; k < 3; k++) paintClump(grassSprites[li][k], GRASS[li], u, dpr, rnd);
          }
          if (rescaled || W !== oldW) {
            paintScenery(scenery, W, u, dpr, seeded(seed));
            const rnd = seeded(seed + 2);
            layClumps(clumps[0], rnd);
            layClumps(clumps[1], rnd);
            reeds.length = 0; // камыши — по краям, чтобы центр оставался чистым
            for (let i = 0, n = W > 600 ? 10 : 7; i < n; i++) {
              const fx = rnd() < 0.5 ? 0.02 + 0.2 * rnd() : 0.78 + 0.2 * rnd();
              reeds.push({ x: W * fx, h: (150 + 95 * rnd()) * u, lean: (rnd() - 0.5) * 50 * u, dir: rnd() < 0.5 ? -1 : 1, bend: 0 });
            }
          }
          count = clamp(Math.round((W * H) / 8500), 30, MAX_FLIES);
          for (let i = 0; i < MAX_FLIES; i++) {
            const f = flies[i], d = DEPTH[f.layer];
            const top = H * d.top, bottom = Math.max(top + 40, H - d.bottom * u);
            f.hx = f.homeX * W;
            f.hy = top + (bottom - top) * f.homeY;
            f.size = mix(d.size, f.kSize) * u;
            f.speed = mix(d.speed, f.kSpeed) * u;
            f.roam = mix(d.roam, f.kRoam) * u;
            f.x = fresh ? f.hx + (Math.random() - 0.5) * f.roam : (f.x * W) / oldW;
            f.y = fresh ? f.hy + (Math.random() - 0.5) * f.roam : (f.y * H) / oldH;
          }
          for (let i = 0; i < mist.length; i++) {
            const p = mist[i];
            p.x = fresh ? -p.w * W + p.k * (W + p.w * W) : (p.x * W) / oldW;
          }
        },

        frame(ctx, t, dt, breath) {
          // холст общий для всех фонов: не полагаемся на состояние, оставленное предыдущим
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          if (!ready) {
            ctx.fillStyle = '#070f1f';
            ctx.fillRect(0, 0, 4096, 4096);
            return;
          }
          t = +t || 0;
          dt = clamp(+dt || 0, 0, 0.05);
          // дыхание сглаживаем: на вдохе всё чуть ярче, на выдохе трава слегка клонится
          const running = !!(breath && breath.running);
          level += ((running ? clamp(+breath.level || 0, 0, 1) : 0.4) - level) * Math.min(1, dt * 2.5);
          exhale += ((running && breath.phase === 2 ? 1 : 0) - exhale) * Math.min(1, dt * 0.7);
          gust = 0.65 + 0.35 * Math.sin(t * 0.083 + 0.6);

          ctx.drawImage(skyCanvas, 0, 0, W, H);

          // редкие звёзды с медленным мерцанием
          const skyH = Math.max(40, H - HORIZON * u);
          for (let i = 0; i < STARS; i++) {
            const s = stars[i];
            ctx.globalAlpha = s.a * (0.72 + 0.28 * Math.sin(t * s.rate + s.ph));
            ctx.drawImage(starSprite, s.fx * W - s.r, s.fy * skyH - s.r, s.r * 2, s.r * 2);
          }

          ctx.globalAlpha = 1;
          ctx.drawImage(scenery, 0, H - SCENE_H * u, W, SCENE_H * u);
          drawMist(ctx, mist[0], dt);
          drawMist(ctx, mist[1], dt);
          flyPass(ctx, 0, t, dt); // дальние — за средней травой
          drawGrass(ctx, 0, t);
          drawMist(ctx, mist[2], dt);
          flyPass(ctx, 1, t, dt);
          drawReeds(ctx, t);
          drawGrass(ctx, 1, t);
          flyPass(ctx, 2, t, dt); // ближние «боке» — поверх всего
        },
      };
    },
  });
})();
