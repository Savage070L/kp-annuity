/*
 * Расчёт пенсионного аннуитета — перенос калькулятора
 * «ПА калькулятор 21.09.2026.xlsx» (АО «КСЖ «Standard Life»).
 *
 * Соответствие Excel:
 *   ввод!H6   x      = DATEDIF(дата рождения; дата расчёта; "m") / 12
 *   возраст!E21 x0   = возраст начала выплат (по полу, дате рождения, категории)
 *   ввод!H23  x_0    = возраст на дату начала выплат (29 февраля — дни/365)
 *   calc!B5   d      = INT(x_0) − INT(x)           — срок отсрочки
 *   calc!G8   äx     = ((ΣPV − 11/24)·(1+γ)/(1−α))·12
 *   calc!G7   v^d    = ((1+ind)/(1+i))^d
 *   calc!G6   n|äx   = äx · v^d
 *   calc!H2   мин. выплата  = ROUNDUP(ПМ·0,7)
 *   calc!H3   мин. премия   = ROUND(мин. выплата · n|äx)
 *   calc!F2   выплата на дату заключения = ROUND(премия) / n|äx
 *   calc!F3   выплата при выходе на пенсию = ROUND(ROUND(F2)·(1+ind)^INT(d))
 */
(function (root) {
  'use strict';

  var TARIFF = {
    version: '21.09.2026',
    i: 0.09,          // calc!B1 — ставка доходности
    ind: 0.08,        // calc!B2 — индексация
    alfa: 0.015,      // calc!B3 — расходы, % от премии
    gamma: 0.03,      // calc!B4 — расходы, % от выплаты
    pm: 50851,        // calc!H1 — прожиточный минимум
    minPayShare: 0.7, // calc!H2 — минимальная выплата = 70% ПМ
    maxGuarantee: 10, // ввод!G14 — проверка «не больше 10 лет»
    minAge: 40,       // ввод!M1
    minAgeStandard: 45, // ввод!M7 — стандартному клиенту до 45 нельзя
    dividendGross: 0.125, // список ставок ввод!G34 — «12,5%»
    dividendNet: 0.11,    // ввод!H34 — «Ставка Нетто дивиденда 11%»
    horizon: 100      // до какого возраста показываем выплаты
  };

  var CATEGORIES = {
    'Стандартный': ['m_pens', 'f_pens'],
    'ОППВ 60 мес': ['m_5_29', 'f_5_29'],
    'Инвалидность 3гр (30-59%) бессрочно': ['m_30_59', 'f_30_59'],
    'Инвалидность 2гр (60-89%) бессрочно': ['m_60_89', 'f_60_89'],
    'Инвалидность 1гр (90-100%) бессрочно': ['m_90_100', 'f_90_100']
  };

  /* Excel ROUND: половина — от нуля, число сначала приводим к 15 значащим цифрам, как Excel */
  function snap(v) { return v === 0 || !isFinite(v) ? v : +v.toPrecision(15); }
  function xround(v) { v = snap(v); return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5); }
  function xroundup(v) { v = snap(v); return v < 0 ? -Math.ceil(-v) : Math.ceil(v); }

  /* Выплаты по возрастным годам — как лист «График» калькулятора: раз в год
     ROUND(прошлая выплата · (1+ind)), за год — 12 одинаковых выплат */
  function schedule(first, ind, fromAge, gp, horizon) {
    var rows = [], m = first, cum = 0;
    for (var age = fromAge, n = 0; age <= horizon; age++, n++) {
      if (n > 0) m = xround(m * (1 + ind));
      cum += 12 * m;
      rows.push({ age: age, m: m, y: 12 * m, cum: cum, guaranteed: n < gp });
    }
    return rows;
  }

  /* Лист «График»: выкупная сумма = MAX(премия·(1−α) − Σ выплат·(1+γ); 0), появляется через 24 месяца
     после даты расчёта. Для строк таблицы — на конец каждого года выплат (после 12-й выплаты года).
     Даты выплат идут по числу дня рождения, у немедленного аннуитета — по дате расчёта. */
  function surrender(rows, premium, T, calcDate, begin, day) {
    rows.forEach(function (r, n) {
      var end = onDay(begin, 12 * n + 11, day);
      r.surr = monthsBetween(calcDate, end) >= 24 ? Math.max(0, xround(premium * (1 - T.alfa) - r.cum * (1 + T.gamma))) : null;
    });
    // первая строка «Графика» — дата расчёта (или начало выплат, если до него не больше месяца),
    // дальше по месяцам; выкупная сумма появляется в первой строке, где прошло 24 месяца
    var a6 = monthsBetween(calcDate, begin) <= 1 ? begin : calcDate, from = null;
    for (var k = 0; k < 40 && !from; k++) {
      var dt = k === 0 ? a6 : onDay(a6, k, day);
      if (monthsBetween(calcDate, dt) >= 24) from = dt;
    }
    return { base: xround(premium * (1 - T.alfa)), from: isoDate(from) };
  }

  function parseDate(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /* DATEDIF(start; end; "m") — число полных месяцев */
  function monthsBetween(a, b) {
    var m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m -= 1;
    return m;
  }

  function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

  /* EDATE(дата; месяцев) — тот же день через k месяцев, в коротком месяце — последний день */
  function edate(d, k) {
    var y = d.getFullYear(), m = d.getMonth() + k;
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  }
  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  /* дата через k месяцев на заданном числе (в коротком месяце — последний день), как столбец дат «Графика» */
  function onDay(d, k, day) {
    var y = d.getFullYear(), m = d.getMonth() + k;
    return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  }
  function daysBetween(a, b) {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  }

  /* возраст!E2:E20 — для женщин возраст начала выплат зависит от даты рождения */
  function womanStartAge(dob) {
    var v = ymd(dob);
    if (v >= 19760701) return 55;
    if (v >= 19760101) return 54.5;
    if (v >= 19750701) return 54;
    if (v >= 19750101) return 53.5;
    return 53;
  }

  /* возраст!E21 */
  function startAge(input, dob, x) {
    var base;
    if (input.category === 'ОППВ 60 мес' || input.oppv === 'Да') base = 50;
    else if (input.sex === 'мужской') base = 55;
    else base = womanStartAge(dob);
    return Math.max(base, x);
  }

  function qx(mort, table, age) {
    var t = mort[table];
    var k = age - t.from;
    if (k < 0 || k >= t.q.length) return 1; // IFERROR(…; 1)
    return t.q[k];
  }

  /*
   * input: { calcDate, dob, sex ('мужской'|'женский'), category, oppv ('Да'|'Нет'),
   *          guarantee (лет), savings, redemption, contribution, dividendRate }
   * mort:  таблицы смертности (см. mortality.js)
   */
  function compute(input, mort, tariff) {
    var T = tariff || TARIFF;
    var errors = [];
    var calcDate = parseDate(input.calcDate);
    var dob = parseDate(input.dob);
    if (!calcDate) errors.push('Не указана дата расчёта');
    if (!dob) errors.push('Не указана дата рождения');
    if (errors.length) return { ok: false, errors: errors };

    var category = input.category || 'Стандартный';
    var tables = CATEGORIES[category];
    if (!tables) return { ok: false, errors: ['Неизвестная категория: ' + category] };
    var table = tables[input.sex === 'мужской' ? 0 : 1];

    var gp = Math.max(0, Math.floor(+input.guarantee || 0));
    var months = monthsBetween(dob, calcDate);
    var x = months / 12;
    var x0 = startAge(input, dob, x);
    /* ввод!G23, H23: дата начала выплат и возраст на неё. У родившихся 29 февраля калькулятор
       считает этот возраст как дни/365 — повторяем, иначе отсрочка разойдётся на год */
    var begin = x === x0 ? calcDate : edate(dob, Math.trunc(x0 * 12));
    var xStart = dob.getMonth() === 1 && dob.getDate() === 29 ? daysBetween(dob, begin) / 365 : monthsBetween(dob, begin) / 12;
    var xInt = Math.floor(x), x0Int = Math.floor(xStart);   // calc!A10 = INT(x_0)
    var d = x0Int - xInt;

    /* calc!A10:G75 — приведённая стоимость выплат */
    var sumPV = 0, F = 1;
    for (var k = 0; k < 66; k++) {
      var A = x0Int + k;
      var B = 1 / Math.pow(1 + T.i, k);
      var C = Math.pow(1 + T.ind, k);
      sumPV += (A >= x0Int + gp) ? B * C * F : B * C;
      F *= 1 - qx(mort, table, A);
    }
    var axNet = (sumPV - 11 / 24) * 12;                                  // calc!H8
    var ax = ((sumPV - 11 / 24) * (1 + T.gamma) / (1 - T.alfa)) * 12;   // calc!G8
    var vd = Math.pow((1 + T.ind) / (1 + T.i), d);                        // calc!G7
    var nax = ax * vd;                                                    // calc!G6

    var minPay = xroundup(T.pm * T.minPayShare);                          // calc!H2
    var threshold = xround(minPay * nax);                                 // calc!H3
    var minPayAtPension = xround(minPay * Math.pow(1 + T.ind, d));        // calc!H4

    var savings = Math.max(0, xround(+input.savings || 0));
    var redemption = Math.max(0, xround(+input.redemption || 0));
    var contribution = Math.max(0, xround(+input.contribution || 0));
    var dividendRate = input.dividendRate == null ? T.dividendNet : +input.dividendRate;

    /* Сценарий как в отчёте: если своих средств не хватает до порога,
       клиент доплачивает, а возможный дивиденд уменьшает доплату. */
    var own = savings + redemption;
    var premium, topup, dividend, mode;
    if (own + contribution >= threshold) {
      /* клиент переводит свою сумму: премия = накопления + выкупная + взнос,
         дивиденд — отдельно, в премию не входит */
      mode = 'free';
      premium = own + contribution;
      dividend = xround(premium * dividendRate);
      topup = contribution;
    } else {
      /* своих средств меньше порога: оформляем по порогу, дивиденд уменьшает доплату */
      mode = 'threshold';
      premium = threshold;
      dividend = xround(premium * dividendRate);
      topup = Math.max(0, premium - own - dividend);
    }

    var pay0 = xround(premium) / nax;                                     // calc!F2
    var first = xround(xround(pay0) * Math.pow(1 + T.ind, d));            // calc!F3

    /* проверки ввод!G2 и ввод!M1..M7 */
    var status = 'ok', warnings = [];
    var under45 = x < T.minAgeStandard, notStandard = category !== 'Стандартный',
        notOppvCat = category !== 'ОППВ 60 мес', oppvYes = input.oppv === 'Да';
    var combo = [under45, notStandard, notOppvCat, oppvYes].map(function (b) { return b ? 1 : 0; }).join('+');
    if (x < T.minAge) status = 'не достигнут возраст';
    else if (combo === '1+1+1+0' || combo === '1+0+1+0' || combo === '1+0+1+1') status = 'не достигнут возраст';
    var enteredPremium = own + contribution;
    var fundsStatus = enteredPremium >= threshold ? 'ok' : 'недостаточно средств';
    if (gp > T.maxGuarantee) warnings.push('Гарантированный период по калькулятору — не больше ' + T.maxGuarantee + ' лет');

    var rows = schedule(first, T.ind, x0Int, gp, T.horizon);
    var sv = surrender(rows, premium, T, calcDate, begin, begin === calcDate ? calcDate.getDate() : dob.getDate());

    return {
      ok: status === 'ok', status: status, fundsStatus: fundsStatus,
      excelStatus: status !== 'ok' ? status : fundsStatus,
      warnings: warnings, errors: [], enteredPremium: enteredPremium,
      tariff: T, table: table, category: category,
      age: x, ageInt: xInt, months: months, startAge: x0, startAgeInt: x0Int, deferral: d,
      guarantee: gp, ax: ax, axNet: axNet, vd: vd, nax: nax,
      minPay: minPay, minPayAtPension: minPayAtPension, threshold: threshold,
      savings: savings, redemption: redemption, contribution: contribution,
      premium: premium, dividendRate: dividendRate, dividend: dividend, topup: topup, mode: mode,
      payAtSigning: xround(pay0), first: first, rows: rows,
      calcDate: isoDate(calcDate), begin: isoDate(begin), surrBase: sv.base, surrFrom: sv.from
    };
  }

  var api = { TARIFF: TARIFF, CATEGORIES: CATEGORIES, compute: compute, schedule: schedule, surrender: surrender,
              isoDate: isoDate, onDay: onDay, edate: edate,
              monthsBetween: monthsBetween, parseDate: parseDate, xround: xround };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnnuityEngine = api;
})(this);
