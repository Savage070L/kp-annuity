/* ════ EnpfLib · enpf-kszh.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/enpf-kszh.js
 * (sha256 41fc1dbc29c5ea38…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Калькулятор ЕНПФ «страховая премия и страховая выплата из страховой организации» (КСЖ ЕНПФ):
 * calcKSZH.php → POST https://mobile.enpf.kz/kszh/webresources/generic/calculateKSZHDev.
 *
 * Порт research/kszh/kszh_replica.js (и replica.py) в ES-модуль. Методика — docs/04_kszh_annuity_calc.md,
 * сверка — docs/09 §2.2: на всех сохранённых ответах совпадают все поля *OutParams посимвольно,
 * даты и возраст в графике — полностью, суммы в графике — с относительной ошибкой ~1e-12
 * (сервер считает в Oracle NUMBER на 38–40 знаков, здесь — double).
 *
 * Тариф ЕНПФ: i = 8 %, ind = 7 %, α = 1,5 %, γ = 3 % (допущения до 2026 г.).
 * «Текущие цены» — дефлятор по траектории ЕНПФ 10 % / 6,5 % / 6 % с эмпирическим якорем,
 * подобранным по ответам от 05.10.2026 (lib/params-2026.js: KSZH_CURRENT_ANCHOR).
 */
const { annuityFactor, kszhTable } = __EL.require('actuarial.js');
const { PARAMS_2026, KSZH_CURRENT_ANCHOR, kszhPmForYear, kszhInflation } = __EL.require('params-2026.js');
const { toYMD, lastDay, cmpYMD, completedAge } = __EL.require('dates.js');

const T = PARAMS_2026.kszhEnpf;
const N_ROWS = T.scheduleRows;          // 612 строк = 51 год
const LOCK_ROWS = T.surrenderLockMonths; // выкупная сумма = 0 первые 24 строки
const MIN_SHARE = T.minShareOfPM;

/** Ошибка, которую сервер ЕНПФ отдаёт статусом 400 (текстом) или битой строкой статуса «HTTP/1.1 -1». */
class KszhError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'KszhError';
    this.status = status;
  }
}

/** Тексты ошибок API (ru — lang "0", kz — lang "1"; казахский известен только для пола, остальные — русский). */
const KSZH_ERRORS = Object.freeze({
  sex: { ru: 'Не правильно указан пол', kz: 'Жыныс дұрыс көрсетілмеген' },
  totalPensionType: { ru: 'Выберите тип общей суммы пенсионных накоплений' },
  warrPeriod: { ru: 'Введите гарантийный период' },
  totalPension: { ru: 'Введите действительную общую сумму пенсионных накоплениий / размер выплаты' },
  badRequest: { ru: 'HTTP/1.1 -1' }, // битая дата или пустой insStartDay: сервер рвёт строку статуса
});

/**
 * Предупреждение для непроверенной ветки: отложенный договор (pensann = 1) с возрастом начала выплат меньше текущего.
 * То же предупреждение (своими словами, без зависимости от этого модуля) выдаёт validateKszhRequest (lib/enpf-api.js).
 */
const KSZH_UNVERIFIED_BRANCH_WARNING = 'Отложенный договор (pensann = 1) с возрастом начала выплат меньше текущего возраста: ' +
  'эту ветку реплика КСЖ не воспроизводит (живая проба K12 05.10.2026 — выплаты ЕНПФ примерно на 8,9 % выше реплики), ' +
  'а сайт ЕНПФ такой ввод не предлагает. Цифры реплики здесь не проверены — выберите немедленный договор или возраст не меньше текущего.';

function err(key, lang, status = 400) {
  const m = KSZH_ERRORS[key];
  return new KszhError(lang === '1' && m.kz ? m.kz : m.ru, status);
}

// ---------- даты (семантика Oracle ADD_MONTHS) ----------
const isMonthEnd = (d) => d.day === lastDay(d.year, d.month);
function addMonths(d, k) {
  const idx = d.month - 1 + k;
  const year = d.year + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12 + 1;
  const ld = lastDay(year, month);
  return { year, month, day: isMonthEnd(d) ? ld : Math.min(d.day, ld) };
}
function parseRuDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = { year: +m[3], month: +m[2], day: +m[1] };
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > lastDay(d.year, d.month)) return null;
  return d;
}
const pad = (n) => String(n).padStart(2, '0');
const fmtPad = (d) => `${pad(d.day)}.${pad(d.month)}.${d.year}`;
const fmtNoPad = (d) => `${d.day}.${d.month}.${d.year}`;
function minusOneDay(d) {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) - 86400000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}
/** День для позиции в 30/360: 31 и последний день месяца → 30. */
const day30 = (d) => (d.day >= 30 || isMonthEnd(d)) ? 30 : d.day;

