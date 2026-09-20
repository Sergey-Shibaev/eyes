// Фон «Под водой»: лучи с поверхности, стайки рыб, пузырьки, планктон и водоросли по углам.
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const SEG = 8; // сегментов в стебле водоросли
  // Толща воды сверху вниз: [позиция, r, g, b]. Верх нарочно приглушён — поверх лежит светлый текст
  const WATER = [[0, 11, 74, 86], [0.3, 10, 61, 82], [0.65, 8, 43, 74], [1, 8, 32, 63]];
  const SUN_GLOW = 0.16; // сила пятна света у поверхности
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate); // доля сближения за кадр, не зависит от fps

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Наполняет градиент остановками [позиция, цвет, ...] и делает его текущей заливкой
  function useGradient(g, grad, stops) {
    for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
    g.fillStyle = grad;
  }

  // Луч света: веер с мягкими краями, гаснущий книзу
  function makeRaySprite() {
    const w = 96, h = 256, c = makeCanvas(w, h), g = c.getContext('2d');
    const profile = [0, 0, 0.2, 0.1, 0.36, 0.55, 0.5, 1, 0.64, 0.55, 0.8, 0.1, 1, 0];
    for (let i = 1; i < profile.length; i += 2) profile[i] = `rgba(150,235,222,${profile[i]})`;
    useGradient(g, g.createLinearGradient(0, 0, w, 0), profile);
    for (let y = 0; y < h; y++) {
      const f = 0.3 + 0.7 * (y / h); // книзу шире
      g.setTransform(f, 0, 0, 1, (w * (1 - f)) / 2, 0);
      g.fillRect(0, y, w, 1);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    useGradient(g, g.createLinearGradient(0, 0, 0, h), [0, 'rgba(0,0,0,1)', 0.4, 'rgba(0,0,0,0.55)', 1, 'rgba(0,0,0,0)']);
    g.fillRect(0, 0, w, h);
    return c;
  }

  // Пузырёк: прозрачная середина, светлый ободок и блик
  function makeBubbleSprite() {
    const s = 48, r = s / 2, c = makeCanvas(s, s), g = c.getContext('2d');
    useGradient(g, g.createRadialGradient(r, r, r * 0.2, r, r, r - 1),
      [0, 'rgba(190,240,238,0.03)', 0.72, 'rgba(190,240,238,0.12)', 0.93, 'rgba(215,250,248,0.6)', 1, 'rgba(215,250,248,0)']);
    g.fillRect(0, 0, s, s);
    useGradient(g, g.createRadialGradient(r * 0.66, r * 0.6, 0, r * 0.66, r * 0.6, r * 0.32), [0, 'rgba(255,255,255,0.8)', 1, 'rgba(255,255,255,0)']);
    g.fillRect(0, 0, s, s);
    return c;
  }

  // Мягкая точка для планктона
  function makeDotSprite() {
    const s = 32, r = s / 2, c = makeCanvas(s, s), g = c.getContext('2d');
    useGradient(g, g.createRadialGradient(r, r, 0, r, r, r), [0, 'rgba(200,240,232,1)', 0.4, 'rgba(200,240,232,0.42)', 1, 'rgba(200,240,232,0)']);
    g.fillRect(0, 0, s, s);
    return c;
  }

  // Силуэт рыбки носом вправо, спинка чуть подсвечена сверху
  function makeFishSprite() {
    const c = makeCanvas(64, 32), g = c.getContext('2d');
    useGradient(g, g.createLinearGradient(0, 4, 0, 28), [0, 'rgb(52,120,128)', 0.45, 'rgb(8,38,52)', 1, 'rgb(3,18,30)']);
    g.beginPath();
    g.moveTo(62, 16);
    g.quadraticCurveTo(44, -1, 18, 13);
    g.lineTo(3, 4);
    g.quadraticCurveTo(9, 16, 3, 28);
    g.lineTo(18, 19);
    g.quadraticCurveTo(44, 33, 62, 16);
    g.closePath();
    g.fill();
    return c;
  }

  function create() {
    const raySprite = makeRaySprite();
    const bubbleSprite = makeBubbleSprite();
    const dotSprite = makeDotSprite();
    const fishSprite = makeFishSprite();
    const bg = makeCanvas(2, 2); // запечённая толща воды
    const px = new Float32Array(SEG + 1), py = new Float32Array(SEG + 1), pw = new Float32Array(SEG + 1);
    let W = 0, H = 0, unit = 1, breathS = 0, cur = 0, clusterIn = rand(2, 5), seeded = false;

    const rays = [];
    for (let i = 0; i < 5; i++) {
      rays.push({ u: -0.05 + i * 0.26 + rand(-0.06, 0.06), wide: rand(0.35, 0.65), len: rand(0.9, 1.2), a: rand(0.11, 0.19),
        s1: rand(0.09, 0.17), s2: rand(0.23, 0.37), sway: rand(0.1, 0.18), ph: rand(0, TAU) });
    }

    // Планктон: сначала дальний (мелкий), в конце ближний (крупный, размытый)
    const FAR = 17, plankton = [];
    for (let i = 0; i < 24; i++) {
      const near = i >= FAR;
      plankton.push({ u: rand(0, 1), v: rand(0, 1), z: near ? rand(0.9, 1.3) : rand(0.25, 0.7), size: near ? rand(7, 13) : rand(2, 4),
        a: near ? rand(0.07, 0.13) : rand(0.3, 0.6), sink: rand(1.5, 3.5), f: rand(0.2, 0.5), tw: rand(0.3, 0.8), ph: rand(0, TAU) });
    }

    const bubbles = [];
    for (let i = 0; i < 20; i++) bubbles.push({ on: false, x: 0, y: 0, r: 1, vy: 1, amp: 0, freq: 1, ph: 0, a: 0 });

    // Три стайки на разной глубине: дальняя мельче, бледнее и медленнее
    const schools = [0.45, 0.72, 1].map((z, i) => {
      const n = 5 + i + Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? -1 : 1, fish = [];
      for (let k = 0; k < n; k++) {
        fish.push({ ox: ((k + rand(0.15, 0.85)) / n) * 2 - 1, oy: rand(-1, 1), size: rand(0.8, 1.15), k: rand(0.9, 1.6),
          f1: rand(0.3, 0.6), p1: rand(0, TAU), f2: rand(0.25, 0.5), p2: rand(0, TAU), x: 0, y: 0, face: dir, snap: true });
      }
      return { z, fish, dir, vel: dir, u: rand(-0.1, 1.1), v: 0.2 + i * 0.21 + rand(-0.03, 0.03), edge: rand(-0.2, 0.3),
        speed: 8 + 10 * z, len: 12 + 10 * z, alpha: 0.24 + 0.4 * z, ph: rand(0, TAU) };
    });

    const weeds = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2, front = (i >> 1) % 2, u = rand(-0.05, 1);
      weeds.push({ side, front, u, h: (0.3 - 0.14 * u) * rand(0.7, 1.05), w: rand(3, 5) + front * 1.5, lean: (side ? -1 : 1) * rand(0.05, 0.22),
        amp: rand(0.09, 0.16), sp: rand(0.32, 0.55), ph: rand(0, TAU) });
    }

    // Статичная толща воды запекается один раз на размер: градиент, свет сверху, затемнение по краям.
    // Считаем попиксельно и подмешиваем шум в пол-уровня яркости: тёмные плавные переходы без него идут полосами
    function bake() {
      const s = Math.min(1, 640 / Math.max(W, H));
      const w = (bg.width = Math.max(2, Math.ceil(W * s))), h = (bg.height = Math.max(2, Math.ceil(H * s)));
      const g = bg.getContext('2d'), img = g.createImageData(w, h), d = img.data;
      const sunX = w * 0.3, sunY = -h * 0.08, sunR = Math.max(w, h * 0.6) * 0.95;
      const midX = w / 2, midY = h * 0.45, diag = Math.sqrt(w * w + h * h);
      for (let y = 0, o = 0; y < h; y++) {
        const v = y / (h - 1);
        let i = 0;
        while (i < WATER.length - 2 && v > WATER[i + 1][0]) i++;
        const a = WATER[i], b = WATER[i + 1], k = (v - a[0]) / (b[0] - a[0]);
        const r0 = a[1] + (b[1] - a[1]) * k, g0 = a[2] + (b[2] - a[2]) * k, b0 = a[3] + (b[3] - a[3]) * k;
        for (let x = 0; x < w; x++, o += 4) {
          const sun = SUN_GLOW * Math.max(0, 1 - Math.sqrt((x - sunX) * (x - sunX) + (y - sunY) * (y - sunY)) / sunR);
          const dark = 0.45 * clamp((Math.sqrt((x - midX) * (x - midX) + (y - midY) * (y - midY)) / diag - 0.3) / 0.32, 0, 1);
          const n = Math.random() - 0.5; // Uint8ClampedArray округляет сам — получается честный дизеринг
          d[o] = (r0 + (110 - r0) * sun) * (1 - dark) + 2 * dark + n;
          d[o + 1] = (g0 + (215 - g0) * sun) * (1 - dark) + 8 * dark + n;
          d[o + 2] = (b0 + (200 - b0) * sun) * (1 - dark) + 22 * dark + n;
          d[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }

    function spawnCluster(y0) {
      const cx = rand(0.06, 0.94) * W;
      let n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < bubbles.length && n > 0; i++) {
        const b = bubbles[i];
        if (b.on) continue;
        b.on = true;
        b.r = rand(1.4, 5) * unit;
        b.x = cx + rand(-14, 14) * unit;
        b.y = y0 + rand(0, 120); // разнос по высоте вместо задержек
        b.vy = 15 + b.r * 4.5; // крупные всплывают быстрее
        b.amp = rand(1.5, 5) * unit;
        b.freq = rand(1.1, 2.2);
        b.ph = rand(0, TAU);
        b.a = rand(0.35, 0.65);
        n--;
      }
    }

    function drawRays(ctx, t) {
      for (let i = 0; i < rays.length; i++) {
        const r = rays[i];
        const u = r.u + 0.05 * Math.sin(t * 0.021 + r.ph);
        const w = r.wide * (W * 0.5 + 200) * (1 + 0.05 * breathS);
        ctx.save();
        ctx.translate(u * W, -H * 0.06);
        ctx.rotate(-(u - 0.3) * 0.5 + 0.045 * Math.sin(t * r.sway + r.ph * 2)); // веером от «солнца» слева сверху
        ctx.globalAlpha = r.a * (1 + 0.15 * breathS) * (0.62 + 0.25 * Math.sin(t * r.s1 + r.ph) + 0.13 * Math.sin(t * r.s2 + r.ph * 3));
        ctx.drawImage(raySprite, -w / 2, 0, w, r.len * H);
        ctx.restore();
      }
    }

    function drawPlankton(ctx, t, dt, from, to) {
      for (let i = from; i < to; i++) {
        const p = plankton[i];
        p.u += ((1.5 + cur * 4) * p.z * unit * dt) / W;
        p.v += (p.sink * p.z * unit * dt) / H;
        if (p.u > 1.06) p.u -= 1.12; else if (p.u < -0.06) p.u += 1.12;
        if (p.v > 1.06) p.v -= 1.12;
        const d = p.size * unit;
        const x = p.u * W + Math.sin(t * p.f + p.ph) * 5 * p.z;
        const y = p.v * H - breathS * 6 * p.z; // на вдохе вода чуть приподнимается
        ctx.globalAlpha = p.a * (0.65 + 0.35 * Math.sin(t * p.tw + p.ph * 3));
        ctx.drawImage(dotSprite, x - d / 2, y - d / 2, d, d);
      }
    }

    function drawBubbles(ctx, t, dt) {
      clusterIn -= dt;
      if (clusterIn <= 0) {
        clusterIn = rand(6, 11);
        spawnCluster(H + 10);
      }
      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        if (!b.on) continue;
        b.y -= b.vy * dt;
        b.x += cur * 2.5 * dt;
        const fade = clamp((b.y - H * 0.05) / (H * 0.2), 0, 1); // тают у поверхности
        if (fade <= 0) { b.on = false; continue; }
        const r = b.r * (1.3 - 0.3 * clamp(b.y / H, 0, 1)); // всплывая, немного растут
        const x = b.x + Math.sin(t * b.freq + b.ph) * b.amp;
        ctx.globalAlpha = b.a * fade * fade * (3 - 2 * fade);
        ctx.drawImage(bubbleSprite, x - r, b.y - r, r * 2, r * 2);
      }
    }

    function drawSchool(ctx, s, t, dt) {
      const beyond = s.edge * Math.min(W, 450), spd = s.speed * unit;
      let cx = s.u * W;
      if (s.dir > 0 && cx > W + beyond) { s.dir = -1; s.edge = rand(-0.2, 0.3); }
      else if (s.dir < 0 && cx < -beyond) { s.dir = 1; s.edge = rand(-0.2, 0.3); }
      s.vel += (s.dir - s.vel) * ease(dt, 0.35); // плавный разворот
      s.u += (s.vel * spd * dt) / W;
      cx = s.u * W;
      const cy = (s.v + 0.05 * Math.sin(t * 0.07 + s.ph) + 0.03 * Math.sin(t * 0.031 + s.ph * 1.7)) * H - breathS * 3 * s.z;
      const spreadX = (20 + 38 * s.z) * unit, spreadY = (10 + 16 * s.z) * unit;
      ctx.globalAlpha = s.alpha;
      for (let i = 0; i < s.fish.length; i++) {
        const f = s.fish[i];
        const slotX = cx + f.ox * spreadX + Math.sin(t * f.f1 + f.p1) * 6 * s.z * unit;
        const slotY = cy + f.oy * spreadY + Math.sin(t * f.f2 + f.p2) * 4 * unit;
        if (f.snap) { f.x = slotX - (s.vel * spd) / f.k; f.y = slotY; f.face = s.vel; f.snap = false; }
        const vx = (slotX - f.x) * f.k, vy = (slotY - f.y) * f.k; // рыбка догоняет своё место в стае
        const follow = ease(dt, f.k);
        f.x += (slotX - f.x) * follow;
        f.y += (slotY - f.y) * follow;
        f.face += (clamp(vx / (spd * 0.7), -1, 1) - f.face) * ease(dt, 2); // нос смотрит туда, куда плывёт
        if (f.x < -40 || f.x > W + 40) continue;
        const len = s.len * unit * f.size * (1 + 0.04 * Math.sin(t * 5 + f.p1));
        const turn = Math.abs(f.face);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale((f.face < 0 ? -1 : 1) * Math.max(turn, 0.22), 1); // в развороте рыбка видна «с носа»
        ctx.rotate(clamp(vy / Math.max(Math.abs(vx), 5), -0.4, 0.4) * 0.7 * turn);
        ctx.drawImage(fishSprite, -len / 2, -len / 4, len, len / 2);
        ctx.restore();
      }
    }

    // Стебли одного слоя собираются в общий контур и заливаются разом
    function drawWeeds(ctx, t, front) {
      const span = Math.min(W * 0.27, 190 * unit);
      ctx.beginPath();
      for (let n = 0; n < weeds.length; n++) {
        const s = weeds[n];
        if (s.front !== front) continue;
        const rootX = s.side ? W - s.u * span : s.u * span, h = s.h * H;
        const lean = s.lean * (1 + 0.1 * breathS) + cur * 0.04;
        for (let i = 0; i <= SEG; i++) {
          const k = i / SEG;
          const wave = Math.sin(t * s.sp + s.ph - k * 1.8) + 0.5 * Math.sin(t * s.sp * 0.43 + s.ph * 2.1 - k);
          px[i] = rootX + (lean + wave * s.amp) * h * k * k;
          py[i] = H + 6 - k * h;
          pw[i] = s.w * unit * (1 - k * k);
        }
        ctx.moveTo(px[0] - pw[0], py[0]);
        for (let i = 1; i < SEG; i++) {
          ctx.quadraticCurveTo(px[i] - pw[i], py[i], (px[i] - pw[i] + px[i + 1] - pw[i + 1]) / 2, (py[i] + py[i + 1]) / 2);
        }
        ctx.lineTo(px[SEG], py[SEG]);
        for (let i = SEG - 1; i >= 1; i--) {
          ctx.quadraticCurveTo(px[i] + pw[i], py[i], (px[i] + pw[i] + px[i - 1] + pw[i - 1]) / 2, (py[i] + py[i - 1]) / 2);
        }
        ctx.lineTo(px[0] + pw[0], py[0]);
        ctx.closePath();
      }
      ctx.fill();
    }

    function drawMounds(ctx) {
      const span = Math.min(W * 0.27, 190 * unit), top = H - (H * 0.03 + 8);
      for (let side = 0; side < 2; side++) {
        const x0 = side ? W : 0, dir = side ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(x0, H + 2);
        ctx.lineTo(x0, top);
        ctx.quadraticCurveTo(x0 + dir * span * 0.7, top - 6, x0 + dir * span * 1.5, H + 2);
        ctx.closePath();
        ctx.fill();
      }
    }

    return {
      resize(width, height) {
        W = Math.max(0, +width || 0);
        H = Math.max(0, +height || 0);
        if (W < 1 || H < 1) return;
        unit = clamp(Math.min(W, H) / 400, 0.8, 1.5);
        bake();
        for (let i = 0; i < schools.length; i++) for (let k = 0; k < schools[i].fish.length; k++) schools[i].fish[k].snap = true;
        if (!seeded) { // чтобы сцена не начиналась пустой
          seeded = true;
          spawnCluster(rand(0.35, 0.6) * H);
          spawnCluster(rand(0.65, 0.9) * H);
        }
      },

      frame(ctx, t, dt, breath) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (W < 1 || H < 1) { ctx.fillStyle = '#082B4A'; ctx.fillRect(0, 0, 4096, 4096); return; }
        t = +t || 0;
        dt = clamp(+dt || 0, 0, 0.05);
        const level = breath && breath.running ? clamp(+breath.level || 0, 0, 1) : 0;
        breathS += (level - breathS) * ease(dt, 2.5); // сглаживаем, чтобы остановка дыхания не давала скачка
        cur = 0.6 * Math.sin(t * 0.05) + 0.4 * Math.sin(t * 0.023 + 1.3); // медленное течение
        ctx.drawImage(bg, -1, -1, W + 2, H + 2);

        ctx.globalCompositeOperation = 'lighter';
        drawRays(ctx, t);
        drawPlankton(ctx, t, dt, 0, FAR);

        ctx.globalCompositeOperation = 'source-over';
        drawSchool(ctx, schools[0], t, dt);
        drawBubbles(ctx, t, dt);
        drawSchool(ctx, schools[1], t, dt);
        drawSchool(ctx, schools[2], t, dt);

        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(5,24,40,0.9)';
        drawWeeds(ctx, t, 0);
        ctx.fillStyle = '#030D1A';
        drawMounds(ctx);
        drawWeeds(ctx, t, 1);

        ctx.globalCompositeOperation = 'lighter';
        drawPlankton(ctx, t, dt, FAR, plankton.length);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      },
    };
  }

  root.BreathBackgrounds.register({ id: 'underwater', name: 'Под водой', create });
})(typeof self !== 'undefined' ? self : globalThis);
