/* ════ EnpfLib · enpf-forecast.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/enpf-forecast.js
 * (sha256 747dea2add6e43b4…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Прогнозный пенсионный калькулятор ЕНПФ — точная офлайн-реплика API
 *   POST https://mobile.enpf.kz/JasperReports/api/EnpfCalculator2New
 * (страница https://www.enpf.kz/ru/elektronnye-servisy/calculator/index.php).
 *
 * forecastCalc(body, {today}) принимает то же тело запроса (32 строковых поля), что и API,
 * и возвращает тот же расшифрованный ответ: шесть сценариев EnpfCalculator{Pessimist|Realist|Optimist}[UIP]
 * и PensionAnnuityAsk — с теми же ключами, порядком ключей, типами (строки/числа) и округлениями.
 *
 * Модель восстановлена «чёрным ящиком» 05.10.2026 и сверена с живыми ответами
 * (docs/02 — накопления и порог, docs/03 — выплаты, docs/09 — сводная модель и пробы xc_*).
 * Это слияние реплик research/forecast_accum/replica.(py|js) и research/forecast_payout/replica.py,
 * плюс то, чего в них не было: режим изъятия (porogInputs) с отложенным ИПН, взносы ДПВ,
 * сценарии УИП (accumulateUip), тексты ошибок API, уточнённая таблица ОПВР.
 *
 * Точность (test/forecast.test.mjs, все сохранённые ответы): совпадают все ключи и значения, без исключений;
 * свежая живая сверка 05.10.2026 (test/live-fresh.mjs) — 30/30 случаев посимвольно после правок по её итогам
 * (ДПВ с PayoutAge = 0, ДПВ до пенсии при CalcType 2, ОППВ в УИП, срок отложенного ИПН, предел стажа, ОПВР).
 * Что держится на снимках 05.10.2026 и может устареть: порог ПМД (data/porog_table.json),
 * ОПВР по поколениям и параметры 2026 г. (data/forecast_tables.json), сдвиг X срока ИПН при изъятии
 * в текущем году (CURRENT_YEAR_IPN_SHIFT). Неокруглённые ОПВР восстановлены по самим пробам (Ж 1976 и М 1982 —
 * по свежим живым ответам, в выборке): для нового человека из «редкого» поколения возможна ошибка ±1 ₸ в TotalSum/Total.
 *
 * Главное о единицах: ВСЕ суммы ответа — в реальных тенге 2026 г. (без инфляции).
 * Сценарии отличаются только реальной доходностью: 0 % / 1 % / 2 % (+1 % на долю в УИП).
 *
 * Аннуитет CalcType = 2 считается через lib/actuarial.js по тарифу КСЖ ЕНПФ
 * (i = 8 %, ind = 7 %, α = 1,5 %, γ = 3 %, гарантийный период 0, таблица «Пенсионная»).
 *
 * Модуль без зависимостей, работает в браузере и в Node 22. Все функции чистые: дата расчёта
 * передаётся явно (today), по умолчанию — new Date().
 */
const { annuityFactor } = __EL.require('actuarial.js');
const POROG_TABLE = __EL.require('data/porog_table.js').default;
const FORECAST_TABLES = __EL.require('data/forecast_tables.js').default;



/** Адрес API (для справки; живые вызовы — в lib/enpf-api.js). */
const FORECAST_URL = 'https://mobile.enpf.kz/JasperReports/api/EnpfCalculator2New';

/** Сценарии без УИП в порядке расчёта. */
const FORECAST_SCENARIOS = Object.freeze(['Pessimist', 'Realist', 'Optimist']);
const SCENARIOS = FORECAST_SCENARIOS;

/** Порядок ключей верхнего уровня в ответе API. */
const TOP_ORDER = ['Realist', 'Optimist', 'Pessimist', 'PessimistUIP', 'RealistUIP', 'OptimistUIP'];

const P = FORECAST_TABLES.params;

/**
 * Сдвиг X (лет) в сроке отложенного ИПН при изъятии в ТЕКУЩЕМ году:
 * T = (год выхода − текущий год) + ((месяц выхода − 1) + день выхода/30)/12 − X.
 * X(05.10.2026) = 0,7409 (живые ответы: 0,740896–0,740905, калибровка в выборке). Зависимость X от даты расчёта
 * не установлена — на другую дату реплика помечает такой расчёт приближённым (notes.approximate), а канарейка
 * f_payoff_current_ipn (lib/drift.js) измеряет X заново.
 */
const CURRENT_YEAR_IPN_SHIFT = 0.7409;
/** Дата, на которую измерен CURRENT_YEAR_IPN_SHIFT. */
const CURRENT_YEAR_IPN_SHIFT_DATE = '2026-10-05';

// ===================================================================== даты ==========
// Даты — простые объекты {y, m, d}: так нет зависимости от часового пояса.

const pad2 = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayIndex = (t) => Date.UTC(t.y, t.m - 1, t.d) / 86400000;
const cmpDate = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);

/** 'дд.мм.гггг' → {y, m, d} или null, если строка не дата. */
function parseDmy(s) {
  const mt = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(String(s == null ? '' : s));
  if (!mt) return null;
  const t = { y: +mt[3], m: +mt[2], d: +mt[1] };
  if (t.m < 1 || t.m > 12 || t.d < 1 || t.d > daysInMonth(t.y, t.m)) return null;
  return t;
}

/** {y, m, d} → 'дд.мм.гггг'. */
function fmtDmy(t) {
  return pad2(t.d) + '.' + pad2(t.m) + '.' + t.y;
}

/**
 * Дата расчёта → {y, m, d}. Принимает Date (берутся местные дата и месяц), 'гггг-мм-дд' или 'дд.мм.гггг'.
 * @param {Date|string} [today=new Date()]
 */
