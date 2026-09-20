// Крутит выбранный живой фон на холсте позади экрана.
//   const host = BreathBackgroundHost.mount(canvas);
//   host.set('bubbles');            // 'none' — без фона
//   host.breath.level = 0.4;        // приложение сообщает фону состояние дыхания
(function (root) {
  'use strict';

  const MAX_DPR = 2; // выше — лишняя нагрузка на телефон без видимой пользы

  function mount(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const breath = { level: 0, phase: -1, running: false };
    const reducedMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let current = null; // экземпляр фона
    let currentId = 'none';
    let width = 0;
    let height = 0;
    let rafId = 0;
    let last = 0;
    let t = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, MAX_DPR);
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (current) {
        current.resize(width, height);
        if (!rafId) draw(0); // неподвижный режим: перерисовать один кадр
      }
    }

    function draw(dt) {
      if (!current || !width || !height) return;
      t += dt;
      current.frame(ctx, t, dt, breath);
    }

    function loop(now) {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      draw(dt);
      rafId = requestAnimationFrame(loop);
    }

    function play() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (!current || document.hidden) return;
      if (reducedMotion.matches) {
        draw(0);
        return;
      }
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }

    function set(id) {
      const def = root.BreathBackgrounds && root.BreathBackgrounds.get(id);
      currentId = def ? id : 'none';
      current = def ? def.create() : null;
      canvas.hidden = !def;
      t = 0;
      if (current) resize();
      play();
    }

    if (root.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else root.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', play);
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', play);

    return { set, breath, get id() { return currentId; } };
  }

  root.BreathBackgroundHost = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
