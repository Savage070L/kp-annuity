/* ════ EnpfLib · общий вход (как lib/index.js) ════
 * Все экспорты модулей — свойствами window.EnpfLib; имена уникальны (иначе сборка падает). Создано tools/sync-enpf.js. */
(function (root) {
  'use strict';
  var L = root.EnpfLib;
  ["params-2026.js","data/mortality.js","actuarial.js","dates.js","sl-annuity.js","enpf-schedule.js","data/porog_table.js","data/forecast_tables.js","enpf-forecast.js","enpf-kszh.js","compare.js","enpf-api.js"].forEach(function (name) {
    var m = L.require(name);
    Object.keys(m).forEach(function (k) {
      if (k === 'default') return;
      if (Object.prototype.hasOwnProperty.call(L, k)) throw new Error('EnpfLib: имя ' + k + ' экспортируют два модуля');
      L[k] = m[k];
    });
  });
  L.MORTALITY = L.require('data/mortality.js').default;
})(typeof window !== 'undefined' ? window : globalThis);
