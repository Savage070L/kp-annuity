/* ════ EnpfLib · sl-annuity.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/sl-annuity.js
 * (sha256 110d3c11e2721435…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Пенсионный аннуитет АО «КСЖ «Standard Life» — расчёт по «ПА калькулятор 21.09.2026.xlsx».
 *
 * Порт src/engine.js генератора КП (kp-generator, ветка enpf-comparison), который сам является точным
 * переносом Excel (сверено с пересчётом книги в LibreOffice: docs/08, docs/09 §2.3). Числа совпадают
 * с engine.js бит в бит (test/sl.test.mjs: 7 профилей Excel + 500 случайных клиентов).
 *
 * Соответствие Excel:
 *   ввод!H6   x      = DATEDIF(дата рождения; дата расчёта; "m") / 12
 *   возраст!E21 x0   = max(минимальный возраст начала выплат; x)
 *   ввод!H23  x_0    = возраст на дату начала выплат (29 февраля — дни/365)
 *   calc!B5   d      = INT(x_0) − INT(x)  — срок отсрочки, лет
 *   calc!G8   äx     = ((Σ PV − 11/24)·(1+γ)/(1−α))·12, 66 годовых членов, i = 9 %, ind = 8 %
 *   calc!G6   n|äx   = äx · ((1+ind)/(1+i))^d
 *   calc!H2   мин. выплата = ROUNDUP(ПМ·0,7) = 35 596
 *   calc!H3   порог (мин. премия) = ROUND(мин. выплата · n|äx)
 *   calc!F2   выплата на дату договора = ROUND(премия)/n|äx
 *   calc!F3   выплата при старте = ROUND(ROUND(F2)·(1+ind)^d)
 *   График    ежегодно ROUND(прошлая·(1+ind)); выкупная = MAX(премия·(1−α) − Σвыплат·(1+γ); 0) с 24-го месяца
 */
const { annuityFactorDetails, SL_CATEGORY_TABLE, normSex } = __EL.require('actuarial.js');
const { PARAMS_2026 } = __EL.require('params-2026.js');
const { toYMD, isoYMD, lastDay, monthsBetween, daysBetween } = __EL.require('dates.js');

/** Тариф Excel 21.09.2026 (как TARIFF в engine.js). */
const SL_TARIFF = Object.freeze({
  version: PARAMS_2026.sl.tariffVersion,
  i: PARAMS_2026.sl.i,
  ind: PARAMS_2026.sl.ind,
  alfa: PARAMS_2026.sl.alpha,
  gamma: PARAMS_2026.sl.gamma,
  pm: PARAMS_2026.PM,
  minPayShare: PARAMS_2026.sl.minShareOfPM,
  maxGuarantee: PARAMS_2026.sl.maxGuaranteeYears,
  minAge: PARAMS_2026.sl.minContractAge,
  minAgeStandard: PARAMS_2026.sl.minContractAgeStandard,
  dividendGross: PARAMS_2026.sl.dividendGross,
  dividendNet: PARAMS_2026.sl.dividendNet,
  horizon: 100,
});

/** Категории Excel (ввод!G10). */
const SL_CATEGORIES = Object.freeze(Object.keys(SL_CATEGORY_TABLE));

// ---------- округления Excel (как engine.js: сначала 15 значащих цифр) ----------
const snap = (v) => (v === 0 || !isFinite(v) ? v : +v.toPrecision(15));
/** Excel ROUND(x; 0): половина — от нуля. */
function xround(v) { v = snap(v); return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5); }
/** Excel ROUNDUP(x; 0). */
function xroundup(v) { v = snap(v); return v < 0 ? -Math.ceil(-v) : Math.ceil(v); }

/** Дата через k месяцев на заданном числе (в коротком месяце — последний день): столбец дат «Графика». */
function onDay(d, k, day) {
  const idx = d.month - 1 + k;
  const year = d.year + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(day, lastDay(year, month)) };
}
/** EDATE. */
const edate = (d, k) => onDay(d, k, d.day);
const sameYMD = (a, b) => a.year === b.year && a.month === b.month && a.day === b.day;

/** Возраст начала выплат для женщин по дате рождения (лист «возраст» E2:E20). */
function womanStartAge(dob) {
  const v = dob.year * 10000 + dob.month * 100 + dob.day;
  if (v >= 19760701) return 55;
  if (v >= 19760101) return 54.5;
  if (v >= 19750701) return 54;
  if (v >= 19750101) return 53.5;
  return 53;
}

/** Минимальный возраст начала выплат ПА (возраст!E21 без max с текущим возрастом). */
function slMinStartAge({ sex, birthDate, category = 'Стандартный', oppv = false }) {
  const dob = toYMD(birthDate);
  if (category === 'ОППВ 60 мес' || oppv === true || oppv === 'Да') return 50;
  return normSex(sex) === 'M' ? 55 : womanStartAge(dob);
}

