/*
 * Калькулятор из файла .xlsx: генератор подставляет клиента во входные ячейки
 * и берёт результат из формул самого файла — ставки, ПМ и таблицы смертности менять в коде не нужно.
 *
 * Ячейки ищем по именам книги (DofB, дата_расч, sex, gp, BP, x, x0, d, nax, i, ind…),
 * где имён нет — по подписям: «Категория», «Накопления с ЕНПФ», «Минимальная премия»,
 * «Прожиточный минимум», «выплата на дату заключения», «выплата в момент выхода на пенс».
 * Результат — в том же виде, что у AnnuityEngine.compute, чтобы отчёт не знал, откуда цифры.
 */
(function (root) {
  'use strict';
  var XR = root.XlsxReader, FB = root.FormulaBook, AE = root.AnnuityEngine;
  var COLS = 16385;

  var xround = AE.xround;
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : NaN; }
  function show(v) { return v && typeof v === 'object' && v.e ? v.e : v === null ? 'пусто' : String(v); }
  function txt(v) { return v && typeof v === 'object' && v.e ? v.e : v === null ? '' : String(v); }

  /* подписи на листе → ячейки { sh, r, c } */
  function labels(bk, re, sheets) {
    var out = [];
    sheets.forEach(function (sh) {
      bk.sheet(sh).cells.forEach(function (cell, k) {
        if (typeof cell.v === 'string' && re.test(cell.v.replace(/\s+/g, ' ').trim())) out.push({ sh: sh, r: Math.floor(k / COLS), c: k % COLS });
      });
    });
    return out;
  }
  function isValueCell(cell) { return cell && (cell.f !== undefined || cell.si !== undefined || typeof cell.v === 'number'); }
  function formulaText(bk, sh, cell) {
    if (cell.f) return cell.f;
    var m = cell.si !== undefined ? bk.sheet(sh).masters[cell.si] : null;
    return m ? m.f : '';
  }

  function locate(bk) {
    var m = {};
    function named() {
      for (var i = 0; i < arguments.length; i++) {
        var r = bk.nameRef(arguments[i]);
        if (r && r.r1 === r.r2 && r.c1 === r.c2) return r;
      }
      return null;
    }
    m.dob = named('DofB', 'дата_рождения_клиента');
    if (!m.dob) {
      var hit = labels(bk, /^дата рождения$/i, [0])[0];
      if (!hit) throw new Error('Не нашёл в файле поле «Дата рождения» — это точно калькулятор пенсионного аннуитета?');
      m.dob = new FB.Ref(0, hit.r, 7, hit.r, 7);
    }
    var inSh = m.dob.sh, col = m.dob.c1;
    function row(re) {
      var hits = labels(bk, re, [inSh]);
      for (var i = 0; i < hits.length; i++) if (hits[i].c < col) return new FB.Ref(inSh, hits[i].r, col, hits[i].r, col);
      return null;
    }
    function near(re, sheets) {
      var hits = labels(bk, re, sheets);
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        for (var dc = 1; dc >= -1; dc -= 2) {
          if (h.c + dc < 1) continue;
          if (isValueCell(bk.cell(h.sh, h.r, h.c + dc))) return new FB.Ref(h.sh, h.r, h.c + dc, h.r, h.c + dc);
        }
      }
      return null;
    }
    m.date = named('дата_расч', 'датарасч') || row(/^дата расч[её]та$/i);
    m.sex = named('sex') || row(/^пол$/i);
    m.oppv = named('OPPV') || row(/^ОППВ/i);
    m.gp = named('gp') || row(/^гарантированный период/i);
    m.category = row(/^категория/i);
    m.savings = row(/^накопления/i);
    m.redemption = row(/^выкупная сумма/i);
    m.contribution = row(/^взнос/i);
    m.bp = named('BP') || row(/^итого премия/i);
    bk.sheet(inSh).cells.forEach(function (cell, k) {
      if (!m.status && (cell.f !== undefined || cell.si !== undefined) && /недостаточно средств/i.test(formulaText(bk, inSh, cell)))
        m.status = new FB.Ref(inSh, Math.floor(k / COLS), k % COLS, Math.floor(k / COLS), k % COLS);
    });
    m.x = named('x'); m.x0 = named('x0'); m.x_0 = named('x_0'); m.d = named('d');
    m.nax = named('nax'); m.ax = named('ax'); m.vd = named('vd');
    m.i = named('i'); m.ind = named('ind'); m.alfa = named('alfa'); m.gamma = named('gamma');
    var calcSh = (m.nax || m.i || m.dob).sh, both = calcSh === inSh ? [inSh] : [calcSh, inSh];
    m.pm = near(/^прожиточный минимум$/i, both);
    m.minPay = near(/^мин(имальная|\.)?\s*выплата$/i, both);
    m.threshold = near(/^минимальная премия$/i, both) || near(/^минимальная (пенсия|премия) для заключения$/i, both);
    m.minPayAtPension = near(/^мин(имальная|\.)?\s*выплата в момент выхода/i, both);
    m.paySign = near(/^выплата на дату заключения$/i, both);
    m.first = near(/^выплата в момент выхода на пенс/i, both) || row(/^выплата в момент выхода на пенс/i);

    var need = { date: 'Дата расчёта', sex: 'Пол', category: 'Категория', gp: 'Гарантированный период', status: 'статус расчёта',
                 x: 'возраст (имя x)', nax: 'аннуитетный фактор (имя nax)', threshold: 'Минимальная премия',
                 first: 'выплата в момент выхода на пенсию', paySign: 'выплата на дату заключения', ind: 'индексация (имя ind)' };
    var lost = Object.keys(need).filter(function (k) { return !m[k]; }).map(function (k) { return need[k]; });
    if (!m.x0 && !m.x_0) lost.push('возраст начала выплат (имя x0)');
    if (!m.bp && !(m.savings && m.contribution)) lost.push('Итого премия (имя BP)');
    if (lost.length) throw new Error('В калькуляторе не нашлось: ' + lost.join(', ') + '. Похоже, файл устроен иначе — напишите разработчику генератора.');
    return m;
  }

  function covers(sqref, ref) {
    return sqref.some(function (s) {
      var p = s.split(':'), a = XR.a1(p[0]), b = XR.a1(p[1] || p[0]);
      return a && b && ref.r1 >= a.r && ref.r1 <= b.r && ref.c1 >= a.c && ref.c1 <= b.c;
    });
  }
  function validation(bk, ref) {
    if (!ref) return null;
    var vs = bk.sheet(ref.sh).validations;
    for (var i = 0; i < vs.length; i++) if (covers(vs[i].sqref, ref)) return vs[i];
    return null;
  }
  function listOf(bk, ref) {
    var v = validation(bk, ref);
    if (!v || v.type !== 'list' || !v.formula1) return null;
    var f = v.formula1.trim();
    if (/^".*"$/.test(f)) return f.slice(1, -1).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var r = bk.ref(f, ref.sh);
    if (!r) return null;
    return bk.values(r).filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); });
  }
  function maxOf(bk, ref) {
    var v = validation(bk, ref);
    if (!v) return null;
    var f1 = v.formula1 || '', f2 = v.formula2 || '', m;
    if (v.type === 'custom' && (m = /<=\s*(\d+(?:[.,]\d+)?)/.exec(f1))) return +m[1].replace(',', '.');
    if (v.type === 'custom' && (m = /<\s*(\d+(?:[.,]\d+)?)/.exec(f1))) return +m[1].replace(',', '.') - 1;
    if ((v.type === 'whole' || v.type === 'decimal') && /^-?\d/.test(v.operator === 'between' ? f2 : f1)) {
      if (v.operator === 'between') return +f2;
      if (v.operator === 'lessThanOrEqual') return +f1;
      if (v.operator === 'lessThan') return +f1 - 1;
    }
    return null;
  }

  function versionLabel(fileName, modified) {
    var m = /(\d{2})[.\-_](\d{2})[.\-_](\d{4}|\d{2})(?!\d)/.exec(fileName || '');
    if (m) return m[1] + '.' + m[2] + '.' + (m[3].length === 2 ? '20' + m[3] : m[3]);
    var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(modified || '');
    return d ? d[3] + '.' + d[2] + '.' + d[1] : '';
  }

  function Engine(book, fileName) {
    var bk = this.book = book, m;
    this.fileName = fileName;
    this.map = m = locate(bk);
    this.label = versionLabel(fileName, bk.raw.modified);

    var cats = listOf(bk, m.category) || Object.keys(AE.CATEGORIES);
    cats.sort(function (a, b) { return (/стандарт/i.test(b) ? 1 : 0) - (/стандарт/i.test(a) ? 1 : 0); });
    this.lists = { categories: cats, sexes: listOf(bk, m.sex) || ['мужской', 'женский'], oppv: m.oppv ? (listOf(bk, m.oppv) || ['Да', 'Нет']) : null };

    function val(ref) { return ref ? num(bk.get(ref)) : NaN; }
    var ages = [];
    bk.sheet(m.dob.sh).cells.forEach(function (cell) {
      var t = cell.f || '', re = /(^|[^\w.])x\s*<\s*(\d+(?:\.\d+)?)/g, a;
      while ((a = re.exec(t))) ages.push(+a[2]);
    });
    var P = this.params = {
      i: val(m.i), ind: val(m.ind), alfa: val(m.alfa), gamma: val(m.gamma), pm: val(m.pm), minPay: val(m.minPay),
      maxGuarantee: maxOf(bk, m.gp), minAge: ages.length ? Math.min.apply(null, ages) : null,
      minAgeStandard: ages.length > 1 ? Math.max.apply(null, ages) : null
    };
    if (!isFinite(P.ind)) throw new Error('В калькуляторе не читается индексация (ячейка с именем ind).');

    /* какие формулы участвуют в расчёте и совпадают ли они с тем, что сохранил Excel */
    var roots = ['status', 'x', 'x0', 'x_0', 'd', 'nax', 'ax', 'vd', 'threshold', 'minPay', 'minPayAtPension', 'paySign', 'first', 'pm']
      .map(function (k) { return m[k]; }).filter(Boolean);
    var list = bk.closure(roots);
    this.formulas = list.length;
    var unknown = bk.unsupported(list);
    if (unknown.length) throw new Error('В калькуляторе есть функции Excel, которые генератор пока не считает: ' + unknown.join(', ') + '.');
    var broken = bk.problems.filter(function (p) { return p.where && list.some(function (q) { return bk.addr(q[0], q[1], q[2]) === p.where; }); });
    if (broken.length) throw new Error('Не разобрал формулу ' + broken[0].where + ': ' + broken[0].msg + '.');
    this.check = bk.selfTest(list);

    /* проверочный клиент: мужчина 50 лет, стандартный договор */
    var now = new Date(), iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
    var probe = this.compute({ calcDate: iso(now), dob: (now.getFullYear() - 50) + '-01-15', sex: 'мужской', category: cats[0],
                               oppv: 'Нет', guarantee: 0, savings: 50000000 });
    if (probe.errors && probe.errors.length) throw new Error('Калькулятор не посчитал проверочного клиента: ' + probe.errors.join(' '));
  }

  Engine.prototype.pick = function (list, letter, fallback) {
    if (!list) return fallback;
    for (var i = 0; i < list.length; i++) if (list[i].charAt(0).toLowerCase() === letter) return list[i];
    return fallback;
  };

  /* input — как у AnnuityEngine.compute */
  Engine.prototype.compute = function (input) {
    var bk = this.book, m = this.map, P = this.params, self = this;
    var calcDate = AE.parseDate(input.calcDate), dob = AE.parseDate(input.dob), errors = [];
    if (!calcDate) errors.push('Не указана дата расчёта');
    if (!dob) errors.push('Не указана дата рождения');
    if (errors.length) return { ok: false, errors: errors };
    var category = input.category && this.lists.categories.indexOf(input.category) >= 0 ? input.category : this.lists.categories[0];
    var gp = Math.max(0, Math.floor(+input.guarantee || 0));
    var savings = Math.max(0, xround(+input.savings || 0));
    var redemption = Math.max(0, xround(+input.redemption || 0));
    var contribution = Math.max(0, xround(+input.contribution || 0));
    var rate = input.dividendRate == null ? AE.TARIFF.dividendNet : +input.dividendRate;
    var own = savings + redemption;
    function serial(d) { return bk.serial(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    function run(contrib) {
      bk.reset();
      bk.set(m.date, serial(calcDate));
      bk.set(m.dob, serial(dob));
      bk.set(m.sex, self.pick(self.lists.sexes, input.sex === 'женский' ? 'ж' : 'м', input.sex));
      bk.set(m.category, category);
      if (m.oppv) bk.set(m.oppv, self.pick(self.lists.oppv, input.oppv === 'Да' ? 'д' : 'н', input.oppv));
      bk.set(m.gp, gp);
      if (m.savings) bk.set(m.savings, savings);
      if (m.redemption) bk.set(m.redemption, redemption);
      if (m.contribution) bk.set(m.contribution, contrib);
      if (m.bp) bk.set(m.bp, own + contrib);
    }
    function read(key, label) {
      var v = bk.get(m[key]);
      if (typeof v !== 'number' || !isFinite(v)) errors.push('калькулятор вернул «' + show(v) + '» в поле «' + label + '»');
      return num(v);
    }

    run(contribution);
    var threshold = read('threshold', 'минимальная премия');
    var excelStatus = txt(bk.get(m.status));
    var mode, premium, topup, dividend;
    if (own + contribution >= threshold) {
      mode = 'free'; premium = own + contribution; dividend = xround(premium * rate); topup = contribution;
    } else {
      mode = 'threshold'; premium = threshold; dividend = xround(premium * rate); topup = Math.max(0, premium - own - dividend);
      run(premium - own);
    }
    var status = mode === 'free' ? excelStatus : txt(bk.get(m.status));
    var x = read('x', 'возраст');
    var x0 = m.x0 ? read('x0', 'возраст начала выплат') : read('x_0', 'возраст начала выплат');
    var xStart = m.x_0 ? read('x_0', 'возраст начала выплат') : x0;
    var d = m.d ? read('d', 'срок отсрочки') : Math.floor(xStart) - Math.floor(x);
    var nax = read('nax', 'аннуитетный фактор');
    var pay0 = read('paySign', 'выплата на дату заключения');
    var first = read('first', 'выплата в момент выхода на пенсию');
    if (errors.length) return { ok: false, errors: ['Не получилось посчитать: ' + errors.join('; ') + '.'] };

    var startAgeInt = Math.floor(x) + d;
    var T = {
      version: this.label, source: 'xlsx', fileName: this.fileName,
      i: P.i, ind: P.ind, alfa: P.alfa, gamma: P.gamma, pm: P.pm, minPayShare: P.pm ? P.minPay / P.pm : null,
      maxGuarantee: P.maxGuarantee, minAge: P.minAge, minAgeStandard: P.minAgeStandard,
      dividendNet: AE.TARIFF.dividendNet, horizon: AE.TARIFF.horizon
    };
    var warnings = [];
    if (P.maxGuarantee != null && gp > P.maxGuarantee) warnings.push('Гарантированный период по калькулятору — не больше ' + P.maxGuarantee + ' лет');
    return {
      ok: status === 'ok', status: status, fundsStatus: own + contribution >= threshold ? 'ok' : 'недостаточно средств',
      excelStatus: excelStatus, warnings: warnings, errors: [], enteredPremium: own + contribution,
      tariff: T, table: null, category: category,
      age: x, ageInt: Math.floor(x), months: Math.round(x * 12), startAge: x0, startAgeInt: startAgeInt, deferral: d,
      guarantee: gp, ax: m.ax ? num(bk.get(m.ax)) : null, axNet: null, vd: m.vd ? num(bk.get(m.vd)) : null, nax: nax,
      minPay: num(bk.get(m.minPay)), minPayAtPension: m.minPayAtPension ? num(bk.get(m.minPayAtPension)) : null, threshold: threshold,
      savings: savings, redemption: redemption, contribution: contribution, premium: premium,
      dividendRate: rate, dividend: dividend, topup: topup, mode: mode,
      payAtSigning: xround(pay0), first: first, rows: AE.schedule(first, P.ind, startAgeInt, gp, T.horizon)
    };
  };

  /* что изменилось по сравнению со встроенным калькулятором (строка под названием файла) */
  var TABLES = { 'м_пенс': ['m_pens', 'мужчины'], 'ж_пенс': ['f_pens', 'женщины'],
                 'м_5_29': ['m_5_29', 'мужчины 5–29%'], 'ж_5_29': ['f_5_29', 'женщины 5–29%'],
                 'м_30_59': ['m_30_59', 'мужчины 30–59%'], 'ж_30_59': ['f_30_59', 'женщины 30–59%'],
                 'м_60_89': ['m_60_89', 'мужчины 60–89%'], 'ж_60_89': ['f_60_89', 'женщины 60–89%'],
                 'м_90_100': ['m_90_100', 'мужчины 90–100%'], 'ж_90_100': ['f_90_100', 'женщины 90–100%'] };
  /* возраст начала выплат: пробуем клиентов, у которых он задан правилом, а не текущим возрастом */
  var AGE_PROBES = [['женщин 1974\u00A0г.\u00A0р.', 'женский', '1974-03-01'], ['женщин 1975\u00A0г.\u00A0р. (I полугодие)', 'женский', '1975-03-01'],
                    ['женщин 1975\u00A0г.\u00A0р. (II полугодие)', 'женский', '1975-09-01'], ['женщин 1976\u00A0г.\u00A0р. (I полугодие)', 'женский', '1976-03-01'],
                    ['женщин, родившихся с июля 1976\u00A0г.', 'женский', '1976-09-01'], ['мужчин', 'мужской', '1976-03-01']];
  Engine.prototype.diff = function (mort) {
    var T = AE.TARIFF, P = this.params, out = [], bk = this.book, self = this;
    function pct(v) { return String(Math.round(v * 10000) / 100).replace('.', ',') + '%'; }
    function money(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸'; }
    function age(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }
    function cmp(label, now, was, f) { if (now != null && isFinite(now) && Math.abs(now - was) > 1e-12) out.push(label + ' ' + f(was) + ' → ' + f(now)); }
    cmp('ставка', P.i, T.i, pct);
    cmp('индексация', P.ind, T.ind, pct);
    cmp('расходы от премии', P.alfa, T.alfa, pct);
    cmp('расходы от выплаты', P.gamma, T.gamma, pct);
    cmp('ПМ', P.pm, T.pm, money);
    if (P.maxGuarantee != null && P.maxGuarantee !== T.maxGuarantee) out.push('гарантия до ' + P.maxGuarantee + ' лет');
    var was = Object.keys(AE.CATEGORIES), now = this.lists.categories;
    now.forEach(function (c) { if (was.indexOf(c) < 0) out.push('новая категория «' + c + '»'); });
    was.forEach(function (c) { if (now.indexOf(c) < 0) out.push('нет категории «' + c + '»'); });
    if (mort) {
      var std = now.filter(function (c) { return /стандарт/i.test(c); })[0] || now[0];
      AGE_PROBES.forEach(function (p) {
        var input = { calcDate: '2020-01-01', dob: p[2], sex: p[1], category: std, oppv: 'Нет', guarantee: 0, savings: 1e9 };
        var a = self.compute(input), b = AE.compute(input, mort);
        if (a.startAge != null && b.startAge != null && Math.abs(a.startAge - b.startAge) > 1e-9) out.push('старт выплат у ' + p[0] + ' ' + age(b.startAge) + ' → ' + age(a.startAge));
      });
      var changed = [];
      Object.keys(TABLES).forEach(function (n) {
        var r = bk.nameRef(n), t = mort[TABLES[n][0]];
        if (!r || !t) return;
        var q = bk.values(r);
        for (var k = 0; k < Math.max(q.length, t.q.length); k++) {
          var x = typeof q[k] === 'number' ? q[k] : null, y = t.q[k] != null ? t.q[k] : null;
          if (x === null && y === null) continue;
          if (x === null || y === null || Math.abs(x - y) > 1e-12) { changed.push(TABLES[n][1]); break; }
        }
      });
      if (changed.length) out.push('таблицы смертности: ' + changed.join(', '));
    }
    return out;
  };

  function load(bytes, fileName, inflateRaw) {
    return XR.read(bytes, inflateRaw).then(function (raw) { return new Engine(new FB.Book(raw), fileName || 'калькулятор.xlsx'); });
  }

  root.XlsxCalculator = { load: load, Engine: Engine };
})(this);
