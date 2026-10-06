/* ════ EnpfLib · compare.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/compare.js
 * (sha256 5b69166561dbed12…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Модель сравнения для блока КП «Оставить в ЕНПФ или перевести в пенсионный аннуитет Standard Life».
 *
 * Методика (docs/09 §7 и §9 «Рекомендации для сборки», docs/07 §6.3):
 *  1. Сравниваются только выплаты из ТЕКУЩИХ накоплений ОПВ/ОППВ, которые клиент может перевести.
 *     Будущие взносы в обоих вариантах продолжают идти в ЕНПФ и в сравнение не входят. Базовая
 *     и солидарная пенсии и ОПВР одинаковы в обоих вариантах (ОПВР в страховую организацию
 *     не переводится, СК ст. 222) — они вынесены в sharedParts и исключены.
 *  2. ЕНПФ показывается двумя способами:
 *     а) «как в калькуляторе ЕНПФ» — реплика прогноза (lib/enpf-forecast.js), тело запроса
 *        с AverageSal = "1" и SumOPV = накопления (docs/09 §3.10): реальные тенге 2026 г.,
 *        постоянная выплата N лет. Тело запроса готово для живой сверки (liveBody);
 *     б) «по правилам ПП 521» в номинале (lib/enpf-schedule.js): 6,5 %/12, не меньше 70 % ПМ,
 *        далее +5 % в год до исчерпания; остаток растёт на (1 + π)(1 + r) − 1.
 *        Строки, графики и итоговые суммы строятся по варианту б). Реальные выплаты ЕНПФ
 *        на (1 + π)^t НЕ умножаются — это ошибка прототипа (docs/09 §3.19).
 *  3. Standard Life — Excel-реплика (lib/sl-annuity.js, тождественна генератору КП):
 *     порог, доплата, выплата при старте, ежегодная индексация 8 % с ROUND, выкупная сумма,
 *     гарантийный период. Доплата = порог − свои средства (накопления + выкупная): возможный дивиденд
 *     её не уменьшает (правило продукта Standard Life от 06.10.2026) и показывается только справочно.
 *  4. Одна ценовая база: номинал делится на индекс цен от даты расчёта по выбранной траектории
 *     инфляции (по умолчанию — траектория калькулятора КСЖ ЕНПФ: 2026 — 10 %, 2027 — 6,5 %, далее 6 %).
 *  5. Строка возраста a — 12 месяцев выплат каждого варианта, начинающиеся в возрасте a полных лет
 *     (по годовщинам начала выплат этого варианта: у мужчин это дни рождения, у женщин с пенсионным
 *     возрастом 61,5 или стартом ПА в 53,5 — «полудни рождения», у немедленного аннуитета — годовщины
 *     договора). realConvention = 'yearStart' (по умолчанию, как docs/09 §7.2): выплаты года делятся
 *     на индекс цен на начало этого года выплат; 'paymentDate' — каждая выплата на индекс своей даты.
 *
 * Модуль без зависимостей вне lib/, работает в браузере и в Node 22. buildComparison — чистая
 * функция: дата расчёта передаётся явно (today), результат — простой JSON-сериализуемый объект.
 */
const { PARAMS_2026, PMD_2026_BY_AGE } = __EL.require('params-2026.js');
const { normSex, survivalCurve, mortalityTable, lifeExpectancy, SL_CATEGORY_TABLE } = __EL.require('actuarial.js');
const { slAnnuity, slMonthlyPayments, SL_TARIFF } = __EL.require('sl-annuity.js');
const { enpfPayoutSchedule, enpfSavingsAt, priceIndex, inflationRate } = __EL.require('enpf-schedule.js');
const { forecastCalc, buildForecastBody, forecastRetirement, POROG_TABLE } = __EL.require('enpf-forecast.js');
const { kszhCalc } = __EL.require('enpf-kszh.js');
const { toYMD, isoYMD, ruYMD, cmpYMD, completedAge, monthsBetween, edate, daysBetween } = __EL.require('dates.js');

// ============================================================== константы ==========

/** Сценарии ЕНПФ: реальная доходность (как в прогнозном калькуляторе ЕНПФ) и имя сценария в API. */
/** Дата, когда копия методики ЕНПФ (реплики прогноза и калькулятора аннуитета) последний раз сверена с живым ЕНПФ. */
const ENPF_METHODOLOGY_VERIFIED_ON = '2026-10-06';

const COMPARE_SCENARIOS = Object.freeze({
  pessimist: Object.freeze({ api: 'Pessimist', realYield: PARAMS_2026.forecastRealYields.Pessimist, label: 'пессимистичный' }),
  realist: Object.freeze({ api: 'Realist', realYield: PARAMS_2026.forecastRealYields.Realist, label: 'реалистичный' }),
  optimist: Object.freeze({ api: 'Optimist', realYield: PARAMS_2026.forecastRealYields.Optimist, label: 'оптимистичный' }),
});

/** Категории клиента → категория Excel ПА Standard Life (ввод!G10). */
const COMPARE_CATEGORIES = Object.freeze({
  standard: 'Стандартный',
  oppv: 'ОППВ 60 мес',
  inv3: 'Инвалидность 3гр (30-59%) бессрочно',
  inv2: 'Инвалидность 2гр (60-89%) бессрочно',
  inv1: 'Инвалидность 1гр (90-100%) бессрочно',
});

/** Допущения по умолчанию (docs/09 §9 п. 4). */
const COMPARE_DEFAULTS = Object.freeze({
  inflationPath: PARAMS_2026.kszhInflationPath,   // 2026 — 10 %, 2027 — 6,5 %, 2028+ — 6 %
  enpfScenario: 'realist',                        // r = 1 %, как «реалистичный» сценарий ЕНПФ
  slTariff: PARAMS_2026.sl,                       // i = 9 %, ind = 8 %, α = 1,5 %, γ = 3 %
  horizonAge: 100,                                // как остальной КП (cfg.end)
  priceBase: 'real2026',                          // заголовочные цифры — в ценах даты расчёта
  dayCount: '30/360',                             // доля года для индекса цен (см. lib/enpf-schedule.js)
  realConvention: 'yearStart',                    // как docs/09 §7.2
  paymentAges: Object.freeze([63, 70, 80, 90]),
  cumulativeAges: Object.freeze([70, 80, 90, 100]),
});

/**
 * Таблицы смертности (имена lib/actuarial.js) — по-русски, для заметок и интерфейса.
 * «Пенсионная» совпадает с прил. 2 к Методике (постановление АРРФР №45) [проверено, docs/09 §3.1]; таблицы для ОППВ
 * и инвалидности — те же, что в калькуляторах SL и КСЖ ЕНПФ (источник в Методике — [вероятно], docs/08 §176).
 */
const MORTALITY_TABLE_NAMES = Object.freeze({
  pension: 'пенсионная таблица смертности (прил. 2 к постановлению АРРФР №45)',
  oppv: 'таблица смертности для работников вредных производств с ОППВ (постановление АРРФР №45)',
  inv1: 'таблица смертности для лиц с инвалидностью 1 группы (постановление АРРФР №45)',
  inv2: 'таблица смертности для лиц с инвалидностью 2 группы (постановление АРРФР №45)',
  inv3: 'таблица смертности для лиц с инвалидностью 3 группы (постановление АРРФР №45)',
});
/** Русское название таблицы смертности по её имени ('pension' → «пенсионная таблица смертности (…)»). */
function mortalityTableName(table) {
  return MORTALITY_TABLE_NAMES[table] || ('таблица смертности «' + table + '»');
}

// ============================================================== форматирование для заметок ==========