/**
 * Расчёт ПА Standard Life.
 *
 * @param {object} p
 * @param {'M'|'F'|'мужской'|'женский'} p.sex
 * @param {Date|string} p.birthDate          'YYYY-MM-DD'
 * @param {Date|string} [p.calcDate]         дата расчёта = дата договора; по умолчанию today
 * @param {number} [p.premium]               сумма к переводу (накопления ЕНПФ); то же, что savings
 * @param {number} [p.savings]               накопления ЕНПФ (ввод!G16)
 * @param {number} [p.redemption=0]          выкупная сумма из другой КСЖ (ввод!G17)
 * @param {number} [p.contribution=0]        собственный взнос клиента (ввод!G18)
 * @param {number} [p.guaranteeYears=0]      гарантийный период, лет
 * @param {string} [p.category='Стандартный'] категория Excel
 * @param {boolean|'Да'|'Нет'} [p.oppv=false] ОППВ более 60 мес. (ввод!G12)
 * @param {number} [p.dividendRate]          ставка возможного дивиденда (по умолчанию 11 % нетто, как в генераторе) —
 *                                           только справочное поле dividend: на премию и доплату не влияет
 * @param {number} [p.startAge]              РАСШИРЕНИЕ (нет в Excel): желаемый возраст начала ≥ минимального
 * @param {boolean} [p.raiseToThreshold=true] если средств меньше порога — считать по порогу с доплатой «порог − свои средства»
 *                                           (как генератор КП; дивиденд доплату не уменьшает — правило продукта от 06.10.2026);
 *                                           false — считать от введённой суммы (выплата будет ниже минимума, ok = false)
 * @param {Date|string} [p.today]            используется, если calcDate не задан
 * @param {object} [p.tariff]                переопределить тариф (по умолчанию SL_TARIFF)
 * @returns {object} см. поля ниже; schedule — по годам выплат [{n, year, date, age, monthly, annual, cumulative, buyout, guaranteed}]
 */
