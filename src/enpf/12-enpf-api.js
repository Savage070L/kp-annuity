/* ════ EnpfLib · enpf-api.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/enpf-api.js
 * (sha256 081a8d36e572416b…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Живые клиенты API ЕНПФ: прогнозный калькулятор и калькулятор КСЖ (пенсионный аннуитет).
 * ES-модуль без зависимостей; работает в браузере и в Node 22 (глобальный fetch).
 *
 *   POST https://mobile.enpf.kz/JasperReports/api/EnpfCalculator2New         — прогноз (docs/01, 02, 03)
 *   POST https://mobile.enpf.kz/kszh/webresources/generic/calculateKSZHDev   — КСЖ (docs/04)
 *
 * CORS. Оба эндпоинта отвечают заголовком Access-Control-Allow-Origin: * и не требуют авторизации
 * и cookies, поэтому страница КП (генератор) может вызывать их прямо из браузера клиента
 * (preflight на Content-Type: application/json сервер проходит — так работает и сайт www.enpf.kz).
 * Проверено 05.10.2026: из Node (заголовок Access-Control-Allow-Origin: * в ответах) и со страницы
 * http://localhost в Chromium 152 (test/browser-check.html?live=1 — оба API ответили).
 * В браузере заголовки Date и Access-Control-Allow-Origin скриптам не видны (их нет в CORS-safelisted
 * и ЕНПФ не шлёт Access-Control-Expose-Headers), поэтому поля serverDate и cors там равны null — это норма.
 *
 * Какие персональные данные уходят в ЕНПФ (третьему лицу!):
 *   прогноз — пол, дата рождения, стаж (до 1998 г., в накопительной системе, вредный), средняя зарплата
 *             и её рост, остатки на счетах ОПВ/ОППВ/ОПВР/ДПВ, параметры ДПВ, процент УИП, желаемое изъятие;
 *   КСЖ     — пол, дата рождения, возраст начала выплат, сумма накоплений (или желаемая выплата),
 *             гарантийный период, тип договора, признак ОППВ ≥ 60 мес., группа инвалидности (данные о здоровье).
 * Имя, ИИН, телефон, e-mail и другие идентификаторы НЕ отправляются — и не должны: тела запросов
 * собираются только из перечисленных полей. Тем не менее это персональные данные клиента: вызывать
 * только по явной кнопке агента и с согласия клиента (README генератора КП обещает, что данные
 * «никуда не отправляются» — см. docs/09 §8.3 п. 7). Для автоматических проверок — только синтетические лица.
 * Эндпоинты sendPDFtoEmail / sendPDFToEmail (отправка писем) здесь сознательно не реализованы.
 *
 * Вежливость: все вызовы обоих API идут через одну последовательную очередь (createRateLimiter):
 * не больше одного запроса одновременно и не меньше 700 мс между концом предыдущего и началом следующего.
 *
 * Ответ прогноза: {"code":"0","message":"<base64(UTF-8 JSON)>"} или {"code":"-1","message":"<текст ошибки>"}
 * (ошибка открытым текстом, на русском при Lang "0" и на казахском при Lang "1").
 * Ответ КСЖ: обычный JSON; ошибки — HTTP 400 с текстом; битая дата рождения или пустой insStartDay —
 * сервер рвёт строку статуса («HTTP/1.1 -1»), fetch при этом падает (в Node — HPE_INVALID_STATUS).
 */

/** Адрес прогнозного калькулятора. */
const ENPF_FORECAST_URL = 'https://mobile.enpf.kz/JasperReports/api/EnpfCalculator2New';
/** Адрес калькулятора КСЖ ЕНПФ. */
const ENPF_KSZH_URL = 'https://mobile.enpf.kz/kszh/webresources/generic/calculateKSZHDev';
/** Минимальная пауза между вызовами, мс (конец предыдущего → начало следующего). */
const ENPF_MIN_INTERVAL_MS = 700;
/** Таймаут одного вызова по умолчанию, мс (время ожидания в очереди не считается). */
const ENPF_TIMEOUT_MS = 20000;

/** 32 ключа тела прогноза в том порядке, в каком их отправляет сайт ЕНПФ (docs/01 §3). Все значения — строки. */
const FORECAST_BODY_KEYS = Object.freeze([
  'Sex', 'BirthDate', 'Exp1998', 'ExpVred', 'ExpYear', 'AverageSal', 'EnlargeSal', 'EnlargeType', 'EnlargeTenge',
  'EnlargePercent', 'PayoffDegree', 'PeriodPayOPV', 'OPV', 'SumOPV', 'OPPV', 'SumOPPV', 'OPVR', 'SumOPVR', 'DPV',
  'SumDPV', 'SumDPVtype', 'SumDPVtenge', 'SumDPVpercent', 'PeriodPayDPV', 'PayoutAge', 'PayoutMonth', 'Lang',
  'CalcType', 'porogInputs', 'payoffYear', 'payoffAmount', 'payoffIpnType',
]);

/** Ключи тела КСЖ (плюс KSZHParams: {lang}) в порядке фронтенда ЕНПФ (docs/04 §2.1). */
const KSZH_BODY_KEYS = Object.freeze([
  'sex', 'birthday', 'insStartDay', 'totalPension', 'totalPensionType', 'warrPeriod', 'pensann', 'paymentOppv',
  'disability',
]);

