// Фон «Мыльные пузыри»: тёмная морская зелень, плавающая дымка и пузыри,
// которые медленно опускаются, покачиваются и изредка лопаются.
// Пузыри и дымка заранее нарисованы в спрайты; в кадре только drawImage и пара дуг.
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const MAX_BUBBLES = 40;
  const MAX_DROPS = 24;
  const HUES = [170, 200, 240, 280, 315]; // оттенки радужной каймы; жёлтого избегаем — это цвет интерфейса
  const LODS = [64, 128, 256];            // размеры спрайтов: дальним пузырям хватает маленьких
  const POP_TIME = 0.7;                   // длительность хлопка, с: мягкий «пф», а не вспышка
  const PALE = '#d4f3ee';                 // цвет кольца хлопка и брызг

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOut = (p) => 1 - (1 - p) * (1 - p) * (1 - p);
  // Кромка ярче со стороны света (слева сверху) и напротив него
  const lightAt = (a) => 0.5 + 0.5 * Math.cos(2 * (a - Math.PI * 1.25));
  const hsla = (h, s, l, a) => `hsla(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%,${a.toFixed(3)})`;

  function makeCanvas(size) {
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    return cv;
  }

  // Кольцо с цветом, зависящим от угла: конический градиент, а где его нет — короткие дуги
  function strokeRing(g, c, radius, width, colorAt) {
    const N = 48;
    g.lineWidth = width;
    if (typeof g.createConicGradient === 'function') {
      const grad = g.createConicGradient(0, c, c);
      for (let i = 0; i <= N; i++) grad.addColorStop(i / N, colorAt((i / N) * TAU));
      g.strokeStyle = grad;
      g.beginPath();
      g.arc(c, c, radius, 0, TAU);
      g.stroke();
      return;
    }
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      g.strokeStyle = colorAt(a + Math.PI / N);
      g.beginPath();
      g.arc(c, c, radius, a, a + TAU / N + 0.004);
      g.stroke();
    }
  }

  // Мягкий блик, вытянутый вдоль кромки; angle — поворот от направления «вверх»
  function glint(g, c, R, angle, dist, radius, squash, hue, sat, light, alpha) {
    const y = (-dist * R) / squash;
    g.save();
    g.translate(c, c);
    g.rotate(angle);
    g.scale(1, squash);
    const grad = g.createRadialGradient(0, y, 0, 0, y, radius * R);
    grad.addColorStop(0, hsla(hue, sat, light, alpha));
    grad.addColorStop(0.5, hsla(hue, sat, light, alpha * 0.35));
    grad.addColorStop(1, hsla(hue, sat, light, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, y, radius * R, 0, TAU);
    g.fill();
    g.restore();
  }

  // Спрайт пузыря: почти прозрачное тело, радужные полосы у края, тонкая кромка, два блика
  function makeBubble(size, hue) {
    const cv = makeCanvas(size);
    const g = cv.getContext('2d');
    const c = size / 2;
    const rimW = 1 + size / 180; // у маленьких спрайтов кромка относительно толще
    const R = c - 2 - rimW;

    const body = g.createRadialGradient(c, c, R * 0.45, c, c, R);
    body.addColorStop(0, hsla(hue, 60, 75, 0));
    body.addColorStop(0.7, hsla(hue, 60, 75, 0.05));
    body.addColorStop(1, hsla(hue, 70, 78, 0.2));
    g.fillStyle = body;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();

    // радужная плёнка у края: широкое цветное кольцо, плавно стёртое внутрь маской
    const bandW = R * 0.26;
    const film = makeCanvas(size);
    const f = film.getContext('2d');
    strokeRing(f, c, R - bandW / 2, bandW, (a) => hsla(hue + 60 * Math.sin(a * 2), 85, 68, 0.14 + 0.16 * lightAt(a)));
    const mask = f.createRadialGradient(c, c, R - bandW, c, c, R);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(0.55, 'rgba(0,0,0,0.2)');
    mask.addColorStop(0.85, 'rgba(0,0,0,0.6)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    f.globalCompositeOperation = 'destination-in';
    f.fillStyle = mask;
    f.fillRect(0, 0, size, size);
    g.drawImage(film, 0, 0);

    strokeRing(g, c, R, rimW, (a) => hsla(hue + 55 * Math.sin(a * 2 + 2), 90, 82, 0.3 + 0.5 * lightAt(a)));

    glint(g, c, R, -Math.PI / 4, 0.62, 0.42, 0.45, 0, 0, 100, 0.5);         // главный блик слева сверху
    glint(g, c, R, -Math.PI / 4 - 0.42, 0.7, 0.085, 1, 0, 0, 100, 0.8);      // яркая искра рядом
    glint(g, c, R, Math.PI * 0.75, 0.7, 0.3, 0.4, hue + 40, 80, 82, 0.24);   // отражение справа снизу
    return { img: cv, k: c / R }; // k — во сколько раз спрайт шире самого пузыря
  }

  function makeHaze() {
    const size = 256;
    const cv = makeCanvas(size);
    const g = cv.getContext('2d');
    const c = size / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(64,172,166,1)');
    grad.addColorStop(0.4, 'rgba(64,172,166,0.5)');
    grad.addColorStop(0.75, 'rgba(64,172,166,0.12)');
    grad.addColorStop(1, 'rgba(64,172,166,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  }

  let assets = null; // спрайты общие для всех экземпляров фона
  function getAssets() {
    if (!assets) assets = { haze: makeHaze(), sprites: HUES.map((hue) => LODS.map((size) => makeBubble(size, hue))) };
    return assets;
  }

  BreathBackgrounds.register({
    id: 'bubbles',
    name: 'Мыльные пузыри',
    create() {
      const { haze, sprites } = getAssets();
      const bubbles = [];
      const drops = [];
      let w = 0, h = 0, scale = 1;
      let bgFill = null, glowFill = null;
      let time = 0;            // собственные часы: движение не дёргается при паузах
      let lvl = 0;             // сглаженное дыхание
      let nextPop = rand(4, 8);

      for (let i = 0; i < MAX_BUBBLES; i++) {
        const depth = (i + Math.random()) / MAX_BUBBLES; // массив сразу упорядочен: дальние рисуются первыми
        bubbles.push({
          rank: (i * 17) % MAX_BUBBLES, // на маленьком экране прореживаем все слои равномерно
          active: false,
          depth,
          par: 0.35 + 0.65 * depth,     // параллакс: ближние движутся заметнее
          alpha: 0.3 + 0.55 * depth,
          r0: clamp((10 + 60 * Math.pow(depth, 2.6)) * rand(0.88, 1.12), 10, 70),
          r: 10, x: 0, y: 0, hue: 0, spr: sprites[0][0],
          fall: rand(9, 15), drift: rand(-2.5, 2.5),
          wobAmp: rand(6, 16), wobFreq: rand(0.12, 0.3),
          sqAmp: 0.01 + 0.02 * depth, sqFreq: rand(0.5, 0.9),
          ph: rand(0, TAU),
          pop: -1,                      // -1 — цел, 0..1 — лопается
        });
      }
      for (let i = 0; i < MAX_DROPS; i++) drops.push({ life: 0, ttl: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1, alpha: 0 });

      const posX = (b) => b.x + Math.sin(time * b.wobFreq + b.ph) * b.wobAmp;
      const posY = (b) => b.y + Math.cos(time * b.wobFreq * 0.7 + b.ph) * b.wobAmp * 0.4;

      function dress(b) {
        b.spr = sprites[b.hue][b.r <= 20 ? 0 : b.r <= 40 ? 1 : 2];
      }

      // Новый пузырь появляется из-за верхнего края, иногда с задержкой
      function toTop(b, delay) {
        b.pop = -1;
        b.x = rand(0, w);
        b.y = -b.r * 1.3 - b.wobAmp - rand(0, delay);
        b.hue = (Math.random() * HUES.length) | 0;
        dress(b);
      }

      function buildFills(ctx) {
        bgFill = ctx.createLinearGradient(0, 0, 0, h);
        bgFill.addColorStop(0, '#0C3F40');
        bgFill.addColorStop(0.55, '#093133');
        bgFill.addColorStop(1, '#051F22');
        // свет слева сверху и затемнение к дальним углам — одной заливкой
        glowFill = ctx.createRadialGradient(w * 0.28, h * 0.12, 0, w * 0.28, h * 0.12, Math.hypot(w, h) * 0.95);
        glowFill.addColorStop(0, 'rgba(70,178,170,0.13)');
        glowFill.addColorStop(0.45, 'rgba(70,178,170,0.05)');
        glowFill.addColorStop(0.7, 'rgba(3,18,20,0)');
        glowFill.addColorStop(1, 'rgba(3,18,20,0.38)');
      }

      // Лопаем один из видимых пузырей; из нескольких случайных берём тот, что ниже
      function tryPop() {
        let best = null;
        for (let k = 0; k < 6; k++) {
          const b = bubbles[(Math.random() * MAX_BUBBLES) | 0];
          if (!b.active || b.pop >= 0 || b.depth < 0.25) continue;
          if (b.x < b.r || b.x > w - b.r || b.y < b.r || b.y > h - b.r) continue;
          if (!best || b.y > best.y) best = b;
        }
        if (!best) return false;
        best.pop = 0;
        const x = posX(best), y = posY(best);
        const n = 5 + ((Math.random() * 4) | 0);
        const base = rand(0, TAU);
        for (let i = 0, j = 0; i < MAX_DROPS && j < n; i++) {
          const d = drops[i];
          if (d.life > 0) continue;
          const a = base + (j / n) * TAU + rand(-0.3, 0.3);
          const speed = rand(22, 55) * best.par * scale;
          d.x = x + Math.cos(a) * best.r * 0.85;
          d.y = y + Math.sin(a) * best.r * 0.85;
          d.vx = Math.cos(a) * speed;
          d.vy = Math.sin(a) * speed - 6;
          d.size = rand(0.8, 1.9) * (0.6 + 0.5 * best.depth);
          d.alpha = best.alpha * 0.7;
          d.life = d.ttl = rand(0.7, 1.2);
          j++;
        }
        return true;
      }

      return {
        resize(width, height) {
          const nw = width > 0 && Number.isFinite(+width) ? +width : 0;
          const nh = height > 0 && Number.isFinite(+height) ? +height : 0;
          const fresh = w < 1 || h < 1;
          const kx = fresh ? 1 : nw / w;
          const ky = fresh ? 1 : nh / h;
          w = nw;
          h = nh;
          bgFill = glowFill = null; // градиенты пересоздадутся один раз в ближайшем кадре
          if (w < 1 || h < 1) return;
          scale = clamp(Math.min(w, h) / 400, 0.75, 1.15);
          const count = clamp(Math.round((w * h) / 13000), 25, MAX_BUBBLES);
          for (const b of bubbles) {
            b.active = b.rank < count;
            b.r = b.r0 * scale;
            if (fresh) {
              b.x = rand(0, w);
              b.y = rand(-0.1, 1.05) * h;
              b.hue = (Math.random() * HUES.length) | 0;
              b.pop = -1;
            } else {
              b.x *= kx;
              b.y *= ky;
            }
            dress(b);
          }
          for (const d of drops) d.life = 0;
        },

        frame(ctx, t, dt, breath) {
          if (w < 1 || h < 1) return;
          dt = dt > 0 ? Math.min(dt, 0.05) : 0;
          time += dt;
          const raw = breath && breath.running ? +breath.level : 0;
          const target = raw > 0 ? Math.min(raw, 1) : 0;
          lvl += (target - lvl) * (1 - Math.exp(-dt * 2.5));

          // фон: вертикальный градиент + свет и виньетка
          if (!bgFill) buildFills(ctx);
          ctx.globalAlpha = 1;
          ctx.fillStyle = bgFill;
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = glowFill;
          ctx.fillRect(0, 0, w, h);

          // дымка: два больших мягких пятна, на вдохе чуть шире и светлее
          const hazeSize = Math.max(w, h) * 1.15 * (1 + 0.06 * lvl);
          for (let k = 0; k < 2; k++) {
            const hx = w * (0.5 + 0.42 * Math.sin(time * (0.021 + k * 0.008) + k * 2.4));
            const hy = h * (0.5 + 0.36 * Math.cos(time * (0.017 + k * 0.006) + k * 1.7));
            ctx.globalAlpha = (0.085 + 0.02 * Math.sin(time * 0.05 + k * 3)) * (1 + 0.12 * lvl);
            ctx.drawImage(haze, hx - hazeSize / 2, hy - hazeSize / 2, hazeSize, hazeSize);
          }

          // пузыри: общий слабый ветер, на вдохе почти зависают и слегка раздуваются
          const wind = 5 * Math.sin(time * 0.045) + 3 * Math.sin(time * 0.11 + 1.3);
          const lift = 1 - 0.5 * lvl;
          const swell = 1 + 0.06 * lvl;
          ctx.strokeStyle = PALE;
          for (let i = 0; i < MAX_BUBBLES; i++) {
            const b = bubbles[i];
            if (!b.active) continue;
            const m = b.r * 1.3 + b.wobAmp;
            if (b.pop >= 0) {
              b.pop += dt / POP_TIME;
              if (b.pop >= 1) toTop(b, h * 0.3);
            } else {
              b.x += (wind * b.par + b.drift) * scale * dt;
              b.y += b.fall * b.par * lift * scale * dt;
              if (b.y > h + m) toTop(b, 60);
              if (b.x < -m) b.x = w + m;
              else if (b.x > w + m) b.x = -m;
            }
            const x = posX(b);
            const y = posY(b);
            if (y < -m || y > h + m) continue;
            // в центре, где лёгкие и текст, пузыри и хлопки приглушаем — без резкой границы
            const cx = (x - w * 0.5) / (w * 0.48);
            const cy = (y - h * 0.5) / (h * 0.3);
            const c2 = cx * cx + cy * cy;
            const dim = c2 < 1 ? 1 - 0.4 * (1 - c2) * (1 - c2) : 1;
            let rr = b.r * swell;
            let alpha = b.alpha * dim * (0.9 + 0.1 * Math.sin(time * 0.4 + b.ph * 3));
            if (b.pop >= 0) {
              // хлопок: кромка расходится кольцом и тает, сам пузырь быстро исчезает
              const p = b.pop;
              const e = easeOut(p);
              ctx.globalAlpha = b.alpha * dim * 0.55 * (1 - p) * (1 - p);
              ctx.lineWidth = 0.6 + 1.2 * (1 - p);
              ctx.beginPath();
              ctx.arc(x, y, rr * (1 + 0.4 * e), 0, TAU);
              ctx.stroke();
              alpha *= Math.max(0, 1 - p * 3);
              rr *= 1 + 0.1 * e;
            }
            if (alpha < 0.004) continue;
            const sq = Math.sin(time * b.sqFreq + b.ph) * b.sqAmp; // плёнка чуть «дышит»
            const rx = rr * (1 + sq) * b.spr.k;
            const ry = rr * (1 - sq) * b.spr.k;
            ctx.globalAlpha = alpha;
            ctx.drawImage(b.spr.img, x - rx, y - ry, rx * 2, ry * 2);
          }

          // брызги от хлопков
          const drag = Math.exp(-2.2 * dt);
          ctx.fillStyle = PALE;
          for (let i = 0; i < MAX_DROPS; i++) {
            const d = drops[i];
            if (d.life <= 0) continue;
            d.life -= dt;
            d.vx *= drag;
            d.vy = d.vy * drag + 45 * dt;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            const f = Math.max(0, d.life / d.ttl);
            ctx.globalAlpha = d.alpha * f;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size * (0.5 + 0.5 * f), 0, TAU);
            ctx.fill();
          }

          if (time >= nextPop) nextPop = time + (tryPop() ? rand(5, 11) : 1.5);
          ctx.globalAlpha = 1;
        },
      };
    },
  });
})();
