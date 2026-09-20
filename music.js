// Фоновая музыка: бесшовное кольцо из файла music/loop.mp3.
//
// Кольцо играет через Web Audio, а не через <audio loop>: тег audio на стыке даёт паузу,
// а здесь звук раскодирован в память и повторяется с точностью до отсчёта.
// Файл готовит tools/make-music-loop.py: по краям у него запас, а играть нужно только
// середину — границы записаны в music/loop.json (loopStart и loopEnd).
//
// Цена — память: раскодированные 2,5 минуты стерео занимают около 55 МБ.
// Поэтому файл грузится только при первом включении, а при выключении музыки память освобождается.
//
//   const music = AppMusic.mount();
//   music.available()  → Promise<boolean>: лежит ли музыка рядом с приложением
//   music.setEnabled(true); music.setVolume(0.5);
//   music.start();     // из обработчика нажатия: иначе браузер не даст включить звук
//   music.stop();
(function (root) {
  'use strict';

  const FADE_IN = 2.5; // секунд
  const FADE_OUT = 1.2;
  const CEILING = 0.7; // потолок громкости: музыка — фон, сигналы упражнения должны быть слышны поверх

  function mount() {
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    let ctx = null;
    let gain = null;
    let source = null;
    let buffer = null;
    let info = null;
    let loading = null;
    let enabled = true;
    let volume = 0.5;
    let wanted = false; // приложение попросило играть (идёт занятие)
    let check = null;

    function available() {
      if (!AudioCtx) return Promise.resolve(false);
      check = check || fetch('music/loop.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          info = json && json.loopEnd > json.loopStart ? json : null;
          return !!info;
        })
        .catch(() => false);
      return check;
    }

    async function load() {
      if (buffer) return buffer;
      loading = loading || (async () => {
        if (!(await available())) return null;
        const data = await (await fetch('music/loop.mp3')).arrayBuffer();
        // старый Safari понимает только вариант с обратными вызовами
        buffer = await new Promise((resolve, reject) => {
          const p = ctx.decodeAudioData(data, resolve, reject);
          if (p && p.then) p.then(resolve, reject);
        });
        return buffer;
      })().catch(() => null);
      const result = await loading;
      loading = null;
      return result;
    }

    function play() {
      if (source || !buffer || !wanted || !enabled) return;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = info.loopStart;
      source.loopEnd = Math.min(info.loopEnd, buffer.duration);
      source.connect(gain);
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(CEILING * volume, t + FADE_IN);
      source.start(t, info.loopStart);
    }

    function halt() {
      const s = source;
      source = null;
      if (!s) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, FADE_OUT / 4);
      try {
        s.stop(t + FADE_OUT);
      } catch {}
      s.onended = () => {
        s.disconnect();
        if (!source && !wanted && ctx.state === 'running') ctx.suspend(); // тишина — не тратим батарею
      };
    }

    async function start() {
      wanted = true;
      if (!enabled || !AudioCtx) return;
      if (!ctx) {
        ctx = new AudioCtx();
        gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        // iPhone: без этого боковой переключатель «без звука» глушит музыку
        try {
          if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback';
        } catch {}
      }
      try {
        await ctx.resume();
      } catch {}
      await load();
      play(); // если за время загрузки занятие остановили, play() сам ничего не сделает
    }

    function stop() {
      wanted = false;
      if (ctx) halt();
    }

    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        if (ctx) halt();
        buffer = null; // освобождаем память
      } else if (wanted) {
        start();
      }
    }

    function setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (source) gain.gain.setTargetAtTime(CEILING * volume, ctx.currentTime, 0.08);
    }

    // После звонка или сворачивания браузер мог усыпить звук — будим.
    function wake() {
      if (wanted && enabled && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    }

    return { available, start, stop, wake, setEnabled, setVolume };
  }

  root.AppMusic = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
