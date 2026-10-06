/* ════ EnpfLib · actuarial.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/actuarial.js
 * (sha256 d5d6a9efc144f50b…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Актуарное ядро: таблицы смертности, дожитие и коэффициент пожизненного ежемесячного аннуитета.
 *
 * Один и тот же метод используют:
 *   - калькулятор КСЖ ЕНПФ (calculateKSZHDev): i = 8 %, ind = 7 % (docs/04, docs/09 §3.1, §6.4);
 *   - Excel ПА Standard Life «ПА калькулятор 21.09.2026.xlsx»: i = 9 %, ind = 8 % (docs/08, docs/09 §6.5);
 *   - аннуитет в прогнозе ЕНПФ (CalcType = 2): тариф КСЖ ЕНПФ при g = 0 (docs/09 §6.2).
 *
 *   ä = 12 · (1 + γ)/(1 − α) · ( Σ_y r^y · w_y − 11/24 ),   r = (1 + ind)/(1 + i),
 *   w_y = 1 в гарантийный период (y < g), иначе вероятность дожития  y_p_x.
 *
 * ä — «премия на 1 тенге первой ежемесячной выплаты»: P1 = премия / ä.
 *
 * Два варианта суммирования (математически одинаковы, различаются только порядком операций
 * с плавающей точкой и числом членов в редких крайних случаях):
 *   variant: 'enpf'  — как реплика КСЖ ЕНПФ (research/kszh/kszh_replica.js): r^y · w, до обнуления дожития;
 *   variant: 'excel' — как лист calc Excel и src/engine.js генератора КП: 66 годовых членов,
 *                      (1/(1+i)^k) · (1+ind)^k · kp_x.  Нужен, чтобы ПА SL совпадал с engine.js бит в бит.
 *
 * Модуль без зависимостей, работает в браузере и в Node 22.
 */
const MORTALITY = __EL.require('data/mortality.js').default;

/** Поправка Вулхауза для перехода от годового аннуитета пренумерандо к ежемесячному: (m − 1)/(2m), m = 12. */
const WOOLHOUSE_12 = 11 / 24;

/** Названия таблиц смертности (ключи lib/data/mortality.json). */
const TABLES = Object.freeze(['pension', 'oppv', 'inv3', 'inv2', 'inv1']);

/** Категория клиента в Excel ПА SL → таблица смертности. */
const SL_CATEGORY_TABLE = Object.freeze({
  'Стандартный': 'pension',
  'ОППВ 60 мес': 'oppv',
  'Инвалидность 3гр (30-59%) бессрочно': 'inv3',
  'Инвалидность 2гр (60-89%) бессрочно': 'inv2',
  'Инвалидность 1гр (90-100%) бессрочно': 'inv1',
});

/**
 * Пол к виду 'M' | 'F'. Принимает 'M'/'F', 'm'/'f', '1'/'0' (как в API ЕНПФ: 1 — мужчина),
 * 'мужской'/'женский' (как в Excel SL), 'male'/'female'.
 * @param {string|number} sex
 * @returns {'M'|'F'}
 */
function normSex(sex) {
  const s = String(sex).trim().toLowerCase();
  if (s === 'm' || s === '1' || s === 'мужской' || s === 'м' || s === 'male') return 'M';
  if (s === 'f' || s === '0' || s === 'женский' || s === 'ж' || s === 'female') return 'F';
  throw new Error('Неизвестный пол: ' + sex);
}

/**
 * Таблица смертности по выбору КСЖ ЕНПФ: инвалидность 1/2/3 гр. → inv1/inv2/inv3,
 * иначе ОППВ (paymentOppv = '1') → oppv, иначе 'pension'. Порядок проверки — как у ЕНПФ.
 * @param {{disability?: string|number, paymentOppv?: string|number}} p
 * @returns {'pension'|'oppv'|'inv1'|'inv2'|'inv3'}
 */
