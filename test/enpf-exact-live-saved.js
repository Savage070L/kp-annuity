/* Приёмка «цифры ЕНПФ в КП = enpf.kz, цифры SL = Excel» на 20 синтетических профилях аудита 06.10.2026:
   КП собирается генератором, числа раздела берутся из HTML (data-k/data-v) и сверяются
   с сохранёнными ЖИВЫМИ ответами ЕНПФ (audit/2026-10-06/raw) и с пересчитанной в LibreOffice книгой компании (excel.json).
   Без сети. Запуск: node test/enpf-exact-live-saved.js */
var fs = require('fs');
var K = require('./render.js').loadKit();
var A = process.env.ENPF_AUDIT || require('path').join(require('os').homedir(), 'Downloads', 'Калькулятор ЕНПФ', 'audit', '2026-10-06');
if (!fs.existsSync(A)) { console.log('нет данных аудита (' + A + ') — тест пропущен; путь можно задать: ENPF_AUDIT=…'); process.exit(0); }
var profiles = JSON.parse(fs.readFileSync(A + '/excel-audit/profiles.json', 'utf8'));
var fc = fs.readFileSync(A + '/raw/enpf-forecast-audit.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
var ks = fs.readFileSync(A + '/raw/enpf-kszh-audit.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
var XL = JSON.parse(fs.readFileSync(A + '/excel-audit/excel.json', 'utf8'));
var agent = { name: 'Тимур Агентов', phone: '+7 700 000 00 00', email: 'agent@example.kz', city: 'Алматы', sex: 'мужской' };
function dec(r) { var d = r.decoded; return typeof d === 'string' ? JSON.parse(d) : d; }
var n = 0, bad = [];
function eq(id, what, kp, src) { n++; if (kp !== src) bad.push(id + ': ' + what + ' — в КП ' + kp + ', источник ' + src); }
profiles.forEach(function (p) {
  var calc = K.plan({ calcDate: '2026-10-06', dob: p.dob, sex: p.sex, category: p.category, oppv: 'Нет', guarantee: p.guarantee, savings: p.savings, redemption: 0, contribution: 0 });
  var html = K.render(calc, { name: 'Демо Клиент', sex: p.sex, city: 'Алматы', calcDate: '2026-10-06' }, agent);
  var V = {}, re = /data-k="([^"]+)" data-v="([^"]*)"/g, m;
  while ((m = re.exec(html))) if (!(m[1] in V)) V[m[1]] = +m[2];
  var M = K.model(calc, { name: 'Демо Клиент', sex: p.sex, city: 'Алматы', calcDate: '2026-10-06' }, agent), E = M.enpfCmp;
  if (!E) { bad.push(p.id + ': в КП нет раздела ЕНПФ'); return; }
  /* ЕНПФ: прогнозный калькулятор (для ОППВ — ввод с вредным стажем 5 лет) */
  var key = p.category === 'ОППВ 60 мес' ? 'F_p15_vred5' : 'A_site_' + p.id;
  var live = fc.filter(function (r) { return r.key === key; })[0];
  if (live && live.code === '0') {
    var d = dec(live), R = d.EnpfCalculatorRealist, P = d.EnpfCalculatorPessimist, O = d.EnpfCalculatorOptimist;
    if (E.enpf.lump) eq(p.id, 'ЕНПФ одной суммой', V['c.enpf.lump'], +R.EnpfPensionOPV);
    else {
      eq(p.id, 'ЕНПФ ОПВ в месяц (реалистичный)', V['c.enpf.first'], +R.EnpfPensionOPV);
      eq(p.id, 'ЕНПФ лет до исчерпания по ОПВ', E.enpf.years, +R.NumOfYearsBeforeExhAccumOPV);
      if ('c.enpf.pes' in V) { eq(p.id, 'ЕНПФ пессимистичный', V['c.enpf.pes'], +P.EnpfPensionOPV); eq(p.id, 'ЕНПФ оптимистичный', V['c.enpf.opt'], +O.EnpfPensionOPV); }
    }
    eq(p.id, 'ЕНПФ дата выхода на пенсию', E.enpf.startDate.split('-').reverse().join('.'), R.Retirement.Dt);
    eq(p.id, 'ЕНПФ возраст выхода', E.enpf.startExact, +R.Retirement.Age);
    if (E.enpf.endExact != null) eq(p.id, 'ЕНПФ последний возраст с выплатой (таблица)', E.enpf.endExact,
      +(R.EnpfCalcTable || d.EnpfCalculatorRealistUIP.EnpfCalcTable).filter(function (t) { return +t.OPV > 0; }).slice(-1)[0].Age);
    /* «Ранний старт» — тот же пенсионный возраст ЕНПФ */
    eq(p.id, 'Ранний старт: возраст ЕНПФ', M.enpf, Math.floor(+R.Retirement.Age));
  } else if (live) {
    n++; if (E.fromCalc) bad.push(p.id + ': ЕНПФ ответил ошибкой («' + live.message + '»), а КП подаёт цифру как калькулятор ЕНПФ');
  }
  /* калькулятор аннуитета ЕНПФ — тот же договор */
  var kz = ks.filter(function (r) { return r.callId === 'M-' + p.id; })[0];
  if (kz && E.kszh) {
    var nom = (kz.response.data || kz.response).nominalOutParams;
    eq(p.id, 'КСЖ ЕНПФ: тело запроса', JSON.stringify(E.kszh.body), JSON.stringify(kz.request));
    eq(p.id, 'КСЖ ЕНПФ: первая выплата', V['a.kszh.first'], +nom.firstMonthPayment);
    if ('a.kszh.prem' in V) eq(p.id, 'КСЖ ЕНПФ: премия/минимум', V['a.kszh.prem'], +nom.insPremiumSumm);
  }
  /* Standard Life — книга компании (LibreOffice): основной вариант с тем же взносом */
  var xl = XL[p.id + '__main'];
  if (xl && xl['ввод!G2'] === 'ok') {
    eq(p.id, 'SL первая выплата (G27)', V['c.sl.firstN'], xl['ввод!G27']);
    eq(p.id, 'SL порог (J16)', calc.threshold, xl['ввод!J16']);
    if (calc.topup > 0) eq(p.id, 'SL доплата = порог − накопления', calc.topup, xl['ввод!J16'] - p.savings);
  }
});
console.log('профилей: ' + profiles.length + ', сравнений: ' + n + ', расхождений: ' + bad.length);
bad.forEach(function (b) { console.log('✗ ' + b); });
if (bad.length) process.exit(1);
console.log('цифры ЕНПФ в КП совпадают с ответами enpf.kz, цифры Standard Life — с калькулятором компании');
