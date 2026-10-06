/* Раздел КП «ЕНПФ или аннуитет»: цифры в КП == исходная библиотека «Калькулятор ЕНПФ» (lib/compare.js).
 *
 *   node test/enpf-compare.js                — 7 профилей smoke + 200 случайных клиентов + особые случаи
 *   N=500 node test/enpf-compare.js          — больше случайных клиентов
 *   ENPF_LIB=/путь/к/lib node test/enpf-compare.js
 *
 * Как сверяется: генератор (dist/report-kit.js, копия библиотеки в src/enpf) собирает КП; в разделе у каждого
 * числа есть data-k (что это) и data-v (значение). Тест сам, независимо от report-model, переводит ввод генератора
 * во вход lib/buildComparison (исходный ES-модуль), считает и проверяет: значение совпадает с библиотекой,
 * текст в КП — это значение, округлённое до тенге (или «12,3 млн ₸»). Плюс: аннуитет раздела = расчёт КП
 * (первая выплата, выплаты по годам), «Ранний старт» — с тем же возрастом ЕНПФ, данные подсказки графиков = lib,
 * нет пустых мест. Сеть не используется: fetch в тесте запрещён.
 */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto'), url = require('url');

globalThis.fetch = function () { throw new Error('test/enpf-compare.js: сеть в тестах запрещена'); };
var K = require('./render.js').loadKit();
var LIB = process.env.ENPF_LIB || path.join(process.env.HOME || '', 'Downloads', 'Калькулятор ЕНПФ', 'lib');
var cases = require('./excel-cases.json');
var agent = { name: 'Тимур Агентов', phone: '+7 700 000 00 00', email: 'agent@example.kz', city: 'Алматы', sex: 'мужской' };
var TODAY = '2026-10-05';

var failures = [], checks = 0;
function fail(where, msg) { failures.push(where + ': ' + msg); }
function ok(cond, where, msg) { checks++; if (!cond) fail(where, msg); return cond; }

/* ── вход библиотеки из ввода генератора: контракт (так же делает report-model) ── */
var INFLATION = { enpf: undefined, p5: 0.05, p8: 0.08, p10: 0.10 };
function libArgs(input, set) {
  var cat = input.category || 'Стандартный';
  var client = {
    sex: input.sex, birthDate: input.dob, savingsOPV: input.savings || 0, category: cat,
    guaranteeYears: input.guarantee || 0, redemption: input.redemption || 0,
    topUp: input.contribution > 0 ? input.contribution : undefined, oppv: input.oppv,
    harmful: cat === 'ОППВ 60 мес' || input.oppv === 'Да'
  };
  var T = K.tariff;
  var a = { enpfScenario: (set && set.scenario) || 'realist', dividendRate: input.dividendRate,
            slTariff: { i: T.i, ind: T.ind, alpha: T.alfa, gamma: T.gamma, maxGuaranteeYears: T.maxGuarantee, dividendNet: T.dividendNet, tariffVersion: T.version } };
  var inf = INFLATION[(set && set.inflation) || 'enpf'];
  if (inf !== undefined) a.inflationPath = inf;
  return { client: client, assumptions: a, today: input.calcDate };
}

