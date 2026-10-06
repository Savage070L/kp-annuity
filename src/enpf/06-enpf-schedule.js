/* ════ EnpfLib · enpf-schedule.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/enpf-schedule.js
 * (sha256 309a36b7ea008374…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Выплаты из ЕНПФ по правилу ПП 521 в НОМИНАЛЬНЫХ тенге (для блока КП «оставить в ЕНПФ»).
 *
 * Правило (ПП 521, Методика расчёта размера выплат; docs/06 §7.1, docs/09 §3.2, §6.3):
 *   - если S ≤ 12·МП года назначения — вся сумма единовременно;
 *   - год 1: P₁ = max(S·6,5 %·K/12; 0,7·ПМ года назначения), K = 1,45 при ОППВ ≥ 60 мес.;
 *   - каждый следующий год P_{t+1} = 1,05·P_t (номинальная индексация 5 %), пересчёта от остатка нет;
 *   - выплаты ежемесячно в начале месяца до исчерпания; остаток растёт с номинальной доходностью
 *     (1 + π_год)(1 + r) − 1, где π — инфляция, r — реальная доходность ЕНПФ.
 * Прогноз ЕНПФ (постоянная реальная выплата N лет) ≡ это правило при π = 5 % (docs/09 §3.2):
 * при π = 5 %, r = 1 % и 10 млн сегодня у мужчины 10.05.1979 — 63 259 ₸ в ценах 05.10.2026 каждый год с 63 до 79 лет.
 *
 * Не умножать реальные выплаты ЕНПФ на (1 + π)^t — это ошибка методики прототипа КП (docs/09 §3.19).
 *
 * Соглашения:
 *   - индекс цен между датами — по календарным годам: Π (1 + π_y)^(доля года y). Доля года (dayCount):
 *       '30/360' (по умолчанию) — 30E/360: ровно 1/12 на месяц и 1 на год между одинаковыми числами, поэтому
 *                 при постоянной π реальная выплата ЕНПФ (π = 5 %) и SL постоянны до тенге;
 *       'act/365.25' — дни/365,25, как в research/crosscheck/kp_compare_example.py и kp_inflation_paths.py
 *                 (воспроизводит их числа; даёт шум ±2 ₸ между годами);
 *   - накопление до начала выплат (enpfSavingsAt): S·индекс цен·(1 + r)^(дни/365,25) — реальная доходность
 *     по фактическому времени, как в прогнозе ЕНПФ (поэтому реальная выплата не зависит от dayCount);
 *   - номинальная доходность месяца: ((1 + π_y)(1 + r))^(1/12) − 1, y — календарный год начала года выплат;
 *   - «реальные» суммы — в ценах даты priceBase (по умолчанию — дата расчёта today);
 *     годовые строки дефлируются индексом на начало года выплат (как в исследовании),
 *     месячные — индексом на дату каждой выплаты;
 *   - ПМ и МП будущего года назначения по умолчанию = значения 2026 × индекс цен с 01.01.2026 по 01.01 года.
 */
const { PARAMS_2026 } = __EL.require('params-2026.js');
const { toYMD, isoYMD, lastDay, completedAge, daysBetween, cmpYMD } = __EL.require('dates.js');

/** Траектория инфляции, заложенная ЕНПФ в калькулятор КСЖ: 2026 — 10 %, 2027 — 6,5 %, далее 6 %. */
const INFLATION_ENPF_KSZH = Object.freeze({ 2026: 0.10, 2027: 0.065, default: 0.06 });

/**
 * Годовая инфляция для календарного года по траектории.
 * @param {number|object|function} path число (постоянная), {год: ставка, default?} или функция year → ставка.
 *   Для объекта без нужного года: default, иначе ставка ближайшего предыдущего года, иначе самого раннего.
 */
