/* ════ EnpfLib · dates.js ════
 * Копия ~/Downloads/Калькулятор ЕНПФ/lib/dates.js
 * (sha256 fce100b3e16c872c…), приведена к обычному скрипту инструментом tools/sync-enpf.js:
 * import/export заменены реестром window.EnpfLib, остальной код — как в библиотеке.
 * Руками не править: исправлять в библиотеке и запускать node tools/sync-enpf.js. */
(function (__enpfRoot) {
'use strict';
const __EL = __enpfRoot.EnpfLib;
/*
 * Мелкие помощники для дат без часовых поясов: дата = {year, month (1..12), day}.
 * Используются модулями core-actuarial (enpf-kszh, sl-annuity, enpf-schedule).
 */

/**
 * Приводит «сегодня» к {year, month, day}.
 * Принимает Date (берутся локальные год/месяц/день), 'YYYY-MM-DD', 'DD.MM.YYYY' или {year, month, day}.
 * @param {Date|string|{year:number,month:number,day:number}} [v=new Date()]
 */
function toYMD(v = new Date()) {
  if (v == null) v = new Date();
  if (v instanceof Date) {
    if (isNaN(v.getTime())) throw new Error('Некорректная дата');
    return { year: v.getFullYear(), month: v.getMonth() + 1, day: v.getDate() };
  }
  if (typeof v === 'object' && 'year' in v) return { year: +v.year, month: +v.month, day: +v.day };
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return checkYMD({ year: +m[1], month: +m[2], day: +m[3] }, s);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return checkYMD({ year: +m[3], month: +m[2], day: +m[1] }, s);
  throw new Error('Некорректная дата: ' + s);
}

function checkYMD(d, s) {
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > lastDay(d.year, d.month)) throw new Error('Некорректная дата: ' + s);
  return d;
}

/** Число дней в месяце (month 1..12). */
function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Сравнение дат: <0, 0, >0. */
function cmpYMD(a, b) {
  return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
}

/** 'YYYY-MM-DD'. */
function isoYMD(d) {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** 'DD.MM.YYYY'. */
function ruYMD(d) {
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`;
}

/** Число полных лет на дату on. */
function completedAge(birth, on) {
  let a = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) a -= 1;
  return a;
}

/** Excel DATEDIF(a; b; "m") — число полных месяцев (b ≥ a). */
function monthsBetween(a, b) {
  let m = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day < a.day) m -= 1;
  return m;
}

/** Excel EDATE: тот же день через k месяцев, в коротком месяце — последний день. */
function edate(d, k) {
  const idx = d.month - 1 + Math.trunc(k);
  const year = d.year + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12 + 1;
  return { year, month, day: Math.min(d.day, lastDay(year, month)) };
}

/** Дни между датами (b − a). */
function daysBetween(a, b) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 864e5);
}

/** Доля года в днях: (b − a)/365,25 — для дробного возраста. */
function yearFraction(a, b) {
  return daysBetween(a, b) / 365.25;
}

__EL.define('dates.js', { toYMD, lastDay, cmpYMD, isoYMD, ruYMD, completedAge, monthsBetween, edate, daysBetween, yearFraction });
})(typeof window !== 'undefined' ? window : globalThis);