/* ── форматирование, как в КП ── */
function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function fmt(v, f) {
  if (f === 'm') return (v < 0 ? '−' : '') + String(Math.round(Math.abs(v) / 1e5) / 10).replace('.', ',') + ' млн ₸';
  if (f === 'a') return String(v);
  var r = Math.round(v);
  return (r < 0 ? '−' : '') + group(Math.abs(r)) + ' ₸';
}
function plainText(s) { return s.replace(/<[^>]+>/g, '').replace(/&#160;|&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim(); }

/* ── ожидаемое значение по ключу data-k ──
   ЕНПФ — только точные цифры калькулятора ЕНПФ (enpf.asInEnpfCalculator: реплика API, сверена с живым ЕНПФ до тенге);
   «получено к возрасту» для ЕНПФ — сумма строк таблицы ЕНПФ с возрастом ≤ a, по 12 выплат (своя независимая реализация). */
function enpfExact(cmp) {
  var cv = cmp.enpf.asInEnpfCalculator, b = cv.byScenario[cmp.assumptions.enpfScenario || 'realist'];
  var first = cmp.enpf.retired ? cmp.client.ageNow : cmp.enpf.retirementAge;
  var rows = b.table && b.table.length ? b.table.map(function (t) { return { age: t.age, m: t.opv + t.oppv }; }) : [];
  if (!rows.length && b.years > 0 && !b.lumpSum) for (var k = 0; k < b.years; k++) rows.push({ age: first + k, m: b.monthlyReal });
  var lump = !!b.lumpSum, lumpAmt = lump ? (b.lumpSumReal || b.monthlyReal) : 0, from = rows.length ? rows[0].age : first;
  return {
    b: b, from: from,
    m: function (a) { if (lump) return 0; for (var i = 0; i < rows.length; i++) if (rows[i].age <= a + 1e-9 && a < rows[i].age + 1 - 1e-9) return rows[i].m; return 0; },
    c: function (a) { if (lump) return a + 1e-9 >= from ? lumpAmt : 0; var s = 0; rows.forEach(function (r) { if (r.age <= a + 1e-9) s += 12 * r.m; }); return s; },
    lumpAmt: lumpAmt
  };
}
function expected(cmp, key) {
  var rows = cmp.rows, byAge = {};
  rows.forEach(function (r) { byAge[r.age] = r; });
  var X = enpfExact(cmp), eStart = Math.floor(X.from + 1e-9);
  var refAge = byAge[80] && 80 >= eStart ? 80 : cmp.assumptions.horizonAge;
  var M = cmp.metrics, m, cv = cmp.enpf.asInEnpfCalculator, kz = cmp.sl.enpfKszhView;
  switch (key) {
    case 'v.cum.sl': return byAge[refAge].slCumReal;
    case 'v.cum.enpf': return X.c(refAge);
    case 'f.diff': return Math.abs(byAge[refAge].slCumReal - X.c(refAge));
    case 'v.topup': case 'i.topup': return cmp.sl.topUp;
    case 'c.enpf.first': return X.b.monthlyReal;
    case 'c.enpf.lump': return X.lumpAmt;
    case 'c.enpf.pes': return cv.byScenario.pessimist.monthlyReal;
    case 'c.enpf.opt': return cv.byScenario.optimist.monthlyReal;
    case 'c.sl.first': return M.firstPayment.sl.real;
    case 'c.sl.firstN': case 'c.sl.firstN2': case 'a.sl.first': return cmp.sl.firstPayment;
    case 'a.sl.prem': return cmp.sl.premium;
    case 'a.kszh.first': return kz.firstPayment;
    case 'a.kszh.prem': return kz.threshold;
    case 'a.diff': return Math.abs(kz.firstPayment - cmp.sl.firstPayment);
    case 'a.offer': return cv.annuityOffer.byScenario[cmp.assumptions.enpfScenario || 'realist'].monthly;
    case 'i.burial': return cmp.sl.burialBenefitMin;
  }
  if ((m = /^t\.(\d+)\.(em|ec|sm|smn|sc)$/.exec(key))) {
    var r = byAge[+m[1]];
    if (!r) return undefined;
    return { em: X.m(+m[1]), ec: X.c(+m[1]), sm: r.slMonthlyReal, smn: r.slMonthlyNominal, sc: r.slCumReal }[m[2]];
  }
  if ((m = /^i\.(\d+)\.s$/.exec(key))) {
    var q = byAge[+m[1]];
    return q ? q.slInheritable : undefined;
  }
  return undefined;
}

/* ── один КП: собрать, найти раздел, сверить ── */
var stat = { rendered: 0, sections: 0, values: 0, skipped: 0 };
function checkOne(id, input, client, lib, opts) {
  opts = opts || {};
  var calc = K.plan(input);
  if (!calc || !calc.ok || calc.status !== 'ok') { stat.skipped++; return null; }
  var html;
  try { html = K.render(calc, client, agent); } catch (e) { fail(id, 'КП не собрался: ' + e.message); return null; }
  stat.rendered++;
  var M = K.model(calc, client, agent);
  var i = html.indexOf('<section class="section page" id="enpf">');
  var hasNav = html.indexOf('href="#enpf"') >= 0;
  if (opts.expectNoSection) {
    ok(i < 0 && !hasNav, id, 'раздел ЕНПФ должен отсутствовать (' + M.enpfStatus.status + ')');
    return { M: M, calc: calc, html: html };
  }
  if (!ok(i >= 0, id, 'нет раздела ЕНПФ: ' + M.enpfStatus.status + ' ' + M.enpfStatus.message)) return null;
  ok(hasNav, id, 'нет пункта меню «ЕНПФ или аннуитет»');
  stat.sections++;
  var sec = html.slice(i, html.indexOf('</section>', i));
  /* слепок ответа ЕНПФ (невидимый JSON) проверяем отдельно: в нём null — законное «нет значения» */
  var snapM = /<script type="application\/json" id="enpf-snapshot">([\s\S]*?)<\/script>/.exec(sec);
  if (ok(snapM, id, 'в разделе нет слепка ответа ЕНПФ')) {
    var snap = JSON.parse(snapM[1]);
    ok(snap.calcDate && snap.forecastShown && snap.methodologyVerifiedOn, id, 'слепок ЕНПФ неполный');
  }
  sec = sec.replace(/<script[\s\S]*?<\/script>/g, '');

  /* пустых мест нет */
  [/undefined/, /NaN/, /\bnull\b/, /Infinity/, /\$\{/, /\[object/, /<b class="num[^"]*"[^>]*><\/b>/, /data-v=""/].forEach(function (re) {
    ok(!re.test(sec), id, 'пустое место в разделе: ' + re.source);
  });

  /* исходная библиотека — независимо */
  var q = libArgs(input, client.enpf);
  var cmp = lib.buildComparison(q.client, q.assumptions, { today: q.today });

  /* каждое число раздела */
  var re = /<(b|span) class="num[^"]*" data-k="([^"]+)" data-v="([^"]*)" data-f="(\w)">([\s\S]*?)<\/\1>/g, mm, seen = {};
  while ((mm = re.exec(sec))) {
    var key = mm[2], v = +mm[3], f = mm[4], text = plainText(mm[5]);
    seen[key] = true;
    var exp = expected(cmp, key);
    stat.values++;
    if (!ok(exp !== undefined && isFinite(exp), id, 'ключ ' + key + ' не найден в библиотеке')) continue;
    ok(Math.abs(v - exp) <= 0.006, id, key + ': в КП ' + v + ', в библиотеке ' + exp);
    ok(text === fmt(exp, f), id, key + ': текст «' + text + '», ожидалось «' + fmt(exp, f) + '»');
  }
  ['c.sl.first', 'c.sl.firstN', 'v.cum.sl', 'v.cum.enpf', 'f.diff', 'i.burial'].forEach(function (k) { ok(seen[k], id, 'в разделе нет ' + k); });
  ok(seen['c.enpf.first'] || seen['c.enpf.lump'], id, 'в разделе нет первой выплаты ЕНПФ');
  var tabAges = Object.keys(seen).map(function (k) { var t = /^t\.(\d+)\.sc$/.exec(k); return t ? +t[1] : null; }).filter(function (a) { return a !== null; });
  ok(tabAges.length >= 3, id, 'в таблице по возрастам меньше трёх строк');

  /* аннуитет раздела = расчёт КП (иначе в одном КП разные цифры) */
  var byAge = {};
  calc.rows.forEach(function (r) { byAge[r.age] = r; });
  ok(cmp.sl.firstPayment === calc.first, id, 'первая выплата: КП ' + calc.first + ', раздел ' + cmp.sl.firstPayment);
  ok(cmp.sl.threshold === calc.threshold && cmp.sl.premium === calc.premium, id, 'порог/премия раздела ≠ КП');
  cmp.sl.scheduleByAge.forEach(function (r) {
    ok(byAge[r.age] && byAge[r.age].m === r.monthlyNominal, id, 'выплата в ' + r.age + ' лет: КП ' + (byAge[r.age] && byAge[r.age].m) + ', раздел ' + r.monthlyNominal);
  });
  Object.keys(seen).forEach(function (k) {
    var t = /^t\.(\d+)\.smn$/.exec(k);
    if (t && byAge[+t[1]]) ok(Math.round(expected(cmp, k)) === byAge[+t[1]].m, id, 'таблица ' + t[1] + ' лет: по договору ≠ КП');
  });

  /* «Ранний старт» и раздел — один и тот же пенсионный возраст ЕНПФ */
  if (!cmp.enpf.retired) {
    ok(M.enpf === Math.floor(cmp.enpf.retirementAge + 1e-9), id, 'Ранний старт: ЕНПФ с ' + M.enpf + ', раздел — с ' + cmp.enpf.retirementAge);
    if (M.earlyYears > 0) ok(html.indexOf('В ЕНПФ деньги ждут ' + M.enpfGen) >= 0, id, 'в «Раннем старте» нет «ждут ' + M.enpfGen + '»');
  }

  /* подсказка графиков (CFG.enpf) = строки библиотеки */
  var cfgM = /var CFG = (\{"data":[\s\S]*?\});\n/.exec(html);
  if (ok(cfgM, id, 'нет CFG в скрипте КП')) {
    var cfg = JSON.parse(cfgM[1]);
    var XX = enpfExact(cmp);
    var x0 = Math.max(cmp.client.ageNow, Math.min(cmp.metrics.firstPayment.sl.age, Math.floor(XX.from + 1e-9)) - 2);
    var want = cmp.rows.filter(function (r) { return r.age >= x0; });
    ok(cfg.enpf && cfg.enpf.length === want.length, id, 'CFG.enpf: ' + (cfg.enpf && cfg.enpf.length) + ' строк, ожидалось ' + want.length);
    (cfg.enpf || []).forEach(function (c, k) {
      var r = want[k];
      ok(r && c[0] === r.age && c[1] === Math.round(r.slMonthlyReal) && c[2] === Math.round(XX.m(r.age)) && c[3] === Math.round(r.slCumReal) &&
         c[4] === Math.round(XX.c(r.age)) && c[5] === Math.round(r.slMonthlyNominal) && c[6] === 0, id, 'CFG.enpf строка ' + c[0] + ' ≠ библиотека');
    });
  }
  return { M: M, calc: calc, html: html, cmp: cmp, sec: sec };
}

/* ── случайные клиенты ── */
var seed = 20261005;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function d2(n) { return ('0' + n).slice(-2); }
var NAMES = ['Тест Первый', 'Тест Второй', 'Тест Третий'];

(async function main() {
  var t0 = Date.now();
  var libFile = path.join(LIB, 'compare.js'), lib, source;
  if (fs.existsSync(libFile)) {
    lib = await import(url.pathToFileURL(libFile).href);
    source = 'исходная библиотека ' + LIB;
    /* копия в генераторе не устарела? */
    var man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'enpf', 'manifest.json'), 'utf8'));
    var stale = man.files.filter(function (f) {
      var p = path.join(LIB, f.module);
      return !fs.existsSync(p) || crypto.createHash('sha256').update(fs.readFileSync(p, 'utf8')).digest('hex') !== f.sha256;
    }).map(function (f) { return f.module; });
    ok(!stale.length, 'src/enpf', 'копия устарела (' + stale.join(', ') + ') — node tools/sync-enpf.js и node tools/build.js');
  } else {
    lib = K.enpf;
    source = 'копия src/enpf (исходной библиотеки нет: ' + LIB + ')';
  }
  console.log('сверка с: ' + source);

  /* 1. профили smoke */
  cases.forEach(function (c) {
    var input = { calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp, savings: c.sav, redemption: c.red, contribution: c.con };
    var before = failures.length;
    var r = checkOne(c.id, input, { name: 'Тест Клиентов', sex: c.sex, city: 'Алматы', calcDate: c.calc }, lib);
    console.log((failures.length > before ? '✗ ' : '✓ ') + c.id.padEnd(9) + (r && r.M.enpfCmp ? ' ЕНПФ с ' + r.M.enpfCmp.enpf.startLabel + ' · ' + fmt(r.M.enpfCmp.enpf.lump ? r.M.enpfCmp.enpf.lumpReal : r.M.enpfCmp.enpf.firstReal, 't') + (r.M.enpfCmp.enpf.years ? ' × ' + r.M.enpfCmp.enpf.years + ' лет' : '') +
      ' · аннуитет ' + fmt(r.cmp.metrics.firstPayment.sl.real, 't') + ' · ' + r.M.enpfCmp.title : ' раздела нет'));
  });

  /* 2. случайные клиенты: категории, гарантии, взносы, сценарии и инфляция генератора */
  var N = +(process.env.N || 200), got = 0, tries = 0, before = failures.length;
  var cats = K.categories;
  while (got < N && tries < N * 20) {
    tries++;
    var y = 1950 + Math.floor(rnd() * 37);
    var dob = y + '-' + d2(1 + Math.floor(rnd() * 12)) + '-' + d2(1 + Math.floor(rnd() * 28));
    if (rnd() < 0.08) dob = pick(['1976-02-29', '1972-02-29', '1968-02-29', '1980-01-31', '1975-06-30', '1975-07-01', '1976-01-01', '1966-07-15', '1967-03-10']);
    var sex = pick(['мужской', 'женский']);
    var input = { calcDate: pick([TODAY, TODAY, TODAY, '2026-09-24', '2026-11-30', '2026-12-31']), dob: dob, sex: sex, category: pick(cats),
                  oppv: rnd() < 0.15 ? 'Да' : 'Нет', guarantee: Math.floor(rnd() * 11),
                  savings: rnd() < 0.1 ? Math.floor(rnd() * 1.5e6) : Math.floor(2e6 + rnd() * 40e6),
                  redemption: rnd() < 0.1 ? Math.floor(rnd() * 3e6) : 0, contribution: rnd() < 0.3 ? Math.floor(rnd() * 8e6) : 0,
                  dividendRate: pick([0.11, 0.11, 0.08, 0]) };
    var set = { scenario: pick(['realist', 'realist', 'pessimist', 'optimist']), inflation: pick(['enpf', 'enpf', 'p5', 'p8', 'p10']) };
    var r = checkOne('случайный №' + tries + ' ' + JSON.stringify(input) + ' ' + JSON.stringify(set), input,
      { name: pick(NAMES), sex: sex, city: '', calcDate: input.calcDate, enpf: set }, lib);
    if (r) got++;
  }
  console.log((failures.length > before ? '✗ ' : '✓ ') + got + ' случайных КП (попыток ' + tries + ', договор недоступен — ' + stat.skipped + ')');
  ok(got === N, 'случайные', 'собрано ' + got + ' из ' + N);

  /* 3. особые случаи */
  var base = { calcDate: TODAY, dob: '1979-05-10', sex: 'мужской', category: 'Стандартный', oppv: 'Нет', guarantee: 10, savings: 10000000, redemption: 0, contribution: 0 };
  var cl = { name: 'Тест Клиентов', sex: 'мужской', calcDate: TODAY };
  before = failures.length;
  /* синтетический пример docs/09 §7: 63 259 ₸ как в калькуляторе ЕНПФ, SL 69 082 с 55 лет */
  var r7 = checkOne('docs09 §7', base, cl, lib);
  if (r7) {
    ok(r7.cmp.enpf.asInEnpfCalculator.monthlyReal === 63259 && r7.cmp.enpf.asInEnpfCalculator.years === 17, 'docs09 §7', 'калькулятор ЕНПФ не 63 259 × 17');
    ok(r7.calc.first === 69082 && r7.calc.threshold === 9537299, 'docs09 §7', 'SL не 69 082 / 9 537 299');
    ok(/63&#160;259&#160;₸/.test(r7.sec), 'docs09 §7', 'в разделе нет 63 259 ₸');
  }
  /* блок выключен */
  checkOne('скрыт', base, Object.assign({}, cl, { enpf: { show: false } }), lib, { expectNoSection: true });
  /* отметка живой сверки: только для тех же данных */
  var calc = K.plan(base);
  var ec = K.enpfComparison(calc, cl);
  ok(ec.status === 'ok' && ec.liveBody && ec.liveBody.AverageSal === '1' && ec.liveBody.BirthDate === '10.05.1979' && ec.liveBody.SumOPV === '10000000',
    'сверка', 'тело запроса ЕНПФ не то: ' + JSON.stringify(ec.liveBody));
  ok(JSON.stringify(ec.liveBody).indexOf('Тест') < 0, 'сверка', 'в теле запроса ЕНПФ есть имя клиента');
  /* ответ ЕНПФ «как есть» (то же, что копия методики) → отметка «сверено» */
  var liveSame = K.enpf.forecastCalc(ec.liveBody, { today: TODAY }).decoded;
  var stamped = K.render(calc, Object.assign({}, cl, { enpf: { live: { key: ec.liveKey, date: TODAY, stamp: true, data: { forecast: liveSame, fetchedAt: TODAY + 'T10:00:00Z' } } } }), agent);
  ok(/class="vs-stamp"/.test(stamped) && stamped.indexOf('Сверено с калькулятором ЕНПФ (enpf.kz) 5 октября 2026 г.') >= 0, 'сверка', 'нет отметки «сверено» при совпавшем ключе');
  /* ЕНПФ «изменил методику» (ОПВ +1000 ₸): в КП — цифры из ответа ЕНПФ и отметка об этом, даже без галочки */
  var liveChanged = JSON.parse(JSON.stringify(liveSame));
  ['Pessimist', 'Realist', 'Optimist'].forEach(function (k) {
    var x = liveChanged['EnpfCalculator' + k]; x.EnpfPensionOPV = String(+x.EnpfPensionOPV + 1000);
    (x.EnpfCalcTable || liveChanged['EnpfCalculator' + k + 'UIP'].EnpfCalcTable).forEach(function (t) { if (+t.OPV > 0) t.OPV = +t.OPV + 1000; });
  });
  var changed = K.render(calc, Object.assign({}, cl, { enpf: { live: { key: ec.liveKey, date: TODAY, stamp: false, data: { forecast: liveChanged } } } }), agent);
  var wantOpv = +liveChanged.EnpfCalculatorRealist.EnpfPensionOPV;
  ok(changed.indexOf('data-k="c.enpf.first" data-v="' + wantOpv + '"') >= 0, 'сверка', 'при изменённой методике в КП не цифра из ответа ЕНПФ (' + wantOpv + ')');
  ok(changed.indexOf('Цифры ЕНПФ — из ответа калькулятора ЕНПФ (enpf.kz) 5 октября 2026 г.') >= 0, 'сверка', 'нет отметки «цифры ЕНПФ — из ответа ЕНПФ» при изменённой методике');
  ok(/"methodologyChanged":true/.test(changed), 'сверка', 'слепок не отмечает смену методики');
  var stale = K.render(calc, Object.assign({}, cl, { enpf: { live: { key: ec.liveKey.replace('10000000', '9000000'), date: TODAY, stamp: true, data: { forecast: liveChanged } } } }), agent);
  ok(!/class="vs-stamp"/.test(stale), 'сверка', 'отметка «сверено» осталась для других данных');
  /* живая сверка с ответом-заглушкой: то же, что ЕНПФ ответил 05.10.2026 (docs/09 §7), и изменённый */
  var dec = { EnpfCalculatorPessimist: { EnpfPensionOPV: '54167', EnpfPensionOPPV: '0', NumOfYearsBeforeExhAccumOPV: '16', NumOfYearsBeforeExhAccumOPPV: '0' },
              EnpfCalculatorRealist: { EnpfPensionOPV: '63259', EnpfPensionOPPV: '0', NumOfYearsBeforeExhAccumOPV: '17', NumOfYearsBeforeExhAccumOPPV: '0' },
              EnpfCalculatorOptimist: { EnpfPensionOPV: '73764', EnpfPensionOPPV: '0', NumOfYearsBeforeExhAccumOPV: '19', NumOfYearsBeforeExhAccumOPPV: '0' } };
  ok(K.enpf.checkLiveForecast(ec.cmp, { code: '0', decoded: dec }).ok, 'сверка', 'ответ ЕНПФ 05.10.2026 не совпал с репликой');
  dec.EnpfCalculatorRealist.EnpfPensionOPV = '64000';
  ok(!K.enpf.checkLiveForecast(ec.cmp, { code: '0', decoded: dec }).ok, 'сверка', 'изменённый ответ ЕНПФ не замечен');
  /* загруженный калькулятор считает иначе — раздела нет, цифры КП не расходятся */
  /* (как .xlsx с другими формулами: выплаты на 1 ₸ больше встроенных) */
  var odd = { lists: { categories: K.categories }, compute: function (inp) {
    var c = K.compute(inp);
    c.first += 1;
    c.rows = c.rows.map(function (r) { return Object.assign({}, r, { m: r.m + 1 }); });
    return c;
  } };
  var oc = K.plan(base, odd), om = K.model(oc, cl, agent);
  ok(om.enpfStatus.status === 'mismatch' && !om.enpfCmp, 'другой калькулятор', 'ожидался mismatch, получено ' + om.enpfStatus.status);
  ok(K.render(oc, cl, agent).indexOf('id="enpf"') < 0, 'другой калькулятор', 'раздел выведен при расхождении калькуляторов');
  /* пенсионер (ЕНПФ «сразу»), единовременная выплата ЕНПФ, женщина 1966 г. р. (выход в 61,5–62,5) */
  checkOne('пенсионер 66', Object.assign({}, base, { dob: '1960-02-01', guarantee: 5, savings: 15000000 }), cl, lib);
  checkOne('ЕНПФ разово', Object.assign({}, base, { savings: 300000, contribution: 9500000 }), cl, lib);
  checkOne('женщина 1966', Object.assign({}, base, { dob: '1966-08-20', sex: 'женский', savings: 14000000 }), Object.assign({}, cl, { sex: 'женский' }), lib);
  ['p5', 'p8', 'p10'].forEach(function (p) {
    ['pessimist', 'optimist'].forEach(function (s) { checkOne('docs09 §7 ' + p + '/' + s, base, Object.assign({}, cl, { enpf: { scenario: s, inflation: p } }), lib); });
  });
  console.log((failures.length > before ? '✗ ' : '✓ ') + 'особые случаи: docs/09 §7, скрытый блок, отметка сверки, ответ ЕНПФ, пенсионер, разовая выплата ЕНПФ, женщина 1966, сценарии × инфляция');

  /* 4. калькулятор компании из .xlsx (если файл есть): раздел тот же, что со встроенным — цифры КП не расходятся */
  var xlsx = process.env.KP_XLSX || path.join(process.env.HOME || '', 'Downloads', 'КП ПА', 'ПА калькулятор 21.09.2026.xlsx');
  if (fs.existsSync(xlsx)) {
    before = failures.length;
    var zlib = require('zlib');
    var E = await K.loadCalculator(new Uint8Array(fs.readFileSync(xlsx)), path.basename(xlsx), function (u8) { return new Uint8Array(zlib.inflateRawSync(u8)); });
    cases.forEach(function (c) {
      var input = { calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp, savings: c.sav, redemption: c.red, contribution: c.con };
      var cl2 = { name: 'Тест Клиентов', sex: c.sex, calcDate: c.calc };
      var a = K.plan(input), b = K.plan(input, E);
      if (!a.ok) return;
      var Mb = K.model(b, cl2, agent);
      if (!ok(Mb.enpfStatus.status === 'ok', 'xlsx ' + c.id, 'раздел не выведен: ' + Mb.enpfStatus.message)) return;
      var sa = K.render(a, cl2, agent), sb = K.render(b, cl2, agent);
      var cut = function (h) { var i = h.indexOf('id="enpf"'); return h.slice(i, h.indexOf('</section>', i)); };
      ok(cut(sa) === cut(sb), 'xlsx ' + c.id, 'раздел по файлу калькулятора отличается от встроенного');
    });
    console.log((failures.length > before ? '✗ ' : '✓ ') + 'калькулятор из файла ' + path.basename(xlsx) + ': раздел ЕНПФ тот же, что со встроенным');
  } else console.log('· файла калькулятора нет — сверку с .xlsx пропускаю: ' + xlsx);

  console.log('\nКП собрано: ' + stat.rendered + ', разделов ЕНПФ: ' + stat.sections + ', чисел сверено с библиотекой: ' + stat.values + ', проверок: ' + checks +
    ' · ' + Math.round((Date.now() - t0) / 100) / 10 + ' с');
  if (failures.length) {
    console.log('\nрасхождений: ' + failures.length);
    failures.slice(0, 25).forEach(function (f) { console.log('  ✗ ' + f); });
    process.exit(1);
  }
  console.log('цифры раздела «ЕНПФ или аннуитет» совпадают с библиотекой');
})().catch(function (e) { console.error('ОШИБКА: ' + e.stack); process.exit(1); });