function inflationRate(path, year) {
  if (typeof path === 'number') return path;
  if (typeof path === 'function') return path(year);
  if (!path || typeof path !== 'object') throw new Error('Не задана траектория инфляции');
  if (year in path) return Number(path[year]);
  if ('default' in path) return Number(path.default);
  const years = Object.keys(path).filter((k) => /^\d{4}$/.test(k)).map(Number).sort((a, b) => a - b);
  if (!years.length) throw new Error('Пустая траектория инфляции');
  let best = years[0];
  for (const y of years) if (y <= year) best = y;
  return Number(path[best]);
}

/**
 * Доля года между датами a ≤ b.
 * @param {'30/360'|'act/365.25'} [dayCount='30/360']  30E/360: (360·Δлет + 30·Δмес + Δдней)/360, число дня ≤ 30
 */
function yearFrac(a, b, dayCount = '30/360') {
  const x = toYMD(a), y = toYMD(b);
  if (dayCount === 'act/365.25') return daysBetween(x, y) / 365.25;
  if (dayCount !== '30/360') throw new Error('Неизвестный dayCount: ' + dayCount);
  return (360 * (y.year - x.year) + 30 * (y.month - x.month) + (Math.min(y.day, 30) - Math.min(x.day, 30))) / 360;
}

/**
 * Индекс цен с даты from до даты to: Π по календарным годам (1 + π_y)^(доля года y). to < from → обратная величина.
 * @param {Date|string|object} from
 * @param {Date|string|object} to
 * @param {number|object|function} inflationPath
 * @param {{dayCount?: '30/360'|'act/365.25'}} [opts]
 */
function priceIndex(from, to, inflationPath, { dayCount = '30/360' } = {}) {
  const a = toYMD(from), b = toYMD(to);
  const c = cmpYMD(a, b);
  if (c === 0) return 1;
  if (c > 0) return 1 / priceIndex(b, a, inflationPath, { dayCount });
  let x = 1;
  let cur = a;
  while (cmpYMD(cur, b) < 0) {
    const ny = { year: cur.year + 1, month: 1, day: 1 };
    const nxt = cmpYMD(ny, b) < 0 ? ny : b;
    x *= Math.pow(1 + inflationRate(inflationPath, cur.year), yearFrac(cur, nxt, dayCount));
    cur = nxt;
  }
  return x;
}

/**
 * Пересчёт номинальной суммы, выплаченной в дату fromDate, в цены другой даты.
 * @param {number} amount
 * @param {Date|string} fromDate     дата выплаты
 * @param {number|Date|string} toYear год (цены на 01.01 этого года) или конкретная дата базы цен
 * @param {number|object|function} inflationPath
 * @param {{dayCount?: '30/360'|'act/365.25'}} [opts]
 * @returns {number} amount / индекс(база → fromDate)
 */
function deflate(amount, fromDate, toYear, inflationPath, opts = {}) {
  const base = typeof toYear === 'number' ? { year: toYear, month: 1, day: 1 } : toYMD(toYear);
  return amount / priceIndex(base, fromDate, inflationPath, opts);
}

/**
 * Накопления ЕНПФ на будущую дату без новых взносов: S·индекс цен·(1 + r)^t
 * (номинальная доходность (1 + π)(1 + r) − 1; как research/crosscheck/kp_*.py).
 * Реальная доходность начисляется по фактическому времени t = дни/365,25 (как в прогнозе ЕНПФ:
 * 10 млн → 63 259 при r = 1 %), индекс цен — по dayCount. Реальная сумма от выбора dayCount не зависит.
 * @param {{savings:number, to:Date|string, inflationPath:any, realYield?:number, today?:Date|string, dayCount?:string}} p
 */
function enpfSavingsAt({ savings, to, inflationPath, realYield = 0, today, dayCount = '30/360' }) {
  const from = toYMD(today);
  const t = daysBetween(from, toYMD(to)) / 365.25;
  return savings * priceIndex(from, to, inflationPath, { dayCount }) * Math.pow(1 + realYield, t);
}

/** EDATE с фиксированным числом дня. */
function addMonthsDay(d, k, day) {
  const idx = d.month - 1 + k;
  const year = d.year + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(day, lastDay(year, month)) };
}

