// Фон «Облака»: вечернее небо, три слоя кучевых облаков с параллаксом,
// ранние звёзды, тёплое зарево у горизонта, тёмные холмы и редкая стая птиц вдали.
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0); // NaN тоже даёт 0
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';

  // Сумеречное небо, стопы [позиция, r, g, b]: индиго сверху -> пыльно-синий -> приглушённо-тёплый горизонт
  const SKY = [
    [0, 7, 9, 24], [0.3, 15, 21, 51], [0.55, 27, 39, 72], [0.75, 47, 53, 86],
    [0.88, 77, 63, 86], [0.96, 106, 74, 80], [1, 122, 82, 72],
  ];

  // Слои от дальнего к ближнему. size и speed — в долях unit, band — высота основания облака в долях экрана,
  // haze — доля цвета неба, подмешанная в краски облака (воздушная дымка: чем дальше слой, тем её больше)
  const LAYERS = [
    { size: 0.42, res: 256, band: [0.66, 0.88], speed: 0.009, haze: 0.42, gap: 0.8, swell: 0.01, lift: 1.5,
      pal: { warm: [172, 116, 100], mid: [106, 84, 106], top: [64, 68, 100] } },
    { size: 0.68, res: 384, band: [0.4, 0.68], speed: 0.016, haze: 0.33, gap: 1.1, swell: 0.018, lift: 3,
      pal: { warm: [150, 102, 104], mid: [90, 80, 112], top: [54, 62, 98] } },
    { size: 1, res: 512, band: [0.12, 0.42], speed: 0.027, haze: 0.2, gap: 1.4, swell: 0.026, lift: 4.5,
      pal: { warm: [124, 92, 106], mid: [76, 72, 108], top: [44, 54, 90] } },
  ];
  const VARIANTS = 4;   // разных спрайтов на слой
  const BASE = 0.74;    // линия плоского основания облака в долях высоты спрайта
  const RIDGE_N = 64;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Цвет неба на высоте f (0 — зенит, 1 — горизонт). Только для create()/resize(): возвращает новый массив
  function skyAt(f) {
    let i = 0;
    while (i < SKY.length - 2 && f > SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], m = clamp01((f - a[0]) / (b[0] - a[0]));
    return [a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m, a[3] + (b[3] - a[3]) * m];
  }

  const mix = (c, to, k) => [0, 1, 2].map((i) => Math.round(c[i] + (to[i] - c[i]) * k));

  // Мягкий круг: цвет c0 до доли inner радиуса, дальше плавно в c1
  function blob(g, x, y, r, inner, c0, c1) {
    const gr = g.createRadialGradient(x, y, r * inner, x, y, r);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  // Спрайт кучевого облака: силуэт из клубов -> общая светотень -> объём каждого клуба -> плоское основание
  function makeCloud(cw, pal) {
    const ch = cw / 2;
    const c = makeCanvas(cw, ch);
    const g = c.getContext('2d');
    const base = ch * BASE;
    const puffs = [];
    const nBase = 6 + ((Math.random() * 4) | 0);
    const nCrown = 2 + ((Math.random() * 4) | 0);
    const lean = rand(0.34, 0.66); // куда смещена вершина
    const skew = Math.log(0.5) / Math.log(lean); // туда же смещаем и «массу» — облака выходят несимметричными и разными
    // Ряд вдоль основания: к вершине клубы крупнее. Шаг между соседями считаем от их радиусов —
    // так ни один клуб не отрывается от тела «бусиной»
    let span = 0, prev = 0;
    for (let i = 0; i < nBase; i++) {
      const f = (i + rand(0.35, 0.65)) / nBase;
      const env = Math.pow(Math.sin(Math.PI * Math.pow(f, skew)), 0.7);
      const r = ch * (0.12 + 0.17 * env * rand(0.75, 1.2));
      if (i) span += (prev + r) * rand(0.48, 0.58);
      prev = r;
      puffs.push({ x: span, y: base - r * rand(0.3, 0.7) * (0.55 + 0.45 * env), r: r }); // крайние ниже
    }
    const fit = Math.min(1.05, (cw * rand(0.56, 0.66)) / span); // ряд укладываем в спрайт; ширина облаков немного разная
    const half = (span * fit) / 2;
    for (const p of puffs) p.x = cw / 2 - half + p.x * fit;
    for (let j = 0; j < nCrown; j++) { // «шапка»: клубы сидят на плечах нижних, без отрыва от тела
      const under = puffs[Math.floor(nBase * (lean + rand(-0.15, 0.15)))]; // только средние клубы, не крайние
      const r = Math.min(ch * 0.25, under.r * rand(0.75, 1.05));
      puffs.push({ x: under.x + under.r * rand(-0.5, 0.5), y: under.y - under.r * rand(0.55, 0.95), r: r });
    }
    for (const p of puffs) { // не вылезаем за края спрайта
      p.x = Math.min(cw - p.r - 2, Math.max(p.r + 2, p.x));
      p.y = Math.max(p.r + 2, p.y);
    }
    puffs.sort((a, b) => a.y - b.y); // верхние сначала, нижние поверх

    // 1. Силуэт: клубы с мягкой кромкой + вытянутое тело вдоль основания, чтобы не было «бусин»
    for (const p of puffs) blob(g, p.x, p.y, p.r, 0.62, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    g.save();
    g.translate(cw / 2 + (lean - 0.5) * half * 0.5, base - ch * 0.13);
    g.scale((half + ch * 0.02) / (ch * 0.21), 1); // тело тянется на всю длину ряда
    blob(g, 0, 0, ch * 0.21, 0.35, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    g.restore();

    // 2. Общая светотень: синеватый верх, тёплый подсвеченный низ
    g.globalCompositeOperation = 'source-in';
    const tone = g.createLinearGradient(0, ch * 0.12, 0, base);
    tone.addColorStop(0, rgba(pal.top, 1));
    tone.addColorStop(0.5, rgba(pal.mid, 1));
    tone.addColorStop(1, rgba(pal.warm, 1));
    g.fillStyle = tone;
    g.fillRect(0, 0, cw, ch);

    // 3. Объём: у каждого клуба тень сверху и тёплый отсвет снизу (только внутри силуэта)
    g.globalCompositeOperation = 'source-atop';
    for (const p of puffs) {
      blob(g, p.x, p.y - p.r * 0.4, p.r * 0.95, 0, rgba(pal.top, 0.34), rgba(pal.top, 0));
      blob(g, p.x, p.y + p.r * 0.32, p.r * 0.9, 0, rgba(pal.warm, 0.34), rgba(pal.warm, 0));
    }

    // 4. Мягко срезаем низ — получается плоское основание
    g.globalCompositeOperation = 'destination-out';
    const cutTop = base - ch * 0.15;
    const cut = g.createLinearGradient(0, cutTop, 0, base + ch * 0.07);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = cut;
    g.fillRect(0, cutTop, cw, ch - cutTop);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  // Небо рисуем один раз в свой холст с шумом в пол-ступени яркости — тёмный градиент без «полос»
  function paintSky(cv, w, h) {
    // Ровно половинное разрешение: при растяжении в целое число раз шум остаётся ровным, без регулярной «сетки»
    const cw = Math.max(1, Math.ceil(w / 2)), ch = Math.max(1, Math.ceil(h / 2));
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d');
    const img = g.createImageData(cw, ch), d = img.data;
    let seed = (Math.random() * 4294967296) >>> 0, p = 0;
    for (let y = 0; y < ch; y++) {
      const row = skyAt(ch > 1 ? y / (ch - 1) : 0);
      for (let x = 0; x < cw; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const n = (seed >>> 8) / 16777216 - 0.5;
        d[p] = row[0] + n;
        d[p + 1] = row[1] + n;
        d[p + 2] = row[2] + n;
        d[p + 3] = 255;
        p += 4;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // Круглое мягкое пятно: для звёзд и зарева
  function makeGlowSprite(size, stops) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const h = size / 2;
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  // Профиль гряды холмов (доли высоты экрана)
  function makeRidge(lo, hi) {
    const pts = new Float32Array(RIDGE_N);
    const p1 = rand(0, TAU), p2 = rand(0, TAU), p3 = rand(0, TAU);
    const mid = (lo + hi) / 2, amp = (hi - lo) / 2;
    for (let i = 0; i < RIDGE_N; i++) {
      const s = 0.6 * Math.sin(i * 0.13 + p1) + 0.28 * Math.sin(i * 0.31 + p2) + 0.12 * Math.sin(i * 0.74 + p3);
      pts[i] = mid + amp * s;
    }
    return pts;
  }

  BreathBackgrounds.register({
    id: 'clouds',
    name: 'Облака',
    create() {
      let W = 0, H = 0, unit = 1;
      const sky = makeCanvas(1, 1); // готовое небо, перерисовывается только в resize
      let eased = 0.3;  // сглаженное дыхание
      let drift = 0;    // накопленная фаза порывов ветра

      // Дымка запечена в краски спрайта, а не задаётся прозрачностью: облако рисуется плотным,
      // сквозь него не просвечивают звёзды, а перекрытия облаков не дают светлых «линз».
      // У каждого варианта своя полоса высот внутри band — дымка берёт цвет неба именно оттуда
      const sprites = LAYERS.map((L) => {
        const list = [];
        for (let i = 0; i < VARIANTS; i++) {
          const air = skyAt(L.band[0] + ((L.band[1] - L.band[0]) * (i + 0.5)) / VARIANTS - 0.04);
          const k = L.haze * rand(0.85, 1.15); // облака одного слоя чуть разные по тону
          list.push(makeCloud(L.res, { warm: mix(L.pal.warm, air, k), mid: mix(L.pal.mid, air, k), top: mix(L.pal.top, air, k) }));
        }
        return list;
      });
      const starSprite = makeGlowSprite(24, [[0, 'rgba(228,232,255,1)'], [0.25, 'rgba(200,212,255,0.5)'], [1, 'rgba(180,200,255,0)']]);
      const glowSprite = makeGlowSprite(256, [[0, 'rgba(214,138,98,0.55)'], [0.45, 'rgba(170,96,96,0.25)'], [1, 'rgba(150,90,100,0)']]);
      const ridgeFar = makeRidge(0.05, 0.085);
      const ridgeNear = makeRidge(0.025, 0.055);

      // Ранние звёзды: гуще к зениту, гаснут к середине экрана
      const stars = [];
      for (let i = 0; i < 28; i++) {
        const v = Math.pow(Math.random(), 1.5) * 0.5;
        stars.push({ u: Math.random(), v: v, r: rand(1.3, 3), a: rand(0.35, 0.8) * Math.pow(1 - v / 0.55, 0.7), sp: rand(0.4, 1.1), ph: rand(0, TAU) });
      }

      const clouds = LAYERS.map(() => []); // состояние облаков по слоям (u, v — в долях экрана)

      // Стая птиц: пул создан заранее, в кадре ничего не выделяем
      const flock = { active: false, wait: rand(14, 30), x: 0, v: 0.6, dir: 1, n: 5 };
      const birds = [];
      for (let i = 0; i < 7; i++) birds.push({ dx: 0, dy: 0, s: 5, ph: 0 });

      const lastVariant = LAYERS.map(() => 0);

      function seedCloud(c, li) {
        const L = LAYERS[li];
        // Никогда не тот же спрайт, что у соседа по очереди — рядом не окажется двух одинаковых облаков
        const vi = (lastVariant[li] + 1 + ((Math.random() * (VARIANTS - 1)) | 0)) % VARIANTS;
        lastVariant[li] = vi;
        c.img = sprites[li][vi];
        c.v = L.band[0] + ((L.band[1] - L.band[0]) * (vi + Math.random())) / VARIANTS;
        c.s = rand(0.8, 1.25);
        c.ph = rand(0, TAU);
      }

      function layoutLayer(li) {
        const L = LAYERS[li], list = clouds[li];
        const w0 = L.size * unit;
        const count = Math.max(2, Math.ceil((W + w0) / (w0 * L.gap)));
        if (list.length === count) return; // мелкая смена размера — облака остаются на местах
        list.length = 0;
        const slot = (W + w0) / count;
        for (let k = 0; k < count; k++) {
          const c = { u: 0, v: 0, s: 1, img: null, ph: 0 };
          seedCloud(c, li);
          c.u = (-w0 * c.s + (k + rand(0.15, 0.85)) * slot) / W;
          list.push(c);
        }
      }

      // Ушедшее за правый край облако встаёт в хвост очереди слева за экраном
      function respawn(c, li, list, slot) {
        let left = 0;
        for (let k = 0; k < list.length; k++) {
          const x = list[k].u * W;
          if (list[k] !== c && x < left) left = x;
        }
        seedCloud(c, li);
        const w = LAYERS[li].size * unit * c.s;
        c.u = Math.min(left - slot * rand(0.7, 1.2), -w - 6) / W;
      }

      function drawLayer(ctx, li, t, b, step) {
        const L = LAYERS[li], list = clouds[li];
        const w0 = L.size * unit;
        const slot = (W + w0) / list.length;
        const grow = 1 + L.swell * b; // облака чуть «набухают» на вдохе
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          c.u += (L.speed * step) / W;
          if (c.u * W > W + 8) respawn(c, li, list, slot);
          const w = w0 * c.s * grow, h = w * 0.5;
          const x = c.u * W - (w - w0 * c.s) * 0.5;
          const y = c.v * H - h * BASE + Math.sin(t * 0.07 + c.ph) * 3 - b * L.lift;
          if (x > W || x + w < 0) continue;
          ctx.globalAlpha = 0.95 + 0.05 * b; // почти непрозрачно: звёзды за облаком не видны
          ctx.drawImage(c.img, x, y, w, h);
        }
      }

      function launchFlock() {
        const k = unit / 412;
        flock.active = true;
        flock.dir = Math.random() < 0.7 ? 1 : -1;
        flock.n = 4 + ((Math.random() * 4) | 0);
        flock.v = rand(0.56, 0.78);
        flock.x = flock.dir > 0 ? -10 : W + 10;
        for (let i = 0; i < flock.n; i++) { // клин: вожак впереди, остальные по двум сторонам
          const row = (i + 1) >> 1, side = i % 2 ? 1 : -1, bd = birds[i];
          bd.dx = -flock.dir * row * rand(9, 13) * k;
          bd.dy = side * row * rand(4, 7) * k + rand(-2, 2);
          bd.s = rand(3.6, 5.2) * Math.max(0.8, k);
          bd.ph = rand(0, TAU);
        }
      }

      function drawFlock(ctx, t, dt) {
        if (!flock.active) {
          flock.wait -= dt;
          if (flock.wait <= 0) launchFlock();
          return;
        }
        flock.x += flock.dir * 0.04 * unit * dt;
        if (flock.x < -80 || flock.x > W + 80) {
          flock.active = false;
          flock.wait = rand(45, 110);
          return;
        }
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#0C0E1E';
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < flock.n; i++) {
          const bd = birds[i], s = bd.s;
          const x = flock.x + bd.dx;
          const y = flock.v * H + bd.dy + Math.sin(t * 0.5 + bd.ph) * 1.5;
          const tip = -s * (0.1 + 0.35 * Math.sin(t * 2.4 + bd.ph)); // неторопливый взмах
          ctx.moveTo(x - s, y + tip);
          ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.28, x, y);
          ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.28, x + s, y + tip);
        }
        ctx.stroke();
      }

      function drawRidge(ctx, pts, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let i = 0; i < RIDGE_N; i++) ctx.lineTo((i / (RIDGE_N - 1)) * W, H - pts[i] * H);
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
      }

      return {
        resize(width, height) {
          const w = width > 0 && isFinite(width) ? width : 0;
          const h = height > 0 && isFinite(height) ? height : 0;
          if (w && h && (w !== W || h !== H)) paintSky(sky, w, h);
          W = w;
          H = h;
          if (!W || !H) return;
          unit = Math.min(W, H * 0.62);
          for (let i = 0; i < LAYERS.length; i++) layoutLayer(i);
        },

        frame(ctx, t, dt, breath) {
          if (!W || !H) return;
          if (!(dt > 0)) dt = 0;
          if (!(t >= 0)) t = 0;

          // Дыхание сглаживаем; в покое небо «дышит» само, едва заметно
          const target = breath && breath.running ? clamp01(+breath.level) : 0.35 + 0.2 * Math.sin(t * 0.45);
          eased += (target - eased) * (1 - Math.exp(-dt * 1.4));
          const b = eased;

          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.drawImage(sky, 0, 0, sky.width * 2, sky.height * 2); // непрозрачное небо закрывает весь холст (растяжение ровно вдвое)

          // Звёзды: медленное мерцание, чуть ярче на вдохе
          for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(t * s.sp + s.ph)) * (0.88 + 0.12 * b);
            ctx.drawImage(starSprite, s.u * W - s.r, s.v * H - s.r, s.r * 2, s.r * 2);
          }

          // Зарево у горизонта теплеет на вдохе
          const gw = W * 1.7, gh = H * 0.36;
          ctx.globalAlpha = 0.56 + 0.08 * b;
          ctx.drawImage(glowSprite, W * 0.42 - gw / 2, H * 0.95 - gh / 2, gw, gh);

          // Ветер слегка меняется со временем; step — общий сдвиг в пикселях на единицу скорости
          drift += dt * 0.021;
          const step = unit * dt * (1 + 0.18 * Math.sin(drift));

          drawLayer(ctx, 0, t, b, step);
          drawFlock(ctx, t, dt);
          drawLayer(ctx, 1, t, b, step);
          drawLayer(ctx, 2, t, b, step);

          ctx.globalAlpha = 1;
          drawRidge(ctx, ridgeFar, '#231E36');
          drawRidge(ctx, ridgeNear, '#0A0B19');
        },
      };
    },
  });
})();
