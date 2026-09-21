(() => {
  'use strict';

  /* ---------- Данные ---------- */

  const STORAGE_KEY = 'glaza.v1';

  // Скорость точки — во сколько раз быстрее базовой скорости упражнения.
  // Круг радиусом 0,9 поля на «Средне» проходит за 6 с, на «Очень быстро» — за 3 с.
  // Даже ×6 — около 11°/с, а глаз плавно ведёт цель до 20–30°/с (подробности — в exercises/registry.js).
  const SPEEDS = [
    { id: 2, name: 'Медленно' },
    { id: 3, name: 'Средне' },
    { id: 4, name: 'Быстро' },
    { id: 6, name: 'Очень быстро' },
  ];

  const DEFAULTS = {
    exercises: ['blink', 'circle', 'rule20'], // программа: упражнения идут по очереди и по кругу
    speed: 3, // во сколько раз быстрее базовой скорости движется точка: 2, 3, 4 или 6
    background: 'clouds', // живой фон: id из папки backgrounds или 'none'
    sound: 'bell', // режим звука: id из папки sound или 'off'
    volume: 0.6,
    vibrate: true,
    music: true, // фоновая музыка (если файл music/loop.mp3 лежит рядом с приложением)
    musicVolume: 0.5,
  };

  let state = loadState();

  function loadState() {
    const fresh = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return fresh;
      for (const key of Object.keys(fresh)) {
        const value = saved[key];
        if (key === 'volume' || key === 'musicVolume') fresh[key] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fresh[key];
        else if (key === 'vibrate' || key === 'music') fresh[key] = typeof value === 'boolean' ? value : fresh[key];
        else if (key === 'exercises') {
          // прежние версии хранили одно упражнение строкой
          const ids = Array.isArray(value) ? value : typeof saved.exercise === 'string' ? [saved.exercise] : null;
          if (ids) fresh.exercises = ids.filter((id) => typeof id === 'string').slice(0, 20);
        } else if (key === 'speed') fresh.speed = SPEEDS.some((x) => x.id === value) ? value : fresh.speed;
        else if (typeof value === 'string') fresh[key] = value;
      }
    } catch {}
    return fresh;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function minutes(seconds) {
    if (seconds < 60) return `${seconds} с`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m} мин ${s} с` : `${m} мин`;
  }

  /* ---------- Элементы ---------- */

  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const settings = $('settings');
  const field = $('field');
  const target = $('target');
  const restMark = $('restMark');
  const hint = $('hint');
  const nowEl = $('now');
  const stepLabel = $('stepLabel');
  const countEl = $('count');
  const elapsedEl = $('elapsed');
  const roundsEl = $('rounds');
  const toggleBtn = $('toggle');
  const exerciseList = $('exerciseList');
  const vibrateSwitch = $('vibrate');
  const volumeInput = $('volume');
  const soundList = $('soundList');
  const backgroundList = $('backgroundList');
  const speedList = $('speedList');

  const backdrop = BreathBackgroundHost.mount($('backdrop'));
  const sound = BreathSound.mount();
  const music = AppMusic.mount();
  const musicSwitch = $('music');
  const musicVolumeInput = $('musicVolume');

  // Выбранные упражнения в том порядке, в каком они стоят в списке настроек.
  function chosenExercises() {
    const chosen = orderedExercises().filter((e) => state.exercises.includes(e.id));
    return chosen.length ? chosen : orderedExercises().slice(0, 1);
  }


  /* ---------- Занятие ---------- */

  const START_DELAY = 120; // мс от нажатия до первого шага: звук успевает встать точно в начало
  const VIBRATION = { track: [60], rest: [40, 80, 40], blink: [30, 70, 30, 70, 30] };

  let running = false;
  let startedAt = 0;
  let rafId = 0;
  let exercise = null; // программа занятия: EyeExercises.compose(...)
  let shown = { step: null, left: -1, sec: -1, rounds: -1 };
  let wakeLock = null;

  // Звуковое ядро знает четыре фазы: 0 и 2 — колокольчики, 1 и 3 — двойной «тук».
  // Шаги слежения чередуем между 0 и 2, чтобы соседние движения звучали по-разному,
  // отдых помечаем двойным туком, моргание — низким.
  function phaseOf(step, order) {
    if (step.kind === 'rest') return 1;
    if (step.kind === 'blink') return 3;
    return order % 2 ? 2 : 0;
  }

  // Расписание для звука: те же моменты, что и у шагов упражнения.
  function soundSession() {
    let order = 0;
    return {
      startedAt,
      timeline: exercise.steps.map((s) => {
        const phase = phaseOf(s, order);
        if (s.kind === 'track') order++;
        return { phase, t0: s.t0, dur: s.dur };
      }),
      cycle: exercise.total,
    };
  }

  function place(x, y, visible) {
    target.hidden = !visible;
    if (!visible) return;
    // x и y приходят в долях от центра: переводим в проценты поля с полями по краям
    target.style.left = `${(50 + x * 43).toFixed(2)}%`;
    target.style.top = `${(50 + y * 43).toFixed(2)}%`;
  }

  function applyExercise() {
    const list = chosenExercises();
    exercise = list.length ? EyeExercises.compose(list, state.speed) : null;
    // В папке exercises пусто или все файлы сломаны: приложению нечего показывать.
    if (!exercise) {
      $('exerciseName').textContent = 'Нет упражнений';
      $('exerciseTime').textContent = '';
      hint.textContent = 'Добавьте файл в папку exercises и впишите его в index.html. Образец — exercises/_template.js';
      toggleBtn.disabled = true;
      place(0, 0, false);
      return;
    }
    toggleBtn.disabled = false;
    // Каждое название — одним куском: иначе «Правило 20-20-20» рвётся по дефису на две строки
    $('exerciseName').innerHTML = list.map((e) => `<span class="nowrap">${esc(e.name)}</span>`).join(' → ');
    $('exerciseTime').textContent = minutes(Math.round(exercise.total));
    if (running) {
      startedAt = performance.now() + START_DELAY;
      shown = { step: null, left: -1, sec: -1, rounds: -1 };
      sound.start(soundSession());
    } else {
      place(0, 0, true);
      document.body.classList.remove('tracking');
      restMark.hidden = true;
    }
  }

  function frame(now) {
    if (!running) return;
    const t = Math.max(0, (now - startedAt) / 1000);
    const at = EyeExercises.at(exercise, t);
    const tracking = at.step.kind === 'track';

    place(at.x, at.y, tracking);
    if (shown.step !== at.step) {
      shown.step = at.step;
      stepLabel.textContent = at.step.label;
      if (exercise.parts.length > 1) {
        // В программе из нескольких упражнений сверху — текущее и его собственная длительность
        const part = exercise.parts.find((x) => x.exercise === at.step.exercise);
        $('exerciseName').textContent = at.step.exercise.name;
        $('exerciseTime').textContent = minutes(Math.round(part.total));
      }
      // На отдыхе и моргании фон не приглушаем: смотреть на экран не нужно
      document.body.classList.toggle('tracking', tracking);
      restMark.hidden = tracking;
      restMark.className = 'rest-mark'; // сброс класса перезапускает анимацию с начала шага
      void restMark.offsetWidth;
      restMark.className = `rest-mark ${at.step.kind}`;
      if (at.step.kind === 'blink') restMark.style.setProperty('--blink', `${at.step.period.toFixed(3)}s`);
      backdrop.breath.phase = phaseOf(at.step, at.step.index);
      if (state.vibrate && navigator.vibrate) navigator.vibrate(VIBRATION[at.step.kind]);
    }
    // Фон слегка оживает на отдыхе и замирает, пока глаза работают
    backdrop.breath.level = tracking ? 0 : 0.5 + 0.5 * Math.sin(t * 0.6);

    if (shown.left !== at.left) {
      shown.left = at.left;
      countEl.textContent = at.left;
    }
    const sec = Math.floor(t);
    if (shown.sec !== sec) {
      shown.sec = sec;
      elapsedEl.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }
    if (shown.rounds !== at.rounds) {
      shown.rounds = at.rounds;
      roundsEl.textContent = `круг ${at.rounds + 1}`;
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    running = true;
    startedAt = performance.now() + START_DELAY;
    shown = { step: null, left: -1, sec: -1, rounds: -1 };
    main.classList.add('running');
    toggleBtn.textContent = 'Остановить';
    hint.hidden = true;
    nowEl.hidden = false;
    backdrop.breath.running = true;
    sound.start(soundSession()); // вызывается из нажатия — так браузер разрешает звук
    music.start();
    keepAwake(true);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    sound.stop();
    music.stop();
    if (navigator.vibrate) navigator.vibrate(0);
    backdrop.breath.running = false;
    backdrop.breath.phase = -1;
    backdrop.breath.level = 0;
    main.classList.remove('running');
    document.body.classList.remove('tracking');
    applyExercise(); // вернуть в заголовок всю программу
    toggleBtn.textContent = 'Начать';
    hint.hidden = false;
    nowEl.hidden = true;
    restMark.hidden = true;
    keepAwake(false);
    place(0, 0, true);
  }

  // Не даём экрану погаснуть, пока идёт занятие.
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) {
        const lock = await navigator.wakeLock.request('screen');
        if (!running) {
          lock.release(); // пока ждали разрешения, занятие уже остановили
          return;
        }
        const old = wakeLock;
        wakeLock = lock;
        if (old) old.release();
      } else if (!on && wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible') {
      keepAwake(true);
      sound.wake();
      music.wake();
    }
  });

  toggleBtn.addEventListener('click', () => (running ? stop() : start()));

  /* ---------- Настройки ---------- */

  // Насколько польза упражнения подтверждена исследованиями — показываем честно, как есть.
  const EVIDENCE = {
    strong: 'Доказано обзорами',
    moderate: 'Подтверждено испытанием',
    weak: 'Данных мало',
    none: 'Польза не доказана',
  };
  const EVIDENCE_ORDER = ['strong', 'moderate', 'weak', 'none'];

  // Сначала то, что проверено лучше; внутри одного уровня — в порядке из index.html
  function orderedExercises() {
    return EyeExercises.list()
      .map((e, i) => ({ e, i }))
      .sort((a, b) => EVIDENCE_ORDER.indexOf(a.e.evidence) - EVIDENCE_ORDER.indexOf(b.e.evidence) || a.i - b.i)
      .map(({ e }) => e);
  }

  function renderExercises() {
    const chosen = chosenExercises().map((e) => e.id);
    exerciseList.innerHTML = orderedExercises()
      .map((e) => {
        const order = chosen.indexOf(e.id);
        const selected = order >= 0;
        return `
        <div class="prog${selected ? ' selected' : ''}" data-id="${esc(e.id)}">
          <button class="prog-head" type="button" role="checkbox" aria-checked="${selected}">
            <span class="glyph">${selected && chosen.length > 1 ? order + 1 : ''}</span>
            <span class="prog-title">
              <span class="prog-name">${esc(e.name)}</span>
              <span class="evidence ${e.evidence}">${EVIDENCE[e.evidence]}</span>
            </span>
            <span class="prog-pattern">${minutes(e.total)}</span>
          </button>
          ${selected && e.note ? `<p class="prog-note">${esc(e.note)}</p>` : ''}
          ${selected && e.evidenceNote ? `<p class="prog-note evidence-note">${esc(e.evidenceNote)}</p>` : ''}
        </div>`;
      })
      .join('');
  }

  exerciseList.addEventListener('click', (e) => {
    const head = e.target.closest('button.prog-head');
    if (!head) return;
    const id = head.closest('.prog').dataset.id;
    const chosen = chosenExercises().map((x) => x.id);
    if (chosen.includes(id)) {
      if (chosen.length === 1) return; // хотя бы одно упражнение должно остаться
      state.exercises = chosen.filter((x) => x !== id);
    } else {
      state.exercises = [...chosen, id];
    }
    saveState();
    renderExercises();
    applyExercise();
    const same = exerciseList.querySelector(`.prog[data-id="${CSS.escape(id)}"] .prog-head`);
    if (same) same.focus();
  });

  speedList.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || Number(chip.dataset.id) === state.speed) return;
    state.speed = Number(chip.dataset.id);
    saveState();
    applyExercise();
    speedList.innerHTML = chipsHtml(SPEEDS, state.speed);
    speedList.querySelector('[aria-checked="true"]').focus();
  });

  function chipsHtml(items, selected) {
    return items
      .map((it) => `<button class="chip" type="button" role="radio" data-id="${esc(it.id)}" aria-checked="${it.id === selected}">${esc(it.name)}</button>`)
      .join('');
  }

  // Применяет выбранные фон, звук и громкость; вызывается при запуске и после каждого изменения.
  function applyOptions() {
    if (state.background !== 'none' && !BreathBackgrounds.get(state.background)) state.background = 'none';
    if (state.sound !== 'off' && !BreathSound.list().some((m) => m.id === state.sound)) state.sound = 'off';

    if (backdrop.id !== state.background) backdrop.set(state.background);
    document.body.classList.toggle('has-backdrop', state.background !== 'none');
    sound.setVolume(state.volume);
    sound.setMode(state.sound);

    soundList.innerHTML = chipsHtml([{ id: 'off', name: 'Без звука' }, ...BreathSound.list()], state.sound);
    speedList.innerHTML = chipsHtml(SPEEDS, state.speed);
    backgroundList.innerHTML = chipsHtml([{ id: 'none', name: 'Без фона' }, ...BreathBackgrounds.list()], state.background);
    settings.classList.toggle('sound-off', state.sound === 'off');
    volumeInput.value = Math.round(state.volume * 100);
    vibrateSwitch.setAttribute('aria-checked', String(state.vibrate));
    vibrateSwitch.disabled = !navigator.vibrate;
    if (!navigator.vibrate) $('vibrateNote').textContent = 'Этот телефон не даёт приложениям управлять вибрацией. На iPhone она недоступна.';

    music.setVolume(state.musicVolume);
    music.setEnabled(state.music);
    musicSwitch.setAttribute('aria-checked', String(state.music));
    musicVolumeInput.value = Math.round(state.musicVolume * 100);
    settings.classList.toggle('music-off', !state.music);
  }

  // Раздел «Музыка» показываем, только если файл с музыкой действительно лежит рядом с приложением.
  music.available().then((yes) => { $('musicBox').hidden = !yes; });

  musicSwitch.addEventListener('click', () => {
    state.music = !state.music;
    saveState();
    applyOptions();
  });

  musicVolumeInput.addEventListener('input', () => {
    state.musicVolume = Number(musicVolumeInput.value) / 100;
    music.setVolume(state.musicVolume);
    saveState();
  });

  function pickChip(e, key) {
    const chip = e.target.closest('.chip');
    if (!chip || chip.dataset.id === state[key]) return false;
    state[key] = chip.dataset.id;
    saveState();
    applyOptions();
    e.currentTarget.querySelector('[aria-checked="true"]').focus();
    return true;
  }

  soundList.addEventListener('click', (e) => {
    // сразу даём послушать выбранный звук (если занятие не идёт)
    if (pickChip(e, 'sound') && state.sound !== 'off' && !running) sound.demo();
  });
  backgroundList.addEventListener('click', (e) => pickChip(e, 'background'));

  $('soundDemo').addEventListener('click', () => sound.demo());

  volumeInput.addEventListener('input', () => {
    state.volume = Number(volumeInput.value) / 100;
    sound.setVolume(state.volume);
    saveState();
  });

  vibrateSwitch.addEventListener('click', () => {
    state.vibrate = !state.vibrate;
    saveState();
    applyOptions();
    if (state.vibrate && navigator.vibrate) navigator.vibrate(VIBRATION.rest);
  });

  // Изменения из другого окна (например, второй экран на странице макета)
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const before = JSON.stringify([state.exercises, state.speed]);
    state = loadState();
    renderExercises();
    if (JSON.stringify([state.exercises, state.speed]) !== before) applyExercise();
    applyOptions();
  });

  /* ---------- Переход между экранами ---------- */

  let openedInApp = false;
  let routeOpen = null;
  const embedded = window.self !== window.top; // страница макета: два экрана в одном окне делят общую историю

  function syncRoute() {
    const open = location.hash === '#settings';
    settings.classList.toggle('open', open);
    settings.inert = !open;
    main.inert = open;
    if (open && running) stop();
    if (!running) sound.stop(); // проба звука из настроек не продолжает играть на другом экране
    if (routeOpen !== null && routeOpen !== open) (open ? $('back') : $('openSettings')).focus();
    routeOpen = open;
  }

  $('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    if (embedded) {
      location.replace('#settings'); // без записи в общую историю
      return;
    }
    openedInApp = true;
    location.hash = 'settings';
  });

  $('back').addEventListener('click', () => {
    if (openedInApp) {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      syncRoute();
    }
  });

  window.addEventListener('hashchange', syncRoute);

  /* ---------- Установка на телефон ---------- */

  // Chrome сам решает, когда приложение можно установить, и сообщает об этом событием.
  // Ловим его и показываем свою кнопку в настройках — искать пункт в меню браузера не нужно.
  let installPrompt = null;
  const installBox = $('installBox');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // iPhone не умеет предлагать установку сам: там её делают вручную через «Поделиться».
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)); // iPad выдаёт себя за Mac
  if (isIOS && !standalone) {
    $('installNote').textContent = 'Нажмите «Поделиться» внизу Safari, затем «На экран „Домой“». Приложение появится отдельной иконкой и будет работать без интернета.';
    $('install').hidden = true;
    installBox.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // без этого Chrome показал бы свою подсказку внизу экрана
    installPrompt = e;
    installBox.hidden = false;
  });

  $('install').addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installBox.hidden = true;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome !== 'accepted') {
        // передумали — вернём кнопку, установить можно будет позже
        installPrompt = prompt;
        installBox.hidden = false;
      }
    } catch {
      installBox.hidden = true;
    }
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installBox.hidden = true;
  });

  /* ---------- Запуск ---------- */

  applyExercise();
  renderExercises();
  applyOptions();
  syncRoute();
  requestAnimationFrame(() => document.body.classList.remove('no-anim'));

  // Работа без интернета. На компьютере при разработке не включаем (иначе мешает кэш); проверить можно с ?sw=1.
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (!local || location.search.includes('sw=1'))) {
    // Если приложение обновилось, подхватываем новую версию — но не посреди занятия.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading || running) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