function kszhTable({ disability = '0', paymentOppv = '0' } = {}) {
  const dis = String(disability);
  if (dis === '1') return 'inv1';
  if (dis === '2') return 'inv2';
  if (dis === '3') return 'inv3';
  if (String(paymentOppv) === '1') return 'oppv';
  return 'pension';
}

/**
 * Массив q_x (индекс = возраст) для таблицы и пола.
 * @param {string} table  'pension' | 'oppv' | 'inv1' | 'inv2' | 'inv3'
 * @param {string} sex
 * @returns {number[]}
 */
function mortalityTable(table, sex) {
  const t = MORTALITY.tables[table];
  if (!t) throw new Error('Неизвестная таблица смертности: ' + table);
  return t[normSex(sex)];
}

/**
 * q_x — вероятность умереть в течение года в возрасте age (целое).
 * Ниже начала таблицы — 0 (в таблицах стоят нули), за концом таблицы — 1 (как IFERROR(…;1) в Excel).
 */
function qx({ sex, age, table = 'pension' }) {
  const q = mortalityTable(table, sex);
  if (age < 0) return 0;
  if (age >= q.length) return 1;
  return q[age];
}

/**
 * Вероятности дожития t_p_x для t = 0 … years (первый элемент — 1).
 * @param {{sex:string, age:number, table?:string, years?:number}} p  age — целый возраст
 * @returns {number[]}
 */
function survivalCurve({ sex, age, table = 'pension', years = 120 }) {
  const q = mortalityTable(table, sex);
  const out = [1];
  let p = 1;
  for (let t = 0; t < years; t++) {
    const a = age + t;
    const qa = a < 0 ? 0 : a >= q.length ? 1 : q[a];
    p *= 1 - qa;
    out.push(p);
  }
  return out;
}

/** t_p_x — вероятность дожить от целого возраста age до age + t (t — целое). */
function survivalProbability({ sex, age, t, table = 'pension' }) {
  if (t <= 0) return 1;
  return survivalCurve({ sex, age, table, years: t })[t];
}

/**
 * Ожидаемая остаточная продолжительность жизни.
 * curtate: e_x = Σ_{t≥1} t_p_x;  complete (по умолчанию): e_x + 0,5.
 */
function lifeExpectancy({ sex, age, table = 'pension', complete = true }) {
  const c = survivalCurve({ sex, age, table, years: 130 });
  let e = 0;
  for (let t = 1; t < c.length; t++) e += c[t];
  return complete ? e + 0.5 : e;
}

/**
 * Подробный расчёт коэффициента аннуитета.
 * @returns {{factor:number, factorNet:number, sum:number, terms:number, r:number}}
 *   factor    — ä брутто (с нагрузками α, γ);
 *   factorNet — без нагрузок: 12·(Σ − 11/24) (calc!H8 в Excel);
 *   sum       — Σ_y r^y·w_y (годовой аннуитет пренумерандо с индексацией);
 *   terms     — сколько годовых членов просуммировано.
 */
