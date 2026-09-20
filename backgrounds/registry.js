// Реестр живых фонов. Каждый файл фона в этой папке вызывает BreathBackgrounds.register({...}).
//
// Контракт фона:
//   {
//     id: 'bubbles',                 // латиницей, совпадает с именем файла
//     name: 'Мыльные пузыри',        // название для настроек
//     create() {                     // новый экземпляр (состояние хранится в замыкании)
//       return {
//         resize(width, height) {},          // размеры в CSS-пикселях; вызывается до первого кадра и при смене размера
//         frame(ctx, t, dt, breath) {},      // t — секунды с запуска, dt — секунды с прошлого кадра (не больше 0.05)
//       };                                   // breath = { level: 0..1, phase: -1 | 0 | 1 | 2 | 3, running: boolean }
//     },
//   }
// Контекст уже масштабирован под плотность экрана: рисуем в CSS-пикселях.
// Каждый кадр фон закрашивает холст целиком и не рассчитывает на содержимое прошлого кадра.
(function (root) {
  'use strict';
  const items = [];
  root.BreathBackgrounds = {
    register(def) {
      if (!items.some((b) => b.id === def.id)) items.push(def);
    },
    list() {
      return items.slice();
    },
    get(id) {
      return items.find((b) => b.id === id) || null;
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