const NBSP = ' ';
/** 1234567.8 → «1 234 568 ₸». */
function money(x) {
  const s = String(Math.round(Math.abs(x))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (x < 0 ? '−' : '') + s + NBSP + '₸';
}
/** 0.065 → «6,5 %». */
function pct(x) {
  return String(+(x * 100).toFixed(2)).replace('.', ',') + NBSP + '%';
}
/** 12.5 → «12,5». */
const num = (x) => String(+(+x).toFixed(2)).replace('.', ',');
/** Целое с разделителем разрядов, как вводят на enpf.kz: 5800000 → «5 800 000». */
const fmtInt = (x) => String(Math.round(+x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** Возраст после «с»/«до»: «55 лет», «61 года», «62 лет», «53,5 года». */
function ageGenText(a) {
  const v = +(+a).toFixed(2);
  return num(v) + NBSP + (!Number.isInteger(v) || (v % 10 === 1 && v % 100 !== 11) ? 'года' : 'лет');
}
/** Число лет: «55 лет», «61 год», «62 года», «53,5 года». */
function yearsText(a) {
  const v = +(+a).toFixed(2);
  if (!Number.isInteger(v)) return num(v) + NBSP + 'года';
  const t = v % 100, d = v % 10;
  return v + NBSP + (t > 10 && t < 20 ? 'лет' : d === 1 ? 'год' : d >= 2 && d <= 4 ? 'года' : 'лет');
}

/**
 * Описание траектории инфляции по-русски, начиная с года fromYear: «2026 — 10 %, 2027 — 6,5 %, с 2028 — 6 %».
 * @param {number|object|function} path  число, {год: ставка, default?} или функция year → ставка
 * @param {number} fromYear
 * @returns {string}
 */
function describeInflationPath(path, fromYear) {
  if (typeof path === 'number') return 'постоянная ' + pct(path) + ' в год';
  if (typeof path === 'function') return 'задана функцией (по годам)';
  const explicit = Object.keys(path || {}).filter((k) => /^\d{4}$/.test(k)).map(Number);
  const last = Math.max(fromYear + 1, ...explicit.filter((y) => y >= fromYear)) + 1;
  const groups = [];
  for (let y = fromYear; y <= last; y++) {
    const r = inflationRate(path, y);
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.r - r) < 1e-12) g.to = y; else groups.push({ from: y, to: y, r });
  }
  if (groups.length === 1) return 'постоянная ' + pct(groups[0].r) + ' в год';
  return groups.map((g, i) => {
    if (i === groups.length - 1) return 'с ' + g.from + ' — ' + pct(g.r);
    return (g.from === g.to ? g.from : g.from + '–' + g.to) + ' — ' + pct(g.r);
  }).join(', ');
}

// ============================================================== вход ==========

/** Поля ввода по-русски — для сообщений об ошибках (ключ — имя поля client / assumptions). */
const COMPARE_FIELD_LABELS = Object.freeze({
  birthDate: 'Дата рождения', sex: 'Пол', category: 'Категория клиента',
  savingsOPV: 'Накопления ОПВ', savingsOPPV: 'Накопления ОППВ', transferAmount: 'Сумма перевода в Standard Life',
  topUp: 'Доплата клиента', redemption: 'Выкупная сумма из другой КСЖ', guaranteeYears: 'Гарантийный период',
  slStartAge: 'Возраст начала выплат ПА', inflationPath: 'Инфляция', enpfScenario: 'Сценарий доходности ЕНПФ',
  enpfRealYield: 'Доходность ЕНПФ', horizonAge: 'Горизонт сравнения', priceBase: 'База цен', realConvention: 'Пересчёт в цены',
  today: 'Дата расчёта',
});

/**
 * Ошибка ввода buildComparison: текст по-русски для пользователя (без имён переменных), err.field — имя поля
 * (машиночитаемо, ключ COMPARE_FIELD_LABELS), err.code = 'COMPARE_INPUT'.
 */
function inputError(field, message) {
  const e = new Error(message);
  e.name = 'CompareInputError';
  e.code = 'COMPARE_INPUT';
  e.field = field;
  return e;
}

/** Число из числа или строки «1 234 567,89» (пробелы, в том числе неразрывные, убираются). */
const parseNum = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')));
/** Значение для текста ошибки: «abc». */
const shown = (v) => '«' + String(v).slice(0, 40) + '»';

/** Число ≥ 0 из числа или строки «1 234 567,89». null/undefined/'' → 0. */
function amount(v, field) {
  if (v == null || v === '') return 0;
  const x = parseNum(v);
  const label = COMPARE_FIELD_LABELS[field] || field;
  if (!Number.isFinite(x)) throw inputError(field, label + ': введите сумму числом, например 10 000 000 (сейчас ' + shown(v) + ').');
  if (x < 0) throw inputError(field, label + ': сумма не может быть отрицательной.');
  return x;
}

/** Ключ категории: 'standard' | 'oppv' | 'inv1' | 'inv2' | 'inv3' (принимает и названия Excel). */
function categoryKey(c) {
  if (c == null || c === '') return 'standard';
  const s = String(c).trim();
  if (s in COMPARE_CATEGORIES) return s;
  for (const [k, v] of Object.entries(COMPARE_CATEGORIES)) if (v === s) return k;
  throw inputError('category', 'Неизвестная категория клиента ' + shown(c) + ': выберите «' + Object.values(COMPARE_CATEGORIES).join('», «') + '».');
}

/** Дата из строки или Date; некорректная — ошибка ввода по-русски с именем поля. */
function dateInput(v, field) {
  try { return toYMD(v); } catch {
    throw inputError(field, (COMPARE_FIELD_LABELS[field] || field) + ': дата в формате дд.мм.гггг (сейчас ' + shown(v) + ').');
  }
}

/** Нормализация клиента. Перевод берётся сначала из ОПВ, затем из ОППВ. */
function normalizeClient(c, td) {
  if (!c || c.birthDate == null || c.birthDate === '') throw inputError('birthDate', 'Укажите дату рождения клиента.');
  let sex;
  try { sex = normSex(c.sex); } catch { throw inputError('sex', 'Пол клиента: мужской или женский.'); }
  const bd = dateInput(c.birthDate, 'birthDate');
  if (cmpYMD(bd, td) >= 0) throw inputError('birthDate', 'Дата рождения должна быть раньше даты расчёта (' + ruYMD(td) + ').');
  const cat = categoryKey(c.category);
  const savingsOPV = amount(c.savingsOPV, 'savingsOPV');
  const savingsOPPV = amount(c.savingsOPPV, 'savingsOPPV');
  const total = savingsOPV + savingsOPPV;
  const transfer = c.transferAmount == null || c.transferAmount === '' ? total : Math.min(total, amount(c.transferAmount, 'transferAmount'));
  const fromOPV = Math.min(transfer, savingsOPV);
  const fromOPPV = Math.max(0, transfer - fromOPV);
  let gp = 0;
  if (c.guaranteeYears != null && c.guaranteeYears !== '') {
    gp = parseNum(c.guaranteeYears);
    if (!Number.isFinite(gp) || gp < 0) throw inputError('guaranteeYears', 'Гарантийный период — число лет от 0 (сейчас ' + shown(c.guaranteeYears) + ').');
    gp = Math.floor(gp);
  }
  let slStartAge = null;
  if (c.slStartAge != null && c.slStartAge !== '') {
    slStartAge = parseNum(c.slStartAge);
    if (!Number.isFinite(slStartAge) || slStartAge <= 0 || slStartAge > 100) {
      throw inputError('slStartAge', 'Возраст начала выплат ПА — число лет, например 55 или 56,5 (сейчас ' + shown(c.slStartAge) + ').');
    }
  }
  return {
    sex, bd, cat, categoryName: COMPARE_CATEGORIES[cat],
    savingsOPV, savingsOPPV, total, transfer, fromOPV, fromOPPV,
    restOPV: savingsOPV - fromOPV, restOPPV: savingsOPPV - fromOPPV,
    partial: total - transfer > 0.5,
    harmful: c.harmful == null ? cat === 'oppv' : !!c.harmful,
    gp,
    slStartAge,
    topUp: c.topUp == null || c.topUp === '' ? null : amount(c.topUp, 'topUp'),
    redemption: amount(c.redemption, 'redemption'),
    oppvFlag: c.oppv === true || c.oppv === 'Да',
  };
}

/** Тариф SL для slAnnuity из PARAMS_2026.sl-подобного объекта ({i, ind, alpha, gamma, ...}). */
function slTariffFrom(t, horizon) {
  const T = { ...SL_TARIFF };
  if (t) {
    if (t.i != null) T.i = +t.i;
    if (t.ind != null) T.ind = +t.ind;
    const al = t.alpha ?? t.alfa;
    if (al != null) T.alfa = +al;
    if (t.gamma != null) T.gamma = +t.gamma;
    if (t.maxGuaranteeYears != null) T.maxGuarantee = +t.maxGuaranteeYears;
    if (t.dividendNet != null) T.dividendNet = +t.dividendNet;
    if (t.tariffVersion != null) T.version = t.tariffVersion;
  }
  T.horizon = Math.max(SL_TARIFF.horizon, horizon);
  return Object.freeze(T);
}

function normalizeAssumptions(a, td) {
  const inflationPath = a.inflationPath ?? COMPARE_DEFAULTS.inflationPath;
  if (typeof inflationPath === 'number' && !(inflationPath > -1)) throw inputError('inflationPath', 'Инфляция должна быть больше −100 % в год.');
  if (typeof inflationPath !== 'number' && typeof inflationPath !== 'function' && (typeof inflationPath !== 'object' || !inflationPath)) {
    throw inputError('inflationPath', 'Инфляция: одно число (например 8 %) или ставки по годам (например 10; 6,5; 6).');
  }
  const scenario = String(a.enpfScenario ?? COMPARE_DEFAULTS.enpfScenario).toLowerCase();
  if (!(scenario in COMPARE_SCENARIOS)) throw inputError('enpfScenario', 'Сценарий доходности ЕНПФ: пессимистичный, реалистичный или оптимистичный.');
  const realYield = a.enpfRealYield != null ? +a.enpfRealYield : COMPARE_SCENARIOS[scenario].realYield;
  if (!(Number.isFinite(realYield) && realYield > -1)) throw inputError('enpfRealYield', 'Реальная доходность ЕНПФ — число больше −100 % в год.');
  const horizonAge = Math.floor(+(a.horizonAge ?? COMPARE_DEFAULTS.horizonAge));
  if (!(horizonAge >= 50 && horizonAge <= 120)) throw inputError('horizonAge', 'Горизонт сравнения — возраст от 50 до 120 лет.');
  let priceBase = String(a.priceBase ?? COMPARE_DEFAULTS.priceBase);
  if (priceBase === 'real') priceBase = 'real2026';
  if (priceBase !== 'nominal' && priceBase !== 'real2026') throw inputError('priceBase', 'База цен: номинал или цены даты расчёта.');
  const dayCount = a.dayCount ?? COMPARE_DEFAULTS.dayCount;
  const realConvention = a.realConvention ?? COMPARE_DEFAULTS.realConvention;
  if (realConvention !== 'yearStart' && realConvention !== 'paymentDate') throw inputError('realConvention', 'Пересчёт в цены: на начало года выплат или на дату каждой выплаты.');
  const slT = a.slTariff ?? COMPARE_DEFAULTS.slTariff;
  return {
    inflationPath, scenario, realYield, horizonAge, priceBase, dayCount, realConvention,
    slTariff: slTariffFrom(slT, horizonAge),
    dividendRate: a.dividendRate == null ? undefined : +a.dividendRate,
    paymentAges: a.paymentAges ?? COMPARE_DEFAULTS.paymentAges,
    cumulativeAges: a.cumulativeAges ?? COMPARE_DEFAULTS.cumulativeAges,
    mortalityTable: a.mortalityTable ?? null,
    describe: describeInflationPath(inflationPath, td.year),
  };
}

// ============================================================== помощники ==========

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Полных лет на дату; у родившихся 29.02 день рождения в невисокосный год — 28.02 (как EDATE). */
function ageOn(bd, d) {
  let a = completedAge(bd, d);
  if (bd.month === 2 && bd.day === 29 && d.month === 2 && d.day === 28 && !isLeap(d.year)) a += 1;
  return a;
}

/** Индекс цен от даты расчёта до даты (с кешем). */
function makeIndex(td, path, dayCount) {
  const cache = new Map();
  return (d) => {
    const key = typeof d === 'string' ? d : isoYMD(d);
    let v = cache.get(key);
    if (v === undefined) { v = priceIndex(td, key, path, { dayCount }); cache.set(key, v); }
    return v;
  };
}

/** Последний индекс i, для которого arr[i].date < iso (даты ISO сравниваются как строки); −1, если нет. */
function lastBefore(arr, iso) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date < iso) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Лет до исчерпания в модели ЕНПФ (постоянная реальная выплата, docs/03 §6.3) — для пенсионеров. */
function yearsToExhaust(S, pay, r) {
  if (pay <= 0) return 0;
  if (r === 0) return Math.ceil(S / pay / 12 - 1e-12);
  const j = Math.pow(1 + r, 1 / 12) - 1;
  const x = 1 - (S / pay) * (j / (1 + j));
  if (x <= 0) return 999;
  return Math.ceil(-Math.log(x) / Math.log(1 + j) / 12 - 1e-12);
}

/**
 * Функция дожития клиента от даты расчёта до даты d: l(возраст d)/l(возраст сегодня),
 * внутри года — равномерное распределение смертей (UDD). Возраст — дни/365,25 от дня рождения.
 */
function makeSurvival({ sex, table, bd, td }) {
  const x0 = completedAge(bd, td);
  const curve = survivalCurve({ sex, age: x0, table, years: 130 });
  const q = mortalityTable(table, sex);
  const qAt = (a) => (a < 0 ? 0 : a >= q.length ? 1 : q[a]);
  const lastBday = edate(bd, 12 * x0);
  const exactAge = (d) => x0 + daysBetween(lastBday, d) / 365.25;
  const l = (age) => {
    const t = age - x0;
    const k = Math.floor(t);
    if (k < 0) return 1;
    if (k >= curve.length - 1) return 0;
    return curve[k] * (1 - (t - k) * qAt(x0 + k));
  };
  const l0 = l(exactAge(td));
  return (d) => (cmpYMD(d, td) <= 0 ? 1 : (l0 > 0 ? l(exactAge(d)) / l0 : 0));
}

// ============================================================== ЕНПФ по ПП 521 ==========

/**
 * Вариант «ЕНПФ» (или остаток в ЕНПФ) по правилу ПП 521 в номинале: отдельный график для ОПВ и ОППВ
 * (как в прогнозном API: у каждой части своё правило единовременной выплаты и свой пол 70 % ПМ).
 * @returns {{parts:Array, stream:Array, start:object, startLabel:number}}
 *   stream — помесячные выплаты {date, amount, yearStart, label, lump}
 */
