/* Прогон реальных клиентов: расчёт → модель → отчёт; ищем пустые места и ошибки */
var fs = require('fs');
var K = require('./render.js').loadKit();
var cases = require('./excel-cases.json');
var names = { ref47: 'Арман Сейтов', m50_g0: 'Нурлан Абенов', w50_g5: 'Айгерим Касымова', w58_now: 'Динара Ахметова',
              m46_oppv: 'Ерлан Сапаров', w52_inv2: 'Мария Иванова', m62_g7: 'Сергей Каменский' };
var agent = { name: 'Тимур Агентов', phone: '+7 700 000 00 00', email: 'agent@example.kz', city: 'Алматы', sex: 'мужской' };
var bad = 0;
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
  fs.writeFileSync('/tmp/kp-' + c.id + '.html', html);
  var M = K.model(calc, client, agent);
  console.log((problems.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' ' + (M.headline).padEnd(30) +
    ' старт ' + String(M.startLabel).padEnd(9) + ' гарантия ' + String(M.gp).padEnd(2) + ' окуп. ' + M.payback.age +
    ' ранний старт ' + M.earlyYears + ' | ' + Math.round(html.length / 1024) + ' КБ' + (problems.length ? '  ПРОБЛЕМЫ: ' + problems.join(', ') : ''));
  if (problems.length) bad++;
});
console.log(bad ? '\nс проблемами: ' + bad : '\nвсе отчёты собраны без пустых мест');
