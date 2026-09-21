// Фоновая музыка: бесшовное кольцо из файла music/loop.mp3.
//
// Кольцо играет через Web Audio, а не через <audio loop>: тег audio на стыке даёт паузу,
// а здесь звук раскодирован в память и повторяется с точностью до отсчёта.
// Файл готовит tools/make-music-loop.py: по краям у него запас, а играть нужно только
// середину — границы записаны в music/loop.json (loopStart и loopEnd).
//
// Цена — память: раскодированные 2,5 минуты стерео занимают около 55 МБ.
// Поэтому раскодируем только при первом «Начать», а при выключении музыки память освобождается.
// Сам файл (2,5 МБ в сжатом виде) скачиваем заранее, пока человек читает экран:
// иначе на мобильном интернете музыка вступала бы через несколько секунд после нажатия.
//
//   const music = AppMusic.mount();
//   music.available()  → Promise<boolean>: лежит ли музыка рядом с приложением
//   music.setEnabled(true); music.setVolume(0.5);  // setEnabled(true) заодно скачивает файл
//   music.start();     // из обработчика нажатия: иначе браузер не даст включить звук
//   music.stop();
(function (root) {
  'use strict';

  const FADE_IN = 2.5; // секунд
  const FADE_OUT = 1.2;
  // Файл уже выровнен по громкости — около −16 LUFS, как обычная музыка в телефоне
  // (tools/make-music-loop.py). Ползунок на середине даёт около −22 LUFS: музыку хорошо слышно,
  // а колокольчик упражнения звучит поверх. Раньше здесь было 0,7 при тихом файле — на динамике
  // телефона выходило около −32 LUFS, то есть музыки почти не было слышно.
  const CEILING = 1;

  function mount() {
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    let ctx = null;
    let gain = null;
    let source = null;
    let buffer = null;
    let info = null;
    let loading = null;
    let bytes = null; // Promise<ArrayBuffer|null>: сжатый файл, скачанный заранее
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

    // Скачать сжатый файл, не раскодируя. Неудачу не запоминаем: в следующий раз попробуем снова.
    function prefetch() {
      if (!AudioCtx) return Promise.resolve(null);
      bytes = bytes || available()
        .then((yes) => (yes ? fetch('music/loop.mp3') : null))
        .then((r) => (r && r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
        .then((data) => {
          if (!data) bytes = null;
          return data;
        });
      return bytes;
    }

    async function load() {
      if (buffer) return buffer;
      loading = loading || (async () => {
        const data = await prefetch();
        if (!data) return null;
        // decodeAudioData забирает буфер себе — отдаём копию, чтобы после выключения
        // и нового включения музыки не качать файл заново
        buffer = await new Promise((resolve, reject) => {
          // старый Safari понимает только вариант с обратными вызовами
          const p = ctx.decodeAudioData(data.slice(0), resolve, reject);
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
        buffer = null; // освобождаем память; сжатый файл оставляем — он небольшой
      } else if (wanted) {
        start();
      } else {
        prefetch();
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
