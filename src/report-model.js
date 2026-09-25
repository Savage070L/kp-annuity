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
        ? { icon: 'clock', big: 'с ' + startGen, title: 'Выплаты раньше на ' + years(earlyYears), note: tenge(early.cum) + ' придёт за эти годы' }
        : { icon: 'clock', big: immediate ? 'сразу' : 'с ' + startGen, title: 'Выплаты без ожидания', note: 'первая выплата — ' + tenge(first) },
      { icon: 'inf', big: 'пожизненно', title: 'Выплаты не заканчиваются', note: 'после ' + genYears(payback.age) + ' договор продолжает действовать' },
      { icon: 'trend', big: '+' + pct(ind), title: 'Индексация каждый год', note: tenge(first) + ' → ' + tenge(at(late).m) + ' ' + toYears(late) },
      hasGuar ? { icon: 'shield', big: years(gp), title: 'Гарантийный период', note: 'выплаты сохраняются за близкими' }
              : { icon: 'shield', big: times(total100.cum / premium), title: 'Возврат перевода', note: 'во столько раз больше вернётся ' + toYears(total100.age) },
      isFinite(calc.tariff.i) && calc.tariff.i > 0
        ? { icon: 'lock', big: pct(calc.tariff.i), title: 'Фиксированная доходность', note: 'ставка закреплена в договоре — рынок на выплаты не влияет' }
        : { icon: 'home', big: 'ФГСВ', title: 'Защита по закону', note: 'если компания лишится лицензии' },
      { icon: 'pct', big: 'до ' + pct(calc.dividendRate), title: 'Возможный дивиденд', note: 'в вашем расчёте ' + tenge(calc.dividend) }
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
               viaDiv: c.mode === 'threshold' && !(c.topup > 0), enough: c.own ? free : c.first != null };
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
      mid: mid, late: late, resultIntro: resultIntro, pieParts: pieParts, metrics: metrics,
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
             end: total100.age, keyAges: keyAges },
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
      guarLast: guarLast, afterGuar: afterGuar, enpf: enpf, earlyYears: earlyYears, early: early,
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
      ratePct: isFinite(calc.tariff.i) ? pctNum(calc.tariff.i) : '',
      pctNum: pctNum, monthsWord: monthsWord
    };
  }

  var api = { build: build, money: money, moneyH: moneyH, tenge: tenge, times: times, pct: pct,
              years: years, yearsWord: yearsWord, toYears: toYears, genitiveName: genitiveName,
              initials: initials, dateRu: dateRu, ageLabel: ageLabel, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReportModel = api;
})(this);