/**
 * Тексты ошибок, которые возвращает сам сервер ЕНПФ (проверено живыми пробами 05.10.2026,
 * source_enpf/api_samples/*.jsonl, research/forecast_frontend/probes.jsonl). Клиентская проверка
 * для этих правил отдаёт ровно тот же текст, чтобы UI показывал то же, что сайт ЕНПФ.
 */
const ENPF_SERVER_MESSAGES = Object.freeze({
  forecast: Object.freeze({
    retired: 'Некорректные входные данные. Вкладчик уже достиг пенсионного возраста.',
    retiredKz: 'Кіріс деректері қате. Салымшы зейнет жасына толған.',
    expYear: 'Некорректные входные данные. Стаж в накопительной пенсионной системе не может быть больше текущего возраста "минус" возраст на 01.01.1998г.',
    uip: 'Некорректные входные данные. Процент изъятия не может превышать 50% от ПН',
    dpvAge: 'Некорректные входные данные. Возраст получения ДПВ не может быть меньше текущего возраста.',
    sumOpv: 'Текущая сумма пенсионных накоплений по ОПВ задана неверно',
    averageSal: 'Средняя заработная плата в месяц задана неверно',
    technical: 'Техническая ошибка',
  }),
  kszh: Object.freeze({
    sex: 'Не правильно указан пол',
    sexKz: 'Жыныс дұрыс көрсетілмеген',
    warrPeriod: 'Введите гарантийный период',
    totalPension: 'Введите действительную общую сумму пенсионных накоплениий / размер выплаты', // «накоплениий» — опечатка ЕНПФ
    totalPensionType: 'Выберите тип общей суммы пенсионных накоплений',
  }),
});

/** Сообщение для пользователя при недоступности сервиса (как на сайте ЕНПФ). */
const ENPF_UNAVAILABLE_MESSAGE = 'Сервис временно недоступен. Попробуйте позднее.';

// ---------------------------------------------------------------- base64 → UTF-8 ----------

/**
 * Декодирует base64 в строку UTF-8. Работает и в браузере, и в Node:
 *   'atob'   — atob + TextDecoder (браузер; в Node 22 тоже есть глобально);
 *   'buffer' — Buffer (Node; запасной путь, если atob/TextDecoder нет).
 * Пробелы и переводы строк внутри base64 игнорируются. Некорректный UTF-8 → исключение
 * (TextDecoder с fatal: true), а не тихие «�».
 * Сайт ЕНПФ декодирует самописным decode64() без поддержки UTF-8 — нам так нельзя (docs/01 §3).
 * @param {string} b64
 * @param {{impl?: 'atob'|'buffer'}} [opts] принудительно выбрать путь (для тестов)
 * @returns {string}
 */
function decodeBase64Utf8(b64, { impl } = {}) {
  const clean = String(b64 ?? '').replace(/\s+/g, '');
  const hasAtob = typeof globalThis.atob === 'function' && typeof globalThis.TextDecoder === 'function';
  const NodeBuffer = globalThis.Buffer;
  const way = impl || (hasAtob ? 'atob' : 'buffer');
  if (way === 'atob') {
    if (!hasAtob) throw new Error('atob/TextDecoder недоступны в этой среде');
    const bin = globalThis.atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  if (way === 'buffer') {
    if (typeof NodeBuffer !== 'function') throw new Error('Buffer недоступен: нет ни atob, ни Buffer');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
      throw new Error('Некорректная строка base64');
    }
    const bytes = NodeBuffer.from(clean, 'base64');
    if (typeof globalThis.TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return bytes.toString('utf8');
  }
  throw new Error('decodeBase64Utf8: неизвестный способ ' + way);
}

/**
 * Обратная операция (UTF-8 → base64) — для тестов и моков; в браузере через btoa, в Node через Buffer.
 * @param {string} text
 * @returns {string}
 */
function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (typeof globalThis.btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return globalThis.btoa(bin);
  }
  return globalThis.Buffer.from(bytes).toString('base64');
}

/**
 * Поле message успешного ответа прогноза → объект (EnpfCalculatorRealist/… , PensionAnnuityAsk).
 * @param {string} b64
 * @param {{impl?: 'atob'|'buffer'}} [opts]
 * @returns {object}
 */
function decodeForecastMessage(b64, opts) {
  return JSON.parse(decodeBase64Utf8(b64, opts));
}

/**
 * Годы, доступные для изъятия, из ответа прогноза (CalcType "1", porogInputs "false").
 * Только эти годы можно передавать в payoffYear: для другого года ЕНПФ молча считает изъятие = 0
 * (проба xc_t3_payoff_2026_outside, docs/09 §5).
 * @param {object} decoded декодированный ответ
 * @returns {string[]}
 */
function payoffYearsFrom(decoded) {
  const sc = decoded?.EnpfCalculatorRealist || decoded?.EnpfCalculatorPessimist || decoded?.EnpfCalculatorOptimist;
  return (sc?.AvailableAmount || []).map((a) => String(a.year));
}

