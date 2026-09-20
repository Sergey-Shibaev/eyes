// Фон «Северное сияние»: ночное небо, мерцающие звёзды, занавесы сияния и еловый лес внизу.
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const STAR_COUNT = 110;
  const GLOW_STARS = 7; // самые яркие звёзды получают мягкий ореол
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

  // Занавесы от дальнего к ближнему. y — нижняя кромка и h — длина лучей (доли высоты экрана),
  // n — число полос, fold — сила складок, k — частота складок, low/mid/top — цвета снизу вверх.
  const CURTAINS = [
    { y: 0.75, h: 0.17, n: 36, alpha: 0.4, fold: 0.26, k: 9.0, speed: 0.07, slope: 0.05, depth: 0.010, low: [50, 205, 190], mid: [35, 130, 200], top: [70, 70, 190] },
    { y: 0.61, h: 0.27, n: 44, alpha: 0.5, fold: 0.32, k: 7.0, speed: 0.09, slope: -0.08, depth: 0.020, low: [70, 230, 150], mid: [30, 180, 165], top: [85, 75, 200] },
    { y: 0.46, h: 0.38, n: 52, alpha: 0.52, fold: 0.36, k: 5.5, speed: 0.11, slope: 0.1, depth: 0.032, low: [90, 235, 165], mid: [40, 165, 175], top: [150, 75, 210] },
    { y: 0.27, h: 0.28, n: 40, alpha: 0.28, fold: 0.3, k: 4.2, speed: 0.08, slope: -0.06, depth: 0.028, low: [125, 115, 230], mid: [130, 75, 210], top: [150, 55, 170] },
  ];

  // Слои земли от дальних холмов к ближнему лесу (доли высоты полосы земли).
  const LAND = [
    { base: 0.24, amp: 0.11, k: 5.1, color: '#081823', density: 0, treeMin: 0, treeMax: 0, mist: 'rgba(70,140,140,0.20)' },
    { base: 0.43, amp: 0.09, k: 7.3, color: '#040e15', density: 1 / 6, treeMin: 0.06, treeMax: 0.15, mist: 'rgba(40,100,110,0.14)' },
    { base: 0.65, amp: 0.12, k: 3.7, color: '#02070b', density: 1 / 9, treeMin: 0.15, treeMax: 0.4, mist: '' },
  ];

  // Вертикальная полоса сияния: яркая нижняя кромка, длинное затухание вверх, мягкие бока.
  function makeStrip(def) {
    const w = 32, h = 256;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, rgba(def.top, 0));
    v.addColorStop(0.3, rgba(def.top, 0.17));
    v.addColorStop(0.62, rgba(def.mid, 0.5));
    v.addColorStop(0.89, rgba(def.low, 1));
    v.addColorStop(0.96, rgba(def.low, 0.4));
    v.addColorStop(1, rgba(def.low, 0));
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    // Бока — колокол cos²: соседние полосы складываются в ровное полотно без швов
    const m = g.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 8; i++) m.addColorStop(i / 8, rgba([255, 255, 255], Math.pow(Math.sin((Math.PI * i) / 8), 2).toFixed(3)));
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = m;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  // Ореол яркой звезды
  function makeGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, 'rgba(225,235,255,0.9)');
    r.addColorStop(0.14, 'rgba(200,220,255,0.4)');
    r.addColorStop(0.4, 'rgba(170,200,255,0.1)');
    r.addColorStop(1, 'rgba(150,190,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  function makeCurtain(def) {
    const n = def.n;
    const c = { def, sprite: makeStrip(def), p: [], shimmerPhase: new Float32Array(n), shimmerSpeed: new Float32Array(n), rayLen: new Float32Array(n) };
    for (let i = 0; i < 8; i++) c.p.push(rand(0, TAU));
    for (let i = 0; i < n; i++) {
      c.shimmerPhase[i] = rand(0, TAU);
      c.shimmerSpeed[i] = rand(0.12, 0.42);
      c.rayLen[i] = rand(0.85, 1.1);
    }
    return c;
  }

  // Рельеф и ёлки задаются один раз в долях ширины — при смене размера лес не «перепрыгивает».
  function makeLayer(def) {
    const trees = [];
    for (let i = 0; i < 150; i++) trees.push({ x: Math.random(), s: Math.pow(Math.random(), 1.6), w: rand(0.2, 0.3) });
    return { def, trees, p: [rand(0, TAU), rand(0, TAU), rand(0, TAU)] };
  }

  function ridge(layer, xf, landH) {
    const d = layer.def, p = layer.p;
    const wave = 0.6 * Math.sin(xf * d.k + p[0]) + 0.3 * Math.sin(xf * d.k * 2.3 + p[1]) + 0.1 * Math.sin(xf * d.k * 5.1 + p[2]);
    return landH * (d.base + d.amp * wave);
  }

  // Силуэт ели: ярусы с провисающими лапами, добавляется подконтуром в общий путь
  function spruce(g, x, base, h, w) {
    const tiers = h > 30 ? 5 : h > 14 ? 4 : 3;
    const top = base - h;
    g.moveTo(x, top);
    for (let i = 1; i <= tiers; i++) {
      const f = i / tiers;
      g.lineTo(x + w * f, top + h * f);
      if (i < tiers) g.lineTo(x + w * f * 0.45, top + h * (f - 0.04));
    }
    for (let i = tiers; i >= 1; i--) {
      const f = i / tiers;
      g.lineTo(x - w * f, top + h * f);
      if (i > 1) g.lineTo(x - w * (f - 1 / tiers) * 0.45, top + h * (f - 1 / tiers - 0.04));
    }
    g.closePath();
  }

  root.BreathBackgrounds.register({
    id: 'aurora',
    name: 'Северное сияние',
    create() {
      let W = 1, H = 1, landH = 1;
      let lvl = 0.4; // сглаженная наполненность лёгких
      let skyFill = '#040612', glowFill = 'rgba(0,0,0,0)';
      const land = document.createElement('canvas');
      const glow = makeGlow();
      const curtains = CURTAINS.map(makeCurtain);
      const layers = LAND.map(makeLayer);

      const starFx = new Float32Array(STAR_COUNT), starFy = new Float32Array(STAR_COUNT);
      const starX = new Float32Array(STAR_COUNT), starY = new Float32Array(STAR_COUNT);
      const starSize = new Float32Array(STAR_COUNT), starBase = new Float32Array(STAR_COUNT);
      const starPhase = new Float32Array(STAR_COUNT), starSpeed = new Float32Array(STAR_COUNT);
      for (let i = 0; i < STAR_COUNT; i++) {
        const bright = i >= STAR_COUNT - GLOW_STARS;
        starFx[i] = Math.random();
        starFy[i] = bright ? rand(0.04, 0.7) : Math.random();
        starSize[i] = bright || Math.random() < 0.25 ? 1.5 : 1;
        const base = bright ? rand(0.75, 0.95) : 0.18 + 0.6 * Math.pow(Math.random(), 2);
        starBase[i] = base * (1 - 0.55 * starFy[i] * starFy[i]); // у горизонта звёзды тусклее
        starPhase[i] = rand(0, TAU);
        starSpeed[i] = rand(0.4, 1.3);
      }

      // Земля рисуется один раз в отдельный холст: три слоя с дымкой между ними
      function renderLand() {
        const dpr = clamp(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1, 2);
        land.width = Math.max(1, Math.round(W * dpr));
        land.height = Math.max(1, Math.round(landH * dpr));
        const g = land.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, landH);
        for (const layer of layers) {
          const d = layer.def;
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = d.color;
          g.beginPath();
          g.moveTo(0, landH);
          for (let x = 0; x < W + 4; x += 4) g.lineTo(x, ridge(layer, x / W, landH));
          g.lineTo(W + 4, landH);
          g.closePath();
          const count = Math.min(layer.trees.length, Math.round(W * d.density));
          for (let i = 0; i < count; i++) {
            const tr = layer.trees[i];
            const h = landH * (d.treeMin + (d.treeMax - d.treeMin) * tr.s);
            spruce(g, tr.x * W, ridge(layer, tr.x, landH) + 2, h, h * tr.w);
          }
          g.fill();
          if (d.mist) {
            // Дымка ложится только на уже нарисованное — дальние слои светлее к подножию
            const m = g.createLinearGradient(0, landH * (d.base - d.amp), 0, landH * (d.base + 0.35));
            m.addColorStop(0, 'rgba(0,0,0,0)');
            m.addColorStop(1, d.mist);
            g.globalCompositeOperation = 'source-atop';
            g.fillStyle = m;
            g.fillRect(0, 0, W, landH);
          }
        }
        g.globalCompositeOperation = 'source-over';
      }

      function drawStars(ctx, t) {
        ctx.fillStyle = '#d6e4ff';
        for (let i = 0; i < STAR_COUNT; i++) {
          const a = starBase[i] * (0.62 + 0.38 * Math.sin(starPhase[i] + t * starSpeed[i]));
          const s = starSize[i];
          if (i >= STAR_COUNT - GLOW_STARS) {
            ctx.globalAlpha = a * 0.9;
            ctx.drawImage(glow, starX[i] + s * 0.5 - 8, starY[i] + s * 0.5 - 8, 16, 16);
          }
          ctx.globalAlpha = a;
          ctx.fillRect(starX[i], starY[i], s, s);
        }
      }

      // Занавес — лента в перспективе: полосы сгущаются в складках, там сияние ярче.
      function drawCurtain(ctx, c, t, gain, swell) {
        const d = c.def, p = c.p, n = d.n;
        const span = W * 1.3, left = -W * 0.15, du = 1 / (n - 1);
        const r1 = d.fold, r2 = d.fold * 0.45;
        const k1 = d.k, k2 = d.k * 2.3;
        const a1 = (r1 * span) / k1, a2 = (r2 * span) / k2;
        const depth = d.depth * H, hBase = d.h * H * swell;
        // Медленные приливы и отливы яркости всего занавеса (минуты)
        const activity = 0.72 + 0.18 * Math.sin(t * 0.041 + p[4]) + 0.1 * Math.sin(t * 0.017 + p[5]);
        const base = d.alpha * activity * gain;
        for (let i = 0; i < n; i++) {
          const u = i * du;
          const f1 = k1 * u + t * d.speed + p[0];
          const f2 = k2 * u - t * d.speed * 1.37 + p[1];
          const c1 = Math.cos(f1), c2 = Math.cos(f2);
          const stretch = 1 + r1 * c1 + r2 * c2; // локальный шаг полос относительно среднего
          const w = 2 * span * du * stretch;
          const x = left + span * u + a1 * Math.sin(f1) + a2 * Math.sin(f2);
          if (x + w * 0.5 < 0 || x - w * 0.5 > W) continue;
          // Лучи: две встречные волны вдоль ленты плюс лёгкое собственное мерцание каждой полосы
          const ray = 0.6 + 0.2 * Math.sin(u * 31 + t * 0.09 + p[2]) + 0.13 * Math.sin(u * 57 - t * 0.13 + p[7]) + 0.07 * Math.sin(c.shimmerPhase[i] + t * c.shimmerSpeed[i]);
          const env = 0.66 + 0.34 * Math.sin(u * 3.3 - t * 0.06 + p[3]);
          const alpha = base * ray * env * (0.45 + 0.55 / stretch);
          if (alpha < 0.004) continue;
          const h = hBase * c.rayLen[i] * (0.8 + 0.2 * Math.sin(u * 6.1 + t * 0.07 + p[6]));
          const y = (d.y + d.slope * (u - 0.5)) * H + depth * c1 + depth * 0.4 * c2;
          ctx.globalAlpha = alpha < 0.45 ? alpha : 0.45; // потолок яркости — фон не спорит с интерфейсом
          ctx.drawImage(c.sprite, x - w * 0.5, y - h, w, h);
        }
        return activity;
      }

      return {
        resize(width, height) {
          W = Math.max(1, +width || 0);
          H = Math.max(1, +height || 0);
          landH = Math.min(clamp(H * 0.17, 60, 170), H * 0.4);
          renderLand();
          // Полноэкранные градиенты создаются здесь, а не в кадре
          const g = land.getContext('2d');
          skyFill = g.createLinearGradient(0, 0, 0, H);
          skyFill.addColorStop(0, '#03040d');
          skyFill.addColorStop(0.45, '#050b1c');
          skyFill.addColorStop(0.8, '#071a2a');
          skyFill.addColorStop(1, '#0a2a33');
          glowFill = g.createLinearGradient(0, H * 0.45, 0, H - landH * 0.6);
          glowFill.addColorStop(0, 'rgba(25,120,105,0)');
          glowFill.addColorStop(1, 'rgba(25,120,105,0.15)');
          const starZone = H - landH * 0.5;
          for (let i = 0; i < STAR_COUNT; i++) {
            starX[i] = Math.round(starFx[i] * W * 2) / 2;
            starY[i] = Math.round(starFy[i] * starZone * 2) / 2;
          }
        },

        frame(ctx, t, dt, breath) {
          t = +t || 0;
          const step = dt > 0 ? dt : 0;
          // Без занятия сияние «дышит» само, очень слабо
          const target = breath && breath.running ? clamp(+breath.level || 0, 0, 1) : 0.4 + 0.12 * Math.sin(t * 0.3);
          lvl += (target - lvl) * (1 - Math.exp(-2.5 * step));
          const gain = 0.9 + 0.13 * lvl; // яркость ±7 %
          const swell = 1 + 0.05 * lvl; // лучи чуть вытягиваются на вдохе

          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = skyFill;
          ctx.fillRect(0, 0, W, H);
          drawStars(ctx, t);

          ctx.globalCompositeOperation = 'lighter';
          let activity = 0;
          for (let i = 0; i < curtains.length; i++) activity += drawCurtain(ctx, curtains[i], t, gain, swell);
          // Отсвет сияния над горизонтом
          ctx.globalAlpha = clamp((0.35 + 0.65 * (activity / curtains.length)) * gain, 0, 1);
          ctx.fillStyle = glowFill;
          ctx.fillRect(0, H * 0.45, W, H * 0.55);

          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.drawImage(land, 0, H - landH, W, landH);
        },
      };
    },
  });
})(typeof self !== 'undefined' ? self : globalThis);
