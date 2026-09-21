// Проверка упражнений: точка не выходит за поле, не рвётся, не бежит быстрее взгляда.
// Запуск: node tests/exercise.test.js            — все упражнения из папки exercises
//         node tests/exercise.test.js exercises/circle.js  — только указанные
const fs = require('fs');
const path = require('path');

const MAX_SPEED = 0.5; // долей поля в секунду на базовой скорости (×1); на ×6 это 3 поля/с ≈ 17°/с
const TOP_SPEED = 6; // самое быстрое ускорение в настройках
const DEG_PER_UNIT = 5.6; // одна доля поля на телефоне в ~33 см от глаз, в градусах
const PURSUIT_LIMIT = 20; // °/с: до этой скорости глаз плавно ведёт цель без догоняющих рывков
const MAX_JUMP = 0.05; // насколько точка может сместиться за 0.02 с внутри одного шага
const MIN_TOTAL = 30; // секунд
const MAX_TOTAL = 180;
const MAX_TRACK_RUN = 3; // подряд идущих шагов слежения без отдыха
const STEP = 0.02;

const root = path.resolve(__dirname, '..');
require(path.join(root, 'exercises', 'registry.js'));

const args = process.argv.slice(2);
const files = args.length
  ? args.map((f) => path.resolve(f))
  : fs
      .readdirSync(path.join(root, 'exercises'))
      .filter((f) => f.endsWith('.js') && f !== 'registry.js' && !f.startsWith('_'))
      .map((f) => path.join(root, 'exercises', f));

if (!files.length) {
  console.log('В папке exercises пока нет упражнений (файлы с подчёркиванием не в счёт).');
  process.exit(0);
}

let failed = false;
for (const f of files) {
  try {
    require(f);
  } catch (err) {
    console.log(`ПЛОХО  ${path.basename(f)}: не загрузилось — ${err.message}`);
    failed = true;
  }
}

for (const e of EyeExercises.list()) {
  const problems = [];
  const add = (text) => {
    if (problems.length < 8 && !problems.includes(text)) problems.push(text);
  };

  if (!e.name) add('нет названия');
  if (e.total < MIN_TOTAL) add(`слишком короткое: ${e.total} с (нужно хотя бы ${MIN_TOTAL})`);
  if (e.total > MAX_TOTAL) add(`слишком длинное: ${e.total} с (не больше ${MAX_TOTAL})`);

  // отдых должен встречаться регулярно
  let run = 0;
  for (const s of e.steps) {
    run = s.kind === 'track' ? run + 1 : 0;
    if (run > MAX_TRACK_RUN) add(`${MAX_TRACK_RUN + 1} шага слежения подряд без отдыха`);
    if (!s.label) add(`шаг ${s.index} без надписи`);
  }
  if (!e.steps.some((s) => s.kind !== 'track')) add('нет ни одного шага отдыха');
  // Заявление о пользе без объяснения — это обещание без источника
  if ((e.evidence === 'strong' || e.evidence === 'moderate') && !e.evidenceNote) add(`уровень «${e.evidence}» без evidenceNote: объясните, что и у кого показано`);

  // проходим два круга: заодно проверяем стык конца и начала
  let maxSpeed = 0;
  let sumSpeed = 0;
  let samples = 0;
  let prev = null;
  for (let t = 0; t < e.total * 2; t += STEP) {
    const a = EyeExercises.at(e, t);
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) add(`не число в координатах на ${t.toFixed(2)} с`);
    if (Math.abs(a.x) > 1.0001 || Math.abs(a.y) > 1.0001) add(`точка вышла за поле на ${t.toFixed(2)} с`);
    if (prev && prev.step === a.step && a.step.kind === 'track') {
      const jump = Math.hypot(a.x - prev.x, a.y - prev.y);
      const speed = jump / STEP;
      maxSpeed = Math.max(maxSpeed, speed);
      sumSpeed += speed;
      samples++;
      if (jump > MAX_JUMP) add(`разрыв внутри шага «${a.step.label}» на ${t.toFixed(2)} с: ${jump.toFixed(3)} поля за ${STEP} с`);
    }
    prev = a;
  }
  if (maxSpeed > MAX_SPEED) add(`точка идёт слишком быстро: ${maxSpeed.toFixed(2)} поля/с (предел ${MAX_SPEED})`);

  const avg = samples ? sumSpeed / samples : 0;
  const kinds = e.steps.map((s) => s.kind[0]).join('');
  console.log(
    `${problems.length ? 'ПЛОХО ' : 'OK    '} ${e.id.padEnd(12)} «${e.name}»  ${e.total} с, шагов ${e.steps.length} [${kinds}], скорость макс ${maxSpeed.toFixed(2)} средняя ${avg.toFixed(2)} поля/с, доказанность: ${e.evidence}`
  );
  for (const p of problems) console.log(`         - ${p}`);
  if (problems.length) failed = true;
}

// Ускорение и программа из всех упражнений подряд: на ×2…×4 точка не рвётся внутри шага
// и не выходит за предел плавного слежения.
for (const speed of [2, 3, 4, TOP_SPEED]) {
  const program = EyeExercises.compose(EyeExercises.list(), speed);
  let prev = null;
  let maxSpeed = 0;
  let worstJump = 0;
  let where = '';
  for (let t = 0; t < program.total * 2; t += STEP) {
    const a = EyeExercises.at(program, t);
    if (prev && prev.step === a.step && a.step.kind === 'track') {
      const jump = Math.hypot(a.x - prev.x, a.y - prev.y);
      maxSpeed = Math.max(maxSpeed, jump / STEP);
      if (jump > worstJump) { worstJump = jump; where = `${a.step.exercise.id}: «${a.step.label}»`; }
    }
    prev = a;
  }
  const deg = maxSpeed * DEG_PER_UNIT;
  // допуск на разрыв растёт вместе со скоростью: за 0.02 с точка честно проходит больше
  const bad = worstJump > MAX_JUMP * speed || deg > PURSUIT_LIMIT;
  console.log(`${bad ? 'ПЛОХО ' : 'OK    '} все упражнения ×${speed}: ${Math.round(program.total)} с, скорость макс ${maxSpeed.toFixed(2)} поля/с ≈ ${deg.toFixed(1)}°/с (предел ${PURSUIT_LIMIT}°/с)`);
  if (worstJump > MAX_JUMP * speed) console.log(`         - разрыв ${worstJump.toFixed(3)} поля за ${STEP} с в ${where}`);
  if (bad) failed = true;
}

process.exit(failed ? 1 : 0);
