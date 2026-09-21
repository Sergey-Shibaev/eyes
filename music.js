// Фоновая музыка: бесшовное кольцо из файла music/loop.mp3.
//
// Кольцо играет через Web Audio, а не через <audio loop>: тег audio на стыке даёт паузу,
// а здесь звук раскодирован в память и повторяется с точностью до отсчёта.
// Файл готовит tools/make-music-loop.py: по краям у него запас, а играть нужно только
// середину — границы записаны в music/loop.json (loopStart и loopEnd).
//
// Цена — память: раскодированные 2,5 минуты стерео занимают около 55 МБ.
// Поэтому раскодируем только при первом «Начать», а при выключении музыки память освобождается.
// Сжатый файл (2,5 МБ) достаём заранее, но только из кэша service worker'а (см. prefetch):
// так музыка вступает сразу после нажатия и при этом ничего не качается дважды.
//
//   const music = AppMusic.mount();
//   music.available()  → Promise<boolean>: лежит ли музыка рядом с приложением
//   music.setEnabled(true); music.setVolume(0.5);  // setEnabled(true) заодно достаёт файл заранее
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
  // Если связь зависла и файл не приходит, через столько бросаем попытку — следующее «Начать»
  // попробует снова. С запасом: 2,5 МБ на медленном мобильном интернете идут около минуты.
  const FETCH_TIMEOUT = 90000; // мс

  function mount() {
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    let ctx = null;
    let master = null; // громкость с ползунка
    let voice = null; // то, что играет сейчас: { source, fade }
    let fading = 0; // сколько прежних звучаний ещё затихает
    let buffer = null;
    let info = null;
    let check = null;
    let bytes = null; // Promise<ArrayBuffer|null>: сжатый файл
    let loading = null;
    let enabled = true;
    let volume = 0.5;
    let wanted = false; // приложение попросило играть (идёт занятие)

    // Есть ли музыка. Запоминаем только ответ сервера «да» или «нет» (404); если не было сети
    // или сервер сбоил, следующий вызов спросит снова — иначе музыка не вернулась бы до перезапуска.
    function available() {
      if (!AudioCtx) return Promise.resolve(false);
      check = check || fetch('music/loop.json')
        .then((r) => {
          if (r.ok) return r.json();
          if (r.status !== 404) check = null;
          return null;
        })
        .then((json) => {
          info = json && json.loopEnd > json.loopStart ? json : null;
          return !!info;
        })
        .catch(() => {
          check = null;
          return false;
        });
      return check;
    }

    // Скачать сжатый файл, не раскодируя. Неудачу не запоминаем: в следующий раз попробуем снова.
    function download() {
      if (!AudioCtx) return Promise.resolve(null);
      bytes = bytes || available()
        .then((yes) => {
          if (!yes) return null;
          const abort = root.AbortController ? new root.AbortController() : null;
          const timer = abort ? setTimeout(() => abort.abort(), FETCH_TIMEOUT) : 0;
          return fetch('music/loop.mp3', abort ? { signal: abort.signal } : undefined)
            .then((r) => (r.ok ? r.arrayBuffer() : null))
            .finally(() => clearTimeout(timer));
        })
        .catch(() => null)
        .then((data) => {
          if (!data) bytes = null;
          return data;
        });
      return bytes;
    }

    // Заранее достаём файл, только когда страницей управляет service worker: тогда он отдаёт файл
    // из своего кэша. При первом визите файл и так качает установка service worker'а (sw.js);
    // скачай его ещё и страница — ушло бы 5 МБ трафика вместо 2,5.
    function prefetch() {
      const sw = root.navigator && root.navigator.serviceWorker;
      if (sw && !sw.controller) return;
      download();
    }

    async function load() {
      if (buffer) return buffer;
      loading = loading || (async () => {
        const data = await download();
        if (!data) return null;
        // decodeAudioData забирает буфер себе — отдаём копию, чтобы после выключения
        // и нового включения музыки не качать файл заново
        const decoded = await new Promise((resolve, reject) => {
          // старый Safari понимает только вариант с обратными вызовами
          const p = ctx.decodeAudioData(data.slice(0), resolve, reject);
          if (p && p.then) p.then(resolve, reject);
        }).catch(() => {
          bytes = null; // файл испорчен — в следующий раз скачаем заново
          return null;
        });
        // пока раскодировали, музыку могли выключить — тогда 55 МБ не держим
        if (enabled) buffer = decoded;
        return buffer;
      })().catch(() => null);
      const result = await loading;
      loading = null;
      return result;
    }

    // У каждого звучания своя плавная громкость (fade), общая — только громкость с ползунка.
    // Поэтому при быстром «Остановить → Начать» новое звучание нарастает, пока прежнее стихает:
    // без щелчков и без обрыва на полуслове.
    function play() {
      if (voice || !buffer || !wanted || !enabled) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = info.loopStart;
      source.loopEnd = Math.min(info.loopEnd, buffer.duration);
      const fade = ctx.createGain();
      source.connect(fade);
      fade.connect(master);
      const t = ctx.currentTime;
      fade.gain.setValueAtTime(0, t);
      fade.gain.linearRampToValueAtTime(1, t + FADE_IN);
      source.start(t, info.loopStart);
      voice = { source, fade };
    }

    function halt() {
      const v = voice;
      voice = null;
      if (!v) return;
      const t = ctx.currentTime;
      const g = v.fade.gain;
      // Затихаем с той громкости, что звучит сейчас, даже если нарастание ещё не закончилось
      if (g.cancelAndHoldAtTime) {
        g.cancelAndHoldAtTime(t);
      } else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
      }
      g.linearRampToValueAtTime(0, t + FADE_OUT);
      fading++;
      v.source.onended = () => {
        fading--;
        v.source.disconnect();
        v.fade.disconnect();
        sleepIfIdle();
      };
      try {
        v.source.stop(t + FADE_OUT + 0.05);
      } catch {
        v.source.onended();
      }
    }

    // Тишина — не тратим батарею: усыпляем звук, когда ничего не играет и не затихает.
    function sleepIfIdle() {
      if (ctx && !voice && !fading && (!wanted || !enabled) && ctx.state === 'running') ctx.suspend().catch(() => {});
    }

    async function start() {
      wanted = true;
      if (!enabled || !AudioCtx) return;
      if (!ctx) {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = CEILING * volume;
        master.connect(ctx.destination);
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
      if (!ctx) return;
      halt();
      sleepIfIdle(); // остановили, пока файл ещё грузился: играть нечему, а звук уже разбужен
    }

    function setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        if (ctx) {
          halt();
          sleepIfIdle();
        }
        buffer = null; // освобождаем память; сжатый файл оставляем — он небольшой
      } else if (wanted) {
        start();
      } else {
        prefetch();
      }
    }

    function setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.setTargetAtTime(CEILING * volume, ctx.currentTime, 0.08);
    }

    // После звонка или сворачивания браузер мог усыпить звук — будим.
    function wake() {
      if (wanted && enabled && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    }

    return { available, start, stop, wake, setEnabled, setVolume };
  }

  root.AppMusic = { mount };
})(typeof self !== 'undefined' ? self : globalThis);