function slAnnuity(p) {
  const T = p.tariff || SL_TARIFF;
  const calcDate = toYMD(p.calcDate ?? p.today ?? new Date());
  const dob = toYMD(p.birthDate);
  const sex = normSex(p.sex);
  const category = p.category || 'Стандартный';
  const table = SL_CATEGORY_TABLE[category];
  if (!table) throw new Error('Неизвестная категория: ' + category);
  const oppvYes = p.oppv === true || p.oppv === 'Да';

  const gp = Math.max(0, Math.floor(+(p.guaranteeYears ?? p.guarantee) || 0));
  const months = monthsBetween(dob, calcDate);
  const x = months / 12;                                        // ввод!H6
  let base;
  if (category === 'ОППВ 60 мес' || oppvYes) base = 50;
  else if (sex === 'M') base = 55;
  else base = womanStartAge(dob);
  let x0 = Math.max(base, x);                                   // возраст!E21
  if (p.startAge != null && isFinite(+p.startAge)) x0 = Math.max(+p.startAge, x0); // расширение (как replica.py)
  // ввод!G23, H23: дата начала выплат и возраст на неё (29.02 — дни/365, как в Excel)
  const immediate = x === x0;
  const begin = immediate ? calcDate : edate(dob, Math.trunc(x0 * 12));
  const xStart = dob.month === 2 && dob.day === 29 ? daysBetween(dob, begin) / 365 : monthsBetween(dob, begin) / 12;
  const xInt = Math.floor(x), x0Int = Math.floor(xStart);
  const d = x0Int - xInt;                                       // calc!B5

  const det = annuityFactorDetails({ sex, age: x0Int, guaranteeYears: gp, i: T.i, ind: T.ind, alpha: T.alfa,
    gamma: T.gamma, table, variant: 'excel' });
  const ax = det.factor;                                        // calc!G8
  const axNet = det.factorNet;                                  // calc!H8
  const vd = Math.pow((1 + T.ind) / (1 + T.i), d);              // calc!G7
  const nax = ax * vd;                                          // calc!G6

  const minPay = xroundup(T.pm * T.minPayShare);                // calc!H2
  const threshold = xround(minPay * nax);                       // calc!H3
  const minPayAtStart = xround(minPay * Math.pow(1 + T.ind, d)); // calc!H4

  const savings = Math.max(0, xround(+(p.savings ?? p.premium) || 0));
  const redemption = Math.max(0, xround(+p.redemption || 0));
  const contribution = Math.max(0, xround(+p.contribution || 0));
  const dividendRate = p.dividendRate == null ? T.dividendNet : +p.dividendRate;
  const raise = p.raiseToThreshold !== false;

  const own = savings + redemption;
  const entered = own + contribution;
  let premium, topup, mode;
  if (entered >= threshold || !raise) {
    mode = entered >= threshold ? 'free' : 'below';
    premium = entered;
    topup = contribution;
  } else {
    // своих средств меньше порога: договор по порогу, доплата = порог − свои средства (как генератор КП).
    // Правило продукта от 06.10.2026: возможный дивиденд доплату НЕ уменьшает — премия вносится целиком
    // (как в Excel: BP = накопления + выкупная + взнос ≥ минимальной премии).
    mode = 'threshold';
    premium = threshold;
    topup = Math.max(0, premium - own);
  }
  // возможный дивиденд (Excel График!D3 — от BP): негарантированный бонус по решению компании, только справочно
  const dividend = xround(premium * dividendRate);

  const pay0 = xround(premium) / nax;                          // calc!F2
  const first = xround(xround(pay0) * Math.pow(1 + T.ind, d)); // calc!F3

  // проверки ввод!G2, M1..M7
  let status = 'ok';
  const warnings = [];
  const combo = [x < T.minAgeStandard, category !== 'Стандартный', category !== 'ОППВ 60 мес', oppvYes]
    .map((b) => (b ? 1 : 0)).join('+');
  if (x < T.minAge) status = 'не достигнут возраст';
  else if (combo === '1+1+1+0' || combo === '1+0+1+0' || combo === '1+0+1+1') status = 'не достигнут возраст';
  const fundsStatus = entered >= threshold ? 'ok' : 'недостаточно средств';
  if (gp > T.maxGuarantee) warnings.push('Гарантированный период по калькулятору — не больше ' + T.maxGuarantee + ' лет');
  if (mode === 'below') warnings.push('Средств меньше порога: выплата ниже минимальной (70 % ПМ), договор по такой сумме не заключается');

  // График по годам выплат (как engine.schedule + engine.surrender)
  const day = immediate ? calcDate.day : dob.day;
  const schedule = [];
  let m = first, cum = 0;
  for (let age = x0Int, n = 0; age <= T.horizon; age++, n++) {
    if (n > 0) m = xround(m * (1 + T.ind));
    cum += 12 * m;
    const date = onDay(begin, 12 * n, day);
    const end = onDay(begin, 12 * n + 11, day);
    const buyout = monthsBetween(calcDate, end) >= 24
      ? Math.max(0, xround(premium * (1 - T.alfa) - cum * (1 + T.gamma))) : null;
    schedule.push({ n: n + 1, year: date.year, date: isoYMD(date), age, monthly: m, annual: 12 * m, cumulative: cum,
      buyout, guaranteed: n < gp });
  }
  // первая строка «Графика», где прошло 24 месяца, — с неё показывается выкупная сумма
  const a6 = monthsBetween(calcDate, begin) <= 1 ? begin : calcDate;
  let surrenderFrom = null;
  for (let k = 0; k < 40 && !surrenderFrom; k++) {
    const dt = k === 0 ? a6 : onDay(a6, k, day);
    if (monthsBetween(calcDate, dt) >= 24) surrenderFrom = dt;
  }

  return {
    ok: status === 'ok', status, fundsStatus, excelStatus: status !== 'ok' ? status : fundsStatus,
    warnings, enteredPremium: entered,
    tariff: T, table, category, sex,
    age: x, ageInt: xInt, months,
    startAge: x0, startAgeInt: x0Int, startAgeExact: xStart, startDate: isoYMD(begin), deferral: d, immediate,
    guaranteeYears: gp,
    ax, axNet, vd, nax,
    minPayment: minPay, minPaymentAtStart: minPayAtStart, threshold,
    savings, redemption, contribution,
    premium, dividendRate, dividend, topup, mode,
    paymentAtContract: xround(pay0), paymentAtContractExact: pay0, firstPayment: first,
    schedule,
    surrenderBase: xround(premium * (1 - T.alfa)), surrenderFrom: surrenderFrom ? isoYMD(surrenderFrom) : null,
    calcDate: isoYMD(calcDate), birthDate: isoYMD(dob),
  };
}

/**
 * Помесячный график выплат SL (даты по числу дня рождения, у немедленного аннуитета — по дате расчёта),
 * до возраста toAge включительно. Выплата в каждом году — monthly соответствующей строки schedule.
 * @param {object} res результат slAnnuity
 * @param {{toAge?: number}} [opts]
 * @returns {{date:string, age:number, payment:number, cumulative:number}[]}
 */
function slMonthlyPayments(res, { toAge = 100 } = {}) {
  const begin = toYMD(res.startDate);
  const dob = toYMD(res.birthDate);
  const day = res.immediate ? toYMD(res.calcDate).day : dob.day;
  const out = [];
  let cum = 0;
  for (const row of res.schedule) {
    if (row.age > toAge) break;
    for (let k = 0; k < 12; k++) {
      const dt = onDay(begin, 12 * (row.n - 1) + k, day);
      cum += row.monthly;
      out.push({ date: isoYMD(dt), age: row.age, payment: row.monthly, cumulative: cum });
    }
  }
  return out;
}

__EL.define('sl-annuity.js', { SL_TARIFF, SL_CATEGORIES, xround, xroundup, womanStartAge, slMinStartAge, slAnnuity, slMonthlyPayments });
})(typeof window !== 'undefined' ? window : globalThis);