// ---------------------------------------------------------------- даты (без часовых поясов) ----

/** «Сегодня» → {y, m, d}: Date (локальные год/месяц/день), 'YYYY-MM-DD', 'DD.MM.YYYY'. */
function toDay(v) {
  if (v == null) v = new Date();
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('Некорректная дата «сегодня»');
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  if (typeof v === 'object' && 'year' in v) return { y: +v.year, m: +v.month, d: +v.day };
  const s = String(v).trim();
  let r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (r) return checkDay({ y: +r[1], m: +r[2], d: +r[3] });
  r = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (r) return checkDay({ y: +r[3], m: +r[2], d: +r[1] });
  throw new Error('Некорректная дата «сегодня»: ' + s);
}
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function checkDay(t) {
  if (!(t.m >= 1 && t.m <= 12 && t.d >= 1 && t.d <= dim(t.y, t.m))) throw new Error('Некорректная дата');
  return t;
}
/** 'дд.мм.гггг' → {y,m,d} или null. */
function parseRu(s) {
  const r = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s ?? '').trim());
  if (!r) return null;
  const t = { y: +r[3], m: +r[2], d: +r[1] };
  return t.m >= 1 && t.m <= 12 && t.d >= 1 && t.d <= dim(t.y, t.m) ? t : null;
}
const cmpDay = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
const utc = (t) => Date.UTC(t.y, t.m - 1, t.d);
function ageOn(b, t) { return t.y - b.y - ((t.m < b.m || (t.m === b.m && t.d < b.d)) ? 1 : 0); }
function yearsBetween(a, b) { return (utc(b) - utc(a)) / (365.2425 * 86400000); }
function addMonths(t, k) {
  const i = t.m - 1 + k;
  const y = t.y + Math.floor(i / 12), m = ((i % 12) + 12) % 12 + 1;
  return { y, m, d: Math.min(t.d, dim(y, m)) };
}
const fmtRu = (t) => `${String(t.d).padStart(2, '0')}.${String(t.m).padStart(2, '0')}.${t.y}`;

/**
 * Дата выхода на пенсию так, как её считает прогнозный API (docs/09 §6.2): мужчины — 63 года;
 * женщины — 61 (выход до 2027 г.), 61,5 (2028), 62 (2029), 62,5 (2030), 63 (с 2031) по году даты выхода.
 * @param {'M'|'F'} sex
 * @param {string} birthDate 'дд.мм.гггг'
 * @returns {string|null} 'дд.мм.гггг'
 */
function forecastRetirementDate(sex, birthDate) {
  const b = parseRu(birthDate);
  if (!b) return null;
  if (String(sex) !== 'F') return fmtRu(addMonths(b, 63 * 12));
  for (let k = 61 * 12; k <= 63 * 12; k += 6) {
    const r = addMonths(b, k);
    const need = ({ 2028: 61.5, 2029: 62, 2030: 62.5 })[r.y] ?? (r.y <= 2027 ? 61 : 63);
    if (k / 12 >= need) return fmtRu(r);
  }
  return fmtRu(addMonths(b, 63 * 12));
}

// ---------------------------------------------------------------- тела запросов ----------

const toStr = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : v == null ? v : String(v));

/**
 * Приводит тело прогноза к виду, который отправляет сайт ЕНПФ: ключи FORECAST_BODY_KEYS по порядку,
 * значения — строки (true/false → 'true'/'false', числа → String). Отсутствующие ключи остаются
 * отсутствующими (их поймает validateForecastRequest). Любые другие ключи ОТБРАСЫВАЮТСЯ — белый список
 * гарантирует, что в ЕНПФ не уйдёт ничего, кроме 32 полей калькулятора (например, ФИО клиента).
 * @param {object} body
 * @returns {object}
 */
function normalizeForecastBody(body) {
  const src = body || {};
  const out = {};
  for (const k of FORECAST_BODY_KEYS) if (k in src) out[k] = toStr(src[k]);
  return out;
}

/**
 * Приводит тело КСЖ к виду фронтенда ЕНПФ: значения — строки, KSZHParams: {lang: "0"} по умолчанию.
 * Другие ключи отбрасываются (белый список, как у прогноза).
 * @param {object} body
 * @returns {object}
 */
function normalizeKszhBody(body) {
  const src = body || {};
  const out = {};
  for (const k of KSZH_BODY_KEYS) if (k in src) out[k] = toStr(src[k]);
  out.KSZHParams = { lang: String(src.KSZHParams?.lang ?? '0') };
  return out;
}

// ---------------------------------------------------------------- проверка входа ----------

const NUM = /^\d+(\.\d+)?$/;
const INT = /^\d+$/;
const BOOL = /^(true|false)$/;