/**
 * График выплат ЕНПФ по ПП 521 в номинале с реальными суммами.
 *
 * @param {object} p
 * @param {number} p.savingsAtStart        накопления на дату начала выплат, номинал ₸
 * @param {Date|string} p.startDate        дата начала выплат (обычно дата достижения пенсионного возраста)
 * @param {number|object|function} p.inflationPath  инфляция: число или {год: ставка, default}
 * @param {number} [p.realYield=0]         реальная доходность ЕНПФ r (0 — история 2021–2025 ≈ −0,2 %, 0,01 — модель ЕНПФ)
 * @param {boolean} [p.harmful=false]      ОППВ ≥ 60 мес.: K = 1,45
 * @param {number} [p.K]                   явный коэффициент к 6,5 % (перекрывает harmful)
 * @param {boolean} [p.monthly=true]       вернуть помесячные строки
 * @param {Date|string} [p.birthDate]      для поля age
 * @param {Date|string} [p.today]          дата расчёта; по умолчанию сегодня
 * @param {Date|string} [p.priceBase]      база «реальных» сумм; по умолчанию today
 * @param {number|function} [p.pmForYear]  ПМ года назначения (число или year → ПМ); по умолчанию ПМ 2026 × индекс цен
 * @param {number|function} [p.mpForYear]  МП года назначения; по умолчанию МП 2026 × индекс цен
 * @param {number} [p.maxYears=100]        предел горизонта (если остаток не исчерпывается)
 * @param {'30/360'|'act/365.25'} [p.dayCount='30/360'] доля года для индекса цен (см. шапку)
 * @returns {{lumpSum:boolean, savingsAtStart:number, startDate:string, K:number, floor:number, lumpSumThreshold:number,
 *   firstPayment:number, firstPaymentReal2026:number, floorApplied:boolean, exhausted:boolean, yearsPaid:number,
 *   lastPaymentDate:string|null, lastAge:number|null, totalPaid:number, totalPaidReal2026:number,
 *   months:Array, years:Array}}
 *   months: {date, age?, payment, balanceAfter, cumulative, paymentReal2026, cumulativeReal2026}
 *   years:  {n, date, calendarYear, age?, payment (уровень месячной выплаты), paid (за год), months (число выплат),
 *            balanceAfter, cumulative, paymentReal2026, paidReal2026, cumulativeReal2026}
 */
