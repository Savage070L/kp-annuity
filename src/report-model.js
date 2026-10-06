/*
 * Модель коммерческого предложения: из результата расчёта (engine.js),
 * данных клиента и агента получаем все значения и тексты отчёта.
 */
(function (root) {
  'use strict';

  var NB = ' ';
  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
                    'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  /* 5 800 000 — тысячи через неразрывный пробел */
  function money(v) {
    var s = String(Math.round(Math.abs(v)));
    var out = '';
    while (s.length > 3) { out = NB + s.slice(-3) + out; s = s.slice(0, -3); }
    return (v < 0 ? '−' : '') + s + out;
  }
  /* то же, но в HTML-сущностях — как в исходном отчёте */
  function moneyH(v) { return money(v).replace(/ /g, '&#160;'); }
  function tenge(v) { return moneyH(v) + '&#160;₸'; }

  /* ×2,4 · ×15 · ×33,6 */
  function times(v) {
    var r = v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 10) / 10;
    var s = (Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(1)).replace('.', ',');
    return '×' + s;
  }
  /* 0,11 → 11 · 0,075 → 7,5 — проценты тарифа бывают дробными */
  function pctNum(v) { return String(Math.round(v * 10000) / 100).replace('.', ','); }
  function pct(v) { return pctNum(v) + '%'; }

  /* 1 год · 2 года · 5 лет · 21 год · 61 год */
  function yearsWord(n) {
    n = Math.abs(Math.floor(n));
    var d10 = n % 10, d100 = n % 100;
    if (d100 >= 11 && d100 <= 14) return 'лет';
    if (d10 === 1) return 'год';
    if (d10 >= 2 && d10 <= 4) return 'года';
    return 'лет';
  }
  function years(n) { return n + ' ' + yearsWord(n); }
  /* «к 70 годам» — для возраста всегда «годам», кроме 1 */
  function toYears(n) { return 'к ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'году' : 'годам'); }
  /* возраст начала выплат может быть дробным: 54,5 года */
  function ageLabel(a) {
    if (Math.abs(a - Math.round(a)) < 1e-9) return years(Math.round(a));
    return String(Math.round(a * 10) / 10).replace('.', ',') + ' года';
  }
  /* после «с»: с 55 лет, с 54 лет, с 51 года, с 54,5 года */
  function ageFrom(a) {
    if (Math.abs(a - Math.round(a)) < 1e-9) { var n = Math.round(a); return n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'года' : 'лет'); }
    return String(Math.round(a * 10) / 10).replace('.', ',') + ' года';
  }
  function ageNum(a) {
    return Math.abs(a - Math.round(a)) < 1e-9 ? String(Math.round(a)) : String(Math.round(a * 10) / 10).replace('.', ',');
  }
  function dateRu(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return '';
    return (+m[3]) + ' ' + MONTHS_GEN[+m[2] - 1] + ' ' + m[1] + ' г.';
  }
  var MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  var MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  function ymdOf(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function monthsWord(n) {
    var t = n % 100, o = n % 10;
    if (t > 10 && t < 20) return 'месяцев';
    return o === 1 ? 'месяц' : (o >= 2 && o <= 4 ? 'месяца' : 'месяцев');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Родительный падеж «для кого»: простые правила для имени и фамилии.
     Агент может поправить результат вручную в форме. */
  function genitiveWord(w, sex, isSurname) {
    if (!w) return w;
    var low = w.toLowerCase();
    var cap = function (s) { return s; };
    if (sex === 'мужской') {
      if (/(ов|ев|ёв|ин|ын)$/i.test(w)) return w + 'а';                 // Сейтов → Сейтова
      if (/(ский|цкий)$/i.test(w)) return w.slice(0, -2) + 'ого';     // Каменский → Каменского
      if (/ий$/i.test(w)) return w.slice(0, -2) + 'ия';                // Юрий → Юрия (имя)
      if (/й$/i.test(w)) return w.slice(0, -1) + 'я';                  // Сергей → Сергея
      if (/ь$/i.test(w)) return w.slice(0, -1) + 'я';                  // Игорь → Игоря
      if (/[жшчщгкх]а$/i.test(w)) return w.slice(0, -1) + 'и';         // Олжаса? (редко)
      if (/а$/i.test(w)) return w.slice(0, -1) + 'ы';                  // Никита → Никиты
      if (/я$/i.test(w)) return w.slice(0, -1) + 'и';
      if (/[бвгджзклмнпрстфхцчшщ]$/i.test(w)) return w + 'а';           // Арман → Армана
      return w;                                                          // Нурлыбек+? — несклоняемые оставляем
    }
    // женский
    if (isSurname) {
      if (/(ова|ева|ёва|ина|ына)$/i.test(w)) return w.slice(0, -1) + 'ой'; // Ахметова → Ахметовой
      if (/(ская|цкая)$/i.test(w)) return w.slice(0, -2) + 'ой';
      return w;                                                          // Ким, Пак — не склоняются
    }
    if (/[жшчщгкх]а$/i.test(w)) return w.slice(0, -1) + 'и';
    if (/ия$/i.test(w)) return w.slice(0, -1) + 'и';                     // Мария → Марии
    if (/а$/i.test(w)) return w.slice(0, -1) + 'ы';                      // Айгуль? нет; Алма → Алмы
    if (/я$/i.test(w)) return w.slice(0, -1) + 'и';
    if (/ь$/i.test(w)) return w.slice(0, -1) + 'и';                      // Айгерим? нет; Любовь → Любови
    return w;                                                            // Айгерим, Жанар — не склоняются
  }
  function genitiveName(fullName, sex) {
    var parts = String(fullName || '').trim().split(/\s+/);
    if (!parts[0]) return '';
    // «Имя Фамилия» — как в отчёте; отчество редко пишем в КП
    return parts.map(function (p, i) { return genitiveWord(p, sex, i === parts.length - 1 && parts.length > 1); }).join(' ');
  }
  function initials(fullName) {
    var parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '').charAt(0) + (parts[1] || '').charAt(0)).toUpperCase() || '—';
  }

  /* Категории калькулятора простыми словами: «Инвалидность 2гр (60-89%) бессрочно» → «Инвалидность II группы» */
  function catInfo(name) {
    var n = String(name || ''), g = /(\d)\s*гр/i.exec(n);
    if (/стандарт/i.test(n)) return { label: 'Без льгот', hint: 'стандартные условия', kind: 'std' };
    if (/оппв/i.test(n)) return { label: 'Вредное производство', hint: 'ОППВ за 60 месяцев', kind: 'oppv' };
    if (/инвалид/i.test(n) && g && +g[1] >= 1 && +g[1] <= 3) return { label: 'Инвалидность ' + ['', 'I', 'II', 'III'][+g[1]] + ' группы', hint: 'бессрочная', kind: 'inv' };
    return { label: n, hint: '', kind: 'other' };
  }

  /* Пенсионный возраст ЕНПФ для блока «Ранний старт», если библиотеки ЕНПФ нет: мужчины 63, женщины 61 */
  function enpfAge(sex) { return sex === 'мужской' ? 63 : 61; }

  /* ════════════════════════════════════════════════════════════════════════════
     Сравнение «оставить в ЕНПФ или перевести в аннуитет» (раздел 08b-enpf).
     Все цифры — библиотека «Калькулятор ЕНПФ» (src/enpf, копия lib/compare.js):
       · ЕНПФ — по правилам выплат ПП РК № 521 в номинале (6,5 %/12, не меньше 70 % ПМ, +5 % в год
         до исчерпания), накопления растут на (1 + инфляция)(1 + r) − 1, r — сценарий ЕНПФ;
       · аннуитет — Excel-реплика того же калькулятора компании, что и весь КП (сверяется ниже:
         если загруженный .xlsx считает иначе, блок не выводится — иначе в КП разошлись бы цифры);
       · одна ценовая база — сегодняшние деньги (цены даты расчёта) по выбранной инфляции.
     Базовая, солидарная пенсии, ОПВР и будущие взносы одинаковы в обоих вариантах — не сравниваются.
     ════════════════════════════════════════════════════════════════════════════ */
  var ENPF_PRESETS = {
    scenarios: [
      { key: 'pessimist', label: 'пессимистичный', tag: '0 %', short: 'доходность = инфляция', real: 0 },
      { key: 'realist', label: 'реалистичный', tag: '+1 %', short: 'инфляция + 1 %', real: 0.01 },
      { key: 'optimist', label: 'оптимистичный', tag: '+2 %', short: 'инфляция + 2 %', real: 0.02 }
    ],
    inflation: [
      { key: 'enpf', label: '10 % / 6,5 % / 6 % — как калькулятор ЕНПФ', path: null },
      { key: 'p5', label: '5 % в год', path: 0.05 },
      { key: 'p8', label: '8 % в год', path: 0.08 },
      { key: 'p10', label: '10 % в год', path: 0.10 }
    ]
  };
  function presetOf(list, key, def) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return def ? presetOf(list, def) : list[0];
  }
  /* настройки блока из формы генератора (client.enpf): показывать, сценарий ЕНПФ, инфляция, отметка живой сверки */
  function enpfSettings(client) {
    var s = (client && client.enpf) || {};
    return { show: s.show !== false, scenario: presetOf(ENPF_PRESETS.scenarios, s.scenario, 'realist').key,
             inflation: presetOf(ENPF_PRESETS.inflation, s.inflation, 'enpf').key, live: s.live || null };
  }
  /* вход библиотеки из того же ввода, по которому посчитан КП (calc.input — его кладёт ReportKit.plan) */
  function enpfInput(calc, st) {
    var inp = calc.input, T = calc.tariff || {};
    var cat = inp.category || 'Стандартный';
    var client = {
      sex: inp.sex, birthDate: inp.dob, savingsOPV: Math.max(0, +inp.savings || 0), category: cat,
      guaranteeYears: Math.max(0, Math.floor(+inp.guarantee || 0)), redemption: Math.max(0, +inp.redemption || 0),
      topUp: +inp.contribution > 0 ? +inp.contribution : undefined, oppv: inp.oppv,
      // K = 1,45 к выплатам ЕНПФ: ОППВ не меньше 60 месяцев (категория или отметка «ОППВ более 60 мес.»)
      harmful: cat === 'ОППВ 60 мес' || inp.oppv === 'Да'
    };
    var assumptions = {
      enpfScenario: st.scenario,
      dividendRate: inp.dividendRate == null ? undefined : +inp.dividendRate,
      // тариф — тот же, что у расчёта КП (у встроенного калькулятора он совпадает с библиотекой)
      slTariff: { i: T.i, ind: T.ind, alpha: T.alfa, gamma: T.gamma, maxGuaranteeYears: T.maxGuarantee,
                  dividendNet: T.dividendNet, tariffVersion: T.version }
    };
    var inf = presetOf(ENPF_PRESETS.inflation, st.inflation, 'enpf');
    if (inf.path != null) assumptions.inflationPath = inf.path;
    return { client: client, assumptions: assumptions, today: inp.calcDate };
  }
  /* аннуитет библиотеки обязан совпасть с расчётом КП до тенге — иначе блок не выводим */
  function enpfConsistency(cmp, calc) {
    var S = cmp.sl, bad = [];
    if (S.threshold !== calc.threshold) bad.push('порог ' + calc.threshold + ' / ' + S.threshold);
    if (S.premium !== calc.premium) bad.push('сумма перевода ' + calc.premium + ' / ' + S.premium);
    if (S.topUp !== calc.topup) bad.push('доплата ' + calc.topup + ' / ' + S.topUp);
    if (S.firstPayment !== calc.first) bad.push('первая выплата ' + calc.first + ' / ' + S.firstPayment);
    if (Math.abs(S.startAge - calc.startAge) > 1e-9) bad.push('возраст начала выплат ' + calc.startAge + ' / ' + S.startAge);
    var byAge = {};
    (calc.rows || []).forEach(function (r) { byAge[r.age] = r; });
    var rowBad = S.scheduleByAge.filter(function (r) { return !byAge[r.age] || byAge[r.age].m !== r.monthlyNominal; });
    if (rowBad.length) bad.push('выплаты по годам (' + rowBad[0].age + ' лет: ' + (byAge[rowBad[0].age] ? byAge[rowBad[0].age].m : '—') + ' / ' + rowBad[0].monthlyNominal + ')');
    return bad;
  }

  /* память на последние расчёты: генератор строит модель для сводки и для КП из одних и тех же данных */
  var enpfCache = [];
  /* liveData — живые ответы ЕНПФ на те же тела запросов ({forecast, forecast2, kszh, fetchedAt}): если есть, цифры ЕНПФ
     в КП берутся из них (источник правды — сам ЕНПФ), копия методики — только для сверки */
  function enpfCompute(calc, st, liveData) {
    var L = root.EnpfLib;
    var q = enpfInput(calc, st);
    var key = JSON.stringify([q, calc.threshold, calc.premium, calc.first, calc.topup, calc.startAge,
      (calc.rows || []).map(function (r) { return r.age + ':' + r.m; }).join(','), liveData ? liveData.fetchedAt || 'live' : '']);
    for (var i = 0; i < enpfCache.length; i++) if (enpfCache[i].key === key) return enpfCache[i].res;
    var res;
    try {
      var cmp = L.buildComparison(q.client, q.assumptions, { today: q.today, live: liveData || null });
      var bad = enpfConsistency(cmp, calc);
      res = bad.length
        ? { status: 'mismatch', message: 'Сравнение с ЕНПФ в КП не выводится: калькулятор КП считает аннуитет иначе, чем встроенный (' + bad.join('; ') + '). Иначе в одном КП оказались бы разные цифры.', cmp: cmp }
        : { status: 'ok', cmp: cmp };
    } catch (e) {
      res = { status: 'error', message: 'Сравнение с ЕНПФ не посчитано: ' + e.message };
    }
    enpfCache.unshift({ key: key, res: res });
    if (enpfCache.length > 6) enpfCache.pop();
    return res;
  }

  /*
   * Блок «ЕНПФ или аннуитет» для КП и генератора.
   * @returns {{status: 'ok'|'off'|'none'|'mismatch'|'error', message?: string, settings: object,
   *            cmp?: object (результат lib buildComparison), view?: object (данные раздела), liveBody?: object, liveKey?: string}}
   */
  function enpfComparison(calc, client) {
    var st = enpfSettings(client);
    var out = { status: 'none', settings: st };
    if (!root.EnpfLib || !root.EnpfLib.buildComparison) { out.message = 'Библиотека ЕНПФ не подключена.'; return out; }
    if (!calc || !calc.input || !calc.input.dob || !calc.input.calcDate || !calc.rows) { out.message = 'Нет данных клиента для сравнения.'; return out; }
    var r = enpfCompute(calc, st);
    out.status = r.status; out.message = r.message; out.cmp = r.cmp;
    if (r.cmp) {
      out.liveBody = r.cmp.enpf.liveBody || null;
      out.liveKey = out.liveBody ? JSON.stringify([r.cmp.calcDate, out.liveBody]) : null;
      out.kszhBody = r.cmp.sl.enpfKszhView ? r.cmp.sl.enpfKszhView.body : null;
      /* есть живые ответы ЕНПФ на ровно эти данные — пересчитать по ним */
      if (st.live && st.live.data && out.liveKey && st.live.key === out.liveKey) {
        var rl = enpfCompute(calc, st, st.live.data);
        if (rl.cmp) { r = rl; out.status = r.status; out.message = r.message; out.cmp = r.cmp; }
      }
    }
    if (r.status !== 'ok') return out;
    if (!st.show) { out.status = 'off'; out.message = 'Блок «ЕНПФ или аннуитет» выключен в генераторе.'; return out; }
    out.view = enpfView(r.cmp, calc, st, out.liveKey);
    return out;
  }

  /* после «с»/«до»: 63 лет, 61 года, 61,5 года */
  function ageGen(a) {
    if (Math.abs(a - Math.round(a)) < 1e-9) { var n = Math.round(a); return n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'года' : 'лет'); }
    return String(Math.round(a * 10) / 10).replace('.', ',') + ' года';
  }
  /* срок в месяцах словами: 8 лет · 8,5 года · 5 лет и 1 месяц · 4 месяца */
  function durationText(months) {
    var y = Math.floor(months / 12), m = months % 12;
    if (!y) return m + ' ' + monthsWord(m);
    if (!m) return years(y);
    if (m === 6) return y + ',5 года';
    return years(y) + ' и ' + m + ' ' + monthsWord(m);
  }
  /* «17,4 млн ₸» — для крупных сумм в тексте */
  function mlnText(v) {
    var m = Math.round(Math.abs(v) / 1e5) / 10;
    return (v < 0 ? '−' : '') + String(m).replace('.', ',') + '&#160;млн&#160;₸';
  }
  /* число с ключом: data-k — что это, data-v — значение библиотеки (по ним test/enpf-compare.js сверяет КП с lib) */
  function kv(key, v, f, cls, tag) {
    tag = tag || 'b';
    var text = f === 'm' ? mlnText(v) : f === 'a' ? String(v) : tenge(v);
    return '<' + tag + ' class="num' + (cls ? ' ' + cls : '') + '" data-k="' + key + '" data-v="' + (Math.round(v * 100) / 100) + '" data-f="' + f + '">' + text + '</' + tag + '>';
  }

  /*
   * Цифры ЕНПФ «как на enpf.kz» по возрастам — ТОЛЬКО из ответа прогнозного калькулятора ЕНПФ (реплика API,
   * совпадает с живым ЕНПФ до тенге: аудит 06.10.2026, 918 проверок): таблица «Год · Возраст · ОПВ · ОППВ»,
   * в ценах 2026 г. Получено к возрасту a — сумма строк таблицы с возрастом ≤ a, по 12 выплат в строке (как в таблице ЕНПФ).
   * Пенсионер (прогноз ЕНПФ не считает): формула Правил (6,5 % в год, не меньше 70 % ПМ) — помечается отдельно.
   */
  function enpfExactStream(b, firstAge) {
    var rows = (b && b.table && b.table.length) ? b.table.map(function (t) { return { age: t.age, m: t.opv + t.oppv }; }) : null;
    if (!rows && b && b.years > 0 && !b.lumpSum) {
      rows = [];
      for (var k = 0; k < b.years; k++) rows.push({ age: firstAge + k, m: b.monthlyReal });
    }
    rows = rows || [];
    var lump = !!(b && b.lumpSum);
    var lumpAmount = lump ? (b.lumpSumReal || b.monthlyReal) : 0;
    var from = lump ? (rows.length ? rows[0].age : firstAge) : (rows.length ? rows[0].age : null);
    return {
      lump: lump, lumpAmount: lumpAmount, from: from, to: rows.length ? rows[rows.length - 1].age : from, years: lump ? 0 : rows.length,
      monthly: lump ? 0 : (rows.length ? rows[0].m : 0),
      monthlyAt: function (a) {
        if (lump) return 0;
        for (var i = 0; i < rows.length; i++) if (rows[i].age <= a + 1e-9 && a < rows[i].age + 1 - 1e-9) return rows[i].m;
        return 0;
      },
      cumAt: function (a) {
        if (lump) return from != null && a + 1e-9 >= from ? lumpAmount : 0;
        var s = 0;
        for (var i = 0; i < rows.length; i++) if (rows[i].age <= a + 1e-9) s += 12 * rows[i].m;
        return s;
      }
    };
  }

  function enpfView(C, calc, st, liveKey) {
    var rows = C.rows, byAge = {};
    rows.forEach(function (r) { byAge[r.age] = r; });
    var A = C.assumptions, E = C.enpf, S = C.sl, Mx = C.metrics;
    var calcView = E.asInEnpfCalculator;
    var fromCalc = calcView.source === 'replica';                 // true — цифры прогнозного калькулятора ЕНПФ; false — формула Правил
    var ageNow = C.client.ageNow, horizon = A.horizonAge;
    var sc = presetOf(ENPF_PRESETS.scenarios, st.scenario, 'realist');
    var firstAge = E.retired ? ageNow : E.retirementAge;
    var X = {};
    ['pessimist', 'realist', 'optimist'].forEach(function (k) { X[k] = enpfExactStream(calcView.byScenario[k], firstAge); });
    var ex = X[sc.key];
    var eStartExact = ex.from != null ? ex.from : firstAge;
    var eStart = Math.floor(eStartExact + 1e-9);
    var eEndExact = ex.lump ? null : ex.to;                       // последний возраст в таблице ЕНПФ с выплатой
    var eYears = ex.years;
    var sStart = Mx.firstPayment.sl.age, sl0 = S.startAge;
    var cd = ymdOf(C.calcDate);
    var priceText = cd ? MONTHS_GEN[cd.m - 1] + ' ' + cd.y + NB + 'г.' : '';
    var calcDateText = dateRu(C.calcDate);
    var early = E.retired && S.immediate ? 0 : Math.round((eStartExact - sl0) * 12) / 12;   // на сколько раньше старт аннуитета (пенсионер: оба — сразу)
    var earlyText = early > 0 ? durationText(Math.round(early * 12)) : '';
    var slStartText = S.immediate ? 'сразу' : 'с ' + ageGen(sl0);
    var eStartText = E.retired ? 'сразу' : 'с ' + ageGen(eStartExact);
    var eRangeText = ex.lump ? 'одной суммой' : eYears ? 'с ' + ageGen(eStartExact) + ' до ' + ageGen(eEndExact) + ' включительно — ' + years(eYears) : '';

    /* ряды графиков и таблиц: ЕНПФ — точные цифры ЕНПФ, аннуитет — по договору (Excel), в ценах 2026 г. — наша оценка */
    var x0 = Math.max(ageNow, Math.min(sStart, eStart) - 2);
    var series = rows.filter(function (r) { return r.age >= x0; }).map(function (r) {
      return { age: r.age, s: r.slMonthlyReal, sc: r.slCumReal, sn: r.slMonthlyNominal,
               e: X[sc.key].monthlyAt(r.age), ep: X.pessimist.monthlyAt(r.age), eo: X.optimist.monthlyAt(r.age),
               ec: X[sc.key].cumAt(r.age), ecp: X.pessimist.cumAt(r.age), eco: X.optimist.cumAt(r.age),
               lump: ex.lump && Math.abs(r.age - eStart) < 1e-9 };
    });
    var cumE = function (a) { return ex.cumAt(a); };

    /* возраст для итоговой разницы: 80 лет (как в остальном КП), если выплаты ЕНПФ к нему уже идут */
    var refAge = byAge[80] && 80 >= eStart ? 80 : horizon;
    var ref = byAge[refAge];
    var refE = cumE(refAge);
    var diff = ref.slCumReal - refE;

    /* кто впереди по сумме полученного (аннуитет — в ценах 2026 г., ЕНПФ — как в калькуляторе ЕНПФ) */
    var lead = rows.filter(function (r) { return r.age >= ageNow && r.age <= horizon; }).map(function (r) {
      var d = r.slCumReal - cumE(r.age);
      return { age: r.age, leader: Math.abs(d) < 1 ? 'equal' : d > 0 ? 'sl' : 'enpf' };
    }).filter(function (r) { return r.age >= Math.min(sStart, eStart); });
    var enpfLeadAges = lead.filter(function (r) { return r.leader === 'enpf'; }).map(function (r) { return r.age; });
    var lastLeader = lead.length ? lead[lead.length - 1].leader : 'equal';
    var optAhead = sc.key === 'optimist' ? [] : rows.filter(function (r) { return r.age >= ageNow && r.age <= horizon && X.optimist.cumAt(r.age) > r.slCumReal + 0.5; });

    var enpfEndText = ex.lump ? 'выплатит накопления одной суммой' : eYears ? 'платит ' + years(eYears) + ' (' + eRangeText.replace(/ — .*$/, '') + ')' : 'не платит';
    var opening = (early > 0 ? 'Аннуитет начинает платить на ' + earlyText + ' раньше ЕНПФ и платит пожизненно'
      : early < 0 ? 'ЕНПФ начинает платить раньше, а аннуитет платит пожизненно'
      : (E.retired ? 'Оба варианта начинают платить сразу' : 'Оба варианта начинают платить одновременно') + ', а аннуитет платит пожизненно') +
      '; ЕНПФ ' + (fromCalc ? 'по своему калькулятору ' : 'по формуле Правил выплат ') + enpfEndText + '.';
    var cumPair = 'к ' + refAge + ' ' + (refAge % 10 === 1 && refAge % 100 !== 11 ? 'году' : 'годам') + ' по аннуитету придёт ' + kv('v.cum.sl', ref.slCumReal, 'm', '', 'span') +
      ', из ЕНПФ — ' + kv('v.cum.enpf', refE, 'm', '', 'span') + ' (в ценах 2026' + NB + 'г.)';
    var scAt = 'При ' + sc.label.replace(/ый$/, 'ом') + ' сценарии калькулятора ЕНПФ';
    var optNote = optAhead.length
      ? ' При оптимистичном сценарии ЕНПФ (доходность на 2' + NB + '% выше инфляции) по сумме впереди был бы ЕНПФ: ' +
        (optAhead[optAhead.length - 1].age >= horizon ? 'с ' + ageGen(optAhead[0].age) + ' и дальше.' : 'с ' + optAhead[0].age + ' до ' + ageGen(optAhead[optAhead.length - 1].age + 1) + '.')
      : '';
    var title, text, tone;
    if (!enpfLeadAges.length && lastLeader === 'sl') {
      tone = 'sl';
      title = 'Аннуитет: ' + (early > 0 ? 'раньше, ' : '') + 'пожизненно и больше в сумме';
      text = opening + ' ' + scAt + ' по сумме выплат аннуитет впереди в любом возрасте: ' + cumPair + '.' + optNote;
    } else if (lastLeader === 'sl') {
      tone = 'mixed';
      title = 'Аннуитет — ' + (early > 0 ? 'раньше и ' : '') + 'пожизненно; по сумме ЕНПФ на время впереди';
      text = opening + ' ' + scAt + ' по сумме выплат ЕНПФ впереди с ' + enpfLeadAges[0] + ' до ' + ageGen(enpfLeadAges[enpfLeadAges.length - 1] + 1) + ', потом снова аннуитет: ' + cumPair + '.' + optNote;
    } else if (lastLeader === 'equal') {
      tone = 'mixed';
      title = 'По сумме выплат варианты почти равны';
      text = opening + ' ' + cumPair.charAt(0).toUpperCase() + cumPair.slice(1) + '.';
    } else {
      tone = 'enpf';
      title = 'По сумме ЕНПФ может дать больше; аннуитет — пожизненно';
      text = scAt + ' по сумме выплат впереди ЕНПФ' + (enpfLeadAges.length ? ' с ' + ageGen(enpfLeadAges[0]) : '') + ': ' + cumPair + '. ' + opening;
    }
    if (S.topUp > 0) {
      var tp = null;
      for (var i = 0; i < rows.length; i++) { var rr = rows[i]; if (rr.age >= ageNow && rr.slCumReal - cumE(rr.age) >= S.topUp) { tp = rr.age; break; } }
      text += ' В аннуитет входит и ваш взнос ' + kv('v.topup', S.topUp, 't', '', 'span') + ': ' +
        (tp != null ? 'разница в выплатах покрывает его ' + toYears(tp) + '.' : 'до ' + horizon + ' лет разница в выплатах его не покрывает.');
    }

    var adds = [];
    if (S.redemption > 0) adds.push('выкупная сумма ' + tenge(S.redemption));
    if (S.topUp > 0) adds.push('ваш взнос ' + tenge(S.topUp));
    var intro = 'Одни и те же накопления — ' + tenge(C.client.savingsTotal) +
      (adds.length ? ' (для аннуитета к ним ' + (adds.length > 1 ? 'добавляются ' : 'добавляется ') + adds.join(' и ') + ')' : '') +
      ' — и два пути. Цифры ЕНПФ — ровно те, что покажет калькулятор ЕНПФ на enpf.kz' + (fromCalc ? '' : ' (для пенсионного возраста — по формуле Правил выплат)') +
      ', в ценах 2026' + NB + 'г.; цифры аннуитета — по договору (калькулятор компании).';

    /* таблица по возрастам */
    var tabAges = [sStart, 60, eStart, 70, 80, 90].filter(function (a, i, arr) { return a >= ageNow && a <= horizon && byAge[a] && arr.indexOf(a) === i; })
      .sort(function (a, b) { return a - b; });
    var table = tabAges.map(function (a) {
      var r = byAge[a];
      return { age: a, year: r.year, enpfM: ex.monthlyAt(a), enpfLump: ex.lump && Math.abs(a - eStart) < 1e-9 ? ex.lumpAmount : 0, enpfCum: cumE(a),
               slM: r.slMonthlyReal, slMN: r.slMonthlyNominal, slCum: r.slCumReal, key: a === eStart || a === sStart };
    });

    /* наследование: по аннуитету — точные суммы договора; по ЕНПФ — без сумм (ЕНПФ их не показывает) */
    var inhAges = [ageNow, sStart, 60, eStart, 70, 75, 80].filter(function (a, i, arr) { return a >= ageNow && a <= horizon && byAge[a] && arr.indexOf(a) === i; })
      .sort(function (a, b) { return a - b; });
    var inherit = inhAges.map(function (a) { var r = byAge[a]; return { age: a, sl: r.slInheritable, now: a === ageNow }; });

    var monthNote = ex.lump
      ? 'ЕНПФ выплатит накопления одной суммой — ежемесячных выплат из ЕНПФ не будет; аннуитет платит каждый месяц пожизненно.'
      : (fromCalc ? 'ЕНПФ — как в калькуляторе ЕНПФ: постоянная выплата в ценах 2026' + NB + 'г., ' + years(eYears) + '.'
        : 'ЕНПФ — по формуле Правил выплат: постоянная выплата в ценах 2026' + NB + 'г., ' + years(eYears) + ' при доходности ЕНПФ на ' + pctNum(sc.real) + NB + '% выше инфляции (' + sc.label + ' сценарий).') +
        ' Аннуитет — выплаты по договору, пересчитанные в цены 2026' + NB + 'г. (наша оценка, см. «Как посчитано»).';

    var K = calcView.harmfulCoef || 1;
    /* источник цифр ЕНПФ: живой ответ ЕНПФ (агент нажал «Сверить с ЕНПФ») или копия методики */
    var kzView = S.enpfKszhView || {};
    var liveUsed = calcView.source === 'live';
    var diffs = (calcView.methodologyDiffs || []).concat(kzView.source === 'live' ? (kzView.methodologyDiffs || []) : []);
    var live = liveUsed && st.live && ymdOf(st.live.date) && (st.live.stamp || diffs.length)
      ? { date: st.live.date, dateText: dateRu(st.live.date), changed: diffs.length > 0,
          text: diffs.length ? 'Цифры ЕНПФ — из ответа калькулятора ЕНПФ (enpf.kz) ' + dateRu(st.live.date)
                             : 'Сверено с калькулятором ЕНПФ (enpf.kz) ' + dateRu(st.live.date) + ' — цифры ЕНПФ совпадают с расчётом' } : null;
    /* слепок того, что показывал ЕНПФ на дату расчёта: запросы и цифры (данные клиента в нём — те же, что уже есть в КП) */
    var rb = calcView.byScenario || {};
    var snapshot = {
      calcDate: C.calcDate, source: liveUsed ? 'enpf.kz (живой ответ)' : 'копия методики ЕНПФ', fetchedAt: liveUsed ? (calcView.liveFetchedAt || null) : null,
      methodologyVerifiedOn: root.EnpfLib && root.EnpfLib.ENPF_METHODOLOGY_VERIFIED_ON || null, methodologyChanged: diffs.length > 0,
      forecastRequest: calcView.liveBody || null,
      forecastShown: ['pessimist', 'realist', 'optimist'].reduce(function (o, k) {
        var b = rb[k]; if (b) o[k] = { opvMonthly: b.monthlyOPV, years: b.years, retirement: b.retirement || null, lumpSum: b.lumpSum }; return o; }, {}),
      annuityOffer: calcView.annuityOffer ? { ask: calcView.annuityOffer.ask, realist: calcView.annuityOffer.byScenario.realist.monthly } : null,
      kszhRequest: kzView.body || null, kszhShown: kzView.firstPayment != null ? { firstMonthPayment: kzView.firstPayment, insPremiumSumm: kzView.threshold, firstPeriod: kzView.firstPeriod, source: kzView.source } : null
    };

    /* калькуляторы аннуитета на enpf.kz: точные цифры ЕНПФ (номинал), и где ЕНПФ показывает больше — открыто */
    var kz = S.enpfKszhView && S.enpfKszhView.firstPayment != null ? S.enpfKszhView : null;
    var offer = calcView.annuityOffer && String(calcView.annuityOffer.ask) === '1' ? calcView.annuityOffer.byScenario[sc.key] : null;

    var notes = [];
    notes.push(fromCalc
      ? 'Цифры ЕНПФ — прогнозный калькулятор на enpf.kz на ' + calcDateText + ' (ввод — в блоке «Как проверить на enpf.kz»). ЕНПФ показывает суммы в ценах 2026' + NB + 'г. и постоянную выплату до исчерпания накоплений; в разные дни цифры ЕНПФ могут отличаться на несколько тенге.'
      : 'Прогнозный калькулятор ЕНПФ не считает тех, кто уже достиг пенсионного возраста. Выплата ЕНПФ здесь — по формуле Правил выплат (постановление Правительства РК №' + NB + '521): 6,5' + NB + '% накоплений в год' + (K !== 1 ? ' × ' + String(K).replace('.', ',') : '') + ', не меньше 70' + NB + '% прожиточного минимума (' + tenge(S.minPayment) + '); точный размер назначает ЕНПФ по заявлению.');
    notes.push('Если на enpf.kz указать свою зарплату, ЕНПФ добавит будущие пенсионные взносы — и покажет больше. Эти взносы и после перевода накоплений в аннуитет продолжают поступать в ЕНПФ и выплачиваются ЕНПФ отдельно — в обоих вариантах одинаково, поэтому в сравнение не входят. Базовая и солидарная пенсии и выплаты из ОПВР тоже одинаковы в обоих вариантах.');
    notes.push('Аннуитет — по договору: первая выплата ' + tenge(S.firstPayment) + ' ' + slStartText + ', дальше +' + pctNum(S.tariff.ind) + NB + '% каждый год (калькулятор компании «ПА калькулятор ' + esc(S.tariff.version || '') + '»). ' +
      'Чтобы сравнить с ЕНПФ в одних ценах, выплаты по договору пересчитаны в цены 2026' + NB + 'г. по инфляции ' + esc(A.inflationDescription) + ' — эти ставки ЕНПФ использует в своём калькуляторе аннуитета; это наша оценка, а не цифра ЕНПФ.');
    notes.push('«Получено к возрасту» — если дожить до этого возраста; для ЕНПФ — по таблице калькулятора ЕНПФ (12 выплат в каждом году). Возможный дивиденд в суммы не входит. Суммы — до налогов и удержаний; с выплат из ЕНПФ ИПН с 2026' + NB + 'г. не удерживается.');
    if (S.topUp > 0) notes.push('В аннуитет входит ваш взнос ' + tenge(S.topUp) + ' — в варианте «оставить в ЕНПФ» эти деньги остаются у вас и в суммы не входят.');
    if (S.redemption > 0) notes.push('Выкупная сумма ' + tenge(S.redemption) + ' из другой страховой компании в варианте ЕНПФ не учитывается.');
    if (C.client.category === 'inv1' || C.client.category === 'inv2' || C.client.harmful)
      notes.push('При инвалидности I или II группы и при ОППВ не меньше 84 месяцев ЕНПФ может платить раньше пенсионного возраста — калькулятор ЕНПФ этого не показывает, в сравнении это не учтено.');
    notes.push('Источники: прогнозный калькулятор и калькулятор аннуитета на enpf.kz (' + calcDateText + '), Социальный кодекс РК (ст.' + NB + '220, 222), Правила выплат из ЕНПФ (ПП РК №' + NB + '521), Методика АРРФР №' + NB + '45, калькулятор компании.');

    return {
      liveKey: liveKey, live: live, settings: st, scenarioLabel: sc.label, inflationText: A.inflationDescription, priceText: priceText, intro: intro,
      calcDateText: calcDateText, fromCalc: fromCalc,
      ageNow: ageNow, horizon: horizon, refAge: refAge, diff: diff, tone: tone, title: title, text: text,
      early: early, earlyText: earlyText,
      enpf: { start: eStart, startExact: eStartExact, startLabel: ageNum(eStartExact), startText: eStartText,
              startDate: calcView.retirementDate, startDateText: E.retired ? 'сейчас' : dateRu(calcView.retirementDate), retired: E.retired,
              lump: ex.lump, lumpReal: ex.lumpAmount, firstReal: ex.monthly, years: eYears, endExact: eEndExact,
              end: eEndExact == null ? null : Math.floor(eEndExact + 1e-9), endText: eRangeText, rangeText: eRangeText,
              pes: { monthly: X.pessimist.monthly, years: X.pessimist.years, lump: X.pessimist.lump, lumpAmount: X.pessimist.lumpAmount },
              opt: { monthly: X.optimist.monthly, years: X.optimist.years, lump: X.optimist.lump, lumpAmount: X.optimist.lumpAmount },
              K: K, siteInputs: calcView.siteInputs || [], source: calcView.source },
      sl: { start: sStart, startExact: sl0, startLabel: S.immediate ? String(sStart) : ageNum(sl0), startText: slStartText, startDateText: dateRu(S.startDate), startYear: ymdOf(S.startDate).y, immediate: S.immediate,
            firstReal: Mx.firstPayment.sl.real, firstNominal: S.firstPayment, ind: S.tariff.ind, gp: S.guaranteeYears, topUp: S.topUp, premium: S.premium,
            burial: S.burialBenefitMin, beforeStart: S.inheritanceBeforeStart },
      kszh: kz, offer: offer, snapshot: snapshot, liveUsed: liveUsed, methodologyDiffs: diffs,
      methodologyVerifiedOn: snapshot.methodologyVerifiedOn,
      table: table, inherit: inherit, series: series, x0: x0, notes: notes,
      monthNote: monthNote, kv: kv, mln: mlnText
    };
  }

  /* пенсионный возраст ЕНПФ клиента — как в калькуляторе ЕНПФ (у женщин растёт до 63 лет к 2031 г.) */
  function enpfRetirement(calc, client) {
    var L = root.EnpfLib, inp = calc.input || {};
    var dob = ymdOf(inp.dob);
    if (L && L.forecastRetirement && dob) {
      try {
        var p = inp.dob.split('-');
        var r = L.forecastRetirement(client.sex === 'мужской' ? 'M' : 'F', p[2] + '.' + p[1] + '.' + p[0]);
        var d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(r.date || '');
        if (isFinite(r.age) && d) return { exact: r.age, age: Math.floor(r.age + 1e-9), date: { y: +d[3], m: +d[2], d: +d[1] } };
      } catch (e) { /* без библиотеки — прежнее правило */ }
    }
    var a = enpfAge(client.sex);
    return { exact: a, age: a, date: dob ? addMonthsYmd(dob, 12 * a) : null };
  }

  /* дата через k месяцев (как EDATE: в коротком месяце — последний день) */
  function addMonthsYmd(x, k) {
    var i = x.m - 1 + k, y = x.y + Math.floor(i / 12), m = ((i % 12) + 12) % 12 + 1;
    return { y: y, m: m, d: Math.min(x.d, new Date(Date.UTC(y, m, 0)).getUTCDate()) };
  }
  function cmpYmd(a, b) { return (a.y - b.y) || (a.m - b.m) || (a.d - b.d); }

  /*
   * «Ранний старт» по датам — тот же срок, что в разделе «ЕНПФ или аннуитет»: от первой выплаты аннуитета
   * до даты начала выплат ЕНПФ. months — полных месяцев между датами, payments — выплат аннуитета до этой даты
   * (ежемесячно с даты начала), rows — годы договора с числом выплат в них (последний год может быть неполным).
   */
  function earlyPeriod(calc, enpfRet) {
    var B = ymdOf(calc.begin), E = enpfRet.date;
    if (!B || !E || cmpYmd(E, B) <= 0) return null;
    var months = (E.y - B.y) * 12 + (E.m - B.m) - (E.d < B.d ? 1 : 0);
    var payments = months + (cmpYmd(addMonthsYmd(B, months), E) < 0 ? 1 : 0);
    var rows = [], cum = 0;
    for (var k = 0; k * 12 < payments && k < calc.rows.length; k++) {
      var r = calc.rows[k], n = Math.min(12, payments - 12 * k);
      rows.push({ age: r.age, m: r.m, n: n, y: r.m * n });
      cum += r.m * n;
    }
    return { months: months, payments: payments, rows: rows, cum: cum };
  }

  function build(calc, client, agent, opts) {
    opts = opts || {};
    var R = calc.rows;                            // возраст → m, y, cum
    var byAge = {};
    R.forEach(function (r) { byAge[r.age] = r; });
    var first = calc.first, premium = calc.premium;
    var s0 = calc.startAgeInt, gp = calc.guarantee;
    var ind = calc.tariff.ind;
    var at = function (a) { return byAge[Math.min(Math.max(a, s0), R[R.length - 1].age)]; };

    /* окупаемость — первый возраст, к которому получено не меньше суммы перевода */
    var payback = null;
    for (var k = 0; k < R.length; k++) if (R[k].cum >= premium) { payback = R[k]; break; }

    var guarLast = gp > 0 ? at(s0 + gp - 1) : null;
    var afterGuar = s0 + gp;                       // первый год после гарантии (при старте в 55 и гарантии 15 лет — 70)
    var enpfRet = enpfRetirement(calc, client);    // тот же возраст, что в разделе «ЕНПФ или аннуитет»
    var enpf = enpfRet.age;
    var enpfBlock = enpfComparison(calc, client);
    /* ранний старт — по датам начала выплат (у женщин с дробным пенсионным возрастом и при немедленном старте —
       не целое число лет); тот же срок, что «на … раньше» в разделе «ЕНПФ или аннуитет» */
    var early = earlyPeriod(calc, enpfRet);
    var earlyYears = early ? early.months / 12 : 0;
    var earlyText = early ? durationText(early.months) : '';

    /* десятилетия от старта: 55–64, 65–74, … последнее — до 100 */
    var decades = [];
    for (var a = s0; a <= R[R.length - 1].age; a += 10) {
      var to = Math.min(a + 9, R[R.length - 1].age);
      var sum = 0;
      for (var q = a; q <= to; q++) sum += byAge[q].y;
      // сумма за десятилетие — разница накопленных, чтобы совпадало с итогом
      var cumTo = byAge[to].cum, cumFrom = a > s0 ? byAge[a - 1].cum : 0;
      decades.push({ from: a, to: to, sum: cumTo - cumFrom, count: (to - a + 1) * 12 });
    }

    var total100 = R[R.length - 1];
    var sexWord = client.sex === 'мужской' ? 'мужчина' : 'женщина';
    var fullName = String(client.name || '').trim();
    var nameGen = String(client.nameGen || '').trim() || genitiveName(fullName, client.sex);

    /* заголовок и вывод — по сценарию оплаты */
    var own = calc.savings + calc.redemption;
    var free = calc.mode === 'free';
    var scenario;
    if (free && calc.contribution === 0) scenario = 'no-topup';
    else if (calc.topup <= calc.threshold * 0.35) scenario = 'small-topup';
    else scenario = 'topup';

    /* ── производные для шаблона ── */
    var immediate = calc.deferral === 0;
    var startLabel = immediate ? years(s0) : ageLabel(calc.startAge);
    var startGen = immediate ? ageFrom(s0) : ageFrom(calc.startAge);
    var startNum = immediate ? String(s0) : ageNum(calc.startAge);
    var headline = scenario === 'no-topup' ? 'Доступен без доплаты'
      : scenario === 'small-topup' ? 'Доступен с небольшой доплатой' : 'Доступен с доплатой';
    var mid = s0 < 70 ? 70 : Math.min(80, total100.age);
    var late = s0 < 80 ? 80 : Math.min(90, total100.age);
    var hasGuar = gp > 0;
    var guarLastAge = hasGuar ? guarLast.age : s0 - 1;

    /* родительный падеж возраста: «после 61 года», «после 63 лет» */
    function genYears(n) { return n + ' ' + ((n % 10 === 1 && n % 100 !== 11) ? 'года' : 'лет'); }
    var NUMW = ['', 'Один год', 'Два года', 'Три года', 'Четыре года', 'Пять лет', 'Шесть лет', 'Семь лет',
                'Восемь лет', 'Девять лет', 'Десять лет', 'Одиннадцать лет', 'Двенадцать лет', 'Тринадцать лет',
                'Четырнадцать лет', 'Пятнадцать лет'];
    var earlyTitle = earlyYears > 0
      ? (early.months % 12 === 0 && NUMW[earlyYears] ? NUMW[earlyYears] : earlyText.charAt(0).toUpperCase() + earlyText.slice(1)) + ', ' +
        (early.months === 12 || early.months === 1 ? 'которого' : 'которых') + ' в ЕНПФ просто нет'
      : '';

    /* когда вернулись свои накопления (без доплаты) */
    var savingsBack = null;
    if (calc.savings > 0 && calc.savings < premium)
      for (var sb = 0; sb < R.length; sb++) if (R[sb].cum >= calc.savings) { savingsBack = R[sb]; break; }

    /* сумма для оформления = свои средства + взнос (доплата). Возможный дивиденд — не часть суммы и доплату
       не уменьшает (правило продукта от 06.10.2026): он показывается отдельно, как возможный бонус */
    var own2 = calc.savings + calc.redemption;
    var ownName = calc.redemption > 0 ? 'Накопления и выкупная сумма' : 'Накопления ЕНПФ';
    var pieParts = [
      { key: 'own', value: own2, grad: 'pieOwn', name: ownName, note: calc.redemption > 0 ? 'ЕНПФ и выкупная сумма КСЖ' : 'уже есть на счёте в ЕНПФ', short: calc.redemption > 0 ? 'накопления и выкупная сумма' : 'накопления ЕНПФ', aria: 'накопления' },
      free ? { key: 'top', value: calc.contribution, grad: 'pieTop', name: 'Ваш взнос', note: 'разовый взнос из своих средств', short: 'ваш взнос', aria: 'взнос' }
           : { key: 'top', value: calc.topup, grad: 'pieTop', name: 'Добровольная доплата', note: 'разовый взнос из своих средств', short: 'ваш взнос', aria: 'доплата' }];
    /* возможный дивиденд — отдельной строкой под диаграммой, не долей суммы */
    var divNote = calc.dividend > 0
      ? 'Возможный дивиденд — отдельно: до ' + pct(calc.dividendRate) + ' от суммы перевода, в вашем расчёте до ' + tenge(calc.dividend) +
        ', по решению компании. Он не гарантирован' +
        (free ? ' и в сумму перевода не входит.' : ', в сумму для оформления не входит и доплату не уменьшает — порог вносится полностью.')
      : '';

    var resultIntro = free
      ? 'Порог — ' + tenge(calc.threshold) + '. Ваших ' + (calc.contribution > 0 ? 'средств' : 'накоплений') + ' достаточно: в компанию переводится ' + tenge(premium) + '.'
      : 'Порог — ' + tenge(calc.threshold) + '. ' + (calc.redemption > 0 ? 'Своих средств' : 'Накоплений') + ' не хватает — остаётся внести ' + tenge(calc.topup) + '.';

    var metrics = free
      ? [{ label: 'Порог оформления', value: calc.threshold, note: 'минимальная сумма по нормативу' },
         { label: 'Своих накоплений', value: calc.savings, note: 'на счёте ЕНПФ; сумма переоценивается ежедневно' },
         { label: 'Сумма перевода', value: premium, note: 'вся сумма идёт в аннуитет', accent: true }]
      : [{ label: 'Нужно для оформления', value: calc.threshold, note: 'расчётный порог по нормативу' },
         { label: 'Своих накоплений', value: calc.savings, note: 'на счёте ЕНПФ; сумма переоценивается ежедневно' },
         { label: 'Остаётся внести', value: calc.topup, note: 'разовый взнос из своих средств', accent: true }];

    var growthAge = s0 < 80 ? 80 : total100.age;
    var facts = [
      immediate ? { big: 'сразу', text: 'выплаты начинаются после оформления' }
                : { big: years(calc.deferral), text: 'до первой выплаты: вам ' + calc.ageInt + ', выплаты с ' + dateRu(calc.begin) },
      { big: years(payback.age), text: 'возраст, когда выплаты вернут сумму перевода' },
      { big: 'от ' + tenge(first), num: true, text: 'первая выплата в месяц, дальше растёт' },
      { big: times(at(growthAge).m / first), text: 'во столько раз вырастет выплата ' + toYears(growthAge) },
      hasGuar ? { big: tenge(guarLast.cum), num: true, text: 'выплаты за ' + years(gp) + ' гарантийного периода' }
              : { big: tenge(at(Math.min(s0 + 9, total100.age)).cum), num: true, text: 'выплаты за первые 10 лет' },
      calc.topup > 0 ? { big: tenge(calc.topup), num: true, accent: true, text: 'ваш разовый взнос для оформления' }
                     : { big: tenge(premium), num: true, accent: true, text: 'сумма перевода в компанию' }
    ];

    var cD0 = ymdOf(calc.calcDate || client.calcDate), bD0 = ymdOf(calc.begin) || cD0;
    var yearAt = function (a) { return a >= s0 ? bD0.y + (a - s0) : cD0.y + (a - calc.ageInt); };
    var points = [];
    if (immediate) points.push({ age: calc.ageInt, year: cD0.y, now: true, title: 'Сегодня — первая выплата', text: 'от ' + tenge(first) + ' в месяц сразу после оформления' });
    else {
      points.push({ age: calc.ageInt, year: cD0.y, now: true, title: 'Сегодня — вы здесь', text: 'расчёт подготовлен, выплат ещё нет' });
      points.push({ age: s0, year: bD0.y, title: 'Первая выплата', text: dateRu(calc.begin) + ' — от ' + tenge(first) + ' в месяц' });
    }
    points.push({ age: payback.age, year: yearAt(payback.age), title: 'Сумма перевода вернулась', text: 'получено ' + tenge(payback.cum) + ' — больше, чем переведено' });
    if (hasGuar) points.push({ age: afterGuar, year: yearAt(afterGuar), title: 'Гарантия завершена', text: tenge(at(afterGuar).m) + ' в месяц, выплаты продолжаются' });
    points.sort(function (a, b) { return a.age - b.age; });
    points.push({ inf: true, title: 'Пожизненно', text: 'КСЖ платит, пока действует договор' });

    var perks = [
      earlyYears > 0
        ? { icon: 'clock', big: immediate ? 'сразу' : 'с ' + startGen, title: 'Выплаты раньше на ' + earlyText, note: tenge(early.cum) + ' придёт за ' + (early.months < 12 ? 'это время' : 'эти годы') }
        : { icon: 'clock', big: immediate ? 'сразу' : 'с ' + startGen, title: 'Выплаты без ожидания', note: 'первая выплата — ' + tenge(first) },
      { icon: 'inf', big: 'пожизненно', title: 'Выплаты не заканчиваются', note: 'после ' + genYears(payback.age) + ' договор продолжает действовать' },
      { icon: 'trend', big: '+' + pct(ind), title: 'Индексация каждый год', note: tenge(first) + ' → ' + tenge(at(late).m) + ' ' + toYears(late) },
      hasGuar ? { icon: 'shield', big: years(gp), title: 'Гарантийный период', note: 'выплаты сохраняются за близкими' }
              : { icon: 'shield', big: times(total100.cum / premium), title: 'Возврат перевода', note: 'во столько раз больше вернётся ' + toYears(total100.age) },
      isFinite(calc.tariff.i) && calc.tariff.i > 0
        ? { icon: 'lock', big: pct(calc.tariff.i), title: 'Фиксированная доходность', note: 'ставка закреплена в договоре — рынок на выплаты не влияет' }
        : { icon: 'home', big: 'ФГСВ', title: 'Защита по закону', note: 'если компания лишится лицензии' },
      { icon: 'pct', big: 'до ' + pct(calc.dividendRate), title: 'Возможный дивиденд', note: 'в вашем расчёте до ' + tenge(calc.dividend) + ' — по решению компании, отдельно от суммы перевода' }
    ];

    var mt = [{ age: s0, what: 'первая выплата' }];
    if (savingsBack && savingsBack.age > s0 && savingsBack.age < payback.age) mt.push({ age: savingsBack.age, what: 'вернулись ваши накопления' });
    if (payback.age > s0) mt.push({ age: payback.age, what: 'сумма перевода вернулась', key: true });
    else mt[0].key = true, mt[0].what = 'первая выплата · сумма перевода вернулась';
    if (hasGuar && afterGuar > payback.age && afterGuar <= total100.age) mt.push({ age: afterGuar, what: 'гарантия завершена' });
    else if (payback.age + 5 <= total100.age) mt.push({ age: payback.age + 5, what: 'выплаты продолжаются' });
    var minitab = mt.map(function (r) { var d = at(r.age); return { age: r.age, m: d.m, cum: d.cum, what: r.what, key: r.key }; });

    var cmpAges = [60, 70, 80, 90, 100].filter(function (a) { return a > s0 && a <= total100.age; });
    if (cmpAges.length < 3) cmpAges = [s0 + 2, s0 + 5].concat(cmpAges).filter(function (a, i, arr) { return a <= total100.age && arr.indexOf(a) === i; });

    var slotAges = [s0];
    if (s0 < 60 && 60 < payback.age) slotAges.push(60);
    slotAges.push(payback.age);
    if (hasGuar) slotAges.push(afterGuar);
    [80, 90, 100].forEach(function (a) { slotAges.push(a); });
    slotAges = slotAges.filter(function (a, i, arr) { return a >= s0 && a <= total100.age && arr.indexOf(a) === i; })
      .sort(function (a, b) { return a - b; }).slice(0, 8);
    var span = total100.age - s0;
    var scaleAges = [s0, Math.round(s0 + span / 3), Math.round(s0 + 2 * span / 3), total100.age];

    function slotTitle(a) {
      if (a === s0) return 'первая выплата';
      if (a === payback.age) return 'сумма перевода вернулась';
      if (hasGuar && a === afterGuar) return 'гарантийный период завершён';
      if (a < payback.age) return years(a - s0) + ' выплат';
      return 'выплаты продолжаются';
    }
    function ageHint(a) {
      var d = at(a);
      if (a < payback.age) return 'до возврата суммы перевода остаётся ' + money(premium - d.cum) + NB + '₸';
      if (a === payback.age) return 'возраст, в котором суммарные выплаты возвращают сумму перевода';
      if (hasGuar && a <= guarLastAge) return 'гарантийный период · выплаты продолжаются пожизненно';
      return (hasGuar ? 'после гарантийного периода · ' : '') + 'выплаты продолжаются пожизненно';
    }
    function barTip(a) {
      var lines = ['Получено ' + toYears(a) + ' — ' + money(at(a).cum) + NB + '₸', 'Складывается из ежемесячных выплат:'];
      for (var q = s0; q <= a; q += 5) lines.push('  ' + years(q) + ' — по ' + money(at(q).m) + NB + '₸ в месяц');
      lines.push('Каждый год выплата растёт на ' + pct(ind));
      return lines.join('\n');
    }

    var keyAges = [s0, payback.age].concat(hasGuar ? [afterGuar] : []).concat([80, 90, total100.age])
      .filter(function (a, i, arr) { return a >= s0 && a <= total100.age && arr.indexOf(a) === i; });
    var last = decades[decades.length - 1];

    /* ── из калькулятора: даты, ожидание, выкупная сумма, варианты гарантии ── */
    var calcD = ymdOf(calc.calcDate || client.calcDate), beginD = ymdOf(calc.begin) || calcD;
    var monthYear = function (D) { return D ? MONTHS_NOM[D.m - 1] + ' ' + D.y + ' г.' : ''; };      // «март 2034 г.»
    var inMonth = function (D) { return D ? 'в ' + MONTHS_PREP[D.m - 1] + ' ' + D.y + ' г.' : ''; }; // «в марте 2034 г.»
    var waitMonths = calcD && beginD ? Math.max(0, (beginD.y - calcD.y) * 12 + (beginD.m - calcD.m) - (beginD.d < calcD.d ? 1 : 0)) : 0;
    var wy = Math.floor(waitMonths / 12), wm = waitMonths % 12;
    var waitText = (wy ? years(wy) : '') + (wy && wm ? ' ' : '') + (wm ? wm + ' ' + monthsWord(wm) : '');
    /* календарный год строки: у выплат — год начала этого года выплат, до старта — год возраста */
    function yearOf(a) { return a >= s0 ? beginD.y + (a - s0) : calcD.y + (a - calc.ageInt); }

    /* пока клиент ждёт старта, выплата индексируется: на дату заключения → к первой выплате */
    var payNow = calc.payAtSigning || 0, stairs = [];
    if (!immediate && payNow > 0 && calc.deferral > 0)
      for (var sk = 0; sk <= calc.deferral; sk++)
        stairs.push({ age: calc.ageInt + sk, year: calcD.y + sk, v: sk === calc.deferral ? first : Math.round(payNow * Math.pow(1 + ind, sk)) });
    var waitGrowth = payNow > 0 ? first / payNow - 1 : 0;

    /* где деньги год за годом: получено выплатами и выкупная сумма (остаток в договоре) */
    var gamma = calc.tariff && isFinite(calc.tariff.gamma) ? calc.tariff.gamma : 0.03;
    var surrBase = calc.surrBase || 0, zeroRow = null;
    for (var zr = 0; zr < R.length; zr++) if (R[zr].surr === 0) { zeroRow = R[zr]; break; }
    var moneyTo = Math.min(total100.age, Math.max(payback.age + 2, zeroRow ? zeroRow.age + 1 : 0, s0 + 2));
    var moneyFrom = Math.max(calc.ageInt, moneyTo - 25);
    var flow = [];
    for (var ma = moneyFrom; ma <= moneyTo; ma++) {
      var pre = ma < s0, mr = pre ? null : at(ma);
      var recv = pre ? 0 : mr.cum;
      var sv = pre ? (ma - calc.ageInt >= 2 ? surrBase : null) : mr.surr;
      flow.push({ age: ma, year: yearOf(ma), recv: recv, surr: sv, lock: sv === null, m: pre ? 0 : mr.m,
                   would: sv !== null ? sv : Math.max(0, Math.round(surrBase - (1 + gamma) * recv)) });
    }
    var flowMax = Math.max(premium, flow[flow.length - 1].recv, surrBase);
    /* первая доступная выкупная сумма: до старта выплат — вся (перевод минус расходы), иначе уже за вычетом выплат */
    var sfD = ymdOf(calc.surrFrom), surrFirst = surrBase;
    if (!sfD || !beginD || (sfD.y * 10000 + sfD.m * 100 + sfD.d) >= (beginD.y * 10000 + beginD.m * 100 + beginD.d))
      for (var sr = 0; sr < R.length; sr++) if (R[sr].surr !== null && R[sr].surr !== undefined) { surrFirst = R[sr].surr; break; }

    /* варианты гарантийного периода: при своей сумме меняется выплата, при оформлении по порогу — порог */
    var alts = (calc.alts || []).map(function (a) { return { gp: a.gp, value: free ? a.first : a.threshold, cur: a.gp === gp }; });
    /* пороги по категориям калькулятора — тот же возраст и гарантия; метка — свои накопления */
    var cats = (calc.cats || []).map(function (c) {
      var ci = catInfo(c.name);
      return { name: c.name, label: ci.label, hint: ci.hint, kind: ci.kind, threshold: c.threshold, own: c.own,
               from: c.deferral === 0 ? 'выплаты сразу' : 'выплаты с ' + ageFrom(c.start), first: c.first, topup: c.topup,
               enough: c.own ? free : c.first != null };
    });
    var catOwn = cats.filter(function (c) { return c.own; })[0] || null;
    /* у клиента с инвалидностью другие группы — не выбор: сравниваем только со стандартом */
    if (catOwn && catOwn.kind === 'inv') cats = cats.filter(function (c) { return c.own || c.kind === 'std'; });
    var catStd = cats.filter(function (c) { return c.kind === 'std'; })[0] || null;
    if (cats.length < 2 || !catOwn) cats = [];
    var catMin = cats.length ? Math.min.apply(null, cats.map(function (c) { return c.threshold; })) : 0;
    var minimal = calc.minimal && calc.minimal.rest > 0 ? calc.minimal : null;

    var digits = function (v) { return String(v || '').replace(/\D/g, ''); };
    var waDigits = digits(agent.whatsapp || agent.phone);
    if (waDigits.length === 11 && waDigits.charAt(0) === '8') waDigits = '7' + waDigits.slice(1);
    var telDigits = digits(agent.phone);
    if (telDigits.length === 11 && telDigits.charAt(0) === '8') telDigits = '7' + telDigits.slice(1);

    return {
      calc: calc, client: client, agent: agent,
      headline: headline, immediate: immediate, startLabel: startLabel, startGen: startGen, startNum: startNum,
      startFrom: immediate ? 'сразу после оформления' : 'с ' + startGen,
      mid: mid, late: late, resultIntro: resultIntro, pieParts: pieParts, divNote: divNote, metrics: metrics,
      facts: facts, points: points, perks: perks, earlyTitle: earlyTitle, minitab: minitab,
      cmpAges: cmpAges, slotAges: slotAges, scaleAges: scaleAges,
      slotTitle: slotTitle, ageHint: ageHint, barTip: barTip, genYears: genYears,
      rowsWord: function (n) { var t = n % 100, o = n % 10; return (t > 10 && t < 20) ? 'строк' : o === 1 ? 'строка' : (o >= 2 && o <= 4) ? 'строки' : 'строк'; },
      lastDecadeAvg: Math.round(last.sum / last.count), lastDecadeLabel: 'в ' + last.from + '–' + last.to + ' лет',
      agentWa: waDigits, agentTel: telDigits ? '+' + telDigits : '', agentFem: agent.sex === 'женский',
      waSame: !!waDigits && waDigits === telDigits,
      agentWaText: agent.whatsapp || agent.phone || '',
      waLink: function (text) { return 'https://wa.me/' + waDigits + '?text=' + encodeURIComponent(text); },
      askList: [
        { title: 'Хочу официальный расчёт КСЖ', msg: 'Здравствуйте! Прошу официальный расчёт КСЖ' },
        { title: 'Какие документы нужны', msg: 'Здравствуйте! Какие документы нужны для оформления?' },
        { title: 'Можно оформить на двоих', msg: 'Здравствуйте! Можно ли оформить договор на двоих?' },
        { title: 'Пересчитайте на другой возраст', msg: 'Здравствуйте! Пересчитайте, пожалуйста, на другой возраст начала выплат' }
      ],
      cfg: { data: R.map(function (r) { return { age: r.age, m: r.m, y: r.y, cum: r.cum }; }),
             transfer: premium, payback: payback.age, guarLast: guarLastAge, start: s0,
             end: total100.age, keyAges: keyAges,
             /* «ЕНПФ или аннуитет»: возраст, аннуитет и ЕНПФ в месяц, получено всего (сегодняшние деньги), в месяц в тенге того года */
             enpf: enpfBlock.view ? enpfBlock.view.series.map(function (r) {
               return [r.age, Math.round(r.s), Math.round(r.e), Math.round(r.sc), Math.round(r.ec), Math.round(r.sn), 0, r.lump ? 1 : 0];   // [6] — номинал ЕНПФ не показываем (ЕНПФ его не считает)
             }) : null },
      /* форматтеры — нужны шаблону */
      money: money, moneyH: moneyH, tenge: tenge, times: times, pct: pct,
      years: years, yearsWord: yearsWord, toYears: toYears, ageLabel: ageLabel, ageNum: ageNum, esc: esc,
      /* клиент */
      name: fullName, nameGen: nameGen, initials: initials(fullName),
      sexWord: sexWord, sexWordCap: sexWord.charAt(0).toUpperCase() + sexWord.slice(1),
      age: calc.ageInt, city: client.city || '', dateText: dateRu(client.calcDate),
      /* агент */
      agentName: agent.name || '', agentPhone: agent.phone || '', agentEmail: agent.email || '',
      agentCity: agent.city || client.city || '',
      /* расчёт */
      first: first, premium: premium, threshold: calc.threshold, savings: calc.savings,
      redemption: calc.redemption, dividend: calc.dividend, dividendRate: calc.dividendRate,
      topup: calc.topup, contribution: calc.contribution,
      start: calc.startAge, s0: s0, gp: gp, indPct: pctNum(ind), minPayPct: pctNum(Math.round((calc.tariff.minPayShare || 0.7) * 1000) / 1000), deferral: calc.deferral,
      scenario: scenario, rows: R, at: at, payback: payback,
      guarLast: guarLast, afterGuar: afterGuar, enpf: enpf, enpfGen: ageGen(enpfRet.exact), earlyYears: earlyYears, earlyText: earlyText, early: early,
      /* «ЕНПФ или аннуитет»: данные раздела (null — блока нет) и состояние для генератора */
      enpfCmp: enpfBlock.view || null, enpfStatus: { status: enpfBlock.status, message: enpfBlock.message || '' },
      decades: decades, total: total100, horizon: total100.age,
      growth80: at(80).m / first,
      /* порог через год: возраст — по калькулятору, ПМ — ориентир +10% */
      thresholdNext: Math.round((calc.next ? calc.next.threshold : calc.threshold) * 1.1),
      /* данные калькулятора */
      calcVersion: calc.tariff && calc.tariff.version || '', pm: calc.tariff && calc.tariff.pm, minPay: calc.minPay,
      nax: calc.nax, pmYear: calcD ? calcD.y : '', free: free,
      beginText: dateRu(calc.begin), beginMonth: monthYear(beginD), beginIn: inMonth(beginD), beginYear: beginD ? beginD.y : '',
      calcYear: calcD ? calcD.y : '', waitText: waitText, yearOf: yearOf,
      payNow: payNow, waitGrowth: waitGrowth, stairs: stairs,
      surrBase: surrBase, surrFirst: surrFirst, surrFromText: dateRu(calc.surrFrom),
      beginIndexIn: beginD ? 'каждый год в ' + MONTHS_PREP[beginD.m - 1] : 'каждый год', surrFromMonth: monthYear(ymdOf(calc.surrFrom)),
      zeroRow: zeroRow, flow: flow, flowMax: flowMax, alts: alts,
      cats: cats, catOwn: catOwn, catStd: catStd, catMin: catMin, minimal: minimal,
      /* с чем сравниваем пороги категорий: при своей сумме — вся сумма перевода, иначе — свои накопления */
      catMoney: free ? premium : own, catMoneyName: free && calc.contribution > 0 ? 'сумма перевода' : 'ваши накопления',
      pctNum: pctNum, monthsWord: monthsWord
    };
  }

  var api = { build: build, money: money, moneyH: moneyH, tenge: tenge, times: times, pct: pct,
              years: years, yearsWord: yearsWord, toYears: toYears, genitiveName: genitiveName,
              initials: initials, dateRu: dateRu, ageLabel: ageLabel, esc: esc,
              enpfComparison: enpfComparison, enpfSettings: enpfSettings, ENPF_PRESETS: ENPF_PRESETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportModel = api;
})(this);