/**
 * Возраст в графике, как у ЕНПФ: FLOOR(MONTHS_BETWEEN(дата, ДР)/12) в Oracle. MONTHS_BETWEEN считает целое число
 * месяцев, если дни совпадают ИЛИ обе даты — последние дни своих месяцев; поэтому для ДР 29.02 строка 28.02
 * невисокосного года — уже день рождения. Для остальных дат совпадает с числом полных лет
 * [проверено: test/live-fresh.mjs K13 (ДР 29.02.1972), сохранённые ответы 118/118 без изменений].
 */
function oracleAge(bd, d) {
  let months = (d.year - bd.year) * 12 + (d.month - bd.month);
  if (d.day < bd.day && !(isMonthEnd(d) && isMonthEnd(bd))) months -= 1;
  return Math.floor(months / 12);
}
const roundHalfUp = (x) => Math.floor(x + 0.5);

// ---------- дефлятор «текущих цен» ----------
const LN_ANCHOR_2028 = KSZH_CURRENT_ANCHOR[2026] + Math.log(1.1 / 1.065);
const LN_ANCHOR_2029_PLUS = KSZH_CURRENT_ANCHOR[2026] + Math.log(1.1 * 1.065 / (1.06 * 1.06));

/** ln индекса цен в позиции Pm (месяцев от 01.01.2026): каждый месяц года y даёт ln(1+π_y)/12. */
function logIndexPos(Pm) {
  let total = 0;
  if (Pm >= 0) {
    let y = 2026, rem = Pm;
    while (rem > 0) { const st = Math.min(rem, 12); total += st / 12 * Math.log(1 + kszhInflation(y)); rem -= st; y++; }
  } else {
    let y = 2025, rem = -Pm;
    while (rem > 0) { const st = Math.min(rem, 12); total -= st / 12 * Math.log(1 + kszhInflation(y)); rem -= st; y--; }
  }
  return total;
}
const logIndex = (d, d0) => logIndexPos(12 * (d.year - 2026) + (d.month - 1) + d0 / 30);
function anchor(y) {
  if (y >= 2029) return LN_ANCHOR_2029_PLUS;
  if (y === 2028) return LN_ANCHOR_2028;
  return (y in KSZH_CURRENT_ANCHOR) ? KSZH_CURRENT_ANCHOR[y] : KSZH_CURRENT_ANCHOR[2026];
}
function deflator(d, row0Year, d0, monthEndPast) {
  let a = anchor(row0Year);
  if (monthEndPast) a -= Math.log(1 + kszhInflation(row0Year)) / 12 / 30;
  return Math.exp(logIndex(d, d0) - a);
}

/**
 * Полный расчёт с отладочными величинами.
 * @param {object} body  тело запроса calculateKSZHDev (строки): {sex, birthday 'dd.mm.yyyy', insStartDay,
 *                       totalPension, totalPensionType, warrPeriod, pensann, paymentOppv, disability, KSZHParams:{lang}}
 * @param {{today?: Date|string}} [opts]  дата расчёта (по умолчанию — сегодня)
 * @returns {{response: object, debug: object}}
 * @throws {KszhError} с тем же текстом, что API (status 400), или status -1 для битой даты / пустого insStartDay
 */
