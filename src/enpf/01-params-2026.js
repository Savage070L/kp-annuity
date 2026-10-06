/* ════ EnpfLib · params-2026.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/params-2026.js
 * (sha256 e08d6fa8dcdf8715…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Нормативные и методические параметры 2026 года (по состоянию на 05.10.2026).
 * Все значения и их статус — docs/06_regulation_2026.md §2, docs/09_cross_check.md §6.6, docs/04, docs/08.
 *
 * Метки в комментариях: [проверено] — подтверждено живым API ЕНПФ, Excel или текстом НПА;
 * [вероятно] — из СМИ/косвенно; [ЕНПФ] — допущение калькулятора ЕНПФ, а не норма закона.
 *
 * Модуль без зависимостей, работает в браузере и в Node 22.
 */

/** Источники (пути — относительно корня проекта «Калькулятор ЕНПФ»). */
const SOURCES = Object.freeze({
  socialCode: 'Социальный кодекс РК №224-VII (ред. 07.09.2026): research/regulation/sources/social_code_prg.txt',
  pp521: 'ПП РК №521 от 30.06.2023 (ред. 14.07.2026; Методика ПМД — ред. ПП №422 от 21.05.2026): research/regulation/sources/pp521_P2300000521.txt',
  ardfm45: 'Пост. АРРФР №45 от 07.06.2023 (ред. №3 от 27.01.2026): research/regulation/sources/ardfm45_V2300032831.txt (стр. 61, 379)',
  budget: 'Закон о республиканском бюджете на 2026–2028 гг. (МРП, МЗП, ПМ, МП)',
  kszhEnpf: 'Калькулятор КСЖ ЕНПФ calculateKSZHDev, восстановлен 05.10.2026: docs/04_kszh_annuity_calc.md, research/kszh/',
  forecastEnpf: 'Прогнозный калькулятор ЕНПФ EnpfCalculator2New: docs/02, docs/03, research/forecast_payout/payout_params_2026.json',
  slExcel: 'ПА калькулятор 21.09.2026.xlsx (АО «КСЖ «Standard Life»): docs/08, research/pa_excel/',
  pmd2026: 'ПМД 2026 по новой методике (ПП №422): research/regulation/data/pmd_2026_implied.csv, docs/06 §9',
});

/** Прожиточный минимум (ПМ) по годам — официальные значения. [проверено для 2026, вероятно для 2023–2025] */
const PM_HISTORY = Object.freeze({ 2023: 40567, 2024: 43407, 2025: 46228, 2026: 50851 });
/** Минимальная пенсия (МП) по годам. */
const MP_HISTORY = Object.freeze({ 2023: 53076, 2024: 57853, 2025: 62771, 2026: 69049 });
/** МРП по годам. */
const MRP_HISTORY = Object.freeze({ 2025: 3932, 2026: 4325 });
/** МЗП по годам. */
const MZP_HISTORY = Object.freeze({ 2025: 85000, 2026: 85000 });

/**
 * ПМ, который калькулятор КСЖ ЕНПФ берёт для минимума 70 % ПМ по году строки 0 (года договора).
 * 2027+ — прогноз ЕНПФ, не закон. После 2029: 57 405 · 1,006^(год − 2029) (так в API, похоже на опечатку 0,006 вместо 0,06).
 * [проверено пробами минимальной выплаты, docs/04 §4.4]
 */
const KSZH_PM_PROJECTION = Object.freeze({ 2024: 43407, 2025: 46228, 2026: 50851, 2027: 54156, 2028: 57405, 2029: 57405 });
const KSZH_PM_GROWTH_AFTER_2029 = 0.006;

/**
 * Траектория инфляции, по которой калькулятор КСЖ ЕНПФ пересчитывает суммы «в текущих ценах».
 * Прошлые годы — сохранённые прогнозные допущения ЕНПФ, а не фактический ИПЦ. 2028+ — 6 %.
 * [проверено по месячным отношениям nominal/current, docs/04 §4.8]
 */
