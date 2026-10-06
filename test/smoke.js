/* Прогон реальных клиентов: расчёт → модель → отчёт; ищем пустые места и ошибки */
var fs = require('fs');
var K = require('./render.js').loadKit();
var cases = require('./excel-cases.json');
var names = { ref47: 'Арман Сейтов', m50_g0: 'Нурлан Абенов', w50_g5: 'Айгерим Касымова', w58_now: 'Динара Ахметова',
              m46_oppv: 'Ерлан Сапаров', w52_inv2: 'Мария Иванова', m62_g7: 'Сергей Каменский' };
var agent = { name: 'Тимур Агентов', phone: '+7 700 000 00 00', email: 'agent@example.kz', city: 'Алматы', sex: 'мужской' };
var bad = 0;
/* правило продукта от 06.10.2026: дивиденд не уменьшает доплату и не входит в сумму для оформления */
function dividendRule(calc, html) {
  var p = [], own = calc.savings + calc.redemption;
  if (calc.mode === 'threshold' && calc.topup !== calc.threshold - own) p.push('доплата ≠ порог − свои средства');
  if (calc.premium !== (calc.mode === 'threshold' ? own + calc.topup : own + calc.contribution)) p.push('сумма ≠ свои средства + взнос');
  var M = K.model(calc, { name: 'Проверка', sex: calc.input.sex, city: 'Алматы', calcDate: calc.input.calcDate }, agent);
  var parts = M.pieParts.filter(function (x) { return x.value > 0; });
  if (parts.some(function (x) { return x.key !== 'own' && x.key !== 'top'; })) p.push('в диаграмме суммы есть не только свои средства и взнос');
  if (parts.reduce(function (a, x) { return a + x.value; }, 0) !== calc.premium) p.push('доли диаграммы ≠ сумме перевода');
  var text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/&#160;|&nbsp;/g, ' ');
  [/после дивиденда/, /зач[её]т\w* дивиденд/, /с дивидендом/, /за вычетом дивиденда/, /pie-div|pieDiv|c-div/].forEach(function (re) {
    if (re.test(text)) p.push('дивиденд в доплате: ' + re.source);
  });
  if (calc.dividend > 0 && text.indexOf('доплату не уменьшает') < 0 && calc.mode === 'threshold') p.push('нет оговорки «доплату не уменьшает»');
  return p;
}
cases.forEach(function (c) {
  // вносим ровно столько, сколько нужно, либо оставляем как в профиле
  var calc = K.plan({ calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp,
                      savings: c.sav, redemption: c.red, contribution: c.con });
  var client = { name: names[c.id], sex: c.sex, city: 'Алматы', calcDate: c.calc };
  var html, err = null;
  try { html = K.render(calc, client, agent); } catch (e) { err = e; }
  if (err) { bad++; console.log('✗', c.id, 'ОШИБКА:', err.message); return; }
  var body = html.slice(html.indexOf('<body>'));
  var problems = [];
  [/undefined/, /NaN/, /\$\{/, /null/, /Infinity/].forEach(function (re) {
    var m = body.replace(/<script[\s\S]*?<\/script>/g, '').match(re);
    if (m) problems.push(re.source);
  });
  problems = problems.concat(dividendRule(calc, html));
  /* раздел «ЕНПФ или аннуитет»: есть, в меню, без пустых чисел и ячеек */
  var i = body.indexOf('<section class="section page" id="enpf">');
  var sec = i >= 0 ? body.slice(i, body.indexOf('</section>', i)) : '';
  if (!sec) problems.push('нет раздела ЕНПФ');
  else {
    if (body.indexOf('<a href="#enpf">ЕНПФ или аннуитет</a>') < 0) problems.push('нет пункта меню ЕНПФ');
    var flat = sec.replace(/<svg[\s\S]*?<\/svg>/g, '');
    [/<(b|span) class="num[^"]*"[^>]*>\s*<\/\1>/, /data-v=""/, /<td[^>]*>\s*<\/td>/, /<li>\s*<\/li>/, /<h3>\s*<\/h3>/, /<p[^>]*>\s*<\/p>/, /\[object/]
      .forEach(function (re) { if (re.test(flat)) problems.push('ЕНПФ: ' + re.source); });
    /* перед каждым ₸ — число или «млн» */
    var text = flat.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' '), mt, tg = /(\S+)\s*₸/g;
    while ((mt = tg.exec(text))) if (!/(\d|млн)$/.test(mt[1])) { problems.push('ЕНПФ: «' + mt[0] + '» без суммы'); break; }
    ['c.sl.first', 'c.sl.firstN', 'v.cum.sl', 'v.cum.enpf', 'f.diff', 'i.burial'].forEach(function (k) {
      if (sec.indexOf('data-k="' + k + '"') < 0) problems.push('ЕНПФ: нет ' + k);
    });
    if ((sec.match(/<svg class="vs-svg/g) || []).length !== 4) problems.push('ЕНПФ: не 4 рисунка');
  }
  fs.writeFileSync('/tmp/kp-' + c.id + '.html', html);
  var M = K.model(calc, client, agent);
  console.log((problems.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' ' + (M.headline).padEnd(30) +
    ' старт ' + String(M.startLabel).padEnd(9) + ' гарантия ' + String(M.gp).padEnd(2) + ' окуп. ' + M.payback.age +
    ' ранний старт ' + (M.earlyText || '0') + ' · ЕНПФ ' + (M.enpfCmp ? M.enpfCmp.enpf.startText : M.enpfStatus.status) +
    ' | ' + Math.round(html.length / 1024) + ' КБ' + (problems.length ? '  ПРОБЛЕМЫ: ' + problems.join(', ') : ''));
  if (problems.length) bad++;
});

/* эталонный клиент без взноса (М 10.03.1979, 5 800 000 ₸): доплата = порог − накопления, без зачёта дивиденда */
[[10, 3737299, 'Доступен с доплатой'], [15, 4037711, 'Доступен с доплатой']].forEach(function (t) {
  var calc = K.plan({ calcDate: '2026-09-18', dob: '1979-03-10', sex: 'мужской', category: 'Стандартный', oppv: 'Нет', guarantee: t[0],
                      savings: 5800000, redemption: 0, contribution: 0 });
  var html = K.render(calc, { name: 'Демо Клиент', sex: 'мужской', city: 'Алматы', calcDate: '2026-09-18' }, agent);
  var M = K.model(calc, { name: 'Демо Клиент', sex: 'мужской', city: 'Алматы', calcDate: '2026-09-18' }, agent);
  var sp = function (x) { return String(x).replace(/&#160;|&nbsp;|\u00A0/g, ' '); };
  var p = dividendRule(calc, html), flat = sp(html);
  if (calc.topup !== t[1]) p.push('доплата ' + calc.topup + ' ≠ ' + t[1]);
  if (M.headline !== t[2]) p.push('заголовок «' + M.headline + '»');
  if (flat.indexOf('остаётся внести ' + sp(M.money(t[1]))) < 0) p.push('нет «остаётся внести ' + t[1] + '»');
  if (p.length) bad++;
  console.log((p.length ? '✗ ' : '✓ ') + ('эталон ГП ' + t[0]).padEnd(13) + ' доплата ' + calc.topup + ' (порог ' + calc.threshold + ' − 5 800 000; дивиденд ' +
    calc.dividend + ' отдельно) · ' + M.headline + (p.length ? '  ПРОБЛЕМЫ: ' + p.join(', ') : ''));
});
console.log(bad ? '\nс проблемами: ' + bad : '\nвсе отчёты собраны без пустых мест');
process.exit(bad ? 1 : 0);