function kszhCalcDetailed(body, { today } = {}) {
  const req = body || {};
  const td = toYMD(today);
  const lang = String(req.KSZHParams?.lang ?? '0');
  const sex = String(req.sex ?? '');
  if (sex !== '0' && sex !== '1') throw err('sex', lang);
  const ptype = String(req.totalPensionType ?? '');
  if (ptype !== '0' && ptype !== '1') throw err('totalPensionType', lang);
  const wp = String(req.warrPeriod ?? '');
  if (!/^\d+$/.test(wp)) throw err('warrPeriod', lang);
  const g = Number(wp);
  const tp = String(req.totalPension ?? '');
  if (!/^\d+$/.test(tp) || Number(tp) > 2147483647) throw err('totalPension', lang);
  const amount = Number(tp);
  const pensann = String(req.pensann ?? '0');
  const oppv = String(req.paymentOppv ?? '0');
  const dis = String(req.disability ?? '0');

  const bd = parseRuDate(req.birthday);
  const xs = String(req.insStartDay ?? '').trim();
  if (!bd || xs === '' || !Number.isFinite(Number(xs))) throw err('badRequest', lang, -1);

  const x = Number(xs);
  const xi = Math.floor(x);
  const half = x !== xi;
  const t0 = addMonths(bd, Math.trunc(x * 12));                 // дата начала выплат (firstPeriod)
  const firstPay = addMonths(bd, 12 * (xi + (half ? 1 : 0)));  // первая ненулевая строка графика
  const table = kszhTable({ disability: dis, paymentOppv: oppv });
  const a = annuityFactor({ sex: sex === '1' ? 'M' : 'F', age: xi, guaranteeYears: g, i: T.i, ind: T.ind,
    alpha: T.alpha, gamma: T.gamma, table, variant: 'enpf' });
  const r = (1 + T.ind) / (1 + T.i);
  const ageNow = completedAge(bd, td);
  let row0, d;
  if (pensann === '1') { row0 = addMonths(bd, 12 * (ageNow + 1)); d = xi - ageNow; } // договор — со следующего ДР
  else { row0 = t0; d = 0; }
  const deferred = pensann === '1' && d >= 1;
  const disc = deferred ? Math.pow(r, d) : 1;
  const pm = kszhPmForYear(row0.year);
  const minpay = pm === null ? null : MIN_SHARE * pm;

  let prem, premExact, pc;
  if (ptype === '0') {
    prem = amount; pc = prem / (a * disc); premExact = prem;
    if (minpay !== null && pc < minpay) { pc = minpay; premExact = pc * a * disc; prem = roundHalfUp(premExact); }
  } else {
    pc = amount; if (minpay !== null && pc < minpay) pc = minpay;
    premExact = pc * a * disc; prem = roundHalfUp(premExact);
  }
  let p1, payStart;
  if (deferred) { p1 = pc * Math.pow(1 + T.ind, completedAge(bd, firstPay) - (ageNow + 1)); payStart = firstPay; } // индексация d − 1 раз
  else if (pensann === '1') { p1 = pc; payStart = row0; }
  else { p1 = pc; payStart = firstPay; }

  const d0 = day30(row0);
  const me = isMonthEnd(row0) && row0.year <= td.year;
  const nom = [], cur = [];
  let cum = 0, defAtT0 = null;
  const baseS = (1 - T.alpha) * premExact; // в выкупной сумме — неокруглённая премия
  for (let k = 0; k < N_ROWS; k++) {
    const dk = addMonths(row0, k);
    let pay = 0;
    if (cmpYMD(dk, payStart) >= 0) {
      const m = (dk.year - payStart.year) * 12 + (dk.month - payStart.month);
      pay = p1 * Math.pow(1 + T.ind, Math.floor(m / 12));
    }
    cum += pay;
    let s = 0;
    if (k + 1 > LOCK_ROWS) { s = baseS - (1 + T.gamma) * cum; if (s < 0) s = 0; }
    const age = oracleAge(bd, dk);
    const df = deflator(dk, row0.year, d0, me);
    const date = fmtNoPad(dk);
    nom.push({ insPaymentSize: String(pay), id: String(k + 1), paymentDate: date, insPaymentSizeSumm: String(s), age: String(age) });
    cur.push({ insPaymentSize: String(pay / df), id: String(k + 1), paymentDate: date, insPaymentSizeSumm: String(s / df), age: String(age) });
    if (cmpYMD(dk, t0) === 0 && defAtT0 === null) defAtT0 = df;
  }
  const second = minusOneDay(addMonths(t0, 12 * Math.max(g, 1)));
  const dRow0 = deflator(row0, row0.year, d0, me);
  let outNom, outCur, fallback = false;
  if (pensann !== '1') { outNom = pc; outCur = pc / dRow0; }
  else if (defAtT0 !== null) { outNom = pc * Math.pow(1 + T.ind, d - 1); outCur = outNom / defAtT0; }
  else { fallback = true; outNom = pc * Math.pow(1 + T.i, d - 1); outCur = outNom / dRow0; } // ошибка сервера: 8 %, а не 7 %
  const out = (premium, payment) => ({
    insPremiumSumm: String(premium),
    insPaymentsStartAge: String(roundHalfUp(x)),
    secondPeriod: fmtPad(second),
    firstMonthPayment: String(roundHalfUp(payment)),
    insStartYear: String(row0.year),
    firstPeriod: fmtPad(t0),
  });
  const response = {
    currentOutParams: out(roundHalfUp(premExact / dRow0), outCur),
    currentDiagramParams: cur,
    nominalOutParams: out(prem, outNom),
    nominalDiagramParams: nom,
  };
  // pensann = 1 и возраст начала выплат меньше текущего (d < 0): ветка НЕ воспроизведена — у ЕНПФ выплата строки 0
  // ≈ 1,089 × премия/ä(x; ГП), здесь премия/ä(x; ГП) (живой K12, 05.10.2026; точная формула не найдена).
  // Сайт ЕНПФ такой ввод не предлагает; validateKszhRequest (lib/enpf-api.js) предупреждает.
  const unverifiedBranch = pensann === '1' && d < 0;
  const debug = {
    annuityFactorMonthly: a, deferralYears: d, tableAge: xi, table, minPayment: minpay,
    paymentAtContract: pc, firstPayment: p1, premiumExact: premExact, payStart: fmtPad(payStart),
    fallbackBranch: fallback, deflatorRow0: dRow0, today: `${td.year}-${pad(td.month)}-${pad(td.day)}`,
    unverifiedBranch,
    ...(unverifiedBranch ? { warning: KSZH_UNVERIFIED_BRANCH_WARNING } : {}),
  };
  return { response, debug };
}