function enpfOption(components, ctx, realYield) {
  const parts = [];
  const stream = [];
  for (const c of components) {
    const savingsAtStart = enpfSavingsAt({ savings: c.savings, to: ctx.start, inflationPath: ctx.path, realYield,
      today: ctx.td, dayCount: ctx.dayCount });
    const sched = enpfPayoutSchedule({ savingsAtStart, startDate: ctx.start, inflationPath: ctx.path, realYield, K: ctx.K,
      monthly: true, birthDate: ctx.bd, today: ctx.td, priceBase: ctx.td, maxYears: ctx.maxYears, dayCount: ctx.dayCount });
    parts.push({ key: c.key, savings: c.savings, savingsAtStart, sched });
    let mi = 0;
    for (const y of sched.years) {
      for (let k = 0; k < y.months; k++, mi++) {
        const m = sched.months[mi];
        stream.push({ date: m.date, amount: m.payment, yearStart: y.date, label: ctx.startLabel + y.n - 1, lump: sched.lumpSum });
      }
    }
  }
  return { parts, stream, realYield };
}

/** Остаток на счёте ЕНПФ (номинал) на дату d: до начала выплат — рост накоплений, после — остаток графика. */
function enpfBalanceAt(opt, ctx, d) {
  const iso = isoYMD(d);
  let sum = 0;
  for (const p of opt.parts) {
    if (cmpYMD(d, ctx.start) <= 0) {
      sum += enpfSavingsAt({ savings: p.savings, to: d, inflationPath: ctx.path, realYield: opt.realYield, today: ctx.td, dayCount: ctx.dayCount });
    } else if (!p.sched.lumpSum) {
      const i = lastBefore(p.sched.months, iso);
      sum += i >= 0 ? Math.max(0, p.sched.months[i].balanceAfter) : p.savingsAtStart;
    }
  }
  return sum;
}

/** Сводка годов выплат по меткам возраста: {label → {nominal, real, lump, yearStart}}. */
function aggregate(stream, idx, realConvention, horizonAge) {
  const by = new Map();
  for (const s of stream) {
    if (s.label > horizonAge) continue;
    let r = by.get(s.label);
    if (!r) { r = { nominal: 0, real: 0, lump: 0, lumpReal: 0, yearStart: s.yearStart, months: 0 }; by.set(s.label, r); }
    const real = s.amount / idx(realConvention === 'paymentDate' ? s.date : s.yearStart);
    r.nominal += s.amount;
    r.real += real;
    r.months += 1;
    if (s.lump) { r.lump += s.amount; r.lumpReal += real; }
  }
  return by;
}

// ============================================================== калькулятор ЕНПФ ==========

const LIVE_FIELDS = ['EnpfPensionOPV', 'EnpfPensionOPPV', 'NumOfYearsBeforeExhAccumOPV', 'NumOfYearsBeforeExhAccumOPPV'];

/**
 * «Как в калькуляторе ЕНПФ»: реплика прогноза только из текущих накоплений (AverageSal = "1").
 * Для пенсионера (API отвечает −1) — то же правило ЕНПФ с параметрами 2026 г. от текущего остатка.
 */
function enpfCalculatorView(C, A, td, ret, retired, live = null) {
  const sc = COMPARE_SCENARIOS;
  const body = buildForecastBody({
    sex: C.sex, birthDate: ruYMD(C.bd),
    exp1998Years: '0', exp1998Months: '0', expYears: '0', expMonths: '0',
    expVredYears: C.harmful ? '5' : '0', expVredMonths: '0',
    averageSal: '1', enlargeSal: false, enlargeTypePercent: false, uipPercent: '0', periodPayOpv: 12,
    opv: true, opvSum: String(Math.round(C.savingsOPV)),
    oppv: C.savingsOPPV > 0, oppvSum: String(Math.round(C.savingsOPPV)),
    opvr: false, dpv: false, lang: '0',
  }, { calcType: 1, today: isoYMD(td) });
  const view = {
    source: 'replica', retirementDate: isoYMD(ret.ymd), retirementDateRu: ret.ru, retirementAge: ret.age,
    scenario: A.scenario, savingsAtRetirementReal: 0, monthlyReal: 0, years: 0, endAge: null, byScenario: {},
    liveBody: null, expectedLive: null, apiMessage: null, notes: [],
  };
  const K = C.harmful ? PARAMS_2026.enpfPayout.kHarmful : 1;
  // возраст первого года выплат: пенсионный возраст, а у пенсионера — текущий (выплаты «с сегодня»)
  const firstAge = retired ? completedAge(C.bd, td) : ret.age;
  const endAgeOf = (years) => (years > 0 ? Math.floor(firstAge + years - 1 + 1e-9) : null);

  // Что клиент вводит на enpf.kz, чтобы увидеть ровно эти цифры (поля прогнозного калькулятора; аудит 06.10.2026)
  view.siteInputs = [
    ['Пол', C.sex === 'M' ? 'Мужской' : 'Женский'],
    ['Дата рождения', ruYMD(C.bd)],
    ['Трудовой стаж до 1998 года', '0'],
    ['Стаж в накопительной пенсионной системе с 1998 года', '0'],
    ['Стаж работы на вредных и опасных производствах с 2014 года', C.harmful ? '5 лет' : '0'],
    ['Средняя заработная плата в месяц (брутто)', '1'],
    ['С учётом ежегодного роста заработной платы', 'Нет'],
    ['Обязательные пенсионные взносы (ОПВ)', 'Да, текущая сумма накоплений ' + fmtInt(Math.round(C.savingsOPV))],
    ['Обязательные профессиональные пенсионные взносы (ОППВ)', C.savingsOPPV > 0 ? 'Да, текущая сумма накоплений ' + fmtInt(Math.round(C.savingsOPPV)) : 'Нет'],
    ['Обязательные пенсионные взносы работодателя (ОПВР)', 'Нет'],
    ['Добровольные пенсионные взносы (ДПВ)', 'Нет'],
  ];
  const res = retired ? null : forecastCalc(body, { today: isoYMD(td) });
  // Источник цифр: живой ответ ЕНПФ (если передан — он главнее копии методики), иначе реплика.
  // Если живой ответ отличается от реплики — методика ЕНПФ изменилась: в КП идут цифры ЕНПФ, расхождения — в methodologyDiffs.
  const liveF = live && live.forecast && live.forecast.EnpfCalculatorRealist ? live.forecast : null;
  const D = liveF || (res && res.code === '0' ? res.decoded : null);
  if (D) {
    view.liveBody = body;
    view.expectedLive = {};
    if (liveF) {
      view.source = 'live';
      view.liveFetchedAt = live.fetchedAt || null;
      view.methodologyDiffs = [];
      const R = res && res.code === '0' ? res.decoded : null;
      for (const s of Object.values(sc)) {
        const a = R ? R['EnpfCalculator' + s.api] : null, b = liveF['EnpfCalculator' + s.api];
        for (const f of ['EnpfPensionOPV', 'EnpfPensionOPPV', 'NumOfYearsBeforeExhAccumOPV']) {
          if (!a || String(a[f]) !== String(b[f])) view.methodologyDiffs.push({ path: s.api + '.' + f, replica: a ? a[f] : null, live: b[f] });
        }
        if (!a || JSON.stringify(a.Retirement) !== JSON.stringify(b.Retirement)) view.methodologyDiffs.push({ path: s.api + '.Retirement', replica: a ? a.Retirement : null, live: b.Retirement });
      }
    }
    for (const [key, s] of Object.entries(sc)) {
      const x = D['EnpfCalculator' + s.api];
      const det = res && res.code === '0' ? res.details.scenarios[s.api] : null;
      const years = +x.NumOfYearsBeforeExhAccumOPV;
      // таблица по годам — ровно как на enpf.kz (Год, Возраст, ОПВ, ОППВ); только годы с выплатой
      const rawTable = x.EnpfCalcTable || (D['EnpfCalculator' + s.api + 'UIP'] || {}).EnpfCalcTable || [];
      const table = rawTable.map((t) => ({ year: +t.Year, age: +t.Age, opv: +t.OPV, oppv: +t.OPPV }))
        .filter((t) => t.opv + t.oppv > 0);
      // единовременная выплата: у реплики — по её расчёту, у живого ответа — один год выплаты в таблице ЕНПФ
      const lump = liveF ? years === 1 && table.length === 1 : !!(det && det.opvLumpSum);
      view.byScenario[key] = {
        realYield: s.realYield,
        savingsAtRetirementReal: det ? det.sRetOpv + det.sRetOppv : null,
        monthlyReal: +x.EnpfPensionOPV + +x.EnpfPensionOPPV,
        monthlyOPV: +x.EnpfPensionOPV, monthlyOPPV: +x.EnpfPensionOPPV,
        years, yearsOPPV: +x.NumOfYearsBeforeExhAccumOPPV,
        endAge: endAgeOf(years), lumpSum: lump,
        lumpSumReal: liveF ? (lump ? +x.EnpfPensionOPV + +x.EnpfPensionOPPV : 0)
          : (det.opvLumpSum ? +x.EnpfPensionOPV : 0) + (det.oppvYears === 1 && det.oppvPayment === det.sRetOppv && det.sRetOppv > 0 ? +x.EnpfPensionOPPV : 0),
        retirement: { date: x.Retirement.Dt, age: +x.Retirement.Age },
        table, fromAge: table.length ? table[0].age : null, toAge: table.length ? table[table.length - 1].age : null,
        tableYears: table.length,
      };
      view.expectedLive[s.api] = Object.fromEntries(LIVE_FIELDS.map((f) => [f, x[f]]));
    }
    // ЕНПФ сам предлагает «пожизненный аннуитет» (кнопка «Да» → CalcType 2): что клиент увидит на enpf.kz
    const live2 = live && live.forecast2 && live.forecast2.EnpfCalculatorRealist ? live.forecast2 : null;
    const res2 = live2 ? { code: '0', decoded: live2 } : forecastCalc({ ...body, CalcType: '2' }, { today: isoYMD(td) });
    if (res2 && res2.code === '0') {
      view.annuityOffer = { ask: D.PensionAnnuityAsk, source: live2 ? 'live' : 'replica', byScenario: {} };
      for (const [key, s] of Object.entries(sc)) {
        const x = res2.decoded['EnpfCalculator' + s.api];
        const t = (x.EnpfCalcTable || (res2.decoded['EnpfCalculator' + s.api + 'UIP'] || {}).EnpfCalcTable || [])
          .map((r) => ({ year: +r.Year, age: +r.Age, annuity: +r.PensAnnuity, opv: +r.OPV })).filter((r) => r.annuity > 0);
        view.annuityOffer.byScenario[key] = { monthly: +x.PensionAnnuity, opvMonthly: +x.EnpfPensionOPV, table: t,
          fromAge: t.length ? t[0].age : null };
      }
    }
    view.harmfulCoef = res.details.common.harmfulCoef;
    if (Math.abs(res.details.common.harmfulCoef - K) > 1e-9) {
      view.notes.push('Калькулятор ЕНПФ применил K = ' + num(res.details.common.harmfulCoef) + ' (ОППВ продолжаются до пенсии — ' +
        'допущение API), а в расчёте по ПП 521 взят K = ' + num(K) + ' [docs/03 §7; docs/09 §3.20].');
    }
    for (const w of res.notes.dataWarnings) view.notes.push(w);
    for (const w of res.notes.approximate) view.notes.push(w);
  } else {
    // пенсионер (или API отверг тело): правило ЕНПФ с параметрами 2026 г. от текущего остатка
    view.source = 'rule';
    view.apiMessage = res ? res.message : 'Вкладчик уже достиг пенсионного возраста: прогнозный калькулятор ЕНПФ не считает (ответ code −1).';
    const P = PARAMS_2026, R = P.enpfPayout;
    for (const [key, s] of Object.entries(sc)) {
      let monthly = 0, years = 0, lump = false, lumpReal = 0;
      for (const S of [C.savingsOPV, C.savingsOPPV]) {
        if (!(S > 0)) continue;
        if (S <= R.lumpSumMultipleOfMP * P.MP) { years = Math.max(years, 1); lump = true; lumpReal += S; continue; }
        const pay = Math.max(R.floorShareOfPM * P.PM, S * R.rate * K / 12);
        monthly += pay;
        years = Math.max(years, yearsToExhaust(S, pay, s.realYield));
      }
      view.byScenario[key] = { realYield: s.realYield, savingsAtRetirementReal: C.total, monthlyReal: Math.round(monthly),
        monthlyOPV: null, monthlyOPPV: null, years, yearsOPPV: null, endAge: endAgeOf(years), lumpSum: lump && monthly === 0,
        lumpSumReal: lumpReal };
    }
  }
  const sel = view.byScenario[A.scenario];
  Object.assign(view, { savingsAtRetirementReal: sel.savingsAtRetirementReal, monthlyReal: sel.monthlyReal, years: sel.years,
    endAge: sel.endAge, lumpSum: sel.lumpSum, lumpSumReal: sel.lumpSumReal });
  return view;
}