const KSZH_INFLATION_PATH = Object.freeze({
  2020: 0.0, 2021: 0.05, 2022: 0.14, 2023: 0.085, 2024: 0.07, 2025: 0.105, 2026: 0.10, 2027: 0.065, 2028: 0.06,
  default: 0.06, // 2029+ (ключ понимает inflationRate из lib/enpf-schedule.js)
});
const KSZH_INFLATION_DEFAULT = 0.06;

/**
 * Якоря дефлятора «текущих цен» КСЖ ЕНПФ: ln(индекса цен базы) по году строки 0 графика.
 * Подобраны эмпирически по ответам от 05.10.2026 (база ≈ 17–18.10.2026). Зависят ли они от даты расчёта —
 * не установлено (docs/04 §4.8, docs/09 §8.1 п. 6): нужна канарейка в другой день.
 */
const KSZH_CURRENT_ANCHOR = Object.freeze({
  calibratedOn: '2026-10-05',
  2020: -0.42571539052425412,
  2022: 0.24727885705346405,
  // 2023: калибровка в выборке по одному живому ответу (немедленный аннуитет со стартом в прошлом, строка 0 в 2023 г.):
  // сырой якорь 0,060934432 + поправка конца месяца ln(1,085)/360. Сайт ЕНПФ старт в прошлом не предлагает.
  2023: 0.06116104264806255, // test/live-fresh.mjs K10, 05.10.2026
  2024: 0.022684009798020769,
  2025: 0.079457748478291177,
  2026: 0.075993393838061728,
  2027: 0.075993393838061728,
});

/** Пенсионный возраст по ст. 207 СК. Женщины — по году даты выхода. [проверено] */
const RETIREMENT_AGE = Object.freeze({
  M: 63,
  F: Object.freeze({ 2027: 61, 2028: 61.5, 2029: 62, 2030: 62.5, 2031: 63 }),
});

/** Пенсионный возраст по году достижения: мужчины 63; женщины 61 (до 2027), 61,5 … 63 (с 2031). */
function retirementAge(sex, year) {
  if (String(sex).toUpperCase().startsWith('M') || String(sex) === '1' || String(sex) === 'мужской') return 63;
  if (year <= 2027) return 61;
  if (year >= 2031) return 63;
  return RETIREMENT_AGE.F[year];
}

/**
 * Минимальный возраст начала выплат по ПА у женщин в Excel SL — по дате рождения (лист «возраст»).
 * Ст. 226 п. 12 СК: 53 (с 2023), 53,5 (2028), 54 (2029), 54,5 (2030), 55 (2031). Мужчины — 55, ОППВ ≥ 60 мес. — 50.
 */
const PA_START_AGE = Object.freeze({
  M: 55,
  oppv: 50,
  womenByDob: Object.freeze([
    { from: '1976-07-01', age: 55 },
    { from: '1976-01-01', age: 54.5 },
    { from: '1975-07-01', age: 54 },
    { from: '1975-01-01', age: 53.5 },
    { from: null, age: 53 },
  ]),
});

/**
 * ПМД 2026 по новой методике (ПП №422), опубликованная таблица, ₸, по возрасту 20…62.
 * API прогноза ЕНПФ на 05.10.2026 всё ещё использует старую январскую таблицу (docs/09 §3.8).
 */
const PMD_2026_BY_AGE = Object.freeze({
  20: 6670000, 21: 6960000, 22: 7250000, 23: 7540000, 24: 7840000, 25: 8150000, 26: 8460000, 27: 8770000,
  28: 9090000, 29: 9420000, 30: 9750000, 31: 10090000, 32: 10430000, 33: 10780000, 34: 11130000, 35: 11490000,
  36: 11850000, 37: 12220000, 38: 12600000, 39: 12980000, 40: 13370000, 41: 13760000, 42: 14160000, 43: 14560000,
  44: 14980000, 45: 15400000, 46: 15820000, 47: 16250000, 48: 16690000, 49: 17140000, 50: 17590000, 51: 18050000,
  52: 18510000, 53: 18980000, 54: 19460000, 55: 19950000, 56: 20450000, 57: 20950000, 58: 21460000, 59: 21970000,
  60: 22500000, 61: 23030000, 62: 23570000,
});