/**
 * Клиентская проверка тела прогноза — зеркало правил сервера ЕНПФ (docs/09 §8.2 п. 3, §5) плюс
 * проверки формата, о которых сервер молчит или отвечает «Технической ошибкой».
 *
 * Ошибки (сервер точно откажет или посчитает не то):
 *   - нет ключа или пустая строка (SumOPV/AverageSal — точный текст сервера);
 *   - AverageSal < 1 (на "0" сервер отвечает «Техническая ошибка»; для расчёта только из текущих
 *     накоплений передавайте "1" — docs/09 §3.10);
 *   - PayoffDegree > 50 («Процент изъятия не может превышать 50% от ПН»; закон разрешает 100 %, API — нет);
 *   - стаж в накопительной системе > дробного числа лет от max(01.01.1998; дата рождения) до сегодня
 *     (дни/365,25 — как сервер: живые ответы 05.10.2026, test/live-fresh.mjs F19, X4); за 0,3 года до предела —
 *     предупреждение (точная граница сервера внутри последних ≈ 0,3 года не измерена);
 *   - вкладчик уже достиг пенсионного возраста (прогноз ЕНПФ для пенсионеров не считает);
 *   - возраст получения ДПВ меньше текущего (в том числе PayoutAge = "0" при DPV = "true" — живой F06);
 *   - porogInputs = "true" и payoffYear не из AvailableAmount (если передан availableYears) — ЕНПФ молча
 *     обнулит изъятие (проба xc_t3_payoff_2026_outside).
 * Предупреждения (warnings) — расчёт возможен, но стоит проверить.
 *
 * @param {object} body тело (строки; будет нормализовано)
 * @param {{today?: Date|string, availableYears?: (string|number)[]}} [opts]
 * @returns {{ok: boolean, errors: {field: string, message: string, server: boolean}[], warnings: {field: string, message: string}[]}}
 */