function annuityFactorDetails({
  sex, age, guaranteeYears = 0, i, ind, alpha = 0.015, gamma = 0.03,
  table = 'pension', woolhouse = true, variant = 'enpf',
}) {
  if (!Number.isFinite(i) || !Number.isFinite(ind)) throw new Error('annuityFactor: нужны i и ind');
  const x = Math.floor(age);
  const g = Math.max(0, Math.floor(guaranteeYears || 0));
  const q = mortalityTable(table, sex);
  const qAt = (a) => (a < 0 ? 0 : a >= q.length ? 1 : q[a]);
  const W = woolhouse ? WOOLHOUSE_12 : 0;
  let s = 0;
  let terms = 0;
  let factor;
  let factorNet;
  if (variant === 'excel') {
    // лист calc!A10:G75: 66 годовых членов от INT(x_0); G = B·C·F (или B·C в гарантийный период)
    let F = 1;
    for (let k = 0; k < 66; k++) {
      const A = x + k;
      const B = 1 / Math.pow(1 + i, k);
      const C = Math.pow(1 + ind, k);
      s += A >= x + g ? B * C * F : B * C;
      F *= 1 - qAt(A);
      terms++;
    }
    factor = ((s - W) * (1 + gamma) / (1 - alpha)) * 12; // calc!G8
    factorNet = (s - W) * 12;                             // calc!H8
  } else if (variant === 'enpf') {
    // реплика КСЖ ЕНПФ: суммируем, пока после гарантийного периода дожитие не обнулится
    const r = (1 + ind) / (1 + i);
    let p = 1;
    for (let y = 0; y <= 400; y++) {
      if (y >= g && p <= 0) break;
      s += Math.pow(r, y) * (y < g ? 1 : p);
      p *= 1 - qAt(x + y);
      terms++;
    }
    factor = (s - W) * 12 * (1 + gamma) / (1 - alpha);
    factorNet = (s - W) * 12;
  } else {
    throw new Error('annuityFactor: неизвестный variant ' + variant);
  }
  return { factor, factorNet, sum: s, terms, r: (1 + ind) / (1 + i) };
}

/**
 * Коэффициент ежемесячного пожизненного аннуитета ä (в «премии на 1 ₸ первой ежемесячной выплаты»):
 * P1 = премия / ä. Формула docs/09 §6.4–6.5.
 *
 * @param {object} p
 * @param {'M'|'F'|string} p.sex
 * @param {number} p.age             целый возраст на дату начала (дробная часть отбрасывается)
 * @param {number} [p.guaranteeYears=0] гарантийный период, лет
 * @param {number} p.i               техническая ставка доходности (0.08 ЕНПФ, 0.09 SL)
 * @param {number} p.ind             ежегодная индексация выплаты (0.07 ЕНПФ, 0.08 SL)
 * @param {number} [p.alpha=0.015]   нагрузка от премии
 * @param {number} [p.gamma=0.03]    нагрузка от каждой выплаты
 * @param {'pension'|'inv1'|'inv2'|'inv3'|'oppv'} [p.table='pension']
 * @param {boolean} [p.woolhouse=true] вычитать 11/24
 * @param {'enpf'|'excel'} [p.variant='enpf'] порядок суммирования (см. шапку файла)
 * @returns {number} ä
 */
function annuityFactor(p) {
  return annuityFactorDetails(p).factor;
}

/**
 * Коэффициент отложенного аннуитета: n|ä = ä(x0) · r^d, r = (1 + ind)/(1 + i)
 * (вероятность дожития в период отсрочки = 1 — Методика АРРФР №45, прил. 1 п. 1; так считают и SL, и ЕНПФ).
 * Выплата на дату договора = премия / n|ä; выплата при старте = она же · (1 + ind)^(число индексаций).
 * @param {object} p  параметры annuityFactor (+ deferralYears — целое число лет отсрочки)
 */
function deferredAnnuityFactor(p) {
  const d = Math.max(0, Math.floor(p.deferralYears || 0));
  const { factor } = annuityFactorDetails(p);
  return factor * Math.pow((1 + p.ind) / (1 + p.i), d);
}

/**
 * Первая ежемесячная выплата немедленного аннуитета по премии (без округления и минимума).
 * @param {object} p параметры annuityFactor + premium
 */
function monthlyPaymentFromPremium(p) {
  return p.premium / annuityFactor(p);
}

__EL.define('actuarial.js', { WOOLHOUSE_12, TABLES, SL_CATEGORY_TABLE, normSex, kszhTable, mortalityTable, qx, survivalCurve, survivalProbability, lifeExpectancy, annuityFactorDetails, annuityFactor, deferredAnnuityFactor, monthlyPaymentFromPremium });
})(typeof window !== 'undefined' ? window : globalThis);