/**
 * Сверка живого ответа прогноза ЕНПФ с репликой из buildComparison (поля, нужные блоку КП).
 * Расхождение больше tolerance (по умолчанию 1 ₸) — сигнал «методика ЕНПФ изменилась» (docs/09 §9 п. 1).
 * @param {object} comparison  результат buildComparison (или сам enpf.asInEnpfCalculator.expectedLive)
 * @param {object} live        расшифрованный ответ API или результат fetchForecast ({code, decoded|message})
 * @param {{tolerance?: number}} [opts]
 * @returns {{ok: boolean, diffs: {path:string, replica:string, live:string, delta:number|null}[], message: string|null}}
 */
function checkLiveForecast(comparison, live, { tolerance = 1 } = {}) {
  const expected = comparison && comparison.enpf ? comparison.enpf.asInEnpfCalculator?.expectedLive
    : comparison && 'expectedLive' in comparison ? comparison.expectedLive : comparison;
  if (!expected || typeof expected !== 'object') return { ok: false, diffs: [], message: 'Нет данных реплики для сверки (пенсионер или ошибка тела запроса)' };
  if (live && live.code != null && live.code !== '0') return { ok: false, diffs: [], message: live.message || 'ЕНПФ вернул ошибку' };
  const decoded = live?.decoded ?? live;
  const diffs = [];
  for (const [sc, fields] of Object.entries(expected)) {
    const l = decoded?.['EnpfCalculator' + sc];
    for (const [f, v] of Object.entries(fields)) {
      const lv = l ? l[f] : undefined;
      const a = Number(v), b = Number(lv);
      if (lv === undefined || !Number.isFinite(b)) diffs.push({ path: sc + '.' + f, replica: v, live: lv ?? null, delta: null });
      else if (Math.abs(a - b) > tolerance) diffs.push({ path: sc + '.' + f, replica: v, live: lv, delta: b - a });
    }
  }
  return { ok: diffs.length === 0, diffs, message: diffs.length ? 'Ответ ЕНПФ отличается от реплики: возможно, ЕНПФ изменил методику — запустите канарейку (tools/canary.mjs)' : null };
}

// ============================================================== КСЖ ЕНПФ (сверка) ==========

/** Тот же договор в калькуляторе аннуитета на сайте ЕНПФ (только справка, не цифра Standard Life). */
function kszhView(C, sl, td, liveKszh = null) {
  const deferred = !sl.immediate;
  let startAge;
  if (deferred) startAge = sl.startAge;
  else {
    // немедленный договор у ЕНПФ начинается с ближайшего дня рождения (docs/04 §2.4: firstAge)
    const bdThisYear = edate(C.bd, 12 * (td.year - C.bd.year));
    startAge = td.year - C.bd.year + (cmpYMD(bdThisYear, td) >= 0 ? 0 : 1);
  }
  const body = {
    sex: C.sex === 'M' ? '1' : '0', birthday: ruYMD(C.bd), insStartDay: String(startAge),
    totalPension: String(Math.round(sl.premium)), totalPensionType: '0', warrPeriod: String(C.gp),
    pensann: deferred ? '1' : '0', paymentOppv: C.cat === 'oppv' ? '1' : '0',
    disability: { inv1: '1', inv2: '2', inv3: '3' }[C.cat] ?? '0', KSZHParams: { lang: '0' },
  };
  try {
    // живой ответ калькулятора аннуитета ЕНПФ (если передан и это тот же договор) главнее реплики
    const useLive = liveKszh && liveKszh.nominalOutParams && liveKszh.nominalDiagramParams;
    let rep = null;
    try { rep = kszhCalc(body, { today: isoYMD(td) }); } catch (e) { if (!useLive) throw e; }
    const r = useLive ? liveKszh : rep;
    const n = r.nominalOutParams;
    const kszhDiffs = useLive ? ['insPremiumSumm', 'firstMonthPayment', 'insPaymentsStartAge', 'firstPeriod']
      .filter((f) => !rep || String(rep.nominalOutParams[f]) !== String(n[f]))
      .map((f) => ({ path: 'КСЖ.' + f, replica: rep ? rep.nominalOutParams[f] : null, live: n[f] })) : [];
    // график ЕНПФ в тенге (номинал — как в договоре; «текущие цены» ЕНПФ пересчитывает от даты расчёта, в КП не берём)
    const enpfMonths = r.nominalDiagramParams.map((d) => {
      const [dd, mm, yy] = String(d.paymentDate).split('.').map(Number);
      return { date: isoYMD({ year: yy, month: mm, day: dd }), age: +d.age, payment: Math.round(+d.insPaymentSize * 100) / 100 };
    }).filter((d) => d.payment > 0);
    // сравнение с графиком Standard Life (Excel) месяц к месяцу — обе суммы в тенге по договору
    const slMonths = slMonthlyPayments(sl, { toAge: 110 });
    // enpfMonthlyAhead / enpfCumAhead: возрасты (полных лет), в которые выплата / сумма полученного у ЕНПФ больше,
    // чем по договору SL: {fromAge, toAge} (toAge — последний такой возраст до 110 лет) или null — ЕНПФ ни разу не впереди
    const cmpRes = { enpfMonthlyAhead: null, enpfCumAhead: null, enpfHigherAtStart: false,
      enpfFirst: enpfMonths.length ? enpfMonths[0].payment : null, slFirst: sl.firstPayment,
      enpfFirstDate: enpfMonths.length ? enpfMonths[0].date : null, slFirstDate: slMonths.length ? slMonths[0].date : null };
    if (enpfMonths.length && slMonths.length) {
      // помесячные потоки по датам: накопленные суммы на каждую дату выплаты любого из двух договоров
      // только пока есть оба графика (график SL в КП — до 100 лет, у ЕНПФ — до 109)
      const lastDate = [enpfMonths[enpfMonths.length - 1].date, slMonths[slMonths.length - 1].date].sort()[0];
      cmpRes.comparedUntilAge = completedAge(C.bd, toYMD(lastDate));
      const dates = [...new Set([...enpfMonths.map((x) => x.date), ...slMonths.map((x) => x.date)])].filter((d) => d <= lastDate).sort();
      let iE = 0, iS = 0, cumE = 0, cumS = 0, curE = 0, curS = 0;
      const mark = (key, ageAt) => {
        const r = cmpRes[key];
        if (!r) cmpRes[key] = { fromAge: ageAt, toAge: ageAt }; else r.toAge = ageAt;
      };
      for (const dt of dates) {
        while (iE < enpfMonths.length && enpfMonths[iE].date <= dt) { cumE += enpfMonths[iE].payment; curE = enpfMonths[iE].payment; iE++; }
        while (iS < slMonths.length && slMonths[iS].date <= dt) { cumS += slMonths[iS].payment; curS = slMonths[iS].payment; iS++; }
        const ageAt = completedAge(C.bd, toYMD(dt));
        if (curE > 0 && curS > 0 && curE > curS + 0.5) mark('enpfMonthlyAhead', ageAt);
        if (cumE > cumS + 0.5) mark('enpfCumAhead', ageAt);
      }
      cmpRes.enpfHigherAtStart = cmpRes.enpfFirst > cmpRes.slFirst;
    }
    return { body, threshold: +n.insPremiumSumm, firstPayment: +n.firstMonthPayment, firstPaymentCurrent: +r.currentOutParams.firstMonthPayment,
      contractYear: +n.insStartYear, firstPeriod: n.firstPeriod, startAge: +n.insPaymentsStartAge, tariff: { i: PARAMS_2026.kszhEnpf.i, ind: PARAMS_2026.kszhEnpf.ind },
      monthsNominal: enpfMonths, vsSl: cmpRes, source: useLive ? 'live' : 'replica', methodologyDiffs: kszhDiffs, error: null };
  } catch (e) {
    return { body, threshold: null, firstPayment: null, firstPaymentCurrent: null, contractYear: null, firstPeriod: null, startAge: null,
      tariff: { i: PARAMS_2026.kszhEnpf.i, ind: PARAMS_2026.kszhEnpf.ind }, error: e.message };
  }
}

// ============================================================== главное ==========

