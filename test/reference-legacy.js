/* Эталонный отчёт: посчитан сторонним калькулятором (47 лет, старт 55, гарантия 15 лет).
   Собираем тот же расчёт вручную — по нему проверяется шаблон. */
function legacyCalc() {
  var first = 65886, ind = 0.08, rows = [], cum = 0;
  for (var age = 55, n = 0; age <= 100; age++, n++) {
    var ex = first * Math.pow(1 + ind, n); cum += 12 * ex;
    rows.push({ age: age, m: Math.floor(ex + 0.5), y: Math.floor(12 * ex + 0.5), cum: Math.floor(cum + 0.5), guaranteed: n < 15 });
  }
  return { ok: true, status: 'ok', tariff: { ind: ind }, mode: 'threshold', ageInt: 47, startAge: 55, startAgeInt: 55, deferral: 8,
    guarantee: 15, first: first, threshold: 9837712, premium: 9837712, savings: 5800000, redemption: 0,
    contribution: 0, dividend: 1082148, dividendRate: 0.11, topup: 2955564, rows: rows };
}
var client = { name: 'Арман Сейтов', nameGen: 'Армана Сейтова', sex: 'мужской', city: 'Алматы', calcDate: '2026-09-18' };
var agent = { name: 'Тимур Агентов', phone: '+7 700 000 00 00', email: 'agent@example.kz', city: 'Алматы' };
module.exports = { legacyCalc: legacyCalc, client: client, agent: agent };