function enpfPayoutSchedule({
  savingsAtStart, startDate, inflationPath, realYield = 0, harmful = false, K: kOverride, monthly = true,
  birthDate, today, priceBase, pmForYear, mpForYear, maxYears = 100, dayCount = '30/360',
}) {
  const R = PARAMS_2026.enpfPayout;
  const start = toYMD(startDate);
  const base = toYMD(priceBase ?? today);
  const bd = birthDate != null ? toYMD(birthDate) : null;
  const S = Number(savingsAtStart) || 0;
  const jan2026 = { year: 2026, month: 1, day: 1 };
  const janStart = { year: start.year, month: 1, day: 1 };
  const growth = priceIndex(jan2026, janStart, inflationPath, { dayCount });
  const pm = typeof pmForYear === 'function' ? pmForYear(start.year) : (pmForYear ?? PARAMS_2026.PM * growth);
  const mp = typeof mpForYear === 'function' ? mpForYear(start.year) : (mpForYear ?? PARAMS_2026.MP * growth);
  const K = kOverride ?? (harmful ? R.kHarmful : 1);
  const floor = R.floorShareOfPM * pm;
  const lumpSumThreshold = R.lumpSumMultipleOfMP * mp;
  const idx = (d) => priceIndex(base, d, inflationPath, { dayCount });
  const ageAt = (d) => (bd ? completedAge(bd, d) : undefined);

  const res = {
    lumpSum: false, savingsAtStart: S, startDate: isoYMD(start), K, floor, lumpSumThreshold,
    firstPayment: 0, firstPaymentReal2026: 0, floorApplied: false, exhausted: true, yearsPaid: 0,
    lastPaymentDate: null, lastAge: null, totalPaid: 0, totalPaidReal2026: 0, months: [], years: [],
    priceBase: isoYMD(base),
  };
  if (R.lumpSumIfLE12MP && S <= lumpSumThreshold) {
    const real = S / idx(start);
    const row = { date: isoYMD(start), age: ageAt(start), payment: S, balanceAfter: 0, cumulative: S,
      paymentReal2026: real, cumulativeReal2026: real };
    Object.assign(res, { lumpSum: true, firstPayment: S, firstPaymentReal2026: real, yearsPaid: S > 0 ? 1 : 0,
      lastPaymentDate: isoYMD(start), lastAge: ageAt(start) ?? null, totalPaid: S, totalPaidReal2026: real });
    if (monthly) res.months.push(row);
    res.years.push({ n: 1, date: row.date, calendarYear: start.year, age: row.age, payment: S, paid: S, months: 1,
      balanceAfter: 0, cumulative: S, paymentReal2026: real, paidReal2026: real, cumulativeReal2026: real });
    return res;
  }

  const byRate = S * R.rate * K / 12;
  let P = Math.max(byRate, floor);
  res.firstPayment = P;
  res.floorApplied = byRate < floor;
  res.firstPaymentReal2026 = P / idx(start);
  let B = S, cum = 0, cumReal = 0, cumYearReal = 0;
  for (let n = 0; n < maxYears && B > 1e-6; n++) {
    const yStart = addMonthsDay(start, 12 * n, start.day);
    const calYear = yStart.year;
    const jm = Math.pow((1 + inflationRate(inflationPath, calYear)) * (1 + realYield), 1 / 12) - 1;
    const yIdx = idx(yStart);
    let paid = 0, count = 0;
    for (let m = 0; m < 12 && B > 1e-6; m++) {
      const d = addMonthsDay(start, 12 * n + m, start.day);
      const p = Math.min(P, B);
      B = (B - p) * (1 + jm);
      paid += p; count++;
      cum += p;
      const pr = p / idx(d);
      cumReal += pr;
      if (monthly) res.months.push({ date: isoYMD(d), age: ageAt(d), payment: p, balanceAfter: B, cumulative: cum,
        paymentReal2026: pr, cumulativeReal2026: cumReal });
      res.lastPaymentDate = isoYMD(d);
      res.lastAge = ageAt(d) ?? null;
    }
    cumYearReal += paid / yIdx;
    res.years.push({ n: n + 1, date: isoYMD(yStart), calendarYear: calYear, age: ageAt(yStart), payment: P, paid, months: count,
      balanceAfter: B, cumulative: cum, paymentReal2026: P / yIdx, paidReal2026: paid / yIdx, cumulativeReal2026: cumYearReal });
    P *= 1 + R.indexation;
  }
  res.exhausted = B <= 1e-6;
  res.yearsPaid = res.years.length;
  res.totalPaid = cum;
  res.totalPaidReal2026 = cumYearReal;
  return res;
}

/**
 * Сквозной расчёт «оставить в ЕНПФ» от сегодняшних накоплений: рост без взносов до даты начала выплат,
 * затем enpfPayoutSchedule. Удобно для КП и для проверки docs/09 §7.
 * @param {object} p  {savings (сегодня), startDate, inflationPath, realYield, today, ...остальное как в enpfPayoutSchedule}
 */
function enpfPayoutFromToday(p) {
  const savingsAtStart = enpfSavingsAt({ savings: p.savings, to: p.startDate, inflationPath: p.inflationPath,
    realYield: p.realYield ?? 0, today: p.today, dayCount: p.dayCount ?? '30/360' });
  return enpfPayoutSchedule({ ...p, savingsAtStart });
}

__EL.define('enpf-schedule.js', { INFLATION_ENPF_KSZH, inflationRate, yearFrac, priceIndex, deflate, enpfSavingsAt, enpfPayoutSchedule, enpfPayoutFromToday });
})(typeof window !== 'undefined' ? window : globalThis);