/**
 * Сравнение «оставить в ЕНПФ» и «перевести в ПА Standard Life» для блока КП.
 *
 * @param {object} client
 * @param {'M'|'F'|string} client.sex
 * @param {string|Date} client.birthDate        'дд.мм.гггг' (или 'гггг-мм-дд')
 * @param {number} client.savingsOPV            текущие накопления ОПВ в ЕНПФ, ₸
 * @param {number} [client.savingsOPPV=0]       текущие накопления ОППВ, ₸
 * @param {boolean} [client.harmful]            ОППВ ≥ 60 мес. к пенсионному возрасту: K = 1,45 к выплатам ЕНПФ
 *                                              (по умолчанию true для категории 'oppv')
 * @param {'standard'|'oppv'|'inv1'|'inv2'|'inv3'} [client.category='standard']  категория ПА SL (или название Excel)
 * @param {number} [client.guaranteeYears=0]    гарантийный период ПА, лет
 * @param {number} [client.slStartAge]          возраст начала выплат ПА (по умолчанию — минимальный по Excel SL)
 * @param {number} [client.transferAmount]      сколько переводится в SL (по умолчанию все накопления; сначала ОПВ,
 *                                              затем ОППВ); остаток остаётся в ЕНПФ
 * @param {number} [client.topUp]               собственная доплата клиента; по умолчанию — как считает движок SL
 *                                              (если средств меньше порога — договор по порогу, доплата = порог − свои
 *                                              средства; дивиденд её не уменьшает — правило продукта от 06.10.2026)
 * @param {number} [client.redemption=0]        выкупная сумма из другой КСЖ (ввод!G17 Excel)
 * @param {object} [assumptions]
 * @param {number|object|function} [assumptions.inflationPath]  инфляция: число или {год: ставка, default}
 *                                              (по умолчанию траектория КСЖ ЕНПФ: 10 % / 6,5 % / 6 %)
 * @param {'pessimist'|'realist'|'optimist'} [assumptions.enpfScenario='realist']  реальная доходность ЕНПФ 0 / 1 / 2 %
 * @param {number} [assumptions.enpfRealYield]  явная реальная доходность ЕНПФ (перекрывает сценарий)
 * @param {object} [assumptions.slTariff=PARAMS_2026.sl]  тариф SL {i, ind, alpha, gamma}
 * @param {number} [assumptions.horizonAge=100]
 * @param {'nominal'|'real2026'} [assumptions.priceBase='real2026']  база заголовочных цифр (metrics.headline)
 * @param {'30/360'|'act/365.25'} [assumptions.dayCount='30/360']  доля года в индексе цен
 * @param {'yearStart'|'paymentDate'} [assumptions.realConvention='yearStart']  как дефлировать выплаты
 * @param {number} [assumptions.dividendRate]   ставка возможного дивиденда SL (по умолчанию 11 % нетто) — только для
 *                                              справочного поля sl.dividend; на премию и доплату не влияет
 * @param {string} [assumptions.mortalityTable] таблица для ожидаемых сумм (по умолчанию — таблица категории)
 * @param {{today?: Date|string, includeMonths?: boolean, live?: {forecast?: object, forecast2?: object, kszh?: object, fetchedAt?: string}}} [opts]
 *   live — живые ответы ЕНПФ по тем же телам запросов (enpf.liveBody, то же с CalcType 2, sl.enpfKszhView.body):
 *   расшифрованный прогноз, прогноз-аннуитет и ответ калькулятора аннуитета. Если переданы, цифры ЕНПФ берутся из них
 *   (а не из копии методики), а отличия от копии — в enpf.asInEnpfCalculator.methodologyDiffs / sl.enpfKszhView.methodologyDiffs.
 *   today — дата расчёта (по умолчанию сегодня); includeMonths — добавить помесячный график ЕНПФ (enpf.nominalSchedule.months)
 * @returns {object} JSON-объект: {calcDate, client, assumptions, enpf, sl, rest, rows, metrics, sharedParts, notes, warnings}
 *   Все суммы — тенге (номинал или в ценах даты расчёта), без округления, кроме сумм Standard Life
 *   (они целые, как в договоре) и цифр «как в калькуляторе ЕНПФ» (целые, как в ответе API).
 */