/** Параметры 2026 года. */
const PARAMS_2026 = Object.freeze({
  year: 2026,
  asOf: '2026-10-05',

  // --- расчётные показатели (Закон о бюджете 2026–2028) ---
  PM: 50851,   // прожиточный минимум [проверено]
  MP: 69049,   // минимальная пенсия [проверено]
  MRP: 4325,   // МРП [вероятно]
  MZP: 85000,  // МЗП [вероятно]

  // --- государственные выплаты (для справки: в сравнении ЕНПФ/КСЖ это общая часть) ---
  basicPension: Object.freeze({ minShareOfPM: 0.7, stepPerYear: 0.02, freeYears: 10, maxShareOfPM: 1.18, maxShareOfPMFrom2027: 1.2 }),
  solidarity: Object.freeze({ rate: 0.6, incomeCapMRP: 55, fullServiceYears: Object.freeze({ M: 25, F: 20 }) }),

  // --- взносы ---
  contributions: Object.freeze({
    opv: 0.10, oppv: 0.05, opvBaseCapMZP: 50,
    opvr: Object.freeze({ 2026: 0.035, 2027: 0.045, 2028: 0.05 }), // ст. 251 СК; ОПВР только за родившихся с 01.01.1975
  }),

  // --- выплаты из ЕНПФ за счёт ОПВ/ОППВ (ПП 521, Методика расчёта размера выплат) [проверено] ---
  enpfPayout: Object.freeze({
    rate: 0.065,              // 6,5 % годовых от накоплений на дату назначения в первый год
    indexation: 0.05,         // +5 % к выплате прошлого года
    floorShareOfPM: 0.7,      // не меньше 70 % ПМ года назначения
    lumpSumIfLE12MP: true,    // S ≤ 12·МП → единовременно (ст. 220 п. 2 СК)
    lumpSumMultipleOfMP: 12,
    kHarmful: 1.45,           // K для ОППВ ≥ 60 мес. при достижении пенсионного возраста
    harmfulMinMonths: 60,
  }),

  // --- тариф калькулятора КСЖ ЕНПФ (допущения ЕНПФ до 2026 г.) [проверено, docs/09 §3.1] ---
  kszhEnpf: Object.freeze({
    i: 0.08, ind: 0.07, alpha: 0.015, gamma: 0.03, minShareOfPM: 0.7,
    scheduleRows: 612, surrenderLockMonths: 24,
  }),

  // --- тариф Standard Life (Excel «ПА калькулятор 21.09.2026.xlsx», лист calc) [проверено] ---
  sl: Object.freeze({
    tariffVersion: '21.09.2026',
    i: 0.09, ind: 0.08, alpha: 0.015, gamma: 0.03, minShareOfPM: 0.7,
    maxGuaranteeYears: 10,     // проверка Excel ввод!G14
    minContractAge: 40,        // ввод!M1 (с 40 — только при ОППВ)
    minContractAgeStandard: 45,
    dividendGross: 0.125,      // ввод!G34
    dividendNet: 0.11,         // ввод!H34
    surrenderLockMonths: 24,
    burialMRP: 35,             // погребение ≥ 35 МРП (типовой договор АРРФР №45 п. 10)
  }),

  // --- требования регулятора к тарифу ПА с 15.02.2026 (АРРФР №45 в ред. №3 от 27.01.2026) [проверено] ---
  regulatorPA: Object.freeze({ indMin: 0.08, iMin: 0.09, iMax: 0.12, alphaMax: 0.015, gammaMax: 0.03, minShareOfPM: 0.7 }),

  // --- допущения ЕНПФ ---
  kszhInflationPath: KSZH_INFLATION_PATH,           // «текущие цены» КСЖ ЕНПФ: 2026 — 10 %, 2027 — 6,5 %, 2028+ — 6 %
  kszhInflationDefault: KSZH_INFLATION_DEFAULT,
  kszhPmProjection: KSZH_PM_PROJECTION,             // 2026 — 50 851, 2027 — 54 156, 2028–2029 — 57 405
  forecastRealYields: Object.freeze({ Pessimist: 0.0, Realist: 0.01, Optimist: 0.02 }), // прогнозный калькулятор
  forecastImpliedInflation: 0.05,                   // прогноз ЕНПФ ≡ ПП 521 при π = 5 % (docs/09 §3.2)

  // --- возрасты ---
  retirementAge: RETIREMENT_AGE,
  paStartAge: PA_START_AGE,
  paContractMinAge: Object.freeze({ standard: 45, oppv: 40 }),

  // --- ПМД (новая методика): ПМД(x0) = ROUND(12·max(m·МП; n·МЗП)·15,952·(1,08/1,09)^(63 − x0); −4) ---
  pmd: Object.freeze({ i: 0.09, j: 0.08, mvmp: 0.75, mvmzp: 0.60, stepMP: 0.025, stepMZP: 0.02, cap: 2.0, a63: 15.952 }),
  pmdByAge: PMD_2026_BY_AGE,

  sources: SOURCES,
});