/**
 * Расчёт КСЖ ЕНПФ: ответ ровно той же формы, что API
 * {currentOutParams, currentDiagramParams, nominalOutParams, nominalDiagramParams}, все значения — строки.
 * @param {object} body тело запроса calculateKSZHDev
 * @param {{today?: Date|string}} [opts]
 * @throws {KszhError}
 */
function kszhCalc(body, opts = {}) {
  return kszhCalcDetailed(body, opts).response;
}

/**
 * Коэффициент «первая выплата на 1 ₸ премии» немедленного аннуитета по тарифу КСЖ ЕНПФ без минимума
 * (так прогноз ЕНПФ считает CalcType = 2 при g = 0: docs/09 §6.2).
 */
function kszhPaymentPerTenge({ sex, age, guaranteeYears = 0, disability = '0', paymentOppv = '0' }) {
  return 1 / annuityFactor({ sex, age: Math.floor(age), guaranteeYears, i: T.i, ind: T.ind, alpha: T.alpha,
    gamma: T.gamma, table: kszhTable({ disability, paymentOppv }), variant: 'enpf' });
}

/**
 * Пересчитать якорь «текущих цен» по свежему живому ответу (для канарейки): ln(I_base).
 * Если результат отличается от KSZH_CURRENT_ANCHOR — ЕНПФ сдвинул базу «текущих цен».
 *
 * По умолчанию возвращается «сырой» якорь для года строки 0 этого ответа (с поправкой конца месяца, если она есть).
 * С normalize: true — приведённый к году 2026 (снимаются сдвиг года строки 0 и поправка конца месяца), то есть
 * при неизменной методике результат = KSZH_CURRENT_ANCHOR[2026] для любого ответа (проверено на 101 пробе).
 * @param {object} liveResponse ответ API
 * @param {{today?: Date|string, normalize?: boolean}} [opts] today нужен для поправки конца месяца
 * @returns {number|null}
 */
function kszhCalibrateAnchor(liveResponse, { today, normalize = false } = {}) {
  const nd = liveResponse?.nominalDiagramParams, cd = liveResponse?.currentDiagramParams;
  if (!Array.isArray(nd) || !Array.isArray(cd) || !nd.length) return null;
  const p = (s) => { const [dd, mm, yy] = s.split('.').map(Number); return { year: yy, month: mm, day: dd }; };
  const row0 = p(nd[0].paymentDate);
  const d0 = day30(row0);
  for (let k = 0; k < nd.length; k++) {
    const n = Number(nd[k].insPaymentSize), c = Number(cd[k].insPaymentSize);
    if (n !== 0 && c !== 0) {
      const raw = logIndex(p(nd[k].paymentDate), d0) - Math.log(n / c);
      if (!normalize) return raw;
      const td = toYMD(today);
      const me = isMonthEnd(row0) && row0.year <= td.year ? Math.log(1 + kszhInflation(row0.year)) / 12 / 30 : 0;
      return raw + me - (anchor(row0.year) - KSZH_CURRENT_ANCHOR[2026]);
    }
  }
  return null;
}

__EL.define('enpf-kszh.js', { KszhError, KSZH_ERRORS, KSZH_UNVERIFIED_BRANCH_WARNING, kszhCalcDetailed, kszhCalc, kszhPaymentPerTenge, kszhCalibrateAnchor });
})(typeof window !== 'undefined' ? window : globalThis);