function buildComparison(client, assumptions = {}, { today, includeMonths = false, live = null } = {}) {
  const td = dateInput(today, 'today');
  const C = normalizeClient(client, td);
  const A = normalizeAssumptions(assumptions || {}, td);
  const idx = makeIndex(td, A.inflationPath, A.dayCount);
  const ageNow = completedAge(C.bd, td);
  if (ageNow >= A.horizonAge) throw inputError('horizonAge', 'Горизонт сравнения (' + A.horizonAge + ' лет) должен быть больше возраста клиента (' + ageNow + ').');
  const warnings = [];

  // ---------------------------------------------------------------- Standard Life
  const sl = slAnnuity({
    sex: C.sex, birthDate: isoYMD(C.bd), calcDate: isoYMD(td), savings: C.transfer, redemption: C.redemption,
    contribution: C.topUp ?? 0, guaranteeYears: C.gp, category: C.categoryName, oppv: C.oppvFlag,
    dividendRate: A.dividendRate, startAge: C.slStartAge, tariff: A.slTariff,
  });
  const slStart = toYMD(sl.startDate);
  const slStartLabel = ageOn(C.bd, slStart);
  // желаемый возраст начала ниже минимального (или текущего): slAnnuity берёт x0 = max(желаемый; минимум; текущий)
  if (C.slStartAge != null && sl.startAge - C.slStartAge > 1e-6) {
    warnings.push(sl.immediate
      ? 'Возраст начала выплат ' + yearsText(C.slStartAge) + ' уже наступил: выплаты ПА начнутся сразу, с даты договора ' + ruYMD(slStart) + '.'
      : 'Возраст начала выплат поднят до минимального по правилам: ' + yearsText(sl.startAge) + ' (указано ' + yearsText(C.slStartAge) +
        '; минимальный возраст ПА — СК ст. 226 п. 12, калькулятор SL).');
  }
  const slMonths = slMonthlyPayments(sl, { toAge: A.slTariff.horizon });
  const slStream = slMonths.map((m, i) => {
    const row = sl.schedule[Math.floor(i / 12)];
    return { date: m.date, amount: m.payment, yearStart: row.date, label: slStartLabel + row.n - 1, lump: false, guaranteed: row.guaranteed };
  });
  // остаток гарантированных выплат с даты d (включительно): суффиксные суммы — в номинале и в ценах даты расчёта
  // (каждая выплата делится на индекс цен СВОЕЙ даты, а не весь остаток — на индекс даты смерти: иначе реальная
  // стоимость остатка гарантии завышена в пользу SL)
  const guarSuffix = new Array(slStream.length + 1).fill(0);
  const guarSuffixReal = new Array(slStream.length + 1).fill(0);
  for (let i = slStream.length - 1; i >= 0; i--) {
    const g = slStream[i].guaranteed ? slStream[i].amount : 0;
    guarSuffix[i] = guarSuffix[i + 1] + g;
    guarSuffixReal[i] = guarSuffixReal[i + 1] + (g ? g / idx(slStream[i].date) : 0);
  }
  const paidPrefix = [0];
  for (const s of slStream) paidPrefix.push(paidPrefix[paidPrefix.length - 1] + s.amount);
  const gEnd = C.gp > 0 ? edate(slStart, 12 * C.gp) : null;

  // ---------------------------------------------------------------- ЕНПФ: дата начала выплат
  const retF = forecastRetirement(C.sex, ruYMD(C.bd));
  const retYMD = toYMD(retF.date);
  const retired = cmpYMD(retYMD, td) <= 0;
  const enpfStart = retired ? td : retYMD;
  const startLabel = ageOn(C.bd, enpfStart);
  const K = C.harmful ? PARAMS_2026.enpfPayout.kHarmful : 1;
  const ctx = {
    td, bd: C.bd, start: enpfStart, startLabel, path: A.inflationPath, dayCount: A.dayCount, K,
    maxYears: Math.max(1, 121 - startLabel),
  };
  const comps = (o, p) => {
    const list = [];
    if (o > 0 || p <= 0) list.push({ key: 'opv', savings: o });
    if (p > 0) list.push({ key: 'oppv', savings: p });
    return list;
  };
  const optByScenario = {};
  for (const [key, s] of Object.entries(COMPARE_SCENARIOS)) {
    const r = key === A.scenario ? A.realYield : s.realYield;
    optByScenario[key] = enpfOption(comps(C.savingsOPV, C.savingsOPPV), ctx, r);
  }
  const enpfOpt = optByScenario[A.scenario];
  const restOpt = C.partial ? enpfOption(comps(C.restOPV, C.restOPPV), ctx, A.realYield) : null;

  const aggE = aggregate(enpfOpt.stream, idx, A.realConvention, A.horizonAge);
  const aggS = aggregate(slStream, idx, A.realConvention, A.horizonAge);
  const aggR = restOpt ? aggregate(restOpt.stream, idx, A.realConvention, A.horizonAge) : new Map();
  const aggP = aggregate(optByScenario.pessimist.stream, idx, A.realConvention, A.horizonAge);
  const aggO = aggregate(optByScenario.optimist.stream, idx, A.realConvention, A.horizonAge);

  // ---------------------------------------------------------------- наследуемые суммы на дату
  const slInheritAt = (d) => {
    if (cmpYMD(d, slStart) < 0) return sl.surrenderBase;            // смерть до первой выплаты — выкупная сумма
    const i = lastBefore(slStream, isoYMD(d)) + 1;                    // первая выплата с датой ≥ d
    return guarSuffix[i];
  };
  /** То же в ценах даты расчёта: выкупная — по индексу даты смерти (выплачивается тогда), остаток гарантии — по датам выплат. */
  const slInheritRealAt = (d) => {
    if (cmpYMD(d, slStart) < 0) return sl.surrenderBase / idx(d);
    return guarSuffixReal[lastBefore(slStream, isoYMD(d)) + 1];
  };
  const slBuyoutAt = (d) => {
    if (monthsBetween(td, d) < 24) return null;                      // первые 24 месяца выкупная не показывается
    const i = lastBefore(slStream, isoYMD(d)) + 1;
    return Math.max(0, Math.round(sl.premium * (1 - A.slTariff.alfa) - paidPrefix[i] * (1 + A.slTariff.gamma)));
  };
  const restBalanceAt = (d) => (restOpt ? enpfBalanceAt(restOpt, ctx, d) : 0);

  // ---------------------------------------------------------------- строки по возрасту
  const rows = [];
  const cum = { eN: 0, eR: 0, sN: 0, sR: 0, pR: 0, oR: 0, aN: 0 };
  for (let age = ageNow; age <= A.horizonAge; age++) {
    const bday = edate(C.bd, 12 * age);
    const d = cmpYMD(bday, td) < 0 ? td : bday;
    const ix = idx(d);
    const e = aggE.get(age), s = aggS.get(age), r = aggR.get(age), p = aggP.get(age), o = aggO.get(age);
    const z = { nominal: 0, real: 0, lump: 0, lumpReal: 0 };
    const E = e || z, S = s || z, Rr = r || z, Pp = p || z, Oo = o || z;
    const slAnnN = S.nominal + Rr.nominal, slAnnR = S.real + Rr.real;
    cum.eN += E.nominal; cum.eR += E.real; cum.sN += slAnnN; cum.sR += slAnnR; cum.pR += Pp.real; cum.oR += Oo.real; cum.aN += S.nominal;
    const enpfInh = enpfBalanceAt(enpfOpt, ctx, d);
    const restInh = restBalanceAt(d);
    const slInh = slInheritAt(d) + restInh;
    const slInhReal = slInheritRealAt(d) + restInh / ix;
    rows.push({
      age, year: C.bd.year + age, date: isoYMD(d),
      enpfMonthlyNominal: (E.nominal - E.lump) / 12, enpfMonthlyReal: (E.real - E.lumpReal) / 12,
      slMonthlyNominal: (slAnnN - Rr.lump) / 12, slMonthlyReal: (slAnnR - Rr.lumpReal) / 12,
      enpfAnnualNominal: E.nominal, enpfAnnualReal: E.real, slAnnualNominal: slAnnN, slAnnualReal: slAnnR,
      enpfLumpSumNominal: E.lump, slLumpSumNominal: Rr.lump,
      enpfCumNominal: cum.eN, slCumNominal: cum.sN, enpfCumReal: cum.eR, slCumReal: cum.sR,
      enpfInheritable: enpfInh, slInheritable: slInh, enpfInheritableReal: enpfInh / ix, slInheritableReal: slInhReal,
      slAnnuityMonthlyNominal: S.nominal / 12, slAnnuityMonthlyReal: S.real / 12,
      restMonthlyNominal: (Rr.nominal - Rr.lump) / 12, restMonthlyReal: (Rr.real - Rr.lumpReal) / 12,
      enpfMonthlyRealPessimist: (Pp.real - Pp.lumpReal) / 12, enpfMonthlyRealOptimist: (Oo.real - Oo.lumpReal) / 12,
      enpfCumRealPessimist: cum.pR, enpfCumRealOptimist: cum.oR,
      slAnnuityCumNominal: cum.aN,
    });
  }
  const rowAt = (a) => rows.find((x) => x.age === a) ?? null;

  // ---------------------------------------------------------------- ЕНПФ: сводки
  const calcView = enpfCalculatorView(C, A, td, { ymd: retYMD, ru: retF.date, age: retF.age }, retired, live);
  // Точные цифры ЕНПФ по возрастам — ровно таблица прогнозного калькулятора ЕНПФ (в ценах 2026 г., постоянная выплата):
  // выплата в возрасте a — строка таблицы с возрастом в [a−1; a], «получено к a» — сумма строк с возрастом ≤ a по 12 выплат.
  // Для пенсионера (прогноз ЕНПФ не считает) — формула Правил (calcView.source = 'rule'). Эти поля использует КП.
  {
    const firstAge = retired ? completedAge(C.bd, td) : retF.age;
    const streamOf = (b) => {
      let tb = b && b.table && b.table.length ? b.table.map((t) => ({ age: t.age, m: t.opv + t.oppv })) : [];
      if (!tb.length && b && b.years > 0 && !b.lumpSum) tb = Array.from({ length: b.years }, (_, k) => ({ age: firstAge + k, m: b.monthlyReal }));
      const lump = !!(b && b.lumpSum), lumpAmt = lump ? (b.lumpSumReal || b.monthlyReal) : 0;
      const from = tb.length ? tb[0].age : firstAge;
      return {
        m: (a) => (lump ? 0 : (tb.find((t) => t.age <= a + 1e-9 && a < t.age + 1 - 1e-9) || { m: 0 }).m),
        c: (a) => (lump ? (a + 1e-9 >= from ? lumpAmt : 0) : tb.reduce((s, t) => s + (t.age <= a + 1e-9 ? 12 * t.m : 0), 0)),
        lump: (a) => (lump && Math.abs(Math.floor(from + 1e-9) - a) < 1e-9 ? lumpAmt : 0),
      };
    };
    const X = streamOf(calcView.byScenario[A.scenario]), XP = streamOf(calcView.byScenario.pessimist), XO = streamOf(calcView.byScenario.optimist);
    for (const r of rows) {
      Object.assign(r, {
        enpfCalcMonthly: X.m(r.age), enpfCalcCum: X.c(r.age), enpfCalcLump: X.lump(r.age),
        enpfCalcMonthlyPessimist: XP.m(r.age), enpfCalcMonthlyOptimist: XO.m(r.age),
        enpfCalcCumPessimist: XP.c(r.age), enpfCalcCumOptimist: XO.c(r.age),
      });
    }
  }
  const summarize = (opt) => {
    const regular = opt.parts.filter((p) => !p.sched.lumpSum);
    const lumps = opt.parts.filter((p) => p.sched.lumpSum);
    // поток — части ОПВ и ОППВ подряд, поэтому последний платёж ищем по максимуму даты
    let last = null;
    for (const s of opt.stream) if (!last || s.date > last.date) last = s;
    const lastLabel = last ? last.label : null;
    const exhausted = opt.parts.every((p) => p.sched.exhausted);
    const startIdx = idx(enpfStart);
    const firstPayment = regular.reduce((a, p) => a + p.sched.firstPayment, 0);
    const savingsAtStart = opt.parts.reduce((a, p) => a + p.savingsAtStart, 0);
    let totN = 0, totR = 0;
    for (const s of opt.stream) {
      if (s.label > A.horizonAge) continue;
      totN += s.amount;
      totR += s.amount / idx(A.realConvention === 'paymentDate' ? s.date : s.yearStart);
    }
    return {
      realYield: opt.realYield, nominalYieldFirstYear: (1 + inflationRate(A.inflationPath, enpfStart.year)) * (1 + opt.realYield) - 1,
      savingsToday: opt.parts.reduce((a, p) => a + p.savings, 0), savingsAtStart, savingsAtStartReal: savingsAtStart / startIdx,
      firstPayment, firstPaymentReal: firstPayment / startIdx,
      lumpSum: regular.length === 0, lumpSumAmount: lumps.reduce((a, p) => a + p.savingsAtStart, 0),
      floorApplied: regular.some((p) => p.sched.floorApplied),
      floor: opt.parts[0].sched.floor, lumpSumThreshold: opt.parts[0].sched.lumpSumThreshold,
      exhausted, endAge: exhausted ? lastLabel : null, lastPaymentDate: last ? last.date : null,
      totalPaidNominal: totN, totalPaidReal: totR,
    };
  };
  const mainSum = summarize(enpfOpt);
  const nominalSchedule = {
    rule: 'ПП 521: 6,5 %/12 · K, не меньше 70 % ПМ; +5 % в год до исчерпания; доходность (1 + π)(1 + r) − 1',
    scenario: A.scenario, startDate: isoYMD(enpfStart), startAge: startLabel, K, ...mainSum,
    byAge: rows.filter((x) => x.enpfAnnualNominal > 0).map((x) => ({
      age: x.age, monthlyNominal: x.enpfMonthlyNominal, monthlyReal: x.enpfMonthlyReal,
      annualNominal: x.enpfAnnualNominal, annualReal: x.enpfAnnualReal, lumpSumNominal: x.enpfLumpSumNominal,
      cumulativeNominal: x.enpfCumNominal, cumulativeReal: x.enpfCumReal,
    })),
    components: enpfOpt.parts.map((p) => ({ key: p.key, savingsToday: p.savings, savingsAtStart: p.savingsAtStart,
      firstPayment: p.sched.lumpSum ? 0 : p.sched.firstPayment, lumpSum: p.sched.lumpSum, floorApplied: p.sched.floorApplied,
      exhausted: p.sched.exhausted, yearsPaid: p.sched.yearsPaid, totalPaid: p.sched.totalPaid })),
    corridor: Object.fromEntries(Object.keys(COMPARE_SCENARIOS).map((k) => {
      const x = k === A.scenario ? mainSum : summarize(optByScenario[k]);
      return [k, { realYield: x.realYield, firstPayment: x.firstPayment, firstPaymentReal: x.firstPaymentReal, lumpSum: x.lumpSum,
        endAge: x.endAge, totalPaidNominal: x.totalPaidNominal, totalPaidReal: x.totalPaidReal }];
    })),
  };
  if (includeMonths) {
    nominalSchedule.months = enpfOpt.parts.map((p) => ({ key: p.key, months: p.sched.months, years: p.sched.years }));
  }

  // изъятие сверх ПМД (только справка; таблица ПМД 2026 по новой методике)
  const pmdNew = td.year === 2026 ? (PMD_2026_BY_AGE[ageNow] ?? null) : null;
  const pmdApi = td.year === 2026 ? (POROG_TABLE.porog_current_year_by_age_today?.[String(ageNow)] ?? null) : null;
  const withdrawal = {
    ageNow, pmdNew, availableNowNew: pmdNew == null ? null : Math.max(0, C.savingsOPV - pmdNew),
    pmdInEnpfCalculator: pmdApi, availableNowInEnpfCalculator: pmdApi == null ? null : Math.max(0, Math.round(C.savingsOPV - pmdApi)),
    restAfterAnnuity: C.partial ? C.restOPV : 0,
  };

  // ---------------------------------------------------------------- SL: сводки
  const slFirstReal = sl.firstPayment / idx(slStart);
  const scheduleByAge = rows.filter((x) => x.slAnnuityMonthlyNominal > 0).map((x) => {
    const row = sl.schedule.find((r0) => slStartLabel + r0.n - 1 === x.age);
    return { age: x.age, date: row.date, monthlyNominal: row.monthly, monthlyReal: x.slAnnuityMonthlyReal,
      annualNominal: row.annual, annualReal: x.slAnnuityMonthlyReal * 12, cumulativeNominal: row.cumulative, guaranteed: row.guaranteed };
  });
  let cr = 0;
  for (const r0 of scheduleByAge) { cr += r0.annualReal; r0.cumulativeReal = cr; }
  const guaranteeRemainderByAge = [];
  if (gEnd) {
    for (const x of rows) {
      const d = toYMD(x.date);
      if (cmpYMD(d, slStart) < 0 || cmpYMD(d, gEnd) >= 0) continue;
      guaranteeRemainderByAge.push({ age: x.age, date: x.date, nominal: slInheritAt(d), real: slInheritRealAt(d) });
    }
  }
  const buyoutByAge = rows.map((x) => {
    const d = toYMD(x.date);
    const v = slBuyoutAt(d);
    return { age: x.age, date: x.date, nominal: v, real: v == null ? null : v / idx(d) };
  });
  const slBlock = {
    available: sl.ok, status: sl.status, fundsStatus: sl.fundsStatus, warnings: sl.warnings,
    tariff: { version: A.slTariff.version, i: A.slTariff.i, ind: A.slTariff.ind, alpha: A.slTariff.alfa, gamma: A.slTariff.gamma },
    category: C.cat, categoryName: C.categoryName, table: sl.table,
    threshold: sl.threshold, minPayment: sl.minPayment, nax: sl.nax,
    transferAmount: C.transfer, redemption: sl.redemption, premium: sl.premium, mode: sl.mode,
    // доплата = порог − свои средства (правило продукта от 06.10.2026); дивиденд — справочно, доплату не уменьшает
    topUp: sl.topup,
    dividendRate: sl.dividendRate, dividend: sl.dividend,
    paymentAtContract: sl.paymentAtContract, firstPayment: sl.firstPayment, firstPaymentReal: slFirstReal,
    startAge: sl.startAge, startAgeInt: sl.startAgeInt, startDate: sl.startDate, deferral: sl.deferral, immediate: sl.immediate,
    guaranteeYears: C.gp, guaranteeEndDate: gEnd ? isoYMD(gEnd) : null,
    inheritanceBeforeStart: sl.surrenderBase, surrenderFrom: sl.surrenderFrom,
    burialBenefitMin: PARAMS_2026.sl.burialMRP * PARAMS_2026.MRP,
    scheduleByAge, buyoutByAge, guaranteeRemainderByAge,
    enpfKszhView: kszhView(C, sl, td, live && live.kszh ? live.kszh : null),
  };

  // ---------------------------------------------------------------- метрики
  const paymentAt = {}, cumulativeAt = {};
  for (const a of A.paymentAges) {
    const r0 = rowAt(a);
    paymentAt[a] = r0 ? { enpf: { nominal: r0.enpfMonthlyNominal, real: r0.enpfMonthlyReal }, sl: { nominal: r0.slMonthlyNominal, real: r0.slMonthlyReal } } : null;
  }
  for (const a of A.cumulativeAges) {
    const r0 = rowAt(a);
    cumulativeAt[a] = r0 ? { enpf: { nominal: r0.enpfCumNominal, real: r0.enpfCumReal }, sl: { nominal: r0.slCumNominal, real: r0.slCumReal } } : null;
  }
  // лидер по накопленной сумме в реальных ценах
  const leaderChanges = [];
  let leader = 'equal', slOvertakes = null, enpfOvertakes = null;
  for (const r0 of rows) {
    const l = r0.slCumReal > r0.enpfCumReal + 0.5 ? 'sl' : r0.enpfCumReal > r0.slCumReal + 0.5 ? 'enpf' : 'equal';
    if (l !== 'equal' && l !== leader) {
      leaderChanges.push({ age: r0.age, leader: l });
      if (l === 'sl' && slOvertakes == null) slOvertakes = r0.age;
      if (l === 'enpf' && enpfOvertakes == null && leader === 'sl') enpfOvertakes = r0.age;
    }
    if (l !== 'equal') leader = l;
  }
  const finalLeader = leader;
  const slAheadFromAge = finalLeader === 'sl' ? leaderChanges[leaderChanges.length - 1].age : null;
  // ожидаемые суммы по таблице смертности
  const table = A.mortalityTable ?? SL_CATEGORY_TABLE[C.categoryName];
  const surv = makeSurvival({ sex: C.sex, table, bd: C.bd, td });
  const expect = (streams) => {
    let n = 0, rr = 0;
    for (const st of streams) for (const s of st) {
      if (s.label > A.horizonAge) continue;
      const pr = surv(toYMD(s.date));
      n += pr * s.amount;
      rr += pr * s.amount / idx(A.realConvention === 'paymentDate' ? s.date : s.yearStart);
    }
    return { nominal: n, real: rr };
  };
  /** fn(d) → [номинал, в ценах даты расчёта] наследуемой суммы при смерти в месяц d. */
  const heirs = (fn) => {
    let n = 0, rr = 0, prev = 1;
    const endD = edate(C.bd, 12 * (A.horizonAge + 1));
    for (let k = 1; ; k++) {
      const d = edate(td, k);
      if (cmpYMD(d, endD) > 0) break;
      const sv = surv(d);
      const [vN, vR] = fn(d);
      n += (prev - sv) * vN;
      rr += (prev - sv) * vR;
      prev = sv;
    }
    return { nominal: n, real: rr };
  };
  const eLife = expect([enpfOpt.stream]);
  const sLife = expect(restOpt ? [slStream, restOpt.stream] : [slStream]);
  const eHeirs = heirs((d) => { const v = enpfBalanceAt(enpfOpt, ctx, d); return [v, v / idx(d)]; });
  const sHeirs = heirs((d) => { const r = restBalanceAt(d); return [slInheritAt(d) + r, slInheritRealAt(d) + r / idx(d)]; });
  const expectedLifetimeTotal = {
    table, tableName: mortalityTableName(table), lifeExpectancy: lifeExpectancy({ sex: C.sex, age: ageNow, table }), toAge: A.horizonAge,
    enpf: { nominal: eLife.nominal, real: eLife.real, toHeirsNominal: eHeirs.nominal, toHeirsReal: eHeirs.real,
      totalWithHeirsReal: eLife.real + eHeirs.real },
    sl: { nominal: sLife.nominal, real: sLife.real, toHeirsNominal: sHeirs.nominal, toHeirsReal: sHeirs.real,
      totalWithHeirsReal: sLife.real + sHeirs.real },
  };
  const topUp = sl.topup;
  const topUpPaybackAge = topUp > 0 ? (rows.find((x) => x.slCumReal - x.enpfCumReal >= topUp)?.age ?? null) : null;
  const premiumPaybackAge = rows.find((x) => x.slAnnuityCumNominal >= sl.premium && x.slAnnuityCumNominal > 0)?.age ?? null;
  const metrics = {
    yearsEarlier: (cmpYMD(slStart, enpfStart) <= 0 ? monthsBetween(slStart, enpfStart) : -monthsBetween(enpfStart, slStart)) / 12 || 0,
    firstPayment: {
      enpf: { nominal: mainSum.lumpSum ? mainSum.lumpSumAmount : mainSum.firstPayment, real: mainSum.lumpSum ? mainSum.lumpSumAmount / idx(enpfStart) : mainSum.firstPaymentReal,
        date: isoYMD(enpfStart), age: startLabel, lumpSum: mainSum.lumpSum },
      sl: { nominal: sl.firstPayment, real: slFirstReal, date: sl.startDate, age: slStartLabel, lumpSum: false },
    },
    paymentAt, cumulativeAt,
    slOvertakesEnpfAtAge: slOvertakes, enpfOvertakesSlAtAge: enpfOvertakes, slAheadFromAge, leaderAtHorizon: finalLeader, leaderChanges,
    enpfEndsAtAge: mainSum.endAge, enpfExhausted: mainSum.exhausted,
    expectedLifetimeTotal,
    topUp, topUpPaybackAge, premiumPaybackAge,
  };
  const base = A.priceBase === 'nominal' ? 'nominal' : 'real';
  const r80 = rowAt(80) ?? rows[rows.length - 1];
  metrics.headline = {
    priceBase: A.priceBase,
    enpfFirstPayment: metrics.firstPayment.enpf[base], slFirstPayment: metrics.firstPayment.sl[base],
    enpfStartAge: startLabel, slStartAge: slStartLabel, yearsEarlier: metrics.yearsEarlier, enpfEndsAtAge: mainSum.endAge,
    differenceAtAge: r80.age,
    cumulativeDifference: base === 'nominal' ? r80.slCumNominal - r80.enpfCumNominal : r80.slCumReal - r80.enpfCumReal,
    enpfFirstPaymentAsInCalculator: calcView.monthlyReal,
  };

  // ---------------------------------------------------------------- общая часть и заметки
  const sharedParts = {
    excluded: true,
    items: [
      { key: 'basic', name: 'Базовая пенсия', note: 'назначается государством в обоих вариантах; от аннуитета не зависит', source: 'СК ст. 206 п. 2; docs/06 §11' },
      { key: 'solidarity', name: 'Солидарная пенсия', note: 'за стаж до 1998 г.; одинакова в обоих вариантах', source: 'СК ст. 210; docs/06 §11' },
      { key: 'opvr', name: 'Выплаты за счёт ОПВР', note: 'условные накопления, не переводятся в страховую организацию и не наследуются; пожизненно платит ЕНПФ в обоих вариантах', source: 'СК ст. 222; ПП №705; docs/09 §9 п. 6' },
      { key: 'futureContributions', name: 'Будущие взносы ОПВ', note: 'после перевода продолжают поступать в ЕНПФ так же, как без перевода; в сравнение не входят', source: 'docs/07 §6.3 п. 2; docs/09 §3.10' },
    ],
    text: 'Базовая и солидарная пенсии, выплаты ОПВР и будущие взносы одинаковы в обоих вариантах и в сравнение не входят: ОПВР не переводится в страховую организацию (СК ст. 222).',
  };
  const notes = buildNotes({ C, A, td, ageNow, sl, slBlock, retired, retF, calcView, mainSum, withdrawal, K, table });
  if (!sl.ok) warnings.push('Договор ПА сейчас недоступен: ' + sl.status + ' (Excel SL: договор с 45 лет, с 40 — только при ОППВ). Цифры SL — справочные.');
  for (const w of sl.warnings) warnings.push(w);
  if (C.topUp != null && sl.mode === 'threshold') warnings.push('Указанной доплаты не хватает до порога ' + money(sl.threshold) + ': договор посчитан по порогу, доплата — ' + money(sl.topup) + '.');
  if (calcView.source === 'rule' && !retired) warnings.push('Калькулятор ЕНПФ (реплика) отверг тело запроса: ' + calcView.apiMessage);

  return {
    version: 'compare/1',
    calcDate: isoYMD(td),
    client: {
      sex: C.sex, birthDate: ruYMD(C.bd), ageNow, category: C.cat, categoryName: C.categoryName,
      savingsOPV: C.savingsOPV, savingsOPPV: C.savingsOPPV, savingsTotal: C.total,
      transferAmount: C.transfer, transferFromOPV: C.fromOPV, transferFromOPPV: C.fromOPPV, restInEnpf: C.total - C.transfer,
      harmful: C.harmful, guaranteeYears: C.gp,
    },
    assumptions: {
      inflationPath: typeof A.inflationPath === 'function' ? null : A.inflationPath, inflationDescription: A.describe,
      enpfScenario: A.scenario, enpfRealYield: A.realYield,
      slTariff: { version: A.slTariff.version, i: A.slTariff.i, ind: A.slTariff.ind, alpha: A.slTariff.alfa, gamma: A.slTariff.gamma },
      horizonAge: A.horizonAge, priceBase: A.priceBase, priceBaseDate: isoYMD(td), dayCount: A.dayCount, realConvention: A.realConvention,
      mortalityTable: table, mortalityTableName: mortalityTableName(table),
    },
    enpf: {
      retirementDate: isoYMD(retYMD), retirementAge: retF.age, retired, startDate: isoYMD(enpfStart), startAge: startLabel,
      asInEnpfCalculator: calcView,
      nominalSchedule,
      balanceByAge: rows.map((x) => ({ age: x.age, date: x.date, nominal: x.enpfInheritable, real: x.enpfInheritableReal })),
      liveBody: calcView.liveBody,
      withdrawal,
    },
    sl: slBlock,
    rest: restOpt ? {
      amount: C.total - C.transfer, opv: C.restOPV, oppv: C.restOPPV, startDate: isoYMD(enpfStart),
      ...(({ savingsAtStart, firstPayment, firstPaymentReal, lumpSum, lumpSumAmount, endAge, exhausted, totalPaidNominal, totalPaidReal }) =>
        ({ savingsAtStart, firstPayment, firstPaymentReal, lumpSum, lumpSumAmount, endAge, exhausted, totalPaidNominal, totalPaidReal }))(summarize(restOpt)),
    } : null,
    rows,
    metrics,
    sharedParts,
    notes,
    warnings,
  };
}