function normalizeToday(today = new Date()) {
  if (today instanceof Date) {
    if (isNaN(today.getTime())) throw new Error('Неверная дата расчёта');
    return { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  }
  if (today && typeof today === 'object' && Number.isInteger(today.y)) return { y: today.y, m: today.m, d: today.d };
  const s = String(today);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const t = parseDmy(s);
  if (t) return t;
  throw new Error('Неверная дата расчёта: ' + s);
}

/**
 * Прибавить k месяцев как Oracle ADD_MONTHS (сервер ЕНПФ): последний день месяца переходит в последний день
 * месяца (28.02.1981 + 756 мес. = 29.02.2044 — так в ответе ЕНПФ 06.10.2026, аудит p10/p19), иначе день —
 * min(день, число дней месяца).
 */
function addMonths(t, k) {
  const idx = t.m - 1 + k;
  const y = t.y + Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12 + 1;
  const lastDay = t.d === daysInMonth(t.y, t.m);
  return { y, m, d: lastDay ? daysInMonth(y, m) : Math.min(t.d, daysInMonth(y, m)) };
}

/** Число полных лет на дату on. */
function completedAge(bd, on) {
  return on.y - bd.y - ((on.m < bd.m || (on.m === bd.m && on.d < bd.d)) ? 1 : 0);
}

/** Строка числа как у API: 63 → "63", 61.5 → "61.5". */
const numStr = (x) => String(+x);

// ===================================================================== округления =====

/** Округление «половина вверх», как в ответах API (2854,5 → 2855). */
const roundHalfUp = (x) => Math.floor(x + 0.5);

/** KoefZam: округление до 0,1 точного двоичного значения (toFixed); совпало на всех сохранённых ответах. */
function round1(x) {
  return Number(x.toFixed(1));
}

// ===================================================================== правила ========

/** Требуемый пенсионный возраст женщин в календарном году (СК РК ст. 207, как в API). */
function womenRequiredAge(year) {
  const W = FORECAST_TABLES.womenRetirementAge;
  const years = Object.keys(W).map(Number).sort((a, b) => a - b);
  if (year <= years[0]) return W[years[0]];
  if (year >= years[years.length - 1]) return W[years[years.length - 1]];
  return W[year];
}

/**
 * Дата и возраст выхода на пенсию, как в API: мужчины — 63; женщины — первая дата
 * «рождение + a лет» (a = 61; 61,5; …; 63), где a не меньше требуемого возраста в году этой даты.
 * @param {'M'|'F'} sex
 * @param {{y:number,m:number,d:number}} birth
 * @returns {{date:{y:number,m:number,d:number}, age:number}}
 */
function retirementDate(sex, birth) {
  const men = FORECAST_TABLES.menRetirementAge;
  if (sex === 'M') return { date: addMonths(birth, men * 12), age: men };
  for (let a = 61; a <= 63; a += 0.5) {
    const d = addMonths(birth, Math.round(a * 12));
    if (a >= womenRequiredAge(d.y)) return { date: d, age: a };
  }
  return { date: addMonths(birth, 63 * 12), age: 63 };
}

/**
 * Дата и возраст выхода на пенсию по правилу прогнозного калькулятора ЕНПФ.
 * @param {'M'|'F'} sex
 * @param {string} birthDate  'дд.мм.гггг'
 * @returns {{date: string, age: number}}  date — 'дд.мм.гггг'; age — 63 у мужчин, 61…63 у женщин (бывает 61,5 и 62,5)
 */
function forecastRetirement(sex, birthDate) {
  const b = parseDmy(birthDate);
  if (!b) throw new Error('Неверная дата рождения: ' + birthDate);
  const { date, age } = retirementDate(String(sex).trim().toUpperCase() === 'F' ? 'F' : 'M', b);
  return { date: fmtDmy(date), age };
}

/** Доля года от даты до 31.12 по правилу ЕНПФ: ((31 − день)/31 + месяцев до конца года)/12. */
const fracRestOfYear = (t) => ((P.dayDivisor - t.d) / P.dayDivisor + (12 - t.m)) / 12;
/** Доля года от 01.01 до даты: ((месяц − 1) + (день − 1)/31)/12. */
const fracFromJan1 = (t) => ((t.m - 1) + (t.d - 1) / P.dayDivisor) / 12;

/**
 * Календарные отрезки (год, месяцев) между датами по правилу ЕНПФ:
 * в одном году (m2 − m1) + (d2 − d1)/31; иначе первый (12 − m1) + (31 − d1)/31,
 * полные годы по 12, последний (m2 − 1) + (d2 − 1)/31.
 */
function segments(from, to) {
  if (cmpDate(to, from) <= 0) return [];
  const D = P.dayDivisor;
  if (from.y === to.y) return [[from.y, (to.m - from.m) + (to.d - from.d) / D]];
  const seg = [[from.y, (12 - from.m) + (D - from.d) / D]];
  for (let y = from.y + 1; y < to.y; y++) seg.push([y, 12]);
  seg.push([to.y, (to.m - 1) + (to.d - 1) / D]);
  return seg;
}
const monthsBetween = (from, to) => segments(from, to).reduce((s, [, m]) => s + m, 0);

/** Зарплата (в месяц) в календарном году: рост с 01.01 следующего года — % (сложный) или +тенге в год. */
function salaryInYear(q, year, curYear) {
  const n = year - curYear;
  if (!q.enlargeSal) return q.salary;
  if (q.enlargeType) return q.salary * Math.pow(1 + q.enlargePercent / 100, n);
  return q.salary + q.enlargeTenge * n;
}

/**
 * Накопления по годам (остаток на 01.01) и на дату выхода — формула docs/02 §4:
 *   B(01.01.Y+1) = S0·(1+R)^τ0 + C·τ0·(1+R)^(τ0/2),  B(y+1) = B(y)·(1+R) + C_y·(1+R)^0,5,
 *   S_ret = B(01.01.Y_ret)·(1+R)^τr + C·τr·(1+R)^(τr/2),
 * где C_y — годовые взносы. withdrawal {year, amount}: изъятие на 01.01.year (в текущем году — на сегодня).
 */
function accumulate({ S0, R, today, ret, contrib, withdrawal }) {
  const balances = {};
  let s0 = S0;
  if (withdrawal && withdrawal.year === today.y) s0 -= withdrawal.amount;
  balances[today.y] = s0;
  if (ret.y === today.y) {
    const t = fracFromJan1(ret) - fracFromJan1(today);
    const c = contrib(today.y);
    return { balances, sRet: s0 * Math.pow(1 + R, t) + c * t * Math.pow(1 + R, t / 2) };
  }
  const tau0 = fracRestOfYear(today);
  const tauR = fracFromJan1(ret);
  let c = contrib(today.y);
  let b = s0 * Math.pow(1 + R, tau0) + c * tau0 * Math.pow(1 + R, tau0 / 2);
  let y = today.y + 1;
  if (withdrawal && withdrawal.year === y) b -= withdrawal.amount;
  balances[y] = b;
  while (y < ret.y) {
    c = contrib(y);
    b = b * (1 + R) + c * Math.pow(1 + R, 0.5);
    y += 1;
    if (withdrawal && withdrawal.year === y) b -= withdrawal.amount;
    balances[y] = b;
  }
  c = contrib(ret.y);
  return { balances, sRet: b * Math.pow(1 + R, tauR) + c * tauR * Math.pow(1 + R, tauR / 2) };
}

/**
 * Накопления ОПВ в сценарии с переводом доли в УИП (сценарии *UIP при PayoffDegree > 0).
 * Восстановлено по 5 сохранённым пробам (15 сценариев) — совпадение накоплений до 0,05 ₸ [вероятно]:
 *   два «кармана»: U — в УИП (доходность R + 1 %), B — у ЕНПФ (доходность R);
 *   сегодня U = d·S0, B = (1 − d)·S0, где d = PayoffDegree/100; все взносы идут в B;
 *   начиная с 01.01 года (текущий + 2) каждое 01.01 карманы перераспределяются:
 *   U = d·(U + B − взносы прошлого года), B — остальное (взносы попадают в УИП с лагом ≈ 1,5 года).
 * Той же функцией считаются и ОППВ в сценариях *UIP (их ЕНПФ тоже переводит в УИП той же долей) [проверено, F10/X1].
 * Изъятие (porogInputs) в сочетании с УИП не проверялось: снимается из кармана B [гипотеза].
 */
function accumulateUip({ S0, R, today, ret, contrib, share, extra, withdrawal }) {
  const Ru = R + extra;
  let s0 = S0;
  if (withdrawal && withdrawal.year === today.y) s0 -= withdrawal.amount;
  let U = share * s0;
  let B = (1 - share) * s0;
  if (ret.y === today.y) {
    const t = fracFromJan1(ret) - fracFromJan1(today);
    const c = contrib(today.y);
    return U * Math.pow(1 + Ru, t) + B * Math.pow(1 + R, t) + c * t * Math.pow(1 + R, t / 2);
  }
  const tau0 = fracRestOfYear(today);
  const tauR = fracFromJan1(ret);
  let N = contrib(today.y) * tau0 * Math.pow(1 + R, tau0 / 2); // взносы последнего (неполного) года
  U *= Math.pow(1 + Ru, tau0);
  B = B * Math.pow(1 + R, tau0) + N;
  for (let y = today.y + 1; ; y++) {
    if (withdrawal && withdrawal.year === y) B -= withdrawal.amount;
    if (y >= today.y + 2) {
      const tot = U + B;
      U = share * (tot - N);
      B = tot - U;
    }
    if (y === ret.y) break;
    N = contrib(y) * Math.pow(1 + R, 0.5);
    U *= 1 + Ru;
    B = B * (1 + R) + N;
  }
  const c = contrib(ret.y);
  return U * Math.pow(1 + Ru, tauR) + B * Math.pow(1 + R, tauR) + c * tauR * Math.pow(1 + R, tauR / 2);
}

/** Рост суммы по календарным отрезкам с ежемесячным взносом monthly(y) «в середине отрезка» (ДПВ). */
function growSegments(S0, R, from, to, monthly) {
  let S = S0;
  for (const [y, m] of segments(from, to)) {
    S = S * Math.pow(1 + R, m / 12) + monthly(y) * m * Math.pow(1 + R, m / 24);
  }
  return S;
}

/**
 * Базовая пенсия: ПМ × min(MAX(год выхода); 0,70 + 0,02 × max(0; ⌊T⌋ − 10)),
 * T = Exp1998 + ExpYear + (дней до выхода/365) × PeriodPayOPV/12 (docs/03 §4).
 */
function basicPension(q, today, ret) {
  const T = q.exp1998 + q.expYear + Math.max(0, dayIndex(ret) - dayIndex(today)) / 365 * q.periodPay / 12;
  let share = P.basicMin + P.basicStep * Math.max(0, Math.floor(T + 1e-9) - P.basicFreeYears);
  const max = P.basicMaxByRetYear[ret.y] !== undefined ? P.basicMaxByRetYear[ret.y] : P.basicMaxDefault;
  share = Math.min(share, max);
  return { amount: P.PM * share, T, share };
}

/** Средняя зарплата за 36 месяцев до выхода (вес последнего года (м − 1) + (д − 1)/31, далее назад). */
function salaryForSolidarity(q, ret, curYear) {
  const last = (ret.m - 1) + (ret.d - 1) / P.dayDivisor;
  const w = [[ret.y, Math.min(last, 36)]];
  let left = 36 - w[0][1];
  let y = ret.y - 1;
  while (left > 1e-12) {
    const m = Math.min(12, left);
    w.push([y, m]);
    left -= m;
    y -= 1;
  }
  let s = 0;
  for (const [yy, m] of w) s += salaryInYear(q, Math.max(yy, curYear), curYear) * m;
  return s / 36;
}

/**
 * Солидарная пенсия: max(0,6·min(З̄·Period/12; 55 МРП); МП·1,02^(год выхода − 2026)) × min(1; Exp1998/N),
 * N = 25 (М) / 20 (Ж) (docs/03 §5).
 */
function solidarityPension(q, sex, ret, curYear) {
  if (!(q.exp1998 > 0)) return 0;
  const avg = salaryForSolidarity(q, ret, curYear);
  const base = P.solRate * Math.min(avg * q.periodPay / 12, P.solCapMrp * P.MRP);
  const floor = P.MP * Math.pow(1 + P.mpGrowthReal, ret.y - P.year);
  return Math.max(base, floor) * Math.min(1, q.exp1998 / P.solFullYears[sex]);
}

/** ОПВР — средняя выплата по поколению (таблица ЕНПФ), не зависит от ввода. */
function opvrPayment(sex, birth) {
  const T = FORECAST_TABLES.opvr;
  if (birth.y < T.minBirthYear) return 0;
  const v = T[sex][String(birth.y)];
  return v === undefined ? T.cap : v;
}

/**
 * Лет до исчерпания: выплата в начале месяца, остаток растёт помесячно (1+r)^(1/12),
 * лет = ⌈число платежей/12⌉ (docs/03 §6.3).
 */
function yearsToExhaust(S, pay, r) {
  if (pay <= 0) return 0;
  if (r === 0) return Math.ceil(S / pay / 12 - 1e-12);
  const j = Math.pow(1 + r, 1 / 12) - 1;
  const d = j / (1 + j);
  const x = 1 - (S / pay) * d;
  if (x <= 0) return 999;
  const n = -Math.log(x) / Math.log(1 + j);
  return Math.ceil(n / 12 - 1e-12);
}

/**
 * Выплата из ЕНПФ по графику (ОПВ или ОППВ): единовременно, если S ≤ 12·МП·1,02^n;
 * иначе max(70 % ПМ; S·6,5 %·K/12) постоянно (в реальных тенге) до исчерпания.
 */
function enpfPayment(S, coef, r, retYear) {
  if (!(S > 0)) return { pay: 0, years: 0, lump: false };
  const lumpLimit = P.lumpSumMpMultiple * P.MP * Math.pow(1 + P.mpGrowthReal, retYear - P.year);
  if (S <= lumpLimit) return { pay: S, years: 1, lump: true };
  const pay = Math.max(P.floorPmShare * P.PM, S * P.payoutRate * coef / 12);
  return { pay, years: yearsToExhaust(S, pay, r), lump: false };
}

const annuityCache = new Map();
/**
 * Коэффициент ä аннуитета прогноза ЕНПФ (тариф КСЖ ЕНПФ, g = 0) для пола и целого возраста выхода.
 * PensionAnnuity = премия / ä. Примеры 1/ä: М63 0,0044253834; Ж61 0,0033038815; Ж62 0,0033979337; Ж63 0,0034972998.
 * @param {'M'|'F'} sex
 * @param {number} age  возраст выхода (дробная часть отбрасывается: 61,5 → тариф 61)
 * @returns {number} ä — премия на 1 ₸ первой ежемесячной выплаты
 */
function forecastAnnuityFactor(sex, age) {
  const x = Math.floor(age);
  const key = sex + x;
  if (!annuityCache.has(key)) {
    const t = FORECAST_TABLES.annuityTariff;
    annuityCache.set(key, annuityFactor({
      sex, age: x, guaranteeYears: t.guaranteeYears, i: t.i, ind: t.ind,
      alpha: t.alpha, gamma: t.gamma, table: t.table,
    }));
  }
  return annuityCache.get(key);
}

/** Коэффициент 1,45: вредный стаж + (при ОППВ) годы до пенсии ≥ 5 (docs/03 §7). */
function harmfulCoef(q, today, ret) {
  let yrs = q.expVred;
  if (q.oppv) yrs += monthsBetween(today, ret) / 12;
  return yrs >= P.harmfulYears - 1e-9 ? P.harmfulCoef : 1;
}

/**
 * ДПВ: фиксированная PayoutMonth каждый месяц до исчерпания (в начале месяца, рост (1+r)^(1/12)).
 * Значение строки года выплат = min(PayoutMonth; выплачено за год) — особенность API.
 */
function dpvSchedule(S, monthly, r, maxYears = 70) {
  const out = [];
  let B = S;
  const j = Math.pow(1 + r, 1 / 12);
  for (let k = 0; k < maxYears; k++) {
    let paid = 0;
    for (let m = 0; m < 12; m++) {
      const p = Math.min(monthly, Math.max(B, 0));
      B = (B - p) * j;
      paid += p;
    }
    out.push(Math.min(monthly, paid));
    if (B <= 1e-6) break;
  }
  return out;
}

// ===================================================================== порог ==========

/**
 * Порог ПМД из снимка API: текущий год — по возрасту на сегодня, будущие — по возрасту на 01.01.
 * Год вне снимка → null; возраст вне снимка → ближайший снятый (год добавляется в clamped).
 */
function porogLookup(year, birth, today, clamped = []) {
  if (year === today.y) {
    const cur = POROG_TABLE.porog_current_year_by_age_today;
    const ks = Object.keys(cur).map(Number);
    const age = completedAge(birth, today);
    const a = Math.min(Math.max(age, Math.min(...ks)), Math.max(...ks));
    if (a !== age) clamped.push(year);
    return cur[String(a)];
  }
  const row = POROG_TABLE.porog_future[String(year)];
  if (!row) return null;
  const a = completedAge(birth, { y: year, m: 1, d: 1 });
  if (row[String(a)] !== undefined) return row[String(a)];
  // вне снятого диапазона — ближайший возраст в этом году (плато у старших возрастов)
  const ks = Object.keys(row).map(Number);
  const a2 = ks.reduce((b, x) => (Math.abs(x - a) < Math.abs(b - a) ? x : b), ks[0]);
  clamped.push(year);
  return row[String(a2)];
}

/**
 * AvailableAmount: по годам от текущего до года выхода max(0; round(B(01.01.год) − порог)),
 * текущий год — SumOPV − порог по возрасту сегодня; в списке только годы с amountOpt > 0 (docs/02 §6).
 */
function availableAmounts(balances, birth, today, ret, warnings) {
  const out = [];
  const clamped = [];
  const missing = [];
  for (let y = today.y; y <= ret.y; y++) {
    const pr = porogLookup(y, birth, today, clamped);
    if (pr == null) {
      missing.push(y);
      continue;
    }
    if (balances.Optimist[y] === undefined) continue;
    let sub = pr;
    if (y === ret.y && ret.m === 1 && ret.d === 1 && y - 1 > today.y) {
      // крайний случай (1 проба): выход 01.01.Y — сумма по порогу 31.12.(Y−1), показан порог года Y
      const prev = POROG_TABLE.porog_future[String(y - 1)] || {};
      const a = completedAge(birth, { y: y - 1, m: 12, d: 31 });
      if (prev[String(a)] !== undefined) sub = prev[String(a)];
    }
    const amt = (sc) => Math.max(0, roundHalfUp(balances[sc][y] - sub));
    const row = { year: y, amountPes: amt('Pessimist'), amountReal: amt('Realist'), amountOpt: amt('Optimist'), amountPorog: pr };
    if (row.amountOpt > 0) out.push(row);
  }
  // список лет компактно: 2026, 2030–2033
  const span = (a) => a.reduce((acc, y) => {
    const last = acc[acc.length - 1];
    if (last && y === last[1] + 1) last[1] = y; else acc.push([y, y]);
    return acc;
  }, []).map(([a1, b1]) => (a1 === b1 ? String(a1) : a1 + '–' + b1)).join(', ');
  if (clamped.length) {
    warnings.push('Порог ПМД снят для возрастов 20–62 и поколений 1964–2006: для ' + span(clamped) +
      ' гг. взят порог ближайшего снятого возраста — AvailableAmount может отличаться от ЕНПФ.');
  }
  if (missing.length) warnings.push('Нет порога ПМД в снимке для ' + span(missing) + ' гг. — эти годы пропущены в AvailableAmount.');
  return out;
}

// ===================================================================== запрос =========

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const toNum = (v) => (isBlank(v) ? 0 : Number(String(v).trim()));
const toBool = (v) => String(v).trim() === 'true';

/** Тело запроса (строки) → числа и флаги. */
function normalizeBody(b) {
  return {
    sex: String(b.Sex).trim().toUpperCase(),
    birth: parseDmy(b.BirthDate),
    exp1998: toNum(b.Exp1998),
    expVred: toNum(b.ExpVred),
    expYear: toNum(b.ExpYear),
    salary: toNum(b.AverageSal),
    enlargeSal: toBool(b.EnlargeSal),
    enlargeType: toBool(b.EnlargeType),
    enlargeTenge: toNum(b.EnlargeTenge),
    enlargePercent: toNum(b.EnlargePercent),
    payoffDegree: toNum(b.PayoffDegree),
    periodPay: isBlank(b.PeriodPayOPV) ? 12 : toNum(b.PeriodPayOPV),
    opv: toBool(b.OPV),
    sumOpv: toNum(b.SumOPV),
    oppv: toBool(b.OPPV),
    sumOppv: toNum(b.SumOPPV),
    opvr: toBool(b.OPVR),
    sumOpvr: toNum(b.SumOPVR),
    dpv: toBool(b.DPV),
    sumDpv: toNum(b.SumDPV),
    dpvTypePercent: toBool(b.SumDPVtype),
    dpvTenge: toNum(b.SumDPVtenge),
    dpvPercent: toNum(b.SumDPVpercent),
    periodPayDpv: isBlank(b.PeriodPayDPV) ? 0 : toNum(b.PeriodPayDPV),
    payoutAge: toNum(b.PayoutAge),
    payoutMonth: toNum(b.PayoutMonth),
    lang: String(b.Lang == null ? '0' : b.Lang).trim(),
    calcType: String(b.CalcType == null ? '1' : b.CalcType).trim(),
    porogInputs: toBool(b.porogInputs),
    payoffYear: toNum(b.payoffYear),
    payoffAmount: toNum(b.payoffAmount),
    payoffIpnType: String(b.payoffIpnType == null ? '0' : b.payoffIpnType).trim(),
  };
}

function errorText(key, lang) {
  const E = FORECAST_TABLES.errors;
  if (lang === '1' && E.kz[key]) return E.kz[key];
  return E.ru[key];
}

/**
 * Проверки, которые делает сервер (тексты — как в API; docs/01 §11, docs/09 §5, пробы).
 * Порядок проверок сервера известен не полностью: первыми идут пустые/нечисловые поля.
 * @returns {null | {code:'-1', message:string}}
 */
function validateForecastBody(body, today) {
  const td = normalizeToday(today);
  const lang = String(body && body.Lang != null ? body.Lang : '0').trim();
  const fail = (key) => ({ code: '-1', message: errorText(key, lang) });
  const badNum = (v) => isBlank(v) || !Number.isFinite(Number(String(v).trim()));
  if (!body || typeof body !== 'object') return fail('technical');
  // пустые и нечисловые суммы [проверено для SumOPV и AverageSal]
  if (badNum(body.SumOPV)) return fail('sumOpvInvalid');
  if (badNum(body.AverageSal)) return fail('salaryInvalid');
  if (toBool(body.OPPV) && badNum(body.SumOPPV)) return fail('sumOppvInvalid');     // [по аналогии]
  if (toBool(body.OPVR) && badNum(body.SumOPVR)) return fail('sumOpvrInvalid');     // [по аналогии]
  if (toBool(body.DPV) && badNum(body.SumDPV)) return fail('sumDpvInvalid');        // [по аналогии]
  const q = normalizeBody(body);
  if (!q.birth || (q.sex !== 'M' && q.sex !== 'F')) return fail('technical');
  if (q.payoffDegree > P.uipMaxPercent) return fail('uipOver50');
  // возраст получения ДПВ проверяется раньше пенсионного возраста [проверено: fresh_11, fresh_12];
  // PayoutAge = "0" при DPV = "true" сервер тоже отвергает этим текстом [проверено: test/live-fresh.mjs F06, 05.10.2026]
  if (q.dpv && q.payoutAge < completedAge(q.birth, td)) return fail('dpvAgeBelowCurrent');
  const { date: ret } = retirementDate(q.sex, q.birth);
  if (cmpDate(ret, td) <= 0) return fail('retired');
  // стаж в накопительной системе ≤ дробного числа лет от max(01.01.1998; ДР) до сегодня (дни/365,25)
  // [проверено живыми ответами 05.10.2026: при пределе 28,758 ExpYear 29,00 и 29,25 отвергнуты, 28,48 принят;
  //  точная граница внутри (28,48; 29,00) — test/live-fresh.mjs F19, X4]
  const JAN1_1998 = { y: 1998, m: 1, d: 1 };
  const from1998 = cmpDate(q.birth, JAN1_1998) > 0 ? q.birth : JAN1_1998;
  if (q.expYear > (dayIndex(td) - dayIndex(from1998)) / 365.25 + 1e-9) return fail('stazhTooLong');
  // AverageSal = "0" → сервер падает на делении («Техническая ошибка») [проверено]
  if (!(q.salary > 0)) return fail('technical');
  return null;
}

// ===================================================================== расчёт =========

/**
 * Общие для всех сценариев величины (не зависят от доходности).
 */
function commonPart(q, today) {
  const sex = q.sex;
  const birth = q.birth;
  const { date: ret, age } = retirementDate(sex, birth);
  // SalaryBeforePension — зарплата календарного года последнего рабочего дня (выход − 1 день):
  // при выходе 01.01 берётся прошлый год [проверено]
  const lastWorkYear = (ret.m === 1 && ret.d === 1) ? ret.y - 1 : ret.y;
  const salRet = salaryInYear(q, lastWorkYear, today.y);
  const basic = basicPension(q, today, ret);
  const sol0 = solidarityPension(q, sex, ret, today.y);
  const opvr = opvrPayment(sex, birth);
  const coef = harmfulCoef(q, today, ret);
  const ct2 = q.calcType === '2';
  // ДПВ: флаг (возраст получения задан) и «включённые выплаты» (ещё и сумма выплаты > 0)
  const dpvFlag = q.dpv && q.payoutAge > 0;
  const dpvOn = dpvFlag && q.payoutMonth > 0;
  let dpvStart = null;
  if (dpvFlag) {
    dpvStart = addMonths(birth, Math.round(q.payoutAge * 12));
    if (cmpDate(dpvStart, today) < 0) dpvStart = today;
  }
  const firstYear = dpvFlag ? Math.min(ret.y, dpvStart.y) : ret.y;
  return { sex, birth, ret, age, salRet, basic, sol0, opvr, coef, ct2, dpvFlag, dpvOn, dpvStart, firstYear };
}

/** Годовые взносы ОПВ/ОППВ и ежемесячные ДПВ. */
function contribFns(q, today) {
  const cap = P.opvCapMzp * P.MZP;
  return {
    opv: (y) => q.periodPay * P.opvRate * Math.min(salaryInYear(q, y, today.y), cap),
    oppv: q.oppv ? (y) => q.periodPay * P.oppvRate * salaryInYear(q, y, today.y) : () => 0,
    dpvMonthly: (y) => {
      if (!q.dpv) return 0;
      const per = q.periodPayDpv / 12;
      return (q.dpvTypePercent ? q.dpvPercent / 100 * salaryInYear(q, y, today.y) : q.dpvTenge) * per;
    },
  };
}

/**
 * Один сценарий. R — реальная доходность; uip — {share, extra} для сценариев УИП; payoff — изъятие.
 * Возвращает поля ответа API (кроме AvailableAmount) и служебные величины.
 */
function runScenario(q, today, C, fns, sc, R, { uip = null, payoff = null, debug = false } = {}) {
  const { ret, age, sex } = C;
  // --- накопления ОПВ (с изъятием и УИП) ---
  const S0opv = q.opv ? q.sumOpv : 0;
  const withdrawal = payoff && payoff.amount > 0 ? { year: payoff.year, amount: payoff.amount } : null;
  const accOpv = accumulate({ S0: S0opv, R, today, ret, contrib: fns.opv, withdrawal });
  const sOpv = uip
    ? accumulateUip({ S0: S0opv, R, today, ret, contrib: fns.opv, share: uip.share, extra: uip.extra, withdrawal })
    : accOpv.sRet;
  // ОППВ в сценариях *UIP переводятся в УИП той же долей и по той же схеме «двух карманов», что и ОПВ
  // [проверено: test/live-fresh.mjs F10 и контроль X1 вне выборки, 05.10.2026]
  const sOppv = !q.oppv ? 0 : (uip
    ? accumulateUip({ S0: q.sumOppv, R, today, ret, contrib: fns.oppv, share: uip.share, extra: uip.extra })
    : accumulate({ S0: q.sumOppv, R, today, ret, contrib: fns.oppv }).sRet);
  // --- ДПВ ---
  let dpvRows = {};
  let nDpv = 0;
  let sDpvLeft = 0;
  if (q.dpv) {
    const toStart = C.dpvFlag && cmpDate(C.dpvStart, ret) < 0 ? C.dpvStart : ret;
    sDpvLeft = growSegments(q.sumDpv, R, today, toStart, fns.dpvMonthly);
    if (C.dpvOn) {
      const sDpv0 = C.dpvFlag ? growSegments(q.sumDpv, R, today, C.dpvStart, fns.dpvMonthly) : sDpvLeft;
      const sched = dpvSchedule(sDpv0, q.payoutMonth, R);
      nDpv = sched.length;
      sched.forEach((v, k) => { dpvRows[C.dpvStart.y + k] = v; });
      if (cmpDate(C.dpvStart, ret) < 0) {
        // остаток ДПВ на дату выхода после ранних выплат
        let B = sDpv0;
        const j = Math.pow(1 + R, 1 / 12);
        const nm = roundHalfUp(monthsBetween(C.dpvStart, ret));
        for (let k = 0; k < nm; k++) B = Math.max(0, B - q.payoutMonth) * j;
        sDpvLeft = B;
      }
    } else if (C.dpvFlag) {
      nDpv = 141; // API: при PayoutMonth = 0 отдаёт «141» (мусорное значение) [проверено]
    }
  }
  const dpvHdr = dpvRows[ret.y] || 0;
  // --- выплаты ---
  let opv = { pay: 0, years: 0, lump: false };
  let oppv = { pay: 0, years: 0, lump: false };
  let pa = 0;
  let askOk = false;
  const floor = P.floorPmShare * P.PM;
  const ipn = payoff ? payoff.ipn : 0;
  const deferredIpn = !!payoff && payoff.ipnType === '0' && ipn > 0;
  // CalcType=2: если выплаты ДПВ начались до пенсии, остаток ДПВ в премию аннуитета НЕ идёт (ДПВ платятся по своему
  // графику; живая премия = накопления ОПВ (+ОППВ) до 1e-6) [проверено: test/live-fresh.mjs F08 и контроль X2]
  const dpvPaidBeforeRet = C.dpvOn && cmpDate(C.dpvStart, ret) < 0;
  let premium = sOpv + sOppv + (dpvPaidBeforeRet ? 0 : sDpvLeft);
  // CalcType=2 и отложенный ИПН: ИПН (Ipn1, округлённый, в реальных тенге) вычитается из премии [проверено на P9]
  if (C.ct2 && deferredIpn) premium -= ipn;
  if (C.ct2) {
    pa = premium / forecastAnnuityFactor(sex, age);
    if (pa < floor - 0.5) {
      // мало на аннуитет ≥ 70 % ПМ: API откатывается к графику ЕНПФ; в ПЕССИМИСТИЧНОМ сценарии
      // ещё и показывает недостаточный аннуитет (двойной счёт в TotalSum) [проверено, ошибка API]
      opv = enpfPayment(sOpv, C.coef, R, ret.y);
      if (sOppv > 0) oppv = enpfPayment(sOppv, C.coef, R, ret.y);
      if (sc !== 'Pessimist') pa = 0;
    } else if (C.dpvOn && cmpDate(C.dpvStart, ret) >= 0) {
      nDpv = 0; // ДПВ ещё не начались — ушли в премию, срок показывается 0
    }
  } else {
    opv = enpfPayment(sOpv, C.coef, R, ret.y);
    if (sOppv > 0) oppv = enpfPayment(sOppv, C.coef, R, ret.y);
    askOk = premium / forecastAnnuityFactor(sex, age) >= floor - 0.5;
  }
  // --- отложенный ИПН с изъятия (CalcType=1): удерживается равными долями из выплат ОПВ 16 лет (192 мес.);
  // доля фиксирована в номинале, поэтому в реальных тенге убывает на 5 % в год:
  //   D_k = ИПН/192 / 1,05^(T + k),  T — срок от изъятия до выхода (см. payoffs в forecastCalc) ---
  let deduct = () => 0;
  if (!C.ct2 && deferredIpn && opv.pay > 0 && !opv.lump) {
    const months = P.deferredIpnYears * 12;
    const T = payoff.ipnYears;
    deduct = (k) => (k < P.deferredIpnYears ? ipn / months / Math.pow(1 + P.deferredIpnInflation, T + k) : 0);
  }
  const opvHdr = opv.pay - deduct(0);
  const total = C.basic.amount + C.sol0 + opvHdr + C.opvr + oppv.pay + pa + dpvHdr;
  // --- таблица ---
  const rows = [];
  const debugRows = debug ? [] : null;
  for (let i = 0; i < P.tableRows; i++) {
    const y = C.firstYear + i;
    const k = y - ret.y;
    const on = k >= 0;
    const rb = on ? C.basic.amount : 0;
    const rs = on ? C.sol0 * Math.pow(1 + P.solIndexReal, k) : 0;
    // CalcType=2: колонки ОПВ/ОППВ в таблице всегда 0, даже при откате шапки к графику
    const ro = (on && k < opv.years && !C.ct2) ? opv.pay - deduct(k) : 0;
    const rpp = (on && k < oppv.years && !C.ct2) ? oppv.pay : 0;
    const rvr = on ? C.opvr : 0;
    const rpa = on ? pa * Math.pow(1 + P.annuityIndexReal, k) : 0;
    const rd = dpvRows[y] || 0;
    const tot = rb + rs + ro + rvr + rpp + rpa + rd;
    if (debugRows) debugRows.push({ total: tot, opvr: rvr });
    rows.push({
      Year: String(y), Age: numStr(age + k),
      BasicPension: roundHalfUp(rb), SolidarityPension: roundHalfUp(rs), OPV: roundHalfUp(ro),
      OPVR: roundHalfUp(rvr), OPPV: roundHalfUp(rpp), DPV: roundHalfUp(rd), Total: roundHalfUp(tot),
      KoefZam: C.salRet ? round1(tot / C.salRet * 100) : 0, PensAnnuity: roundHalfUp(rpa),
    });
  }
  const fields = {
    Retirement: { Dt: fmtDmy(ret), Age: numStr(age) },
    PaymentBegin: sc === 'Pessimist' ? {}
      : (C.dpvFlag ? { Dt: fmtDmy(C.dpvStart), Age: numStr(q.payoutAge) } : { Age: '0' }),
    NumOfYearsBeforeExhAccumOPV: String(opv.years),
    NumOfYearsBeforeExhAccumOPPV: String(oppv.years),
    NumOfYearsBeforeExhAccumDPV: String(nDpv),
    SolidarityPension: String(roundHalfUp(C.sol0)),
    BasicPension: String(roundHalfUp(C.basic.amount)),
    EnpfPensionOPV: String(roundHalfUp(opvHdr)),
    EnpfPensionOPVR: String(roundHalfUp(C.opvr)),
    EnpfPensionOPPV: String(roundHalfUp(oppv.pay)),
    EnpfPensionDPV: String(roundHalfUp(dpvHdr)),
    TotalSum: String(roundHalfUp(total)),
    SalaryBeforePension: String(roundHalfUp(C.salRet)),
    Koef: C.salRet ? roundHalfUp(total / C.salRet * 100) + '%' : '0%',
    PensionAnnuity: String(roundHalfUp(pa)),
  };
  return {
    fields, rows, askOk,
    detail: {
      yield: R,
      uip: !!uip,
      sRetOpv: sOpv,
      sRetOppv: sOppv,
      sDpvAtRetirement: sDpvLeft,
      balancesOpv: uip ? null : accOpv.balances,
      opvPayment: opv.pay,
      opvYears: opv.years,
      opvLumpSum: opv.lump,
      oppvPayment: oppv.pay,
      oppvYears: oppv.years,
      annuityPremium: C.ct2 ? premium : 0,
      pensionAnnuity: pa,
      totalUnrounded: total,
      ...(debug ? { rowsUnrounded: debugRows } : {}),
    },
  };
}

/**
 * Расчёт прогноза ЕНПФ офлайн — точная реплика API EnpfCalculator2New.
 *
 * @param {object} body  тело запроса API (32 строковых поля, как формирует buildForecastBody)
 * @param {{today?: Date|string|{y:number,m:number,d:number}, debug?: boolean}} [opts]
 *   today — дата расчёта («дата сервера ЕНПФ»), по умолчанию new Date();
 *   debug — добавить в details неокруглённые итоги строк таблицы (rowsUnrounded).
 * @returns {{code:'0', decoded:object, notes:object, details:object} | {code:'-1', message:string}}
 *   decoded — ровно как расшифрованный ответ API (те же ключи, порядок ключей, строки/числа, округления);
 *   notes   — вне формы ответа API: { approximate: [тексты], uipApproximate, dataWarnings: [тексты], snapshotDate, today };
 *   details — неокруглённые величины для КП: retirement, common (базовая, солидарная, ОПВР, ä аннуитета),
 *             scenarios[имя] (накопления на дату выхода, остатки ОПВ на 01.01 по годам, выплата ОПВ и её срок,
 *             премия и выплата аннуитета). Все суммы — в реальных тенге 2026 г.
 */
function forecastCalc(body, { today = new Date(), debug = false } = {}) {
  const td = normalizeToday(today);
  const err = validateForecastBody(body, td);
  if (err) return err;
  const q = normalizeBody(body);
  const C = commonPart(q, td);
  const fns = contribFns(q, td);
  const notes = {
    approximate: [], uipApproximate: false, dataWarnings: [],
    snapshotDate: FORECAST_TABLES.snapshotDate, today: td.y + '-' + pad2(td.m) + '-' + pad2(td.d),
  };
  if (td.y !== P.year) {
    notes.dataWarnings.push('Параметры и таблицы ЕНПФ сняты ' + FORECAST_TABLES.snapshotDate + ' (ПМ, МП, МРП ' + P.year +
      ' г., порог ПМД, ОПВР). Для даты расчёта в другом году ответ ЕНПФ может отличаться — сверить канарейками (lib/drift.js).');
  }

  // AvailableAmount (без изъятия и без УИП) — нужен и для потолка изъятия
  const balances = {};
  for (const sc of SCENARIOS) {
    balances[sc] = accumulate({ S0: q.opv ? q.sumOpv : 0, R: P.yields[sc], today: td, ret: C.ret, contrib: fns.opv }).balances;
  }
  const avail = availableAmounts(balances, C.birth, td, C.ret, notes.dataWarnings);

  // режим изъятия: сумма по сценарию = min(желаемая; доступная в выбранном году), год вне списка → 0
  const payoffs = {};
  if (q.porogInputs) {
    const row = avail.find((r) => r.year === q.payoffYear);
    const key = { Pessimist: 'amountPes', Realist: 'amountReal', Optimist: 'amountOpt' };
    // T для отложенного ИПН: (год выхода − год изъятия) + ((месяц выхода − 1) + день выхода/30)/12
    // [проверено: сохранённые пробы 2030/2031 гг. и свежие живые P1, X3 (выход 09.02 и 30-го числа), 05.10.2026].
    // Изъятие в ТЕКУЩЕМ году: та же формула от года расчёта минус сдвиг X = CURRENT_YEAR_IPN_SHIFT, подобранный
    // по живым ответам 05.10.2026 (P2, X5, сохранённая payoff_2026_5m_ipn0). Как X зависит от даты — не установлено.
    const retFrac = ((C.ret.m - 1) + C.ret.d / 30) / 12;
    const ipnYears = q.payoffYear === td.y
      ? (C.ret.y - td.y) + retFrac - CURRENT_YEAR_IPN_SHIFT
      : (C.ret.y - q.payoffYear) + retFrac;
    for (const sc of SCENARIOS) {
      const amount = row ? Math.min(q.payoffAmount, row[key[sc]]) : 0;
      payoffs[sc] = { year: q.payoffYear, amount, ipn: roundHalfUp(amount * P.payoffIpnRate), ipnType: q.payoffIpnType, ipnYears };
    }
    if (row && q.payoffIpnType === '0' && q.payoffYear === td.y && q.calcType !== '2' &&
      notes.today !== CURRENT_YEAR_IPN_SHIFT_DATE) {
      notes.approximate.push('Отложенный ИПН при изъятии в текущем году: срок удержания посчитан со сдвигом X = ' +
        String(CURRENT_YEAR_IPN_SHIFT).replace('.', ',') + ' года, измеренным только на ' + CURRENT_YEAR_IPN_SHIFT_DATE +
        '; на другую дату X может быть другим — возможна разница в EnpfPensionOPV, TotalSum и таблице (проверить канарейкой f_payoff_current_ipn).');
    }
  }

  const out = {};
  const details = {
    retirement: { date: fmtDmy(C.ret), age: C.age },
    common: {
      basicPension: C.basic.amount, basicStazhYears: C.basic.T, solidarityPension: C.sol0, opvrPayment: C.opvr,
      harmfulCoef: C.coef, salaryBeforePension: C.salRet, firstTableYear: C.firstYear,
      annuityFactor: forecastAnnuityFactor(C.sex, C.age),
    },
    scenarios: {},
  };
  let ask = 0;
  const uipOn = q.payoffDegree > 0;
  if (uipOn) {
    notes.uipApproximate = true;
    notes.approximate.push('Сценарии *UIP при PayoffDegree > 0: модель восстановлена по 5 пробам и подтверждена ' +
      'на свежих живых ответах 05.10.2026 (в том числе с ОППВ — они переводятся в УИП той же долей), ' +
      'но на других датах расчёта не проверялась.' +
      (q.porogInputs ? ' Изъятие вместе с УИП не проверялось [гипотеза].' : ''));
  }
  for (const variant of ['', 'UIP']) {
    for (const sc of SCENARIOS) {
      const uip = variant && uipOn ? { share: q.payoffDegree / 100, extra: P.uipExtraYield } : null;
      const r = runScenario(q, td, C, fns, sc, P.yields[sc], { uip, payoff: q.porogInputs ? payoffs[sc] : null, debug });
      const f = { ...r.fields };
      if (!variant) f.AvailableAmount = q.porogInputs ? [] : avail.map(availRowOut);
      f.EnpfCalcTable = r.rows;
      const pf = q.porogInputs ? payoffs[sc] : null;
      f.Ipn1 = String(pf ? pf.ipn : 0);
      f.PayoffAmout = String(pf ? roundHalfUp(pf.amount) : 0);
      if (q.porogInputs) f.PayoffYear = String(body.payoffYear).trim();
      out[sc + variant] = f;
      details.scenarios[sc + variant] = r.detail;
      if (!variant && sc === 'Pessimist' && r.askOk) ask = 1;
    }
  }
  const decoded = {};
  for (const k of TOP_ORDER) decoded['EnpfCalculator' + k] = out[k];
  decoded.PensionAnnuityAsk = C.ct2 ? '2' : String(ask);
  return { code: '0', decoded, notes, details };
}

function availRowOut(r) {
  return {
    year: String(r.year), amountPes: String(r.amountPes), amountReal: String(r.amountReal),
    amountOpt: String(r.amountOpt), amountPorog: String(r.amountPorog),
  };
}

// ===================================================================== тело запроса ===

/**
 * Состояние формы ЕНПФ сразу после загрузки страницы (docs/01 §2): все переключатели «Да»,
 * режимы роста з/п и ДПВ — «%», периодичность 12.
 */
const FORECAST_DEFAULT_UI_STATE = Object.freeze({
  sex: 'M', birthDate: '',
  exp1998Years: '', exp1998Months: '', expYears: '', expMonths: '', expVredYears: '', expVredMonths: '',
  averageSal: '',
  enlargeSal: true, enlargeTypePercent: true, enlargePercent: '', enlargeTenge: '',
  uipPercent: '', periodPayOpv: 12,
  opv: true, opvSum: '', oppv: true, oppvSum: '', opvr: true, opvrSum: '',
  dpv: true, dpvSum: '', dpvTypePercent: true, dpvPercent: '', dpvTenge: '', periodPayDpv: 12,
  payoutAge: '', payoutMonth: '',
  porogInputs: false, payoffYear: null, payoffAmount: '0', payoffIpnType: 0,
  lang: '0',
});

/** Числовые поля, которые buildForecastBody заменяет на "0", если они пустые (AverageSal не трогаем:
 * пустая зарплата — ошибка ввода, сервер отвечает понятным текстом). */
const FILLABLE_FIELDS = ['EnlargeTenge', 'EnlargePercent', 'PayoffDegree', 'SumOPV', 'SumOPPV', 'SumOPVR', 'SumDPV',
  'SumDPVtenge', 'SumDPVpercent', 'PayoutAge', 'PayoutMonth', 'payoffAmount'];

const strip = (v) => String(v == null ? '' : v).split(' ').join('').split(' ').join('');
const yearsField = (y, m) => (parseFloat(strip(y) || '0') + parseFloat(strip(m) || '0') / 12).toFixed(2);
const money = (v) => strip(v).replace(',', '.');
const b2s = (x) => (x ? 'true' : 'false');

/**
 * Тело запроса EnpfCalculator2New из состояния формы — порт buildBody() страницы ЕНПФ
 * (index.php.inline.js:520-553 и 1761-1794; research/forecast_frontend/enpf_forecast_client.js).
 *
 * @param {object} uiInput  поля как в FORECAST_DEFAULT_UI_STATE (недостающие берутся оттуда); может содержать calcType
 * @param {{calcType?: 1|2|'1'|'2', today?: Date|string, fillEmpty?: boolean}} [opts]
 *   today — для payoffYear по умолчанию (на сайте — текущий год браузера);
 *   fillEmpty (по умолчанию true) — пустые суммы → "0" (кроме AverageSal): сервер отвергает "" (docs/09 §5).
 *   fillEmpty: false воспроизводит страницу ЕНПФ байт в байт (пустые поля уходят "").
 * @returns {Object<string,string>} 32 строковых поля в порядке страницы
 */
function buildForecastBody(uiInput = {}, { calcType, today = new Date(), fillEmpty = true } = {}) {
  const s = { ...FORECAST_DEFAULT_UI_STATE, ...uiInput };
  const td = normalizeToday(today);
  const ct = calcType != null ? calcType : (uiInput.calcType != null ? uiInput.calcType : 1);
  const body = {
    Sex: String(s.sex),
    BirthDate: String(s.birthDate).split('-').reverse().join('.'),
    Exp1998: yearsField(s.exp1998Years, s.exp1998Months),
    ExpVred: yearsField(s.expVredYears, s.expVredMonths),
    ExpYear: yearsField(s.expYears, s.expMonths),
    AverageSal: strip(s.averageSal),
    EnlargeSal: b2s(s.enlargeSal),
    EnlargeType: b2s(s.enlargeTypePercent),
    EnlargeTenge: (!s.enlargeTypePercent && s.enlargeSal) ? strip(s.enlargeTenge) : '0',
    EnlargePercent: (s.enlargeTypePercent && s.enlargeSal) ? strip(s.enlargePercent) : '0',
    PayoffDegree: strip(s.uipPercent) || '0',
    PeriodPayOPV: String(s.periodPayOpv),
    OPV: b2s(s.opv),
    SumOPV: s.opv ? money(s.opvSum) : '0',
    OPPV: b2s(s.oppv),
    SumOPPV: (s.oppv && s.opv) ? money(s.oppvSum) : '0',
    OPVR: b2s(s.opvr),
    SumOPVR: s.opvr ? money(s.opvrSum) : '0',
    DPV: b2s(s.dpv),
    SumDPV: s.dpv ? money(s.dpvSum) : '0',
    SumDPVtype: s.dpv ? b2s(s.dpvTypePercent) : 'false',
    SumDPVtenge: (s.dpv && !s.dpvTypePercent) ? strip(s.dpvTenge) : '0',
    SumDPVpercent: (s.dpv && s.dpvTypePercent) ? strip(s.dpvPercent) : '0',
    PeriodPayDPV: s.dpv ? String(s.periodPayDpv) : '0',
    PayoutAge: s.dpv ? strip(s.payoutAge) : '0',
    PayoutMonth: s.dpv ? strip(s.payoutMonth) : '0',
    Lang: String(s.lang == null ? '0' : s.lang),
    CalcType: String(ct),
    porogInputs: b2s(s.porogInputs),
    payoffYear: String(s.payoffYear == null || s.payoffYear === '' ? td.y : s.payoffYear),
    payoffAmount: String(s.payoffAmount),
    payoffIpnType: String(s.payoffIpnType),
  };
  if (fillEmpty) for (const k of FILLABLE_FIELDS) if (body[k] === '') body[k] = '0';
  return body;
}

__EL.define('enpf-forecast.js', { POROG_TABLE, FORECAST_TABLES, FORECAST_URL, FORECAST_SCENARIOS, CURRENT_YEAR_IPN_SHIFT, CURRENT_YEAR_IPN_SHIFT_DATE, forecastRetirement, forecastAnnuityFactor, validateForecastBody, forecastCalc, FORECAST_DEFAULT_UI_STATE, buildForecastBody });
})(typeof window !== 'undefined' ? window : globalThis);
