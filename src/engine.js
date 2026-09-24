/*
 * Расчёт пенсионного аннуитета — перенос калькулятора
 * «ПА калькулятор 21.09.2026.xlsx» (АО «КСЖ «Standard Life»).
 *
 * Соответствие Excel:
 *   ввод!H6   x      = DATEDIF(дата рождения; дата расчёта; "m") / 12
 *   возраст!E21 x0   = возраст начала выплат (по полу, дате рождения, категории)
 *   calc!B5   d      = INT(x0) − INT(x)            — срок отсрочки
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

  /* Excel ROUND: половина — от нуля */
  function xround(v) { return v < 0 ? -Math.round(-v) : Math.floor(v + 0.5); }
  function xroundup(v) { return v < 0 ? -Math.ceil(-v) : Math.ceil(v); }

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
    var xInt = Math.floor(x), x0Int = Math.floor(x0);
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

    /* Таблица выплат по возрастным годам: месячная растёт на ind каждый год */
    var rows = [], cumExact = 0;
    for (var age = x0Int, n = 0; age <= T.horizon; age++, n++) {
      var exact = first * Math.pow(1 + T.ind, n);
      cumExact += 12 * exact;
      rows.push({ age: age, m: xround(exact), y: xround(12 * exact), cum: xround(cumExact),
                  guaranteed: n < gp });
    }

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
      payAtSigning: xround(pay0), first: first, rows: rows
    };
  }

  var api = { TARIFF: TARIFF, CATEGORIES: CATEGORIES, compute: compute,
              monthsBetween: monthsBetween, parseDate: parseDate, xround: xround };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AnnuityEngine = api;
})(this);