// ============================================================== заметки ==========

/** Русские пояснения к допущениям, каждое — со ссылкой на источник в квадратных скобках. */
function buildNotes({ C, A, td, ageNow, sl, slBlock, retired, retF, calcView, mainSum, withdrawal, K, table }) {
  const n = [];
  const dateRu = ruYMD(td);
  const sc = COMPARE_SCENARIOS[A.scenario];
  // цены
  n.push('Цены: номинальные выплаты пересчитаны в цены ' + dateRu + ' по инфляции «' + A.describe + '»' +
    (A.inflationPath === PARAMS_2026.kszhInflationPath ? ' — это допущение калькулятора аннуитета ЕНПФ (КСЖ), а не прогноз компании' : '') +
    '. ' + (A.realConvention === 'yearStart'
      ? 'Выплаты каждого года делятся на индекс цен на начало этого года выплат.'
      : 'Каждая выплата делится на индекс цен на дату выплаты.') +
    ' [docs/09 §7.2, §8.3 п. 2; docs/04 §4.8]');
  // ЕНПФ по правилам
  n.push('«Оставить в ЕНПФ» посчитано по правилу ПП 521 в номинале: в первый год ' + pct(PARAMS_2026.enpfPayout.rate) +
    (K !== 1 ? ' × ' + num(K) : '') + ' накоплений в год (÷ 12), не меньше 70 % ПМ; далее +5 % в год до исчерпания; ' +
    'остаток растёт на (1 + инфляция)(1 + r) − 1, r = ' + pct(A.realYield) + ' (' + sc.label + ' сценарий ЕНПФ). ' +
    'Реальные выплаты ЕНПФ на инфляцию не умножаются. [ПП РК №521; docs/09 §3.2, §3.19, §6.3]');
  // как в калькуляторе
  if (calcView.source === 'replica') {
    n.push('Цифра «как в калькуляторе ЕНПФ» (' + money(calcView.monthlyReal) + ' в месяц, ' + calcView.years + ' лет) — реплика прогнозного ' +
      'калькулятора enpf.kz только по текущим накоплениям (зарплата 1 ₸, будущие взносы ≈ 0). Это суммы в ценах 2026 г. ' +
      'с постоянной реальной выплатой; с законом ПП 521 они совпадают только при инфляции 5 % (и то в годовом выражении: ' +
      'по закону номинальная выплата постоянна 12 месяцев, поэтому даже при 5 % деньги заканчиваются чуть позже), ' +
      'так что срок «' + calcView.years + ' лет» — свойство модели ЕНПФ, а не закона. [docs/09 §3.2, §3.10; test/compare.test.mjs §7.3]');
  }
  n.push('Реальная доходность ЕНПФ за 2021–2025 гг. ≈ −0,2 % в год; сценарии калькулятора ЕНПФ 0 / 1 / 2 % — это «история / ' +
    'оптимистично / очень оптимистично». Коридор сценариев — в nominalSchedule.corridor. [docs/06 §0 п. 9, §14]');
  // SL
  n.push('Аннуитет Standard Life — по калькулятору компании «ПА калькулятор ' + (A.slTariff.version || '21.09.2026') + '» (i = ' + pct(A.slTariff.i) +
    ', индексация ' + pct(A.slTariff.ind) + ', расходы ' + pct(A.slTariff.alfa) + ' от премии и ' + pct(A.slTariff.gamma) +
    ' от выплат): выплаты пожизненные, рост раз в год с округлением до тенге, как в договоре. [docs/08; docs/09 §6.5]');
  n.push('Возможный дивиденд Standard Life (' + pct(sl.dividendRate) + ' нетто от премии, в этом расчёте до ' + money(sl.dividend) +
    ') не гарантирован, выплачивается по решению компании и в суммы выплат не включён. ' +
    (sl.mode === 'threshold'
      ? 'Доплата ' + money(sl.topup) + ' = порог ' + money(sl.threshold) + ' − свои средства ' + money(sl.savings + sl.redemption) +
        ': дивиденд её не уменьшает — премия вносится целиком (правило продукта Standard Life от 06.10.2026). '
      : '') + '[docs/00 §6.2; docs/09 §3.14]');
  n.push('Налоги не учтены: ИПН с выплат ЕНПФ с 2026 г. не удерживается; налогообложение страховых выплат по ПА ' +
    '(Правила SL п. 43 против НК 2026 ст. 435) не подтверждено налоговым консультантом. [docs/09 §3.16]');
  n.push('Базовая, солидарная пенсии и ОПВР одинаковы в обоих вариантах и исключены: ОПВР не переводится в страховую организацию. [СК ст. 222; docs/09 §9 п. 6]');
  n.push('Накопленные суммы — «если клиент доживёт до этого возраста». Ожидаемые суммы (metrics.expectedLifetimeTotal) ' +
    'взвешены по вероятностям дожития: ' + mortalityTableName(table) + ', до ' + A.horizonAge + ' лет. [АРРФР №45 прил. 2; lib/actuarial.js]');
  n.push('Наследование: остаток ЕНПФ (ОПВ, ОППВ) наследуется полностью; по аннуитету — остаток выплат гарантированного периода ' +
    '(с 25.08.2026 единовременно или по графику; в ценах даты расчёта каждая оставшаяся выплата пересчитана по индексу цен своей даты), ' +
    'до начала выплат — выкупная сумма ' + money(sl.surrenderBase) +
    '; дополнительно выплата на погребение не меньше 35 МРП (' + money(slBlock.burialBenefitMin) + ', в суммы не включена). ' +
    '[СК ст. 220 п. 4, ст. 226 п. 12; типовой договор пп. 10–12; docs/06 §0 п. 8]');
  n.push('Гарантии: в ЕНПФ с 01.01.2027 государство гарантирует только номинал взносов; выплаты по ПА защищены ФГСВ. ' +
    'Формулировку для КП согласовать с юристом. [Закон 306-VIII; docs/09 §8.3 п. 5]');
  n.push('ПМ и МП будущего года назначения выплат ЕНПФ (пол 70 % ПМ и порог единовременной выплаты 12 МП) — значения 2026 г., ' +
    'проиндексированные по той же инфляции. [lib/enpf-schedule.js; СК ст. 220 п. 2]');
  // калькулятор ЕНПФ отстаёт
  if (withdrawal.pmdNew != null && withdrawal.pmdInEnpfCalculator != null && withdrawal.pmdNew !== withdrawal.pmdInEnpfCalculator) {
    n.push('Калькулятор ЕНПФ на ' + dateRu + ' использует старую таблицу порога достаточности (ПМД) 2026 г.: для ' + ageNow + ' лет — ' +
      money(withdrawal.pmdInEnpfCalculator) + ', а по новой методике (ПП №422) — ' + money(withdrawal.pmdNew) +
      '. Поэтому «доступно к изъятию» на сайте ЕНПФ (' + money(withdrawal.availableNowInEnpfCalculator) + ') завышено; по действующим правилам — ' +
      money(withdrawal.availableNowNew) + '. Прогноз ЕНПФ также удерживает 10 % ИПН с изъятия и ограничивает УИП 50 %, хотя закон этого уже не требует. [docs/09 §3.7–3.9]');
  }
  const kv = slBlock.enpfKszhView;
  if (kv && kv.firstPayment != null) {
    const RP = PARAMS_2026.regulatorPA;
    n.push('Калькулятор аннуитета на сайте ЕНПФ (КСЖ) — только справка: он считает по тарифу до 2026 г. (i = 8 %, индексация 7 %), ' +
      'а не по действующей Методике АРРФР №45 (i от ' + pct(RP.iMin) + ' до ' + pct(RP.iMax) + ', индексация не меньше ' + pct(RP.indMin) + '), ' +
      'и датирует договор ближайшим днём рождения клиента — ' + (sl.immediate ? 'даже при немедленном начале выплат' : 'так и при отложенном, и при немедленном начале выплат') +
      ' (здесь у ЕНПФ ' + (kv.firstPeriod ? 'выплаты с ' + kv.firstPeriod + ', ' : '') + 'с ' + ageGenText(kv.startAge) + ', год договора ' + kv.contractYear + '). ' +
      'Для этого договора у ЕНПФ порог ' + money(kv.threshold) + ' и первая выплата ' + money(kv.firstPayment) +
      ' — клиент, проверивший себя на сайте ЕНПФ, увидит другие цифры. [docs/04 §2.4; docs/09 §3.1, §3.12; АРРФР №45 ред. 27.01.2026]');
  }
  if (!sl.immediate && sl.deferral > 0) {
    n.push('Отсрочка ' + sl.deferral + ' лет считается в целых годах, выплата индексируется ' + sl.deferral + ' раз до старта (Excel SL); ' +
      'калькулятор КСЖ ЕНПФ индексирует d − 1 раз — нужна позиция актуария. [docs/09 §3.12]');
  }
  if (C.sex === 'F') {
    n.push('Пенсионный возраст женщин растёт: 61 год (выход до 2027 г.), 61,5 (2028), 62 (2029), 62,5 (2030), 63 (с 2031) — по году выхода; ' +
      'для клиента выплаты ЕНПФ начнутся в ' + num(retF.age) + ' (' + retF.date + '). Начало выплат ПА у женщин — 53…55 лет по дате рождения. [СК ст. 207, ст. 226 п. 12; docs/09 §3.17]');
  }
  if (retired) {
    n.push('Клиент уже достиг пенсионного возраста (' + retF.date + '): прогнозный калькулятор ЕНПФ такие расчёты не делает (ответ code −1). ' +
      'Выплаты ЕНПФ посчитаны по ПП 521 с параметрами 2026 г. от текущего остатка, как если бы назначались ' + dateRu +
      '; если выплаты уже идут, фактический график ЕНПФ может отличаться (размер не пересчитывается от остатка). [docs/09 §8.2 п. 3; ПП 521]');
  }
  if (mainSum.lumpSum || mainSum.lumpSumAmount > 0) {
    n.push('Накопления на дату назначения (' + money(mainSum.lumpSumAmount) + (mainSum.lumpSum ? '' : ' по части ОПВ/ОППВ') + ') не больше 12 МП (' +
      money(mainSum.lumpSumThreshold) + '): ЕНПФ выплачивает их единовременно. [СК ст. 220 п. 2; ПП 521 Правила п. 3]');
  }
  if (C.partial) {
    n.push('Переводится ' + money(C.transfer) + ' из ' + money(C.total) + '; остаток ' + money(C.total - C.transfer) +
      ' остаётся в ЕНПФ и в варианте «перевести» выплачивается по ПП 521 с пенсионного возраста (входит в суммы SL-варианта, ' +
      'отдельно — rest*). После заключения договора ПА остаток ОПВ, по СК ст. 220 п. 3 (абз. 4), можно снять полностью ' +
      '(на жильё, лечение) — ПРОВЕРИТЬ у юриста перед включением в КП. [docs/06 §9.5; docs/09 §9 п. 8; проверить]');
  }
  if (C.harmful || C.cat === 'oppv') {
    n.push('Ранние выплаты ЕНПФ при ОППВ ≥ 84 мес. (с 55 лет, специальная социальная выплата) не моделируются: прогнозный калькулятор ЕНПФ их тоже не считает. [СК ст. 220 п. 1-1; docs/09 §8.3 п. 6]');
  }
  if (C.cat === 'inv1' || C.cat === 'inv2') {
    n.push('Инвалиды I/II группы бессрочно могут получать выплаты ЕНПФ до пенсионного возраста с повышающим коэффициентом; ' +
      'это в сравнении не моделируется (ЕНПФ — с пенсионного возраста). [СК ст. 220 п. 1 пп. 2; docs/09 §8.3 п. 6]');
  }
  if (C.gp > PARAMS_2026.sl.maxGuaranteeYears) {
    n.push('Гарантийный период ' + C.gp + ' лет больше, чем допускает калькулятор SL (' + PARAMS_2026.sl.maxGuaranteeYears + '); закон максимум не задаёт — решение продукта. [docs/09 §3.15]');
  }
  if (!calcView.liveBody) {
    n.push('Живая сверка с ЕНПФ для этого клиента невозможна: ' + (calcView.apiMessage || 'нет тела запроса') + ' [docs/09 §8.2]');
  } else {
    n.push('Тело запроса для живой сверки (enpf.liveBody) содержит только пол, дату рождения и суммы накоплений; отправлять в ЕНПФ ' +
      'только с согласия клиента (README генератора обещает, что данные никуда не отправляются). [docs/09 §8.3 п. 7]');
  }
  for (const w of calcView.notes) n.push(w + ' [lib/enpf-forecast.js]');
  return n;
}

__EL.define('compare.js', { ENPF_METHODOLOGY_VERIFIED_ON, COMPARE_SCENARIOS, COMPARE_CATEGORIES, COMPARE_DEFAULTS, MORTALITY_TABLE_NAMES, mortalityTableName, describeInflationPath, COMPARE_FIELD_LABELS, checkLiveForecast, buildComparison });
})(typeof window !== 'undefined' ? window : globalThis);
