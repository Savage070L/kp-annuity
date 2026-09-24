/* Сверка расчёта с калькулятором «ПА калькулятор 21.09.2026.xlsx».
   excel-results.json — ответы самого Excel (пересчитан в LibreOffice) для профилей из excel-cases.json. */
var K = require('./render.js').loadKit();
var cases = require('./excel-cases.json'), xl = require('./excel-results.json');
var bad = 0;
cases.forEach(function (c) {
  var r = K.compute({ calcDate: c.calc, dob: c.dob, sex: c.sex, category: c.cat, oppv: c.oppv, guarantee: c.gp,
                      savings: c.sav, redemption: c.red, contribution: c.con });
  var x = xl[c.id], BP = c.sav + c.red + c.con;
  var paySign = BP / r.nax, pension = Math.round(Math.round(paySign) * Math.pow(1.08, r.deferral));
  var checks = [['статус', x.status, r.excelStatus], ['возраст', +x.x, r.age], ['старт выплат', +x.x0, r.startAge],
    ['отсрочка', x.d, r.deferral], ['аннуитетный фактор', +x.nax, r.nax], ['порог', x.minPrem, r.threshold],
    ['выплата на дату', +x.paySign, paySign], ['выплата при выходе на пенсию', x.payPension, pension]];
  var fails = checks.filter(function (k) {
    return typeof k[1] === 'number' ? Math.abs(k[1] - k[2]) > 1e-6 * Math.max(1, Math.abs(k[1])) : String(k[1]) !== String(k[2]);
  });
  bad += fails.length;
  console.log((fails.length ? '✗ ' : '✓ ') + c.id.padEnd(9) + ' порог ' + r.threshold + ', выплата при выходе ' + x.payPension +
    fails.map(function (f) { return '\n    ' + f[0] + ': Excel ' + f[1] + ' ≠ код ' + f[2]; }).join(''));
});
console.log(bad ? '\nрасхождений: ' + bad : '\nрасчёт совпадает с калькулятором');
process.exit(bad ? 1 : 0);