function validateForecastRequest(body, { today, availableYears } = {}) {
  const b = normalizeForecastBody(body);
  const errors = [], warnings = [];
  const M = ENPF_SERVER_MESSAGES.forecast;
  const err = (field, message, server = false) => errors.push({ field, message, server });
  const warn = (field, message) => warnings.push({ field, message });
  const td = toDay(today);

  for (const k of FORECAST_BODY_KEYS) {
    if (!(k in b) || b[k] == null) err(k, `Нет поля ${k}: API ЕНПФ ждёт все 32 поля строками`);
    else if (b[k] === '') {
      if (k === 'SumOPV') err(k, M.sumOpv, true);
      else if (k === 'AverageSal') err(k, M.averageSal, true);
      else err(k, `Поле ${k} пустое: пустые строки ЕНПФ отвергает — передайте "0"`);
    }
  }
  for (const k of Object.keys(body || {})) if (!FORECAST_BODY_KEYS.includes(k)) warn(k, `Лишнее поле ${k} отброшено и в ЕНПФ не отправляется`);
  const has = (k) => b[k] != null && b[k] !== '';

  if (has('Sex') && !/^(M|F)$/.test(b.Sex)) err('Sex', 'Пол должен быть "M" или "F"');
  const birth = has('BirthDate') ? parseRu(b.BirthDate) : null;
  if (has('BirthDate') && !birth) err('BirthDate', 'Дата рождения должна быть в формате дд.мм.гггг');
  if (birth && cmpDay(birth, td) > 0) err('BirthDate', 'Дата рождения позже сегодняшней');

  for (const k of ['Exp1998', 'ExpVred', 'ExpYear', 'EnlargeTenge', 'EnlargePercent', 'SumOPPV', 'SumOPVR', 'SumDPV',
    'SumDPVtenge', 'SumDPVpercent', 'PayoutAge', 'PayoutMonth', 'payoffAmount']) {
    if (has(k) && !NUM.test(b[k])) err(k, `Поле ${k} должно быть неотрицательным числом с точкой (без пробелов): "${b[k]}"`);
  }
  if (has('SumOPV') && !NUM.test(b.SumOPV)) err('SumOPV', M.sumOpv, true);
  if (has('AverageSal')) {
    if (!NUM.test(b.AverageSal)) err('AverageSal', M.averageSal, true);
    else if (Number(b.AverageSal) < 1) {
      err('AverageSal', 'Средняя заработная плата должна быть не меньше 1 ₸: на 0 сервер ЕНПФ отвечает «Техническая ошибка». ' +
        'Чтобы посчитать выплаты только из текущих накоплений, передайте "1".');
    }
  }
  for (const k of ['EnlargeSal', 'EnlargeType', 'OPV', 'OPPV', 'OPVR', 'DPV', 'SumDPVtype', 'porogInputs']) {
    if (has(k) && !BOOL.test(b[k])) err(k, `Поле ${k} должно быть "true" или "false"`);
  }
  if (has('PayoffDegree')) {
    if (!INT.test(b.PayoffDegree)) err('PayoffDegree', 'Процент перевода в УИП — целое число от 0 до 50');
    else if (Number(b.PayoffDegree) > 50) err('PayoffDegree', M.uip, true);
  }
  if (has('PeriodPayOPV')) {
    if (!INT.test(b.PeriodPayOPV) || +b.PeriodPayOPV < 1 || +b.PeriodPayOPV > 12) err('PeriodPayOPV', 'Периодичность взносов — целое от 1 до 12');
    else if (b.PeriodPayOPV !== '12') warn('PeriodPayOPV', 'Сайт ЕНПФ всегда отправляет PeriodPayOPV = "12" (ошибка их фронтенда)');
  }
  if (has('PeriodPayDPV') && (!INT.test(b.PeriodPayDPV) || +b.PeriodPayDPV > 12)) err('PeriodPayDPV', 'Периодичность ДПВ — целое от 0 до 12');
  if (has('Lang') && !/^[01]$/.test(b.Lang)) err('Lang', 'Lang: "0" — русский, "1" — казахский');
  if (has('CalcType') && !/^[12]$/.test(b.CalcType)) err('CalcType', 'CalcType: "1" — выплаты из ЕНПФ, "2" — пенсионный аннуитет');
  if (has('payoffIpnType') && !/^[01]$/.test(b.payoffIpnType)) err('payoffIpnType', 'payoffIpnType: "0" — отложенная уплата ИПН, "1" — единовременная');
  if (has('EnlargePercent') && NUM.test(b.EnlargePercent) && +b.EnlargePercent > 100) warn('EnlargePercent', 'Рост зарплаты больше 100 % в год — сайт ЕНПФ такое не пропускает');

  if (birth) {
    const ageNow = ageOn(birth, td);
    const ret = parseRu(forecastRetirementDate(b.Sex === 'F' ? 'F' : 'M', b.BirthDate));
    if (ret && cmpDay(td, ret) >= 0) err('BirthDate', b.Lang === '1' ? M.retiredKz : M.retired, true);
    if (has('ExpYear') && NUM.test(b.ExpYear)) {
      const from = cmpDay(birth, { y: 1998, m: 1, d: 1 }) > 0 ? birth : { y: 1998, m: 1, d: 1 };
      // предел — дробные годы от max(01.01.1998; ДР) до сегодня, дни/365,25 (как validateForecastBody в lib/enpf-forecast.js)
      const limit = (utc(td) - utc(from)) / (365.25 * 86400000);
      const v = Number(b.ExpYear);
      if (v > limit + 1e-9) err('ExpYear', M.expYear, true);
      else if (v > limit - 0.3) warn('ExpYear', `Стаж ${v} лет близок к пределу ${limit.toFixed(2)} (столько лет прошло с 01.01.1998 или с даты рождения); точная граница сервера ЕНПФ в последние ≈ 0,3 года не проверена`);
    }
    if (b.DPV === 'true' && has('PayoutAge') && NUM.test(b.PayoutAge)) {
      const pa = Number(b.PayoutAge);
      if (pa < ageNow) err('PayoutAge', M.dpvAge, true);
      else if (pa < ageNow + yearsBetween(addMonths(birth, ageNow * 12), td)) warn('PayoutAge', M.dpvAge + ' (дробный возраст — граница не проверялась)');
    }
    if (has('Exp1998') && NUM.test(b.Exp1998) && +b.Exp1998 > Math.max(0, ageOn(birth, { y: 1998, m: 1, d: 1 }))) {
      warn('Exp1998', 'Стаж до 1998 г. больше возраста на 01.01.1998');
    }
  }

  if (b.porogInputs === 'true') {
    if (!/^\d{4}$/.test(b.payoffYear || '')) err('payoffYear', 'Год изъятия — четыре цифры');
    else if (Array.isArray(availableYears)) {
      const list = availableYears.map(String);
      if (!list.includes(b.payoffYear)) {
        err('payoffYear', `Год изъятия ${b.payoffYear} не входит в список доступных лет (${list.join(', ') || 'пусто'}). ` +
          'Для такого года ЕНПФ молча считает изъятие равным 0 — выберите год из AvailableAmount.');
      }
    } else {
      warn('payoffYear', 'Год изъятия берите только из AvailableAmount ответа CalcType "1": для другого года ЕНПФ молча обнулит изъятие');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Клиентская проверка тела КСЖ — зеркало правил сервера (docs/04 §2.3).
 * Сервер не проверяет право на аннуитет по возрасту — это делает только фронтенд ЕНПФ;
 * здесь это предупреждение.
 * @param {object} body
 * @param {{today?: Date|string}} [opts]
 * @returns {{ok: boolean, errors: {field: string, message: string, server: boolean}[], warnings: {field: string, message: string}[]}}
 */
function validateKszhRequest(body, { today } = {}) {
  const b = normalizeKszhBody(body);
  const errors = [], warnings = [];
  const M = ENPF_SERVER_MESSAGES.kszh;
  const kz = b.KSZHParams.lang === '1';
  const err = (field, message, server = false) => errors.push({ field, message, server });
  const warn = (field, message) => warnings.push({ field, message });
  const td = toDay(today);
  for (const k of Object.keys(body || {})) if (!KSZH_BODY_KEYS.includes(k) && k !== 'KSZHParams') warn(k, `Лишнее поле ${k} отброшено и в ЕНПФ не отправляется`);

  if (!/^[01]$/.test(b.sex ?? '')) err('sex', kz ? M.sexKz : M.sex, true);
  if (!/^[01]$/.test(b.totalPensionType ?? '')) err('totalPensionType', M.totalPensionType, true);
  if (!INT.test(b.warrPeriod ?? '')) err('warrPeriod', M.warrPeriod, true);
  if (!INT.test(b.totalPension ?? '') || Number(b.totalPension) > 2147483647) err('totalPension', M.totalPension, true);
  const birth = parseRu(b.birthday);
  if (!birth) err('birthday', 'Дата рождения должна быть в формате дд.мм.гггг: на другой формат сервер ЕНПФ отвечает битым статусом «HTTP/1.1 -1»');
  else if (cmpDay(birth, td) > 0) err('birthday', 'Дата рождения позже сегодняшней');
  const xs = String(b.insStartDay ?? '').trim();
  if (xs === '' || !NUM.test(xs)) err('insStartDay', 'Возраст начала выплат — число лет, например "55" или "53.5" (пустое значение сервер не обрабатывает: «HTTP/1.1 -1»)');
  else if (Number(xs) * 2 !== Math.floor(Number(xs) * 2)) warn('insStartDay', 'Сайт ЕНПФ предлагает только целые и половинные возрасты');
  if (!/^[01]$/.test(b.pensann ?? '0')) err('pensann', 'pensann: "0" — немедленный, "1" — отложенный аннуитет');
  if (!/^[01]$/.test(b.paymentOppv ?? '0')) err('paymentOppv', 'paymentOppv: "0" или "1"');
  if (!/^[0-3]$/.test(b.disability ?? '0')) warn('disability', 'Группа инвалидности не 0–3: сервер ЕНПФ трактует её как "0"');
  if (!/^[01]$/.test(b.KSZHParams.lang)) warn('KSZHParams.lang', 'lang: "0" — русский, "1" — казахский');
  if (b.warrPeriod && INT.test(b.warrPeriod) && +b.warrPeriod > 60) warn('warrPeriod', 'Гарантийный период больше 60 лет — сервер посчитает, но это нереалистично');
  if (birth && NUM.test(xs) && Number(xs) < 50 && b.paymentOppv !== '1') {
    warn('insStartDay', 'Возраст начала выплат ниже 50 лет: сервер ЕНПФ посчитает, но по закону ПА так рано недоступен');
  }
  // отложенный договор со стартом раньше текущего возраста (d < 0): реплика lib/enpf-kszh.js эту ветку не воспроизводит
  // (живая проба K12 05.10.2026; в ответе реплики debug.unverifiedBranch = true), сайт ЕНПФ такой ввод не предлагает
  if (birth && NUM.test(xs) && b.pensann === '1' && cmpDay(birth, td) <= 0 && Math.floor(Number(xs)) < ageOn(birth, td)) {
    warn('insStartDay', `Отложенный договор (pensann = 1) с возрастом начала выплат ${xs} меньше текущего возраста ${ageOn(birth, td)}: ` +
      'сервер ЕНПФ посчитает, но эта ветка не проверена — реплика КСЖ расходится с ЕНПФ (живая проба K12: выплаты ЕНПФ ≈ на 8,9 % выше). ' +
      'Сайт ЕНПФ такой ввод не предлагает: выберите немедленный договор или возраст не меньше текущего.');
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------- очередь и HTTP ----------

/**
 * Последовательная очередь вызовов с минимальной паузой и (необязательно) жёстким лимитом числа вызовов.
 * Пауза отсчитывается от конца предыдущего вызова до начала следующего (как в research/crosscheck/client.py).
 * @param {{minIntervalMs?: number, maxCalls?: number, now?: () => number, sleep?: (ms: number) => Promise<void>}} [opts]
 * @returns {{schedule: <T>(task: () => Promise<T>) => Promise<T>, readonly calls: number, readonly pending: number,
 *            readonly log: {startedAt: number, endedAt: number}[], minIntervalMs: number, maxCalls: number}}
 */
function createRateLimiter({ minIntervalMs = ENPF_MIN_INTERVAL_MS, maxCalls = Infinity,
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let tail = Promise.resolve();
  let lastEnd = -Infinity;
  let calls = 0, pending = 0;
  const log = [];
  function schedule(task) {
    pending++;
    const run = async () => {
      try {
        if (calls >= maxCalls) {
          const e = new Error(`Достигнут лимит вызовов ЕНПФ (${maxCalls})`);
          e.code = 'CALL_CAP';
          throw e;
        }
        const wait = lastEnd + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        calls++;
        const startedAt = now();
        try {
          return await task();
        } finally {
          lastEnd = now();
          log.push({ startedAt, endedAt: lastEnd });
        }
      } finally {
        pending--;
      }
    };
    const p = tail.then(run, run);
    tail = p.catch(() => {});
    return p;
  }
  return {
    schedule, minIntervalMs, maxCalls,
    get calls() { return calls; },
    get pending() { return pending; },
    get log() { return log.slice(); },
  };
}

let defaultLimiter = createRateLimiter();
/** Общая очередь по умолчанию для обоих API (один хост mobile.enpf.kz). */
function getDefaultLimiter() { return defaultLimiter; }
/** Заменить общую очередь (например, с лимитом вызовов в тестах). Возвращает прежнюю. */
function setDefaultLimiter(limiter) { const old = defaultLimiter; defaultLimiter = limiter; return old; }

/**
 * Один POST через очередь, с таймаутом. Не бросает исключений на сетевых ошибках — возвращает kind.
 * @returns {Promise<{kind: 'response'|'timeout'|'network'|'bad-status'|'aborted'|'cap', status: number|null,
 *   text?: string, error?: string, headers?: {date: string|null, cors: string|null, contentType: string|null},
 *   fetchedAt: string|null, durationMs: number|null}>}
 */
async function post(url, body, contentType, { timeoutMs = ENPF_TIMEOUT_MS, fetchImpl, limiter, signal } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') {
    return { kind: 'network', status: null, error: 'fetch недоступен в этой среде', fetchedAt: null, durationMs: null };
  }
  const q = limiter || defaultLimiter;
  try {
    return await q.schedule(async () => {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
      const onAbort = () => ctrl.abort();
      if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      const fetchedAt = new Date().toISOString();
      const t0 = Date.now();
      try {
        const resp = await f(url, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = await resp.text();
        const h = (n) => (resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get(n) : null);
        return {
          kind: 'response', status: resp.status, text, fetchedAt, durationMs: Date.now() - t0,
          headers: { date: h('date'), cors: h('access-control-allow-origin'), contentType: h('content-type') },
        };
      } catch (e) {
        const durationMs = Date.now() - t0;
        if (timedOut) return { kind: 'timeout', status: null, error: `Нет ответа ЕНПФ за ${timeoutMs} мс`, fetchedAt, durationMs };
        if (signal?.aborted) return { kind: 'aborted', status: null, error: 'Запрос отменён', fetchedAt, durationMs };
        const code = e?.cause?.code || e?.code || '';
        if (code === 'HPE_INVALID_STATUS' || /invalid status|HPE_INVALID_STATUS/i.test(String(e?.cause?.message || ''))) {
          return { kind: 'bad-status', status: -1, error: 'Сервер ЕНПФ вернул битую строку статуса «HTTP/1.1 -1»', fetchedAt, durationMs };
        }
        return { kind: 'network', status: null, error: `${e?.name || 'Error'}: ${e?.message || e}${code ? ` (${code})` : ''}`, fetchedAt, durationMs };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    });
  } catch (e) {
    if (e?.code === 'CALL_CAP') return { kind: 'cap', status: null, error: e.message, fetchedAt: null, durationMs: null };
    throw e;
  }
}

// ---------------------------------------------------------------- прогноз ----------

/**
 * Живой вызов прогнозного калькулятора ЕНПФ (EnpfCalculator2New).
 *
 * Результат:
 *   успех       — {code: '0', decoded, raw, fetchedAt, status, durationMs, serverDate, cors, kind: 'ok', source: 'server', warnings}
 *                 decoded — объект EnpfCalculatorRealist/Optimist/Pessimist(+UIP), PensionAnnuityAsk; суммы в реальных тенге 2026 г.
 *   ошибка API  — {code: '-1', message, raw, ..., kind: 'server', source: 'server'} (текст ЕНПФ как есть)
 *   не прошла клиентская проверка — {code: '-1', message, errors, warnings, kind: 'validation', source: 'client',
 *                 raw: null, fetchedAt: null} — запрос в ЕНПФ НЕ отправлялся
 *   сбой связи  — {code: 'network', message: ENPF_UNAVAILABLE_MESSAGE, error, kind: 'timeout'|'network'|'http'|'parse'|'cap'|'aborted', ...}
 *
 * @param {object} body тело запроса (32 поля строками, как у сайта ЕНПФ; см. buildForecastBody в lib/enpf-forecast.js)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=20000]
 * @param {boolean} [opts.validate=true] выполнить validateForecastRequest до отправки (false — отправить как есть;
 *                  нужно канарейке, которая проверяет ответы самого сервера на ошибочный ввод)
 * @param {Date|string} [opts.today] дата для клиентской проверки возраста (по умолчанию — сегодня)
 * @param {(string|number)[]} [opts.availableYears] годы из AvailableAmount предыдущего ответа (для payoffYear)
 * @param {Function} [opts.fetchImpl] свой fetch (тесты)
 * @param {ReturnType<typeof createRateLimiter>} [opts.limiter] своя очередь (по умолчанию — общая)
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.url=ENPF_FORECAST_URL]
 * @returns {Promise<object>}
 */
async function fetchForecast(body, { timeoutMs = ENPF_TIMEOUT_MS, validate = true, today, availableYears,
  fetchImpl, limiter, signal, url = ENPF_FORECAST_URL } = {}) {
  const req = normalizeForecastBody(body);
  let warnings = [];
  if (validate) {
    const v = validateForecastRequest(req, { today, availableYears });
    warnings = v.warnings;
    if (!v.ok) {
      return { code: '-1', message: v.errors[0].message, errors: v.errors, warnings, raw: null, fetchedAt: null,
        status: null, durationMs: null, kind: 'validation', source: 'client' };
    }
  }
  const r = await post(url, req, 'application/json', { timeoutMs, fetchImpl, limiter, signal });
  const meta = { fetchedAt: r.fetchedAt, status: r.status, durationMs: r.durationMs,
    serverDate: r.headers?.date ?? null, cors: r.headers?.cors ?? null, warnings };
  if (r.kind !== 'response') return { code: 'network', message: ENPF_UNAVAILABLE_MESSAGE, error: r.error, raw: null, kind: r.kind, source: 'transport', ...meta };
  if (r.status < 200 || r.status >= 300) {
    return { code: 'network', message: ENPF_UNAVAILABLE_MESSAGE, error: `HTTP ${r.status}: ${String(r.text).slice(0, 300)}`,
      raw: r.text, kind: 'http', source: 'transport', ...meta };
  }
  let raw;
  try { raw = JSON.parse(r.text); } catch (e) {
    return { code: 'network', message: ENPF_UNAVAILABLE_MESSAGE, error: 'Ответ ЕНПФ не JSON: ' + String(r.text).slice(0, 300),
      raw: r.text, kind: 'parse', source: 'transport', ...meta };
  }
  const code = String(raw?.code);
  if (code === '0') {
    try {
      return { code: '0', decoded: decodeForecastMessage(raw.message), raw, kind: 'ok', source: 'server', ...meta };
    } catch (e) {
      return { code: 'network', message: ENPF_UNAVAILABLE_MESSAGE, error: 'Не удалось декодировать base64/UTF-8/JSON: ' + e.message,
        raw, kind: 'parse', source: 'transport', ...meta };
    }
  }
  return { code, message: String(raw?.message ?? ''), raw, kind: 'server', source: 'server', ...meta };
}

// ---------------------------------------------------------------- КСЖ ----------

/**
 * Живой вызов калькулятора КСЖ ЕНПФ (calculateKSZHDev).
 *
 * Результат:
 *   успех      — {ok: true, data, status: 200, fetchedAt, durationMs, serverDate, cors, kind: 'ok', warnings}
 *                data — {nominalOutParams, currentOutParams, nominalDiagramParams[612], currentDiagramParams[612]},
 *                все числа строками (38–40 значащих цифр, Oracle NUMBER)
 *   ошибка API — {ok: false, error: '<текст ЕНПФ>', status: 400, kind: 'server'}
 *   битая дата / пустой возраст — {ok: false, error, status: -1, kind: 'bad-status'} (в браузере такой ответ
 *                неотличим от сетевой ошибки: kind 'network')
 *   клиентская проверка — {ok: false, error, errors, warnings, status: null, kind: 'validation'} — запрос НЕ отправлялся
 *   сбой связи — {ok: false, error, status, kind: 'timeout'|'network'|'http'|'parse'|'cap'|'aborted'}
 *
 * @param {object} body {sex, birthday, insStartDay, totalPension, totalPensionType, warrPeriod, pensann, paymentOppv,
 *                      disability, KSZHParams?: {lang}} — строки
 * @param {object} [opts] те же, что у fetchForecast (timeoutMs, validate, today, fetchImpl, limiter, signal, url)
 * @returns {Promise<object>}
 */
async function fetchKszh(body, { timeoutMs = ENPF_TIMEOUT_MS, validate = true, today, fetchImpl, limiter,
  signal, url = ENPF_KSZH_URL } = {}) {
  const req = normalizeKszhBody(body);
  let warnings = [];
  if (validate) {
    const v = validateKszhRequest(req, { today });
    warnings = v.warnings;
    if (!v.ok) {
      return { ok: false, error: v.errors[0].message, errors: v.errors, warnings, status: null, fetchedAt: null,
        durationMs: null, kind: 'validation' };
    }
  }
  const r = await post(url, req, 'application/json;charset=utf-8', { timeoutMs, fetchImpl, limiter, signal });
  const meta = { status: r.status, fetchedAt: r.fetchedAt, durationMs: r.durationMs,
    serverDate: r.headers?.date ?? null, cors: r.headers?.cors ?? null, warnings };
  if (r.kind !== 'response') return { ok: false, error: r.error, kind: r.kind, ...meta };
  if (r.status === 400) return { ok: false, error: String(r.text).trim(), kind: 'server', ...meta };
  if (r.status < 200 || r.status >= 300) {
    return { ok: false, error: `HTTP ${r.status}: ${String(r.text).slice(0, 300)}`, kind: 'http', ...meta };
  }
  try {
    const data = JSON.parse(r.text);
    if (!data || typeof data !== 'object' || !data.nominalOutParams) {
      return { ok: false, error: 'Неожиданная структура ответа КСЖ: ' + String(r.text).slice(0, 300), kind: 'parse', ...meta };
    }
    return { ok: true, data, kind: 'ok', ...meta };
  } catch (e) {
    return { ok: false, error: 'Ответ КСЖ не JSON: ' + String(r.text).slice(0, 300), kind: 'parse', ...meta };
  }
}

__EL.define('enpf-api.js', { ENPF_FORECAST_URL, ENPF_KSZH_URL, ENPF_MIN_INTERVAL_MS, ENPF_TIMEOUT_MS, FORECAST_BODY_KEYS, KSZH_BODY_KEYS, ENPF_SERVER_MESSAGES, ENPF_UNAVAILABLE_MESSAGE, decodeBase64Utf8, encodeBase64Utf8, decodeForecastMessage, payoffYearsFrom, forecastRetirementDate, normalizeForecastBody, normalizeKszhBody, validateForecastRequest, validateKszhRequest, createRateLimiter, getDefaultLimiter, setDefaultLimiter, fetchForecast, fetchKszh });
})(typeof window !== 'undefined' ? window : globalThis);