/** Минимальная выплата из ЕНПФ и минимальная выплата ПА 2026: 70 % ПМ = 35 595,7 (в API и Excel — 35 596). */
const MIN_PAYMENT_2026 = 0.7 * PARAMS_2026.PM;

/**
 * ПМ, по которому КСЖ ЕНПФ считает минимум для договора с годом строки 0 = year.
 * Возвращает null, если ЕНПФ минимум не применяет (≤ 2023: не исследовано / нет минимума).
 */
function kszhPmForYear(year) {
  if (year in KSZH_PM_PROJECTION) return KSZH_PM_PROJECTION[year];
  if (year > 2029) return 57405 * Math.pow(1 + KSZH_PM_GROWTH_AFTER_2029, year - 2029);
  return null;
}

/** Годовая инфляция по траектории КСЖ ЕНПФ. */
function kszhInflation(year) {
  if (/^\d{4}$/.test(String(year)) && year in KSZH_INFLATION_PATH) return KSZH_INFLATION_PATH[year];
  return year < 2020 ? 0 : KSZH_INFLATION_DEFAULT;
}

/**
 * Параметры на год. Для 2023–2026 — официальные ПМ/МП (и 2026 целиком); для будущих лет закон о бюджете
 * ещё не принят: возвращаются значения 2026 года, ПМ — прогноз КСЖ ЕНПФ (если есть), и флаг projected = true.
 * @param {number} year
 * @returns {object} { year, PM, MP, MRP, MZP, minPayment, lumpSumThreshold, projected, note, ...PARAMS_2026 }
 */
function paramsFor(year) {
  const y = Math.floor(Number(year));
  const base = { ...PARAMS_2026, year: y };
  let projected = false;
  let note = '';
  if (y === 2026) {
    // официальные значения
  } else if (y < 2026) {
    base.PM = PM_HISTORY[y] ?? null;
    base.MP = MP_HISTORY[y] ?? null;
    base.MRP = MRP_HISTORY[y] ?? null;
    base.MZP = MZP_HISTORY[y] ?? null;
    note = 'Исторические значения; поля тарифов и правил — редакции 2026 года.';
  } else {
    projected = true;
    const pm = kszhPmForYear(y);
    if (pm != null) base.PM = pm;
    note = 'Закон о бюджете на этот год неизвестен: МП/МРП/МЗП — значения 2026 года, ПМ — прогноз калькулятора КСЖ ЕНПФ.';
  }
  base.minPayment = base.PM == null ? null : 0.7 * base.PM;
  base.lumpSumThreshold = base.MP == null ? null : 12 * base.MP;
  base.projected = projected;
  base.note = note;
  return base;
}

__EL.define('params-2026.js', { SOURCES, PM_HISTORY, MP_HISTORY, MRP_HISTORY, MZP_HISTORY, KSZH_PM_PROJECTION, KSZH_PM_GROWTH_AFTER_2029, KSZH_INFLATION_PATH, KSZH_INFLATION_DEFAULT, KSZH_CURRENT_ANCHOR, RETIREMENT_AGE, retirementAge, PA_START_AGE, PMD_2026_BY_AGE, PARAMS_2026, MIN_PAYMENT_2026, kszhPmForYear, kszhInflation, paramsFor });
})(typeof window !== 'undefined' ? window : globalThis);
