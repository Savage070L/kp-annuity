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
  function pct(v) { return Math.round(v * 100) + '%'; }

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
  function ageNum(a) {
    return Math.abs(a - Math.round(a)) < 1e-9 ? String(Math.round(a)) : String(Math.round(a * 10) / 10).replace('.', ',');
  }
  function dateRu(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return '';
    return (+m[3]) + ' ' + MONTHS_GEN[+m[2] - 1] + ' ' + m[1];
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

  /* Пенсионный возраст ЕНПФ для блока «Ранний старт»: мужчины 63, женщины 61 */
  function enpfAge(sex) { return sex === 'мужской' ? 63 : 61; }

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
    var enpf = enpfAge(client.sex);
    var earlyYears = Math.max(0, enpf - s0);
    var early = earlyYears > 0 ? at(enpf - 1) : null;

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
    var startNum = immediate ? String(s0) : ageNum(calc.startAge);
    var headline = scenario === 'no-topup' ? 'Доступен без доплаты'
      : scenario === 'small-topup' ? 'Доступен с небольшой доплатой' : 'Доступен с доплатой';
    var mid = s0 < 70 ? 70 : Math.min(80, total100.age);
    var late = s0 < 80 ? 80 : Math.min(90, total100.age);
    var hasGuar = gp > 0;
    var guarLastAge = hasGuar ? guarLast.age : s0 - 1;
    var pbTo = Math.min(total100.age, Math.max((payback ? payback.age : s0) + 3, hasGuar ? afterGuar : 0, s0 + 10));

    /* родительный падеж возраста: «после 61 года», «после 63 лет» */
    function genYears(n) { return n + ' ' + ((n % 10 === 1 && n % 100 !== 11) ? 'года' : 'лет'); }
    var NUMW = ['', 'Один год', 'Два года', 'Три года', 'Четыре года', 'Пять лет', 'Шесть лет', 'Семь лет',
                'Восемь лет', 'Девять лет', 'Десять лет', 'Одиннадцать лет', 'Двенадцать лет', 'Тринадцать лет',
                'Четырнадцать лет', 'Пятнадцать лет'];
    var earlyTitle = earlyYears > 0
      ? (NUMW[earlyYears] || years(earlyYears)) + ', ' + (earlyYears === 1 ? 'которого' : 'которых') + ' в ЕНПФ просто нет'
      : '';

    /* когда вернулись свои накопления (без доплаты и дивиденда) */
    var savingsBack = null;
    if (calc.savings > 0 && calc.savings < premium)
      for (var sb = 0; sb < R.length; sb++) if (R[sb].cum >= calc.savings) { savingsBack = R[sb]; break; }

    var own2 = calc.savings + calc.redemption;
    var ownName = calc.redemption > 0 ? 'Накопления и выкупная сумма' : 'Накопления ЕНПФ';
    var pieParts = free
      ? [{ key: 'own', value: own2, grad: 'pieOwn', name: ownName, note: calc.redemption > 0 ? 'ЕНПФ и выкупная сумма КСЖ' : 'уже есть на счёте в ЕНПФ', short: calc.redemption > 0 ? 'накопления и выкупная сумма' : 'накопления ЕНПФ', aria: 'накопления' },
         { key: 'top', value: calc.contribution, grad: 'pieTop', name: 'Ваш взнос', note: 'разовый взнос из своих средств', short: 'ваш взнос', aria: 'взнос' }]
      : [{ key: 'own', value: own2, grad: 'pieOwn', name: ownName, note: calc.redemption > 0 ? 'ЕНПФ и выкупная сумма КСЖ' : 'уже есть на счёте в ЕНПФ', short: calc.redemption > 0 ? 'накопления и выкупная сумма' : 'накопления ЕНПФ', aria: 'накопления' },
         { key: 'div', value: calc.dividend, grad: 'pieDiv', name: 'Возможный дивиденд', note: 'до ' + pct(calc.dividendRate) + ' от суммы перевода, по решению компании', short: 'возможный дивиденд', aria: 'дивиденд' },
         { key: 'top', value: calc.topup, grad: 'pieTop', name: 'Добровольная доплата', note: 'разовый взнос из своих средств', short: 'ваш взнос', aria: 'доплата' }];

    var resultIntro = free
      ? 'Порог — ' + tenge(calc.threshold) + '. Ваших ' + (calc.contribution > 0 ? 'средств' : 'накоплений') + ' достаточно: в компанию переводится ' + tenge(premium) + '.'
      : 'Порог — ' + tenge(calc.threshold) + '. Накоплений не хватает' + (calc.dividend > 0 ? ', но после дивиденда остаётся внести ' : ' — остаётся внести ') + tenge(calc.topup) + '.';

    var metrics = free
      ? [{ label: 'Порог оформления', value: calc.threshold, note: 'минимальная сумма по нормативу' },
         { label: 'Своих накоплений', value: calc.savings, note: 'на счёте ЕНПФ; сумма переоценивается ежедневно' },
         { label: 'Сумма перевода', value: premium, note: 'вся сумма идёт в аннуитет', accent: true }]
      : [{ label: 'Нужно для оформления', value: calc.threshold, note: 'расчётный порог по нормативу' },
         { label: 'Своих накоплений', value: calc.savings, note: 'на счёте ЕНПФ; сумма переоценивается ежедневно' },
         { label: 'Остаётся внести', value: calc.topup, note: calc.dividend > 0 ? 'разовый взнос после зачёта дивиденда' : 'разовый взнос из своих средств', accent: true }];

    var growthAge = s0 < 80 ? 80 : total100.age;
    var facts = [
      immediate ? { big: 'сразу', text: 'выплаты начинаются после оформления' }
                : { big: years(calc.deferral), text: 'ждать до первой выплаты: вам ' + calc.ageInt + ', старт в ' + startNum },
      { big: years(payback.age), text: 'возраст, когда выплаты вернут сумму перевода' },
      { big: 'от ' + tenge(first), num: true, text: 'первая выплата в месяц, дальше растёт' },
      { big: times(at(growthAge).m / first), text: 'во столько раз вырастет выплата ' + toYears(growthAge) },
      hasGuar ? { big: tenge(guarLast.cum), num: true, text: 'выплаты за ' + years(gp) + ' гарантийного периода' }
              : { big: tenge(at(Math.min(s0 + 9, total100.age)).cum), num: true, text: 'выплаты за первые 10 лет' },
      calc.topup > 0 ? { big: tenge(calc.topup), num: true, accent: true, text: 'ваш разовый взнос для оформления' }
                     : { big: tenge(premium), num: true, accent: true, text: 'сумма перевода в компанию' }
    ];

    var points = [];
    if (immediate) points.push({ age: calc.ageInt, now: true, title: 'Сегодня — первая выплата', text: 'от ' + tenge(first) + ' в месяц сразу после оформления' });
    else {
      points.push({ age: calc.ageInt, now: true, title: 'Сегодня — вы здесь', text: 'расчёт подготовлен, выплат ещё нет' });
      points.push({ age: s0, title: 'Первая выплата', text: 'от ' + tenge(first) + ' в месяц, дальше +' + Math.round(ind * 100) + '% каждый год' });
    }
    points.push({ age: payback.age, title: 'Сумма перевода вернулась', text: 'получено ' + tenge(payback.cum) + ' — больше, чем переведено' });
    if (hasGuar) points.push({ age: afterGuar, title: 'Гарантия завершена', text: tenge(at(afterGuar).m) + ' в месяц, выплаты продолжаются' });
    points.sort(function (a, b) { return a.age - b.age; });
    points.push({ inf: true, title: 'Пожизненно', text: 'КСЖ платит, пока действует договор' });

    var perks = [
      earlyYears > 0
        ? { icon: 'clock', big: 'с ' + startLabel, title: 'Выплаты раньше на ' + years(earlyYears), note: tenge(early.cum) + ' придёт за эти годы' }
        : { icon: 'clock', big: immediate ? 'сразу' : 'с ' + startLabel, title: 'Выплаты без ожидания', note: 'первая выплата — ' + tenge(first) },
      { icon: 'inf', big: 'пожизненно', title: 'Выплаты не заканчиваются', note: 'после ' + genYears(payback.age) + ' договор продолжает действовать' },
      { icon: 'trend', big: '+' + Math.round(ind * 100) + '%', title: 'Индексация каждый год', note: tenge(first) + ' → ' + tenge(at(late).m) + ' ' + toYears(late) },
      hasGuar ? { icon: 'shield', big: years(gp), title: 'Гарантийный период', note: 'выплаты сохраняются за близкими' }
              : { icon: 'shield', big: times(total100.cum / premium), title: 'Возврат перевода', note: 'во столько раз больше вернётся ' + toYears(total100.age) },
      { icon: 'home', big: 'ФГСВ', title: 'Защита по закону', note: 'если компания лишится лицензии' },
      { icon: 'pct', big: 'до ' + pct(calc.dividendRate), title: 'Возможный дивиденд', note: 'в вашем расчёте ' + tenge(calc.dividend) }
    ];

    var mt = [{ age: s0, what: 'первая выплата' }];
    if (savingsBack && savingsBack.age > s0 && savingsBack.age < payback.age) mt.push({ age: savingsBack.age, what: 'вернулись ваши накопления' });
    if (payback.age > s0) mt.push({ age: payback.age, what: 'сумма перевода вернулась', key: true });
    else mt[0].key = true, mt[0].what = 'первая выплата · сумма перевода вернулась';
    if (hasGuar && afterGuar > payback.age && afterGuar <= total100.age) mt.push({ age: afterGuar, what: 'гарантия завершена' });
    else if (payback.age + 5 <= total100.age) mt.push({ age: payback.age + 5, what: 'выплаты продолжаются' });
    var minitab = mt.map(function (r) { var d = at(r.age); return { age: r.age, m: d.m, cum: d.cum, what: r.what, key: r.key }; });

    var multAges = [70, 80, 90, 100].filter(function (a) { return a > payback.age && a <= total100.age; }).slice(0, 3);
    var mults = multAges.map(function (a) { return { age: a, x: at(a).cum / premium }; });
    var mileAges = [70, 80, 90, 100].filter(function (a) { return a > s0 && a <= total100.age; });
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
      lines.push('Каждый год выплата растёт на ' + Math.round(ind * 100) + '%');
      return lines.join('\n');
    }

    var keyAges = [s0, payback.age].concat(hasGuar ? [afterGuar] : []).concat([80, 90, total100.age])
      .filter(function (a, i, arr) { return a >= s0 && a <= total100.age && arr.indexOf(a) === i; });
    var last = decades[decades.length - 1];

    var digits = function (v) { return String(v || '').replace(/\D/g, ''); };
    var waDigits = digits(agent.whatsapp || agent.phone);
    if (waDigits.length === 11 && waDigits.charAt(0) === '8') waDigits = '7' + waDigits.slice(1);
    var telDigits = digits(agent.phone);
    if (telDigits.length === 11 && telDigits.charAt(0) === '8') telDigits = '7' + telDigits.slice(1);

    return {
      calc: calc, client: client, agent: agent,
      headline: headline, immediate: immediate, startLabel: startLabel, startNum: startNum,
      startFrom: immediate ? 'сразу после оформления' : 'с ' + startLabel,
      mid: mid, late: late, pbTo: pbTo, resultIntro: resultIntro, pieParts: pieParts, metrics: metrics,
      facts: facts, points: points, perks: perks, earlyTitle: earlyTitle, minitab: minitab, mults: mults,
      mileAges: mileAges, cmpAges: cmpAges, slotAges: slotAges, scaleAges: scaleAges,
      slotTitle: slotTitle, ageHint: ageHint, barTip: barTip, genYears: genYears,
      rowsWord: function (n) { var t = n % 100, o = n % 10; return (t > 10 && t < 20) ? 'строк' : o === 1 ? 'строка' : (o >= 2 && o <= 4) ? 'строки' : 'строк'; },
      lastDecadeAvg: Math.round(last.sum / last.count), lastDecadeLabel: 'в ' + last.from + '–' + last.to + ' лет',
      agentWa: waDigits, agentTel: telDigits ? '+' + telDigits : '', agentFem: agent.sex === 'женский',
      cfg: { data: R.map(function (r) { return { age: r.age, m: r.m, y: r.y, cum: r.cum }; }),
             transfer: premium, payback: payback.age, guarLast: guarLastAge, start: s0,
             end: total100.age, pbTo: pbTo, keyAges: keyAges },
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
      start: calc.startAge, s0: s0, gp: gp, indPct: Math.round(ind * 100), deferral: calc.deferral,
      scenario: scenario, rows: R, at: at, payback: payback,
      guarLast: guarLast, afterGuar: afterGuar, enpf: enpf, earlyYears: earlyYears, early: early,
      decades: decades, total: total100, horizon: total100.age,
      growth80: at(80).m / first,
      thresholdNext: Math.round(calc.threshold * 1.1)
    };
  }

  var api = { build: build, money: money, moneyH: moneyH, tenge: tenge, times: times, pct: pct,
              years: years, yearsWord: yearsWord, toYears: toYears, genitiveName: genitiveName,
              initials: initials, dateRu: dateRu, ageLabel: ageLabel, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportModel = api;
})(this);
